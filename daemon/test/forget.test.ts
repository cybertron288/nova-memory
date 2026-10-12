import { test, expect } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb, decryptField } from "../src/db";
import { resolveThread, commitVersion } from "../src/threads";
import { enqueueExtraction, drainQueue } from "../src/pipeline";
import { recordLoops } from "../src/loops";
import { FakeProvider, type LoopCandidate } from "../src/provider";
import {
  countForDelete, deleteScope, dataSummary, getRetention, setRetention, sweepRetention,
  sweepDue, parseScope, parseRetention,
} from "../src/forget";
import { randomBytes } from "node:crypto";

const KEY = randomBytes(32);
const HOUR = 3_600_000;
const T0 = 1_790_000_000_000;

/** One capture in its own thread, drained into memories and vectors. */
async function seed(db: Database, app: string, at: number, memories: string[]) {
  const rec = {
    ts: at, app, bundleId: `com.test.${app}`, windowTitle: `${app} ${at}`,
    url: `https://${app.toLowerCase()}.test/${at}`, content: `${app} said things at ${at}.`,
    contentHash: `sha256:${at}`, treeHash: `sha256:t${at}`,
  };
  const tid = resolveThread(db, KEY, rec);
  const { versionId } = commitVersion(db, KEY, tid, rec);
  enqueueExtraction(db, versionId);
  await drainQueue(db, KEY, new FakeProvider(memories));
  const derivs = (db.prepare("SELECT id FROM memory_derivatives WHERE version_id=?").all(versionId) as { id: string }[])
    .map((r) => r.id);
  return { versionId, threadId: tid, derivs };
}

const loop = (description: string): LoopCandidate => ({
  description, direction: "i_owe", counterparty: null, dueSignal: null,
  closureSignature: `${description} was done`,
});

const count = (db: Database, sql: string, ...p: unknown[]) =>
  (db.prepare(sql).get(...(p as any[])) as { c: number }).c;

/** Rows anywhere that still point at the given version. */
function traces(db: Database, versionId: string, derivs: string[], threadId: string): number {
  const inDerivs = derivs.length ? `IN (${derivs.map(() => "?").join(",")})` : "IN (NULL)";
  return count(db, "SELECT COUNT(*) c FROM memory_versions WHERE id=?", versionId)
    + count(db, "SELECT COUNT(*) c FROM memory_retry_queue WHERE version_id=?", versionId)
    + count(db, `SELECT COUNT(*) c FROM memory_derivatives WHERE id ${inDerivs}`, ...derivs)
    + count(db, `SELECT COUNT(*) c FROM memory_derivative_vectors WHERE derivative_id ${inDerivs}`, ...derivs)
    + count(db, `SELECT COUNT(*) c FROM memory_derivative_embeddings WHERE derivative_id ${inDerivs}`, ...derivs)
    + count(db, `SELECT COUNT(*) c FROM loop_evidence WHERE derivative_id ${inDerivs}`, ...derivs)
    + count(db, "SELECT COUNT(*) c FROM open_loops WHERE version_id=?", versionId)
    + count(db, "SELECT COUNT(*) c FROM message_fingerprints WHERE thread_id=?", threadId)
    + count(db, "SELECT COUNT(*) c FROM memory_threads WHERE id=?", threadId);
}

test("deleting an app removes every trace of its captures and leaves other apps whole", async () => {
  const db = await openDb(":memory:");
  const slack = await seed(db, "Slack", T0, ["Dana asked for the deck."]);
  const chrome = await seed(db, "Chrome", T0 + HOUR, ["Rust has ownership rules."]);
  await recordLoops(db, KEY, [loop("send Dana the deck")], slack.derivs[0]!, undefined, undefined, T0, slack.versionId);
  await recordLoops(db, KEY, [loop("read the Rust book")], chrome.derivs[0]!, undefined, undefined, T0 + HOUR, chrome.versionId);

  expect(countForDelete(db, { kind: "app", app: "Slack" })).toEqual({ captures: 1, memories: 1, loops: 1 });
  expect(deleteScope(db, { kind: "app", app: "Slack" })).toEqual({ captures: 1, memories: 1, loops: 1 });

  expect(traces(db, slack.versionId, slack.derivs, slack.threadId)).toBe(0);
  expect(traces(db, chrome.versionId, chrome.derivs, chrome.threadId)).toBeGreaterThan(0);
  expect(count(db, "SELECT COUNT(*) c FROM open_loops")).toBe(1);
  expect(count(db, "SELECT COUNT(*) c FROM memory_derivatives")).toBe(1);
});

test("a range takes only captures inside [from, to)", async () => {
  const db = await openDb(":memory:");
  const before = await seed(db, "Mail", T0, ["A."]);
  const inside = await seed(db, "Mail", T0 + HOUR, ["B."]);
  const atEnd = await seed(db, "Mail", T0 + 2 * HOUR, ["C."]);

  const d = deleteScope(db, { kind: "range", from: T0 + HOUR, to: T0 + 2 * HOUR });
  expect(d.captures).toBe(1);
  expect(traces(db, inside.versionId, inside.derivs, inside.threadId)).toBe(0);
  expect(count(db, "SELECT COUNT(*) c FROM memory_versions WHERE id IN (?, ?)", before.versionId, atEnd.versionId))
    .toBe(2);
});

test("a loop still backed by a capture outside the scope is kept", async () => {
  const db = await openDb(":memory:");
  const first = await seed(db, "Slack", T0, ["Dana asked for the deck."]);
  const again = await seed(db, "Mail", T0 + HOUR, ["Dana asked again for the deck."]);
  const c = loop("send Dana the deck");
  await recordLoops(db, KEY, [c], first.derivs[0]!, undefined, undefined, T0, first.versionId);
  await recordLoops(db, KEY, [c], again.derivs[0]!, undefined, undefined, T0 + HOUR, again.versionId);

  expect(deleteScope(db, { kind: "app", app: "Slack" }).loops).toBe(0);
  expect(count(db, "SELECT COUNT(*) c FROM open_loops")).toBe(1);
  // Its link to the deleted capture is gone, so nothing points at a dead row.
  expect(count(db, "SELECT COUNT(*) c FROM open_loops WHERE version_id IS NOT NULL")).toBe(0);
});

test("a loop with no evidence row is found through the capture that opened it", async () => {
  const db = await openDb(":memory:");
  const s = await seed(db, "Slack", T0, []);
  await recordLoops(db, KEY, [loop("reply to Jordan")], null, undefined, undefined, T0, s.versionId);
  expect(deleteScope(db, { kind: "app", app: "Slack" }).loops).toBe(1);
  expect(count(db, "SELECT COUNT(*) c FROM open_loops")).toBe(0);
});

test("the call log keeps its rows but loses links to deleted captures", async () => {
  const db = await openDb(":memory:");
  const a = await seed(db, "Slack", T0, ["A."]);
  const b = await seed(db, "Chrome", T0 + HOUR, ["B."]);
  db.prepare(
    `INSERT INTO provider_calls (id, at, provider, model, kind, outcome, ms, input_chars, items, capture_ids)
     VALUES ('c1', ?, 'p', 'm', 'chat', 'ok', 1, 1, 2, ?)`,
  ).run(T0, JSON.stringify([a.versionId, b.versionId]));

  deleteScope(db, { kind: "app", app: "Slack" });
  const row = db.prepare("SELECT capture_ids FROM provider_calls WHERE id='c1'").get() as { capture_ids: string };
  expect(JSON.parse(row.capture_ids)).toEqual([b.versionId]);

  deleteScope(db, { kind: "all" }, { clearCallLog: true });
  expect(count(db, "SELECT COUNT(*) c FROM provider_calls")).toBe(0);
});

test("delete everything leaves an empty store that still takes new captures", async () => {
  const db = await openDb(":memory:");
  await seed(db, "Slack", T0, ["A."]);
  await seed(db, "Chrome", T0 + HOUR, ["B."]);
  deleteScope(db, { kind: "all" });
  for (const t of ["memory_threads", "memory_versions", "memory_derivatives", "memory_derivative_vectors",
                   "memory_derivative_embeddings", "message_fingerprints", "memory_retry_queue", "open_loops"]) {
    expect(count(db, `SELECT COUNT(*) c FROM ${t}`)).toBe(0);
  }
  // The fingerprint went too, so the same text is captured again.
  await seed(db, "Slack", T0, ["A."]);
  expect(count(db, "SELECT COUNT(*) c FROM memory_derivatives")).toBe(1);
});

test("retention blanks old capture text but keeps its memories", async () => {
  const db = await openDb(":memory:");
  const now = T0 + 100 * 24 * HOUR;
  const old = await seed(db, "Slack", T0, ["Dana asked for the deck."]);
  const fresh = await seed(db, "Slack", now - HOUR, ["Recent."]);
  expect(getRetention(db)).toEqual({ rawDays: 90, memoryDays: null });

  const r = sweepRetention(db, KEY, now);
  expect(r.rawRemoved).toBe(1);
  const v = db.prepare("SELECT content, raw_purged_at FROM memory_versions WHERE id=?").get(old.versionId) as any;
  expect(decryptField(v.content, KEY)).toBe("");
  expect(v.raw_purged_at).toBe(now);
  expect(count(db, "SELECT COUNT(*) c FROM memory_derivatives WHERE version_id=?", old.versionId)).toBe(1);
  const f = db.prepare("SELECT content FROM memory_versions WHERE id=?").get(fresh.versionId) as any;
  expect(decryptField(f.content, KEY)).not.toBe("");

  // Idempotent, and not due again for a day.
  expect(sweepRetention(db, KEY, now).rawRemoved).toBe(0);
  expect(sweepDue(db, now + HOUR)).toBe(false);
  expect(sweepDue(db, now + 25 * HOUR)).toBe(true);
});

test("a memory retention deletes old captures with their memories", async () => {
  const db = await openDb(":memory:");
  const now = T0 + 400 * 24 * HOUR;
  await seed(db, "Slack", T0, ["Old."]);
  await seed(db, "Slack", now - HOUR, ["New."]);
  setRetention(db, { rawDays: 90, memoryDays: 365 });
  const r = sweepRetention(db, KEY, now);
  expect(r.deleted.captures).toBe(1);
  expect(count(db, "SELECT COUNT(*) c FROM memory_derivatives")).toBe(1);
});

test("the summary counts what is stored, per app", async () => {
  const db = await openDb(":memory:");
  await seed(db, "Slack", T0, ["A.", "B."]);
  await seed(db, "Chrome", T0 + HOUR, ["C."]);
  const s = dataSummary(db, null);
  expect(s.captures).toBe(2);
  expect(s.memories).toBe(3);
  expect(s.oldest).toBe(T0);
  expect(s.apps.map((a) => a.app).sort()).toEqual(["Chrome", "Slack"]);
  expect(s.bytes).toBeNull();
});

test("malformed scopes and retention values are refused, never read as a default", () => {
  expect(parseScope({ kind: "all" })).toEqual({ kind: "all" });
  for (const bad of [null, "all", {}, { kind: "everything" }, { kind: "app" }, { kind: "app", app: " " },
                     { kind: "range", from: 5 }, { kind: "range", from: 5, to: 5 },
                     { kind: "range", from: "1", to: 2 }]) {
    expect(typeof parseScope(bad)).toBe("string");
  }
  expect(parseRetention({ rawDays: 30, memoryDays: null })).toEqual({ rawDays: 30, memoryDays: null });
  expect(typeof parseRetention({ rawDays: 31, memoryDays: null })).toBe("string");
  expect(typeof parseRetention({ rawDays: 30 })).toBe("string");
});

