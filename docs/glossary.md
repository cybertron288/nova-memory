# Nova — Glossary

Plain-English definitions for the terms used across these docs. Read this first
if a doc throws a word at you that you have not met.

---

## Memory model

**Thread** — one row per *thing you looked at*: a Slack DM, a web page, a
document. Nova groups captures by thread so the same conversation over an hour
is one item, not sixty.

**Version** — a snapshot of a thread's text at a point in time, bucketed by
hour. This is the raw captured material. Big and wordy.

**Derivative** — one atomic fact pulled out of a version by an LLM, written as a
single self-contained sentence ("Jordan asked for the Q3 deck by Friday"). About
5–6 per version. **This is what search actually looks through** — short, clean,
one idea each, which is exactly what semantic search works best on.

**Entity / fact / open loop** — Nova's own layer on top: people, projects, and
commitments, derived from derivatives. This is where Nova's "closes your open
loops" feature lives.

---

## Search

**Embedding (or vector)** — a list of numbers representing the *meaning* of a
piece of text. Similar meanings produce similar number lists. This is what makes
"who sent the screenshot about the bug?" find a memory that says "Jordan attached
a crash image" — no words in common, but close in meaning.

Nova's embeddings are **1536 numbers** long. That length is called the
**dimension**.

**KNN (k-nearest-neighbors)** — the search itself: "given my question's number
list, find the k closest stored ones." `k=50` means "give me the 50 closest."

**sqlite-vec** — the SQLite extension that stores vectors and runs KNN. It scans
*every* stored vector on every query (brute force), so its cost grows with both
the number of rows and the dimension.

**float32 / int8 (quantization)** — how precisely each number is stored.
`float32` = 4 bytes each, full precision. `int8` = 1 byte each, rounded off:
4× smaller and ~4× faster to scan, but less accurate.

**Over-fetch + rescore** — the trick that makes int8 usable. Use the fast, sloppy
int8 index to grab 50 rough candidates, then re-rank *just those 50* using the
precise float32 numbers. Rescoring 50 items is nearly free, so you get int8
speed with float32 accuracy. Measured: 98.5% as accurate as pure float32, at
about a quarter of the time.

**Float32 sidecar** — where those precise numbers are kept for that final
re-ranking step. A plain BLOB column, never scanned, only fetched by id.

**FTS5** — SQLite's keyword/full-text search. **Nova cannot use it**, because it
needs readable text to index and Nova's text is encrypted. Hence pure
vector search.

**Recall@10** — accuracy measure: of the 10 results a *perfect* search would
return, how many did this one actually return? 98.5% recall@10 means it almost
always finds the same top 10.

---

## Privacy and encryption

Nova stores a log of your screen, so both layers below apply at all times.

**SQLCipher** — encrypts the **entire database file**. If someone copies
`memory.db` off your Mac, it is unreadable without the key.

**AES-256-GCM (`enc:v1`)** — encrypts **individual fields inside** the database,
on top of SQLCipher. Two layers so that reading the file is not enough; you also
need the field key. Sensitive columns (captured text, window titles, URLs) get
this treatment.

**Keychain** — macOS's secure store for secrets. Nova's encryption keys live
here, generated per install. A key compiled into the app would be the same in
every copy, so anyone could decrypt anyone's database.

**Cost note:** both encryption layers together add about **3 ms per search** —
roughly 0.2% of query time. Privacy here is nearly free; do not trade it away
for speed.

---

## Capture

**Accessibility API (AX)** — the macOS interface screen readers use to read
what's on screen. Nova reads app content through it instead of taking
screenshots.

**AX content vs AX chrome** — *content* is what you care about (the message, the
article, the code). *Chrome* is the UI furniture around it (toolbar labels, tab
titles, buttons). Nova's first spike accidentally captured only chrome and
looked successful because the character counts were high. Distinguishing these
two is the whole difficulty of AX capture.

**Per-app parser** — a small piece of code that knows where a *specific* app
keeps its real content. Generic tree-walking returns chrome; per-app parsers
reach the actual text. Needed because every app structures its tree differently.

**OCR** — reading text from a screenshot image. Accurate but expensive
(measured: it was the entire CPU problem). **Dropped for v1** in favor of AX.

**Process tap (CoreAudio)** — macOS 14.4+ API for capturing audio that other
apps are playing, so Nova can hear the other side of a call. Works, but requires
a permission a plain command-line binary cannot request — it needs a signed app
bundle.

**Diarization** — labeling *who spoke when* in a transcript. Nova mostly avoids
needing it: mic and system audio are captured as separate tracks, so "you" vs
"them" is free.

---

## Architecture and process

**MCP (Model Context Protocol)** — the standard that lets Claude (or ChatGPT,
Cursor, etc.) call out to a tool. Nova runs an MCP server so your LLM can search
your memory. This is the whole point of the product.

**R1–R11** — the numbered decisions in `decisions.md`, each
resolving one early design question.

**M0–M5** — project milestones in `roadmap.md`. M0 is the feasibility spikes
(now complete); M1 is the first real build.

**Spike** — a throwaway experiment that answers one risky question ("is this
even possible / fast enough?"). The code is not kept; the measured answer is.
All four of Nova's live in `spikes/`, with results in `spikes/reports/`.
