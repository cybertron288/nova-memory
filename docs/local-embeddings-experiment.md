# Local embeddings experiment — EmbeddingGemma 2

Status: **parked until the app is complete.** Researched 2026-10-07. This is
the concrete plan for the M4 roadmap item
"On-device embeddings experiment".

Goal: stop sending memory text and search queries to Google for embeddings by
running Google's open-weight EmbeddingGemma 2 on the Mac. **Privacy is the
driver.** Cost is not (see §5).

Nothing below was measured on this machine yet. Every number is either from a
source (linked) or labeled as an estimate. §7 is the plan that replaces the
estimates with measurements.

---

## 1. Decision summary

| Question | Answer |
|---|---|
| Possible? | Yes. Text-only model runs on an M1 8 GB. |
| Privacy gain | Removes Google as a recipient of memory text and search queries. DeepSeek (chat extraction) still receives full capture text. |
| Speed | Faster when warm (tens of ms vs 0.6–2.8 s). Cold load ~1–3 s (estimate). |
| RAM | ~400–600 MB while loaded (estimate). 0 when unloaded. |
| Disk | 310–442 MB model. Vector store shrinks ~50%. |
| Money | Saves ~$0.03 to date. Irrelevant. |
| Main risk | Retrieval quality. Benchmarks are 5–7 points below Gemini. |
| Gate | recall@10 on a labeled Nova query set, local vs Gemini. |
| Reversible? | Only by re-embedding everything with Gemini again (sends all text to Google). |

---

## 2. The model

Sources: [Google blog](https://blog.google/innovation-and-ai/technology/developers-tools/embeddinggemma-2/),
[model card](https://huggingface.co/google/embeddinggemma-2).

- Released 2026-10-06 by Google DeepMind. Apache 2.0, not gated. Gemma
  Prohibited Use Policy applies. Training data cutoff January 2025.
- 740M parameters total, selectively loadable:
  - text: 270M (130M transformer + 140M token-embedding table)
  - + vision 170M, + audio 300M — **Nova needs text only.**
- 24 layers, model dim 512, vocab 262,144, mean pooling, 512→768 projection,
  L2-normalize module.
- Output **768 dims**, Matryoshka truncation to 512 / 256 / 128.
- Context 8,192 tokens (Nova memories are ~43 tokens; irrelevant).
- Precision: bf16 or f32. **Avoid f16** (model card).
- Asymmetric task prefixes — required for best retrieval:
  - query: `task: search result | query: {query}`
  - document: `title: {title} | text: {content}` (use `title: none` when there is no title)

### Runtimes and file sizes (text-only)

| Source | Variant | Size |
|---|---|---|
| [unsloth GGUF](https://huggingface.co/unsloth/embeddinggemma-2-GGUF) | UD-Q4_K_XL | 176 MB |
| | UD-Q5_K_XL | 210 MB |
| | UD-Q6_K_XL | 249 MB |
| | **Q8_0** | **310 MB** |
| | BF16 | 558 MB |
| [Ollama](https://ollama.com/library/embeddinggemma-2/tags) | `270m-nvfp4-text` (= `270m`) | 378 MB |
| | **`270m-mxfp8-text`** | **442 MB** |
| | `270m-bf16-text` | 574 MB |

- **Avoid NVFP4** (`270m`, `270m-nvfp4-text`). It is an Nvidia format; on Metal
  it likely dequantizes slowly.
- Candidates: Q8_0 GGUF (llama.cpp) or `270m-mxfp8-text` (Ollama). Q4 only if
  recall holds at Q8 and RAM becomes a problem.
- Also available: MLX, ONNX, LiteRT, transformers.js, sentence-transformers.

---

## 3. How Nova embeds today

| Fact | Value | Where |
|---|---|---|
| Model | `gemini-embedding-001` via OpenAI-compat endpoint | `.env` `NOVA_EMBED_*` |
| Dimension | 1536 (`DIM`) | `daemon/src/provider.ts:231` |
| Index | `vec0` `int8[1536]` + float32 sidecar `memory_derivative_vectors` | `daemon/src/db.ts:90-92` |
| Width lock | `assertEmbeddingDim` refuses a store at another width | `daemon/src/db.ts` |
| Batch | 64 memories per call | `daemon/src/pipeline.ts:19` |
| KNN depth | `OVER_FETCH = 500`, then exact float32 rescore | `daemon/src/search.ts:35` |
| Score | `dot(qv, fv) * 0.85 + recency * 0.15` | `daemon/src/search.ts:119` |
| Task types | none — memories and queries embedded the same way | `provider.ts` `embed()` |
| Redaction | `redactOutbound` strips contact details before embedding (D21) | `provider.ts` |

Measured from `nova calls` and `nova status` on 2026-10-07:

- 4,081 derivatives, all embedded.
- ~172 chars per memory (~43 tokens). ~5 memories per call.
- Cloud embed latency 615–2,846 ms per call.
- Outbound text in the call log: embed 17,360 chars vs chat 503,603 chars.
  **Embedding is ~3% of what leaves the Mac.** Chat to DeepSeek is the rest.

---

## 4. Quality

| Benchmark | gemini-embedding-001 | EmbeddingGemma 2 @768 |
|---|---|---|
| MTEB English v2 | ~73.6 | 68.46 |
| MTEB Multilingual v2 | ~68.3 | 61.36 |
| MTEB Code | — | 78.68 |

Gemini figures are from its 3072-dim launch numbers
([launch](https://multilingual.com/gemini-embedding-001-launch/)); Nova uses a
1536 truncation, slightly below that.

Matryoshka cost for EmbeddingGemma 2 (MTEB Multilingual):

| Dims | Score | Loss vs 768 |
|---|---|---|
| 768 | 61.36 | — |
| 512 | 61.17 | −0.19 |
| 256 | 60.41 | −0.95 |
| 128 | 57.89 | −3.47 |

Reading:
- The gap to Gemini comes from the **smaller model**, not from fewer dims.
- 768 is the model's native width. Use it. Storage is not the constraint.
- Non-English captures (e.g. Hindi chats) take the larger hit (−7 vs −5).
- Benchmarks do not predict Nova's case: short, English, first-person memory
  sentences. Only §7 decides.

---

## 5. Cost

### Money

- Gemini price: $0.15 / 1M tokens ([pricing](https://embeddingcost.com/google)).
- 4,081 memories × ~43 tokens ≈ 175k tokens ≈ **$0.03 to date**.
- Local: $0. The saving does not justify the work. Privacy does.

### Cost of reducing the dimension (1536 → 768)

1. **Full re-embed.** Vectors from different models are not comparable. Gemini
   vectors cannot be truncated into the new space. Every derivative is
   embedded again. Locally: free, ~175k tokens, ~1–2 min (estimate).
2. **Store migration.** `assertEmbeddingDim` locks the width. A new store (or a
   new vec0 table) at 768, a resumable re-embed, then a swap. Must survive
   interruption — the store will be six figures by then.
3. **Re-tune `OVER_FETCH`.** k=500 was tuned on 1536-dim vectors
   (`docs/roadmap.md`). Re-run `daemon/bench/vector-precision.ts` with
   `BENCH_K` at 768.
4. **Quality** — no loss from the dimension itself (768 is native). The loss is
   the model change, §4.

Effort: a few days, one time.

### Resources (estimates until §7 measures them)

| Resource | Estimate | Note |
|---|---|---|
| RAM while loaded | 400–600 MB | weights + compute buffers + runner process. Google's 191 MB is LiteRT on a Pixel; llama.cpp will be higher. |
| RAM idle | 0 | Ollama unloads after `keep_alive` (default 5 min). |
| Disk (model) | 310–442 MB | Q8_0 / mxfp8 |
| Store per row | 7.7 KB → 3.8 KB | int8 1536→768 B, float32 6144→3072 B |
| Store at 4,081 rows | ~31 MB → ~16 MB | vectors only |
| Store at 100k rows | ~770 MB → ~385 MB | vectors only |
| Energy | negligible | bursts only when a drain has new memories |

Machine context: M1, 8 GB, ~36% free at the time of research with Chrome open.

---

## 6. Speed

Estimate basis: ~0.26 GFLOP per token through the 130M transformer, ~55 tokens
per memory with prefix. Not measured.

| Path | Today (cloud) | Local warm | Local cold |
|---|---|---|---|
| Drain batch (~5 memories) | 615–2,846 ms | ~20–80 ms | +1–3 s model load |
| Search query embed | ~600 ms+ | ~10–30 ms | +1–3 s model load |
| Full re-embed (4,081) | — | ~1–2 min | — |
| KNN scan | baseline | ~2× faster (half the dims) | — |

Other effects:
- **Offline search works.** Today a query needs network.
- **No 429s from embedding.** The shared quota gate (`pipeline.ts`) pauses chat
  and embed together on a 429 from either. A local embedder never trips it.
- **Cold start** hurts only the first search after idle. Fix: warm the model at
  daemon start and keep it loaded longer — trades RAM for latency.

---

## 7. Experiment plan

Each step produces a number. Record numbers either way.

### 7.0 Prerequisites

- [ ] **Labeled query set.** None exists for retrieval (`daemon/eval/` covers
      extraction and loops only). Build ~50 real queries, each with the
      derivative ids that should come back. Keep it gitignored like the other
      fixtures (`*.local.json`) — it quotes real memories.
- [x] **Normalize vectors in the baseline.** Done 2026-10-08, see §9.1.
- [ ] User approval to start `ollama serve` and pull a model. Do not start
      servers unasked.

### 7.1 Runtime smoke test (light — this Mac hangs on heavy runs)

- `ollama pull embeddinggemma-2:270m-mxfp8-text`
- Embed 100 real memories with the document prefix and 10 queries with the
  query prefix.
- Record: warm latency per batch (p50/p95), cold-load time, RSS of the runner
  (`ps -o rss`), output dim (expect 768), vector norm (expect ~1.0).
- Repeat with Q8_0 GGUF on llama.cpp if Ollama numbers look off.

### 7.2 Recall comparison (the gate)

- Embed the whole store twice in a scratch copy: Gemini 1536 (normalized) and
  EmbeddingGemma 2 768 (prefixed, normalized).
- For each query, rank by the same score function.
- Report recall@10 and MRR for both. Also report with and without prefixes, to
  confirm the prefixes matter.
- **Pass:** local recall@10 within ~3 points of Gemini (threshold to confirm
  before running). A model that is faster but loses recall is not an upgrade.

### 7.3 Depth sweep

- `daemon/bench/vector-precision.ts` with `BENCH_K` at 768 dims.
- Pick the smallest k that holds 100% recall@10 vs exact float32.

### 7.4 Decide

Pass → §8. Fail → record the numbers in `docs/deferred-tasks.md`, try Q8 vs
mxfp8 vs bf16 once, then stop.

---

## 8. Implementation (only after 7.2 passes)

1. **`DIM` 1536 → 768** in `provider.ts`. `search.quantize` and
   `pipeline.quantize` stay byte-identical (CLAUDE.md, "Things that get broken" #6).
2. **Role-aware `embed()`.** `embed(texts, role: "query" | "document")`.
   `pipeline.ts` passes `"document"`, `search.ts` passes `"query"`. Prefixes are
   applied inside the local provider only. Gemini ignores the role (or maps it
   to `taskType`).
3. **L2-normalize** — already done in pipeline and search (§9.1).
4. **`LocalProvider` for embed only.** Chat stays on `NOVA_CHAT_*`. The seam
   already exists (`OpenAICompatProvider`, independent chat/embed config).
5. **Runtime choice:**
   - Experiment: Ollama via `NOVA_EMBED_BASE_URL=http://localhost:11434/v1`.
     Near-zero code.
   - Ship: **bundle a signed llama.cpp server** in `Nova.app`, supervised like
     capture. Requiring users to install Ollama fails "polished or not at all".
   - In-process (transformers.js / node-llama-cpp under Bun): fewest processes,
     least proven. Evaluate only if the extra child is a problem.
6. **Migration.** Resumable re-embed into a 768 store, swap, then delete the
   old one. Log progress; every skipped row carries a reason (CLAUDE.md #10).
7. **Calls log.** Local embeds still record a `calls` row with provider
   `local`, so the Your Space window shows that nothing went out.
8. **Warm-up.** Load the model at daemon start; tune `keep_alive`.
9. **Retune `OVER_FETCH`** from 7.3.

---

## 9. Drawbacks and open questions

1. **Retrieval quality may drop.** The main risk. Only 7.2 answers it.
2. **One-way switch.** Going back means re-embedding with Gemini, which sends
   all memory text to Google again.
3. **Another process.** A bundled server is one more child for the supervisor:
   restart, backoff, crash handling, signing.
4. **Prefix plumbing.** Wrong or missing prefixes lower quality silently.
5. **RAM on 8 GB.** ~0.5 GB resident beside Chrome may push the machine to swap.
6. **Battery and heat.** Small, but now local.
7. **Manual model updates.** Each upgrade is another full re-embed.
8. **Privacy is partial.** DeepSeek still receives ~97% of outbound text. The
   full "verifiable local inference" claim needs local chat too — a separate,
   much larger problem.
9. **Redaction choice.** `redactOutbound` (D21) exists because the text left
   the Mac. Locally, contact details could stay in the embedding input, so
   searching by email or phone would work — but they would then shape vectors
   stored in the index. Decide explicitly.

### 9.1 Side finding — vectors were not normalized (fixed 2026-10-08)

`search.ts` scored with a raw `dot(qv, fv)`. Nothing L2-normalized the
vectors. Google documents that only the 3072-dim `gemini-embedding-001` output
is normalized; truncated sizes (1536, 768) must be normalized by the caller.
So the score was not cosine, and vector magnitude leaked into the
0.85/0.15 balance with recency.

Verified 2026-10-08: the 1536 vectors came back at length ~0.69. Fixed: the
pipeline and search scale every vector to unit length (`unitVector`, `db.ts`),
and opening the store rescales existing sidecar vectors once. The int8 index
needs no rebuild — `quantize` scales per vector by max-abs.

---

## 10. Sources

- [Google blog — EmbeddingGemma 2](https://blog.google/innovation-and-ai/technology/developers-tools/embeddinggemma-2/)
- [Hugging Face model card](https://huggingface.co/google/embeddinggemma-2)
- [unsloth GGUF](https://huggingface.co/unsloth/embeddinggemma-2-GGUF)
- [Ollama tags](https://ollama.com/library/embeddinggemma-2/tags)
- [cellcog breakdown](https://cellcog.ai/blog/embeddinggemma-2/)
- [Gemini embedding pricing](https://embeddingcost.com/google)
- [gemini-embedding-001 launch](https://multilingual.com/gemini-embedding-001-launch/)
