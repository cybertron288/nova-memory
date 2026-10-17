# Install Nova

Nova is built from source. There is no signed or notarized download yet. You
clone the repository, build the app on your own Mac, and run it from the
clone.

## Requirements

- macOS 14 (Sonoma) or later, on Apple silicon or Intel.
- Xcode command line tools with Swift 6. Install them with
  `xcode-select --install`. Check with `swift --version`.
- [Bun](https://bun.sh) 1.3 or later. Check with `bun --version`.
- SQLCipher, from Homebrew: `brew install sqlcipher`. Nova looks for it in
  `/opt/homebrew/opt/sqlcipher` (Apple silicon) and `/usr/local/opt/sqlcipher`
  (Intel). Set `NOVA_SQLCIPHER` to the `.dylib` path if yours is elsewhere.
- An AI provider for extraction and embeddings. See
  [providers.md](providers.md). You can use a hosted API or a local server.

## 1. Clone

```sh
git clone https://github.com/cybertron288/nova-memory.git
cd nova-memory
```

The rest of this guide calls this directory `<repo>`.

## 2. Configure a provider

```sh
cp .env.example .env
```

Open `.env` and fill in one provider option:

- **Option A:** set `GEMINI_API_KEY`.
- **Option B:** set all six `NOVA_CHAT_*` and `NOVA_EMBED_*` variables.

Then set your name, and any other names or handles people use for you, in
Your Space → Profile once the app is running. Nova uses these to tell what you
owe from what others owe you. Without them, Nova keeps only the open loops
whose direction the text makes plain. `NOVA_USER_NAME` and `NOVA_USER_ALIASES`
in `.env` also work, and the Profile pane overrides them.

`.env` lives at the repository root. `daemon/.env` is a symlink to it, because
Bun loads `.env` from the directory it runs in. Never commit `.env`.

[providers.md](providers.md) explains both options and the embedding size rule.

## 3. Install the daemon's dependencies

```sh
cd daemon && bun install
```

## 4. Build and launch the app

From `<repo>`:

```sh
scripts/build-app.sh --run
```

This builds the capture tool and the menu bar app, assembles them as
`build/Nova.app`, signs the bundle, and opens it.

The first time, the script creates a self-signed code-signing identity named
"Nova Dev" in your login keychain. macOS ties an Accessibility grant to the
app's code signature. An unsigned or ad-hoc signed app gets a new identity on
every build, and macOS then silently drops the grant. A stable local identity
keeps your grant across rebuilds. The identity is valid only on your Mac and
is not trusted by anyone else.

Nova has no Dock icon. Look for an aperture glyph in the menu bar. Click it,
or press Control-Option (⌃⌥) from any app, to open the panel.

Always launch Nova with `open build/Nova.app` or `scripts/build-app.sh --run`.
If you run the binary inside the bundle from a terminal, macOS charges the
Accessibility grant to the terminal, not to Nova.

Keep the app in `build/`. Do not copy it to `/Applications`. The app finds the
daemon by walking up from its own location to `daemon/src/cli.ts`, so a copy
outside the clone cannot start it.

Nova does not start at login on its own. To start it at login, add
`build/Nova.app` in System Settings → General → Login Items.

## 5. Grant permissions

Nova asks for two permissions. Grant them to **Nova**, not to your terminal.

| Permission | Required | What Nova uses it for |
|---|---|---|
| Accessibility | Yes | Reading the text of the frontmost window through the macOS accessibility API, every 3 seconds. Also the ⌃⌥ shortcut. |
| Screen Recording | No | The OCR fallback. When a window exposes no readable text (some terminals and editors), Nova takes a screenshot of that window and reads it with Apple's on-device Vision text recognition. The screenshot stays in memory and is never saved. |

The first launch asks for Accessibility. Turn on Nova in System Settings →
Privacy & Security → Accessibility.

Nova asks for Screen Recording the first time it meets a window it cannot read
through Accessibility. After you grant it, quit Nova and open it again, so
capture restarts with the new permission. Until then, capture is
Accessibility-only. Without Screen Recording, Nova works, but it skips windows
that expose no text.

## 6. Check that it works

Use any app for a minute, then run, from `<repo>/daemon`:

```sh
bun src/cli.ts status
```

It prints counts:

```
threads     12
versions    31
derivatives 40
embedded    40
queued      0
parked      0
```

- `threads` and `versions` grow when capture works.
- `derivatives` and `embedded` grow when your provider works. Extraction runs
  every 15 seconds.
- `queued` is work waiting for the provider. `parked` is work that failed 8
  times. See [troubleshooting.md](troubleshooting.md).

You can also open the menu → **Your Space** → **Activity** to see what Nova
read from your screen and what it sent to your provider.

If the counts stay at zero, see [troubleshooting.md](troubleshooting.md).

## 7. Connect an AI app over MCP

Nova serves three tools over MCP: `search_memory`, `get_open_loops` and
`get_timeline`. The MCP
server is the same CLI, started with `mcp`. It reads the store directly, so it
works whether or not the menu bar app is running. `search_memory` needs your
provider, because it embeds the query. `get_open_loops` and `get_timeline` work
offline.

Use the absolute path to Bun. Apps opened from the Finder do not see your
shell's `PATH`. Find it with `which bun`. It is usually
`~/.bun/bin/bun` or `/opt/homebrew/bin/bun`.

`--cwd` makes Bun run from `daemon/`, so it loads your `.env`.

### Claude Code

```sh
claude mcp add nova -s user -- /Users/you/.bun/bin/bun --cwd <repo>/daemon src/cli.ts mcp
```

Check it with `claude mcp list`.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nova": {
      "command": "/Users/you/.bun/bin/bun",
      "args": ["--cwd", "/Users/you/code/nova-memory/daemon", "src/cli.ts", "mcp"]
    }
  }
}
```

Replace both paths with your own. Then quit and reopen Claude Desktop.

If the provider is not configured, the server still starts, and each tool call
returns an error that names the missing setting. You can also put the provider
variables in an `"env"` block in this config instead of relying on `.env`.

Other MCP clients work the same way: run `bun --cwd <repo>/daemon src/cli.ts
mcp` over stdio.

## Update

```sh
cd <repo>
git pull
cd daemon && bun install && cd ..
scripts/build-app.sh --run
```

What you need to restart depends on what changed:

| Changed | Do |
|---|---|
| `capture/` or `shell/` | `scripts/build-app.sh --run` |
| `daemon/` only | Restart the daemon: `pkill -f "cli.ts start"`. The app starts it again within a second. |

The daemon is not inside the app bundle. The app runs it from `daemon/` in
your clone with Bun. This is why a daemon change needs no rebuild, and why
**you must not move or delete the clone** while you use Nova.

## Next

- [privacy.md](privacy.md): what Nova reads, stores and sends.
- [providers.md](providers.md): provider options.
- [faq.md](faq.md) and [troubleshooting.md](troubleshooting.md).
- [uninstall.md](uninstall.md): remove Nova and its data.
