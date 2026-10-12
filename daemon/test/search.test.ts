import { test, expect } from "bun:test";
import { openDb } from "../src/db";
import { resolveThread, commitVersion } from "../src/threads";
import { enqueueExtraction, drainQueue, quantize as pipelineQuantize } from "../src/pipeline";
import { searchMemory, quantize as searchQuantize } from "../src/search";
import { FakeProvider } from "../src/provider";
import { handleSearchCall, formatHits } from "../src/mcp";
import { randomBytes } from "node:crypto";

const KEY = randomBytes(32);

/** Store one derivative (its own thread) with the given content and committed_at. */
async function seed(
  db: Awaited<ReturnType<typeof openDb>>,
  opts: { url: string; windowTitle: string; memoryText: string; ts: number },
): Promise<void> {
  const rec = {
    ts: opts.ts, app: "Google Chrome", bundleId: "com.google.Chrome",
    windowTitle: opts.windowTitle, url: opts.url,
    content: "captured content for " + opts.url,
    contentHash: "sha256:" + opts.url, treeHash: "sha256:t",
  };
  const tid = resolveThread(db, KEY, rec);
  const { versionId } = commitVersion(db, KEY, tid, rec);
  enqueueExtraction(db, versionId);
  // A fresh FakeProvider per seed: its "extract" step always returns the
  // fixed memories array it was constructed with, independent of content.
  await drainQueue(db, KEY, new FakeProvider([opts.memoryText]));
}

test("a stored memory is findable and carries provenance", async () => {
  const db = await openDb(":memory:");
  const rec = {
    ts: Date.now(), app: "Google Chrome", bundleId: "com.google.Chrome",
    windowTitle: "Rust ownership", url: "https://doc.rust-lang.org/book/ch04.html",
    content: "Ownership is a set of rules.", contentHash: "sha256:a", treeHash: "sha256:b",
  };
  const tid = resolveThread(db, KEY, rec);
  const { versionId } = commitVersion(db, KEY, tid, rec);
  enqueueExtraction(db, versionId);

  const provider = new FakeProvider(["Rust enforces ownership rules at compile time."]);
  await drainQueue(db, KEY, provider);

  const hits = await searchMemory(db, KEY, provider, "ownership", { limit: 5 });
  expect(hits.length).toBe(1);
  expect(hits[0]!.text).toBe("Rust enforces ownership rules at compile time.");
  expect(hits[0]!.app).toBe("Google Chrome");
  expect(hits[0]!.url).toBe("https://doc.rust-lang.org/book/ch04.html");
  expect(hits[0]!.windowTitle).toBe("Rust ownership");
});

test("an empty store returns nothing rather than throwing", async () => {
  const db = await openDb(":memory:");
  const hits = await searchMemory(db, KEY, new FakeProvider(), "anything", {});
  expect(hits).toEqual([]);
});

test("ranking: a candidate closely matching the query ranks first among several", async () => {
  const db = await openDb(":memory:");
  const now = Date.now();
  const DAY = 86_400_000;
  // The eventual winner (Rust) is deliberately the OLDEST of the three and
  // inserted first, with the losers newer and inserted later. That defeats
  // three ways a broken scorer could accidentally still "pass": (a) upstream
  // vec0 KNN row order, (b) JS insertion order under a stable sort with a
  // constant score, and (c) a scorer that only reads recency and never the
  // float32 sidecar — all three would rank a loser first here, since the
  // true winner is both oldest and last in KNN/insertion order.
  await seed(db, {
    url: "https://a.example/rust", windowTitle: "Rust", ts: now - 20 * DAY,
    memoryText: "Rust enforces ownership rules at compile time.",
  });
  await seed(db, {
    url: "https://b.example/python", windowTitle: "Python", ts: now - 1000,
    memoryText: "Python uses reference counting for garbage collection.",
  });
  await seed(db, {
    url: "https://c.example/stocks", windowTitle: "Stocks", ts: now,
    memoryText: "The stock market closed higher on Friday.",
  });

  // FakeProvider embeds content-sensitively (Task 6): a query identical to a
  // stored memory should embed near-identically and rank that memory first,
  // despite being the oldest and inserted first.
  const hits = await searchMemory(
    db, KEY, new FakeProvider(),
    "Rust enforces ownership rules at compile time.",
    { limit: 5 },
  );
  expect(hits.length).toBe(3);
  expect(hits[0]!.text).toBe("Rust enforces ownership rules at compile time.");
  expect(hits[1]!.text).not.toBe("Rust enforces ownership rules at compile time.");
  expect(hits[2]!.text).not.toBe("Rust enforces ownership rules at compile time.");
});

test("age filter: an explicit maxAgeDays excludes candidates outside the window", async () => {
  const db = await openDb(":memory:");
  const now = Date.now();
  const DAY = 86_400_000;
  await seed(db, {
    url: "https://recent.example", windowTitle: "Recent", ts: now,
    memoryText: "A recent memory about kubernetes deployments.",
  });
  await seed(db, {
    url: "https://old.example", windowTitle: "Old", ts: now - 40 * DAY,
    memoryText: "An old memory about kubernetes deployments too.",
  });

  const hits = await searchMemory(
    db, KEY, new FakeProvider(), "kubernetes deployments",
    { limit: 5, maxAgeDays: 7 },
  );
  expect(hits.length).toBe(1);
  expect(hits[0]!.windowTitle).toBe("Recent");
});

test("quantize in search.ts matches quantize in pipeline.ts exactly", () => {
  const vectors: Float32Array[] = [
    new Float32Array(4),                          // all-zero
    Float32Array.from([1, -1, 0.5, -0.5]),         // mixed signs
    Float32Array.from([0.001, -127, 63.5, -63.5]), // extreme magnitude spread
  ];
  for (const v of vectors) {
    expect(Array.from(searchQuantize(v))).toEqual(Array.from(pipelineQuantize(v)));
  }
});

// A wrong-dimension query embedding used to return [] with no log and no throw,
// so mcp.formatHits told the user "nothing matching was captured, or capture was
// not running" — both false when the store is full and only the query embedding
// was the wrong shape (a model deprecation, or an outputDimensionality drift).
// "Produced nothing" must say why it produced nothing (spec 7).
test("a wrong-dimension query embedding fails loudly instead of looking like no matches", async () => {
  const db = await openDb(":memory:");
  await seed(db, {
    url: "https://a.example/rust", windowTitle: "Rust", ts: Date.now(),
    memoryText: "Rust enforces ownership rules at compile time.",
  });

  const wrongDim = {
    extract: async () => [],
    embed: async () => [new Float32Array(768)],
  };
  let thrown: unknown;
  try {
    await searchMemory(db, KEY, wrongDim as any, "ownership", { limit: 5 });
  } catch (e) { thrown = e; }
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toContain("768");
  expect((thrown as Error).message).toContain("1536");

  // And the MCP handler must propagate it rather than rendering the
  // "nothing was captured" text, which is what made this silent.
  let handlerThrew: unknown;
  try {
    await handleSearchCall(db, KEY, wrongDim as any, {
      name: "search_memory", arguments: { query: "ownership" },
    });
  } catch (e) { handlerThrew = e; }
  expect(handlerThrew).toBeInstanceOf(Error);
  expect(formatHits([])).toContain("No matching memories");   // the lie it would have told
});

test("a provider that returns no vector at all for the query fails loudly", async () => {
  const db = await openDb(":memory:");
  const empty = { extract: async () => [], embed: async () => [] };
  let thrown: unknown;
  try {
    await searchMemory(db, KEY, empty as any, "anything", {});
  } catch (e) { thrown = e; }
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toContain("Could not embed the search query");
});
