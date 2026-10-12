# Decisions

This file defines the decision IDs that code comments and docs cite.

- **R1–R11** are the design decisions taken after the feasibility spikes (M0).
  They set how capture, storage, search and security work.
- **D1–D28** in `deferred-tasks.md` are known problems and later decisions.
  That file is the source for them. They are not repeated here.
- **`architecture.md` §6** has an older table that also uses D1–D9. Those IDs
  collide with `deferred-tasks.md`. They are defined at the end of this file
  as "Architecture table D1–D9". When a comment says "D4" next to the
  summarization spike or the extraction model, it means the architecture
  table.

Each entry gives the decision, why it was taken, and where it stands now when
the code has moved on from the original text.

---

## R1 — Native Swift shell, Swift capture helper, TypeScript daemon

**Decision.** Nova runs as three processes. The menu bar app (`shell/`) and the
capture helper (`capture/`) are native Swift. The daemon (`daemon/`) is a Bun
and TypeScript process. Only the daemon opens the store or holds the keys. The
shell talks to it only over the control socket.

**Why.** The capture APIs (Accessibility, ScreenCaptureKit, Vision) are Swift
APIs, but they do not force the whole app to be native: a spawned helper can
reach them. The daemon holds the logic that benefits from TypeScript (search,
extraction, the MCP SDK). The shell is a thin socket client, so it can be
native without reimplementing any of that logic.

### R1a — The shell is native, not Electron

**Decision.** R1 first chose an Electron shell around the Swift helpers. R1a
replaced it with a native Swift shell. The capture helper and the daemon did
not change.

**Why.** The case for Electron was reuse of the TypeScript code. That reason
lapsed once the daemon became a standalone process: the shell reuses none of
that code in either language. A native app is about 10 MB against about
150 MB, and the menu bar, popover and notifications are native primitives.
The cost is that there is no cross-platform path. Nova is macOS only.

---

## R2 — Accessibility first, OCR only as a gated fallback

**Decision.** Capture reads the frontmost window through the Accessibility
(AX) API. It separates content from app chrome by geometry and focus, never by
app identity. OCR (Vision) runs only when `OCRGate` judges the AX text
unreadable. It is throttled to once per 15 s per window and skipped when the
pixels have not changed.

**Why.** OCR on every 3 s sample cost 17.65% CPU against a budget under 5%.
AX-only capture measured well under 1%. The first version of R2 dropped OCR
and planned per-app parsers. Some apps expose no AX text at all (D8), so a
generic, throttled OCR fallback replaced the per-app plan.

---

## R3 — Three-level deduplication

**Decision.** A capture must pass three checks before it becomes a new
version: the AX tree hash (chrome-only changes), the content hash, and a
message fingerprint taken after collapsing relative timestamps. The capture
helper also applies a Jaccard novelty check (0.85) before it emits.

**Why.** Without timestamp collapsing, "3 minutes ago" becoming "8 minutes
ago" makes an unchanged conversation look new on every tick. Each layer stops
a different kind of repeat, at a different cost.

**Not built from the original R3.** R3 also called for click-event triggers
and meeting detection by microphone ownership. Capture samples every 3 s
instead, and audio capture is not built (see `features.md`, F1.3).

---

## R4 — Threads, versions and derivatives

**Decision.** The store has three levels. A **thread** is one source identity
(a chat, a document, a page). A **version** is an hour-bucketed snapshot of
that thread. A **derivative** is one atomic fact extracted from a version by
the model. Derivatives are the retrieval unit.

**Why.** Raw screen text is long, repetitive and hard to rank. Short atomic
facts embed well and can each cite the version they came from.

---

## R5 — Embedding storage: int8 index plus float32 sidecar

**Decision.** Embeddings are 1536-dimensional. Each derivative vector is
stored twice: int8-quantized in the scanned `sqlite-vec` index, and float32 in
a sidecar used only to rescore candidates. IDs are UUIDv7, so ID order is
time order. Versions carry hour and day buckets for timeline grouping.

**Why.** A float32 index over 120k rows measured a 21 s p95. The int8 scan
plus an exact float rescore stays under 100 ms with no measured loss of
recall. `DIM` and the quantizer are duplicated in `search.ts` and
`pipeline.ts` and must stay identical.

---

## R6 — No keyword index; vector search with exact rescore

**Decision.** There is no FTS5 or BM25 index. Search runs an int8 KNN that
over-fetches candidates (`OVER_FETCH = 500`), rescores them with the exact
float32 vectors, decrypts the winners, and reranks in memory with recency as
a hard filter. If keyword recall is ever needed, it must be an encrypted
keyword index.

**Why.** A keyword index cannot work over ciphertext, and a plaintext index
beside an encrypted database would defeat the encryption. The over-fetch was
first set to 50 from synthetic vectors. On real embeddings 50 recovered 68%
of the true top 10, and 500 recovered all of them. The value is a fraction of
the corpus, not a fixed depth, so it must be re-measured as the corpus grows
(`daemon/bench/vector-precision.ts`).

---

## R7 — Entity, fact and open-loop graph as a layer

**Decision.** Nova keeps a graph of entities, facts and open loops. It is
built from derivatives, with pointers to its evidence. It is additive: the
thread, version and derivative model does not depend on it.

**Why.** Open loops and entity questions ("what do I owe Dana Reyes?") need
structure that a flat list of facts does not give.

**Status.** Open loops are built. Entities and facts are not (D11). The
design is `entity-graph-design.md`.

---

## R8 — Security requirements

**Decision.** The following are requirements, not options.

1. **Field key.** Per install, 32 random bytes, held in the macOS Keychain.
   Never a constant in the source.
2. **Database key.** Per install, random, held in the Keychain. Never derived
   from machine facts such as the user name or home directory, which can
   change and would lock the user out of their own store.
3. **Source metadata is encrypted.** Window titles and URLs are encrypted per
   field. Thread identity is an HMAC digest, never the plain value.
4. **Tokens live in the Keychain.** Any auth token, if Nova ever has one, is
   stored in the Keychain and nowhere else.
5. **Captured text is untrusted.** It is never rendered as markup.
6. **No unauthenticated local endpoint.** Any MCP or control endpoint that
   another local process can reach must be authenticated. Today MCP runs over
   stdio and the control socket is a `0600` Unix socket, so no network port
   is open.
7. **Short-lived, scoped tokens.** Any future token carries an issuer and an
   audience and expires quickly.
8. **Never wipe the store.** An unreadable store is reported, never deleted.
   Nothing in the code deletes an unreadable store. A quarantine-and-report
   step is not built.
9. **Clean bundles.** No backup files or stray binaries inside a signed
   bundle.
10. **Narrow control surface.** The shell reaches the daemon only through
    named control-socket operations, never a general RPC or a store handle.

**Why.** Nova holds a record of what the user saw on screen. Each item closes
a specific way that record could leak, be stolen by another local process, or
be lost.

---

## R9 — MCP tools return provenance

**Decision.** Every MCP result carries where it came from: the time, the
source app, and the window title or URL. The planned tool set is
`search_memory`, `get_timeline`, `get_open_loops`, `get_entity` and
`get_daily_summary`. Any MCP transport that listens on a port needs a
per-install token (R8 item 6).

**Why.** The model must be able to cite a memory, and the user must be able
to check it.

**Status.** `search_memory` and `get_open_loops` are built, over stdio. The
other three are not (see `features.md`, F3.3).

---

## R10 — Transparency and openness are requirements

**Decision.** The user can see what Nova read from the screen and every call
it made to a provider, as metadata. The code is open source under AGPL-3.0.
Any server component Nova ever needs must be open source and self-hostable.

**Why.** Nova asks for broad access to the screen. That is only reasonable if
the user can audit what it did with that access, and if every claim about it
can be checked in the code.

**Status.** The transparency view is built (Your Space → Activity, D22). Nova
has no server component today (D28): it calls the provider the user
configures, directly.

---

## R11 — Extraction uses a cloud model the user configures

**Decision.** Memory and loop extraction use a cloud chat model through the
provider the user configures. On-device models stay an experiment.

**Why.** In the M0 spike a cloud model met the quality rubric on every
sample. A small local model was about five times slower and scored lower. The
on-device path for embeddings is planned in `local-embeddings-experiment.md`.

---

## Architecture table D1–D9

These IDs come from the table in `architecture.md` §6. They predate
`deferred-tasks.md` and collide with its D1–D9.

| ID | Decision | Status |
|---|---|---|
| D1 | Native Swift shell and Swift capture helper | Decided. See R1 and R1a. |
| D2 | One SQLCipher file with `sqlite-vec`; no FTS5; int8 index plus float sidecar | Decided. See R5 and R6. |
| D3 | Cloud embeddings first; on-device embeddings as an experiment | Decided. The experiment is planned in `local-embeddings-experiment.md`. |
| D4 | Extraction model: cloud versus on-device | Decided for cloud. See R11. The M0 spike report is `spikes/reports/summarize.md`. |
| D5 | End-to-end encryption for a remote MCP endpoint | Deferred. No remote endpoint exists. Any future one must not let a server read memory content. |
| D6 | Self-hostable server components | The requirement stands (R10). No server component exists today (D28). |
| D7 | License | Decided: AGPL-3.0 for the whole repository. |
| D8 | Payments | Not planned for the open-source app. |
| D9 | Menu bar panel layout: digest first, single scroll | Decided, then narrowed. D19 removed the search and timeline sections. D22 moved transparency to its own window. |
