# Contributing to Nova

Thank you for helping. Nova reads people's screens, so the bar for privacy and
correctness is high. Please read this page before you open a pull request.

## Before you start

- **Bugs:** open an issue with the bug template. Never paste captured content,
  logs that name real people, or your `.env`.
- **Security problems:** do not open a public issue. Follow
  [SECURITY.md](SECURITY.md).
- **Features:** open an issue first and describe the problem, so we can agree on
  the shape before you write code. Check [docs/roadmap.md](docs/roadmap.md) and
  [docs/deferred-tasks.md](docs/deferred-tasks.md) first. Many ideas already
  have a recorded decision.

## Set up

Follow [docs/install.md](docs/install.md). In short:

```sh
brew install sqlcipher
cp .env.example .env            # add a provider key
cd daemon && bun install
cd .. && scripts/build-app.sh --run
```

Read [docs/architecture.md](docs/architecture.md) before you change the
daemon. [CLAUDE.md](CLAUDE.md) is the condensed version that AI coding agents
read; it is also a good map for people.

## Project layout

| Directory | Language | What it is |
|---|---|---|
| `capture/` | Swift | `nova-capture`: reads the frontmost window and prints one JSON line per capture |
| `daemon/` | TypeScript (Bun) | `nova`: the encrypted store, extraction, loops, MCP server and control socket |
| `shell/` | Swift (SwiftUI/AppKit) | `NovaShell`: the menu-bar app; it supervises the daemon |
| `docs/` | Markdown | Architecture, data model, decisions, design specs |
| `spikes/` | mixed | Early feasibility experiments. Kept for reference; not part of the app |

## Run the tests

```sh
cd daemon && bun test                 # all daemon tests
cd daemon && bun test test/loops.test.ts -t "restatement"   # one test by name
cd daemon && bun run typecheck
swift test --package-path capture
swift test --package-path shell
```

The Swift packages use **Swift Testing** (`@Test`, `#expect`), not XCTest.

Daemon tests use the Keychain service `dev.nova.keys.test`, so they never touch
the keys of your real store. They need SQLCipher installed. No test calls a
paid API.

## Rules that keep Nova correct

These come from real bugs. A pull request that breaks one will be asked to
change.

1. **Only the daemon side opens the store**: the daemon and the `nova mcp`,
   `search` and `status` commands. The shell and everything else go through
   the control socket.
2. **Run the daemon from `daemon/`.** Bun loads `.env` from the working
   directory.
3. **Encrypt every column that quotes the screen** with `encryptField`. Use
   `lookupDigest` for equality lookups. Never store a URL or title in the clear.
4. **Never write to stdout** from code reachable by `nova mcp` or
   `nova-capture --emit`. stdout is the wire protocol. Diagnostics go to stderr.
5. **Refuse invalid input at the boundary.** Never coerce an unknown enum or
   number into a default.
6. **Never drop a capture, loop or queue row silently.** Every rejection
   carries a reason that the log can explain.
7. **New tables or columns derived from a capture** must be added to
   `deleteScope` in `daemon/src/forget.ts`, and to the table list in
   `daemon/test/forget.test.ts`.
8. **Do not relax a loop-extraction gate** in `parseLoops` because the prompt
   already says it. The model breaks prompt rules at temperature 0.

The full list, with the reason for each rule, is in
[docs/architecture.md](docs/architecture.md) and [CLAUDE.md](CLAUDE.md).

## Changing prompts

Prompt changes must be measured before they are kept:

```sh
cd daemon
bun eval/run.ts <name>     # calls the live provider and COSTS MONEY
bun eval/score.ts <name>   # re-scores saved runs for free
```

Eval fixtures hold real captured content, so they are gitignored
(`daemon/eval/**/*.local.json`). Never commit them. Include the before and
after scores in your pull request.

## Code style

- Match the code around you: naming, comment density, idiom.
- Comments explain **why**, especially when the obvious approach was tried and
  failed. Do not narrate what the code does.
- TypeScript: `strict` is on. Prefer real types to casts in `src/`.
- Swift: `capture/` builds with Swift 6 tools; `shell/` with Swift 5.9 tools.
- UI changes must follow [docs/design/design-system.md](docs/design/design-system.md)
  and use the motion tokens in [docs/design/motion-spec.md](docs/design/motion-spec.md).
  Include a screenshot or short recording in the pull request.

## Commits and pull requests

- One logical change per commit. Use a short conventional subject:
  `feat(daemon): …`, `fix(shell): …`, `docs: …`, `test(capture): …`.
- Work on a branch and open a pull request against `main`.
- The pull request explains what changed, why, and how you verified it.
- Run the tests and type check before you push.
- Use fictional people in tests and examples (Alex, Dana, Jordan, Sam, Lee).
  Never real names, real messages or real account names.

## License

Nova is licensed under the [GNU AGPL v3](LICENSE). By contributing, you agree
that your contribution is licensed under the same terms.
