import { test, expect } from "bun:test";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSession, SessionStore, type RefreshFn, type SecretStore, type Session } from "../src/session";
import { NotSignedIn, ProviderUnreachable } from "../src/provider";

const NOW = 1_790_000_000_000;

function jwt(payload: Record<string, unknown>): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "ES256" })}.${part(payload)}.sig`;
}
const token = (sub: string, expMs: number, email = "a@example.com") =>
  jwt({ sub, email, exp: Math.floor(expMs / 1000) });

function memorySecrets(initial: string | null = null): SecretStore & { value: string | null } {
  const s = {
    value: initial,
    async read() { return s.value; },
    async write(v: string) { s.value = v; },
    async remove() { s.value = null; },
  };
  return s;
}

const lockPath = () => join(mkdtempSync(join(tmpdir(), "nova-session-")), "session.lock");

function session(accessExp: number, refreshToken = "r1"): Session {
  return { accessToken: token("u1", accessExp), refreshToken, expiresAt: accessExp, userId: "u1", email: "a@example.com" };
}

/** A refresh endpoint that rotates the refresh token, as Supabase does. */
function rotating(): RefreshFn & { calls: number } {
  const fn = (async (refreshToken: string) => {
    fn.calls++;
    await new Promise((r) => setTimeout(r, 20));
    const exp = NOW + 3_600_000;
    return { status: 200, body: { access_token: token("u1", exp), refresh_token: `${refreshToken}+`, expires_at: exp / 1000 } };
  }) as RefreshFn & { calls: number };
  fn.calls = 0;
  return fn;
}

const store = (secrets: SecretStore, refresh: RefreshFn, lock = lockPath()) =>
  new SessionStore({ secrets, lockPath: lock, refresh, now: () => NOW });

test("a session with a valid token is parsed with its user and expiry", () => {
  const exp = NOW + 3_600_000;
  expect(parseSession({ accessToken: token("u1", exp), refreshToken: "r1" }, NOW)).toEqual({
    accessToken: token("u1", exp), refreshToken: "r1", expiresAt: Math.floor(exp / 1000) * 1000,
    userId: "u1", email: "a@example.com",
  });
});

test("parseSession refuses a value that is not a JWT", () => {
  expect(typeof parseSession({ accessToken: "nope", refreshToken: "r1" }, NOW)).toBe("string");
});

test("parseSession refuses an expired token", () => {
  expect(typeof parseSession({ accessToken: token("u1", NOW - 1000), refreshToken: "r1" }, NOW)).toBe("string");
});

test("parseSession refuses a token with no subject", () => {
  expect(typeof parseSession({ accessToken: jwt({ exp: NOW / 1000 + 3600 }), refreshToken: "r1" }, NOW)).toBe("string");
});

test("parseSession refuses a refresh token that is not a string", () => {
  expect(typeof parseSession({ accessToken: token("u1", NOW + 3_600_000), refreshToken: 42 }, NOW)).toBe("string");
});

test("a fresh token is returned without refreshing", async () => {
  const refresh = rotating();
  const s = session(NOW + 3_600_000);
  const secrets = memorySecrets(JSON.stringify(s));
  expect(await store(secrets, refresh).accessToken()).toBe(s.accessToken);
  expect(refresh.calls).toBe(0);
});

test("a token near expiry is refreshed and the rotated pair is stored", async () => {
  const refresh = rotating();
  const secrets = memorySecrets(JSON.stringify(session(NOW + 30_000)));
  const fresh = await store(secrets, refresh).accessToken();
  expect(fresh).toBe(token("u1", NOW + 3_600_000));
  expect(JSON.parse(secrets.value!).refreshToken).toBe("r1+");
  expect(refresh.calls).toBe(1);
});

test("two concurrent refreshers make one refresh call", async () => {
  const refresh = rotating();
  const secrets = memorySecrets(JSON.stringify(session(NOW + 30_000)));
  const lock = lockPath();
  const [a, b] = await Promise.all([store(secrets, refresh, lock).accessToken(), store(secrets, refresh, lock).accessToken()]);
  expect(a).toBe(b);
  expect(refresh.calls).toBe(1);
});

test("a stale lock is broken", async () => {
  const refresh = rotating();
  const secrets = memorySecrets(JSON.stringify(session(NOW + 30_000)));
  const lock = lockPath();
  writeFileSync(lock, "");
  const old = (Date.now() - 60_000) / 1000;
  utimesSync(lock, old, old);
  await store(secrets, refresh, lock).accessToken();
  expect(refresh.calls).toBe(1);
});

test("a revoked refresh token signs out", async () => {
  const secrets = memorySecrets(JSON.stringify(session(NOW + 30_000)));
  const refusing: RefreshFn = async () => ({ status: 400, body: { error: "invalid_grant" } });
  await expect(store(secrets, refusing).accessToken()).rejects.toBeInstanceOf(NotSignedIn);
  expect(secrets.value).toBeNull();
});

test("an unreachable auth server keeps the session", async () => {
  const before = JSON.stringify(session(NOW + 30_000));
  const secrets = memorySecrets(before);
  const offline: RefreshFn = async () => { throw new TypeError("fetch failed"); };
  const err = await store(secrets, offline).accessToken().catch((e) => e);
  expect(err).toBeInstanceOf(ProviderUnreachable);
  expect(err).not.toBeInstanceOf(NotSignedIn);
  expect(secrets.value).toBe(before);
});

test("no session is NotSignedIn", async () => {
  await expect(store(memorySecrets(), rotating()).accessToken()).rejects.toBeInstanceOf(NotSignedIn);
});

test("a refresh refused for another reason (a wrong API key) keeps the session", async () => {
  const before = JSON.stringify(session(NOW + 30_000));
  const secrets = memorySecrets(before);
  const wrongKey: RefreshFn = async () => ({ status: 401, body: { message: "Invalid API key" } });
  const err = await store(secrets, wrongKey).accessToken().catch((e) => e);
  expect(err).toBeInstanceOf(ProviderUnreachable);
  expect(err).not.toBeInstanceOf(NotSignedIn);
  expect(secrets.value).toBe(before);
});

test("a reused refresh token signs out", async () => {
  const secrets = memorySecrets(JSON.stringify(session(NOW + 30_000)));
  const reused: RefreshFn = async () => ({ status: 400, body: { error_code: "refresh_token_already_used" } });
  await expect(store(secrets, reused).accessToken()).rejects.toBeInstanceOf(NotSignedIn);
  expect(secrets.value).toBeNull();
});

test("an expiry too large to be a time is refused", () => {
  const b64 = (t: string) => Buffer.from(t).toString("base64url");
  const huge = `${b64('{"alg":"ES256"}')}.${b64('{"sub":"u1","exp":1e400}')}.sig`;
  expect(parseSession({ accessToken: huge, refreshToken: "r" }, NOW)).toBe("accessToken has no expiry");
});
