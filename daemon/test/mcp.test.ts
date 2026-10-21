import { test, expect } from "bun:test";
import { formatHits, formatLoops, formatTimeline, handleSearchCall, handleToolCall, parseInstant } from "../src/mcp";
import { openDb } from "../src/db";
import { resolveThread, commitVersion } from "../src/threads";
import { enqueueExtraction, drainQueue } from "../src/pipeline";
import { FakeProvider, MissingKeyProvider } from "../src/provider";
import { randomBytes } from "node:crypto";

const KEY = randomBytes(32);

/** A temp in-memory DB with one seeded, extracted, embedded memory. */
async function seededDb(): Promise<Awaited<ReturnType<typeof openDb>>> {
  const db = await openDb(":memory:");
  const rec = {
    ts: Date.now(), app: "Google Chrome", bundleId: "com.google.Chrome",
    windowTitle: "Rust ownership", url: "https://doc.rust-lang.org/book/ch04.html",
    content: "Ownership is a set of rules.", contentHash: "sha256:a", treeHash: "sha256:b",
  };
  const tid = resolveThread(db, KEY, rec);
  const { versionId } = commitVersion(db, KEY, tid, rec);
  enqueueExtraction(db, versionId);
  await drainQueue(db, KEY, new FakeProvider(["Rust enforces ownership rules at compile time."]));
  return db;
}

test("hits render with provenance a model can cite", () => {
  const out = formatHits([{
    text: "Rust enforces ownership rules at compile time.",
    score: 0.91, at: 1787331916548, app: "Google Chrome",
    windowTitle: "Rust ownership", url: "https://doc.rust-lang.org/book/ch04.html",
  }]);
  expect(out).toContain("Rust enforces ownership rules at compile time.");
  expect(out).toContain("Google Chrome");
  expect(out).toContain("https://doc.rust-lang.org/book/ch04.html");
  expect(out).toContain("2026");                 // a readable timestamp
});

test("no hits produce an explicit empty answer, not a blank string", () => {
  expect(formatHits([])).toContain("No matching memories");
});

test("handleSearchCall: a valid query returns formatted text containing a seeded memory", async () => {
  const db = await seededDb();
  const provider = new FakeProvider();
  const result = await handleSearchCall(db, KEY, provider, {
    name: "search_memory",
    arguments: { query: "Rust enforces ownership rules at compile time." },
  });
  expect(result.content[0]!.text).toContain("Rust enforces ownership rules at compile time.");
});

test("handleSearchCall: an unknown tool name is rejected", async () => {
  const db = await seededDb();
  const provider = new FakeProvider();
  await expect(
    handleSearchCall(db, KEY, provider, { name: "not_search_memory", arguments: { query: "x" } }),
  ).rejects.toThrow("unknown tool");
});

test("handleSearchCall: missing arguments produces a clean message, not a TypeError", async () => {
  const db = await seededDb();
  const provider = new FakeProvider();
  await expect(
    handleSearchCall(db, KEY, provider, { name: "search_memory", arguments: undefined }),
  ).rejects.toThrow("search_memory requires a 'query' string");
});

test("handleSearchCall: empty query string produces a clean message, not a TypeError", async () => {
  const db = await seededDb();
  const provider = new FakeProvider();
  await expect(
    handleSearchCall(db, KEY, provider, { name: "search_memory", arguments: { query: "" } }),
  ).rejects.toThrow("search_memory requires a 'query' string");
});

test("handleSearchCall: a provider that throws (missing key) surfaces its message", async () => {
  const db = await seededDb();
  const provider = new MissingKeyProvider();
  await expect(
    handleSearchCall(db, KEY, provider, { name: "search_memory", arguments: { query: "anything" } }),
  ).rejects.toThrow("No inference provider is configured");
});

test("handleSearchCall: limit caps the results it returns", async () => {
  // Three distinct memories on one version, so a dropped or ignored `limit`
  // shows up as extra lines rather than being masked by a one-row fixture.
  const db = await openDb(":memory:");
  const rec = {
    ts: Date.now(), app: "Google Chrome", bundleId: "com.google.Chrome",
    windowTitle: "Rust ownership", url: "https://doc.rust-lang.org/book/ch04.html",
    content: "Ownership is a set of rules.", contentHash: "sha256:c", treeHash: "sha256:d",
  };
  const tid = resolveThread(db, KEY, rec);
  const { versionId } = commitVersion(db, KEY, tid, rec);
  enqueueExtraction(db, versionId);
  await drainQueue(db, KEY, new FakeProvider([
    "Rust moves ownership on assignment.",
    "Rust borrows references without moving.",
    "Rust drops values at end of scope.",
  ]));

  const call = (limit?: number) => handleSearchCall(db, KEY, new FakeProvider(), {
    name: "search_memory",
    arguments: limit === undefined ? { query: "Rust" } : { query: "Rust", limit },
  });

  const countLines = (t: string) => t.split("\n").filter((l) => l.startsWith("- ")).length;

  expect(countLines((await call(1)).content[0]!.text)).toBe(1);
  expect(countLines((await call(3)).content[0]!.text)).toBe(3);
  // Omitting it must not collapse to 1 — the default is 10, so all 3 come back.
  expect(countLines((await call()).content[0]!.text)).toBe(3);
});

test("loops render with their source app and the id nova done takes", () => {
  const base = {
    state: "open", createdAt: 0, counterparty: null, dueSignal: null, sourceApp: null, feedback: null,
  };
  const out = formatLoops([
    { ...base, id: "019a-1", description: "send Lee the invoice", direction: "i_owe",
      ageDays: 0, sourceApp: "Slack", counterparty: "Lee", dueSignal: "by Friday" },
    { ...base, id: "019a-2", description: "book the venue", direction: "stalled", ageDays: 3 },
  ]);
  expect(out).toBe(
    "- [You said you would] send Lee the invoice\n"
    + '  (noticed today in Slack · with Lee · said "by Friday" · id 019a-1)\n'
    + "- [Stalled] book the venue\n"
    + "  (noticed 3d ago · id 019a-2)");
});

const localDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("get_timeline: a period covering the capture returns its memory with provenance", async () => {
  const db = await seededDb();
  const today = localDay(Date.now());
  const result = await handleToolCall(db, KEY, new FakeProvider(), {
    name: "get_timeline", arguments: { from: today, to: today },
  });
  const text = result.content[0]!.text;
  expect(text).toContain("- Rust enforces ownership rules at compile time.");
  expect(text).toContain("Google Chrome — https://doc.rust-lang.org/book/ch04.html");
});

test("get_timeline: a period before any capture says it is empty", async () => {
  const db = await seededDb();
  const result = await handleToolCall(db, KEY, new MissingKeyProvider(), {
    name: "get_timeline", arguments: { from: "2020-01-01", to: "2020-01-02" },
  });
  expect(result.content[0]!.text).toBe(
    "No memories in this period. Either nothing was captured, or capture was not running at the time.");
});

test("get_timeline: bad periods and limits are refused, not read as defaults", async () => {
  const db = await seededDb();
  const call = (args: Record<string, unknown>) =>
    handleToolCall(db, KEY, new FakeProvider(), { name: "get_timeline", arguments: args });
  await expect(call({})).rejects.toThrow("get_timeline: from must be an ISO 8601 date or date-time");
  await expect(call({ from: "yesterday" })).rejects.toThrow("get_timeline: from must be an ISO 8601 date or date-time");
  await expect(call({ from: "2026-02-30" })).rejects.toThrow("get_timeline: from must be an ISO 8601 date or date-time");
  await expect(call({ from: "2026-10-14", to: 5 })).rejects.toThrow("get_timeline: to must be an ISO 8601 date or date-time");
  await expect(call({ from: "2026-10-14T10:00", to: "2026-10-14T09:00" })).rejects.toThrow("get_timeline: from must be before to");
  await expect(call({ from: "2026-10-14", limit: 0 })).rejects.toThrow("get_timeline: limit must be a positive integer");
});

test("parseInstant: a bare date is a local day, and its end is the next local midnight", () => {
  expect(parseInstant("2026-10-14", false)).toBe(new Date(2026, 9, 14).getTime());
  expect(parseInstant("2026-10-14", true)).toBe(new Date(2026, 9, 15).getTime());
  expect(parseInstant("2026-10-14T09:30:00Z", false)).toBe(Date.UTC(2026, 9, 14, 9, 30));
});

test("formatTimeline: a capped answer says how many it left out", () => {
  const out = formatTimeline([{
    id: "a", text: "Read about ownership.", sourceApp: "Google Chrome",
    capturedAt: Date.UTC(2026, 9, 14, 9, 30), windowTitle: "Rust ownership", url: null,
  }], 3);
  expect(out).toBe("The first 1 of 3 memories in this period, oldest first. Ask for a shorter period to see the rest.\n"
    + "- Read about ownership.\n  (2026-10-14 09:30 · Google Chrome — Rust ownership)");
});
