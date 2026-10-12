// What left the machine, for the transparency panel (F5.5).
//
// "You can monitor these calls" is not enough here. Nova's claim is
// stronger, because the store holds the content and the panel has to be able
// to show that what was sent was only ever a derived payload. So this log is
// metadata and nothing else: provider, model, kind, size, timing, outcome.
// No prompt, no reply, no captured text. A log that quoted the content would
// be one more copy of exactly what it exists to reassure the user about.
//
// Recording never fails a call. The log is an observation of work that
// already happened, and losing a row matters far less than turning a
// successful extraction into a failed one — the same reasoning that keeps the
// loop pass outside the commit in pipeline.ts.
import type { Database } from "bun:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type CallKind = "chat" | "embed";
export type CallOutcome = "ok" | "error";

/**
 * Why a call was made. The Inspector names a request by the capture it
 * carried; a call with no capture (the briefing, the quota probe) is named by
 * this instead, so no row reads as an unexplained send.
 */
export type CallPurpose = "memories" | "loops" | "digest" | "probe" | "search";

/** What the calls made inside an `attributed` scope were for. */
export interface Attribution {
  purpose: CallPurpose;
  /** The captures (memory_versions ids) whose text the calls carried. */
  captureIds: string[];
}

// Ambient rather than threaded through the provider interface: the provider
// reports a call from deep inside its own retry loop, and widening every
// method signature (and every fake) to carry an id it never reads would be
// noise. AsyncLocalStorage follows the awaits, so two overlapping drains
// cannot attribute each other's calls the way a module variable would.
const scope = new AsyncLocalStorage<Attribution>();

/** Runs `fn` so that every call it records is attributed to `a`. */
export function attributed<T>(a: Attribution, fn: () => Promise<T>): Promise<T> {
  return scope.run(a, fn);
}

export interface NewCall {
  provider: string;
  model: string;
  kind: CallKind;
  outcome: CallOutcome;
  /** Wall-clock duration of the request. */
  ms: number;
  /** How much text was sent, as a count. Never the text. */
  inputChars: number;
  /** Prompts for a chat call, texts for an embed batch. */
  items: number;
  status?: number;
  /** A short reason for a failure. Already-summarised, never a response body. */
  detail?: string;
}

export interface ProviderCall extends NewCall {
  id: string;
  at: number;
  /** Absent for a call made outside any `attributed` scope. */
  purpose?: CallPurpose;
  captureIds: string[];
}

/**
 * How many rows the log keeps. The panel shows a recent window and the user's
 * own retention policy (F5.4) governs memories, not this; a few thousand rows
 * is enough to answer "what has Nova been sending" and small enough that it
 * never becomes a storage question of its own.
 */
export const TRIM_KEEP = 2000;

/** Records one call. Swallows its own failures: see the note above. */
export function recordCall(db: Database, c: NewCall): void {
  try {
    const a = scope.getStore();
    db.prepare(
      `INSERT INTO provider_calls
         (id, at, provider, model, kind, outcome, ms, input_chars, items, status, detail,
          purpose, capture_ids)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      randomUUID(), Date.now(), c.provider, c.model, c.kind, c.outcome,
      Math.round(c.ms), c.inputChars, c.items, c.status ?? null, c.detail ?? null,
      a?.purpose ?? null, a && a.captureIds.length > 0 ? JSON.stringify(a.captureIds) : null,
    );
    // Trim on write rather than on a timer: there is no other moment the log
    // is known to have grown, and a scheduled sweep is one more thing to fail
    // quietly.
    //
    // Keyed on rowid, not `at`: a drain embeds in batches and records several
    // calls inside one millisecond, so thousands of rows share a timestamp and
    // `at < min(at)` deleted none of them.
    db.prepare(
      `DELETE FROM provider_calls WHERE rowid <= (
         SELECT max(rowid) FROM provider_calls) - ?`,
    ).run(TRIM_KEEP);
  } catch (e) {
    console.error(`[calls] could not record a ${c.kind} call: ${e}`);
  }
}

function row(r: Record<string, unknown>): ProviderCall {
  return {
    id: r.id as string,
    at: r.at as number,
    provider: r.provider as string,
    model: r.model as string,
    kind: r.kind as CallKind,
    outcome: r.outcome as CallOutcome,
    ms: r.ms as number,
    inputChars: r.input_chars as number,
    items: r.items as number,
    ...(r.status === null ? {} : { status: r.status as number }),
    ...(r.detail === null ? {} : { detail: r.detail as string }),
    ...(r.purpose == null ? {} : { purpose: r.purpose as CallPurpose }),
    captureIds: r.capture_ids == null ? [] : JSON.parse(r.capture_ids as string) as string[],
  };
}

/** The most recent calls, newest first. */
export function listCalls(db: Database, limit = 50): ProviderCall[] {
  const rows = db
    .prepare("SELECT * FROM provider_calls ORDER BY at DESC, rowid DESC LIMIT ?")
    .all(Math.max(1, Math.min(limit, TRIM_KEEP))) as Record<string, unknown>[];
  return rows.map(row);
}

export interface CallTotal { calls: number; errors: number; inputChars: number; items: number }

/**
 * Per-kind totals, for the Inspector's summary line. `since` (epoch ms) scopes
 * them to the user's day; without it they cover the whole log.
 */
export function callTotals(db: Database, since = 0): Record<CallKind, CallTotal> {
  const empty = (): CallTotal => ({ calls: 0, errors: 0, inputChars: 0, items: 0 });
  const out: Record<CallKind, CallTotal> = { chat: empty(), embed: empty() };
  const rows = db.prepare(
    `SELECT kind,
            count(*) AS calls,
            sum(outcome = 'error') AS errors,
            sum(input_chars) AS input_chars,
            sum(items) AS items
       FROM provider_calls WHERE at >= ? GROUP BY kind`,
  ).all(since) as { kind: CallKind; calls: number; errors: number; input_chars: number; items: number }[];
  for (const r of rows) {
    out[r.kind] = {
      calls: r.calls, errors: r.errors ?? 0,
      inputChars: r.input_chars ?? 0, items: r.items ?? 0,
    };
  }
  return out;
}
