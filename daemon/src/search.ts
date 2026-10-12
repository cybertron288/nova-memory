// Retrieval (spec 4.4). int8 KNN over-fetch, then exact float rescore: the
// quantized index alone recovers only ~63% of the exact top-10, while
// over-fetching 50 and rescoring recovers 98.5% (spikes/reports/retrieval.md).
import type { Database } from "bun:sqlite";
import { decryptField, DIM, unitVector } from "./db";
import type { InferenceProvider } from "./provider";
import { attributed } from "./calls";

export interface SearchHit {
  text: string; score: number; at: number;
  app: string; windowTitle: string; url: string | null;
}

/**
 * How many int8 candidates to pull before the exact float rescore.
 *
 * R5/R6 §4.1 set this to 50 from a synthetic-vector benchmark. Re-measured
 * 2026-09-18 against 277 real embeddings tiled to 120k rows
 * (`bench/vector-precision.ts`), 50 recovers only 68% of the true top-10:
 *
 *     k=50   p50  27.8 ms   recall@10  68%
 *     k=100  p50  31.6 ms   recall@10  80%
 *     k=200  p50  44.7 ms   recall@10  90%
 *     k=500  p50  76.8 ms   recall@10 100%   <- here
 *     k=1000 p50 134.0 ms   recall@10 100%
 *
 * 500 is where recall saturates, and at 77 ms p50 it keeps ~10x headroom under
 * the 800 ms gate. It also beats the float32[1536] path §4.1 rejected on every
 * axis at once (494 ms p50, 21,279 ms p95, 98% recall), so int8 stays.
 *
 * This is a *fraction* of the corpus (500 of 120k ≈ 0.4%), not an absolute
 * depth: a store an order of magnitude larger needs a proportionally deeper
 * over-fetch, and its latency grows with it. Re-measure at the next order of
 * magnitude rather than assuming 500 still holds.
 */
const OVER_FETCH = 500;
const HALF_LIFE_DAYS = 30;

/** float32 -> int8, scaled per-vector — must match the pipeline's quantize()
 * exactly, or the query vector and the indexed vectors won't be comparable. */
export function quantize(v: Float32Array): Int8Array {
  let max = 0;
  for (const x of v) max = Math.max(max, Math.abs(x));
  const scale = max === 0 ? 1 : 127 / max;
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.round(v[i]! * scale);
  return q;
}

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
};

export async function searchMemory(
  db: Database, key: Buffer, provider: InferenceProvider, query: string,
  opts: { limit?: number; maxAgeDays?: number } = {},
): Promise<SearchHit[]> {
  const limit = opts.limit ?? 10;
  // memory_derivatives are retained indefinitely by default (docs/05
  // Retention) — a finite default window would silently hide the user's own
  // retained data ("what was I reading about X last year") with no error.
  // Infinity keeps `age > maxAgeMs` always false unless a caller opts into a
  // window explicitly.
  const maxAgeMs = (opts.maxAgeDays ?? Infinity) * 86_400_000;
  const now = Date.now();

  // A query that could not be embedded is not "nothing matched" — the store may
  // be full of correctly embedded content. Returning [] here let mcp.formatHits
  // tell the user nothing was captured or capture was not running, both of which
  // are actively false. Throw instead, so the MCP caller gets an actionable
  // error rather than a confident lie (spec 7, the silent-failure rule).
  // stderr only: stdout is the JSON-RPC wire once serveMcp is connected.
  const [raw] = await attributed({ purpose: "search", captureIds: [] }, () => provider.embed([query]));
  if (!raw) {
    console.error("[search] the provider returned no embedding for the query; cannot search");
    throw new Error("Could not embed the search query: the provider returned no vector.");
  }
  if (raw.length !== DIM) {
    console.error(`[search] query embedding has dimension ${raw.length}, expected ${DIM}; cannot search`);
    throw new Error(
      `Could not embed the search query: got a ${raw.length}-dimension vector, expected ${DIM}. `
      + "The embedding model or its configuration has changed and no longer matches the stored index.");
  }
  const qv = unitVector(raw);

  // sqlite-vec misreads a raw buffer/typed-array bind as float32 regardless
  // of byte length, so it silently mismatches against an int8[] column (or,
  // as verified against this schema, throws a type-mismatch error rather
  // than a silent wrong-answer). Bind through vec_int8() with a JSON array
  // instead, matching exactly how the pipeline writes the index
  // (daemon/src/pipeline.ts) — verified against a scratch vec0 table before
  // wiring this in.
  const candidates = db.prepare(
    `SELECT derivative_id FROM memory_derivative_embeddings
     WHERE embedding MATCH vec_int8(?) AND k = ?`
  ).all(JSON.stringify(Array.from(quantize(qv))), OVER_FETCH) as { derivative_id: string }[];
  if (candidates.length === 0) return [];

  const row = db.prepare(
    `SELECT d.content, d.committed_at, v.vector,
            t.source_app, t.source_url, t.source_title
       FROM memory_derivatives d
       JOIN memory_derivative_vectors v ON v.derivative_id = d.id
       JOIN memory_threads t ON t.id = d.thread_id
      WHERE d.id = ?`
  );

  const hits: SearchHit[] = [];
  for (const c of candidates) {
    const r = row.get(c.derivative_id) as any;
    if (!r) continue;
    const age = now - r.committed_at;
    if (age > maxAgeMs) continue;                       // recency is a filter
    const vecBuf = r.vector as Uint8Array;
    const fv = new Float32Array(vecBuf.buffer, vecBuf.byteOffset, DIM);
    const recency = Math.pow(0.5, age / 86_400_000 / HALF_LIFE_DAYS);
    hits.push({
      text: decryptField(r.content, key),
      score: dot(qv, fv) * 0.85 + recency * 0.15,
      at: r.committed_at,
      app: r.source_app,
      windowTitle: r.source_title ? decryptField(r.source_title, key) : "",
      // source_key is a one-way keyed digest, not the URL. The URL for display
      // lives encrypted in source_url, and is NULL for a non-browser capture.
      url: r.source_url ? decryptField(r.source_url, key) : null,
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
