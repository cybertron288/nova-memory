/**
 * The Nova Cloud session: one Keychain item holding the Supabase access and
 * refresh tokens (nova-cloud-design.md, "Signing in").
 *
 * Supabase rotates the refresh token on every use, so two processes that
 * refresh at once revoke each other. The daemon and `nova mcp` both refresh,
 * because MCP must keep working while the app is closed, so every refresh
 * happens under a lock file and re-reads the Keychain inside it.
 */
import { closeSync, openSync, statSync, unlinkSync } from "node:fs";
import { deleteKey, readSecret, writeSecret } from "./keychain";
import { NotSignedIn, ProviderUnreachable } from "./provider";

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  userId: string;
  email: string | null;
}

export interface SecretStore {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
}

export type RefreshFn = (refreshToken: string) => Promise<{ status: number; body: unknown }>;

/** Refresh this long before expiry, so a token never expires in flight. */
const EARLY_MS = 60_000;
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 10_000;
const LOCK_POLL_MS = 50;

function jwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
    return typeof payload === "object" && payload !== null ? payload : null;
  } catch {
    return null;
  }
}

/**
 * A session from the two tokens, or why it is refused. The signature is not
 * checked here: Nova Cloud verifies every token, and this only reads who it is
 * for and when it expires.
 */
export function parseSession(raw: { accessToken: unknown; refreshToken: unknown }, now: number): Session | string {
  if (typeof raw.accessToken !== "string" || raw.accessToken === "") return "accessToken must be a non-empty string";
  if (typeof raw.refreshToken !== "string" || raw.refreshToken === "") return "refreshToken must be a non-empty string";
  const payload = jwtPayload(raw.accessToken);
  if (!payload) return "accessToken is not a JWT";
  if (typeof payload.sub !== "string" || payload.sub === "") return "accessToken has no subject";
  if (typeof payload.exp !== "number") return "accessToken has no expiry";
  const expiresAt = payload.exp * 1000;
  if (expiresAt <= now) return "accessToken has expired";
  return {
    accessToken: raw.accessToken, refreshToken: raw.refreshToken, expiresAt,
    userId: payload.sub, email: typeof payload.email === "string" ? payload.email : null,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs `fn` holding the lock file; a lock older than LOCK_STALE_MS is a dead holder's. */
async function withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const until = Date.now() + LOCK_WAIT_MS;
  let held = false;
  while (!held && Date.now() < until) {
    try {
      closeSync(openSync(path, "wx", 0o600));
      held = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) unlinkSync(path);
      } catch { /* released between the two calls */ }
      if (!held) await sleep(LOCK_POLL_MS);
    }
  }
  // Past the wait the refresh goes ahead unlocked: a stuck lock must not sign
  // the user out, and a rare double refresh costs one revoked token at worst.
  if (!held) console.error("[session] refresh lock still held after 10s; refreshing without it");
  try {
    return await fn();
  } finally {
    if (held) try { unlinkSync(path); } catch { /* already gone */ }
  }
}

export class SessionStore {
  /** The last reason Nova Cloud refused this device, for the app. In memory only. */
  lastRefusal: string | null = null;
  private readonly now: () => number;

  constructor(private readonly opts: {
    secrets: SecretStore; lockPath: string; refresh: RefreshFn; now?: () => number;
  }) {
    this.now = opts.now ?? Date.now;
  }

  async get(): Promise<Session | null> {
    const raw = await this.opts.secrets.read();
    if (raw === null) return null;
    try {
      const s = JSON.parse(raw) as Session;
      return typeof s.accessToken === "string" && typeof s.refreshToken === "string" ? s : null;
    } catch {
      return null;
    }
  }

  async set(s: Session): Promise<void> {
    await this.opts.secrets.write(JSON.stringify(s));
  }

  async clear(): Promise<void> {
    await this.opts.secrets.remove();
  }

  async accessToken(): Promise<string> {
    const s = await this.get();
    if (!s) throw new NotSignedIn();
    if (s.expiresAt - this.now() > EARLY_MS) return s.accessToken;
    return this.refresh(null);
  }

  /** After Nova Cloud rejected `rejected`: refresh even though it looked valid. */
  async forceRefresh(rejected: string): Promise<string> {
    return this.refresh(rejected);
  }

  private refresh(rejected: string | null): Promise<string> {
    return withLock(this.opts.lockPath, async () => {
      // Another process may have refreshed while this one waited.
      const s = await this.get();
      if (!s) throw new NotSignedIn();
      const usable = s.expiresAt - this.now() > EARLY_MS;
      if (usable && (rejected === null || s.accessToken !== rejected)) return s.accessToken;

      let reply: { status: number; body: unknown };
      try {
        reply = await this.opts.refresh(s.refreshToken);
      } catch (e) {
        throw new ProviderUnreachable("chat", `Nova Cloud sign-in could not be renewed: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (reply.status === 400 || reply.status === 401) {
        await this.clear();
        throw new NotSignedIn("the Nova Cloud session was revoked; sign in again");
      }
      const body = reply.body as { access_token?: unknown; refresh_token?: unknown } | null;
      const next = reply.status === 200 && body
        ? parseSession({ accessToken: body.access_token, refreshToken: body.refresh_token }, this.now())
        : `status ${reply.status}`;
      if (typeof next === "string") {
        throw new ProviderUnreachable("chat", `Nova Cloud sign-in could not be renewed: ${next}`);
      }
      await this.set(next);
      return next.accessToken;
    });
  }
}

/** The production secret store: one Keychain item. */
export function keychainSecret(account: string): SecretStore {
  return {
    read: () => readSecret(account),
    write: (v) => writeSecret(account, v),
    remove: () => deleteKey(account),
  };
}

/** Supabase Auth's refresh-token grant. */
export function supabaseRefresh(authUrl: string, authKey: string): RefreshFn {
  return async (refreshToken) => {
    const res = await fetch(`${authUrl.replace(/\/+$/, "")}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: authKey },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: AbortSignal.timeout(15_000),
    });
    let body: unknown = null;
    try { body = await res.json(); } catch { /* status alone decides */ }
    return { status: res.status, body };
  };
}
