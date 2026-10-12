// OpenAICompatProvider. No test here touches a real endpoint: every request is
// answered by an injected fetch or by a Bun.serve stub on an ephemeral port.
import { test, expect } from "bun:test";
import {
  OpenAICompatProvider, openAICompatConfigFromEnv, providerFromEnv,
  MissingKeyProvider, UnconfiguredProvider, GeminiProvider, DIM, QuotaExhausted,
  type FetchLike, type OpenAICompatConfig,
} from "../src/provider";

const CFG: OpenAICompatConfig = {
  chatBaseUrl: "https://chat.example", chatApiKey: "chat-secret", chatModel: "deepseek-chat",
  embedBaseUrl: "https://embed.example", embedApiKey: "embed-secret",
  embedModel: "gemini-embedding-001", embedDim: DIM,
};

const FULL_ENV = {
  NOVA_CHAT_BASE_URL: "https://chat.example", NOVA_CHAT_API_KEY: "ck",
  NOVA_CHAT_MODEL: "deepseek-chat", NOVA_EMBED_BASE_URL: "https://embed.example",
  NOVA_EMBED_API_KEY: "ek", NOVA_EMBED_MODEL: "gemini-embedding-001",
} as NodeJS.ProcessEnv;

/** Records what was requested and replies with a canned response. */
function stubFetch(reply: (url: string, body: any) => Response) {
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  const impl: FetchLike = async (url, init) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, init, body });
    return reply(url, body);
  };
  return { impl, calls };
}

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

/** A vector of the configured width, distinguishable by its first element. */
const vec = (marker: number, dim = DIM) =>
  Array.from({ length: dim }, (_, i) => (i === 0 ? marker : 0.001));

// --- extract ---------------------------------------------------------------

test("extract parses a normal OpenAI chat completion", async () => {
  const { impl, calls } = stubFetch(() =>
    json({ choices: [{ message: { content: '{"memories":["Ada shipped the parser on 2026-08-24."]}' } }] }));
  const p = new OpenAICompatProvider(CFG, impl);
  expect(await p.extract("some captured text")).toEqual(["Ada shipped the parser on 2026-08-24."]);

  expect(calls[0]!.url).toBe("https://chat.example/chat/completions");
  expect((calls[0]!.init.headers as any).authorization).toBe("Bearer chat-secret");
  expect(calls[0]!.body.model).toBe("deepseek-chat");
  expect(calls[0]!.body.messages[0].role).toBe("user");
  // The shared prompt builder is reused, not restated.
  expect(calls[0]!.body.messages[0].content).toContain("some captured text");
  expect(calls[0]!.body.messages[0].content).toContain('{"memories": ["...", "..."]}');
  expect(calls[0]!.body.temperature).toBe(0);
  expect(calls[0]!.body.response_format).toEqual({ type: "json_object" });
});

test("extract reuses parseMemories, so a fenced completion still yields memories", async () => {
  const { impl } = stubFetch(() =>
    json({ choices: [{ message: { content: '```json\n{"memories":["A fact."]}\n```' } }] }));
  expect(await new OpenAICompatProvider(CFG, impl).extract("t")).toEqual(["A fact."]);
});

test("a chat error body never echoes the api key back in the thrown message", async () => {
  const { impl } = stubFetch(() =>
    new Response('{"error":"bad key chat-secret for embed-secret"}', { status: 401 }));
  const p = new OpenAICompatProvider(CFG, impl);
  const err = await p.extract("t").then(() => null, (e) => e as Error);
  expect(err).not.toBeNull();
  expect(err!.message).not.toContain("chat-secret");
  expect(err!.message).not.toContain("embed-secret");
  expect(err!.message).toContain("[redacted]");
  expect(err!.message).toContain("401");
});

test("extractLoops asks for deterministic JSON and keeps only what the capture supports", async () => {
  const { impl, calls } = stubFetch(() => json({ choices: [{ message: { content: JSON.stringify({
    tracked: [
      { id: "L1", status: "closed", evidence: "sent the invoice" },
      { id: "L2", status: "closed", evidence: "paid in full" },
    ],
    loops: [
      { description: "share the deck", direction: "owed_to_me", counterparty: "Lee",
        due_signal: "tomorrow", evidence: "I'll share the deck tomorrow",
        closure_signature: "Lee shared the deck" },
      { description: "book the venue", direction: "i_owe", counterparty: null,
        due_signal: null, evidence: "I will book the venue", closure_signature: "the venue was booked" },
    ],
  }) } }] }));
  const p = new OpenAICompatProvider(CFG, impl);
  const out = await p.extractLoops("You: sent the invoice\nLee: I'll share the deck tomorrow", undefined, [
    { id: "L1", description: "send Lee the invoice", direction: "i_owe", counterparty: "Lee" },
    { id: "L2", description: "pay the caterer", direction: "i_owe", counterparty: null },
  ]);

  expect(out).toEqual({
    loops: [{ description: "share the deck", direction: "owed_to_me", counterparty: "Lee",
      dueSignal: "tomorrow", closureSignature: "Lee shared the deck" }],
    closed: [{ id: "L1", evidence: "sent the invoice" }],
  });
  expect(calls[0]!.body.temperature).toBe(0);
  expect(calls[0]!.body.response_format).toEqual({ type: "json_object" });
  expect(calls[0]!.body.messages[0].content).toContain("L1: [i_owe] send Lee the invoice (with Lee)");
});

// --- embed -----------------------------------------------------------------

test("embed sends the model, the inputs and the configured dimensions", async () => {
  const { impl, calls } = stubFetch(() =>
    json({ data: [{ index: 0, embedding: vec(1) }, { index: 1, embedding: vec(2) }] }));
  await new OpenAICompatProvider(CFG, impl).embed(["one", "two"]);
  expect(calls[0]!.url).toBe("https://embed.example/embeddings");
  expect((calls[0]!.init.headers as any).authorization).toBe("Bearer embed-secret");
  expect(calls[0]!.body).toMatchObject({
    model: "gemini-embedding-001", input: ["one", "two"], dimensions: DIM,
  });
});

test("embed returns vectors in INPUT order even when the response is shuffled", async () => {
  // The OpenAI spec guarantees `index`, not array order. If this provider
  // trusted position, every memory would be stored against another memory's
  // vector — silent corruption, never an exception. So answer deliberately
  // out of order and require the input ordering back.
  const { impl } = stubFetch(() => json({
    data: [
      { index: 2, embedding: vec(30) },
      { index: 0, embedding: vec(10) },
      { index: 1, embedding: vec(20) },
    ],
  }));
  const out = await new OpenAICompatProvider(CFG, impl).embed(["first", "second", "third"]);
  expect(out.length).toBe(3);
  expect(out[0]![0]).toBeCloseTo(10, 4);   // belongs to "first"
  expect(out[1]![0]).toBeCloseTo(20, 4);   // belongs to "second"
  expect(out[2]![0]).toBeCloseTo(30, 4);   // belongs to "third"
});

test("embed rejects a response whose indices do not cover every input", async () => {
  const { impl } = stubFetch(() => json({
    data: [{ index: 0, embedding: vec(1) }, { index: 0, embedding: vec(2) }],
  }));
  await expect(new OpenAICompatProvider(CFG, impl).embed(["a", "b"]))
    .rejects.toThrow("duplicate embedding index 0");
});

test("embed rejects an index outside the input range instead of dropping it", async () => {
  const { impl } = stubFetch(() => json({
    data: [{ index: 0, embedding: vec(1) }, { index: 7, embedding: vec(2) }],
  }));
  await expect(new OpenAICompatProvider(CFG, impl).embed(["a", "b"]))
    .rejects.toThrow("outside 0..1");
});

test("a wrong-dimension embedding throws, naming both dimensions", async () => {
  const { impl } = stubFetch(() => json({ data: [{ index: 0, embedding: vec(1, 768) }] }));
  const err = await new OpenAICompatProvider(CFG, impl).embed(["a"]).then(() => null, (e) => e as Error);
  expect(err).not.toBeNull();
  expect(err!.message).toContain("768");
  expect(err!.message).toContain(String(DIM));
});

test("embed counts the response against the inputs it sent", async () => {
  const { impl } = stubFetch(() => json({ data: [{ index: 0, embedding: vec(1) }] }));
  await expect(new OpenAICompatProvider(CFG, impl).embed(["a", "b"]))
    .rejects.toThrow("returned 1 embeddings for 2 inputs");
});

test("a rejected `dimensions` parameter is retried once without it", async () => {
  const bodies: any[] = [];
  const impl: FetchLike = async (_url, init) => {
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    if ("dimensions" in body) {
      return new Response('{"error":{"message":"unknown parameter: dimensions"}}', { status: 400 });
    }
    return json({ data: [{ index: 0, embedding: vec(5) }] });
  };
  const out = await new OpenAICompatProvider(CFG, impl).embed(["a"]);
  expect(bodies.length).toBe(2);
  expect("dimensions" in bodies[0]).toBe(true);
  expect("dimensions" in bodies[1]).toBe(false);
  expect(out[0]![0]).toBeCloseTo(5, 4);
});

test("the retry still validates the width — a fixed-size model of the wrong size fails", async () => {
  const impl: FetchLike = async (_url, init) => {
    const body = JSON.parse(String(init.body));
    if ("dimensions" in body) {
      return new Response('{"error":{"message":"unknown parameter: dimensions"}}', { status: 400 });
    }
    return json({ data: [{ index: 0, embedding: vec(5, 768) }] });
  };
  const err = await new OpenAICompatProvider(CFG, impl).embed(["a"]).then(() => null, (e) => e as Error);
  expect(err).not.toBeNull();
  expect(err!.message).toContain("768");
  expect(err!.message).toContain(String(DIM));
});

test("an unrelated failure is not retried without dimensions — it is reported as itself", async () => {
  let calls = 0;
  const impl: FetchLike = async () => {
    calls++;
    return new Response('{"error":"invalid api key embed-secret"}', { status: 401 });
  };
  const err = await new OpenAICompatProvider(CFG, impl).embed(["a"]).then(() => null, (e) => e as Error);
  expect(calls).toBe(1);
  expect(err!.message).toContain("401");
  expect(err!.message).not.toContain("embed-secret");
});

test("base urls work with or without a trailing slash", async () => {
  const { impl, calls } = stubFetch(() => json({ data: [{ index: 0, embedding: vec(1) }] }));
  const p = new OpenAICompatProvider(
    { ...CFG, chatBaseUrl: "https://chat.example/v1/", embedBaseUrl: "https://embed.example/v1///" },
    impl);
  await p.embed(["a"]);
  expect(calls[0]!.url).toBe("https://embed.example/v1/embeddings");
});

// --- configuration ---------------------------------------------------------

test("a partial configuration throws, naming exactly the missing variables", () => {
  const err = (() => {
    try {
      openAICompatConfigFromEnv({
        NOVA_CHAT_BASE_URL: "https://chat.example", NOVA_CHAT_API_KEY: "ck",
        NOVA_CHAT_MODEL: "deepseek-chat",
      } as NodeJS.ProcessEnv);
      return null;
    } catch (e) { return e as Error; }
  })();
  expect(err).not.toBeNull();
  expect(err!.message).toContain("NOVA_EMBED_BASE_URL");
  expect(err!.message).toContain("NOVA_EMBED_API_KEY");
  expect(err!.message).toContain("NOVA_EMBED_MODEL");
  // The variables that ARE set must not be reported as missing.
  expect(err!.message).not.toContain("NOVA_CHAT_BASE_URL");
  expect(err!.message).not.toContain("NOVA_CHAT_MODEL");
});

test("the mirror case is reported too: embed set, chat missing", () => {
  const err = (() => {
    try {
      openAICompatConfigFromEnv({
        NOVA_EMBED_BASE_URL: "https://embed.example", NOVA_EMBED_API_KEY: "ek",
        NOVA_EMBED_MODEL: "gemini-embedding-001",
      } as NodeJS.ProcessEnv);
      return null;
    } catch (e) { return e as Error; }
  })();
  expect(err!.message).toContain("NOVA_CHAT_BASE_URL");
  expect(err!.message).toContain("NOVA_CHAT_API_KEY");
  expect(err!.message).toContain("NOVA_CHAT_MODEL");
  expect(err!.message).not.toContain("NOVA_EMBED_MODEL");
});

test("a blank variable counts as missing, not as configured", () => {
  expect(() => openAICompatConfigFromEnv({ ...FULL_ENV, NOVA_EMBED_API_KEY: "   " }))
    .toThrow("NOVA_EMBED_API_KEY");
});

test("NOVA_EMBED_DIM defaults to the indexed width and rejects any other value", () => {
  expect(openAICompatConfigFromEnv(FULL_ENV).embedDim).toBe(DIM);
  expect(openAICompatConfigFromEnv({ ...FULL_ENV, NOVA_EMBED_DIM: String(DIM) }).embedDim).toBe(DIM);
  // 1536 is the only width this build indexes; anything else must say so
  // rather than corrupt the store.
  expect(() => openAICompatConfigFromEnv({ ...FULL_ENV, NOVA_EMBED_DIM: "768" }))
    .toThrow("768");
  expect(() => openAICompatConfigFromEnv({ ...FULL_ENV, NOVA_EMBED_DIM: "abc" }))
    .toThrow("positive integer");
});

// --- providerFromEnv resolution --------------------------------------------

test("providerFromEnv prefers a complete OpenAI-compatible config over GEMINI_API_KEY", () => {
  const p = providerFromEnv({ ...FULL_ENV, GEMINI_API_KEY: "gk" });
  expect(p).toBeInstanceOf(OpenAICompatProvider);
});

test("providerFromEnv falls back to Gemini when only GEMINI_API_KEY is set", () => {
  expect(providerFromEnv({ GEMINI_API_KEY: "gk" } as NodeJS.ProcessEnv))
    .toBeInstanceOf(GeminiProvider);
});

test("providerFromEnv with nothing set returns MissingKeyProvider, naming both options", async () => {
  const p = providerFromEnv({} as NodeJS.ProcessEnv);
  expect(p).toBeInstanceOf(MissingKeyProvider);
  const err = await p.embed(["a"]).then(() => null, (e) => e as Error);
  expect(err!.message).toContain("GEMINI_API_KEY");
  expect(err!.message).toContain("NOVA_CHAT_BASE_URL");
  expect(err!.message).toContain("NOVA_EMBED_BASE_URL");
});

test("a partial OpenAI-compatible config does NOT silently fall back to Gemini", async () => {
  // Falling through here would run Gemini against a user who meant to use
  // DeepSeek, and their typo would surface as someone else's quota error.
  const p = providerFromEnv({
    NOVA_CHAT_BASE_URL: "https://chat.example", GEMINI_API_KEY: "gk",
  } as NodeJS.ProcessEnv);
  expect(p).not.toBeInstanceOf(GeminiProvider);
  expect(p).toBeInstanceOf(UnconfiguredProvider);
  const err = await p.extract("t").then(() => null, (e) => e as Error);
  expect(err!.message).toContain("NOVA_CHAT_API_KEY");
  expect(err!.message).toContain("NOVA_EMBED_MODEL");
});

test("providerFromEnv never throws at construction, however broken the config", () => {
  // `nova mcp` must start regardless: a throw here is a dead connector in
  // Claude Desktop with no message, instead of an actionable tool error.
  for (const env of [
    {},
    { NOVA_CHAT_BASE_URL: "https://chat.example" },
    { ...FULL_ENV, NOVA_EMBED_DIM: "768" },
    { ...FULL_ENV, NOVA_EMBED_DIM: "not-a-number" },
    { NOVA_EMBED_MODEL: "x" },
  ] as NodeJS.ProcessEnv[]) {
    expect(() => providerFromEnv(env)).not.toThrow();
  }
});

test("an unsupported NOVA_EMBED_DIM surfaces on the call, not at startup", async () => {
  const p = providerFromEnv({ ...FULL_ENV, NOVA_EMBED_DIM: "768" });
  const err = await p.embed(["a"]).then(() => null, (e) => e as Error);
  expect(err!.message).toContain("768");
  expect(err!.message).toContain(String(DIM));
});

// --- against a real local server -------------------------------------------

test("extract and embed work end to end against a stub HTTP server", async () => {
  const seen: { path: string; auth: string | null }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      seen.push({ path, auth: req.headers.get("authorization") });
      if (path.endsWith("/chat/completions")) {
        return json({ choices: [{ message: { content: '{"memories":["A durable fact."]}' } }] });
      }
      const body = await req.json() as any;
      // Shuffled on purpose, exactly as a real batching endpoint may reply.
      return json({
        data: body.input.map((_: string, i: number) => ({ index: i, embedding: vec(i + 1) })).reverse(),
      });
    },
  });
  try {
    const base = `http://localhost:${server.port}/v1`;
    const p = new OpenAICompatProvider({
      ...CFG, chatBaseUrl: base, embedBaseUrl: `${base}/`,
    });
    expect(await p.extract("captured text")).toEqual(["A durable fact."]);
    const out = await p.embed(["a", "b", "c"]);
    expect(out.map((v) => Math.round(v[0]!))).toEqual([1, 2, 3]);
    expect(seen.map((s) => s.path)).toEqual(["/v1/chat/completions", "/v1/embeddings"]);
    expect(seen[0]!.auth).toBe("Bearer chat-secret");
    expect(seen[1]!.auth).toBe("Bearer embed-secret");
  } finally {
    server.stop(true);
  }
});

// --- absent index means 0 (measured against Gemini's compat endpoint) -------

test("embed accepts a response that omits index on element 0, as Gemini does", async () => {
  // The exact shape measured from Gemini's OpenAI-compat /embeddings on
  // 2026-08-25: element 0 carries no `index` key at all, elements 1..n do.
  // proto3 JSON drops zero-valued fields, so any protobuf-backed provider can
  // send this. Rejecting it stalled every embed with "index undefined".
  const { impl } = stubFetch(() => json({
    object: "list",
    data: [
      { object: "embedding", embedding: vec(10) },            // no index -> 0
      { object: "embedding", index: 1, embedding: vec(11) },
      { object: "embedding", index: 2, embedding: vec(12) },
    ],
  }));
  const out = await new OpenAICompatProvider(CFG, impl).embed(["a", "b", "c"]);
  expect(out.map((v) => v[0])).toEqual([10, 11, 12]);
});

test("embed still rejects two elements claiming slot 0", async () => {
  // Absent-as-0 is only safe because this collision is still caught: an
  // explicit 0 alongside an absent one must not silently overwrite.
  const { impl } = stubFetch(() => json({
    object: "list",
    data: [
      { object: "embedding", embedding: vec(10) },            // absent -> 0
      { object: "embedding", index: 0, embedding: vec(11) },  // explicit 0
    ],
  }));
  await expect(new OpenAICompatProvider(CFG, impl).embed(["a", "b"]))
    .rejects.toThrow("duplicate embedding index 0");
});

test("embed still places by index when the response is shuffled", async () => {
  // The anti-corruption guarantee must survive the absent-index allowance.
  const { impl } = stubFetch(() => json({
    object: "list",
    data: [
      { object: "embedding", index: 2, embedding: vec(12) },
      { object: "embedding", embedding: vec(10) },            // absent -> 0
      { object: "embedding", index: 1, embedding: vec(11) },
    ],
  }));
  const out = await new OpenAICompatProvider(CFG, impl).embed(["a", "b", "c"]);
  expect(out.map((v) => v[0])).toEqual([10, 11, 12]);
});

test("a spent balance or quota is a QuotaExhausted of the side that refused", async () => {
  const chat = new OpenAICompatProvider(CFG, async () =>
    json({ error: { message: "Insufficient Balance" } }, 402));
  const chatErr = await chat.extract("t").catch((e) => e);
  expect(chatErr).toBeInstanceOf(QuotaExhausted);
  expect(chatErr.kind).toBe("chat");

  const embed = new OpenAICompatProvider(CFG, async () => new Response(
    JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }),
    { status: 429, headers: { "retry-after": "30" } }));
  const embedErr = await embed.embed(["t"]).catch((e) => e);
  expect(embedErr).toBeInstanceOf(QuotaExhausted);
  expect(embedErr.kind).toBe("embed");
  expect(embedErr.retryAfterMs).toBe(30_000);

  // Any other failure stays an ordinary error, retried per version.
  const broken = new OpenAICompatProvider(CFG, async () => json({ error: "boom" }, 500));
  const err = await broken.extract("t").catch((e) => e);
  expect(err).toBeInstanceOf(Error);
  expect(err).not.toBeInstanceOf(QuotaExhausted);
});
