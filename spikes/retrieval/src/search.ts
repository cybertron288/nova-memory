import type { Database } from "bun:sqlite";

export interface SearchResult {
  id: number;
  text: string;
  app: string;
  capturedAt: number;
  score: number;
}

const W_VEC = 0.55;
const W_KW = 0.3;
const W_REC = 0.15;
const HALF_LIFE_DAYS = 30;
const ARM_K = 40; // candidates per arm before merge

// FTS5 treats bare tokens as column filters etc.; quote each token, OR them.
function ftsQuery(q: string): string {
  const tokens = q.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t}"`).join(" OR ");
}

export function hybridSearch(
  db: Database,
  queryText: string,
  queryVec: Float32Array,
  opts: { limit?: number; now?: number } = {},
): SearchResult[] {
  const limit = opts.limit ?? 10;
  const now = opts.now ?? Date.now();

  // Vector arm: sqlite-vec returns L2 distance; unit vectors → sim = 1 - d²/2.
  const vecRows = db
    .prepare(
      `SELECT rowid AS id, distance FROM vec_snippets
       WHERE embedding MATCH ? AND k = ? ORDER BY distance`,
    )
    .all(queryVec, ARM_K) as { id: number; distance: number }[];
  const vecSim = new Map(
    vecRows.map((r) => [r.id, Math.max(0, 1 - (r.distance * r.distance) / 2)]),
  );

  // Keyword arm: bm25() is lower-is-better; normalize to 0..1 within the arm.
  const kwRows = db
    .prepare(
      `SELECT rowid AS id, bm25(snippets_fts) AS rank FROM snippets_fts
       WHERE snippets_fts MATCH ? ORDER BY rank LIMIT ?`,
    )
    .all(ftsQuery(queryText), ARM_K) as { id: number; rank: number }[];
  const kwScore = new Map<number, number>();
  if (kwRows.length > 0) {
    const best = kwRows[0]!.rank;
    const worst = kwRows[kwRows.length - 1]!.rank;
    const span = worst - best || 1;
    for (const r of kwRows) kwScore.set(r.id, (worst - r.rank) / span || 1);
  }

  // Merge candidate ids; when both arms are empty, fall back to most recent.
  const ids = new Set<number>([...vecSim.keys(), ...kwScore.keys()]);
  if (ids.size === 0) {
    const recent = db
      .prepare("SELECT id FROM snippets ORDER BY captured_at DESC LIMIT ?")
      .all(limit) as { id: number }[];
    for (const r of recent) ids.add(r.id);
  }

  const fetch = db.prepare(
    "SELECT id, text, app, captured_at AS capturedAt FROM snippets WHERE id = ?",
  );
  const results: SearchResult[] = [];
  for (const id of ids) {
    const row = fetch.get(id) as Omit<SearchResult, "score"> | null;
    if (!row) continue;
    const ageDays = Math.max(0, (now - row.capturedAt) / 86_400_000);
    const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    const score =
      W_VEC * (vecSim.get(id) ?? 0) +
      W_KW * (kwScore.get(id) ?? 0) +
      W_REC * recency;
    results.push({ ...row, score });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
