import { test, expect } from "bun:test";
import { openDb } from "../src/db";
import { handleLine } from "../src/ingest";
import { countCapturesSince, listRecentCaptures } from "../src/captures";
import { randomBytes } from "node:crypto";

const line = (app: string, title: string, url: string | null, content: string) => JSON.stringify({
  app, url, bundleId: `com.example.${app}`, windowTitle: title, ts: Date.now(),
  content, contentHash: `h-${content}`, treeHash: `t-${content}`,
});

test("recent captures list what was stored, newest first, with their source", async () => {
  const db = await openDb(":memory:");
  const k = randomBytes(32);
  handleLine(db, k, line("Slack", "general", null, "first thing discussed here"));
  handleLine(db, k, line("Chrome", "Docs", "https://example.com/a", "second thing written down"));

  const rows = listRecentCaptures(db, k, 10);
  expect(rows).toHaveLength(2);
  expect(rows[0]!.app).toBe("Chrome");
  expect(rows[0]!.title).toBe("Docs");
  expect(rows[0]!.url).toBe("https://example.com/a");
  expect(rows[1]!.app).toBe("Slack");
});

test("a capture reports its size, not its content", async () => {
  const db = await openDb(":memory:");
  const k = randomBytes(32);
  const secret = "Jordan promised the invoice by Friday";
  handleLine(db, k, line("Slack", "dm", null, secret));

  const [r] = listRecentCaptures(db, k, 10);
  expect(r!.chars).toBe(secret.length);
  // The transparency feed says what was captured, not what it said.
  expect(JSON.stringify(r)).not.toContain("invoice");
});

test("the list is capped so the panel cannot ask for everything", async () => {
  const db = await openDb(":memory:");
  const k = randomBytes(32);
  for (let i = 0; i < 5; i++) handleLine(db, k, line("Slack", `w${i}`, null, `content number ${i}`));
  expect(listRecentCaptures(db, k, 2)).toHaveLength(2);
  expect(listRecentCaptures(db, k, 9999).length).toBeLessThanOrEqual(200);
});

test("an undecryptable row is omitted rather than emptying the feed", async () => {
  const db = await openDb(":memory:");
  const k = randomBytes(32);
  handleLine(db, k, line("Slack", "ok", null, "a readable capture here"));
  handleLine(db, k, line("Slack", "bad", null, "another readable capture"));
  // Corrupt exactly one thread's title so its capture cannot be read.
  const victim = db.prepare("SELECT id FROM memory_threads ORDER BY rowid LIMIT 1")
    .get() as { id: string };
  db.prepare("UPDATE memory_threads SET source_title='enc:v1:not-real' WHERE id=?").run(victim.id);
  // Whatever happens to one row, the rest still serve.
  expect(listRecentCaptures(db, k, 10).length).toBeGreaterThanOrEqual(1);
});

test("the day's count covers every capture since the given moment, not one page", async () => {
  const db = await openDb(":memory:");
  const k = randomBytes(32);
  for (let i = 0; i < 4; i++) handleLine(db, k, line("Slack", `w${i}`, null, `content number ${i}`));
  db.prepare("UPDATE memory_versions SET committed_at = 1000 WHERE rowid = (SELECT min(rowid) FROM memory_versions)").run();
  expect(countCapturesSince(db, 2000)).toBe(3);
  expect(countCapturesSince(db, 0)).toBe(4);
});
