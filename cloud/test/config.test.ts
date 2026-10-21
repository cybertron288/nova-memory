import { test, expect } from "bun:test";
import { ConfigError, loadConfig } from "../src/config";
import { fullEnv } from "./fakes";

test("loadConfig names every missing variable", () => {
  try {
    loadConfig({});
    throw new Error("loadConfig accepted an empty environment");
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    const message = (e as Error).message;
    expect(message).toContain("UPSTREAM_CHAT_BASE_URL");
    expect(message).toContain("SUPABASE_URL");
    expect(message).toContain("NOVA_MONTHLY_CEILING_USD");
  }
});

test("loadConfig refuses a non-numeric ceiling", () => {
  expect(() => loadConfig({ ...fullEnv, NOVA_MONTHLY_CEILING_USD: "twenty" }))
    .toThrow(/NOVA_MONTHLY_CEILING_USD/);
});

test("loadConfig reads a complete environment", () => {
  const config = loadConfig(fullEnv);
  expect(config.monthlyCeilingUsd).toBe(20);
  expect(config.chat.model).toBe("deepseek-chat");
  expect(config.jwksUrl).toBe("https://project.supabase.co/auth/v1/.well-known/jwks.json");
});

test("loadConfig refuses a zero price", () => {
  expect(() => loadConfig({ ...fullEnv, NOVA_PRICE_EMBED: "0" })).toThrow(/NOVA_PRICE_EMBED/);
});

test("loadConfig requires an IP hash secret of at least 32 characters", () => {
  const { NOVA_IP_HASH_SECRET: _, ...without } = fullEnv;
  expect(() => loadConfig(without)).toThrow(/NOVA_IP_HASH_SECRET/);
  expect(() => loadConfig({ ...fullEnv, NOVA_IP_HASH_SECRET: "short" })).toThrow(/NOVA_IP_HASH_SECRET/);
});
