# Roadmap

Milestones are cited in code and docs as M0–M5. Feature IDs (F) are in
`features.md`. Decision IDs (R, D) are in `decisions.md` and
`deferred-tasks.md`. Nothing here is a promise of a date.

## Milestones

**M0 — Feasibility spikes. Done.**
Four spikes tested the riskiest parts: screen capture through Accessibility,
audio capture, encrypted vector search, and cloud versus local extraction.
Their results set decisions R1–R11. Reports are in `spikes/reports/`.

**M1 — Capture, memory and local MCP. Done.**
The daemon captures the frontmost window, stores it encrypted, extracts
memories, and serves `search_memory` to MCP clients over stdio. Vector
precision was re-measured on real embeddings at the end of M1 (D6).

**M2 — Open loops and the app. In progress.**
Built: loop extraction, auto-resolution, done/snooze/dismiss, precision
rating, the digest card, offline handling, the menu bar app, and Your Space (Activity, Blocked
apps, Permissions, Profile, Your data). Remaining work is listed under
"Next".

**M3 — Wider release. Not started.**
A signed build that people other than developers can install, the remaining
MCP tools (F3.3), and the entity and fact graph (D11).

**M4 and M5 — Later.**
M4 holds experiments after release, such as local embeddings. M5 is shared
memory between people (F7). Neither is scheduled.

## Next

- **Digest notification.** One macOS notification when the morning digest
  has loops, none when it has not (F4.3).
- **Nightly consolidation.** Merge duplicate facts, decay stale ones, and
  write a daily summary. Adds `get_daily_summary` (F2.5, F3.3).
- **Onboarding.** A first-run window: permissions, capture policy, provider
  setup with keys in the Keychain, and MCP setup. Capture starts only when it
  is finished (F5.1, F6.2, F3.5).
- **Signed and notarized build.** Developer ID signing, the daemon inside the
  bundle, launch at login, and automatic updates (F6.3, D27).
- **Local embeddings.** Run an open-weight embedding model on the Mac so
  memory text and search queries are not sent out for embedding. Planned in
  `local-embeddings-experiment.md`; gated on retrieval quality.
