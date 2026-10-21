import { test, expect } from "bun:test";
import { openDb, encryptField, decryptField, DIM, assertEmbeddingDim, unitVector, StoreUnreadable } from "../src/db";
import { deleteKey } from "../src/keychain";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { closeSync, mkdtempSync, openSync, unlinkSync, writeSync } from "node:fs";

test("field encryption round-trips and does not leak plaintext", () => {
  const key = randomBytes(32);
  const secret = "Jordan asked for the Q3 deck by Friday";
  const enc = encryptField(secret, key);
  expect(enc.startsWith("enc:v1:")).toBe(true);
  expect(enc).not.toContain("Jordan");
  expect(decryptField(enc, key)).toBe(secret);
});

test("schema creates the thread/version/derivative tables and both vector stores", async () => {
  const db = await openDb(":memory:");
  const names = db.prepare(
    "SELECT name FROM sqlite_master WHERE type IN ('table','view')"
  ).all().map((r: any) => r.name);
  for (const t of ["memory_threads", "memory_versions", "memory_derivatives",
                   "memory_derivative_vectors", "message_fingerprints",
                   "memory_retry_queue"]) {
    expect(names).toContain(t);
  }
  // The scanned index is int8; the rescore sidecar holds float32 (R5/R6 4.1).
  const ddl = db.prepare(
    "SELECT sql FROM sqlite_master WHERE name='memory_derivative_embeddings'"
  ).get() as any;
  expect(ddl.sql).toContain(`int8[${DIM}]`);
});

test("file-based database is encrypted at rest — no plaintext marker, no SQLite header", async () => {
  const path = `${tmpdir()}/nova-db-encryption-test-${Date.now()}.sqlite`;
  const marker = "SQLCIPHER-CANARY-b7f3e1";
  try {
    const db = await openDb(path);
    db.exec(`
      INSERT INTO memory_threads
        (id, source_app, source_key, created_at, updated_at)
      VALUES ('t1', 'app', '${marker}', 0, 0);
    `);
    db.close();

    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    const raw = Buffer.from(bytes).toString("latin1");

    expect(raw).not.toContain(marker);
    expect(raw.startsWith("SQLite format 3")).toBe(false);
  } finally {
    for (const suffix of ["", "-wal", "-shm"]) {
      await Bun.file(path + suffix).delete().catch(() => {});
    }
  }
});

test("the store records its embedding dimension on first open", async () => {
  const db = await openDb(":memory:");
  const row = db.prepare("SELECT value FROM store_metadata WHERE key='embedding_dim'")
    .get() as { value: string };
  expect(row.value).toBe(String(DIM));
});

test("the dimension guard rejects a mismatch, naming both values in their roles", async () => {
  // Switching embedding models against an existing store is the failure this
  // exists for: the vec0 column stays int8[1536] and the float32 sidecar is
  // read back at a fixed width, so a 768-dim model would write and query
  // garbage without ever throwing. The guard has to be the thing that throws.
  //
  // Both numbers are asserted *in their roles*, not merely present. An earlier
  // version of this test checked `toContain("768")` and `toContain("1536")`
  // against a 1536-store queried at 768 — where 1536 appears as the CONFIGURED
  // dim whether or not the stored dim is reported at all. Dropping the stored
  // value from the message left that assertion green. Use two distinct widths
  // and pin which is which.
  const db = await openDb(":memory:");
  db.prepare("UPDATE store_metadata SET value='768' WHERE key='embedding_dim'").run();
  const err = (() => {
    try { assertEmbeddingDim(db, DIM); return null; } catch (e) { return e as Error; }
  })();
  expect(err).not.toBeNull();
  expect(err!.message).toContain("indexed with 768-dimension");
  expect(err!.message).toContain(`configured embedding dimension is ${DIM}`);
  expect(err!.message).toMatch(/re-index/i);
});

test("the dimension guard passes when the configured width matches the stored one", async () => {
  const db = await openDb(":memory:");
  expect(() => assertEmbeddingDim(db, DIM)).not.toThrow();
});

test("reopening a file-backed store checks the recorded dimension, not a fresh default", async () => {
  // :memory: cannot show this — the recorded value has to survive a close and
  // come back to be compared against on the next open.
  const path = `${tmpdir()}/nova-dim-guard-${Date.now()}.sqlite`;
  try {
    (await openDb(path)).close();
    const reopened = await openDb(path);
    const row = reopened.prepare("SELECT value FROM store_metadata WHERE key='embedding_dim'")
      .get() as { value: string };
    expect(row.value).toBe(String(DIM));
    // Now pretend the store was built by a 768-dim model and re-run the check.
    reopened.prepare("UPDATE store_metadata SET value='768' WHERE key='embedding_dim'").run();
    expect(() => assertEmbeddingDim(reopened, DIM)).toThrow("768");
    reopened.close();
  } finally {
    for (const f of [path, `${path}-wal`, `${path}-shm`]) {
      try { unlinkSync(f); } catch {}
    }
  }
});

test("unitVector scales to length 1 and leaves a zero vector alone", () => {
  const v = unitVector(new Float32Array([3, 4]));
  expect(Array.from(v).map((x) => +x.toFixed(6))).toEqual([0.6, 0.8]);
  expect(Array.from(unitVector(new Float32Array(3)))).toEqual([0, 0, 0]);
});

test("opening a store rescales stored sidecar vectors to unit length, once", async () => {
  // gemini-embedding-001 at 1536 dims returned length ~0.69, and search ranks
  // by a raw dot product. A store written before the fix holds those vectors.
  const path = `${tmpdir()}/nova-unit-vectors-${Date.now()}.sqlite`;
  try {
    const db = await openDb(path);
    const old = new Float32Array(DIM).fill(0.5 / Math.sqrt(DIM));   // length 0.5
    db.prepare("INSERT INTO memory_derivative_vectors (derivative_id, vector) VALUES (?,?)")
      .run("d1", Buffer.from(old.buffer));
    db.prepare("DELETE FROM store_metadata WHERE key=?").run("vectors_unit_length");
    db.close();

    const reopened = await openDb(path);
    const row = reopened.prepare("SELECT vector FROM memory_derivative_vectors WHERE derivative_id=?")
      .get("d1") as { vector: Uint8Array };
    const bytes = row.vector.slice();
    const v = new Float32Array(bytes.buffer, 0, DIM);
    expect(Math.hypot(...v)).toBeCloseTo(1, 5);
    expect(reopened.prepare("SELECT 1 FROM store_metadata WHERE key=?").get("vectors_unit_length"))
      .toBeTruthy();
    reopened.close();
  } finally {
    for (const f of [path, `${path}-wal`, `${path}-shm`]) {
      try { unlinkSync(f); } catch {}
    }
  }
});

async function storeOnDisk(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "nova-db-"));
  const path = join(dir, "memory.db");
  const db = await openDb(path);
  db.exec("INSERT INTO store_metadata (key, value) VALUES ('probe', 'x')");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  return path;
}

test("a store whose bytes were edited is StoreUnreadable", async () => {
  const path = await storeOnDisk();
  // Past SQLCipher's 16-byte salt, inside page 1's authenticated content.
  const fd = openSync(path, "r+");
  writeSync(fd, Buffer.alloc(64), 0, 64, 100);
  closeSync(fd);
  await expect(openDb(path)).rejects.toBeInstanceOf(StoreUnreadable);
});

test("a store opened with a different key is StoreUnreadable", async () => {
  const path = await storeOnDisk();
  await deleteKey("db");
  await expect(openDb(path)).rejects.toBeInstanceOf(StoreUnreadable);
});
