# Changelog

All notable changes to Nova are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Before 1.0, a minor version can
break things.

## [Unreleased]

## [0.1.0] - 2026-10-12

First public release. Build from source; there is no signed download yet.

### Added

- **Capture.** Reads the frontmost window through the Accessibility API every
  3 seconds, separates content from app chrome, skips text it has already
  seen, and falls back to OCR when an app exposes no text.
- **Encrypted memory.** SQLCipher over the whole store, plus AES-256-GCM on
  every field that quotes the screen. Keys are per install, in the Keychain.
- **Extraction.** An AI provider you configure (Gemini, or any
  OpenAI-compatible endpoint, including a local server) turns captures into
  short memories and embeddings for search.
- **Open loops.** Commitments, unanswered questions and things owed to you,
  found per capture and closed when a later capture shows them done. Each loop
  quotes its evidence.
- **MCP server.** `search_memory` and `get_open_loops` for Claude Desktop,
  Claude Code and other MCP clients.
- **Menu-bar app.** Open-loop panel, morning briefing card, and Your Space:
  Activity (what was read and what was sent), Blocked apps, and Your data.
- **Privacy controls.** Banking sites, private browsing and screen sharing are
  refused before capture. A deny-list refuses more. Card and ID numbers are
  redacted; emails and phone numbers stay local.
- **Delete and retention.** Delete by time, by app or everything. Raw capture
  text expires after 7, 30, 90 (default) or 365 days.
- **Reliable queue.** A capture leaves the retry queue only when it succeeds.
  After 8 failures it is parked, never dropped, and can be retried.

[Unreleased]: https://github.com/cybertron288/nova-memory/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/cybertron288/nova-memory/releases/tag/v0.1.0
