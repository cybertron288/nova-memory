// Encrypted local store (spec 4.2, docs/05 v2.1). Two encryption layers:
// SQLCipher over the whole file, plus per-field AES-256-GCM on anything that
// quotes the user's screen.
import { Database } from "bun:sqlite";
import { chmodSync, existsSync } from "node:fs";
import * as sqliteVec from "sqlite-vec";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import { getOrCreateKey } from "./keychain";
import { DIM } from "./provider";

// Homebrew's prefix differs by architecture: /opt/homebrew on Apple silicon,
// /usr/local on Intel. NOVA_SQLCIPHER overrides both.
const SQLCIPHER = [
  process.env.NOVA_SQLCIPHER,
  "/opt/homebrew/opt/sqlcipher/lib/libsqlcipher.dylib",
  "/usr/local/opt/sqlcipher/lib/libsqlcipher.dylib",
].find((p): p is string => !!p && existsSync(p)) ?? "/opt/homebrew/opt/sqlcipher/lib/libsqlcipher.dylib";

// The embedding dimension belongs to the model, so provider.ts owns it and the
// schema follows. It was declared separately here once, with nothing comparing
// the two: changing the provider's alone — the natural edit when switching
// models — would have left the vec0 column at the old width and sent every
// version through eight retries to embedding_status='failed'. Re-exported so
// existing `import { DIM } from "./db"` call sites keep working against the one
// definition.
export { DIM } from "./provider";

let customSqliteSet = false;

/** enc:v1 = base64(iv[12] || tag[16] || ciphertext). */
export function encryptField(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return "enc:v1:" + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

/**
 * A deterministic, keyed lookup handle for a value that must stay confidential
 * but still serve an equality lookup and a UNIQUE constraint. AES-GCM is
 * randomised per call, so ciphertext cannot be the lookup key; a bare SHA-256
 * could not either, because the space of URLs a person browses is small enough
 * to enumerate offline. The field key is what makes the digest unguessable, so
 * this is HMAC and not a plain hash.
 */
export function lookupDigest(value: string, key: Buffer): string {
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

export function decryptField(stored: string, key: Buffer): string {
  const raw = Buffer.from(stored.slice("enc:v1:".length), "base64");
  const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return d.update(raw.subarray(28)).toString("utf8") + d.final("utf8");
}

/**
 * The store cannot be decrypted: its bytes were edited, or the Keychain key
 * is not the one it was written with. SQLCipher authenticates every page, so
 * either reads as "not a database". Nova does not read on, and does not call
 * Nova Cloud, until the user deletes or restores the file.
 */
export class StoreUnreadable extends Error {
  constructor(path: string, cause: unknown) {
    super(`the store at ${path} cannot be decrypted: it was edited or its key changed`, { cause });
    this.name = "StoreUnreadable";
  }
}

export async function openDb(path: string): Promise<Database> {
  if (!customSqliteSet) { Database.setCustomSQLite(SQLCIPHER); customSqliteSet = true; }
  const dbKey = await getOrCreateKey("db");
  const db = new Database(path);
  // The key must be set before any other statement touches the file.
  db.exec(`PRAGMA key = "x'${dbKey.toString("hex")}'";`);
  // The first read decrypts page 1; a wrong key or an edited page fails here.
  try {
    db.prepare("SELECT count(*) FROM sqlite_master").get();
  } catch (e) {
    db.close();
    if (/not a database|malformed|corrupt/i.test(e instanceof Error ? e.message : String(e))) {
      throw new StoreUnreadable(path, e);
    }
    throw e;
  }
  db.exec("PRAGMA journal_mode = WAL;");
  // Owner-only, like daemon.log. The file is encrypted, but who can copy it
  // is still worth limiting: a stolen copy is an offline attack on the key.
  if (path !== ":memory:") {
    for (const f of [path, `${path}-wal`, `${path}-shm`]) {
      try { chmodSync(f, 0o600); } catch { /* not created yet */ }
    }
  }
  db.exec("PRAGMA foreign_keys = ON;");
  // A delete overwrites what it frees, so deleted text does not sit in free
  // pages until something reuses them (F5.3). The pages are SQLCipher-
  // encrypted either way; this is about what the key can still read.
  db.exec("PRAGMA secure_delete = ON;");
  sqliteVec.load(db);
  db.exec(`
    -- source_key is a keyed digest (see lookupDigest), never the URL itself:
    -- it exists to serve the equality lookup and the UNIQUE constraint below.
    -- The URL a browser capture came from is held encrypted in source_url,
    -- alongside the encrypted source_title (spec 8).
    CREATE TABLE IF NOT EXISTS memory_threads (
      id TEXT PRIMARY KEY, source_app TEXT NOT NULL, source_key TEXT NOT NULL,
      source_title TEXT, source_url TEXT, last_message TEXT, last_timestamp INTEGER,
      last_tree_hash TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(source_app, source_key));
    CREATE INDEX IF NOT EXISTS idx_threads_updated ON memory_threads(updated_at);

    CREATE TABLE IF NOT EXISTS memory_versions (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, hour_bucket INTEGER NOT NULL,
      content TEXT NOT NULL, content_hash TEXT NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0, is_frozen INTEGER NOT NULL DEFAULT 0,
      metadata TEXT, parent_version_id TEXT, committed_at INTEGER NOT NULL,
      embedding_status TEXT NOT NULL DEFAULT 'pending',
      raw_purged_at INTEGER,
      FOREIGN KEY (thread_id) REFERENCES memory_threads(id));
    CREATE INDEX IF NOT EXISTS idx_versions_thread_mutable
      ON memory_versions(thread_id, is_frozen);

    CREATE TABLE IF NOT EXISTS memory_derivatives (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, version_id TEXT NOT NULL,
      content TEXT NOT NULL, content_hash TEXT NOT NULL,
      committed_at INTEGER NOT NULL,
      embedding_status TEXT NOT NULL DEFAULT 'pending',
      FOREIGN KEY (thread_id) REFERENCES memory_threads(id),
      FOREIGN KEY (version_id) REFERENCES memory_versions(id));
    CREATE INDEX IF NOT EXISTS idx_derivatives_committed
      ON memory_derivatives(committed_at);

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_derivative_embeddings
      USING vec0(derivative_id TEXT PRIMARY KEY, embedding int8[${DIM}]);
    CREATE TABLE IF NOT EXISTS memory_derivative_vectors (
      derivative_id TEXT PRIMARY KEY, vector BLOB NOT NULL);

    CREATE TABLE IF NOT EXISTS message_fingerprints (
      fingerprint TEXT PRIMARY KEY, thread_id TEXT NOT NULL, seen_at INTEGER NOT NULL);

    -- status/claimed_at exist so an in-flight job is distinguishable from a
    -- waiting one. Without them two overlapping drains (a slow provider plus
    -- the 15s tick) both select the same row and both pay the provider for it;
    -- the commit is idempotent so the store stays correct, but the call is
    -- billed twice. A row is reclaimable once claimed_at falls outside
    -- CLAIM_TIMEOUT_MS, which is what makes a killed process recoverable
    -- without a separate janitor.
    CREATE TABLE IF NOT EXISTS memory_retry_queue (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, version_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','processing')),
      claimed_at INTEGER,
      parked_at INTEGER, last_error TEXT,
      UNIQUE(kind, version_id));

    -- F4 open loops (PRD F4.1-F4.2, schema per data-model.md §1.2).
    --
    -- Two deliberate departures from that spec, both recorded in D11:
    --   - 'counterparty' is a plain name string, not a FK into 'entities'.
    --     Entities, facts and fact_embeddings are specified but unbuilt, and
    --     waiting on them would roughly double M2. The column already holds the
    --     names, so resolving them to ids later is one backfill pass.
    --   - No 'loop_embeddings' table. Closure detection reuses the derivative
    --     vectors it already has rather than embedding loops separately.
    --
    -- 'description' and 'closure_sig' are field-encrypted like every other piece
    -- of captured content: a loop quotes what someone said.
    CREATE TABLE IF NOT EXISTS open_loops (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      description TEXT NOT NULL,
      direction TEXT NOT NULL
        CHECK(direction IN ('i_owe','owed_to_me','unanswered','stalled')),
      counterparty TEXT,
      due_signal TEXT,
      due_at INTEGER,
      state TEXT NOT NULL
        CHECK(state IN ('candidate','open','auto_resolved','user_resolved','snoozed','dismissed')),
      snoozed_until INTEGER,
      closure_sig TEXT NOT NULL,
      resolved_at INTEGER,
      resolve_evidence TEXT REFERENCES memory_derivatives(id),
      feedback INTEGER,
      -- Not in the spec: dedup. Loop detection runs per version, and a
      -- commitment restated across three captures of the same thread is one
      -- loop, not three. Hash of the normalized description, unique per
      -- direction+counterparty.
      dedup_key TEXT NOT NULL,
      -- The capture that opened the loop. Lets a delete find loops that have
      -- no evidence row (a capture that yielded loops but no memories).
      version_id TEXT,
      UNIQUE(dedup_key));
    CREATE INDEX IF NOT EXISTS idx_loops_state ON open_loops(state, created_at);

    CREATE TABLE IF NOT EXISTS loop_evidence (
      loop_id TEXT NOT NULL REFERENCES open_loops(id),
      derivative_id TEXT NOT NULL REFERENCES memory_derivatives(id),
      PRIMARY KEY (loop_id, derivative_id));

    -- Small key/value table for facts about the store itself. Its first
    -- tenant is embedding_dim (see assertEmbeddingDim).
    CREATE TABLE IF NOT EXISTS store_metadata (
      key TEXT PRIMARY KEY, value TEXT NOT NULL);

    -- The user's own exclusion list (D21). Additive only: it never subtracts
    -- from the non-overridable refusals in sensitive.ts.
    --
    -- value is encrypted and value_key is its HMAC digest, for the same
    -- reason as memory_threads.source_key: what a person chooses to exclude
    -- says what they consider sensitive, and the set of apps and domains is
    -- small enough to enumerate offline against a bare hash.
    -- What left the machine, for the transparency panel (F5.5). Metadata
    -- only: no prompt, no reply, no captured text. The panel exists to show
    -- the user what Nova sent, and a log that quoted the content would be
    -- one more copy of exactly what it is reassuring them about.
    CREATE TABLE IF NOT EXISTS provider_calls (
      id TEXT PRIMARY KEY,
      at INTEGER NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('chat','embed')),
      outcome TEXT NOT NULL CHECK (outcome IN ('ok','error')),
      ms INTEGER NOT NULL,
      input_chars INTEGER NOT NULL,
      items INTEGER NOT NULL,
      status INTEGER,
      detail TEXT,
      -- Why the call was made, and which captures (memory_versions ids, as
      -- a JSON array) it carried. Ids only: the Inspector links a request to
      -- the captures it sent without this table holding any of their text.
      purpose TEXT,
      capture_ids TEXT);
    CREATE INDEX IF NOT EXISTS provider_calls_at ON provider_calls (at DESC);

    -- How many windows each refusal rule has skipped (F5.5's Blocked apps
    -- pane promises a count). Persistent, because ingest's own tally is
    -- flushed to stderr and lost on restart, and the pane's number has to
    -- mean "ever" rather than "since this daemon started".
    --
    -- rule_id is either a hard-exclusion category ('banking') or a
    -- user_exclusions.id. No FK: a count outlives the exclusion it belonged
    -- to, and deleting a rule should not rewrite history.
    CREATE TABLE IF NOT EXISTS skip_counts (
      rule_id TEXT PRIMARY KEY,
      skipped INTEGER NOT NULL DEFAULT 0,
      last_at INTEGER);

    -- value is what is matched: a bundle id for an app chosen from the
    -- picker, a host for a site, or an app's name for a rule added before
    -- bundle ids existed (and by nova exclude --app). label is what the
    -- pane shows when the value is an id nobody reads: "Signal", beside
    -- org.whispersystems.signal-desktop.
    --
    -- One app kind rather than two: the pane cannot ask "by name or by
    -- bundle?", because that is a question about Nova's storage, not about
    -- the user's intent.
    CREATE TABLE IF NOT EXISTS user_exclusions (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('app','domain')),
      value TEXT NOT NULL,
      value_key TEXT NOT NULL,
      label TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE (kind, value_key));
  `);
  migrateRetryQueueClaims(db);
  migrateRetryQueueParking(db);
  migrateForgetColumns(db);
  migrateExclusionLabels(db);
  migrateProviderCallLinks(db);
  assertEmbeddingDim(db, DIM);
  migrateVectorsToUnitLength(db);
  return db;
}

/**
 * Scale a vector to length 1. Search ranks by a raw dot product, which is
 * cosine only between unit vectors. gemini-embedding-001 returns unit vectors
 * at 3072 dims alone: its 1536 truncation measured length ~0.69 (2026-10-08),
 * so magnitude leaked into the score and its balance against recency.
 * A zero vector comes back unchanged.
 */
export function unitVector(v: Float32Array): Float32Array {
  let sq = 0;
  for (const x of v) sq += x * x;
  if (sq === 0) return v;
  const inv = 1 / Math.sqrt(sq);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! * inv;
  return out;
}

/**
 * Columns Your data needs (F5.3/F5.4) on a store created before them:
 * memory_versions.raw_purged_at, set when retention blanks a capture's text,
 * and open_loops.version_id, the capture that opened a loop.
 */
function migrateForgetColumns(db: Database) {
  const has = (table: string, col: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
  if (!has("memory_versions", "raw_purged_at")) {
    db.exec("ALTER TABLE memory_versions ADD COLUMN raw_purged_at INTEGER");
  }
  if (!has("open_loops", "version_id")) db.exec("ALTER TABLE open_loops ADD COLUMN version_id TEXT");
}

const VECTORS_UNIT_KEY = "vectors_unit_length";

/**
 * Rescales every stored float32 sidecar vector to unit length, once.
 *
 * The int8 index is left alone on purpose: quantize() scales each vector by
 * its own max-abs value, so a vector and its unit-length copy quantize to the
 * same int8 row (up to float rounding). Only the rescore source changes.
 */
function migrateVectorsToUnitLength(db: Database) {
  if (db.prepare("SELECT 1 FROM store_metadata WHERE key=?").get(VECTORS_UNIT_KEY)) return;
  const rows = db.prepare("SELECT derivative_id, vector FROM memory_derivative_vectors")
    .all() as { derivative_id: string; vector: Uint8Array }[];
  const update = db.prepare("UPDATE memory_derivative_vectors SET vector=? WHERE derivative_id=?");
  db.transaction(() => {
    for (const r of rows) {
      const bytes = r.vector.slice();
      const v = unitVector(new Float32Array(bytes.buffer, 0, bytes.byteLength / 4));
      update.run(Buffer.from(v.buffer), r.derivative_id);
    }
    db.prepare("INSERT INTO store_metadata (key, value) VALUES (?,?)")
      .run(VECTORS_UNIT_KEY, String(Date.now()));
  })();
  if (rows.length > 0) {
    console.error(`[db] rescaled ${rows.length} stored vectors to unit length`);
  }
}

/**
 * Adds status/claimed_at to a queue created before they existed.
 *
 * `CREATE TABLE IF NOT EXISTS` leaves an existing table alone, so a store from
 * an earlier version keeps the old three-column queue and every claim query
 * fails on the missing column. `ADD COLUMN` with a constant default does not
 * rewrite the table and is safe under SQLCipher.
 *
 * The CHECK constraint is deliberately not added here: SQLite cannot add one to
 * an existing table without a full table rebuild, and the value is only ever
 * written by this module. New stores get it from the schema above.
 */
function migrateRetryQueueClaims(db: Database) {
  const cols = db.prepare("PRAGMA table_info(memory_retry_queue)").all() as {
    name: string;
  }[];
  const have = new Set(cols.map((c) => c.name));
  if (!have.has("status")) {
    db.exec("ALTER TABLE memory_retry_queue ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'");
  }
  if (!have.has("claimed_at")) {
    db.exec("ALTER TABLE memory_retry_queue ADD COLUMN claimed_at INTEGER");
  }
}

/**
 * Lets a queue row be parked instead of deleted.
 *
 * A row used to be deleted after MAX_ATTEMPTS, so a capture left the queue
 * without ever succeeding — eight of them overnight on 2026-10-08, while the
 * Mac was offline. Now a row leaves the queue only on success; giving up sets
 * `parked_at`, and Your Space or `nova retry` puts it back. `last_error` is
 * field-encrypted: provider error bodies can echo the request.
 *
 * Versions given up on before this existed have embedding_status='failed' and
 * no row. They get a parked row here, so they can be retried too. Idempotent:
 * a version with any queue row is skipped.
 */
function migrateRetryQueueParking(db: Database) {
  const cols = db.prepare("PRAGMA table_info(memory_retry_queue)").all() as { name: string }[];
  const have = new Set(cols.map((c) => c.name));
  if (!have.has("parked_at")) db.exec("ALTER TABLE memory_retry_queue ADD COLUMN parked_at INTEGER");
  if (!have.has("last_error")) db.exec("ALTER TABLE memory_retry_queue ADD COLUMN last_error TEXT");
  const now = Date.now();
  const orphans = db.prepare(
    `SELECT v.id FROM memory_versions v
      WHERE v.embedding_status = 'failed'
        AND NOT EXISTS (SELECT 1 FROM memory_retry_queue q WHERE q.version_id = v.id)`,
  ).all() as { id: string }[];
  if (orphans.length === 0) return;
  const park = db.prepare(
    `INSERT INTO memory_retry_queue (id, kind, version_id, attempts, next_attempt_at, parked_at)
     VALUES (?, 'extract', ?, 0, 0, ?)`,
  );
  db.transaction(() => { for (const o of orphans) park.run(randomUUID(), o.id, now); })();
  console.error(`[db] parked ${orphans.length} previously abandoned capture(s) for retry`);
}

/**
 * Adds `label` to an exclusion list created before app rules stored a bundle
 * id. Nullable: a row added by name has nothing to label, and its `value` is
 * already the readable thing.
 */
function migrateExclusionLabels(db: Database) {
  const cols = db.prepare("PRAGMA table_info(user_exclusions)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "label")) {
    db.exec("ALTER TABLE user_exclusions ADD COLUMN label TEXT");
  }
}

/**
 * Adds purpose/capture_ids to a call log created before the Inspector linked
 * requests to captures. Both are nullable, so rows logged before simply have
 * no link — they are not guessed at.
 */
function migrateProviderCallLinks(db: Database) {
  const cols = db.prepare("PRAGMA table_info(provider_calls)").all() as { name: string }[];
  const have = new Set(cols.map((c) => c.name));
  if (!have.has("purpose")) db.exec("ALTER TABLE provider_calls ADD COLUMN purpose TEXT");
  if (!have.has("capture_ids")) db.exec("ALTER TABLE provider_calls ADD COLUMN capture_ids TEXT");
}

const EMBEDDING_DIM_KEY = "embedding_dim";

/**
 * Bind this store to one embedding width, and refuse to open it under another.
 *
 * The vec0 index is declared int8[DIM] when the schema is created and the
 * float32 sidecar is read back with a fixed element count. Point an existing
 * store at a 768-dimension model and nothing throws on its own: writes go in
 * at the wrong width and every subsequent query scores against vectors that
 * mean nothing. That is exactly the silent failure spec 7 forbids, so the
 * dimension is recorded the first time a store is opened and compared on
 * every open after that.
 *
 * There is deliberately no auto-migration. Re-embedding every derivative is a
 * decision with a cost, and making it silently on the user's behalf would
 * throw away the existing index without asking.
 */
export function assertEmbeddingDim(db: Database, dim: number): void {
  const row = db.prepare("SELECT value FROM store_metadata WHERE key=?")
    .get(EMBEDDING_DIM_KEY) as { value: string } | null;
  if (!row) {
    db.prepare("INSERT INTO store_metadata (key, value) VALUES (?,?)")
      .run(EMBEDDING_DIM_KEY, String(dim));
    return;
  }
  const stored = Number(row.value);
  if (stored !== dim) {
    throw new Error(
      `This store was indexed with ${stored}-dimension embeddings, but the `
      + `configured embedding dimension is ${dim}. Nova will not mix the two: `
      + `every vector already stored is ${stored}-dimension, so searches would `
      + `silently return nonsense. Either restore the ${stored}-dimension `
      + `embedding model, or re-index the store from scratch.`);
  }
}

/** The field key, for encrypting content columns. */
export async function fieldKey(): Promise<Buffer> { return getOrCreateKey("field"); }
