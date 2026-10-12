import { describe, expect, test } from "bun:test";
import { mulberry32, randomUnitVec, makeSnippet } from "./corpus";

describe("corpus generator", () => {
  test("same seed → identical snippet stream", () => {
    const a = makeSnippet(mulberry32(42), 0, 1_755_000_000_000);
    const b = makeSnippet(mulberry32(42), 0, 1_755_000_000_000);
    expect(a.text).toBe(b.text);
    expect(a.app).toBe(b.app);
    expect(a.capturedAt).toBe(b.capturedAt);
  });

  test("unit vectors have norm ≈ 1 and dim 768", () => {
    const v = randomUnitVec(mulberry32(7));
    expect(v.length).toBe(768);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(Math.abs(norm - 1)).toBeLessThan(1e-5);
  });
});
