/**
 * The morning digest (F4.3): open loops grouped by person, what the user
 * waits on, and what they did yesterday. Built on request by the shell, which
 * decides when to show it (spec 2026-09-24-morning-digest-design.md).
 *
 * Grouping happens here, not in the model, so the AI path and the fallback
 * agree on who every block is for. The model only writes sentences; when it
 * fails in any way the digest still ships, in plain lines.
 */
import type { Database } from "bun:sqlite";
import { attributed } from "./calls";
import { decryptField } from "./db";
import { countOpenLoops, listOpenLoops, type OpenLoop } from "./loops";
import {
  userIdentityFromEnv,
  type DigestGroup, type DigestSummary, type InferenceProvider,
} from "./provider";

export interface DigestBlock {
  person: string | null;
  text: string;
  /** How many loops the block covers, for the card's tally. */
  loops: number;
}
export interface MorningDigest {
  /**
   * Every open loop, the user's own and waiting-on together. The blocks cover
   * the newest 50; the count covers all of them.
   */
  count: number;
  owe: DigestBlock[];
  waitingOn: DigestBlock[];
  yesterday: string | null;
  /** False when the fallback wrote the lines. */
  summarized: boolean;
  /** The user's first name for the greeting, or null when unset. */
  user: string | null;
}

export const DIGEST_TIMEOUT_MS = 20_000;
const YESTERDAY_MAX = 60;

/** The previous local calendar day, [from, to) in epoch ms. Not now - 24h. */
export function yesterdayWindow(now: Date): { from: number; to: number } {
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 1);
  return { from: from.getTime(), to: to.getTime() };
}

function group(loops: OpenLoop[]): DigestGroup[] {
  const by = new Map<string | null, string[]>();
  for (const l of loops) {
    const k = l.counterparty?.trim() || null;
    by.set(k, [...(by.get(k) ?? []), l.description]);
  }
  return [...by.entries()]
    .map(([person, items]) => ({ person, loops: items }))
    .sort((a, b) =>
      (a.person === null ? 1 : 0) - (b.person === null ? 1 : 0)
      || b.loops.length - a.loops.length
      || (a.person ?? "").localeCompare(b.person ?? ""));
}

function plain(g: DigestGroup): DigestBlock {
  return { person: g.person, text: g.loops.length === 1 ? g.loops[0]! : `${g.loops.length} loops`, loops: g.loops.length };
}

function yesterdayMemories(db: Database, key: Buffer, now: Date): string[] {
  const { from, to } = yesterdayWindow(now);
  const rows = db.prepare(
    `SELECT content FROM memory_derivatives
      WHERE committed_at >= ? AND committed_at < ?
      ORDER BY committed_at DESC LIMIT ?`,
  ).all(from, to, YESTERDAY_MAX) as { content: string }[];
  const out: string[] = [];
  for (const r of rows) {
    try { out.push(decryptField(r.content, key)); } catch { /* one bad row must not empty it */ }
  }
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`digest timed out after ${ms} ms`)), ms)),
  ]);
}

export async function buildMorningDigest(
  db: Database, key: Buffer, provider: InferenceProvider,
  now: Date = new Date(), timeoutMs: number = DIGEST_TIMEOUT_MS,
): Promise<MorningDigest> {
  const loops = listOpenLoops(db, key, { direction: "any", limit: 50 });
  const identity = userIdentityFromEnv();
  const user = identity?.name.trim().split(/\s+/)[0] || null;
  if (loops.length === 0) return { count: 0, owe: [], waitingOn: [], yesterday: null, summarized: false, user };

  const count = countOpenLoops(db);
  const owe = group(loops.filter((l) => l.direction !== "owed_to_me"));
  const waitingOn = group(loops.filter((l) => l.direction === "owed_to_me"));
  const fallback: MorningDigest = {
    count, owe: owe.map(plain), waitingOn: waitingOn.map(plain),
    yesterday: null, summarized: false, user,
  };
  if (!provider.summarizeDigest) return fallback;

  let s: DigestSummary;
  try {
    const summarize = provider.summarizeDigest.bind(provider);
    s = await withTimeout(attributed({ purpose: "digest", captureIds: [] }, () => summarize({
      owe, waitingOn, yesterday: yesterdayMemories(db, key, now), user: identity,
    })), timeoutMs);
  } catch (e) {
    console.error(`[digest] using plain lines: ${e instanceof Error ? e.message : String(e)}`);
    return fallback;
  }
  return {
    count,
    owe: owe.map((g, i) => ({ person: g.person, text: s.owe[i]!, loops: g.loops.length })),
    waitingOn: waitingOn.map((g, i) => ({ person: g.person, text: s.waitingOn[i]!, loops: g.loops.length })),
    yesterday: s.yesterday,
    summarized: true,
    user,
  };
}
