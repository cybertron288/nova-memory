/**
 * Re-measures the R5/R6 §4.1 vector-precision decision against *real*
 * embeddings.
 *
 * The M0 benchmark that made int8 mandatory used synthetic vectors, and the
 * roadmap's M1 closing task calls for re-measuring once real embeddings exist.
 * This is that measurement.
 *
 * Method. The store holds 277 real derivative embeddings (measured 2026-09-17:
 * pairwise cosine p50 0.496, only 0.03% of pairs above 0.95, so genuinely
 * spread rather than clustered). Latency in `sqlite-vec` is brute-force KNN,
 * linear in row count x dimension, so a realistic row count is what the gate
 * actually tests. Real vectors are tiled with small perturbations up to
 * TARGET_ROWS; perturbation keeps clones from being exact duplicates while
 * preserving the corpus's real geometry, which is the property the synthetic
 * benchmark lacked.
 *
 * Honest limits, stated because they bound what this can conclude:
 *   - Tiled clones cluster more tightly than a genuine corpus of the same size,
 *     so recall reads optimistically in absolute terms. The *ranking* between
 *     configurations is the trustworthy output, not the absolute recall figure.
 *   - Ground truth is exact float32 cosine over the same tiled corpus, so
 *     recall measures quantization loss only, never embedding quality.
 */
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { join } from "node:path";
import { homedir } from "node:os";
import { getOrCreateKey } from "../src/keychain";

const SQLCIPHER = "/opt/homebrew/opt/sqlcipher/lib/libsqlcipher.dylib";
const SRC_DB = join(homedir(), "Library/Application Support/Nova", "memory.db");

/** Corpus size to measure at. The §4.1 benchmark used 120k. */
const TARGET_ROWS = Number(process.env.BENCH_ROWS ?? 120_000);
/** Queries per configuration. p50/p95 need enough samples to be stable. */
const QUERIES = Number(process.env.BENCH_QUERIES ?? 30);
/** Over-fetch depth for the int8 -> float rescore path (§4.1 specifies 50). */
const K_OVERFETCH = 50;
/** Final result depth the gate cares about. */
const K_FINAL = 10;
/** The NFR. */
const GATE_MS = 800;

type Vec = Float32Array;

function dot(a: Vec, b: Vec) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
function norm(a: Vec) {
  return Math.sqrt(dot(a, a));
}
function normalized(a: Vec): Vec {
  const n = norm(a) || 1;
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] / n;
  return out;
}
function cosine(a: Vec, b: Vec) {
  return dot(a, b) / ((norm(a) * norm(b)) || 1);
}

/** Reads the real float32 embeddings out of the live store. */
async function loadRealVectors(): Promise<Vec[]> {
  Database.setCustomSQLite(SQLCIPHER);
  const key = await getOrCreateKey("db");
  const db = new Database(SRC_DB, { readonly: true });
  db.exec(`PRAGMA key = "x'${key.toString("hex")}'";`);
  const rows = db
    .prepare("SELECT vector FROM memory_derivative_vectors")
    .all() as { vector: Uint8Array }[];
  db.close();
  return rows.map((r) => {
    // Copy: the row buffer is not guaranteed to outlive the statement.
    const f = new Float32Array(r.vector.byteLength / 4);
    f.set(new Float32Array(r.vector.buffer, r.vector.byteOffset, f.length));
    return f;
  });
}

/**
 * Tiles real vectors up to `target`, perturbing each clone.
 *
 * Perturbation is deliberately small (1% of component magnitude): large enough
 * that clones are distinct points, small enough that the corpus keeps the real
 * pairwise-cosine distribution the originals have.
 */
function tile(reals: Vec[], target: number, dim: number, spread: number): Vec[] {
  const out: Vec[] = [];
  let seed = 12345;
  const rand = () => {
    // Deterministic LCG: the same corpus every run, so configurations are
    // compared on identical data rather than on separate random draws.
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
  while (out.length < target) {
    for (const r of reals) {
      if (out.length >= target) break;
      const v = new Float32Array(dim);
      for (let i = 0; i < dim; i++) v[i] = r[i] * (1 + rand() * spread);
      out.push(v);
    }
  }
  return out;
}

/**
 * float32 -> int8, per-vector max-abs scaling. Copied from `src/search.ts` so
 * the benchmark measures the production quantizer rather than a lookalike.
 *
 * Note this scaling is *scale-invariant*: multiplying a vector by any positive
 * constant leaves the int8 output unchanged, because `max` scales with it. That
 * is why the corpus's non-unit norms (0.699) cost this path nothing, and why
 * pre-normalizing before it is a no-op — measured below as config 2.
 */
function quantizeProd(v: Vec): Int8Array {
  let max = 0;
  for (const x of v) max = Math.max(max, Math.abs(x));
  const scale = max === 0 ? 1 : 127 / max;
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.round(v[i] * scale);
  return q;
}

/** `vec_quantize_int8(?, 'unit')`: fixed [-1,1] range, as the §4.1 text names. */
function quantizeUnit(v: Vec): Int8Array {
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) {
    q[i] = Math.max(-127, Math.min(127, Math.round(v[i] * 127)));
  }
  return q;
}

/** Fresh in-memory vec0 table at the given width and column type. */
function buildIndex(
  vectors: Vec[],
  dim: number,
  kind: "int8" | "float",
  quant: (v: Vec) => Int8Array,
) {
  const db = new Database(":memory:");
  sqliteVec.load(db);
  const decl = kind === "int8" ? `int8[${dim}]` : `float[${dim}]`;
  db.exec(`CREATE VIRTUAL TABLE v USING vec0(id INTEGER PRIMARY KEY, embedding ${decl});`);
  // sqlite-vec misreads a raw buffer bind as float32 regardless of byte
  // length, silently storing garbage into an int8[] column — so int8 goes in
  // through vec_int8() with a JSON array, exactly as src/pipeline.ts does.
  const insert =
    kind === "int8"
      ? db.prepare("INSERT INTO v(id, embedding) VALUES (?, vec_int8(?))")
      : db.prepare("INSERT INTO v(id, embedding) VALUES (?, ?)");
  db.exec("BEGIN");
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    if (kind === "int8") {
      insert.run(i, JSON.stringify(Array.from(quant(v))));
    } else {
      insert.run(i, new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    }
  }
  db.exec("COMMIT");
  return db;
}

function percentile(sorted: number[], p: number) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/**
 * Exact cosine top-k over the corpus: the ground truth recall is measured
 * against.
 *
 * Ties are broken by index so the ordering is deterministic. Without this the
 * tiled corpus — which contains many near-equal clones — produced a different
 * top-10 than `sqlite-vec`'s own ordering for equal distances, and exact
 * float32 scored 98% recall against itself, which is impossible by
 * construction and would have made every figure here suspect.
 */
function exactTopK(corpus: Vec[], query: Vec, k: number): number[] {
  const scored = corpus.map((v, i) => [i, cosine(v, query)] as [number, number]);
  scored.sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]));
  return scored.slice(0, k).map(([i]) => i);
}

async function main() {
  const reals = await loadRealVectors();
  if (reals.length === 0) throw new Error("no embeddings in the store");
  const dim = reals[0].length;
  const norms = reals.map(norm).sort((a, b) => a - b);

  console.log(`real vectors: ${reals.length}  dim: ${dim}`);
  console.log(
    `norm median: ${norms[norms.length >> 1].toFixed(4)} ` +
      `(gemini-embedding-001 does not renormalize truncated dimensions)`,
  );
  console.log(`corpus: ${TARGET_ROWS} rows, ${QUERIES} queries, gate < ${GATE_MS} ms\n`);

  // One corpus, reused by every configuration so differences are the
  // configuration and never the data.
  //
  // SPREAD is the perturbation width, and it is the most consequential knob
  // here. At 120k rows each of the 277 real vectors is cloned ~433 times, so a
  // tight spread makes the true top-10 an arbitrary 10 of one clone family:
  // every candidate is a near-tie and recall then measures tie-breaking rather
  // than quantization loss. A wider spread separates clones enough that the
  // top-10 is a well-defined target. Reported alongside the results because the
  // recall figures are only interpretable relative to it.
  const SPREAD = Number(process.env.BENCH_SPREAD ?? 0.5);
  console.log(`clone spread: ${SPREAD} (each real vector cloned ~${Math.round(TARGET_ROWS / reals.length)}x)\n`);
  const corpusRaw = tile(reals, TARGET_ROWS, dim, SPREAD);
  // Queries are held-out real vectors, not corpus members.
  const queries = reals.slice(0, QUERIES);

  const configs: {
    name: string;
    note: string;
    corpus: Vec[];
    query: (q: Vec) => Vec;
    kind: "int8" | "float";
    quant: (v: Vec) => Int8Array;
    rescore: boolean;
  }[] = [
    {
      name: "1. int8[1536] max-abs + k=50 rescore",
      note: "current production path (src/search.ts quantize)",
      corpus: corpusRaw,
      query: (q) => q,
      kind: "int8",
      quant: quantizeProd,
      rescore: true,
    },
    {
      name: "2. int8[1536] max-abs, pre-normalized",
      note: "control: confirms max-abs scaling is scale-invariant",
      corpus: corpusRaw,
      query: normalized,
      kind: "int8",
      quant: (v) => quantizeProd(normalized(v)),
      rescore: true,
    },
    {
      name: "3. int8[1536] 'unit' quantizer + rescore",
      note: "the fixed [-1,1] quantizer §4.1's text names; loses range at norm 0.699",
      corpus: corpusRaw,
      query: (q) => q,
      kind: "int8",
      quant: quantizeUnit,
      rescore: true,
    },
    {
      name: "4. float32[1536] exact",
      note: "as originally specified in R5/R6, before the §4.1 amendment",
      corpus: corpusRaw,
      query: (q) => q,
      kind: "float",
      quant: quantizeProd,
      rescore: false,
    },
  ];

  // Ground truth is the same for every configuration (same corpus, same
  // queries), so compute it once rather than four times — it is the dominant
  // CPU cost at this row count.
  const truths = queries.map((q) => new Set(exactTopK(corpusRaw, q, K_FINAL)));

  // BENCH_K sweeps the over-fetch depth on the production path alone. The
  // 120k run left 20x latency headroom under the gate, so buying recall with a
  // deeper over-fetch is the cheapest lever available — this measures what it
  // actually buys.
  const sweep = process.env.BENCH_K?.split(",").map(Number);
  if (sweep?.length) {
    console.log("k-sweep on the production path (int8 max-abs + cosine rescore)\n");
    for (const k of sweep) {
      const db = buildIndex(corpusRaw, dim, "int8", quantizeProd);
      const stmt = db.prepare(
        `SELECT id FROM v WHERE embedding MATCH vec_int8(?) AND k = ${k} ORDER BY distance`,
      );
      const times: number[] = [];
      let recallSum = 0;
      for (let qi = 0; qi < queries.length; qi++) {
        const q = queries[qi];
        const qArg = JSON.stringify(Array.from(quantizeProd(q)));
        const t0 = performance.now();
        const ids = (stmt.all(qArg) as { id: number }[])
          .map((r) => r.id)
          .map((id) => [id, cosine(corpusRaw[id], q)] as [number, number])
          .sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]))
          .slice(0, K_FINAL)
          .map(([id]) => id);
        times.push(performance.now() - t0);
        recallSum += ids.filter((id) => truths[qi].has(id)).length / K_FINAL;
      }
      db.close();
      times.sort((a, b) => a - b);
      const p50 = percentile(times, 0.5);
      const p95 = percentile(times, 0.95);
      const recall = (recallSum / queries.length) * 100;
      console.log(
        `  k=${String(k).padStart(4)}   p50 ${p50.toFixed(1).padStart(7)} ms   ` +
          `p95 ${p95.toFixed(1).padStart(8)} ms   recall@10 ${recall.toFixed(1).padStart(5)}%   ` +
          `${p50 < GATE_MS ? "PASS" : "FAIL"}`,
      );
    }
    return;
  }

  for (const cfg of configs) {
    const db = buildIndex(cfg.corpus, dim, cfg.kind, cfg.quant);
    // A float[] vec0 column ranks by L2 distance, not cosine. On a corpus whose
    // vectors vary in magnitude those orderings differ, so an exact float32
    // scan scored well under 100% against a cosine ground truth — impossible by
    // construction, and the third method bug this harness produced before any
    // number here could be trusted. Exact configurations therefore over-fetch
    // and rescore by cosine too: the index narrows, cosine ranks, and every
    // configuration is then measured in one metric.
    const k = K_OVERFETCH;
    // int8 columns need an int8 query vector; vec_int8() is how production
    // passes one (src/search.ts).
    const match = cfg.kind === "int8" ? "vec_int8(?)" : "?";
    const stmt = db.prepare(
      `SELECT id FROM v WHERE embedding MATCH ${match} AND k = ${k} ORDER BY distance`,
    );

    const times: number[] = [];
    let recallSum = 0;

    for (let qi = 0; qi < queries.length; qi++) {
      const rawQuery = queries[qi];
      const q = cfg.query(rawQuery);
      const truth = truths[qi];
      // Production sends the int8 query as a JSON array through vec_int8().
      const qArg: string | Uint8Array =
        cfg.kind === "int8"
          ? JSON.stringify(Array.from(cfg.quant(q)))
          : new Uint8Array(q.buffer, q.byteOffset, q.byteLength);

      const t0 = performance.now();
      let ids = (stmt.all(qArg) as { id: number }[]).map((r) => r.id);
      // Exact float rescore of the over-fetched candidates (§4.1), by cosine,
      // with the same deterministic tie-break as the ground truth.
      ids = ids
        .map((id) => [id, cosine(corpusRaw[id], q)] as [number, number])
        .sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]))
        .slice(0, K_FINAL)
        .map(([id]) => id);
      times.push(performance.now() - t0);

      const hit = ids.filter((id) => truth.has(id)).length;
      recallSum += hit / K_FINAL;
    }

    db.close();   // free the index before building the next configuration's
    times.sort((a, b) => a - b);
    const p50 = percentile(times, 0.5);
    const p95 = percentile(times, 0.95);
    const recall = (recallSum / queries.length) * 100;
    const verdict = p50 < GATE_MS ? "PASS" : "FAIL";

    console.log(cfg.name);
    console.log(`   ${cfg.note}`);
    console.log(
      `   p50 ${p50.toFixed(1)} ms   p95 ${p95.toFixed(1)} ms   ` +
        `recall@10 ${recall.toFixed(1)}%   gate ${verdict}`,
    );
    console.log();
  }
}

await main();
