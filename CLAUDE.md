# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Nova is a macOS menu-bar app that captures the frontmost window, builds a private
encrypted on-device memory, serves it to any LLM over MCP, and finds and closes
open loops. `README.md` has the product framing; `RUNNING.md` is the operator
guide and is more current than any summary here. Status: M2 in progress
(`docs/roadmap.md`).

## Commands

```sh
# daemon (TypeScript, Bun) — run from daemon/, see "the cwd is load-bearing"
cd daemon && bun install          # needs: brew install sqlcipher
cd daemon && bun test             # ~330 tests
cd daemon && bun run typecheck    # tsc --noEmit

# one test
cd daemon && bun test test/loops.test.ts
cd daemon && bun test test/loops.test.ts -t "restatement"   # -t = name substring

# capture + shell (Swift, swift-testing — NOT XCTest)
cd capture && swift test
swift test --package-path shell
swift test --package-path capture --filter ContentScoringTests
swift test --list-tests           # exact identifiers when a --filter misses

# the app: builds capture + shell, signs as "Nova Dev", --run replaces the running copy
scripts/build-app.sh --run
```

The daemon is **not** in the app bundle — the shell runs it from `daemon/` with
Bun, so a daemon change needs only a daemon restart, never `build-app.sh`.

Logs: `cd daemon && bun src/cli.ts logs` (colored, per-subsystem; `--tag capture`,
`-n 200`). The file is `~/Library/Logs/Nova/daemon.log`, mode `0600` because it
names the user's loops in plaintext. `sqlite3` cannot open the store — it is
SQLCipher.

Prompt changes must be scored before they are kept:
`bun eval/run.ts <name>` then `bun eval/score.ts <name>`. **`run.ts` calls the
live provider and costs money**; `score.ts` re-scores saved runs for free, which
is the point of the split. Fixtures hold real captured content and are gitignored
(`daemon/eval/**/*.local.json`).

### Verification

Run the daemon tests, the type check and `swift test` before pushing. UI changes
are verified in the running app (`scripts/build-app.sh --run`), with a screenshot
in the pull request.

## Architecture

Three processes. **Only Nova's own daemon-side code opens the store or holds the field
key**: the daemon, plus the `nova mcp`, `search` and `status` commands, which open
it in their own process so MCP works without the app. The shell and every other
CLI command go through the control socket.

```
NovaShell (Swift, .accessory)       menu bar, panel, digest card
  └─ spawns: bun src/cli.ts start   cwd=daemon/, supervised with backoff
       └─ spawns: nova-capture --emit   one JSON line per capture on stdout
  └─ talks to: ~/Library/Application Support/Nova/control.sock  (NDJSON, 0600)
```

- `capture/` — `nova-capture` (Swift). Reads the frontmost window via AX every
  3 s, splits content from app chrome, dedups, falls back to OCR.
- `daemon/` — `nova` (TypeScript/Bun). Stores captures encrypted, extracts
  memories and loops via the provider, serves MCP and the control socket.
- `shell/` — `NovaShell` (Swift). Menu bar app and panel; supervises the daemon.
- `docs/` — PRD, architecture, data model, roadmap, decisions R1–R11,
  deferred tasks D1–D21.

### Process wiring

- **The cwd is load-bearing.** `.env` is at the repo root; `daemon/.env` is a
  symlink to it. Bun auto-loads `.env` from the process cwd, so the shell sets
  `cwd=daemon/`. Running `bun src/cli.ts start` from the repo root loads no keys
  and fails as a provider error, not a missing-file error.
- `Supervisor.swift` ignores `PATH` when finding Bun (a Finder-launched app has
  none) and walks up for `daemon/src/cli.ts`. Overrides: `NOVA_BUN`,
  `NOVA_DAEMON_DIR`, `NOVA_CAPTURE_BIN`, `NOVA_CONTROL_SOCKET`.
- Capture runs under Nova.app's signature and its Accessibility grant, because
  the shell injects the bundle's auxiliary binary as `NOVA_CAPTURE_BIN`.
- **Capture exiting shuts the daemon down** (exit 0 → supervisor restarts both).
  A daemon with no capture is the failure being avoided. In reverse, capture
  watches its parent with kqueue and exits immediately — a SIGKILLed daemon never
  gets to kill its child.
- Exit code 0 means "stopped deliberately" and resets the restart streak;
  `pkill` is the documented restart method, so counting clean stops walked
  backoff to 60 s and gave up after ten.
- One daemon only, enforced by pidfile **before** the store opens: a second
  `start` would unlink and steal the socket, leaving the first daemon running and
  unreachable — and `pause` would reach only one of two capture children.

### Pipeline

`ingestStream` → `handleLine` → queue → `drainQueue` (15 s, own clock).

`handleLine`: validate → `deniedSource` (refuses the whole capture before the
store *and* before any provider call) → `redactSecrets` → one transaction over
`resolveThread` + `isNovel` + `commitVersion` + `enqueueExtraction`.

- **Those four are one transaction on purpose.** `isNovel` records the
  fingerprint as a side effect; committed separately, a later throw would
  blacklist that exact capture forever, since nothing deletes from
  `message_fingerprints`.
- Dedup is three layers in three places: capture-side Jaccard novelty (0.85),
  `treeHash` (chrome-only changes), and `fingerprint.ts` (sha256 after collapsing
  relative timestamps — otherwise "3 minutes ago" → "8 minutes ago" makes an
  unchanged conversation novel every tick).
- Thread identity is **never stored in the clear**: `source_key` is an HMAC
  `lookupDigest`. AES-GCM is randomized so ciphertext can't serve a UNIQUE
  constraint, and plain SHA-256 can't either — the set of URLs a person browses
  is enumerable offline.
- In `drainQueue`, **all network work happens first against a content snapshot**,
  and the commit re-reads `content_hash` inside the writing transaction. Ingest
  and drain share one event loop, so a same-hour overwrite can land mid-`await`;
  writing derivatives before the await left vector rows pointing at deleted ids,
  unreclaimable.
- Retry queue: claim inside a transaction, 10-min claim timeout to recover dead
  holders, `releaseStaleClaims` at startup, backoff `min(60s·2^n, 1h)` to 8
  attempts. A backoff **must release the claim** or the next drain skips the row
  until the timeout. Quota refusals, an unreachable provider
  (`ProviderUnreachable`) and mid-flight content changes spend **no** attempt —
  counting an outage toward MAX_ATTEMPTS marked captures failed for good.
- **A queue row leaves only when its capture succeeds.** After 8 attempts it is
  *parked* (`parked_at`, encrypted `last_error`), never deleted; Your Space's
  Activity banner and `nova retry` re-queue it. A 200 with an unusable body
  (truncated, empty, no `memories` array) throws `MalformedResponse` and is
  retried — returning `[]` used to commit the version as done and lose it.
  Only an explicit `{"memories": []}` is an empty extraction.
- The quota gate is shared across chat and embed: a 429 from either pauses both,
  because with embeddings at 429 every drain still paid to extract memories that
  couldn't be stored.
- The loop pass is best-effort and **outside** the commit. A loop enriches an
  already-stored memory, so a provider failure must not re-queue the version and
  pay to re-extract correct memories.

### Encryption

Two layers: SQLCipher over the file, plus per-field AES-256-GCM on anything
quoting the user's screen. Two separate keychain keys under `dev.nova.keys`
(accounts `db` and `field`), 32 random bytes each — never a constant in source,
never derived from machine facts.

Encrypted: `source_title`, `source_url`, `memory_versions.content`,
`memory_derivatives.content`, `open_loops.description`, `closure_sig`.
Plaintext by design: `source_app`, `source_key`, `content_hash`, timestamps,
and the loop's `direction`/`counterparty`/`due_signal`/`state`. Note the
asymmetry — `due_signal` is a verbatim quote and is *not* encrypted.

Vector search: int8 KNN over-fetch → exact float32 rescore from the sidecar. The
quantization scale is discarded, so the int8 column cannot be dequantized alone.
`OVER_FETCH = 500` is **a fraction of the corpus (~0.4%), not an absolute depth**
— re-measure at the next order of magnitude (`daemon/bench/vector-precision.ts`).

### Loop extraction

Precision is the governing constraint (M2→M3 gate ≥60%, target ≥70%): a missed
commitment costs nothing visible, an invented one trains the user to ignore the
list. `temperature: 0` throughout.

App classes are excluded **before** any model call (`watchesForLoops`): AI
assistants, terminals, editors. Asking the model to recognize them cost a call
per capture and still leaked.

`parseLoops` enforces four gates **in code even though the prompt states them**
— at temperature 0 the model still broke the direction rule in 1 run of 3:

1. Evidence must be a verbatim quote found in the capture (normalized for
   curly quotes and reflowed breaks). Applies to closures too.
2. Evidence must be in the **newly added** lines, or a notes-to-self DM raises
   its whole backlog on every read.
3. Direction must fit who wrote the evidence line. The user's own question can
   never come back as something they owe. No recognizable author → dropped.
4. Counterparty and due-signal must appear in the text, else cleared.

Closure is judged by the model against the text, with a quote. **Closure by
semantic resemblance is banned** — cosine matching closed 13 loops, most
wrongly, usually against memories of the very capture that opened the loop,
because a memory restating a request reads like its completion.

Two dedup layers catch different things: a `dedup_key` hash (free, and what makes
dismiss permanent via `ON CONFLICT DO NOTHING`) and semantic dedup on **closure
signatures** at 0.88 (one build failure produced three loops in seven minutes
because the model rephrased it each re-capture). A restatement updates in place,
keeping id, state and age, so a snooze or dismiss survives.

`wakeExpiredSnoozes` runs where loops are offered to the model, not on a timer,
so the wake-up needs no scheduler and cannot drift. `done` maps to
`user_resolved`, deliberately not `auto_resolved`, so F4.5 can measure how often
the user beats the resolver. A loop's age is `capturedAt`, not extraction time —
queued captures drained after a 429 read "just now" for hours-old conversations.

### Capture side

Content-vs-chrome scoring keys on **geometry and focus, never app identity**:
role-based scoring caught Slack's channel list, and `AXWebArea`-based scoring
returned VSCodium's file tree, because tree position does not distinguish
navigation from document. Focus wins outright and takes the **smallest**
focus-bearing region — focus is marked on every enclosing pane, so the outermost
is the sidebar+document blob the scoring exists to split.

`OCRGate` needs both a character floor (200) and a ratio (≥0.25): VSCodium gave
237 content chars against 4787 of chrome — above the floor, but the "content" was
a file-tree fragment. `OCRThrottle` gates twice — `isDue` before any screenshot,
`shouldRecognize` (pixel fingerprint) before Vision — at 15 s per window. M0 ran
OCR every 3 s and failed the CPU gate at 17.65% against <5%.

`SelfOutput.strip` runs before the novelty check: Ghostty exposes its scrollback
via AX, including the `nova-capture` JSON being printed into that same terminal.

stdout is the JSONL wire; **all diagnostics go to stderr**, one `FileHandle.write`
per line. `treeHash` is omitted unless the emitted text is exactly the AX text,
since otherwise it describes a tree that did not produce this record.
`--app <name>` refuses to run with `--emit` (consent, and honesty of the record).

### Config

Provider resolution: **any** of the six `NOVA_CHAT_*`/`NOVA_EMBED_*` vars →
OpenAI-compatible; else `GEMINI_API_KEY` → Gemini; else a provider that returns
an actionable error. Triggering on *any* of the six is deliberate — a half-filled
config is a typo, and falling through would surface it as an auth error from an
unrelated vendor. Chat and embeddings are configured independently.

`.env` currently sets all six `NOVA_*` vars, so the `GEMINI_API_KEY` beside them
is **dead config** — don't infer the provider in use from its presence.

`NOVA_USER_NAME` absent is a *supported* state: both prompts degrade to "identity
not known, return only unambiguous loops". A wrong identity is worse than none —
it inverts every loop silently. `NOVA_USER_ALIASES` resolves handles, without
which a DM's author is unresolvable and its loops are dropped by gate 3.
An identity saved in the Profile pane (`store_metadata.user_identity`,
`identity.ts`) wins over both vars; eval keeps reading the env.

`providerFromEnv` never throws at construction, because `nova mcp` must give
Claude Desktop a tool error rather than a dead connector. `nova start` therefore
*probes* the provider and exits 1 before spawning capture.

## Things that get broken here

1. Opening the store from the shell or any new process. Only the daemon and
   the `nova mcp`/`search`/`status` commands open it.
2. Running the daemon from the repo root instead of `daemon/`.
3. Setting some of the six `NOVA_*` vars and expecting a `GEMINI_API_KEY` fallback.
4. Adding a content-bearing column without `encryptField`, or an equality lookup
   without `lookupDigest`.
5. Binding a raw buffer to a vec0 `int8[]` column — sqlite-vec misreads it as
   float32 whatever the byte length and stores garbage. Use
   `vec_int8(JSON.stringify(...))`.
6. Changing `DIM`, or letting `search.quantize` drift from `pipeline.quantize`.
   They are duplicated deliberately and must stay byte-identical. An existing
   store refuses to open under a different embedding width; there is no
   auto-migration.
7. Relaxing a `parseLoops` gate because the prompt already says it.
8. Writing to stdout from anything reachable by `nova mcp` (JSON-RPC wire) or
   `nova-capture --emit` (JSONL wire). Diagnostics are `console.error`/stderr.
9. Coercing an invalid enum or number at the socket/CLI boundary instead of
   refusing it. An unknown `direction` disabled the filter and returned every
   loop with `ok:true` — `--direction owes_me` printed the unfiltered list as if
   filtered. The bug class is "reported success while doing the default".
10. Dropping a capture, loop, or queue row silently. M0 lost a session to a
    capture path that reported success while producing nothing: every rejection
    carries a reason, every suppression is counted, and the log must be able to
    explain an empty database on its own.
11. Adding a table or column that holds anything derived from a capture
    without adding it to `deleteScope` (`forget.ts`). F5.3 promises a delete
    leaves nothing behind; `test/forget.test.ts` lists the tables it checks.
12. Grepping `.claude/worktrees/` — it holds a stale copy of the same files and
    the hits are misleading.

## Git

Conventional-style subjects (`feat(daemon): …`, `fix(shell): …`), one logical change
per commit. Work on a branch and open a pull request; nothing is pushed to
`main` directly.
