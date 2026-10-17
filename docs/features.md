# Features

This file defines the feature IDs (F1–F7) that code comments and docs cite.
Each line gives the feature and its status, checked against the code in
`daemon/src`, `shell/Sources` and `capture/Sources`.

- **built** — works today.
- **partial** — part of it works. The line says which part.
- **not built** — no code yet.
- **not planned** — out of scope for the open-source app.

Decision IDs (R, D) are defined in `decisions.md` and `deferred-tasks.md`.
Milestones (M) are in `roadmap.md`.

---

## F1 — Ambient capture

| ID | Feature | Status |
|---|---|---|
| F1.1 | Read on-screen text from the frontmost window through Accessibility, with OCR as a gated fallback (R2). | built |
| F1.2 | Record source metadata with each capture: app name, bundle id, window title, and URL for browsers. | built |
| F1.3 | Detect meetings and capture microphone and system audio. | not built — proven only in an M0 spike |
| F1.4 | Drop repeated captures: chrome-only changes, unchanged text, and moving relative timestamps (R3). | built |
| F1.5 | Stop capturing when the user is idle or the display is asleep. | not built — capture samples every 3 s; deduplication keeps repeats out of the store |
| F1.6 | Keep capturing offline and process the queue when the network returns. | partial — an unreachable provider spends no retry attempt; there is no offline detection or offline status |
| F1.7 | Clipboard capture, opt-in. | not built |

## F2 — Memory engine

| ID | Feature | Status |
|---|---|---|
| F2.1 | Turn captures into threads, versions and derivatives (R4), plus a graph of entities, facts and loops (R7). | partial — threads, versions, derivatives and loops are built; entities and facts are not (D11) |
| F2.2 | Vector search: int8 KNN, exact float rescore, decrypt, rerank by recency (R5, R6). | built |
| F2.3 | Encrypt everything at rest: SQLCipher for the file plus AES-256-GCM per field, with per-install keys in the Keychain (R8). | built |
| F2.4 | Measure retrieval quality on a public long-term-memory benchmark. | not built |
| F2.5 | Nightly consolidation: merge duplicate facts, decay stale ones, write daily summaries. | not built |
| F2.6 | Storage cap with oldest-first eviction. | not built — retention (F5.4) is the only size control |

## F3 — MCP connector

| ID | Feature | Status |
|---|---|---|
| F3.1 | Local MCP server for desktop clients. | partial — stdio only; there is no HTTP transport |
| F3.2 | Remote MCP endpoint for web and mobile clients. | not built |
| F3.3 | MCP tools: `search_memory`, `get_timeline`, `get_open_loops`, `get_entity`, `get_daily_summary`. | partial — `search_memory`, `get_open_loops` and `get_timeline` |
| F3.4 | Every result carries provenance: time, source app, and window title or URL (R9). | built |
| F3.5 | In-app setup instructions for MCP clients, with copy buttons. | not built |

## F4 — Open loops

| ID | Feature | Status |
|---|---|---|
| F4.1 | Find open loops: commitments made, commitments received, unanswered questions, stalled threads. Each has a description, counterparty, evidence, due signal and state. | built |
| F4.2 | Close a loop when a later capture shows it was done, quoting the evidence. | built |
| F4.3 | Morning digest of the top open loops. | partial — the in-app digest card is built; the macOS notification is not |
| F4.4 | Act on a loop: done, snooze, dismiss. | built — panel keys, CLI and control socket |
| F4.4a | Open the source a loop came from. | deferred (D23) — cannot yet land on the right message in every app |
| F4.5 | Precision over recall: the user rates loops real or not, and Nova reports the share rated real. | built — `rate_loop` and `nova precision` |

## F5 — Privacy and controls

| ID | Feature | Status |
|---|---|---|
| F5.1 | Choose which apps Nova reads before capture starts, with hard exclusions that cannot be turned off. | partial — hard exclusions (password managers, banking, private browsing, screen sharing) and the user's own block list are built; the first-run choice is not |
| F5.2 | Pause and resume from the menu bar; never read private browsing or a live screen share. | built |
| F5.3 | Delete memories by time range, by app, or all. Immediate and irreversible. | built — Your Space → Your data, and `nova forget` |
| F5.4 | Retention policy for raw captures and for memories. | built — a daily sweep applies it |
| F5.5 | Transparency: what was read from the screen and every provider call, as metadata. | built — Your Space → Activity (D22) |
| F5.6 | No user content in logs, analytics or crash reports. Telemetry opt-in and metadata only. | partial — there is no telemetry; the local daemon log names loops in plain text and is kept at mode `0600` |

## F6 — App shell and setup

| ID | Feature | Status |
|---|---|---|
| F6.1 | Menu bar app with no Dock icon: status glyph, quick actions, loop panel. | built |
| F6.2 | First-run onboarding: permissions, capture policy, provider setup, MCP connection. | not built |
| F6.3 | Launch at login, automatic updates, signed and notarized build. | not built — the app is signed for local development only |
| F6.4 | Accounts and billing. | not planned for the open-source app |
| F6.5 | Self-hosted server components. | not planned — Nova has no server component (D28) |
| F6.6 | Open source: public repository, AGPL-3.0, contribution guide. | partial — license and community files are in place; the repository is being prepared for release |

## F7 — Shared memory between people

| ID | Feature | Status |
|---|---|---|
| F7 | Two people agree to share scoped memory with each other, and query it through MCP. | not built — not scheduled |
