import type { Database } from "bun:sqlite";
import { DIM, insertSnippet } from "./db";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomUnitVec(rng: () => number): Float32Array {
  const v = new Float32Array(DIM);
  let norm = 0;
  for (let i = 0; i < DIM; i++) {
    v[i] = rng() * 2 - 1;
    norm += v[i]! * v[i]!;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) v[i]! /= norm;
  return v;
}

const APPS = ["Slack", "Chrome", "Mail", "Notion", "Terminal", "Zoom", "WhatsApp", "Cursor"];
const WORDS = (
  "deck review jordan bug screenshot crash deploy invoice roadmap sprint standup " +
  "budget offsite hiring candidate contract renewal migration postgres relay oauth " +
  "onboarding metrics dashboard retention launch beta feedback ticket incident oncall " +
  "meeting notes follow up promised friday quarterly planning design tokens api schema"
).split(" ");

// ~650 snippets/day for 6 months ≈ 120k rows (spec: 6-month corpus)
export function makeSnippet(rng: () => number, i: number, endTs: number) {
  const day = Math.floor(i / 650);
  const capturedAt =
    endTs - day * 86_400_000 - Math.floor(rng() * 8 * 3_600_000);
  const len = 12 + Math.floor(rng() * 30);
  const words: string[] = [];
  for (let w = 0; w < len; w++) words.push(WORDS[Math.floor(rng() * WORDS.length)]!);
  return {
    capturedAt,
    app: APPS[Math.floor(rng() * APPS.length)]!,
    text: words.join(" "),
    embedding: randomUnitVec(rng),
  };
}

export function buildCorpus(
  db: Database,
  opts: { snippets: number; seed: number; endTs: number },
): void {
  const rng = mulberry32(opts.seed);
  const BATCH = 1000;
  for (let start = 0; start < opts.snippets; start += BATCH) {
    const end = Math.min(start + BATCH, opts.snippets);
    db.transaction(() => {
      for (let i = start; i < end; i++) insertSnippet(db, makeSnippet(rng, i, opts.endTs));
    })();
  }
}
