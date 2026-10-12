// v2 store: matches the reconciled data model (docs 05 v2.0, R4-R6).
// Differences from v1 (src/db.ts) that make this a different cost profile:
//   - SQLCipher-encrypted DB (was plaintext)
//   - derivatives are the retrieval unit (was raw snippets)
//   - 1536-dim vectors (was 768)
//   - NO FTS5: keyword search on ciphertext is impossible
//   - content is per-field AES-256-GCM (enc:v1) and must be DECRYPTED per hit
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const SQLCIPHER = "/opt/homebrew/opt/sqlcipher/lib/libsqlcipher.dylib";
export const DIM = 1536;

// Spike-only key material. Real builds derive per-install keys and hold them in
// the Keychain (R8 #1/#2); a constant here is fine for measuring latency.
const DB_KEY = "nova-spike-db-key";
const FIELD_KEY = Buffer.alloc(32, 7);

let customSqliteSet = false;

export function openDb2(path = ":memory:"): Database {
  if (!customSqliteSet) {
    Database.setCustomSQLite(SQLCIPHER);
    customSqliteSet = true;
  }
  const db = new Database(path);
  // Key must be set before any other statement touches the file.
  db.exec(`PRAGMA key = '${DB_KEY}';`);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  sqliteVec.load(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_threads (
      id TEXT PRIMARY KEY,
      source_app TEXT NOT NULL,
      source_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_derivatives (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      content TEXT NOT NULL,          -- enc:v1 ciphertext
      committed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_deriv_committed
      ON memory_derivatives(committed_at);
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_derivative_embeddings
      USING vec0(embedding float[${DIM}]);
  `);
  return db;
}

// enc:v1 = base64(iv[12] || tag[16] || ciphertext) — the same layout the daemon uses.
export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", FIELD_KEY, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return "enc:v1:" + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function decryptField(stored: string): string {
  const raw = Buffer.from(stored.slice("enc:v1:".length), "base64");
  const d = createDecipheriv("aes-256-gcm", FIELD_KEY, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return d.update(raw.subarray(28)).toString("utf8") + d.final("utf8");
}

export function insertDerivative(
  db: Database,
  d: { id: string; threadId: string; text: string; committedAt: number; embedding: Float32Array },
  rowid: number,
): void {
  db.prepare(
    "INSERT INTO memory_derivatives (id, thread_id, content, committed_at) VALUES (?, ?, ?, ?)",
  ).run(d.id, d.threadId, encryptField(d.text), d.committedAt);
  db.prepare("INSERT INTO memory_derivative_embeddings (rowid, embedding) VALUES (?, ?)")
    .run(rowid, d.embedding);
}
