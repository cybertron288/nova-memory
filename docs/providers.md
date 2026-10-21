# AI providers

Nova needs two things from an AI provider:

- **Chat**, to extract facts and open loops from a capture, and to write the
  morning briefing.
- **Embeddings**, to make facts searchable and to recognize a loop it has
  already found.

You set the provider in `.env` at the repository root. The daemon reads it at
start. After you change it, restart the daemon: `pkill -f "cli.ts start"`.
The app starts it again within a second.

## How Nova picks a provider

1. If **any** of the six `NOVA_CHAT_*` or `NOVA_EMBED_*` variables is set, Nova
   uses option B, and all six are required.
2. Otherwise, if `GEMINI_API_KEY` is set, Nova uses option A.
3. Otherwise, if `NOVA_CLOUD_URL`, `NOVA_AUTH_URL` and `NOVA_AUTH_KEY` are
   set, Nova uses Nova Cloud: signed-in users need no key of their own. Signed
   out, the daemon keeps running and captures wait for sign-in. A partial set
   is named, like option B.
4. Otherwise, nothing is configured. The daemon exits at start with a message
   that names the variables to set.

A partly filled option B is an error, not a reason to fall back to Gemini. Nova
names the missing variables. A typo should not turn into an auth error from a
different vendor.

So if you set option B, a `GEMINI_API_KEY` in the same file is ignored.

## Option A: Google Gemini

```sh
GEMINI_API_KEY=your-key
```

One key covers both chat and embeddings, through Google's native Gemini API.
Nova uses `gemini-3.6-flash` for chat and `gemini-embedding-001` at 1536
dimensions for embeddings. These are set in `daemon/src/provider.ts`.

## Option B: any OpenAI-compatible endpoint

```sh
NOVA_CHAT_BASE_URL=https://api.openai.com/v1
NOVA_CHAT_API_KEY=your-chat-key
NOVA_CHAT_MODEL=gpt-4.1-mini

NOVA_EMBED_BASE_URL=https://api.openai.com/v1
NOVA_EMBED_API_KEY=your-embed-key
NOVA_EMBED_MODEL=text-embedding-3-small
```

Nova sends `POST {NOVA_CHAT_BASE_URL}/chat/completions` and
`POST {NOVA_EMBED_BASE_URL}/embeddings`, with `Authorization: Bearer <key>`. A
trailing slash on a base URL is fine.

Chat requests ask for a JSON object (`response_format: {"type":
"json_object"}`) at temperature 0. The chat model must reply with valid JSON.
An empty or cut-off reply counts as a failure, and Nova retries it later.

`NOVA_EMBED_DIM` is optional. The only accepted value is `1536`.

### Why chat and embeddings are separate

Many vendors offer one but not the other. Some chat providers have no
embedding endpoint at all. Separate settings let you use one vendor for chat
and another for embeddings, or a local server for one and a hosted API for the
other. Each side has its own URL, key and model.

## The 1536-dimension rule

Nova stores **1536-dimension** vectors only. The search index is created at
that width, so the embedding model must return exactly 1536 numbers per text.

- Nova sends `dimensions: 1536` with each embedding request. Models that can
  shorten their output, such as `text-embedding-3-small`,
  `text-embedding-3-large` and `gemini-embedding-001`, then return 1536.
- If the endpoint rejects the `dimensions` parameter, Nova retries once
  without it. The vectors must still be 1536 wide, or the call fails.

If a model returns any other width, every embedding call fails with
`returned a N-dim vector, expected 1536`. Nothing wrong is stored: the work
stays queued, and after 8 failures it is parked. Fix the model, then run
`bun src/cli.ts retry`.

### The store is locked to its width

The first time Nova opens a store, it records the embedding width (1536) in
it. A store from a build with a different width will not open, and the error
names both numbers. There is no automatic migration.

Changing to a different model **of the same width** gives no error, but
vectors from two different models do not compare well. Search quality drops
for memories made before the change.

To change the embedding model cleanly, start a new store:

1. Quit Nova.
2. Delete the store: `rm ~/Library/Application\ Support/Nova/memory.db*`.
   This deletes all your memories.
3. Set the new model in `.env`.
4. Open Nova.

## Local models

Point both base URLs at a server on your Mac that speaks the OpenAI API, such
as Ollama or LM Studio. Then no captured content leaves your Mac.

```sh
NOVA_CHAT_BASE_URL=http://localhost:11434/v1
NOVA_CHAT_API_KEY=local
NOVA_CHAT_MODEL=your-chat-model

NOVA_EMBED_BASE_URL=http://localhost:11434/v1
NOVA_EMBED_API_KEY=local
NOVA_EMBED_MODEL=your-embedding-model
```

All six variables must be set. If your server needs no key, use any
placeholder value.

Check these before you rely on a local setup:

- **Embedding width.** The embedding model must output 1536 dimensions, or
  your server must honor the `dimensions` parameter. Many popular local
  embedding models output 384, 768 or 1024 dimensions. Those do not work with
  this version of Nova. Test your model before you rely on it: call
  `/embeddings` with `"dimensions": 1536` and count the numbers returned.
- **JSON output.** The chat model must return valid JSON when asked. Small
  models fail at this more often. Failed replies are retried, then parked.
- **Quality.** Loop extraction is tuned for precision. A weaker model finds
  fewer loops, and the code drops answers that do not quote the capture
  exactly.
- **Load.** Nova sends work every 15 seconds while you use your Mac. A large
  local model can slow the rest of your machine.

You can mix: for example, chat on a local server and embeddings from a hosted
API. Then only the extracted facts and your search queries leave the Mac.

## Cost

Hosted providers bill per call. What Nova sends depends on how much changes on
your screen:

- For each changed capture: one chat call for facts, usually one chat call
  for loops, and one embedding call.
- One chat call each morning for the briefing.
- One embedding call per search.

Text Nova has already seen is skipped, and only the new part of a capture is
sent for facts. A day of reading and chatting produces far more calls than a
day in one document.

To control cost:

- Watch **Your Space → Activity → Sent to your provider**, or run
  `bun src/cli.ts calls` from `daemon/`. Both show call counts and characters
  sent.
- Set a spending limit with your provider.
- Pause capture, or quit Nova, when you do not need it. The panel alone costs
  nothing.
- Use a small, inexpensive chat model, or a local server.

When the provider returns a rate limit or quota error (HTTP 429 or 402), Nova
pauses all provider calls, for chat and embeddings together. It waits as long
as the provider's `Retry-After` header says, or else between 1 minute and 1
hour, growing with each refusal. Waiting does not count as
a failed attempt.

## Add a provider in code

Every provider implements the `InferenceProvider` interface in
`daemon/src/provider.ts`:

```ts
interface InferenceProvider {
  extract(versionText: string, ctx?: CaptureContext): Promise<string[]>;
  embed(texts: string[]): Promise<Float32Array[]>;   // 1536 numbers each
  extractLoops?(versionText: string, ctx?: CaptureContext,
                tracked?: TrackedLoop[]): Promise<LoopExtraction>;
  summarizeDigest?(input: DigestSummaryInput): Promise<DigestSummary>;
}
```

Use `GeminiProvider` and `OpenAICompatProvider` as models. A new provider
should:

- Reuse the shared prompt builders and parsers (`buildExtractPrompt`,
  `parseMemories`, `buildLoopPrompt`, `parseLoops`, `buildDigestPrompt`,
  `parseDigestSummary`). `parseLoops` enforces the quote, direction and
  newness rules in code. Do not bypass it.
- Pass capture text and context through `scrubOutbound`, and embedding input
  through `redactOutbound`, before sending. This keeps emails and phone
  numbers on the Mac. Apply it once, before both the prompt and `parseLoops`,
  so the quote check reads the same text the model saw.
- Return exactly `DIM` (1536) numbers per vector.
- Throw `QuotaExhausted` for a rate limit, `ProviderUnreachable` for a network
  failure, and `MalformedResponse` for an unusable reply. The pipeline relies
  on these to decide whether a failure costs a retry attempt.
- Report each call to the `CallSink`, so it appears in the Activity view.
- Never put an API key in a thrown message or a log line.

Then select it in `providerFromEnv`. That function must never throw: the MCP
server needs to start even when the configuration is wrong.

`FakeProvider`, in the same file, is a deterministic provider for tests.
