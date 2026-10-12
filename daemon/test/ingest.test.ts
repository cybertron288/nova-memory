import { test, expect } from "bun:test";
import { openDb } from "../src/db";
import { handleLine, ingestStream } from "../src/ingest";
import { randomBytes } from "node:crypto";

const KEY = randomBytes(32);
const line = (over: Record<string, unknown> = {}) => JSON.stringify({
  ts: Date.now(), app: "Google Chrome", bundleId: "com.google.Chrome",
  windowTitle: "Rust ownership", url: "https://doc.rust-lang.org/book/ch04.html",
  content: "Ownership is a set of rules.", contentHash: "sha256:a",
  treeHash: "sha256:b", ...over,
});

test("a valid line is stored and queued for extraction", async () => {
  const db = await openDb(":memory:");
  const r = handleLine(db, KEY, line());
  expect(r.stored).toBe(true);
  const q = db.prepare("SELECT COUNT(*) c FROM memory_retry_queue").get() as any;
  expect(q.c).toBe(1);
});

test("a duplicate line is skipped with a reason", async () => {
  const db = await openDb(":memory:");
  const l = line();
  handleLine(db, KEY, l);
  const r = handleLine(db, KEY, l);
  expect(r.stored).toBe(false);
  expect(r.reason).toBe("duplicate-fingerprint");
});

test("a malformed line is skipped with a reason and does not throw", async () => {
  const db = await openDb(":memory:");
  const r = handleLine(db, KEY, "{not json");
  expect(r.stored).toBe(false);
  expect(r.reason).toBe("malformed-json");
});

test("a line with empty content is skipped with a reason", async () => {
  const db = await openDb(":memory:");
  const r = handleLine(db, KEY, line({ content: "   " }));
  expect(r.stored).toBe(false);
  expect(r.reason).toBe("empty-content");
});

test("a line missing app is skipped with a reason and does not throw", async () => {
  const db = await openDb(":memory:");
  const r = handleLine(db, KEY, line({ app: undefined }));
  expect(r.stored).toBe(false);
  expect(r.reason).toBe("missing-app");
});

test("a line missing ts is skipped with a reason and does not throw", async () => {
  const db = await openDb(":memory:");
  const r = handleLine(db, KEY, line({ ts: undefined }));
  expect(r.stored).toBe(false);
  expect(r.reason).toBe("missing-timestamp");
});

test("a line missing windowTitle is skipped with a reason and does not throw", async () => {
  const db = await openDb(":memory:");
  const r = handleLine(db, KEY, line({ windowTitle: undefined }));
  expect(r.stored).toBe(false);
  expect(r.reason).toBe("write-failed");
});

test("a line with a malformed url is skipped with a reason and does not throw", async () => {
  const db = await openDb(":memory:");
  const r = handleLine(db, KEY, line({ url: "not a url" }));
  expect(r.stored).toBe(false);
  expect(r.reason).toBe("write-failed");
});

test("after a bad line, ingestion continues and a subsequent good line is still stored", async () => {
  const db = await openDb(":memory:");
  const bad = handleLine(db, KEY, line({ url: "not a url" }));
  expect(bad.stored).toBe(false);
  const good = handleLine(db, KEY, line({ content: "unrelated content", url: "https://a.com/x" }));
  expect(good.stored).toBe(true);
});

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

test("ingestStream stores a line split across two chunks", async () => {
  const db = await openDb(":memory:");
  const l = line();
  const mid = Math.floor(l.length / 2);
  await ingestStream(db, KEY, streamOf([l.slice(0, mid), l.slice(mid) + "\n"]));
  const q = db.prepare("SELECT COUNT(*) c FROM memory_retry_queue").get() as any;
  expect(q.c).toBe(1);
});

test("ingestStream stores several lines delivered in one chunk", async () => {
  const db = await openDb(":memory:");
  const lines = [
    line({ content: "first memory" }),
    line({ content: "second memory", url: "https://a.com/y" }),
    line({ content: "third memory", url: "https://a.com/z" }),
  ];
  await ingestStream(db, KEY, streamOf([lines.join("\n") + "\n"]));
  const q = db.prepare("SELECT COUNT(*) c FROM memory_retry_queue").get() as any;
  expect(q.c).toBe(3);
});

test("ingestStream stores a trailing line with no final newline", async () => {
  const db = await openDb(":memory:");
  await ingestStream(db, KEY, streamOf([line()]));
  const q = db.prepare("SELECT COUNT(*) c FROM memory_retry_queue").get() as any;
  expect(q.c).toBe(1);
});

// A failed version write must not leave the fingerprint behind. isNovel records
// the fingerprint as a side effect of the novelty check, so without one
// enclosing transaction a throw from commitVersion commits the fingerprint with
// no version — and that exact capture is then permanently rejected as
// duplicate-fingerprint, with nothing in the codebase ever deleting from
// message_fingerprints. The honest assertion is the second call: after the
// fault is removed, the same content must still be storable.
test("a failed version write rolls the fingerprint back, so the retry still stores", async () => {
  const db = await openDb(":memory:");
  const l = line({ content: "a capture that fails its first write" });

  db.exec(`CREATE TRIGGER fail_version_write BEFORE INSERT ON memory_versions
           BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;`);
  const failed = handleLine(db, KEY, l);
  expect(failed.stored).toBe(false);
  expect(failed.reason).toBe("write-failed");

  const fps = db.prepare("SELECT COUNT(*) c FROM message_fingerprints").get() as any;
  expect(fps.c).toBe(0);
  const vs = db.prepare("SELECT COUNT(*) c FROM memory_versions").get() as any;
  expect(vs.c).toBe(0);

  db.exec("DROP TRIGGER fail_version_write;");
  const retried = handleLine(db, KEY, l);
  expect(retried.stored).toBe(true);
  const after = db.prepare("SELECT COUNT(*) c FROM memory_versions").get() as any;
  expect(after.c).toBe(1);
});


// --- pause gate ---------------------------------------------------------------

/** A ReadableStream that yields the given lines, one chunk each. */
function linesStream(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (i < lines.length) ctrl.enqueue(enc.encode(lines[i++]! + "\n"));
      else ctrl.close();
    },
  });
}

const captureLine = (n: number) => JSON.stringify({
  ts: 1787331916548 + n, app: "Google Chrome", bundleId: "com.google.Chrome",
  windowTitle: `Page ${n}`, url: `https://example.com/${n}`,
  content: `Distinct content number ${n} with enough words to store.`,
  contentHash: `sha256:pause-${n}`, treeHash: `sha256:tree-${n}`,
});

test("while paused, ingest drops lines and nothing is stored", async () => {
  const db = await openDb(":memory:");
  const gate = { paused: true };
  await ingestStream(db, KEY, linesStream([captureLine(1), captureLine(2)]), gate);
  const n = (db.prepare("SELECT COUNT(*) c FROM memory_versions").get() as any).c;
  expect(n).toBe(0);
});

test("resume is per-line: lines after the flag flips are stored", async () => {
  const db = await openDb(":memory:");
  const gate = { paused: true };
  // Flip the gate mid-stream: the first line is read paused, the rest resumed.
  const enc = new TextEncoder();
  let i = 0;
  const lines = [captureLine(1), captureLine(2), captureLine(3)];
  // highWaterMark 0 forces on-demand pulls (no lookahead): without it, the
  // stream's default queuing strategy lets `pull` run one chunk ahead of
  // `for await` consumption, so the gate flip at i===1 lands before line 1
  // is even read and the "first line read paused" premise breaks.
  const stream = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (i === 1) gate.paused = false;
      if (i < lines.length) ctrl.enqueue(enc.encode(lines[i++]! + "\n"));
      else ctrl.close();
    },
  }, new CountQueuingStrategy({ highWaterMark: 0 }));
  await ingestStream(db, KEY, stream, gate);
  const n = (db.prepare("SELECT COUNT(*) c FROM memory_versions").get() as any).c;
  expect(n).toBe(2);
});

test("ingestStream without a gate behaves exactly as before", async () => {
  const db = await openDb(":memory:");
  await ingestStream(db, KEY, linesStream([captureLine(1)]));
  const n = (db.prepare("SELECT COUNT(*) c FROM memory_versions").get() as any).c;
  expect(n).toBe(1);
});

test("a stream ending mid-line while paused stores nothing", async () => {
  const db = await openDb(":memory:");
  const gate = { paused: true };
  const enc = new TextEncoder();
  // Stream with NO trailing newline (ends mid-line)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(captureLine(1)));
      controller.close();
    },
  });
  await ingestStream(db, KEY, stream, gate);
  const n = (db.prepare("SELECT COUNT(*) c FROM memory_versions").get() as any).c;
  expect(n).toBe(0);
});
