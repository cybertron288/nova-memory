import { test, expect } from "bun:test";
import { normalizeUrl, resolveThread, commitVersion } from "../src/threads";
import { openDb, decryptField } from "../src/db";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";

const KEY = randomBytes(32);
const rec = (over: Partial<any> = {}) => ({
  ts: 1787331916548, app: "Google Chrome", bundleId: "com.google.Chrome",
  windowTitle: "Rust ownership", url: "https://doc.rust-lang.org/book/ch04.html",
  content: "Ownership is a set of rules.", contentHash: "sha256:a",
  treeHash: "sha256:b", ...over,
});

test("url normalization drops query and fragment, keeps path", () => {
  expect(normalizeUrl("https://a.com/x?utm=1#frag")).toBe("https://a.com/x");
  expect(normalizeUrl("https://a.com/x/")).toBe("https://a.com/x");
  expect(normalizeUrl("https://a.com")).toBe("https://a.com/");
});

test("the same page resolves to one thread, a different page to another", async () => {
  const db = await openDb(":memory:");
  const t1 = resolveThread(db, KEY, rec());
  const t2 = resolveThread(db, KEY, rec({ url: "https://doc.rust-lang.org/book/ch04.html?x=1" }));
  const t3 = resolveThread(db, KEY, rec({ url: "https://doc.rust-lang.org/book/ch05.html" }));
  expect(t2).toBe(t1);
  expect(t3).not.toBe(t1);
});

test("same hour overwrites the head; a new hour freezes and chains", async () => {
  const db = await openDb(":memory:");
  const tid = resolveThread(db, KEY, rec());
  const a = commitVersion(db, KEY, tid, rec({ content: "first" }));
  const b = commitVersion(db, KEY, tid, rec({ content: "second" }));
  expect(b.versionId).toBe(a.versionId);       // same hour: in place
  expect(b.froze).toBe(false);

  const nextHour = 1787331916548 + 3_600_000;
  const c = commitVersion(db, KEY, tid, rec({ ts: nextHour, content: "third" }));
  expect(c.versionId).not.toBe(a.versionId);
  expect(c.froze).toBe(true);

  const heads = db.prepare(
    "SELECT COUNT(*) c FROM memory_versions WHERE thread_id=? AND is_frozen=0"
  ).get(tid) as any;
  expect(heads.c).toBe(1);                      // invariant: one mutable head
});

test("same-hour overwrite cleans the vec0 index, the rescore sidecar, and the derivative rows", async () => {
  const db = await openDb(":memory:");
  const tid = resolveThread(db, KEY, rec());
  const a = commitVersion(db, KEY, tid, rec({ content: "first" }));

  // Seed a derivative for the current head plus rows in both vector tables,
  // simulating a completed extraction/embedding pass before the overwrite.
  db.prepare(`INSERT INTO memory_derivatives
      (id, thread_id, version_id, content, content_hash, committed_at, embedding_status)
      VALUES ('d1', ?, ?, 'stale derivative text', 'sha256:stale', ?, 'completed')`)
    .run(tid, a.versionId, rec().ts);
  db.prepare("INSERT INTO memory_derivative_embeddings (derivative_id, embedding) VALUES (?, vec_int8(?))")
    .run("d1", JSON.stringify(new Array(1536).fill(0)));
  db.prepare("INSERT INTO memory_derivative_vectors (derivative_id, vector) VALUES (?, ?)")
    .run("d1", new Uint8Array(4));

  // Same-hour overwrite must invalidate all three.
  commitVersion(db, KEY, tid, rec({ content: "second" }));

  const derivatives = db.prepare(
    "SELECT COUNT(*) c FROM memory_derivatives WHERE version_id=?"
  ).get(a.versionId) as any;
  const embeddings = db.prepare(
    "SELECT COUNT(*) c FROM memory_derivative_embeddings WHERE derivative_id='d1'"
  ).get() as any;
  const vectors = db.prepare(
    "SELECT COUNT(*) c FROM memory_derivative_vectors WHERE derivative_id='d1'"
  ).get() as any;
  expect(derivatives.c).toBe(0);
  expect(embeddings.c).toBe(0);
  expect(vectors.c).toBe(0);
});

test("same-hour overwrite survives a derivative cited as loop evidence", async () => {
  const db = await openDb(":memory:");
  const tid = resolveThread(db, KEY, rec());
  const a = commitVersion(db, KEY, tid, rec({ content: "first" }));

  db.prepare(`INSERT INTO memory_derivatives
      (id, thread_id, version_id, content, content_hash, committed_at, embedding_status)
      VALUES ('d1', ?, ?, 'a commitment', 'sha256:x', ?, 'completed')`)
    .run(tid, a.versionId, rec().ts);

  // A loop that cites that derivative as its evidence — the state the daemon
  // reaches as soon as extraction finds a commitment in a captured thread.
  db.prepare(`INSERT INTO open_loops
      (id, created_at, description, direction, counterparty, due_signal,
       state, closure_sig, dedup_key)
      VALUES ('l1', ?, 'enc', 'i_owe', NULL, NULL, 'open', 'enc', 'k1')`)
    .run(rec().ts);
  db.prepare("INSERT INTO loop_evidence (loop_id, derivative_id) VALUES ('l1','d1')").run();

  // Measured 2026-09-22 on a live Slack thread: this threw
  // "FOREIGN KEY constraint failed" and ingest dropped the capture. The
  // overwrite deleted the derivative while loop_evidence still pointed at it.
  expect(() => commitVersion(db, KEY, tid, rec({ content: "second" }))).not.toThrow();

  // The evidence link goes with the derivative it described; the loop itself
  // stays, because the commitment is still outstanding regardless of which
  // capture happened to reveal it.
  expect((db.prepare("SELECT COUNT(*) c FROM memory_derivatives WHERE id='d1'").get() as any).c).toBe(0);
  expect((db.prepare("SELECT COUNT(*) c FROM loop_evidence WHERE derivative_id='d1'").get() as any).c).toBe(0);
  expect((db.prepare("SELECT COUNT(*) c FROM open_loops WHERE id='l1'").get() as any).c).toBe(1);
});

test("an out-of-order capture (earlier hour than the head) overwrites in place, never displaces the newer head", async () => {
  const db = await openDb(":memory:");
  const tid = resolveThread(db, KEY, rec());
  const laterHour = 1787331916548 + 3_600_000;
  const newer = commitVersion(db, KEY, tid, rec({ ts: laterHour, content: "newer" }));
  expect(newer.froze).toBe(false);

  // A capture stamped an hour before the current head arrives late.
  const stale = commitVersion(db, KEY, tid, rec({ ts: 1787331916548, content: "delayed" }));
  expect(stale.versionId).toBe(newer.versionId);  // overwrote in place
  expect(stale.froze).toBe(false);                // did not freeze the newer head

  const heads = db.prepare(
    "SELECT COUNT(*) c FROM memory_versions WHERE thread_id=? AND is_frozen=0"
  ).get(tid) as any;
  expect(heads.c).toBe(1);

  const row = db.prepare(
    "SELECT content_hash FROM memory_versions WHERE id=?"
  ).get(newer.versionId) as any;
  // The out-of-order write still lands (content_hash updated), it just can't
  // create a new head or freeze the newer one.
  expect(row.content_hash).toBe(rec({ content: "delayed" }).contentHash);
});

// Spec 8 names three fields: source_title, url, and captured content. This test
// planted canaries for two of them and passed a real URL through the fixture
// without ever asserting on it, which is exactly how the plaintext source_key
// shipped. The URL canary is the third.
test("file-based database never stores capture content, window title, or url in the clear", async () => {
  const db2Path = `${tmpdir()}/nova-threads-encryption-test-${Date.now()}.sqlite`;
  const contentMarker = "THREADS-CONTENT-CANARY-9d2f81";
  const titleMarker = "THREADS-TITLE-CANARY-6c40aa";
  const urlHostMarker = "threads-url-canary-4b71e3.example";
  const urlPathMarker = "THREADS-URL-PATH-CANARY-1f9c22";
  const canaryUrl = `https://${urlHostMarker}/${urlPathMarker}`;
  try {
    const db = await openDb(db2Path);
    const tid = resolveThread(db, KEY, rec({ windowTitle: titleMarker, url: canaryUrl }));
    commitVersion(db, KEY, tid, rec({ content: contentMarker }));
    // Force the WAL into the main file before reading it. Without this the
    // checkpoint on close is not guaranteed to run, and the file under
    // inspection is just the 4096-byte header — so every canary below passes
    // vacuously no matter what the code stores. Verified: with this line the
    // file is 114688 bytes on every run; without it, 4096 on every run of the
    // same script. This is why plaintext in source_key went unnoticed.
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    db.close();

    const bytes = new Uint8Array(await Bun.file(db2Path).arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(4096);   // the canaries need real pages to search
    const raw = Buffer.from(bytes).toString("latin1");

    expect(raw).not.toContain(contentMarker);
    expect(raw).not.toContain(titleMarker);
    // Neither the whole URL nor either half of it: the host alone is already a
    // browsing-history leak, and the path alone identifies the document.
    expect(raw).not.toContain(canaryUrl);
    expect(raw).not.toContain(urlHostMarker);
    expect(raw).not.toContain(urlPathMarker);
  } finally {
    for (const suffix of ["", "-wal", "-shm"]) {
      await Bun.file(db2Path + suffix).delete().catch(() => {});
    }
  }
});

// The file-bytes canary above can only ever prove SQLCipher is active: the whole
// file is encrypted, so a field stored in the clear is invisible to it either
// way. Verified by mutation — reverting resolveThread to store the plaintext URL
// in source_key leaves that test green, because the plaintext never reaches the
// disk in a readable form. Spec 8's field-level layer is the SECOND layer, and
// the only way to assert it is to read the columns and check the envelope. That
// is what this test does, and it is the one that fails when the layer is missing.
test("field-level encryption covers title and url in the columns themselves, not just on disk", async () => {
  const db = await openDb(":memory:");
  const url = "https://field-layer.example/some/path";
  const title = "A window title";
  const tid = resolveThread(db, KEY, rec({ windowTitle: title, url }));

  const row = db.prepare(
    "SELECT source_key, source_title, source_url FROM memory_threads WHERE id=?"
  ).get(tid) as any;

  // The URL must not appear in any column in the clear, under any encoding.
  for (const [column, value] of Object.entries(row)) {
    expect(String(value)).not.toContain("field-layer.example");
    expect(String(value)).not.toContain("/some/path");
    expect(String(value)).not.toContain(title);
    void column;
  }

  // source_title and source_url carry the enc:v1 envelope and round-trip.
  expect(row.source_title.startsWith("enc:v1:")).toBe(true);
  expect(row.source_url.startsWith("enc:v1:")).toBe(true);
  expect(decryptField(row.source_title, KEY)).toBe(title);
  expect(decryptField(row.source_url, KEY)).toBe(normalizeUrl(url));

  // source_key is a keyed digest: deterministic (so the lookup and UNIQUE
  // constraint work), one-way, and not a bare hash of a guessable value --
  // a different key over the same URL must give a different digest.
  const other = db.prepare("SELECT source_key FROM memory_threads WHERE id=?")
    .get(resolveThread(db, randomBytes(32), rec({ windowTitle: title, url }))) as any;
  expect(row.source_key).toMatch(/^[0-9a-f]{64}$/);
  expect(other.source_key).not.toBe(row.source_key);
});

// The non-browser fallback: identity still works, the title is still digested
// rather than stored, and source_url stays NULL rather than being handed a
// window title -- the read path surfaces source_url as the URL provenance.
test("a capture with no url digests its window title and leaves source_url null", async () => {
  const db = await openDb(":memory:");
  const title = "Untitled Document - Notes";
  const tid = resolveThread(db, KEY, rec({ url: null, windowTitle: title }));
  const again = resolveThread(db, KEY, rec({ url: null, windowTitle: title }));
  expect(again).toBe(tid);                       // identity unchanged

  const row = db.prepare(
    "SELECT source_key, source_url FROM memory_threads WHERE id=?"
  ).get(tid) as any;
  expect(row.source_url).toBe(null);
  expect(row.source_key).not.toContain(title);
  expect(row.source_key).toMatch(/^[0-9a-f]{64}$/);
});
