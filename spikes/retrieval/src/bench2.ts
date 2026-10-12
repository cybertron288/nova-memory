// v2 bench: retrieval latency under the RECONCILED model (R4-R6).
// v1 measured p50 157 ms on a plaintext FTS5 hybrid over 768-dim snippets --
// a schema the reconciliation discarded. This re-measures the model we will
// actually build: SQLCipher + 1536-dim vectors + decrypt-per-candidate + no
// FTS5. Same 120k retrieval units so the numbers are comparable.
import { openDb2, insertDerivative, DIM } from "./db2";
import { mulberry32 } from "./corpus";

const N = 120_000;
const END_TS = 1_755_000_000_000;
const DB_PATH = "artifacts/corpus2.db";

function unitVec(rng: () => number): Float32Array {
  const v = new Float32Array(DIM);
  let norm = 0;
  for (let i = 0; i < DIM; i++) {
    v[i] = rng() * 2 - 1;
    norm += v[i]! * v[i]!;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) v[i]! /= norm;
  return v;
}

const WORDS = (
  "deck review jordan bug screenshot crash deploy invoice roadmap sprint standup " +
  "budget offsite hiring candidate contract renewal migration postgres relay oauth " +
  "onboarding metrics dashboard retention launch beta feedback ticket incident oncall"
).split(" ");

await Bun.$`mkdir -p artifacts`;
const db = openDb2(DB_PATH);
const have = (db.prepare("SELECT COUNT(*) AS c FROM memory_derivatives").get() as { c: number }).c;

if (have < N) {
  console.log(`building encrypted corpus (${N} derivatives, dim ${DIM})…`);
  const t0 = performance.now();
  const rng = mulberry32(1337);
  db.prepare("INSERT OR IGNORE INTO memory_threads (id,source_app,source_key,created_at) VALUES ('t1','Slack','k',0)").run();
  const BATCH = 500;
  for (let start = have; start < N; start += BATCH) {
    const end = Math.min(start + BATCH, N);
    db.transaction(() => {
      for (let i = start; i < end; i++) {
        // Derivatives are short atomic sentences (22-432 chars in practice).
        const len = 8 + Math.floor(rng() * 14);
        const words: string[] = [];
        for (let w = 0; w < len; w++) words.push(WORDS[Math.floor(rng() * WORDS.length)]!);
        const day = Math.floor(i / 650);
        insertDerivative(
          db,
          {
            id: `d${i}`,
            threadId: "t1",
            text: words.join(" "),
            committedAt: END_TS - day * 86_400_000 - Math.floor(rng() * 8 * 3_600_000),
            embedding: unitVec(rng),
          },
          i + 1,
        );
      }
    })();
    if ((start / BATCH) % 40 === 0) console.log(`  ${start}/${N}`);
  }
  console.log(`built in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
}

const { search2 } = await import("./search2");
const rng = mulberry32(99);
for (let w = 0; w < 5; w++) search2(db, unitVec(rng), { now: END_TS });

const lat: number[] = [];
for (let i = 0; i < 50; i++) {
  const v = unitVec(rng);
  const t0 = performance.now();
  search2(db, v, { now: END_TS });
  lat.push(performance.now() - t0);
}
lat.sort((a, b) => a - b);
const p = (q: number) => lat[Math.min(lat.length - 1, Math.floor(q * lat.length))]!;
console.log(JSON.stringify({ p50: p(0.5), p95: p(0.95), max: lat[lat.length - 1] }, null, 2));
