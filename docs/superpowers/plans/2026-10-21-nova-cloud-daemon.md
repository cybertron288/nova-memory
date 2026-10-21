# Nova Cloud: Phase B (daemon) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the daemon use Nova Cloud: hold a signed-in session and a device key, call the proxy through the existing OpenAI-compatible provider, bind the store to one account, and handle every proxy reply without losing a capture or a retry attempt.

**Architecture:** Nova Cloud is `OpenAICompatProvider` with two additions: a fetch wrapper that adds the session token and device key and maps proxy replies onto the pipeline's existing error classes, and a thin decorator that caps capture text. The session lives in the Keychain as one JSON item; refreshes are serialised across processes with a lock file. The shell (Phase C) hands the daemon a session over the control socket; the daemon is the only process that stores it.

**Tech Stack:** Bun, TypeScript, `bun:sqlite` + SQLCipher, the macOS `security` CLI (via `keychain.ts`), Supabase Auth's REST token endpoint.

**Spec:** `docs/nova-cloud-design.md`. **Proxy contract:** `cloud/src/proxy.ts`, `cloud/README.md`. **Phases:** `docs/superpowers/plans/2026-10-21-nova-cloud-proxy.md`.

## Global Constraints

- Run from `daemon/`: `cd daemon && bun test`, `cd daemon && bun run typecheck`. Bun only.
- Only daemon-side code opens the store or holds a secret (CLAUDE.md, "Things that get broken here" 1). The shell never keeps the session; it sends it once with `set_session`.
- Nothing is written to stdout from code reachable by `nova mcp` (rule 8). Diagnostics go to stderr.
- Invalid input at the control socket is refused, never coerced (rule 9).
- No capture, loop or queue row is dropped silently (rule 10). A capture the cloud cannot take spends no attempt unless the capture itself is at fault.
- `providerFromEnv` behaviour for the six `NOVA_*` variables and `GEMINI_API_KEY` is unchanged. Nova Cloud applies only when neither is set.
- Keychain service `dev.nova.keys` (tests use `NOVA_KEYCHAIN_SERVICE`). New accounts: `device` (32 random bytes, existing `getOrCreateKey`) and `session` (a JSON string).
- Store metadata keys: `account` = `lookupDigest(userId, key)`; `account_email` = `encryptField(email, key)`. Never the user id or email in the clear.
- Proxy contract: base URL `NOVA_CLOUD_URL`; headers `Authorization: Bearer <access token>`, `X-Nova-Device: <device key hex>`; body limit 262,144 bytes; replies 401, 403, 413, 429 (with `Retry-After`), 502, 503 (with `Retry-After`), and the upstream's own statuses.
- Supabase Auth: `NOVA_AUTH_URL` (the project URL) and `NOVA_AUTH_KEY` (the publishable key, public by design). Refresh is `POST {NOVA_AUTH_URL}/auth/v1/token?grant_type=refresh_token` with header `apikey: NOVA_AUTH_KEY` and body `{ "refresh_token": … }`. Production defaults for all three are set in Phase C; until then they come from the environment.
- Capture text sent to Nova Cloud is capped at 50,000 characters per call, keeping the start, with the cap logged (never the text).

## Review Focus

1. **Two processes refresh at once** (daemon and `nova mcp`). Supabase rotates refresh tokens, so the loser's token is revoked. Expected: refresh happens under a lock, the second process re-reads the Keychain inside the lock and uses the fresh token. Pinned in Task 3.
2. **A refresh that fails.** A network failure keeps the session and reads as unreachable (no attempt spent); `400`/`401` from Supabase (revoked or reused token) clears the session and reads as signed out. Pinned in Task 3.
3. **`set_session` with a malformed, expired or subject-less token, or a non-string field.** Refused with a reason; nothing stored. Pinned in Task 6.
4. **The delete fails during `replaceStore`.** The session is not stored and the old binding stays; the user is not signed in to an account whose store still holds someone else's memory. Pinned in Task 6.
5. **The proxy answers 401 to a token the daemon believes valid** (revoked, clock skew). One refresh and one retry, never a loop; a second 401 reads as signed out. Pinned in Task 4.

---

## File structure

```
daemon/src/
  keychain.ts      + readSecret, writeSecret (string items)
  account.ts       NEW  store ↔ account binding, masked email, mismatch summary
  session.ts       NEW  SessionStore: Keychain-backed session, lock-coordinated refresh
  cloud.ts         NEW  cloudFetch (headers + reply mapping), NovaCloudProvider (text cap),
                        cloudConfigFromEnv
  provider.ts      + NotSignedIn, ProviderRefused (both extend ProviderUnreachable);
                     unreachable() passes a ProviderUnreachable through unchanged
  resolve.ts       NEW  resolveProvider(): env providers first, else Nova Cloud
  control.ts       + set_session, sign_out, account ops; reply() may carry `detail`
  cli.ts           start: resolveProvider, no exit when signed out, damaged-store exit 3;
                   mcp/search/status use resolveProvider
daemon/test/
  keychain.test.ts account.test.ts session.test.ts cloud.test.ts resolve.test.ts control.test.ts cli.test.ts
```

---

### Task 1: String secrets in the Keychain, and the device key

**Files:**
- Modify: `daemon/src/keychain.ts`, `daemon/test/keychain.test.ts`
- Create: none

**Interfaces:**
- Produces:
  - `readSecret(account: string): Promise<string | null>`: `null` only for "item not found" (`isGenuinelyAbsent`); any other failure throws, as `getOrCreateKey` does.
  - `writeSecret(account: string, value: string): Promise<void>`: `add-generic-password -U`; throws on failure.
  - `deleteKey(account)` exists and is reused for sign-out.
  - `deviceKey(): Promise<string>`: `getOrCreateKey("device")` as lowercase hex (64 chars).

- [ ] **Step 1: Write the failing tests** (they run against the test Keychain service from `test/setup.ts`):
  - `"a written secret reads back exactly"`: `writeSecret("t-secret", '{"a":"b c"}')` then `readSecret` → `'{"a":"b c"}'`.
  - `"an absent secret reads as null"`: after `deleteKey("t-missing")`, `readSecret("t-missing")` → `null`.
  - `"the device key is stable 64-char hex"`: two calls return the same `/^[0-9a-f]{64}$/` string.
- [ ] **Step 2: Run** `cd daemon && bun test test/keychain.test.ts` → FAIL (functions missing).
- [ ] **Step 3: Implement** in `keychain.ts`, reusing `run()`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(daemon): string secrets and a device key in the Keychain`

---

### Task 2: Account binding

**Files:**
- Create: `daemon/src/account.ts`, `daemon/test/account.test.ts`

**Interfaces:**
- Produces:
  - `type Binding = { kind: "unbound" } | { kind: "same" } | { kind: "other"; previousEmail: string }`
  - `checkBinding(db, key, userId: string): Binding`: compares `lookupDigest(userId, key)` with `store_metadata.account`.
  - `bindAccount(db, key, userId: string, email: string | null): void`: writes `account` and `account_email` in one transaction.
  - `maskEmail(email: string | null): string`: first character, `•••`, `@` and the domain (`"alex@example.com"` → `"a•••@example.com"`); `null` or no `@` → `"another account"`.
  - `mismatchSummary(db): { memories: number; loops: number; since: number | null }`: counts from `countForDelete(db, { kind: "all" })` and `MIN(committed_at)` of `memory_versions`.

- [ ] **Step 1: Write the failing tests:**
  - `"an empty store is unbound"` → `{ kind: "unbound" }`.
  - `"the bound account reads as same"`: `bindAccount(db, KEY, "u1", "a@example.com")`, `checkBinding(db, KEY, "u1")` → `{ kind: "same" }`.
  - `"another account reads as other with the previous email masked"`: then `checkBinding(db, KEY, "u2")` → `{ kind: "other", previousEmail: "a•••@example.com" }`.
  - `"the user id and email are never stored in the clear"`: no `store_metadata.value` contains `"u1"` or `"a@example.com"`.
  - `"maskEmail handles a missing or odd address"`: `maskEmail(null)` and `maskEmail("nobody")` → `"another account"`.
  - `"mismatchSummary counts memories and loops and the first capture"` on a store with one committed version and one loop.
- [ ] **Step 2: Run** `cd daemon && bun test test/account.test.ts` → FAIL.
- [ ] **Step 3: Implement** `account.ts`, following `identity.ts`'s `store_metadata` pattern.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(daemon): bind the store to one account`

---

### Task 3: The session store

**Files:**
- Create: `daemon/src/session.ts`, `daemon/test/session.test.ts`

**Interfaces:**
- Consumes: `readSecret`, `writeSecret`, `deleteKey` (Task 1).
- Produces:
  - `interface Session { accessToken: string; refreshToken: string; expiresAt: number /* epoch ms */; userId: string; email: string | null }`
  - `parseSession(raw: { accessToken: unknown; refreshToken: unknown }, now: number): Session | string`: decodes the JWT payload (no signature check; the proxy verifies), requires `sub` a non-empty string, `exp` a number in the future, both tokens non-empty strings; returns the reason when refused.
  - `class SessionStore` with `constructor(opts: { secrets: SecretStore; lockPath: string; refresh: RefreshFn; now?: () => number })`
    - `get(): Promise<Session | null>`
    - `set(s: Session): Promise<void>`, `clear(): Promise<void>`
    - `accessToken(): Promise<string>`: the cached token when it expires more than 60 s from now; otherwise refreshes under the lock. Throws `NotSignedIn` when there is no session or the refresh is refused; throws `ProviderUnreachable("chat", …)` when the refresh cannot reach Supabase.
    - `forceRefresh(): Promise<string>`: refresh even if not near expiry (used once after a proxy 401).
    - `lastRefusal: string | null`: in memory only; set by `cloudFetch` (Task 4), read by the `account` op (Task 6).
  - `type SecretStore = { read(): Promise<string | null>; write(v: string): Promise<void>; remove(): Promise<void> }` (Keychain-backed in production, in-memory in tests).
  - `type RefreshFn = (refreshToken: string) => Promise<{ status: number; body: unknown }>` (production: `supabaseRefresh(authUrl, authKey)` posting to the token endpoint).
  - Lock: `openSync(lockPath, "wx")`; an existing lock older than 30 s is stale and removed; otherwise wait 50 ms and retry, up to 10 s, then refresh anyway. Inside the lock, re-read the secret and skip the refresh if another process already wrote a token that is not near expiry. *(Builder's call on the poll interval.)*

- [ ] **Step 1: Write the failing tests:**
  - `"a session with a valid token is parsed with its user and expiry"`: a JWT with `sub: "u1", email: "a@example.com", exp` 1 hour ahead → `{ userId: "u1", email: "a@example.com", expiresAt: exp*1000, … }`.
  - `parseSession` refusals, one test each: not a JWT; `exp` in the past; no `sub`; `refreshToken` not a string.
  - `"a fresh token is returned without refreshing"`: `refresh` never called.
  - `"a token near expiry is refreshed and the rotated pair is stored"`: refresh returns `{ status: 200, body: { access_token, refresh_token, expires_at, user: { id, email } } }` → the store holds the new refresh token.
  - `"two concurrent refreshers make one refresh call"`: two `SessionStore`s sharing one `SecretStore` and `lockPath`, both near expiry, `Promise.all([a.accessToken(), b.accessToken()])` → both return the same new token, `refresh` called once.
  - `"a stale lock is broken"`: a lock file with mtime 60 s ago → refresh proceeds.
  - `"a revoked refresh token signs out"`: refresh `{ status: 400 }` → rejects `NotSignedIn`, store cleared.
  - `"an unreachable auth server keeps the session"`: refresh throws `TypeError("fetch failed")` → rejects `ProviderUnreachable` (not `NotSignedIn`), store unchanged.
  - `"no session is NotSignedIn"`.
- [ ] **Step 2: Run** `cd daemon && bun test test/session.test.ts` → FAIL.
- [ ] **Step 3: Add** `NotSignedIn extends ProviderUnreachable` and `ProviderRefused extends ProviderUnreachable` to `provider.ts` (kind `"chat"`), and make `unreachable(kind, e)` return `e` unchanged when `e instanceof ProviderUnreachable`. **Implement** `session.ts`.
- [ ] **Step 4: Run** `cd daemon && bun test` → all PASS (the `unreachable` change must not move any existing test).
- [ ] **Step 5: Commit** `feat(daemon): a Keychain session with lock-coordinated refresh`

---

### Task 4: The Nova Cloud provider

**Files:**
- Create: `daemon/src/cloud.ts`, `daemon/test/cloud.test.ts`

**Interfaces:**
- Consumes: `SessionStore`, `NotSignedIn`, `ProviderRefused`, `OpenAICompatProvider`, `FetchLike`, `CallSink`.
- Produces:
  - `interface CloudConfig { cloudUrl: string; authUrl: string; authKey: string }`
  - `cloudConfigFromEnv(env): CloudConfig | null`: all three of `NOVA_CLOUD_URL`, `NOVA_AUTH_URL`, `NOVA_AUTH_KEY`, or `null` when none is set; a partial set throws naming the missing ones (same rule as the six `NOVA_*`).
  - `cloudFetch(session: SessionStore, deviceKey: string, inner?: FetchLike): FetchLike`. Per request: set `authorization` to `Bearer ${await session.accessToken()}` and `x-nova-device`. Then:
    - 401 → `session.forceRefresh()` and retry once; a second 401 → throw `NotSignedIn`.
    - 403 → set `session.lastRefusal` to the proxy's `error` text and throw `ProviderRefused` with it.
    - any 2xx → clear `session.lastRefusal`.
    - 502 or 503 → throw `ProviderUnreachable` (no attempt spent).
    - every other status → return the response for `OpenAICompatProvider` to handle (429 already becomes `QuotaExhausted` with `Retry-After`).
  - `class NovaCloudProvider implements InferenceProvider`: wraps an `OpenAICompatProvider` built with `chatBaseUrl = embedBaseUrl = cloudUrl + "/v1"`, placeholder keys and models (the proxy ignores both), `embedDim: DIM`, and `cloudFetch`. Delegates every method; `extract` and `extractLoops` truncate `versionText` to `MAX_CLOUD_TEXT = 50_000` characters, logging `[cloud] capture text capped at 50000 of N characters` to stderr.
  - `usage(): Promise<{ plan: string; usedToday: number; capToday: number; resetsAt: string }>`: `GET /v1/usage` through `cloudFetch`; the start probe uses it.

- [ ] **Step 1: Write the failing tests** (fake `inner` fetch recording requests; `SessionStore` with an in-memory `SecretStore`):
  - `"requests carry the access token and the device key"`.
  - `"a 401 refreshes once and retries"`: first reply 401, second 200 → one `refresh` call, two upstream calls, result returned.
  - `"a second 401 is NotSignedIn, not a loop"`: both 401 → rejects `NotSignedIn`, exactly two upstream calls.
  - `"a 403 is ProviderRefused with the proxy's reason"`: body `{"error":"this device is blocked"}` → message contains `this device is blocked`, and `session.lastRefusal` holds it until the next 2xx clears it.
  - `"502 and 503 are unreachable"`.
  - `"a 429 surfaces as QuotaExhausted with the proxy's Retry-After"`: through `NovaCloudProvider.extract` → `QuotaExhausted` with `retryAfterMs === 30_000`.
  - `"capture text over 50000 characters is capped and the body fits the proxy"`: `extract("x".repeat(80_000))` → the sent body is under 262,144 bytes and holds exactly 50,000 `x` characters.
  - `"cloudConfigFromEnv names the missing variables of a partial set"`.
- [ ] **Step 2: Run** `cd daemon && bun test test/cloud.test.ts` → FAIL.
- [ ] **Step 3: Implement** `cloud.ts`.
- [ ] **Step 4: Run** `cd daemon && bun test` → PASS.
- [ ] **Step 5: Commit** `feat(daemon): the Nova Cloud provider`

---

### Task 5: Provider resolution, the start probe, MCP and search

**Files:**
- Create: `daemon/src/resolve.ts`, `daemon/test/resolve.test.ts`
- Modify: `daemon/src/cli.ts` (start, search, status, mcp), `daemon/test/pipeline.test.ts` (signed-out drain)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `resolveProvider(env, sink, deps?: { session?: SessionStore; deviceKey?: () => Promise<string> }): Promise<{ provider: InferenceProvider; mode: "env" | "cloud" | "none"; session: SessionStore | null }>`:
    1. any `NOVA_CHAT_*`/`NOVA_EMBED_*`, or `GEMINI_API_KEY` → `providerFromEnv`, mode `env`.
    2. else `cloudConfigFromEnv` present → `NovaCloudProvider`, mode `cloud`.
    3. else `MissingKeyProvider`, mode `none`.
  - `nova start`: mode `none` keeps today's exit 1 with the existing message. Mode `cloud` probes `usage()`: success logs the plan and today's use; `NotSignedIn` logs `[nova] not signed in to Nova Cloud; captures are kept and wait for sign-in` and **continues**; `ProviderUnreachable` logs and continues; anything else exits 1.
  - `nova mcp`, `search`, `status` call `resolveProvider` and pass `provider` on. `nova mcp` constructs the same `SessionStore`, so it refreshes under the shared lock.

- [ ] **Step 1: Write the failing tests:**
  - `resolve.test.ts`: `"NOVA_* wins over Nova Cloud"`, `"GEMINI_API_KEY wins over Nova Cloud"`, `"Nova Cloud when only its three variables are set"`, `"no configuration is mode none"`.
  - `pipeline.test.ts`: `"a signed-out drain spends no attempt and keeps every capture"`: a provider whose `extract` throws `NotSignedIn` → `drainQueue` returns 0, attempts stay 0, rows stay, `Reachability.since` set (the `ProviderUnreachable` path).
  - `pipeline.test.ts`: `"a refused device spends no attempt"`: same with `ProviderRefused`.
- [ ] **Step 2: Run** `cd daemon && bun test test/resolve.test.ts test/pipeline.test.ts` → the new tests FAIL.
- [ ] **Step 3: Implement** `resolve.ts`; switch the four `cli.ts` call sites to it.
- [ ] **Step 4: Run** `cd daemon && bun test` → PASS.
- [ ] **Step 5: Commit** `feat(daemon): use Nova Cloud when no provider is configured`

---

### Task 6: `set_session`, `sign_out`, `account`

**Files:**
- Modify: `daemon/src/control.ts`, `daemon/test/control.test.ts`, `daemon/src/cli.ts` (pass the `SessionStore` into `DaemonState`)

**Interfaces:**
- Consumes: `parseSession`, `SessionStore`, `checkBinding`, `bindAccount`, `maskEmail`, `mismatchSummary`, `deleteScope`, `clearLogs`.
- Produces:
  - `reply()` accepts an optional `detail` on failure: `{ id, ok: false, error, detail? }`.
  - `DaemonState.session: SessionStore | null` (null in mode `env`).
  - `set_session` `{ accessToken, refreshToken, replaceStore? }`:
    - `session` null → `{ ok: false, error: "Nova Cloud is not in use: a provider is configured in the environment" }`.
    - `parseSession` refusal → `{ ok: false, error: <reason> }`.
    - binding `unbound` or `same` → `bindAccount`, `session.set`, then `{ ok: true, result: { email } }`, and `state.networkUp()` so the queue drains now.
    - binding `other` and `replaceStore` not `true` → `{ ok: false, error: "account_mismatch", detail: { previousEmail, memories, loops, since } }`; nothing changes.
    - binding `other` and `replaceStore: true` → `deleteScope(db, { kind: "all" }, { clearCallLog: true })` and `clearLogs`, then bind and store. If the delete throws, nothing else happens and the error is returned.
    - `replaceStore` present and not a boolean → refused.
  - `sign_out` → `session.clear()`; the binding stays, so the same account signing back in keeps everything. `{ ok: true, result: {} }`.
  - `account` → `{ mode, signedIn, email, refusal }`, where `refusal` is the message of the last `ProviderRefused` (kept on the `SessionStore`), else `null`.

- [ ] **Step 1: Write the failing tests** (`control.test.ts`, in-memory `SecretStore`):
  - `"set_session on an unbound store signs in and binds it"`.
  - `"set_session for the same account keeps the store"`: a committed capture survives.
  - `"set_session for another account is refused with the masked previous email and counts"`: `detail` equals `{ previousEmail: "a•••@example.com", memories: 1, loops: 1, since: <ts> }`, session unchanged.
  - `"replaceStore deletes everything, then binds the new account"`: no `memory_versions` rows remain, binding is the new account.
  - `"a failed delete leaves the old binding and stores no session"`: `deleteScope` made to throw (drop a table it touches inside the test) → error reply, `checkBinding` still `other`, `session.get()` null.
  - Refusals, one each: malformed token, expired token, `replaceStore: "yes"`.
  - `"sign_out clears the session and keeps the binding"`.
  - `"account reports mode, email and the last refusal"`.
  - `"set_session in env mode is refused"`.
- [ ] **Step 2: Run** `cd daemon && bun test test/control.test.ts` → FAIL.
- [ ] **Step 3: Implement** the three ops and add them to `OPS`.
- [ ] **Step 4: Run** `cd daemon && bun test` → PASS.
- [ ] **Step 5: Commit** `feat(daemon): sign in, sign out, and clear the store for a different account`

---

### Task 7: A damaged store stops the daemon with its own exit code

**Files:**
- Modify: `daemon/src/cli.ts`, `daemon/src/db.ts` (export `StoreUnreadable`), `daemon/test/db.test.ts`

**Interfaces:**
- Produces:
  - `class StoreUnreadable extends Error`; `openDb` throws it when SQLCipher reports `file is not a database` (wrong key or an edited file) on the first statement after `PRAGMA key`.
  - `EXIT_STORE_UNREADABLE = 3`. `nova start` catches `StoreUnreadable`, logs `[nova] the store cannot be decrypted: it was edited or its key changed. Nova will not read it or call Nova Cloud. Delete or restore ~/Library/Application Support/Nova/memory.db.`, and exits 3 before spawning capture or creating a provider. `search`, `status` and `mcp` print the same reason to stderr and exit 3.
  - Phase C's supervisor treats exit 3 as terminal (no restart loop) and shows the message.

- [ ] **Step 1: Write the failing test** (`db.test.ts`): `"a store whose bytes were edited is StoreUnreadable"`: create a store in a temp dir, write a capture, close it, overwrite 64 bytes at offset 4096 with zeros, `openDb` the same path → rejects `StoreUnreadable`. A second test opens it with a different Keychain `db` key (test service) → `StoreUnreadable`.
- [ ] **Step 2: Run** `cd daemon && bun test test/db.test.ts` → FAIL.
- [ ] **Step 3: Implement** the classification in `openDb` and the exit in `cli.ts`.
- [ ] **Step 4: Run** `cd daemon && bun test` → PASS.
- [ ] **Step 5: Commit** `feat(daemon): refuse a store that cannot be decrypted`

---

### Task 8: Docs and pre-push checks

**Files:**
- Modify: `CLAUDE.md` (Config: provider resolution gains Nova Cloud; Process wiring: exit code 3), `docs/data-model.md` (control ops `set_session`, `sign_out`, `account`; `store_metadata` keys `account`, `account_email`), `docs/architecture.md` (Nova Cloud path), `docs/privacy.md` (the device key, the account binding, what Nova Cloud receives), `docs/providers.md` (the three `NOVA_CLOUD_*`/`NOVA_AUTH_*` variables), `docs/features.md` (F6.5 progress)

- [ ] **Step 1: Write** the doc changes. Each states only what Tasks 1–7 built.
- [ ] **Step 2: Pre-push checks:** `cd daemon && bun test && bun run typecheck`. Expected: all pass, no type errors.
- [ ] **Step 3: Commit** `docs: Nova Cloud on the daemon side`

A real Nova Cloud call (sign-in, one capture through the proxy, and the 1536-dimension check on Gemini) needs the shell's sign-in sheet and costs money. It belongs to Phase C and needs the owner's go-ahead.
