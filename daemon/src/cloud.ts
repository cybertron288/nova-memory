/**
 * Nova Cloud: the OpenAI-compatible provider pointed at Nova's proxy
 * (nova-cloud-design.md, cloud/README.md).
 *
 * The proxy speaks the same API as any BYOK endpoint, so the prompts,
 * redaction and parseLoops gates stay exactly where they are. What differs is
 * credentials (a session token and this Mac's device key on every request)
 * and a few replies only the proxy sends, mapped here onto the pipeline's
 * existing error classes so none of them spends one of a capture's attempts.
 */
import {
  DIM, NotSignedIn, OpenAICompatProvider, ProviderRefused, ProviderUnreachable,
  type CallSink, type CaptureContext, type DigestSummary, type DigestSummaryInput,
  type FetchLike, type InferenceProvider, type LoopExtraction, type TrackedLoop,
} from "./provider";
import type { SessionStore } from "./session";

export interface CloudConfig { cloudUrl: string; authUrl: string; authKey: string }

const CLOUD_VARS = ["NOVA_CLOUD_URL", "NOVA_AUTH_URL", "NOVA_AUTH_KEY"] as const;

/**
 * Capture text per call. The proxy refuses a body over 256 KiB; 50,000
 * characters leaves room for the prompt even when every character needs
 * several bytes. The start of a capture is kept.
 */
export const MAX_CLOUD_TEXT = 50_000;

/** Null when none of the three is set; a partial set is a typo and is named. */
export function cloudConfigFromEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>): CloudConfig | null {
  const get = (name: string) => (env[name] ?? "").trim();
  const missing = CLOUD_VARS.filter((v) => get(v) === "");
  if (missing.length === CLOUD_VARS.length) return null;
  if (missing.length > 0) throw new Error(`Incomplete Nova Cloud configuration: ${missing.join(", ")} not set`);
  return {
    cloudUrl: get("NOVA_CLOUD_URL").replace(/\/+$/, ""),
    authUrl: get("NOVA_AUTH_URL").replace(/\/+$/, ""),
    authKey: get("NOVA_AUTH_KEY"),
  };
}

async function errorText(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch { /* not JSON */ }
  return text.trim() || `status ${res.status}`;
}

export function cloudFetch(session: SessionStore, deviceKey: string, inner: FetchLike = (u, i) => fetch(u, i)): FetchLike {
  return async (url, init) => {
    const kind = url.endsWith("/embeddings") ? "embed" : "chat";
    const send = (token: string) => {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${token}`);
      headers.set("x-nova-device", deviceKey);
      return inner(url, { ...init, headers });
    };

    const token = await session.accessToken();
    let res = await send(token);
    // One refresh and one retry: a token the proxy refuses twice is a session
    // problem, and looping would hammer both the proxy and Supabase.
    if (res.status === 401) {
      res = await send(await session.forceRefresh(token));
      if (res.status === 401) {
        // Signed out for real (the account was deleted, say): without this the
        // app would show "signed in" while every drain refreshed and failed.
        await session.clear();
        throw new NotSignedIn("Nova Cloud rejected the session; sign in again");
      }
    }
    if (res.status === 403) {
      const reason = await errorText(res);
      session.lastRefusal = reason;
      throw new ProviderRefused(reason);
    }
    // Any 5xx: the proxy or its upstream failed, not this capture. Vercel
    // answers 504 on a function timeout and 500 when an invocation dies.
    if (res.status >= 500) {
      throw new ProviderUnreachable(kind, `Nova Cloud is unavailable (${res.status}): ${await errorText(res)}`);
    }
    if (res.ok) session.lastRefusal = null;
    return res;
  };
}

function capped(text: string, limit: number, keep: "start" | "end"): string {
  if (text.length <= limit) return text;
  console.error(`[cloud] capture text capped at ${limit} of ${text.length} characters, keeping the ${keep}`);
  return keep === "start" ? text.slice(0, limit) : text.slice(text.length - limit);
}

/** The proxy chooses the model and holds the provider key; these fill the shape. */
const PLACEHOLDER = "nova-cloud-session";

export class NovaCloudProvider implements InferenceProvider {
  private readonly inner: OpenAICompatProvider;
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly cfg: CloudConfig, session: SessionStore, deviceKey: string,
    sink?: CallSink, fetchImpl?: FetchLike,
  ) {
    this.fetchImpl = cloudFetch(session, deviceKey, fetchImpl);
    const base = `${cfg.cloudUrl}/v1`;
    this.inner = new OpenAICompatProvider({
      chatBaseUrl: base, chatApiKey: PLACEHOLDER, chatModel: PLACEHOLDER,
      embedBaseUrl: base, embedApiKey: PLACEHOLDER, embedModel: PLACEHOLDER, embedDim: DIM,
    }, this.fetchImpl, sink);
  }

  extract(versionText: string, ctx?: CaptureContext): Promise<string[]> {
    return this.inner.extract(capped(versionText, MAX_CLOUD_TEXT, "start"), ctx);
  }

  /**
   * The loop prompt carries the capture and its new lines, and parseLoops
   * checks evidence against the same two texts it was given. New messages sit
   * at the end of a thread, so the end is what is kept: the new lines get up
   * to half the budget and the capture the rest.
   */
  extractLoops(versionText: string, ctx?: CaptureContext, tracked?: TrackedLoop[]): Promise<LoopExtraction> {
    const added = ctx?.added === undefined ? undefined : capped(ctx.added, MAX_CLOUD_TEXT / 2, "end");
    const text = capped(versionText, MAX_CLOUD_TEXT - (added?.length ?? 0), "end");
    return this.inner.extractLoops(text, added === undefined ? ctx : { ...ctx!, added }, tracked);
  }

  summarizeDigest(input: DigestSummaryInput): Promise<DigestSummary> {
    return this.inner.summarizeDigest(input);
  }

  embed(texts: string[]): Promise<Float32Array[]> {
    return this.inner.embed(texts);
  }

  /** Today's allowance. Never reaches the model provider, so it costs nothing. */
  async usage(): Promise<{ plan: string; usedToday: number; capToday: number; resetsAt: string }> {
    const res = await this.fetchImpl(`${this.cfg.cloudUrl}/v1/usage`, { method: "GET" });
    if (!res.ok) throw new Error(`Nova Cloud usage: ${await errorText(res)}`);
    return res.json() as Promise<{ plan: string; usedToday: number; capToday: number; resetsAt: string }>;
  }
}
