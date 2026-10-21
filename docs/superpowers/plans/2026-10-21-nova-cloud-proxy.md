# Nova Cloud: phases, and Phase A (proxy core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Nova Cloud proxy in `cloud/`: an OpenAI-compatible endpoint that verifies a Supabase session, enforces per-device daily caps and a monthly ceiling, and forwards to an upstream set by environment.

**Architecture:** A Hono app built by `createApp(deps)`, so every outside dependency (session verification, the usage ledger, the upstream, the clock) is injected and faked in tests. `server.ts` wires the real ones and hands `app.fetch` to `Bun.serve`, which Vercel's Bun runtime detects. Usage lives in Supabase Postgres behind two SQL functions called over HTTP.

**Tech Stack:** Bun 1.3, TypeScript, Hono, `jose` (JWT and JWKS), `@supabase/supabase-js` (RPC over HTTP), Supabase Postgres migrations, Vercel (`bunVersion: "1.x"`).

**Spec:** `docs/nova-cloud-design.md`

## Phases

The spec spans three subsystems that ship now, plus Apple-dependent layers
that wait for the Apple Developer Program (spec, "Integrity"). Each phase gets
its own detailed plan when it starts; this document details Phase A only.

| Phase | Delivers | Depends on |
|---|---|---|
| **A. Proxy core** (this plan) | `cloud/`: auth, shape checks, per-device and per-account caps, IP limits, forwarding, usage, schema, preview deploy. | Nothing |
| B. Daemon | Device key, session storage with lock-coordinated refresh, `NotSignedIn`, Nova Cloud provider, account binding and `account_mismatch`, damaged-store refusal, Nova Cloud 503 treated as unreachable (no attempt spent). | A's wire format |
| C. Shell and launch | Sign-in sheet and `nova://` scheme, the account-switch warning, Account pane; production deploy, keepalive cron, docs (privacy, README, providers, D28, features, the deferred Apple D-item). | A, B |
| *Deferred* | Signed bundled daemon, DeviceCheck, App Attest, Sign in with Apple. | Apple Developer Program |

## Global Constraints

- Runtime: Bun, matching the daemon's `>=1.3`. `vercel.json` sets `"bunVersion": "1.x"` (1.4.x is a breaking rewrite; adopt it deliberately later).
- Package manager and test runner: `bun install`, `bun test`. Never npm.
- The proxy never stores or logs a request or response body. Logs carry user id, device hash prefix, endpoint, token counts, status, duration.
- Usage is counted **per device and per account**; a request is refused when either is over the cap. The device key arrives in the `X-Nova-Device` header and is stored only as `sha256` hex. An account may link at most 3 device keys in any 30 days.
- Plans: `new` = 100,000 tokens/day for an account's first 7 days; `free` = 1,000,000 tokens/day.
- Monthly ceiling default $20, from the environment as `NOVA_MONTHLY_CEILING_USD`.
- Daily cap 429: `Retry-After` = seconds until the next 00:00 UTC, minimum 1. Ceiling 429: `Retry-After: 3600`.
- The upstream is configured entirely by environment: `UPSTREAM_CHAT_BASE_URL`, `UPSTREAM_CHAT_API_KEY`, `UPSTREAM_CHAT_MODEL`, `UPSTREAM_EMBED_BASE_URL`, `UPSTREAM_EMBED_API_KEY`, `UPSTREAM_EMBED_MODEL`.
- Chat requests must be Nova-shaped: exactly one `user` message, `temperature: 0`, `response_format: { type: "json_object" }`, no `stream: true`. The client's `model` is replaced; `max_tokens` is set to the server's clamp.
- Embedding requests: `input` is an array of at most 64 strings (the daemon's `BATCH`), total characters capped.
- The database is reached only through Supabase's HTTP API (`supabase-js` RPC), never a direct Postgres connection.
- Row-level security denies all access to every table; the proxy uses the service-role key.
- Code style follows `daemon/`: comments only for a non-obvious why; refuse invalid input at the boundary rather than coercing it (CLAUDE.md, bug class 9).

## Review Focus

1. **Upstream error responses** (a DeepSeek 429, a 500, a timeout). The proxy passes status, body and `Retry-After` through unchanged so the daemon's quota and retry handling still works, and consumes no tokens for them. Pinned in Task 5.
2. **An upstream 200 with no `usage` field.** Counting zero would make the proxy free and unlimited; it counts an estimate of `ceil(chars / 4)` for input and output instead. Pinned in Task 5.
3. **The ledger is down** (Supabase unreachable, paused, or the RPC errors). The proxy fails closed: 503 with `Retry-After: 60`, and never forwards to the upstream without a ledger. Pinned in Task 5.
4. **A body that is not JSON, is an array, or is larger than the limit.** Rejected with 400 or 413 before any ledger or upstream call. Pinned in Tasks 3 and 5.
5. **The UTC midnight boundary.** A request at 23:59:59.500 UTC gets `Retry-After: 1`, never 0, and usage after midnight counts against the new day. Pinned in Task 4.

---

## File structure

```
cloud/
  package.json            bun, hono, jose, @supabase/supabase-js
  tsconfig.json           mirrors daemon/tsconfig.json
  vercel.json             bunVersion 1.x
  src/
    server.ts             Bun.serve({ fetch: createApp(realDeps(loadConfig(process.env))).fetch })
    app.ts                createApp(deps): Hono. Routes and the request pipeline only.
    config.ts             loadConfig(env): Config. Refuses missing or malformed vars.
    session.ts            verifySession: Supabase JWT against JWKS
    shape.ts              validateChat, validateEmbed: pure
    limits.ts             decide(): pure allowance decision; secondsUntilUtcMidnight
    ledger.ts             Ledger interface, SupabaseLedger
    upstream.ts           forward(): one call to the configured upstream
    usage.ts              tokensFrom(): usage field or the chars/4 estimate
    device.ts             hashDevice, hashIp
  supabase/migrations/
    20261021000000_nova_cloud.sql
  test/
    fakes.ts              FakeLedger, fakeUpstream, test JWKS and token minting
    config.test.ts  session.test.ts  shape.test.ts  limits.test.ts  app.test.ts
```

---

### Task 1: Scaffold `cloud/`, config, and `/health`

**Files:**
- Create: `cloud/package.json`, `cloud/tsconfig.json`, `cloud/vercel.json`, `cloud/src/config.ts`, `cloud/src/app.ts`, `cloud/src/server.ts`, `cloud/test/config.test.ts`, `cloud/test/app.test.ts`
- Modify: `.gitignore` (add `cloud/node_modules`, `cloud/.env*`, `cloud/.vercel`)

**Interfaces:**
- Produces:
  - `interface Config { chat: UpstreamConfig; embed: UpstreamConfig; supabaseUrl: string; supabaseServiceKey: string; jwksUrl: string; monthlyCeilingUsd: number; prices: PriceTable; maxBodyBytes: number; chatMaxTokens: number; embedMaxChars: number }`
  - `interface UpstreamConfig { baseUrl: string; apiKey: string; model: string }`
  - `type PriceTable = { chatInPerMTok: number; chatOutPerMTok: number; embedPerMTok: number }` from `NOVA_PRICE_CHAT_IN`, `NOVA_PRICE_CHAT_OUT`, `NOVA_PRICE_EMBED` (USD per million tokens)
  - `function loadConfig(env: Record<string, string | undefined>): Config`, throws `ConfigError` naming every missing or invalid variable at once
  - `interface Deps { config: Config; now: () => number; ledger: Ledger; verifySession: VerifySession; upstream: Upstream; log: (line: Record<string, unknown>) => void }` (the types come from Tasks 2–5; declare them in their own files and import here)
  - `function createApp(deps: Deps): Hono`
  - Defaults *(builder's call)*: `maxBodyBytes` 262144, `chatMaxTokens` 4096, `embedMaxChars` 200000.

- [ ] **Step 1: Write the failing tests**

`config.test.ts`:
- `"loadConfig names every missing variable"`: `loadConfig({})` throws a `ConfigError` whose message contains `UPSTREAM_CHAT_BASE_URL`, `SUPABASE_URL` and `NOVA_MONTHLY_CEILING_USD`.
- `"loadConfig refuses a non-numeric ceiling"`: with every variable set and `NOVA_MONTHLY_CEILING_USD: "twenty"`, it throws and the message contains `NOVA_MONTHLY_CEILING_USD`.
- `"loadConfig reads a complete environment"`: returns `monthlyCeilingUsd === 20` and `chat.model === "deepseek-chat"` for a fixture env.

`app.test.ts`:
- `"GET /health answers 200 when the ledger answers"`: `createApp(fakeDeps()).request("/health")` → status 200, body `{ ok: true }`, and `FakeLedger.pings === 1`.
- `"GET /health answers 503 when the ledger is down"`: with `FakeLedger.down = true` → 503.

- [ ] **Step 2: Run** `cd cloud && bun test` → FAIL (modules missing).

- [ ] **Step 3: Implement** `config.ts`, `app.ts` with `/health` calling `deps.ledger.ping()`, `server.ts`, and `test/fakes.ts` with `fakeDeps(overrides?)` and a minimal `FakeLedger`.

- [ ] **Step 4: Run** `cd cloud && bun test` → PASS.

- [ ] **Step 5: Commit** `feat(cloud): scaffold the Nova Cloud proxy with config and health`

---

### Task 2: Session verification

**Files:**
- Create: `cloud/src/session.ts`, `cloud/test/session.test.ts`
- Modify: `cloud/test/fakes.ts` (test key pair, `mintToken(claims, opts)`)

**Interfaces:**
- Produces:
  - `interface Session { userId: string; email: string | null }`
  - `type VerifySession = (authorization: string | undefined) => Promise<Session>`
  - `function sessionVerifier(jwks: JWTVerifyGetKey, issuer: string): VerifySession`, using `jose.jwtVerify` with `audience: "authenticated"` and the given issuer
  - `class Unauthorized extends Error`
  - Real wiring in `server.ts`: `createRemoteJWKSet(new URL(config.jwksUrl))`, issuer `${supabaseUrl}/auth/v1`.

- [ ] **Step 1: Write the failing tests** (keys from `jose.generateKeyPair("ES256")`, JWKS via `createLocalJWKSet`):
- `"a valid token yields the user id and email"` → `{ userId: "u1", email: "a@example.com" }` from claims `sub: "u1", email: "a@example.com"`.
- `"a missing header is Unauthorized"`, `"a non-Bearer header is Unauthorized"`, `"an expired token is Unauthorized"` (`exp` one second in the past), `"a token from another issuer is Unauthorized"`, `"a token signed by another key is Unauthorized"`. Each rejects with `Unauthorized`.

- [ ] **Step 2: Run** `cd cloud && bun test test/session.test.ts` → FAIL.
- [ ] **Step 3: Implement** `sessionVerifier`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(cloud): verify Supabase sessions against the JWKS`

---

### Task 3: Request shape checks

**Files:**
- Create: `cloud/src/shape.ts`, `cloud/test/shape.test.ts`

**Interfaces:**
- Produces:
  - `type Shaped<T> = { ok: true; body: T } | { ok: false; status: 400; error: string }`
  - `function validateChat(raw: unknown, cfg: { model: string; maxTokens: number }): Shaped<ChatBody>` where `ChatBody` is the forwarded body: `{ model, messages: [{ role: "user", content: string }], temperature: 0, response_format: { type: "json_object" }, max_tokens }`. The client's `model` and `max_tokens` are replaced, never echoed.
  - `function validateEmbed(raw: unknown, cfg: { model: string; maxInputs: 64; maxChars: number }): Shaped<EmbedBody>`, `EmbedBody = { model, input: string[], dimensions?: number }`. `dimensions` passes through only when it is 1536, the daemon's `DIM`.

- [ ] **Step 1: Write the failing tests.** The accepted fixture is the daemon's exact body from `daemon/src/provider.ts` (`OpenAICompatProvider`): `{ model: "anything", messages: [{ role: "user", content: "x" }], temperature: 0, response_format: { type: "json_object" } }`.
- `"the daemon's chat body is accepted with the server's model and max_tokens"` → `body.model === "deepseek-chat"`, `body.max_tokens === 4096`.
- Rejected with 400, each its own test: two messages; a `system` message; `temperature: 0.7`; no `response_format`; `stream: true`; `content` not a string; `raw` an array; `raw` null.
- `"the daemon's embed body is accepted"` for `{ model: "x", input: ["a", "b"], dimensions: 1536 }`.
- Rejected: 65 inputs; a non-string input; total characters over `maxChars`; `dimensions: 768`; `input` a bare string.

- [ ] **Step 2: Run** `cd cloud && bun test test/shape.test.ts` → FAIL.
- [ ] **Step 3: Implement** both validators. Each rejection's `error` names the field ("messages must be exactly one user message").
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(cloud): accept only Nova-shaped chat and embedding requests`

---

### Task 4: Schema, ledger, and the allowance decision

**Files:**
- Create: `cloud/supabase/migrations/20261021000000_nova_cloud.sql`, `cloud/src/limits.ts`, `cloud/src/ledger.ts`, `cloud/test/limits.test.ts`
- Modify: `cloud/test/fakes.ts` (full `FakeLedger`)

**Interfaces:**
- Produces:
  - SQL: tables `plans`, `accounts`, `devices`, `account_devices`, `usage_daily`, `spend_monthly`, `ip_daily` exactly as the spec's Data model table, plus RLS enabled with no policies on each. Seed `plans`: (`new`, 100000), (`free`, 1000000).
  - SQL `allowance(p_user uuid, p_device text, p_ip text, p_day date, p_month text) returns jsonb`: upserts the `accounts` row (plan `new`), the `devices` row, and the `account_devices` link; when the `accounts` row is new, adds 1 to `ip_daily.signups` for `p_ip`. It does **not** create the link when the account already has 3 links with `linked_at` in the last 30 days; it reports that instead. Returns `{ plan, cap, device_used_today, account_used_today, month_cost_micros, device_linked, device_blocked, ip_requests_today, ip_signups_today }`. The effective plan is `new` while `now() - created_at < interval '7 days'`, else the stored plan.
  - SQL `consume_tokens(p_user uuid, p_device text, p_ip text, p_day date, p_month text, p_in int, p_out int, p_cost_micros bigint) returns void`: `INSERT … ON CONFLICT DO UPDATE SET x = x + excluded.x` on `usage_daily` twice (subjects `d:<device>` and `u:<user>`), `spend_monthly`, and `ip_daily`.
  - `interface Allowance { plan: "new" | "free"; cap: number; deviceUsedToday: number; accountUsedToday: number; monthCostMicros: number; deviceLinked: boolean; deviceBlocked: boolean; ipRequestsToday: number; ipSignupsToday: number }`
  - `interface Ledger { ping(): Promise<void>; allowance(k: LedgerKey): Promise<Allowance>; consume(k: LedgerKey, tokensIn: number, tokensOut: number, costMicros: number): Promise<void> }`, `LedgerKey = { userId: string; deviceHash: string; ipHash: string; day: string; month: string }`
  - `class LedgerUnavailable extends Error`; `SupabaseLedger` wraps every `supabase.rpc` error in it.
  - `type Decision = { ok: true } | { ok: false; status: 403 | 429; retryAfter?: number; error: string }`
  - `function decide(a: Allowance, now: number, ceilingUsd: number, ipDailyLimit: number, ipSignupLimit: number): Decision`
  - `function secondsUntilUtcMidnight(now: number): number` (minimum 1)
  - `function dayKey(now: number): string` (`YYYY-MM-DD` UTC), `function monthKey(now: number): string` (`YYYY-MM`)
  - `ipDailyLimit` default *(builder's call)*: 5000 requests per IP per day, from `NOVA_IP_DAILY_LIMIT`.
  - `ipSignupLimit` default *(builder's call)*: 3 new accounts per IP per day, from `NOVA_IP_SIGNUP_LIMIT`. Over it, the new account is refused with 429 until midnight UTC.

- [ ] **Step 1: Write the failing tests** (`limits.test.ts`, all pure):
- `"a fourth device key within 30 days is refused with 403"`: `deviceLinked: false`.
- `"a blocked device is refused with 403"`.
- `"under the cap is allowed"`: `deviceUsedToday 999_999, accountUsedToday 0, cap 1_000_000` → `{ ok: true }`.
- `"the device at its cap is 429 until UTC midnight"`: `deviceUsedToday 1_000_000` at `Date.UTC(2026,9,21,22,0,0)` → `{ status: 429, retryAfter: 7200 }`.
- `"the account at its cap is 429 even on a fresh device"`: `deviceUsedToday 0, accountUsedToday 1_000_000` → 429.
- `"one half-second before midnight gives Retry-After 1"`: at `Date.UTC(2026,9,21,23,59,59,500)` → `retryAfter: 1`.
- `"dayKey rolls over at UTC midnight"`: `dayKey(Date.UTC(2026,9,21,23,59,59,999)) === "2026-10-21"`, `dayKey(Date.UTC(2026,9,22)) === "2026-10-22"`.
- `"the monthly ceiling stops everyone with Retry-After 3600"`: `monthCostMicros 20_000_000`, ceiling 20 → `{ status: 429, retryAfter: 3600 }`, even when both used counts are 0.
- `"the ceiling is checked before the daily cap"`: both exceeded → `retryAfter: 3600`.
- `"an IP over its daily limit is 429 until midnight"`.
- `"a fourth new account from one IP in a day is 429 until midnight"`: `ipSignupsToday 4`, limit 3.

- [ ] **Step 2: Run** `cd cloud && bun test test/limits.test.ts` → FAIL.
- [ ] **Step 3: Implement** `limits.ts`, the migration, `ledger.ts` (`SupabaseLedger` calls `rpc("allowance", …)`, and `rpc("consume_tokens", …)`), and `FakeLedger` with in-memory maps, `down` and `pings`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Verify the migration** against a local Supabase: `cd cloud && bunx supabase start && bunx supabase db reset`. Expected: completes with no SQL error, and `bunx supabase db lint` reports none. (Needs Docker; if it is not running, ask the owner rather than skipping.)
- [ ] **Step 6: Commit** `feat(cloud): usage schema, ledger, and the allowance decision`

---

### Task 5: Forwarding and the request pipeline

**Files:**
- Create: `cloud/src/upstream.ts`, `cloud/src/usage.ts`, `cloud/src/device.ts`
- Modify: `cloud/src/app.ts`, `cloud/test/app.test.ts`, `cloud/test/fakes.ts` (`fakeUpstream`)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `type Upstream = (kind: "chat" | "embed", body: ChatBody | EmbedBody) => Promise<Response>`; `httpUpstream(cfg: Config): Upstream` posts to `baseUrl` joined with `chat/completions` or `embeddings` (one slash between them, whatever the base URL ends with) with `authorization: Bearer <apiKey>`, 120 s timeout.
  - `function tokensFrom(kind, sent: ChatBody | EmbedBody, reply: unknown): { in: number; out: number }`: `usage.prompt_tokens` / `usage.completion_tokens` (embeddings: `usage.prompt_tokens` or `usage.total_tokens`, out 0); when absent, `ceil(chars / 4)` of the sent text and of the reply's content.
  - `function costMicros(kind, t: { in: number; out: number }, prices: PriceTable): number`
  - `function hashDevice(key: string): string` (sha256 hex); `hashIp(ip: string): string` likewise.
  - Request headers: `Authorization: Bearer <access token>`, `X-Nova-Device: <device key>`. The client IP is read from `x-forwarded-for`'s first entry (Vercel sets it) and hashed.

**Pipeline for `POST /v1/chat/completions` and `POST /v1/embeddings`, in this order** (each step's failure returns at once):
1. Body over `maxBodyBytes` → 413. Not JSON → 400.
2. `verifySession` → 401 on `Unauthorized`.
3. Missing `X-Nova-Device` → 400.
4. Shape check → 400.
5. `ledger.allowance` → `LedgerUnavailable` → 503 `Retry-After: 60`.
6. `decide` → 403/429 as decided.
7. `upstream` → network failure → 502. A non-2xx reply is returned with its status, body and `Retry-After`, and nothing is consumed.
8. 2xx: `tokensFrom`, `costMicros`, `ledger.consume`, then return the upstream body unchanged. A `consume` failure is logged and the reply is still returned (the work was done and paid for).
9. One log line per request with no body content.

- [ ] **Step 1: Write the failing tests** (`app.test.ts`, with `fakeDeps` and `fakeUpstream` recording calls):
- `"a Nova chat request is forwarded with the server's model and its usage is consumed"`: upstream receives `model: "deepseek-chat"`, `max_tokens: 4096`; response 200 equals the upstream body; `FakeLedger` holds `in: 1200, out: 80` from a reply with `usage: { prompt_tokens: 1200, completion_tokens: 80 }`.
- `"an embeddings request is forwarded and counted"`.
- `"a reply with no usage is counted by estimate, not as zero"`: content of 400 chars sent and 40 chars returned → consumed `in: 100, out: 10`.
- `"an upstream 429 passes through with its Retry-After and consumes nothing"`: upstream 429 with `retry-after: 30` → client gets 429, header `retry-after: 30`, ledger unchanged.
- `"an upstream 500 passes through and consumes nothing"`.
- `"the ledger being down returns 503 and never calls the upstream"`: `FakeLedger.down = true` → 503, `retry-after: 60`, `fakeUpstream.calls.length === 0`.
- `"usage is recorded against both the device and the account"`: after one forwarded request, `FakeLedger` holds the same counts under `d:<hash>` and `u:<user>`, and never the raw device key.
- `"no bearer token is 401"`, `"no device header is 400"`, `"a 300 KiB body is 413 before the session is checked"`, `"a non-JSON body is 400"`, `"a JSON array body is 400"`.
- `"over the daily cap is 429 with Retry-After until midnight"` (clock injected).
- `"log lines never contain the request content"`: send content `"SECRET-CANARY"`; no `deps.log` call's JSON contains it.

- [ ] **Step 2: Run** `cd cloud && bun test test/app.test.ts` → FAIL.
- [ ] **Step 3: Implement** `upstream.ts`, `usage.ts`, `device.ts` and the two routes in `app.ts`, as one pipeline function shared by both routes.
- [ ] **Step 4: Run** `cd cloud && bun test` → PASS.
- [ ] **Step 5: Commit** `feat(cloud): forward Nova requests and count their tokens per device`

---

### Task 6: `/v1/usage`

**Files:**
- Modify: `cloud/src/app.ts`, `cloud/test/app.test.ts`

**Interfaces:**
- Consumes: `Ledger`, `decide`, `secondsUntilUtcMidnight`.
- Produces: `GET /v1/usage` (session and device required): `{ plan, usedToday, capToday, resetsAt }`, where `usedToday` is the larger of the device and account counts (the one that will run out first) and `resetsAt` is an ISO string for the next 00:00 UTC. Phase B's start probe uses it; it never calls the upstream.

- [ ] **Step 1: Write the failing tests:**
- `"usage reports plan, today's use, cap and the next UTC midnight"`: `new` plan, device used 2500, account used 4000 → `{ plan: "new", usedToday: 4000, capToday: 100000, resetsAt: "2026-10-22T00:00:00.000Z" }`.
- `"usage needs a session"` → 401.
- `"usage never calls the upstream"` → `fakeUpstream.calls.length === 0`.

- [ ] **Step 2: Run** `cd cloud && bun test test/app.test.ts` → FAIL.
- [ ] **Step 3: Implement** the route.
- [ ] **Step 4: Run** `cd cloud && bun test` → PASS.
- [ ] **Step 5: Commit** `feat(cloud): report today's usage`

---

### Task 7: Preview deploy (owner-assisted)

This is a preview deploy only. It proves the build, the environment and the
database link. Production waits for Phase C, when the app can sign in.

**Files:**
- Create: `cloud/README.md` (setup: Supabase project, migration push, Vercel env vars by name, preview deploy; no secrets)
- Modify: `docs/README.md` (link `cloud/README.md`)

- [ ] **Step 1: Owner step.** Ask the owner to create the Supabase project and the Vercel project and to set every variable `loadConfig` names. Do not create accounts or handle keys yourself.
- [ ] **Step 2: Push the migration:** `cd cloud && bunx supabase db push`. Expected: the migration applies.
- [ ] **Step 3: Pre-push checks:** `cd cloud && bun test && bunx tsc --noEmit`. Expected: all pass, no type errors.
- [ ] **Step 4: Preview deploy:** `cd cloud && bunx vercel deploy`. Expected: a preview URL.
- [ ] **Step 5: Verify** `curl -s <preview>/health` → `{"ok":true}`, and `curl -s -o /dev/null -w '%{http_code}' -X POST <preview>/v1/chat/completions` → `401`. No request reaches the upstream, so this costs nothing. A real forwarded request costs money and needs the owner's explicit go-ahead.
- [ ] **Step 6: Commit** `docs(cloud): setup guide for the Nova Cloud proxy`
