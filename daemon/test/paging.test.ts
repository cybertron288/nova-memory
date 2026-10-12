import { test, expect } from "bun:test";
import { openDb, encryptField } from "../src/db";
import { recordLoops, listLoopsPage } from "../src/loops";
import { listMemoriesPage } from "../src/memories";
import { resolveThread, commitVersion } from "../src/threads";
import type { LoopCandidate } from "../src/provider";
import { randomBytes } from "node:crypto";

const KEY = randomBytes(32);
const loop = (description: string, direction: LoopCandidate["direction"]): LoopCandidate =>
  ({ description, direction, counterparty: "X", dueSignal: null, closureSignature: `${description} done` });

/** Walk every page and return the ids in order. */
function allLoopIds(db: any, limit: number): string[] {
  const ids: string[] = [];
  let after: string | null = null;
  for (let guard = 0; guard < 100; guard++) {
    const p = listLoopsPage(db, KEY, { after, limit });
    ids.push(...p.items.map((l) => l.id));
    if (!p.next) break;
    after = p.next;
  }
  return ids;
}

test("loop pages cover every loop once, the user's own before waiting-on", async () => {
  const db = await openDb(":memory:");
  // Recorded one at a time so created_at differs; mixed directions.
  for (let i = 0; i < 7; i++) {
    await recordLoops(db, KEY, [loop(`mine ${i}`, i % 3 === 0 ? "unanswered" : "i_owe")], null, undefined, undefined, 1000 + i);
    await recordLoops(db, KEY, [loop(`theirs ${i}`, "owed_to_me")], null, undefined, undefined, 2000 + i);
  }
  const ids = allLoopIds(db, 3);
  expect(ids.length).toBe(14);
  expect(new Set(ids).size).toBe(14);

  const first = listLoopsPage(db, KEY, { limit: 100 }).items;
  const firstWaiting = first.findIndex((l) => l.direction === "owed_to_me");
  expect(first.slice(0, firstWaiting).every((l) => l.direction !== "owed_to_me")).toBe(true);
  expect(first.slice(firstWaiting).every((l) => l.direction === "owed_to_me")).toBe(true);
  // Newest first within each group.
  expect(first[0]!.description).toBe("mine 6");
  expect(first[firstWaiting]!.description).toBe("theirs 6");
});

test("a loop recorded mid-scroll neither repeats nor skips a row", async () => {
  const db = await openDb(":memory:");
  for (let i = 0; i < 6; i++) {
    await recordLoops(db, KEY, [loop(`mine ${i}`, "i_owe")], null, undefined, undefined, 1000 + i);
  }
  const p1 = listLoopsPage(db, KEY, { limit: 3 });
  await recordLoops(db, KEY, [loop("new one", "i_owe")], null, undefined, undefined, 5000);
  const p2 = listLoopsPage(db, KEY, { after: p1.next, limit: 3 });
  expect(p2.items.map((l) => l.description)).toEqual(["mine 2", "mine 1", "mine 0"]);
  expect(p2.next).toBeNull();
  expect(p2.total).toBe(7);
});

test("a bad cursor starts from the top", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [loop("a", "i_owe")], null);
  expect(listLoopsPage(db, KEY, { after: "garbage" }).items.length).toBe(1);
});

test("memory pages cover every memory once, newest first", async () => {
  const db = await openDb(":memory:");
  const rec = { ts: 1, app: "Slack", bundleId: "x", windowTitle: "t", url: null,
    content: "seed", contentHash: "sha256:s", treeHash: "sha256:t" };
  const tid = resolveThread(db, KEY, rec as any);
  const { versionId } = commitVersion(db, KEY, tid, rec as any);
  // Two share a timestamp, so the id tiebreak is exercised.
  const at = [100, 200, 200, 300, 400];
  at.forEach((t, i) => db.prepare(
    `INSERT INTO memory_derivatives (id, thread_id, version_id, content, content_hash, committed_at)
     VALUES (?, ?, ?, ?, 'sha256:x', ?)`).run(`m${i}`, tid, versionId, encryptField(`fact ${i}`, KEY), t));
  const seen: string[] = [];
  let after: string | null = null;
  for (let guard = 0; guard < 10; guard++) {
    const p = listMemoriesPage(db, KEY, { after, limit: 2 });
    seen.push(...p.items.map((m) => m.id));
    if (!p.next) break;
    after = p.next;
  }
  expect(seen).toEqual(["m4", "m3", "m2", "m1", "m0"]);
});
