import { test, expect } from "bun:test";
import { formatHits, formatLoops, handleSearchCall } from "../src/mcp";
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
