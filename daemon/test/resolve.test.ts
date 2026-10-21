import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProvider } from "../src/resolve";
import { NovaCloudProvider } from "../src/cloud";
import { GeminiProvider, MissingKeyProvider, OpenAICompatProvider, UnconfiguredProvider } from "../src/provider";
import { SessionStore } from "../src/session";

const CLOUD = { NOVA_CLOUD_URL: "https://cloud.example", NOVA_AUTH_URL: "https://auth.example", NOVA_AUTH_KEY: "pk" };
const OPENAI = {
  NOVA_CHAT_BASE_URL: "https://chat.example", NOVA_CHAT_API_KEY: "ck", NOVA_CHAT_MODEL: "m",
  NOVA_EMBED_BASE_URL: "https://embed.example", NOVA_EMBED_API_KEY: "ek", NOVA_EMBED_MODEL: "e",
};
const deps = () => ({
  session: new SessionStore({
    secrets: { read: async () => null, write: async () => {}, remove: async () => {} },
    lockPath: join(mkdtempSync(join(tmpdir(), "nova-resolve-")), "session.lock"),
    refresh: async () => ({ status: 400, body: null }),
  }),
  deviceKey: async () => "d".repeat(64),
  lockPath: "/unused",
});

test("NOVA_* wins over Nova Cloud", async () => {
  const r = await resolveProvider({ ...OPENAI, ...CLOUD }, undefined, deps());
  expect(r.mode).toBe("env");
  expect(r.provider).toBeInstanceOf(OpenAICompatProvider);
  expect(r.session).toBeNull();
});

test("GEMINI_API_KEY wins over Nova Cloud", async () => {
  const r = await resolveProvider({ GEMINI_API_KEY: "g", ...CLOUD }, undefined, deps());
  expect(r.mode).toBe("env");
  expect(r.provider).toBeInstanceOf(GeminiProvider);
});

test("Nova Cloud when only its three variables are set", async () => {
  const d = deps();
  const r = await resolveProvider(CLOUD, undefined, d);
  expect(r.mode).toBe("cloud");
  expect(r.provider).toBeInstanceOf(NovaCloudProvider);
  expect(r.session).toBe(d.session);
});

test("no configuration is mode none", async () => {
  const r = await resolveProvider({}, undefined, deps());
  expect(r.mode).toBe("none");
  expect(r.provider).toBeInstanceOf(MissingKeyProvider);
});

test("a partial Nova Cloud configuration is named, not thrown", async () => {
  const r = await resolveProvider({ NOVA_CLOUD_URL: "https://cloud.example" }, undefined, deps());
  expect(r.mode).toBe("none");
  expect(r.provider).toBeInstanceOf(UnconfiguredProvider);
  await expect(r.provider.extract("")).rejects.toThrow(/NOVA_AUTH_URL/);
});
