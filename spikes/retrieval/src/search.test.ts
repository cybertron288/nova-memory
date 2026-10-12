import { describe, expect, test } from "bun:test";
import { openDb, insertSnippet } from "./db";
import { hybridSearch } from "./search";

const DIM = 768;
function unitVec(hotIndex: number): Float32Array {
  const v = new Float32Array(DIM);
  v[hotIndex] = 1;
  return v;
}

const NOW = 1_755_000_000_000; // fixed clock for determinism
const DAY = 86_400_000;

function seed(db: ReturnType<typeof openDb>) {
  // A: exact vector match for the query, but old and no keyword overlap
  insertSnippet(db, { capturedAt: NOW - 60 * DAY, app: "Slack",
    text: "quarterly planning deck review with jordan", embedding: unitVec(0) });
  // B: exact keyword match, orthogonal vector, old
  insertSnippet(db, { capturedAt: NOW - 60 * DAY, app: "Mail",
    text: "the crash screenshot bug report", embedding: unitVec(1) });
  // C: no relevance at all, but captured today
  insertSnippet(db, { capturedAt: NOW, app: "Terminal",
    text: "brew upgrade completed successfully", embedding: unitVec(2) });
}

describe("hybridSearch", () => {
  test("vector similarity dominates keyword and recency (0.55 > 0.3 > 0.15)", () => {
    const db = openDb();
    seed(db);
    const results = hybridSearch(db, "crash screenshot", unitVec(0), { now: NOW });
    expect(results[0]!.text).toContain("jordan");      // A wins on vector weight
    expect(results[1]!.text).toContain("screenshot"); // B second on keyword
  });

  test("recency breaks ties between otherwise-irrelevant snippets", () => {
    const db = openDb();
    seed(db);
    const results = hybridSearch(db, "zzz-no-keyword", unitVec(3), { now: NOW });
    // no vector or keyword signal anywhere → recency orders them
    expect(results[0]!.app).toBe("Terminal");
  });

  test("returns provenance fields and respects limit", () => {
    const db = openDb();
    seed(db);
    const results = hybridSearch(db, "bug", unitVec(1), { now: NOW, limit: 2 });
    expect(results.length).toBe(2);
    expect(results[0]).toHaveProperty("app");
    expect(results[0]).toHaveProperty("capturedAt");
    expect(results[0]!.score).toBeGreaterThan(0);
  });
});
