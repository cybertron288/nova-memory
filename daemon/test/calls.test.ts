import { test, expect } from "bun:test";
import { openDb } from "../src/db";
import { recordCall, listCalls, callTotals, attributed, TRIM_KEEP } from "../src/calls";
import { OpenAICompatProvider } from "../src/provider";

test("a call is recorded with its metadata and nothing else", async () => {
  const db = await openDb(":memory:");
  recordCall(db, {
    provider: "gemini", model: "gemini-3.6-flash", kind: "chat",
    outcome: "ok", ms: 412, inputChars: 2048, items: 1,
  });
  const [c] = listCalls(db, 10);
  expect(c!.provider).toBe("gemini");
  expect(c!.kind).toBe("chat");
  expect(c!.outcome).toBe("ok");
  expect(c!.ms).toBe(412);
  // The row must carry no prompt, reply or captured text at all.
  expect(Object.values(c as unknown as Record<string, unknown>).join(" ")).not.toContain("2048 chars of");
  const cols = db.prepare("SELECT * FROM provider_calls LIMIT 1").get() as Record<string, unknown>;
  expect(Object.keys(cols)).not.toContain("prompt");
  expect(Object.keys(cols)).not.toContain("content");
});

test("calls come back newest first", async () => {
  const db = await openDb(":memory:");
  for (const m of ["a", "b", "c"]) {
    recordCall(db, { provider: "p", model: m, kind: "embed", outcome: "ok", ms: 1, inputChars: 1, items: 1 });
  }
  expect(listCalls(db, 10).map((c) => c.model)).toEqual(["c", "b", "a"]);
  expect(listCalls(db, 2)).toHaveLength(2);
});

test("a failure records its reason without a body", async () => {
  const db = await openDb(":memory:");
  recordCall(db, {
    provider: "gemini", model: "m", kind: "embed", outcome: "error",
    ms: 90, inputChars: 10, items: 4, status: 429, detail: "quota exhausted",
  });
  const [c] = listCalls(db, 1);
  expect(c!.outcome).toBe("error");
  expect(c!.status).toBe(429);
  expect(c!.detail).toBe("quota exhausted");
});

test("totals count calls and characters by kind", async () => {
  const db = await openDb(":memory:");
  recordCall(db, { provider: "p", model: "m", kind: "chat", outcome: "ok", ms: 5, inputChars: 100, items: 1 });
  recordCall(db, { provider: "p", model: "m", kind: "chat", outcome: "error", ms: 5, inputChars: 50, items: 1 });
  recordCall(db, { provider: "p", model: "m", kind: "embed", outcome: "ok", ms: 5, inputChars: 10, items: 3 });
  const t = callTotals(db);
  expect(t.chat).toEqual({ calls: 2, errors: 1, inputChars: 150, items: 2 });
  expect(t.embed).toEqual({ calls: 1, errors: 0, inputChars: 10, items: 3 });
});

test("the log is trimmed so it cannot grow without bound", async () => {
  const db = await openDb(":memory:");
  for (let i = 0; i < TRIM_KEEP + 50; i++) {
    recordCall(db, { provider: "p", model: `m${i}`, kind: "chat", outcome: "ok", ms: 1, inputChars: 1, items: 1 });
  }
  const n = (db.prepare("SELECT count(*) c FROM provider_calls").get() as { c: number }).c;
  expect(n).toBeLessThanOrEqual(TRIM_KEEP);
  // The newest survive the trim.
  expect(listCalls(db, 1)[0]!.model).toBe(`m${TRIM_KEEP + 49}`);
});

test("a call made inside an attributed scope names its purpose and captures", async () => {
  const db = await openDb(":memory:");
  const call = { provider: "p", model: "m", kind: "chat" as const, outcome: "ok" as const, ms: 1, inputChars: 1, items: 1 };
  await attributed({ purpose: "memories", captureIds: ["v1"] }, async () => {
    await Promise.resolve();          // the scope must survive an await
    recordCall(db, call);
  });
  recordCall(db, call);
  const [outside, inside] = listCalls(db, 10);
  expect(inside!.purpose).toBe("memories");
  expect(inside!.captureIds).toEqual(["v1"]);
  expect(outside!.purpose).toBeUndefined();
  expect(outside!.captureIds).toEqual([]);
});

test("overlapping scopes do not attribute each other's calls", async () => {
  const db = await openDb(":memory:");
  const call = (model: string) => ({ provider: "p", model, kind: "chat" as const, outcome: "ok" as const, ms: 1, inputChars: 1, items: 1 });
  const tick = () => new Promise((r) => setTimeout(r, 1));
  await Promise.all([
    attributed({ purpose: "memories", captureIds: ["a"] }, async () => { await tick(); recordCall(db, call("a")); }),
    attributed({ purpose: "loops", captureIds: ["b"] }, async () => { recordCall(db, call("b")); }),
  ]);
  const byModel = Object.fromEntries(listCalls(db, 10).map((c) => [c.model, c.captureIds]));
  expect(byModel).toEqual({ a: ["a"], b: ["b"] });
});

test("totals can be scoped to a day", async () => {
  const db = await openDb(":memory:");
  recordCall(db, { provider: "p", model: "m", kind: "chat", outcome: "ok", ms: 5, inputChars: 100, items: 1 });
  db.prepare("UPDATE provider_calls SET at = 1000").run();
  recordCall(db, { provider: "p", model: "m", kind: "chat", outcome: "ok", ms: 5, inputChars: 7, items: 1 });
  expect(callTotals(db).chat.inputChars).toBe(107);
  expect(callTotals(db, 2000).chat).toEqual({ calls: 1, errors: 0, inputChars: 7, items: 1 });
});

// --- the provider actually reports its calls ------------------------------

test("a chat call through the provider lands one row", async () => {
  const db = await openDb(":memory:");
  const fetchImpl = (async () => new Response(
    JSON.stringify({ choices: [{ message: { content: '{"memories":["A did X."]}' } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  )) as unknown as ConstructorParameters<typeof OpenAICompatProvider>[1];

  const p = new OpenAICompatProvider({
    chatBaseUrl: "https://api.example.com/v1", chatApiKey: "k", chatModel: "m-chat",
    embedBaseUrl: "https://embed.example.com/v1", embedApiKey: "k2", embedModel: "m-embed",
    embedDim: 1536,
  }, fetchImpl, (c) => recordCall(db, c));

  await p.extract("some captured text");
  const [c] = listCalls(db, 5);
  expect(c!.kind).toBe("chat");
  expect(c!.outcome).toBe("ok");
  expect(c!.model).toBe("m-chat");
  // The host, not a vendor name: a self-hosted endpoint reads as itself.
  expect(c!.provider).toBe("api.example.com");
  expect(c!.items).toBe(1);
  expect(c!.inputChars).toBeGreaterThan(0);
});

test("a failed call is recorded as an error with its status", async () => {
  const db = await openDb(":memory:");
  const fetchImpl = (async () => new Response("rate limited", { status: 429 })) as
    unknown as ConstructorParameters<typeof OpenAICompatProvider>[1];
  const p = new OpenAICompatProvider({
    chatBaseUrl: "https://api.example.com/v1", chatApiKey: "k", chatModel: "m-chat",
    embedBaseUrl: "https://e.example.com/v1", embedApiKey: "k2", embedModel: "m-embed",
    embedDim: 1536,
  }, fetchImpl, (c) => recordCall(db, c));

  await expect(p.extract("text")).rejects.toThrow();
  const [c] = listCalls(db, 5);
  expect(c!.outcome).toBe("error");
  expect(c!.status).toBe(429);
});

test("the call log never holds the text that was sent", async () => {
  const db = await openDb(":memory:");
  const secret = "Jordan promised the invoice by Friday";
  const fetchImpl = (async () => new Response(
    JSON.stringify({ choices: [{ message: { content: '{"memories":[]}' } }] }), { status: 200 },
  )) as unknown as ConstructorParameters<typeof OpenAICompatProvider>[1];
  const p = new OpenAICompatProvider({
    chatBaseUrl: "https://api.example.com/v1", chatApiKey: "k", chatModel: "m",
    embedBaseUrl: "https://e.example.com/v1", embedApiKey: "k2", embedModel: "m2",
    embedDim: 1536,
  }, fetchImpl, (c) => recordCall(db, c));

  await p.extract(secret);
  const raw = db.prepare("SELECT * FROM provider_calls").all() as Record<string, unknown>[];
  expect(JSON.stringify(raw)).not.toContain("Jordan");
  expect(JSON.stringify(raw)).not.toContain("invoice");
});

test("a search query's embedding is logged as a search, so Activity can name it", async () => {
  const { searchMemory } = await import("../src/search");
  const db = await openDb(":memory:");
  const provider = {
    extract: async () => [],
    embed: async (texts: string[]) => {
      recordCall(db, { provider: "p", model: "m", kind: "embed", outcome: "ok", ms: 1, inputChars: 5, items: texts.length });
      return texts.map(() => new Array(1536).fill(0.01));
    },
  } as any;
  await searchMemory(db, Buffer.alloc(32), provider, "launch date", { limit: 5 });
  const [c] = listCalls(db, 1);
  expect(c!.purpose).toBe("search");
});
