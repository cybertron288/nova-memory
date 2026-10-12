// Which part of the v2 search costs the 1487 ms? Three suspects:
//   (a) 1536-dim KNN scan       (b) SQLCipher page decryption on row fetch
//   (c) per-candidate AES-GCM field decrypt
// Time them separately against the same corpus.
import { openDb2, decryptField, DIM } from "./db2";
import { mulberry32 } from "./corpus";

const END_TS = 1_755_000_000_000;
const db = openDb2("artifacts/corpus2.db");

function unitVec(rng: () => number): Float32Array {
  const v = new Float32Array(DIM);
  let n = 0;
  for (let i = 0; i < DIM; i++) { v[i] = rng() * 2 - 1; n += v[i]! * v[i]!; }
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < DIM; i++) v[i]! /= n;
  return v;
}

const rng = mulberry32(99);
const knnStmt = db.prepare(
  `SELECT rowid, distance FROM memory_derivative_embeddings
   WHERE embedding MATCH ? AND k = ? ORDER BY distance`,
);
const fetchStmt = db.prepare(
  "SELECT rowid AS rowid, content, committed_at AS committedAt FROM memory_derivatives WHERE rowid = ?",
);

const med = (xs: number[]) => { xs.sort((a, b) => a - b); return xs[Math.floor(xs.length / 2)]!; };

// warm
for (let i = 0; i < 3; i++) knnStmt.all(unitVec(rng), 40);

const knn: number[] = [], fetch: number[] = [], dec: number[] = [];
for (let i = 0; i < 25; i++) {
  const v = unitVec(rng);
  let t = performance.now();
  const hits = knnStmt.all(v, 40) as { rowid: number }[];
  knn.push(performance.now() - t);

  const rows: string[] = [];
  t = performance.now();
  for (const h of hits) {
    const r = fetchStmt.get(h.rowid) as { content: string } | null;
    if (r) rows.push(r.content);
  }
  fetch.push(performance.now() - t);

  t = performance.now();
  for (const c of rows) decryptField(c);
  dec.push(performance.now() - t);
}

console.log(JSON.stringify({
  knn_ms: +med(knn).toFixed(1),
  rowFetch_ms: +med(fetch).toFixed(1),
  fieldDecrypt_ms: +med(dec).toFixed(2),
}, null, 2));
