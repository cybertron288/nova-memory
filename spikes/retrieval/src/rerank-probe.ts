// Does int8 over-fetch + exact float rescore recover the recall that raw int8
// KNN loses? Deliberately SMALL (8k rows): we are measuring recall, which is
// scale-insensitive, not latency, which is not. Latency vs corpus size is
// measured separately in dim-scaling.ts.
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";

Database.setCustomSQLite("/opt/homebrew/opt/sqlcipher/lib/libsqlcipher.dylib");

const DIM = 1536;
const N = 8_000;
const K = 10;
const PATH = "artifacts/rerank-probe.db";

function mul(s: number) {
  let a = s >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function uv(rng: () => number, d: number) {
  const v = new Float32Array(d);
  let n = 0;
  for (let i = 0; i < d; i++) { v[i] = rng() * 2 - 1; n += v[i]! * v[i]!; }
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < d; i++) v[i]! /= n;
  return v;
}
function dot(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

await Bun.$`mkdir -p artifacts`;
await Bun.$`rm -f ${PATH} ${PATH}-wal ${PATH}-shm`.quiet().nothrow();

const db = new Database(PATH);
db.exec("PRAGMA key='probe';");
sqliteVec.load(db);
db.exec(`CREATE VIRTUAL TABLE vf USING vec0(embedding float[${DIM}]);`);
db.exec(`CREATE VIRTUAL TABLE vi USING vec0(embedding int8[${DIM}]);`);
db.exec("CREATE TABLE raw(id INTEGER PRIMARY KEY, v BLOB);");

const rng = mul(7);
const insF = db.prepare("INSERT INTO vf (rowid,embedding) VALUES (?,?)");
const insI = db.prepare("INSERT INTO vi (rowid,embedding) VALUES (?, vec_quantize_int8(?, 'unit'))");
const insR = db.prepare("INSERT INTO raw (id,v) VALUES (?,?)");
for (let s = 0; s < N; s += 1000) {
  db.transaction(() => {
    for (let i = s; i < Math.min(s + 1000, N); i++) {
      const v = uv(rng, DIM);
      insF.run(i + 1, v);
      insI.run(i + 1, v);
      insR.run(i + 1, Buffer.from(v.buffer.slice(0)));
    }
  })();
}

const qf = db.prepare(`SELECT rowid FROM vf WHERE embedding MATCH ? AND k=${K} ORDER BY distance`);
const getRaw = db.prepare("SELECT v FROM raw WHERE id=?");

console.log(`corpus ${N} x ${DIM}d, recall@${K} vs exact float ranking:`);
for (const OVER of [K, 50, 100, 200]) {
  const qi = db.prepare(
    `SELECT rowid FROM vi WHERE embedding MATCH vec_quantize_int8(?, 'unit') AND k=${OVER} ORDER BY distance`,
  );
  let rec = 0;
  const TRIALS = 20;
  for (let t = 0; t < TRIALS; t++) {
    const q = uv(rng, DIM);
    const gt = new Set((qf.all(q) as any[]).map((r) => r.rowid));
    const cand = (qi.all(q) as any[]).map((r) => r.rowid);
    // Exact rescore of the over-fetched candidates against float vectors.
    const scored = cand.map((id) => {
      const row = getRaw.get(id) as { v: Buffer };
      const fv = new Float32Array(row.v.buffer, row.v.byteOffset, DIM);
      return { id, s: dot(q, fv) };
    });
    scored.sort((a, b) => b.s - a.s);
    rec += scored.slice(0, K).filter((x) => gt.has(x.id)).length / K;
  }
  const label = OVER === K ? `${OVER} (no over-fetch)` : `${OVER}`;
  console.log(`  over-fetch ${label}: recall@${K} = ${(100 * rec / TRIALS).toFixed(1)}%`);
}
db.close();
await Bun.$`rm -f ${PATH} ${PATH}-wal ${PATH}-shm`.quiet().nothrow();
