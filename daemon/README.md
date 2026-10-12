# nova-daemon

Reads capture records from `nova-capture`, stores them encrypted, extracts
facts with a language model, and serves them to Claude Desktop over MCP.

## Setup

```bash
brew install sqlcipher
cd daemon && bun install
```

Then configure an inference provider — see below. Nothing else is required.

## Configuring inference

Nova needs two things from a provider: **chat** (to extract facts from a
capture) and **embeddings** (to make those facts searchable). There are two
ways to supply them.

### Option A — Gemini (single key)

```bash
export GEMINI_API_KEY="..."
```

Uses Google's native Gemini API for both chat and embeddings. This is the
default and needs no other variables.

### Option B — any OpenAI-compatible endpoint

Chat and embeddings are configured **independently**, because they are
frequently not the same vendor. All six variables are required:

```bash
export NOVA_CHAT_BASE_URL="https://api.deepseek.com"
export NOVA_CHAT_API_KEY="..."
export NOVA_CHAT_MODEL="deepseek-chat"

export NOVA_EMBED_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai"
export NOVA_EMBED_API_KEY="..."
export NOVA_EMBED_MODEL="gemini-embedding-001"
```

Nova posts to `{NOVA_CHAT_BASE_URL}/chat/completions` and
`{NOVA_EMBED_BASE_URL}/embeddings` with `Authorization: Bearer <key>`. A
trailing slash on either base URL is fine.

`NOVA_EMBED_DIM` is optional and defaults to `1536`.

Setting **any** of the six variables selects this option. If some are set and
others are not, Nova reports exactly which ones are missing rather than
quietly falling back to Gemini — a typo should not surface as another vendor's
quota error.

### Why chat and embeddings are separate

The example above is not arbitrary. Probed on 2026-08-25:

| Endpoint | Result |
|---|---|
| DeepSeek `/chat/completions` | 200 OK |
| DeepSeek `/embeddings` | **404 — DeepSeek serves no embedding endpoint at all** |
| Gemini (OpenAI-compat) `/chat/completions` | 429, quota exhausted |
| Gemini (OpenAI-compat) `/embeddings` | 200 OK, 1536 dimensions |

DeepSeek ships no embedding model. If you use it for extraction you **must**
point `NOVA_EMBED_*` at a different provider. A single base URL cannot express
that, which is why there are two.

### Embedding dimension: 1536 only

This build indexes **1536-dimension vectors only**. The vec0 index is declared
`int8[1536]` when the database is created and the float32 rescore sidecar is
read back at that fixed width, so another value would need a schema migration
that does not exist yet. `NOVA_EMBED_DIM` is accepted for forward
compatibility but any value other than `1536` is rejected at startup rather
than silently corrupting the store.

Nova records the embedding dimension in the database the first time a store is
opened. If you later configure a model of a different width, Nova refuses to
open the store and names both numbers. There is no auto-migration: re-embedding
every derivative is your decision, not a side effect of editing a variable. To
switch embedding models, re-index from scratch.

Choose an embedding model that can return 1536 dimensions. `gemini-embedding-001`
does, via the `dimensions` parameter. Models with a fixed output width are
retried once without that parameter, but the width they return is still
validated.

## Who you are

Open loops need to know which side of a conversation is yours: "I'll send it
tomorrow" is something you owe only if you wrote it.

```bash
export NOVA_USER_NAME="Sam Lee"
export NOVA_USER_ALIASES="Sam,sam@example.com"   # optional, comma-separated
```

Without them Nova still finds loops whose direction the text makes plain, and
leaves the rest out rather than guess. Apps that write you as "You" are
recognised either way.

## Run

```bash
bun run src/cli.ts start     # capture + ingest
bun run src/cli.ts status    # counts
bun run src/cli.ts search "what did I read about ownership"
bun run src/cli.ts loops                 # open loops, with ids
bun run src/cli.ts done <id>             # mark a loop done
bun run src/cli.ts snooze <id>           # hide it until 09:00 tomorrow
bun run src/cli.ts dismiss <id>          # never suggest it again
bun run src/cli.ts pause                 # stop storing captures (capture keeps running)
bun run src/cli.ts resume
```

`loops`, `done`, `snooze`, `dismiss`, `pause` and `resume` talk to a running
`nova start` over its control socket at
`~/Library/Application Support/Nova/control.sock`. They never open the store
themselves — the daemon is the only process that does. If `nova start` is not
running they say so and exit 1.

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nova": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/nova/daemon/src/cli.ts", "mcp"],
      "env": {
        "NOVA_CHAT_BASE_URL": "https://api.deepseek.com",
        "NOVA_CHAT_API_KEY": "...",
        "NOVA_CHAT_MODEL": "deepseek-chat",
        "NOVA_EMBED_BASE_URL": "https://generativelanguage.googleapis.com/v1beta/openai",
        "NOVA_EMBED_API_KEY": "...",
        "NOVA_EMBED_MODEL": "gemini-embedding-001"
      }
    }
  }
}
```

Or, for the Gemini default, `"env": { "GEMINI_API_KEY": "..." }`.

Restart Claude Desktop.

The MCP server starts even when nothing is configured, and reports the problem
on each tool call. That is deliberate: a server that exited would appear in
Claude Desktop as a dead connector with no explanation.

## What leaves your Mac

Captured text is sent to **whichever endpoints you configure**, for two
purposes: extracting facts from a capture, and turning those facts into
embeddings. With `GEMINI_API_KEY` that is Google. With `NOVA_CHAT_*` and
`NOVA_EMBED_*` it is the two hosts you named — and they are contacted
separately: the capture's full text goes to the chat endpoint, with the
descriptions of your currently open loops so the model can tell when one is
finished, and the extracted facts go to the embedding endpoint. AI assistant
chats, terminals and editors are never sent for loop extraction.

Nothing else leaves the machine. The database, including every captured page,
stays on disk in `~/Library/Application Support/Nova/memory.db`, encrypted with
keys held in your login Keychain. API keys are never written to the database or
to a log, and are stripped from provider error messages before those are
raised.

Pointing both variables at a local server (Ollama, llama.cpp, LM Studio, or any
other OpenAI-compatible host) keeps captured text on the machine entirely,
provided the model you run can return 1536-dimension embeddings.
