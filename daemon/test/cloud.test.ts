import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloudConfigFromEnv, cloudFetch, NovaCloudProvider, type CloudConfig } from "../src/cloud";
import { NotSignedIn, ProviderRefused, ProviderUnreachable, QuotaExhausted, type FetchLike } from "../src/provider";
import { SessionStore, type RefreshFn, type SecretStore } from "../src/session";

const NOW = Date.now();
const CFG: CloudConfig = { cloudUrl: "https://cloud.example", authUrl: "https://auth.example", authKey: "pk" };
const DEVICE = "d".repeat(64);

function jwt(sub: string, expMs: number): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "ES256" })}.${part({ sub, exp: Math.floor(expMs / 1000) })}.sig`;
}
const FIRST = jwt("u1", NOW + 3_600_000);
const SECOND = jwt("u1", NOW + 7_200_000);

function sessionStore(refresh?: RefreshFn): SessionStore & { refreshes: number } {
  let value: string | null = JSON.stringify({ accessToken: FIRST, refreshToken: "r1", expiresAt: NOW + 3_600_000, userId: "u1", email: null });
  const secrets: SecretStore = { read: async () => value, write: async (v) => { value = v; }, remove: async () => { value = null; } };
  const counted = (async (t: string) => {
    store.refreshes++;
    return refresh ? refresh(t) : { status: 200, body: { access_token: SECOND, refresh_token: "r2" } };
  }) as RefreshFn;
  const store = new SessionStore({
    secrets, refresh: counted, lockPath: join(mkdtempSync(join(tmpdir(), "nova-cloud-")), "session.lock"),
  }) as SessionStore & { refreshes: number };
  store.refreshes = 0;
  return store;
}

/** Replies in order; records each request's headers and body. */
function replies(...queue: (() => Response)[]) {
  const calls: { url: string; headers: Headers; body: string }[] = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, headers: new Headers(init.headers), body: String(init.body ?? "") });
    const next = queue.shift();
    if (!next) throw new Error("no reply queued");
    return next();
  };
  return { impl, calls };
}

const chatOk = () => Response.json({ choices: [{ message: { content: '{"memories":["a fact"]}' } }] });

test("requests carry the access token and the device key", async () => {
  const { impl, calls } = replies(chatOk);
  await new NovaCloudProvider(CFG, sessionStore(), DEVICE, undefined, impl).extract("hello");
  expect(calls[0]!.url).toBe("https://cloud.example/v1/chat/completions");
  expect(calls[0]!.headers.get("authorization")).toBe(`Bearer ${FIRST}`);
  expect(calls[0]!.headers.get("x-nova-device")).toBe(DEVICE);
});

test("a 401 refreshes once and retries", async () => {
  const session = sessionStore();
  const { impl, calls } = replies(() => new Response("{}", { status: 401 }), chatOk);
  expect(await new NovaCloudProvider(CFG, session, DEVICE, undefined, impl).extract("hello")).toEqual(["a fact"]);
  expect(session.refreshes).toBe(1);
  expect(calls).toHaveLength(2);
  expect(calls[1]!.headers.get("authorization")).toBe(`Bearer ${SECOND}`);
});

test("a second 401 is NotSignedIn, not a loop, and ends the session", async () => {
  const session = sessionStore();
  const { impl, calls } = replies(() => new Response("{}", { status: 401 }), () => new Response("{}", { status: 401 }));
  await expect(new NovaCloudProvider(CFG, session, DEVICE, undefined, impl).extract("hello"))
    .rejects.toBeInstanceOf(NotSignedIn);
  expect(calls).toHaveLength(2);
  expect(await session.get()).toBeNull();
});

test("a 403 is ProviderRefused with the proxy's reason", async () => {
  const session = sessionStore();
  const { impl } = replies(() => Response.json({ error: "this device is blocked" }, { status: 403 }), chatOk);
  const provider = new NovaCloudProvider(CFG, session, DEVICE, undefined, impl);
  const err = await provider.extract("hello").catch((e) => e);
  expect(err).toBeInstanceOf(ProviderRefused);
  expect(err.message).toContain("this device is blocked");
  expect(session.lastRefusal).toBe("this device is blocked");
  await provider.extract("hello");
  expect(session.lastRefusal).toBeNull();
});

for (const status of [500, 502, 503, 504]) {
  test(`a ${status} is unreachable`, async () => {
    const { impl } = replies(() => new Response("{}", { status }));
    const err = await new NovaCloudProvider(CFG, sessionStore(), DEVICE, undefined, impl).extract("hello").catch((e) => e);
    expect(err).toBeInstanceOf(ProviderUnreachable);
    expect(err).not.toBeInstanceOf(NotSignedIn);
  });
}

test("a 429 surfaces as QuotaExhausted with the proxy's Retry-After", async () => {
  const { impl } = replies(() => new Response('{"error":"used up"}', { status: 429, headers: { "retry-after": "30" } }));
  const err = await new NovaCloudProvider(CFG, sessionStore(), DEVICE, undefined, impl).extract("hello").catch((e) => e);
  expect(err).toBeInstanceOf(QuotaExhausted);
  expect(err.retryAfterMs).toBe(30_000);
});

test("capture text over 50000 characters is capped and the body fits the proxy", async () => {
  const { impl, calls } = replies(chatOk);
  await new NovaCloudProvider(CFG, sessionStore(), DEVICE, undefined, impl).extract("x".repeat(80_000));
  expect(new TextEncoder().encode(calls[0]!.body).byteLength).toBeLessThan(262_144);
  const sent = JSON.parse(calls[0]!.body).messages[0].content as string;
  expect(sent.match(/x+/g)!.reduce((n, run) => Math.max(n, run.length), 0)).toBe(50_000);
});

test("cloudConfigFromEnv names the missing variables of a partial set", () => {
  expect(cloudConfigFromEnv({})).toBeNull();
  expect(() => cloudConfigFromEnv({ NOVA_CLOUD_URL: "https://cloud.example" })).toThrow(/NOVA_AUTH_URL.*NOVA_AUTH_KEY/);
  expect(cloudConfigFromEnv({ NOVA_CLOUD_URL: "https://cloud.example/", NOVA_AUTH_URL: "https://auth.example", NOVA_AUTH_KEY: "pk" }))
    .toEqual({ cloudUrl: "https://cloud.example", authUrl: "https://auth.example", authKey: "pk" });
});

test("cloudFetch leaves a successful reply untouched", async () => {
  const { impl } = replies(() => new Response("ok", { status: 200 }));
  const res = await cloudFetch(sessionStore(), DEVICE, impl)("https://cloud.example/v1/usage", { method: "GET" });
  expect(await res.text()).toBe("ok");
});

test("loop extraction keeps the end of a long thread and the new lines, within the proxy's limit", async () => {
  const loopsOk = () => Response.json({ choices: [{ message: { content: '{"loops":[],"closed":[]}' } }] });
  const { impl, calls } = replies(loopsOk);
  const newest = "Sam: I'll send the Q3 deck by Friday";
  const thread = `${"old message\n".repeat(6_000)}${newest}`;
  const added = `${"x".repeat(40_000)}\n${newest}`;
  await new NovaCloudProvider(CFG, sessionStore(), DEVICE, undefined, impl)
    .extractLoops(thread, { app: "Slack", title: "DM", url: null, capturedAt: NOW, added }, []);
  const body = calls[0]!.body;
  expect(new TextEncoder().encode(body).byteLength).toBeLessThan(262_144);
  const content = JSON.parse(body).messages[0].content as string;
  expect(content.split(newest).length - 1).toBe(2);   // once in CONTENT, once in NEW
});
