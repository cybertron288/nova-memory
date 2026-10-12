# Nova M0 — operator guide

How to reproduce each M0 spike measurement. **All four spikes have been run —
see `spikes/reports/*.md` for the recorded results.** This guide exists to
re-run them after a code change, not because anything is outstanding.

Two items still need an operator to close fully:
- **Audio system tap** — blocked on an audio-capture entitlement; needs a signed
  `.app` bundle, not a bare CLI binary (`reports/audio.md`).
- **Diarization** — never scored; needs a genuine two-voice source.

| Run | Needs | Time | Fills |
|-----|-------|------|-------|
| A — Screen | Accessibility permission | ~15 min | `spikes/reports/screen.md` |
| B — Audio | Deepgram key, 2 voices | ~15 min | `spikes/reports/audio.md` |
| C — Summarize | Gemini key, Ollama | ~15 min | `spikes/reports/summarize.md` |
| D — Retrieval | Nothing (heavy on RAM) | ~10 min | `spikes/reports/retrieval.md` |

**Everything below runs from the repository root.**

Two rules that apply throughout:
- **Never `git add` captured content.** Screen dumps, `.wav` files, and
  transcripts stay in `/tmp` or `artifacts/` (already gitignored). Only the
  `spikes/reports/*.md` files get committed.
- **Never commit an API key.** Both keys are read from the environment only.

---

## Run A — Screen capture (Spike 1)

Measures whether Accessibility extraction reads the apps that matter, and what
it costs in CPU. Note R2 drops OCR for M1 — the harness still has the OCR path
so the cost comparison stays reproducible.

### A1. Grant permissions

```bash
cd capture
swift build
.build/debug/nova-capture
```

macOS prompts for **Accessibility** and **Screen Recording** for your terminal
app. Grant both in System Settings → Privacy & Security.

**Then Ctrl-C and restart the binary.** macOS does not apply a new Screen
Recording grant to an already-running process. After restart you should see a
JSON line every ~3 seconds.

### A2. Start the CPU sampler (second terminal tab)

```bash
rm -f /tmp/spike-cpu.txt
while true; do ps -o %cpu= -p $(pgrep -f nova-capture) >> /tmp/spike-cpu.txt; sleep 5; done
```

### A3. Run the 10-minute protocol

Restart the harness with output going to a scratch file:

```bash
cd capture
.build/debug/nova-capture > /tmp/spike-log.jsonl
```

Now do **real work**, keeping each app frontmost for **at least 60 seconds**:

1. Slack (or Discord) — scroll a channel
2. Chrome — a long article, scroll and read
3. Chrome — Gmail, open a message
4. Notes.app or Xcode — type or scroll real content
5. WhatsApp Desktop — open a chat, scroll
6. Terminal — run commands, `cat` a file
7. Preview — a multi-page PDF, scroll

Then Ctrl-C both the harness and the CPU sampler.

### A4. Judge text quality (needed for the "Text usable?" column)

```bash
cd capture
.build/debug/nova-capture --dump 2> /tmp/spike-dump.txt
```

Switch between a couple of apps for ~30 s, Ctrl-C, then read
`/tmp/spike-dump.txt` and judge: does the actual visible content appear
(messages, article body, email text), or only UI chrome and labels?

```bash
rm /tmp/spike-dump.txt   # delete when done — this contains your real screen text
```

### A5. Compute the numbers

```bash
# Mean CPU % — gate is sustained < 5%
awk '{s+=$1; n++} END {print s/n}' /tmp/spike-cpu.txt

# Novelty dedupe rate (% of samples suppressed as not-novel)
total=$(wc -l < /tmp/spike-log.jsonl)
falseCount=$(grep -c '"novel":false' /tmp/spike-log.jsonl)
echo "scale=1; 100*$falseCount/$total" | bc

# Machine metadata for the report header
sw_vers
system_profiler SPHardwareDataType | grep "Model Name"
```

Per-app rows come from `/tmp/spike-log.jsonl`, filtered by the `app` field:
`axChars` (typical AX text length), whether `ocrChars > 0` ever appears (OCR
needed?), typical `ocrChars`, `axMs`, `ocrMs`.

### A6. Fill and commit

Edit `spikes/reports/screen.md`, replacing all 15 `<fill>` markers.

```bash
git add spikes/reports/screen.md
git commit -m "docs(nova-capture): record measured per-app capture results"
```

---

## Run B — Audio capture + diarization (Spike 2)

Measures whether meeting audio can be captured and transcribed with speakers
separated. Two legs: microphone, and system audio (the risky one).

### B1. Get a Deepgram key

Sign up at https://console.deepgram.com/ (free trial credit is plenty), create
a project → API Keys → new key with `usage:write` scope.

```bash
export DEEPGRAM_API_KEY="dg_xxx..."
```

### B2. Mic leg

```bash
cd spikes/audio
swift build
.build/debug/spike-audio
```

Grant **Microphone** access when prompted, then Ctrl-C and restart (same TCC
caveat as Run A).

Now produce **~90 seconds of two-voice conversation**. Diarization is what's
being tested, so two distinguishable speakers matter — a real back-and-forth
with someone else is ideal; failing that, play a two-person podcast or
interview through speakers and talk over parts of it.

You should see `recording → chunk-001.wav`, `chunk-002.wav`, `chunk-003.wav`.
Ctrl-C, then:

```bash
./transcribe.sh artifacts/chunk-001.wav > artifacts/chunk-001.json
bun format.ts artifacts/chunk-001.json
```

That prints `S0:` / `S1:` speaker turns. Check: is the transcript usable, and
are turns attributed to the right speaker? Count roughly how many of the turns
are correctly attributed — that's the diarization accuracy cell.

### B3. System-audio leg (the real unknown)

```bash
.build/debug/spike-audio
```

Watch stdout for **either** `system tap running → system-audio.wav` **or**
`tap: ... failed <err>`. **Record whichever line appears, verbatim** — a
failure here is a legitimate spike result, not something to work around. Grant
any additional permission prompt and restart if the tap reports a permission
failure.

While it runs, play a YouTube video with clear speech (ideally two voices) for
~60 s. Ctrl-C, then:

```bash
./transcribe.sh artifacts/system-audio.wav > artifacts/system-audio.json
bun format.ts artifacts/system-audio.json
```

If `system-audio.wav` is silent or near-zero bytes, or the transcript is empty,
that leg is a FAIL — record it as such rather than guessing at the cause.

### B4. Fill and commit

Edit `spikes/reports/audio.md`, replacing all 8 `<fill>` markers (include
`sw_vers` output and the per-30s-chunk transcription latency you observed).

```bash
git add spikes/reports/audio.md
git commit -m "docs(spike-audio): record measured capture and diarization results"
```

---

## Run C — Episode summarization, decision D4 (Spike 4)

Decides whether Nova summarizes episodes with a cloud model or an on-device
one.

### C1. Gemini key + current pricing

Create a key at https://aistudio.google.com/apikey

```bash
export GEMINI_API_KEY="..."
```

Check current Gemini 2.5 Flash per-million-token pricing at
https://ai.google.dev/gemini-api/docs/pricing and update the `0.3` (input) and
`2.5` (output) constants in `spikes/summarize/src/compare.ts` if they've
changed. They're marked as unverified in the code — the cost column is only as
good as these.

### C2. Install Ollama

```bash
brew install ollama
ollama serve &
sleep 2
ollama pull llama3.2:3b   # ~2 GB download
```

### C3. Run the comparison

```bash
cd spikes/summarize
GEMINI_API_KEY=$GEMINI_API_KEY bun run compare
```

This overwrites `spikes/reports/summarize.md` with live rows — latency, valid
JSON, cost per episode, and both models' raw output. Delete the
pending-measurement header block at the top once real data is in.

### C4. Score both outputs (this is the actual decision)

The fixture is a synthetic 15-minute work episode with a **known correct
answer**:

- **Exactly 2 true open loops:** "send Q3 deck to Jordan by Friday"
  (`i_owe`, counterparty Jordan, due Friday), and "book offsite venue this week"
  (`i_owe`, due this week).
- **One deliberate trap:** the offsite *budget sign-off* looks like a loop but
  is resolved inside the episode itself at 10:10 ("budget approved 12k per
  marco"). A good model must **not** report it.

Score each model 1–5 in the `## Outputs` section:
- **coverage** — did it find both true loops?
- **accuracy** — is the summary and are the entities correct?
- **loop precision** — did it correctly exclude the budget trap?

Then write the `## D4 verdict` paragraph: which model wins on quality vs cost
vs latency, and why.

### C5. Commit

```bash
git add spikes/reports/summarize.md spikes/summarize/src/compare.ts
git commit -m "docs(spike-summarize): record D4 comparison results and verdict"
```

---

## Run D — Retrieval latency (Spike 3)

No permissions or keys. **Heavy on RAM** — builds a 120k-row encrypted vector
corpus; expect several minutes and ~800 MB of disk under `artifacts/`.

```bash
cd spikes/retrieval
bun install
bun run src/bench2.ts        # reconciled model: SQLCipher + 1536-dim, no FTS5
bun run src/profile2.ts      # per-stage breakdown (KNN vs decrypt)
bun run src/rerank-probe.ts  # light: int8 over-fetch recall, 8k rows
```

Needs SQLCipher: `brew install sqlcipher`. Delete `artifacts/*.db` when done —
they are large and fully regenerable.

`src/db.ts` / `search.ts` / `bench.ts` are the **v1** harness (plaintext, FTS5,
768-dim). They are kept deliberately as the comparison baseline cited in
`reports/retrieval.md`; the reconciled model lives in the `*2.ts` files.

---

## Recording results

Report what actually happened, including failures — a documented failure is
worth more than a guess. Every current result is already written up in
`spikes/reports/`; update the relevant report rather than starting a new one.

**Never `git add` captured content** (screen dumps, `.wav`, transcripts) and
**never commit an API key**.
