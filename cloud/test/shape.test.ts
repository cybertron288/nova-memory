import { test, expect } from "bun:test";
import { validateChat, validateEmbed } from "../src/shape";

const chatCfg = { model: "deepseek-chat", maxTokens: 4096 };
const embedCfg = { model: "gemini-embedding-001", maxInputs: 64, maxChars: 200_000 };

// The exact body OpenAICompatProvider sends (daemon/src/provider.ts).
const daemonChat = {
  model: "anything",
  messages: [{ role: "user", content: "x" }],
  temperature: 0,
  response_format: { type: "json_object" },
};

test("the daemon's chat body is accepted with the server's model and max_tokens", () => {
  const r = validateChat(daemonChat, chatCfg);
  expect(r).toEqual({
    ok: true,
    body: {
      model: "deepseek-chat",
      messages: [{ role: "user", content: "x" }],
      temperature: 0,
      response_format: { type: "json_object" },
      max_tokens: 4096,
    },
  });
});

const rejectedChat: [string, unknown][] = [
  ["two messages", { ...daemonChat, messages: [daemonChat.messages[0], daemonChat.messages[0]] }],
  ["a system message", { ...daemonChat, messages: [{ role: "system", content: "x" }] }],
  ["temperature 0.7", { ...daemonChat, temperature: 0.7 }],
  ["no response_format", { ...daemonChat, response_format: undefined }],
  ["stream: true", { ...daemonChat, stream: true }],
  ["content that is not a string", { ...daemonChat, messages: [{ role: "user", content: [{ type: "text", text: "x" }] }] }],
  ["an array body", [daemonChat]],
  ["a null body", null],
];

for (const [name, body] of rejectedChat) {
  test(`a chat body with ${name} is refused with 400`, () => {
    const r = validateChat(body, chatCfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
}

test("the daemon's embed body is accepted", () => {
  expect(validateEmbed({ model: "x", input: ["a", "b"], dimensions: 1536 }, embedCfg)).toEqual({
    ok: true,
    body: { model: "gemini-embedding-001", input: ["a", "b"], dimensions: 1536 },
  });
});

test("an embed body without dimensions is accepted without one", () => {
  expect(validateEmbed({ model: "x", input: ["a"] }, embedCfg))
    .toEqual({ ok: true, body: { model: "gemini-embedding-001", input: ["a"] } });
});

const rejectedEmbed: [string, unknown][] = [
  ["65 inputs", { input: Array.from({ length: 65 }, () => "a") }],
  ["a non-string input", { input: ["a", 2] }],
  ["too many characters", { input: ["a".repeat(150_000), "b".repeat(60_000)] }],
  ["dimensions 768", { input: ["a"], dimensions: 768 }],
  ["a bare string input", { input: "a" }],
  ["no inputs", { input: [] }],
];

for (const [name, body] of rejectedEmbed) {
  test(`an embed body with ${name} is refused with 400`, () => {
    const r = validateEmbed(body, embedCfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
}
