# Frequently asked questions

## Does Nova record audio, my camera or my keystrokes?

No. Nova reads the text of the frontmost window, and nothing else. It does not
use the microphone, the camera, keystrokes or the clipboard. It never reads
password fields.

If you grant Screen Recording, Nova takes a screenshot of a window only when
that window exposes no text. Apple's on-device text recognition reads it, and
the screenshot is discarded. It is never saved or sent.

## Is anything sent to the Nova authors?

No. Nova has no server, no account, no telemetry and no crash reporting. Your
content goes only to the AI provider endpoints you configure. See
[privacy.md](privacy.md).

## What does go over the network?

Captured text goes to your chat endpoint, to extract facts and open loops.
Extracted facts and search queries go to your embedding endpoint. Once a day,
your open loops and yesterday's facts go to the chat endpoint for the morning
briefing. Email addresses and phone numbers are replaced before sending.
[privacy.md](privacy.md#what-goes-to-your-provider) has the full list.

To see each call, open the menu → **Your Space** → **Activity** → **Sent to
your provider**.

## Does Nova work offline?

Partly, with a hosted provider:

- Capture keeps running and stores what it reads.
- Extraction waits. Captures wait in the queue and are processed when the
  network returns. A network outage does not count as a failed attempt.
- `get_open_loops` and `get_timeline` over MCP work offline. `search_memory`
  does not, because it must embed your query.

With a local model server for both chat and embeddings, Nova works fully
offline. See [providers.md](providers.md#local-models).

## Can I use a local model?

Yes. Point both `NOVA_CHAT_*` and `NOVA_EMBED_*` at an OpenAI-compatible server
on your Mac, such as Ollama or LM Studio. Then no captured content leaves your
Mac.

The embedding model must output 1536 dimensions. Many local embedding models
do not. See [providers.md](providers.md#local-models).

## How much does it cost?

Nova is free and open source. Your AI provider bills you for the calls Nova
makes with your key. The cost depends on your provider, your models, and how
much changes on your screen each day. Nova skips text it has already seen and
sends only the new part of a capture for facts.

To keep cost under control:

- Watch the call counts in **Your Space** → **Activity**, or run
  `bun src/cli.ts calls` from `daemon/`.
- Set a spending limit with your provider.
- Choose a small model, or a local server, which costs nothing per call.
- Pause or quit Nova when you do not need it.

See [providers.md](providers.md#cost).

## Which apps and sites does Nova skip?

Nova never stores anything from:

- password managers and browser password pages
- banking and payment sites
- private browsing windows
- screen sharing and meeting apps

These are built in. You cannot turn them off.

You can add your own apps and sites in **Your Space** → **Blocked apps**, or
with `bun src/cli.ts exclude --app "Name"` or `--domain example.com`.

Nova also does not look for open loops in AI assistant chats, terminals, code
editors, Finder and Activity Monitor. It still remembers facts from them.

[privacy.md](privacy.md) has the full lists.

## How do I pause Nova?

Open the menu bar glyph and choose **Pause capturing**. Choose **Resume
capturing** to continue. From the CLI: `bun src/cli.ts pause` and
`bun src/cli.ts resume`, from `daemon/`.

While paused, Nova stores nothing and sends nothing. The capture process keeps
running. A pause is saved and holds across restarts until you resume. To stop
reading the screen entirely, quit Nova.

## How do I delete what Nova knows?

Open the menu → **Your Space** → **Your data**. You can delete one app's
captures, a time range, or everything. You can also set how long Nova keeps
captured text and memories. Or use `bun src/cli.ts forget` from `daemon/`. See
[privacy.md](privacy.md#delete-and-retention).

## What is an open loop?

Something unfinished that you could still act on: a promise you made, a
promise someone made to you, a question nobody answered, or an agreed step
that did not happen. For example, "Dana Reyes: can you send the Q3 numbers by
Friday?" in a chat becomes a loop you owe Dana.

Nova keeps a loop only when the capture contains a quote that supports it. It
closes a loop when a later capture shows it done. You can also mark a loop
done, snooze it, or dismiss it for good.

## Why does Nova need my name?

To tell which side of a conversation is yours. "I'll send it tomorrow" is
something you owe only if you wrote it. Set your name and handles in Your
Space → Profile, or with `NOVA_USER_NAME` and `NOVA_USER_ALIASES` in `.env`.
The Profile pane wins when both are set. Without them, Nova keeps only loops
whose direction the text makes plain.

Your name and aliases are sent to your chat provider with each loop request.

## Which AI apps can use Nova?

Any MCP client. Nova serves three tools: `search_memory`, `get_open_loops` and
`get_timeline`.
[install.md](install.md#7-connect-an-ai-app-over-mcp) shows the setup for
Claude Code and Claude Desktop.

## Where is my data?

In `~/Library/Application Support/Nova/`, encrypted. The keys are in your login
keychain under `dev.nova.keys`. The log is `~/Library/Logs/Nova/daemon.log`.
See [privacy.md](privacy.md#where-your-data-lives).

## Is there a download?

Not yet. Nova has no signed or notarized release. You build it from source.
See [install.md](install.md).

## Does Nova run on Windows or Linux?

No. Nova uses the macOS accessibility API, ScreenCaptureKit, Vision and the
macOS keychain. It needs macOS 14 or later.

## How do I uninstall it?

See [uninstall.md](uninstall.md).
