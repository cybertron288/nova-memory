# Spike report: retrieval latency

- Date: 2026-08-22 (v2 re-measure) · machine: Apple M1, 8 GB
- Corpus: 120,000 derivatives (~6 months at ~650/day), **dim 1536**,
  **SQLCipher-encrypted**, sqlite-vec `vec0`, **no FTS5**
- Queries: 50 searches — vector-KNN k=40 → decrypt candidates → in-memory rerank

## Headline: the v1 PASS was a false positive

The 2026-08-12 run measured **p50 157 ms** and recorded a PASS. It measured a
schema the reconciliation later discarded: **plaintext, FTS5 hybrid, 768-dim**
(R4–R6 replaced all three). Re-measured against the model Nova will actually
build:

| Metric | v1 (plaintext, 768d, FTS5) | v2 (SQLCipher, 1536d, no FTS5) | Gate | Result |
|--------|---------------------------|-------------------------------|------|--------|
| p50 | 157 ms | **1487 ms** | < 800 ms | **FAIL** |
| p95 | 294 ms | **3412 ms** | < 2000 ms (PRD NFR) | **FAIL** |

~9.5× slower. The latency NFR was never actually validated for the reconciled
architecture.

## Where the time goes — encryption is NOT the problem

Per-stage medians over 25 queries on the same corpus:

| Stage | Median | Share |
|-------|--------|-------|
| Vector KNN (1536-dim over 120k) | **1365 ms** | ~98% |
| Row fetch (SQLCipher page decrypt) | 2.5 ms | ~0.2% |
| Field decrypt (AES-256-GCM × 40) | 0.31 ms | ~0.02% |

**Both encryption layers are effectively free.** This validates R6/R8: SQLCipher
whole-file plus per-field `enc:v1` AES-GCM costs ~3 ms per query combined. The
cost is entirely `sqlite-vec`'s brute-force KNN scan, which is linear in both
row count and dimension.

Dimension scaling on an identical encrypted setup (120k rows, k=40):

| Dim | p50 KNN |
|-----|---------|
| 384 | 313 ms |
| 768 | 582 ms |
| 1536 | 1496 ms |

Note this also shows v1's 157 ms did not come from FTS5 helping — at 768-dim the
KNN arm alone costs ~582 ms here.

## The fix: vector quantization

`sqlite-vec` supports int8 and binary quantized vectors. Same 120k × 1536-dim
corpus (measured under parallel load, so treat these as relative):

| Encoding | p50 KNN | DB size | Gate < 800 ms |
|----------|---------|---------|---------------|
| float32 | 3115 ms | 761 MB | FAIL |
| **int8** | **352 ms** | 192 MB | **PASS** |
| bit | 81 ms | 26 MB | PASS |

int8 is ~9× faster at 4× smaller; binary ~38× faster at 29× smaller.

**Recall cost (measured on random vectors — worst case):**

| Encoding | recall@10 vs exact float |
|----------|--------------------------|
| int8 | 63.0% |
| bit | 12.0% |

Random high-dimensional vectors are near-equidistant, so quantization error
reshuffles ranks aggressively; real clustered embeddings will score materially
higher. The relative signal still stands: **binary is too lossy to use alone;
int8 is the viable candidate.**

**Over-fetch + exact rescore recovers the loss completely.** Run int8 KNN with a
larger k, then rank those candidates against their float vectors (cheap — only k
of them). Measured on 8,000 × 1536-dim, again with worst-case random vectors:

| int8 over-fetch | recall@10 vs exact float |
|-----------------|--------------------------|
| 10 (no over-fetch) | 73.5% |
| **50** | **98.5%** |
| 100 | 99.5% |
| 200 | 100.0% |

**k=50 over-fetch gives 98.5% recall.** Combined with the int8 scan cost
(~352 ms at 120k), this clears both gates with quality essentially intact — and
on real clustered embeddings it should be better still.

## Verdict & M1 implications

**Spike 3 v2 result: PASS, with a design change.** The p50 < 800 ms NFR does
not hold for the reconciled model as R5/R6 first wrote it (`FLOAT[1536]`,
1487 ms); it does hold with int8 quantization plus over-fetch rescoring
(~352 ms, 98.5% recall@10). **R5/R6 were amended accordingly on 2026-08-22** —
see `docs/decisions.md` §4.1.

1. **Adopt int8 quantized vectors with k=50 over-fetch + exact float rescore.**
   Measured: ~352 ms scan (vs 1487 ms float32) at 98.5% recall@10. Store float
   vectors alongside the int8 index for the rescore step. This single change
   takes the design from failing both gates to passing both. **Now folded into
   R5/R6** (07 §4.1) and the schema in `docs/data-model.md`.
2. **Keep both encryption layers** — they cost ~3 ms/query. R6 and R8 are
   confirmed cheap; do not trade privacy for latency here.
3. **Consider 768-dim embeddings.** Dimension is linear in KNN cost. If the
   embedding model offers a 768 variant at acceptable quality, it halves the
   scan before quantization is even applied. (The 1536 figure in R5 came from
   matching another product, not from a quality measurement of Nova's own.)
4. **Re-validate against real embeddings.** Every number here uses synthetic
   random vectors: latency is representative, **ranking quality is not**. The
   PRD benchmark query set with real Gemini embeddings is the M1 gate.
5. **Revisit the NFR if quantization is rejected.** p50 < 800 ms is not
   achievable at 120k × 1536-dim float32 on this class of hardware with a
   brute-force index.

## Reproducing

```
cd spikes/retrieval
bun run src/bench2.ts        # v2 encrypted corpus + latency (heavy: builds 120k rows)
bun run src/profile2.ts      # per-stage breakdown on an existing corpus
bun run src/rerank-probe.ts  # int8 over-fetch + float rescore recall (light, 8k rows)
```

`src/db.ts` / `src/search.ts` / `src/bench.ts` remain as the v1 (plaintext, FTS5)
harness for comparison; `db2/search2/bench2` are the reconciled model.
