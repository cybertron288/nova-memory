import { openDb } from "./db";
import { buildCorpus, mulberry32, randomUnitVec } from "./corpus";
import { hybridSearch } from "./search";

const N = 120_000;
const END_TS = 1_755_000_000_000;
const DB_PATH = "artifacts/corpus.db";
const QUERIES = [
  "crash screenshot bug", "quarterly planning deck", "promised friday follow up",
  "postgres migration incident", "hiring candidate feedback", "invoice contract renewal",
  "oauth relay schema", "standup notes sprint", "launch beta metrics", "design tokens api",
];

await Bun.$`mkdir -p artifacts`;
const db = openDb(DB_PATH);
const count = (db.prepare("SELECT COUNT(*) AS c FROM snippets").get() as { c: number }).c;
if (count < N) {
  console.log(`building corpus (${N} snippets)…`);
  const t0 = performance.now();
  buildCorpus(db, { snippets: N - count, seed: 1337, endTs: END_TS });
  console.log(`built in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
}

const rng = mulberry32(99);
const latencies: number[] = [];
for (let warm = 0; warm < 5; warm++)
  hybridSearch(db, QUERIES[warm % QUERIES.length]!, randomUnitVec(rng), { now: END_TS });
for (let i = 0; i < 50; i++) {
  const q = QUERIES[i % QUERIES.length]!;
  const v = randomUnitVec(rng);
  const t0 = performance.now();
  hybridSearch(db, q, v, { now: END_TS });
  latencies.push(performance.now() - t0);
}
latencies.sort((a, b) => a - b);
const p = (q: number) => latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))]!;
const p50 = p(0.5), p95 = p(0.95);
const pass = p50 < 800;

const report = `# Spike report: retrieval latency

- Date: 2026-08-12 · machine: ${(await Bun.$`sysctl -n machdep.cpu.brand_string`.text()).trim()}
- Corpus: ${N} snippets (~6 months at ~650/day), dim 768, sqlite-vec + FTS5, single file DB
- Queries: 50 hybrid searches (vector k=40 ∪ keyword k=40 → weighted merge)

| Metric | Value | Gate | Result |
|--------|-------|------|--------|
| p50 | ${p50.toFixed(0)} ms | < 800 ms | ${pass ? "PASS" : "FAIL"} |
| p95 | ${p95.toFixed(0)} ms | < 2000 ms (PRD NFR) | ${p95 < 2000 ? "PASS" : "FAIL"} |

Notes: synthetic random embeddings measure latency only, not ranking quality.
Quality eval against the PRD benchmark query set happens in M1 with real
Gemini embeddings.
`;
await Bun.write("../reports/retrieval.md", report);
console.log(report);
if (!pass) process.exit(1);
