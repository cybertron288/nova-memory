import { test, expect } from "bun:test";
import { parseDigestSummary, buildDigestPrompt, type DigestSummaryInput } from "../src/provider";

const input: DigestSummaryInput = {
  owe: [{ person: "Dana Reyes", loops: ["check the calendar fix", "fix Upload Remaining"] }],
  waitingOn: [{ person: "Dana Reyes", loops: ["send doc clarifying scoped filter behavior"] }],
  yesterday: ["Alex pushed quick-filter params for table metadata."],
};

test("a well-formed digest reply parses", () => {
  const raw = '```json\n{"owe":["Check the calendar fix and fix Upload Remaining."],'
    + '"waitingOn":["The scoped-filter doc."],"yesterday":"Pushed quick-filter params."}\n```';
  expect(parseDigestSummary(raw, input)).toEqual({
    owe: ["Check the calendar fix and fix Upload Remaining."],
    waitingOn: ["The scoped-filter doc."],
    yesterday: "Pushed quick-filter params.",
  });
});

test("a reply with the wrong number of lines is rejected", () => {
  const raw = '{"owe":["a","b"],"waitingOn":["c"],"yesterday":null}';
  expect(parseDigestSummary(raw, input)).toBeNull();
});

test("an empty or overlong line is rejected", () => {
  expect(parseDigestSummary('{"owe":[""],"waitingOn":["c"],"yesterday":null}', input)).toBeNull();
  const long = "x".repeat(300);
  expect(parseDigestSummary(`{"owe":["${long}"],"waitingOn":["c"],"yesterday":null}`, input)).toBeNull();
});

test("an empty yesterday reads as null", () => {
  expect(parseDigestSummary('{"owe":["a"],"waitingOn":["c"],"yesterday":""}', input)?.yesterday).toBeNull();
});

test("the digest prompt strips emails and phone numbers like every other outbound text", () => {
  const p = buildDigestPrompt({
    owe: [{ person: "dana@acme.com", loops: ["call Dana on +91 98765 43210"] }],
    waitingOn: [{ person: "Jordan", loops: ["send the deck to jordan@example.com"] }],
    yesterday: ["Mailed sam@example.com the invoice."],
  });
  for (const leak of ["dana@acme.com", "98765 43210", "jordan@example.com", "sam@example.com"]) {
    expect(p).not.toContain(leak);
  }
  expect(p).toContain("Jordan");
});

test("the prompt carries every group in order and forbids invention", () => {
  const p = buildDigestPrompt(input);
  expect(p.indexOf("check the calendar fix")).toBeLessThan(p.indexOf("send doc clarifying"));
  expect(p).toContain("Never add");
  expect(p).toContain("No emoji");
});

import { openDb, encryptField } from "../src/db";
import { recordLoops, listOpenLoops, actOnLoop } from "../src/loops";
import { resolveThread, commitVersion } from "../src/threads";
import { FakeProvider, type LoopCandidate } from "../src/provider";
import { buildMorningDigest, yesterdayWindow } from "../src/digest";
import { randomBytes } from "node:crypto";

const KEY = randomBytes(32);
const loop = (description: string, direction: LoopCandidate["direction"], counterparty: string | null): LoopCandidate =>
  ({ description, direction, counterparty, dueSignal: null, closureSignature: `${description} done` });

async function seedMemory(db: any, text: string, at: number) {
  const rec = { ts: at, app: "Slack", bundleId: "x", windowTitle: `t${at}`, url: null,
    content: text, contentHash: `sha256:${at}`, treeHash: null };
  const tid = resolveThread(db, KEY, rec as any);
  const { versionId } = commitVersion(db, KEY, tid, rec as any);
  db.prepare(`INSERT INTO memory_derivatives (id, thread_id, version_id, content, content_hash, committed_at)
              VALUES (?, ?, ?, ?, 'sha256:x', ?)`).run(`m${at}`, tid, versionId, encryptField(text, KEY), at);
}

const NOW = new Date(2026, 8, 24, 9, 0, 0);   // local 24 Sep 2026, 09:00

test("loops group by person and direction; unanswered and stalled are the user's", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [
    loop("fix upload", "i_owe", "Dana Reyes"),
    loop("check calendar", "i_owe", "Dana Reyes"),
    loop("answer Taylor", "unanswered", "Taylor"),
    loop("doc", "owed_to_me", "Dana Reyes"),
    loop("note to self", "i_owe", null),
  ], null);
  const d = await buildMorningDigest(db, KEY, new FakeProvider(), NOW);
  expect(d.count).toBe(5);
  expect(d.owe.map((b) => b.person)).toEqual(["Dana Reyes", "Taylor", null]);
  expect(d.waitingOn.map((b) => b.person)).toEqual(["Dana Reyes"]);
});

test("closed and future-snoozed loops are left out", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [loop("a", "i_owe", "X"), loop("b", "i_owe", "X"), loop("c", "i_owe", "X")], null);
  const [l1, l2] = listOpenLoops(db, KEY);
  actOnLoop(db, l1!.id, "done");
  actOnLoop(db, l2!.id, "snooze", Date.now() + 3_600_000);
  expect((await buildMorningDigest(db, KEY, new FakeProvider(), NOW)).count).toBe(1);
});

test("zero loops asks the provider nothing", async () => {
  const db = await openDb(":memory:");
  const p = new FakeProvider(undefined, undefined, undefined, new Error("must not be called"));
  const d = await buildMorningDigest(db, KEY, p, NOW);
  expect(d).toMatchObject({ count: 0, owe: [], waitingOn: [], yesterday: null, summarized: false });
  expect(p.lastDigestInput).toBeUndefined();
});

test("yesterday is the previous local calendar day", async () => {
  const w = yesterdayWindow(NOW);
  expect(new Date(w.from)).toEqual(new Date(2026, 8, 23, 0, 0, 0));
  expect(new Date(w.to)).toEqual(new Date(2026, 8, 24, 0, 0, 0));
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [loop("a", "i_owe", "X")], null);
  await seedMemory(db, "did yesterday's thing", new Date(2026, 8, 23, 15, 0).getTime());
  await seedMemory(db, "did today's thing", new Date(2026, 8, 24, 8, 0).getTime());
  await seedMemory(db, "did an older thing", new Date(2026, 8, 22, 15, 0).getTime());
  const p = new FakeProvider(undefined, undefined, undefined,
    { owe: ["A."], waitingOn: [], yesterday: "Did a thing." });
  await buildMorningDigest(db, KEY, p, NOW);
  expect(p.lastDigestInput!.yesterday).toEqual(["did yesterday's thing"]);
});

test("the AI's sentences are used when they fit", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [loop("a", "i_owe", "X"), loop("b", "owed_to_me", "Y")], null);
  const p = new FakeProvider(undefined, undefined, undefined,
    { owe: ["Do a."], waitingOn: ["The b."], yesterday: "Worked." });
  const d = await buildMorningDigest(db, KEY, p, NOW);
  expect(d).toMatchObject({
    count: 2, summarized: true, yesterday: "Worked.",
    owe: [{ person: "X", text: "Do a.", loops: 1 }], waitingOn: [{ person: "Y", text: "The b.", loops: 1 }],
  });
});

test("a failing provider falls back to plain lines", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [loop("a", "i_owe", "X"), loop("b", "i_owe", "X"), loop("c", "owed_to_me", "Y")], null);
  const d = await buildMorningDigest(db, KEY,
    new FakeProvider(undefined, undefined, undefined, new Error("429 quota")), NOW);
  expect(d.summarized).toBe(false);
  expect(d.yesterday).toBeNull();
  expect(d.owe).toEqual([{ person: "X", text: "2 loops", loops: 2 }]);
  expect(d.waitingOn).toEqual([{ person: "Y", text: "c", loops: 1 }]);
});

test("a provider that never answers falls back", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [loop("a", "i_owe", "X")], null);
  const d = await buildMorningDigest(db, KEY, new FakeProvider(undefined, undefined, undefined, "hang"), NOW, 50);
  expect(d.summarized).toBe(false);
});

test("fallback keeps a single loop's description whole", async () => {
  const db = await openDb(":memory:");
  const long = "review the table metadata filter params ".repeat(10).trim();
  await recordLoops(db, KEY, [loop(long, "i_owe", "X")], null);
  const d = await buildMorningDigest(db, KEY, new FakeProvider(), NOW);
  expect(d.owe[0]!.text).toBe(long);
});

import { handleControlLine, type DaemonState } from "../src/control";

test("morning_digest answers over the control line", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [loop("a", "i_owe", "X")], null);
  const state: DaemonState = {
    gate: { paused: false }, startedAt: Date.now(), lastCaptureAt: () => null,
    lastError: null, queued: () => 0, unreachableSince: () => null, networkUp: () => {}, session: null, providerMode: "env",
  };
  const r = JSON.parse(await handleControlLine(
    JSON.stringify({ id: 7, op: "morning_digest" }), db, KEY, state, new FakeProvider()));
  expect(r.ok).toBe(true);
  expect(r.id).toBe(7);
  expect(r.result.count).toBe(1);
});

test("morning_digest without a provider says so", async () => {
  const db = await openDb(":memory:");
  const state: DaemonState = {
    gate: { paused: false }, startedAt: Date.now(), lastCaptureAt: () => null,
    lastError: null, queued: () => 0, unreachableSince: () => null, networkUp: () => {}, session: null, providerMode: "env",
  };
  const r = JSON.parse(await handleControlLine(JSON.stringify({ id: 8, op: "morning_digest" }), db, KEY, state));
  expect(r.ok).toBe(false);
});

test("the count covers every open loop, beyond the fifty summarised", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, Array.from({ length: 60 }, (_, i) => loop(`task ${i}`, "i_owe", "X")), null);
  const d = await buildMorningDigest(db, KEY, new FakeProvider(), NOW);
  expect(d.count).toBe(60);
  expect(d.owe).toEqual([{ person: "X", text: "50 loops", loops: 50 }]);
});

test("an empty section may come back as [] or be left out", () => {
  const noWait: DigestSummaryInput = { ...input, waitingOn: [] };
  expect(parseDigestSummary('{"owe":["a"],"waitingOn":[],"yesterday":null}', noWait)?.waitingOn).toEqual([]);
  expect(parseDigestSummary('{"owe":["a"],"yesterday":null}', noWait)?.waitingOn).toEqual([]);
  // Still refused when a group was expected.
  expect(parseDigestSummary('{"owe":["a"],"yesterday":null}', input)).toBeNull();
});

test("the prompt asks for [] when a section has no groups", () => {
  expect(buildDigestPrompt({ ...input, waitingOn: [] })).toContain('"waitingOn": [] (none: return [])');
});

test("a two-sentence yesterday of 350 characters is accepted", () => {
  const y = "x".repeat(350);
  expect(parseDigestSummary(`{"owe":["a"],"waitingOn":["c"],"yesterday":"${y}"}`, input)?.yesterday).toBe(y);
  expect(parseDigestSummary(`{"owe":["a"],"waitingOn":["c"],"yesterday":"${"x".repeat(450)}"}`, input)).toBeNull();
});

test("the greeting gets the user's first name", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [loop("a", "i_owe", "X")], null);
  const prev = process.env.NOVA_USER_NAME;
  process.env.NOVA_USER_NAME = "Alex Rivera";
  try {
    expect((await buildMorningDigest(db, KEY, new FakeProvider(), NOW)).user).toBe("Alex");
  } finally {
    if (prev === undefined) delete process.env.NOVA_USER_NAME; else process.env.NOVA_USER_NAME = prev;
  }
});
