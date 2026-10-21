import { Hono, type Context } from "hono";
import type { Config } from "./config";
import { hashDevice, hashIp } from "./device";
import { LedgerUnavailable, type Ledger, type LedgerKey } from "./ledger";
import { admission, dayKey, decide, monthKey, nextUtcMidnight, secondsUntilUtcMidnight, type Decision } from "./limits";
import { Unauthorized, type VerifySession } from "./session";
import { validateChat, validateEmbed, type ChatBody, type EmbedBody, type Shaped } from "./shape";
import type { Upstream, UpstreamKind } from "./upstream";
import { costMicros, tokensFrom, worstCase, type Tokens } from "./usage";

export interface Deps {
  config: Config;
  now: () => number;
  ledger: Ledger;
  verifySession: VerifySession;
  upstream: Upstream;
  /** One JSON line per request. Never given a request or response body. */
  log: (line: Record<string, unknown>) => void;
}

/**
 * Vercel sets x-real-ip itself. The first x-forwarded-for entry can be
 * whatever the client sent, which would void the per-IP limits.
 */
function clientIp(c: Context): string {
  return c.req.header("x-real-ip")?.trim()
    || c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

function refused(c: Context, d: Extract<Decision, { ok: false }>): Response {
  const headers: Record<string, string> = d.retryAfter ? { "retry-after": String(d.retryAfter) } : {};
  return c.json({ error: d.error }, d.status, headers);
}

/** How long the daemon should wait when the ledger cannot be reached. */
const LEDGER_RETRY_S = "60";

export function createApp(deps: Deps): Hono {
  const app = new Hono();
  const { config } = deps;

  app.get("/health", async (c) => {
    try {
      await deps.ledger.ping();
      return c.json({ ok: true });
    } catch (e) {
      if (!(e instanceof LedgerUnavailable)) throw e;
      return c.json({ ok: false, error: "ledger unavailable" }, 503);
    }
  });

  const shapers: Record<UpstreamKind, (raw: unknown) => Shaped<ChatBody | EmbedBody>> = {
    chat: (raw) => validateChat(raw, { model: config.chat.model, maxTokens: config.chatMaxTokens }),
    embed: (raw) => validateEmbed(raw, { model: config.embed.model, maxInputs: 64, maxChars: config.embedMaxChars }),
  };

  const forward = (kind: UpstreamKind) => async (c: Context) => {
    const started = deps.now();
    const line: Record<string, unknown> = { path: c.req.path };
    const done = (res: Response) => {
      deps.log({ ...line, status: res.status, ms: deps.now() - started });
      return res;
    };

    // Size first, before any work is spent on the request: the declared length
    // before the body is read, then the real one.
    if (Number(c.req.header("content-length") ?? 0) > config.maxBodyBytes) {
      return done(c.json({ error: "body too large" }, 413));
    }
    const raw = await c.req.text();
    if (Buffer.byteLength(raw) > config.maxBodyBytes) return done(c.json({ error: "body too large" }, 413));
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return done(c.json({ error: "body is not JSON" }, 400));
    }

    let userId: string;
    try {
      userId = (await deps.verifySession(c.req.header("authorization"))).userId;
    } catch (e) {
      if (!(e instanceof Unauthorized)) throw e;
      return done(c.json({ error: "sign in again" }, 401));
    }
    line.user = userId;

    const device = c.req.header("x-nova-device")?.trim();
    if (!device) return done(c.json({ error: "x-nova-device is required" }, 400));
    const deviceHash = hashDevice(device);
    line.device = deviceHash.slice(0, 8);

    const shaped = shapers[kind](parsed);
    if (!shaped.ok) return done(c.json({ error: shaped.error }, 400));

    const now = deps.now();
    const ip = clientIp(c);
    const key: LedgerKey = { userId, deviceHash, ipHash: hashIp(ip, config.ipHashSecret), day: dayKey(now), month: monthKey(now) };

    // Fail closed: without a ledger nothing is counted, so nothing is forwarded.
    const unavailable = () => {
      line.ledger = "unavailable";
      return done(c.json({ error: "Nova Cloud is unavailable" }, 503, { "retry-after": LEDGER_RETRY_S }));
    };
    const reserved = worstCase(kind, shaped.body);
    try {
      const allowance = await deps.ledger.allowance(key);
      const decision = decide(allowance, now, config.monthlyCeilingUsd, config.ipDailyLimit);
      if (!decision.ok) return done(refused(c, decision));
      if (!(await deps.ledger.reserve(key, reserved, allowance.cap))) {
        return done(c.json({ error: "today's Nova Cloud allowance is used up" }, 429,
          { "retry-after": String(secondsUntilUtcMidnight(now)) }));
      }
    } catch (e) {
      if (!(e instanceof LedgerUnavailable)) throw e;
      return unavailable();
    }

    // From here every exit settles the reservation: released when nothing
    // came back, replaced by the real count when something did.
    const release = async () => {
      try {
        await deps.ledger.release(key, reserved);
      } catch (e) {
        if (!(e instanceof LedgerUnavailable)) throw e;
        line.ledger = "release failed";
      }
    };

    let reply: Response;
    try {
      reply = await deps.upstream(kind, shaped.body);
    } catch (e) {
      line.upstream = e instanceof Error ? e.name : "error";
      await release();
      return done(c.json({ error: "the model provider could not be reached" }, 502));
    }

    // A refusal from the upstream reaches the daemon as it was sent, so its
    // quota and retry handling sees the provider's own status and Retry-After.
    const text = await reply.text();
    const headers: Record<string, string> = { "content-type": reply.headers.get("content-type") ?? "application/json" };
    const retryAfter = reply.headers.get("retry-after");
    if (retryAfter) headers["retry-after"] = retryAfter;
    if (!reply.ok) {
      await release();
      // The upstream refusing the owner's key is an outage, not the user's
      // session: a relayed 401 would read to the daemon as "sign in again".
      if (reply.status === 401 || reply.status === 403) {
        line.upstream = reply.status;
        return done(c.json({ error: "the model provider refused Nova Cloud's credentials" }, 502));
      }
      const redacted = [config.chat.apiKey, config.embed.apiKey].reduce((t, k) => t.replaceAll(k, "[key]"), text);
      return done(new Response(redacted, { status: reply.status, headers }));
    }

    let body: unknown = null;
    try { body = JSON.parse(text); } catch { /* counted by estimate */ }
    const tokens: Tokens = tokensFrom(kind, shaped.body, body);
    line.in = tokens.in;
    line.out = tokens.out;
    try {
      await deps.ledger.consume(key, tokens.in, tokens.out, costMicros(kind, tokens, config.prices), reserved);
    } catch (e) {
      // The work was done and paid for; the reply still goes back.
      if (!(e instanceof LedgerUnavailable)) throw e;
      line.ledger = "consume failed";
    }
    return done(new Response(text, { status: reply.status, headers }));
  };

  app.post("/v1/chat/completions", forward("chat"));
  app.post("/v1/embeddings", forward("embed"));

  // The app's usage readout and the daemon's free start probe.
  app.get("/v1/usage", async (c) => {
    let userId: string;
    try {
      userId = (await deps.verifySession(c.req.header("authorization"))).userId;
    } catch (e) {
      if (!(e instanceof Unauthorized)) throw e;
      return c.json({ error: "sign in again" }, 401);
    }
    const device = c.req.header("x-nova-device")?.trim();
    if (!device) return c.json({ error: "x-nova-device is required" }, 400);
    const now = deps.now();
    const ip = clientIp(c);
    try {
      const a = await deps.ledger.allowance({
        userId, deviceHash: hashDevice(device), ipHash: hashIp(ip, config.ipHashSecret), day: dayKey(now), month: monthKey(now),
      });
      const admitted = admission(a, now);
      if (!admitted.ok) return refused(c, admitted);
      return c.json({
        plan: a.plan,
        usedToday: Math.max(a.deviceUsedToday, a.accountUsedToday),
        capToday: a.cap,
        resetsAt: new Date(nextUtcMidnight(now)).toISOString(),
      });
    } catch (e) {
      if (!(e instanceof LedgerUnavailable)) throw e;
      return c.json({ error: "Nova Cloud is unavailable" }, 503, { "retry-after": LEDGER_RETRY_S });
    }
  });

  return app;
}
