# Troubleshooting

Run every command on this page from the `daemon/` directory of your clone,
unless it says otherwise.

## Start with the log

Nova's daemon writes to `~/Library/Logs/Nova/daemon.log`. Read it with color
and follow new lines:

```sh
bun src/cli.ts logs                    # last 50 lines, then follow
bun src/cli.ts logs -n 200             # more history
bun src/cli.ts logs --tag capture      # one subsystem: capture, ingest, pipeline, nova
bun src/cli.ts logs | grep -E "error|failed|dropped"
```

Control-C stops reading the log. It does not stop Nova.

Markers: `●` capture, `▸` ingest, `◆` pipeline, `■` daemon, `✗` failure,
`⚠` rate limit or dropped line, `✓` recovery.

Then check the counts:

```sh
bun src/cli.ts status
```

`threads` and `versions` grow when capture works. `derivatives` and `embedded`
grow when your provider works.

## Nova is not running

**The panel says "Nova isn't running", or the menu says "Not running ·
restarting…".**
No daemon answers on the control socket. The app restarts the daemon
automatically: after 1 second, then with longer waits up to 60 seconds. Wait a
moment, then read the log.

**The menu says "Stopped restarting".**
The daemon failed 10 times in a row. The next line in the menu is the
daemon's last output, which usually names the cause. Fix the cause, then
choose **Restart Nova**. The common causes are below.

**The menu says "Can't start: bun not found".**
The app looks for Bun at `~/.bun/bin/bun`, `/opt/homebrew/bin/bun` and
`/usr/local/bin/bun`. It does not use your shell's `PATH`. Install Bun in one of
those places.

**The menu says "Can't start: daemon source not found".**
The app finds the daemon by walking up from its own location to
`daemon/src/cli.ts`. Run the app from `build/Nova.app` inside your clone. A
copy in `/Applications` cannot find it.

**`already running (pid …). Use --force to take over.`**
You started a second daemon. Only one may run. Use the one already running,
or run `bun src/cli.ts start --force` to replace it.

## Provider errors

**`No inference provider is configured.`**
The daemon found no provider settings. Check that `.env` exists at the
repository root and holds `GEMINI_API_KEY` or all six `NOVA_*` variables. See
[providers.md](providers.md).

If `.env` is filled in and you still see this, the daemon is not running from
`daemon/`. Bun loads `.env` from the current directory, and `daemon/.env` is a
symlink to the root `.env`. Check:

```sh
ls -l daemon/.env     # from the repository root; should point to ../.env
```

If you start the daemon by hand, run it from `daemon/`:
`cd daemon && bun src/cli.ts start`. Running `bun daemon/src/cli.ts start`
from the root loads no keys.

For an MCP client, use `bun --cwd <repo>/daemon src/cli.ts mcp`, or put the
variables in the client's `env` block.

**`Incomplete OpenAI-compatible configuration: … not set.`**
You set some of the six `NOVA_CHAT_*` and `NOVA_EMBED_*` variables but not all.
Setting any of them selects option B, which needs all six. Nova does not fall
back to `GEMINI_API_KEY`. Set the missing ones, or remove all six.

**`NOVA_EMBED_DIM=… is not supported`.**
Only 1536 is supported. Remove the variable or set it to 1536.

**`returned a N-dim vector, expected 1536`.**
Your embedding model does not output 1536 dimensions. Choose one that does.
See [providers.md](providers.md#the-1536-dimension-rule).

**`This store was indexed with N-dimension embeddings…`.**
The store was created with a different embedding width. Restore that model,
or start a new store. See [providers.md](providers.md#the-store-is-locked-to-its-width).

**HTTP 401 or 403.**
The API key is wrong, expired, or not allowed to use that model. The error
names which side failed: `chat` or `embed`.

After you change `.env`, restart the daemon: `pkill -f "cli.ts start"`. The
app starts it again within a second.

## Rate limits and quota (HTTP 429)

The log shows `⚠ … quota exhausted; pausing all provider calls for …`.

Your provider refused because of a rate limit or a spent quota. Nova pauses
all provider calls, chat and embeddings together, and tries again later.
Captures keep being stored and wait in the queue. Waiting does not use up
retry attempts. Nothing is lost.

If it happens often, raise your provider limit, choose a cheaper model, or
pause capture for a while. See [providers.md](providers.md#cost).

## Parked captures

If a capture fails 8 times for a reason other than a rate limit or a network
outage, Nova stops trying and **parks** it. Parked captures are kept, never
deleted. `status` shows them as `parked`, and the Activity view in Your Space
shows a banner.

To see the errors and try again:

```sh
bun src/cli.ts retry
```

It lists each parked capture with its last error, then queues them again. The
next run, within 15 seconds, picks them up. You can also use the banner in
Activity. Fix the cause first, or they park again.

## Permissions

**Capture records nothing, and the log shows `AXError -25211`.**
The process that reads the screen has no Accessibility permission. Open
System Settings → Privacy & Security → Accessibility and turn on **Nova**.

If you started the daemon in a terminal, it reads the screen with the
terminal's permission, not Nova's. Either give your terminal Accessibility,
or let the app run the daemon.

**The permission is on, but capture still records nothing.**
Make sure you launched the app with `open build/Nova.app` or
`scripts/build-app.sh --run`. Running the binary inside the bundle from a
terminal charges the permission to the terminal.

**The permission disappears after a rebuild.**
macOS ties the permission to the code signature. The build signs with the
"Nova Dev" identity in your login keychain. If that identity was deleted or
duplicated, the signature changes. Check with
`security find-identity -p codesigning | grep "Nova Dev"`. There must be
exactly one. Then turn Nova off and on again in the Accessibility list.

**`OCR needs Screen Recording for Nova`.**
A window exposes no text, and Nova has no Screen Recording permission for the
OCR fallback. Grant it in System Settings → Privacy & Security → Screen
Recording, then quit Nova and open it again. Without it, Nova still captures
apps that expose text.

## Capture problems

**One app captures nothing.**
Some apps expose no text to the accessibility API. If you granted Screen
Recording, the OCR fallback reads them. Check what capture sees, from the
repository root:

```sh
swift build --package-path capture
capture/.build/debug/nova-capture --dump --app "App Name"
```

`axContentChars: 0` means the app exposes no readable content. This command
runs under your terminal's Accessibility permission, not Nova's.

**A window is never captured.**
It may be refused on purpose: password managers, banking sites, private
browsing, screen sharing, or your own deny-list. See
[privacy.md](privacy.md). Check your deny-list with
`bun src/cli.ts exclusions`.

**Nothing is captured, and the menu says Paused.**
Choose **Resume capturing** from the menu, or run `bun src/cli.ts resume`.

**`[ingest] write failed … dropped line: write-failed`.**
A capture could not be written and was lost. The text after `write failed`
names the cause.

## Store and keychain

**`keychain: cannot read key for …`.**
Your login keychain is locked, or access was denied. Unlock it and restart the
daemon. Nova does not create a new key in this case, because a new key would
make the existing store unreadable.

**`sqlite3` cannot open `memory.db`.**
This is expected. The store is encrypted with SQLCipher. Use the CLI or the
app.

**The daemon cannot load SQLCipher.**
Run `brew install sqlcipher`. If Homebrew is not in `/opt/homebrew` or
`/usr/local`, set `NOVA_SQLCIPHER` in `.env` to the full path of
`libsqlcipher.dylib`.

## MCP

**The AI app shows no Nova tools.**
Check the `command` path. Use the absolute path to Bun (`which bun`), because
apps opened from the Finder do not see your shell's `PATH`. Restart the AI app
after you edit its configuration.

**A tool returns "No inference provider is configured".**
The MCP server started, but it found no provider settings. Use
`--cwd <repo>/daemon` so it loads `.env`, or add the variables to the client's
`env` block.

**`search_memory` fails, but `get_open_loops` works.**
Search needs your embedding provider to embed the query. Loops do not. Check
your provider settings and quota.

## Still stuck

Open an issue with:

- your macOS version and Mac type (Apple silicon or Intel)
- the output of `bun src/cli.ts status`
- the relevant lines from `bun src/cli.ts logs -n 200`

**Read the log lines before you paste them.** The log names your open loops in
plain text. Remove anything private.
