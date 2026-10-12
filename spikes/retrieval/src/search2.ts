// v2 retrieval (R6): vector-KNN over derivative embeddings -> decrypt
// candidates -> in-memory rerank. There is no keyword arm: FTS5 cannot index
// ciphertext, so recall rests entirely on the vector arm plus a recency
// predicate applied as a filter, not a blended weight.
import type { Database } from "bun:sqlite";
import { decryptField } from "./db2";

export interface Result2 {
  rowid: number;
  text: string;
  committedAt: number;
  score: number;
}

const HALF_LIFE_DAYS = 30;
// Over-fetch: the recency predicate discards candidates after the KNN, so the
// arm must return more than `limit` to survive filtering.
const ARM_K = 40;

export function search2(
  db: Database,
  queryVec: Float32Array,
  opts: { limit?: number; now?: number; maxAgeDays?: number } = {},
): Result2[] {
  const limit = opts.limit ?? 10;
  const now = opts.now ?? Date.now();
  const maxAgeMs = (opts.maxAgeDays ?? 180) * 86_400_000;

  const hits = db
    .prepare(
      `SELECT rowid, distance FROM memory_derivative_embeddings
       WHERE embedding MATCH ? AND k = ? ORDER BY distance`,
    )
    .all(queryVec, ARM_K) as { rowid: number; distance: number }[];

  const fetch = db.prepare(
    "SELECT rowid AS rowid, content, committed_at AS committedAt FROM memory_derivatives WHERE rowid = ?",
  );

  const out: Result2[] = [];
  for (const h of hits) {
    const row = fetch.get(h.rowid) as
      | { rowid: number; content: string; committedAt: number }
      | null;
    if (!row) continue;
    // Recency as a HARD predicate (R6), not a score component.
    const age = now - row.committedAt;
    if (age > maxAgeMs) continue;
    // The decrypt-per-candidate cost is the thing v1 never measured.
    const text = decryptField(row.content);
    const sim = Math.max(0, 1 - (h.distance * h.distance) / 2);
    const recency = Math.pow(0.5, age / 86_400_000 / HALF_LIFE_DAYS);
    out.push({ rowid: row.rowid, text, committedAt: row.committedAt, score: sim * 0.85 + recency * 0.15 });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
