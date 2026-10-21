import { test, expect } from "bun:test";
import { createApp } from "../src/app";
import { hashDevice } from "../src/device";
import { FakeLedger, fakeDeps, fakeUpstream, mintToken } from "./fakes";

test("GET /health answers 200 when the ledger answers", async () => {
  const ledger = new FakeLedger();
  const res = await createApp(fakeDeps({ ledger })).request("/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(ledger.pings).toBe(1);
});

test("GET /health answers 503 when the ledger is down", async () => {
  const ledger = new FakeLedger();
  ledger.down = true;
  const res = await createApp(fakeDeps({ ledger })).request("/health");
  expect(res.status).toBe(503);
});

// --- the forwarding pipeline -------------------------------------------------

const DAY = "2026-10-21";
const DEVICE = "dev-1";
const chatBody = (content = "x") => ({
  model: "anything", messages: [{ role: "user", content }], temperature: 0,
  response_format: { type: "json_object" },
});
const chatReply = (content = "{}", usage?: object) => ({
  choices: [{ message: { role: "assistant", content } }], ...(usage ? { usage } : {}),
});

async function post(
  deps: ReturnType<typeof fakeDeps>, path: string, body: unknown,
  opts: { token?: string | null; device?: string | null; raw?: string } = {},
) {
  const token = opts.token === undefined ? await mintToken({ sub: "u1", email: "a@example.com" }) : opts.token;
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "203.0.113.7, 10.0.0.1" };
  if (token) headers.authorization = `Bearer ${token}`;
  const device = opts.device === undefined ? DEVICE : opts.device;
  if (device) headers["x-nova-device"] = device;
  return createApp(deps).request(path, { method: "POST", headers, body: opts.raw ?? JSON.stringify(body) });
}

test("a Nova chat request is forwarded with the server's model and its usage is consumed", async () => {
  const upstream = fakeUpstream(() => Response.json(chatReply("{}", { prompt_tokens: 1200, completion_tokens: 80 })));
  const ledger = new FakeLedger();
  const res = await post(fakeDeps({ upstream, ledger }), "/v1/chat/completions", chatBody());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(chatReply("{}", { prompt_tokens: 1200, completion_tokens: 80 }));
  expect(upstream.calls).toHaveLength(1);
  expect(upstream.calls[0]!.kind).toBe("chat");
  expect(upstream.calls[0]!.body).toMatchObject({ model: "deepseek-chat", max_tokens: 4096 });
  expect(ledger.used(`d:${hashDevice(DEVICE)}`, DAY)).toEqual({ in: 1200, out: 80, requests: 1 });
});

test("an embeddings request is forwarded and counted", async () => {
  const upstream = fakeUpstream(() => Response.json({ data: [{ embedding: [0.1] }], usage: { prompt_tokens: 30, total_tokens: 30 } }));
  const ledger = new FakeLedger();
  const res = await post(fakeDeps({ upstream, ledger }), "/v1/embeddings", { model: "x", input: ["a"], dimensions: 1536 });
  expect(res.status).toBe(200);
  expect(upstream.calls[0]!.body).toEqual({ model: "gemini-embedding-001", input: ["a"], dimensions: 1536 });
  expect(ledger.used("u:u1", DAY)).toEqual({ in: 30, out: 0, requests: 1 });
});

test("a reply with no usage is counted by estimate, not as zero", async () => {
  const upstream = fakeUpstream(() => Response.json(chatReply("y".repeat(40))));
  const ledger = new FakeLedger();
  await post(fakeDeps({ upstream, ledger }), "/v1/chat/completions", chatBody("x".repeat(400)));
  expect(ledger.used("u:u1", DAY)).toEqual({ in: 100, out: 10, requests: 1 });
});

test("an upstream 429 passes through with its Retry-After and consumes nothing", async () => {
  const upstream = fakeUpstream(() => new Response('{"error":"rate"}', { status: 429, headers: { "retry-after": "30" } }));
  const ledger = new FakeLedger();
  const res = await post(fakeDeps({ upstream, ledger }), "/v1/chat/completions", chatBody());
  expect(res.status).toBe(429);
  expect(res.headers.get("retry-after")).toBe("30");
  expect(await res.text()).toBe('{"error":"rate"}');
  expect(ledger.usage.size).toBe(0);
});

test("an upstream 500 passes through and consumes nothing", async () => {
  const upstream = fakeUpstream(() => new Response("upstream broke", { status: 500 }));
  const ledger = new FakeLedger();
  const res = await post(fakeDeps({ upstream, ledger }), "/v1/chat/completions", chatBody());
  expect(res.status).toBe(500);
  expect(ledger.usage.size).toBe(0);
});

test("an unreachable upstream is 502 and consumes nothing", async () => {
  const upstream = fakeUpstream(() => { throw new TypeError("fetch failed"); });
  const ledger = new FakeLedger();
  const res = await post(fakeDeps({ upstream, ledger }), "/v1/chat/completions", chatBody());
  expect(res.status).toBe(502);
  expect(ledger.usage.size).toBe(0);
});

test("the ledger being down returns 503 and never calls the upstream", async () => {
  const upstream = fakeUpstream(() => Response.json(chatReply()));
  const ledger = new FakeLedger();
  ledger.down = true;
  const res = await post(fakeDeps({ upstream, ledger }), "/v1/chat/completions", chatBody());
  expect(res.status).toBe(503);
  expect(res.headers.get("retry-after")).toBe("60");
  expect(upstream.calls).toHaveLength(0);
});

test("usage is recorded against both the device and the account", async () => {
  const upstream = fakeUpstream(() => Response.json(chatReply("{}", { prompt_tokens: 5, completion_tokens: 1 })));
  const ledger = new FakeLedger();
  await post(fakeDeps({ upstream, ledger }), "/v1/chat/completions", chatBody());
  expect(ledger.used(`d:${hashDevice(DEVICE)}`, DAY)).toEqual(ledger.used("u:u1", DAY));
  expect([...ledger.usage.keys()].some((k) => k.includes(DEVICE))).toBe(false);
});

test("no bearer token is 401", async () => {
  const res = await post(fakeDeps(), "/v1/chat/completions", chatBody(), { token: null });
  expect(res.status).toBe(401);
});

test("no device header is 400", async () => {
  const res = await post(fakeDeps(), "/v1/chat/completions", chatBody(), { device: null });
  expect(res.status).toBe(400);
});

test("a 300 KiB body is 413 before the session is checked", async () => {
  const res = await post(fakeDeps(), "/v1/chat/completions", null, { token: null, raw: "x".repeat(300 * 1024) });
  expect(res.status).toBe(413);
});

test("a non-JSON body is 400", async () => {
  const res = await post(fakeDeps(), "/v1/chat/completions", null, { raw: "{not json" });
  expect(res.status).toBe(400);
});

test("a JSON array body is 400", async () => {
  const res = await post(fakeDeps(), "/v1/chat/completions", [chatBody()]);
  expect(res.status).toBe(400);
});

test("over the daily cap is 429 with Retry-After until midnight", async () => {
  const upstream = fakeUpstream(() => Response.json(chatReply()));
  const ledger = new FakeLedger();
  ledger.usage.set(`d:${hashDevice(DEVICE)}|${DAY}`, { in: 1_000_000, out: 0, requests: 1 });
  const res = await post(fakeDeps({ upstream, ledger }), "/v1/chat/completions", chatBody());
  expect(res.status).toBe(429);
  expect(res.headers.get("retry-after")).toBe("43200");
  expect(upstream.calls).toHaveLength(0);
});

test("log lines never contain the request content", async () => {
  const lines: string[] = [];
  const upstream = fakeUpstream(() => Response.json(chatReply("REPLY-CANARY")));
  await post(fakeDeps({ upstream, log: (l) => lines.push(JSON.stringify(l)) }), "/v1/chat/completions", chatBody("SECRET-CANARY"));
  expect(lines.length).toBeGreaterThan(0);
  expect(lines.some((l) => l.includes("SECRET-CANARY") || l.includes("REPLY-CANARY"))).toBe(false);
});

// --- /v1/usage ----------------------------------------------------------------

async function getUsage(deps: ReturnType<typeof fakeDeps>, token: string | null) {
  const headers: Record<string, string> = { "x-nova-device": DEVICE };
  if (token) headers.authorization = `Bearer ${token}`;
  return createApp(deps).request("/v1/usage", { headers });
}

test("usage reports plan, today's use, cap and the next UTC midnight", async () => {
  const ledger = new FakeLedger();
  ledger.state = { ...ledger.state, plan: "new", cap: 100_000 };
  ledger.usage.set(`d:${hashDevice(DEVICE)}|${DAY}`, { in: 2000, out: 500, requests: 3 });
  ledger.usage.set(`u:u1|${DAY}`, { in: 3000, out: 1000, requests: 5 });
  const res = await getUsage(fakeDeps({ ledger }), await mintToken({ sub: "u1" }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ plan: "new", usedToday: 4000, capToday: 100_000, resetsAt: "2026-10-22T00:00:00.000Z" });
});

test("usage needs a session", async () => {
  expect((await getUsage(fakeDeps(), null)).status).toBe(401);
});

test("usage never calls the upstream", async () => {
  const upstream = fakeUpstream(() => Response.json({}));
  await getUsage(fakeDeps({ upstream }), await mintToken({ sub: "u1" }));
  expect(upstream.calls).toHaveLength(0);
});
