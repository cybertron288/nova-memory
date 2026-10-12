import { describe, expect, test } from "bun:test";
import { buildEpisodePrompt, type Capture } from "./prompts";
import { validJson } from "./valid-json";

const caps: Capture[] = [
  { ts: "2026-08-12T10:00:05Z", app: "Slack", text: "jordan: send the deck by friday" },
  { ts: "2026-08-12T10:01:12Z", app: "Mail", text: "budget approved at 12k" },
];

describe("buildEpisodePrompt", () => {
  test("includes every capture with provenance", () => {
    const p = buildEpisodePrompt(caps);
    expect(p).toContain("send the deck by friday");
    expect(p).toContain("budget approved at 12k");
    expect(p).toContain("Slack");
    expect(p).toContain("10:00:05");
  });

  test("demands strict JSON with the three output keys", () => {
    const p = buildEpisodePrompt(caps);
    for (const key of ['"summary"', '"entities"', '"loop_candidates"']) expect(p).toContain(key);
    expect(p.toLowerCase()).toContain("only json");
  });
});

const validPayload = {
  summary: "did stuff",
  entities: [{ kind: "person", name: "jordan" }],
  loop_candidates: [],
};
const validPayloadStr = JSON.stringify(validPayload);

describe("validJson", () => {
  test("accepts unfenced valid JSON", () => {
    expect(validJson(validPayloadStr)).toBe(true);
  });

  test("accepts ```json fenced output", () => {
    expect(validJson("```json\n" + validPayloadStr + "\n```")).toBe(true);
  });

  test("accepts bare ``` fenced output (no json tag)", () => {
    expect(validJson("```\n" + validPayloadStr + "\n```")).toBe(true);
  });

  test("accepts leading whitespace before the fence and trailing prose after it", () => {
    expect(validJson("   \n```json\n" + validPayloadStr + "\n```\nhope that helps!")).toBe(true);
  });

  test("rejects malformed JSON", () => {
    expect(validJson("{ not: valid json")).toBe(false);
  });

  test("rejects valid JSON missing a required key", () => {
    const { summary, ...rest } = validPayload;
    expect(validJson(JSON.stringify(rest))).toBe(false);
  });

  test("rejects valid JSON where a required key has the wrong type", () => {
    const wrongType = { ...validPayload, entities: { kind: "person", name: "jordan" } };
    expect(validJson(JSON.stringify(wrongType))).toBe(false);
  });
});
