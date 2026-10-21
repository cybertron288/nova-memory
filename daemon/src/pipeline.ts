// Extraction and embedding (spec 4.3). Everything here is off the capture
// write path: captures are stored whether or not the network works.
import type { Database } from "bun:sqlite";
import { closeLoops, recordLoops, trackedLoops, watchesForLoops } from "./loops";
import { attributed } from "./calls";
import { encryptField, decryptField, DIM, unitVector } from "./db";
import { ProviderUnreachable, QuotaExhausted, type InferenceProvider } from "./provider";
import { userIdentity } from "./identity";
import { createHash, randomUUID } from "node:crypto";

const MAX_ATTEMPTS = 8;

/**
 * How long to wait before trying again when the provider cannot be reached.
 * Fixed, not exponential: no attempt is spent, so there is no count to grow.
 */
const UNREACHABLE_RETRY_MS = 60_000;

/**
 * How long a claimed job may sit in 'processing' before another drain may take
 * it. Longer than any sane provider call, so the only rows it frees are ones
 * whose holder is genuinely gone; too short and a slow-but-live extraction gets
 * duplicated, which is the cost this claim exists to avoid.
 */
export const CLAIM_TIMEOUT_MS = 10 * 60_000;
const BATCH = 64;

/**
 * One readable line for a retryable error.
 *
 * Provider errors arrive as a status line followed by a JSON body that can run
 * to dozens of lines. Repeated per attempt per version, that is the whole
 * terminal. Keep the status and the first line — enough to tell a rate limit
 * from a bad key — and drop the rest. Nothing is lost: the give-up path logs
 * the untruncated error, and the message is already key-redacted upstream by
 * the provider's redactedErrorBody.
 */
export function summarizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Collapse the whole message to one line BEFORE truncating. Splitting on the
  // first newline looked right and was useless in practice: a pretty-printed
  // JSON body starts with a bare "{", so the log read
  //   embed gemini-embedding-001 400: {
  // and the actual reason never appeared anywhere. Providers pretty-print by
  // default, so the diagnostic must survive that, not assume one-line errors.
  const oneLine = msg.replace(/\s+/g, " ").trim();
  const rateLimited = /\b429\b|rate.?limit|quota|RESOURCE_EXHAUSTED/i.test(msg);
  const head = oneLine.length > 220 ? `${oneLine.slice(0, 217)}...` : oneLine;
  return rateLimited ? `${head}  [rate limited — backing off, nothing lost]` : head;
}

export function enqueueExtraction(db: Database, versionId: string): void {
  db.prepare(`INSERT OR IGNORE INTO memory_retry_queue
      (id, kind, version_id, attempts, next_attempt_at) VALUES (?, 'extract', ?, 0, 0)`)
    .run(randomUUID(), versionId);
}

/**
 * float32 -> int8, scaled per-vector so the quantized direction is preserved.
 * The scale itself is discarded, not stored — the int8 column can't be
 * dequantized standalone. That's intentional: the float32 sidecar in
 * memory_derivative_vectors is the rescore source of truth.
 */
export function quantize(v: Float32Array): Int8Array {
  let max = 0;
  for (const x of v) max = Math.max(max, Math.abs(x));
  const scale = max === 0 ? 1 : 127 / max;
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.round(v[i]! * scale);
  return q;
}

/**
 * The lines of `current` that `earlier` did not contain, in order, or "" when
 * nothing is new. Lines compare trimmed, so re-indentation is not news.
 */
export function addedLines(earlier: string, current: string): string {
  const seen = new Set(earlier.split("\n").map((l) => l.trim()));
  return current
    .split("\n")
    .filter((l) => l.trim() !== "" && !seen.has(l.trim()))
    .join("\n");
}

/** Context for reading new lines, capped so a long backlog does not dominate the prompt. */
const EARLIER_CONTEXT_CHARS = 3000;
function tail(text: string): string {
  return text.length <= EARLIER_CONTEXT_CHARS ? text : `…${text.slice(-EARLIER_CONTEXT_CHARS)}`;
}

/**
 * Releases claims held by a previous run, returning how many rows were freed.
 *
 * Call this at daemon startup, before the first drain. `shutdown()` exits with
 * process.exit(0), so a drain in flight is abandoned while it still holds its
 * claim — and with a *recent* claimed_at, which drainQueue's reclaim arm will
 * not touch until CLAIM_TIMEOUT_MS has passed. Restarting two seconds later
 * would otherwise mean waiting out the full ten minutes for a job nothing is
 * working on, and no other path rescues it: enqueueExtraction's INSERT OR
 * IGNORE finds the row already there, and the same-hour overwrite in threads.ts
 * resets embedding_status without touching the queue row.
 *
 * At startup no drain can legitimately be in flight in this process, so every
 * 'processing' row is by definition abandoned by a previous run. That is what
 * makes this safe to do unconditionally, and why it belongs at startup rather
 * than on a timer — the claim timeout still covers the case this cannot see, a
 * holder dying while another process is live.
 */
export function releaseStaleClaims(db: Database): number {
  return db.prepare(
    "UPDATE memory_retry_queue SET status='pending', claimed_at=NULL WHERE status='processing'",
  ).run().changes;
}

const QUOTA_BACKOFF_MIN_MS = 60_000;
const QUOTA_BACKOFF_MAX_MS = 3_600_000;

/**
 * One pause for every provider call, whichever side ran out.
 *
 * A version needs chat (memories, loops) and embeddings together. With one
 * side out of quota the other is paid for nothing: seen 2026-09-23, Gemini
 * embeddings at 429 while every drain still paid DeepSeek to extract memories
 * that could not be stored and were extracted again on the next retry. So a
 * quota refusal from either side pauses both, and the side that refused is
 * the one asked first when the pause ends.
 */
export class QuotaGate {
  /** The side that ran out, or null when calls may proceed. */
  kind: "chat" | "embed" | null = null;
  until = 0;
  private backoffMs = 0;

  trip(e: QuotaExhausted, now: number = Date.now()): void {
    this.kind = e.kind;
    this.backoffMs = e.retryAfterMs
      ?? Math.min(Math.max(this.backoffMs * 2, QUOTA_BACKOFF_MIN_MS), QUOTA_BACKOFF_MAX_MS);
    this.until = now + this.backoffMs;
    console.error(`[pipeline] ${e.kind} quota exhausted; pausing all provider calls for `
      + `${Math.round(this.backoffMs / 1000)}s: ${summarizeError(e)}`);
  }

  clear(): void {
    if (this.kind) console.error(`[pipeline] ${this.kind} quota is back; provider calls resume`);
    this.kind = null;
    this.until = 0;
    this.backoffMs = 0;
  }
}

/** The daemon's gate. Tests pass their own. */
export const quotaGate = new QuotaGate();

/**
 * Whether the provider could be reached on the last try (F1.6).
 *
 * A pause on the drain rather than a later `next_attempt_at` on each row, so
 * the network coming back can end it in one step: the shell sees the path
 * return and sends `network_up`, and the backlog drains then instead of up to
 * a minute later.
 */
export class Reachability {
  /** When the provider was first found unreachable, or null when it answers. */
  since: number | null = null;
  until = 0;

  fail(now: number = Date.now()): void {
    this.since ??= now;
    this.until = now + UNREACHABLE_RETRY_MS;
  }

  ok(): void {
    if (this.since !== null) {
      console.error(`[pipeline] provider reachable again after ${Math.round((Date.now() - this.since) / 1000)}s`);
    }
    this.since = null;
    this.until = 0;
  }

  /** Lets the next drain try now. `since` stays until a call gets through. */
  retryNow(): void {
    this.until = 0;
  }
}

export const reachability = new Reachability();

/**
 * Process every due job. Returns how many versions were fully processed.
 * A failing job is left queued with its attempt count raised — the network
 * being down must never lose a capture.
 */
export async function drainQueue(
  db: Database, key: Buffer, provider: InferenceProvider, gate: QuotaGate = quotaGate,
  reach: Reachability = reachability,
): Promise<number> {
  const now = Date.now();
  if (gate.kind && now < gate.until) return 0;
  if (now < reach.until) return 0;
  // Ask the side that ran out before paying the other. A chat refusal needs no
  // separate probe: extraction is the first call a job makes.
  if (gate.kind === "embed") {
    try {
      await attributed({ purpose: "probe", captureIds: [] }, () => provider.embed(["quota check"]));
      gate.clear();
    } catch (e) {
      if (e instanceof QuotaExhausted) { gate.trip(e); return 0; }
      gate.clear();
    }
  }

  // Claim inside a transaction rather than selecting bare, so two overlapping
  // drains cannot both take the same row. Without this a slow provider plus the
  // 15s tick has both drains calling extract() for one version: the commit is
  // idempotent so the store stays right, but the provider is paid twice.
  //
  // The second arm reclaims a row whose holder died: no catch runs on a killed
  // process, so the row would otherwise sit 'processing' forever. Expiring the
  // claim is what recovers it, with no separate janitor to run.
  //
  // Oldest version first: a version is diffed against its predecessor only
  // once that predecessor's memories exist, so draining out of order would
  // extract the shared lines twice.
  const jobs = db.transaction(() => {
    const rows = db.prepare(
      `SELECT q.id, q.version_id, q.attempts FROM memory_retry_queue q
         LEFT JOIN memory_versions v ON v.id = q.version_id
        WHERE q.next_attempt_at <= ?
          AND q.parked_at IS NULL
          AND (q.status = 'pending'
               OR (q.status = 'processing' AND q.claimed_at IS NOT NULL AND q.claimed_at < ?))
        ORDER BY v.committed_at`,
    ).all(now, now - CLAIM_TIMEOUT_MS) as {
      id: string; version_id: string; attempts: number;
    }[];
    const claim = db.prepare(
      "UPDATE memory_retry_queue SET status='processing', claimed_at=? WHERE id=?",
    );
    for (const j of rows) claim.run(now, j.id);
    return rows;
  })();

  const release = db.prepare(
    "UPDATE memory_retry_queue SET status='pending', claimed_at=NULL WHERE id=?",
  );
  let done = 0;
  for (const [index, job] of jobs.entries()) {
    let exhausted: QuotaExhausted | null = null;
    let unreachable: ProviderUnreachable | null = null;
    // Join the thread for the capture's own app, title and URL. Without them
    // the model has no date and no source, and fills both gaps by inventing:
    // measured 2026-08-25, memories dated "June 25, 2025" for content captured
    // that morning, and facts about VSCodium filed against whichever window
    // happened to be displaying the text.
    const version = db.prepare(
      `SELECT v.id, v.thread_id, v.content, v.content_hash, v.committed_at,
              t.source_app, t.source_title, t.source_url
         FROM memory_versions v JOIN memory_threads t ON t.id = v.thread_id
        WHERE v.id = ?`
    ).get(job.version_id) as any;
    if (!version) { db.prepare("DELETE FROM memory_retry_queue WHERE id=?").run(job.id); continue; }

    try {
      // All network work happens first, against a snapshot of the content, and
      // nothing is written until it is all in hand. `nova start` runs
      // setInterval(drainQueue) and ingestStream on one event loop, so a capture
      // line — and commitVersion's same-hour overwrite, which deletes this
      // version's derivatives — can land during either await below. Writing
      // derivatives before the await and vector rows after it left vector rows
      // pointing at derivative ids the overwrite had already deleted, in both
      // tables, unreclaimable: every DELETE against either vector table keys off
      // a subquery into memory_derivatives.
      const content = decryptField(version.content, key);
      const ctx = {
        app: version.source_app,
        title: version.source_title ? decryptField(version.source_title, key) : "",
        url: version.source_url ? decryptField(version.source_url, key) : null,
        capturedAt: version.committed_at,
        user: userIdentity(db, key).identity,
      };
      // Diff against the previous version only when its memories exist: text
      // from a version that failed extraction was never recorded, so it is
      // still new.
      const previous = db.prepare(
        `SELECT content, embedding_status FROM memory_versions
          WHERE thread_id=? AND committed_at < ? ORDER BY committed_at DESC LIMIT 1`,
      ).get(version.thread_id, version.committed_at) as
        { content: string; embedding_status: string } | null;
      const earlier = previous?.embedding_status === "completed"
        ? decryptField(previous.content, key) : null;
      const fresh = earlier === null ? content : addedLines(earlier, content);
      // Every call below carries this one capture, and says so in the call
      // log: the Inspector lights a request's capture from it (F5.5).
      const forMemories = { purpose: "memories" as const, captureIds: [version.id as string] };
      const memories = fresh === ""
        ? []
        : await attributed(forMemories, () =>
            provider.extract(fresh, earlier === null ? ctx : { ...ctx, earlier: tail(earlier) }));

      const vectors: Float32Array[] = [];
      for (let i = 0; i < memories.length; i += BATCH) {
        const vecs = await attributed(forMemories, () => provider.embed(memories.slice(i, i + BATCH)));
        for (const v of vecs) {
          if (v.length !== DIM) throw new Error(`embedding dim ${v.length}, expected ${DIM}`);
          vectors.push(unitVector(v));
        }
      }
      if (vectors.length !== memories.length) {
        throw new Error(`embedded ${vectors.length} of ${memories.length} memories`);
      }

      // One transaction for the whole commit. It re-reads content_hash under
      // the same transaction that writes: if the content changed while the
      // network calls were in flight, this extraction describes text that is no
      // longer stored, and writing it would attach stale memories to fresh
      // content. Narrowing the window is not enough — this check is what makes
      // the interleaving safe rather than merely unlikely.
      // Loop work needs provider calls, so it cannot run inside the commit
      // transaction. The ids and vectors written here are collected for it to
      // use once the transaction has succeeded.
      const committedDerivatives: { id: string; text: string; vector: Float32Array }[] = [];
      const committed = db.transaction((): boolean => {
        const current = db.prepare(
          "SELECT content_hash FROM memory_versions WHERE id=?"
        ).get(version.id) as { content_hash: string } | null;
        if (!current || current.content_hash !== version.content_hash) return false;

        // Clear any prior output for the version before writing this attempt's,
        // in FK-safe order. Without this, a failed attempt's derivatives stay in
        // place and the retry inserts a fresh, disjoint set on top — permanently
        // duplicating memories on every transient network blip. It belongs here,
        // per version and inside the commit, not per embed batch.
        const stale = "(SELECT id FROM memory_derivatives WHERE version_id=?)";
        db.prepare(`DELETE FROM memory_derivative_embeddings WHERE derivative_id IN ${stale}`).run(version.id);
        db.prepare(`DELETE FROM memory_derivative_vectors WHERE derivative_id IN ${stale}`).run(version.id);
        db.prepare("DELETE FROM memory_derivatives WHERE version_id=?").run(version.id);

        committedDerivatives.length = 0;
        for (let i = 0; i < memories.length; i++) {
          const m = memories[i]!;
          const v = vectors[i]!;
          const id = randomUUID();
          committedDerivatives.push({ id, text: m, vector: v });
          db.prepare(`INSERT INTO memory_derivatives
              (id, thread_id, version_id, content, content_hash, committed_at, embedding_status)
              VALUES (?,?,?,?,?,?, 'completed')`)
            .run(id, version.thread_id, version.id, encryptField(m, key),
                 createHash("sha256").update(m).digest("hex"), version.committed_at);
          // sqlite-vec misreads a raw buffer bind as float32 regardless of byte
          // length, silently storing garbage into an int8[] column. Insert
          // through vec_int8() with a JSON array instead — verified to round
          // trip exactly via a scratch check before wiring this in.
          db.prepare("INSERT INTO memory_derivative_embeddings (derivative_id, embedding) VALUES (?, vec_int8(?))")
            .run(id, JSON.stringify(Array.from(quantize(v))));
          db.prepare("INSERT INTO memory_derivative_vectors (derivative_id, vector) VALUES (?,?)")
            .run(id, Buffer.from(v.buffer.slice(0)));
        }

        db.prepare("UPDATE memory_versions SET embedding_status='completed' WHERE id=?").run(version.id);
        db.prepare("DELETE FROM memory_retry_queue WHERE id=?").run(job.id);
        return true;
      })();

      if (!committed) {
        // The content changed under us, so this extraction is stale: discard it
        // and leave the version queued. This cannot spin — the overwriter set
        // embedding_status back to 'pending' and re-queued the version (a no-op
        // under UNIQUE(kind, version_id) if the job row is still the one being
        // processed here), and the next drain re-reads the content, so the retry
        // extracts the NEW content and its hash check passes. The attempt count
        // is deliberately not raised: nothing failed, and counting this toward
        // MAX_ATTEMPTS would let a busy page burn its retries and land in
        // 'failed' without a single real error.
        console.error(`[pipeline] version ${version.id}: content changed during extraction, discarding stale result and leaving it queued`);
        // Release the claim as well as leaving the row queued. This path
        // deliberately does not raise attempts — nothing failed — so it must
        // not hold the claim either, or the retry waits out CLAIM_TIMEOUT_MS
        // for no reason.
        db.prepare(
          "UPDATE memory_retry_queue SET status='pending', claimed_at=NULL WHERE id=?",
        ).run(job.id);
        continue;
      }

      if (fresh === "") {
        console.error(`[pipeline] version ${version.id}: nothing new since the previous version`);
      } else if (memories.length === 0) {
        // An empty extraction is a real outcome, not a failure — but say so.
        console.error(`[pipeline] version ${version.id}: model returned no memories`);
      }

      // F4: open loops, after the commit and outside its transaction.
      //
      // Deliberately best-effort. A loop is an enrichment of a memory that is
      // already safely stored, so a provider failure here must not fail the
      // version or re-queue it — that would re-extract memories which are
      // already correct, and pay for them again. Errors are logged and the
      // version still counts as done.
      try {
        await attributed({ purpose: "loops", captureIds: [version.id] }, async () => {
          if (provider.extractLoops && watchesForLoops(ctx.app, ctx.url)) {
            // The whole capture, not just what it adds: a loop is closed by a
            // reply that only makes sense next to the request above it.
            // New loops come only from what this version adds; the rest is
            // context. A capture that adds nothing can still close a tracked loop.
            const { tracked, storeIds } = trackedLoops(db, key);
            const loopCtx = earlier === null ? ctx : { ...ctx, added: fresh };
            const { loops: candidates, closed } = fresh === "" && tracked.length === 0
              ? { loops: [], closed: [] }
              : await provider.extractLoops(content, loopCtx, tracked);
            // Close before recording, so a loop finished in this capture is not
            // also restated by it.
            const n = closeLoops(db, key, storeIds, closed, committedDerivatives[0]?.id ?? null, (c) =>
              console.error(`[loops] resolved ${c.description}\n`
                + `           by "${c.evidence.replace(/\s+/g, " ").slice(0, 160)}"`));
            if (n.length > 0) console.error(`[pipeline] auto-resolved ${n.length} loop(s)`);
            if (candidates.length > 0) {
              // Each loop by name, not just a count: "2 open loop(s)" could not
              // be matched to what the panel showed, or to what the model got
              // wrong. The log is the user's own (0600, ~/Library/Logs) and the
              // same text is on their screen in the panel.
              const added = await recordLoops(
                db, key, candidates, committedDerivatives[0]?.id ?? null, provider,
                (event, c) => console.error(
                  `[loops] ${event === "opened" ? "opened  " : "restated"} ${c.direction} `
                  + `${c.counterparty ?? "-"}: ${c.description}`),
                version.committed_at,
                version.id,
              );
              if (added > 0) console.error(`[pipeline] version ${version.id}: ${added} open loop(s)`);
            }
          }
        });
      } catch (e) {
        if (e instanceof QuotaExhausted) exhausted = e;
        console.error(`[pipeline] version ${version.id}: loop pass failed (memories are stored): ${summarizeError(e)}`);
      }

      done++;
      if (!exhausted && gate.kind) gate.clear();
    } catch (e) {
      if (e instanceof QuotaExhausted) {
        // Not this version's fault, so no attempt is spent: counting quota
        // refusals toward MAX_ATTEMPTS marked captures failed, for good, during
        // an outage that nothing about them caused.
        release.run(job.id);
        exhausted = e;
      } else if (e instanceof ProviderUnreachable) {
        // Same reasoning as quota: the network is down, the capture is fine.
        // Every remaining job would fail the same way, so stop this drain.
        release.run(job.id);
        unreachable = e;
      } else {
        const attempts = job.attempts + 1;
        const lastError = encryptField(summarizeError(e), key);
        if (attempts >= MAX_ATTEMPTS) {
          // Parked, not deleted: a row leaves the queue only when its capture
          // succeeds. Your Space and `nova retry` put it back.
          console.error(`[pipeline] version ${job.version_id}: parked after ${attempts} attempts: ${summarizeError(e)}`);
          db.prepare("UPDATE memory_versions SET embedding_status='failed' WHERE id=?").run(job.version_id);
          db.prepare(
            `UPDATE memory_retry_queue
                SET attempts=?, parked_at=?, last_error=?, status='pending', claimed_at=NULL
              WHERE id=?`,
          ).run(attempts, Date.now(), lastError, job.id);
        } else {
          const backoff = Math.min(60_000 * 2 ** attempts, 3_600_000);
          // A rate limit is an expected condition on a free tier, not a fault, and
          // providers answer it with a multi-line JSON body. Printed in full on
          // every attempt of every version it buries the run — the M0 lesson is
          // that an unreadable log is a log nobody reads. Say what happened and
          // when the retry lands; the give-up line below still carries the body.
          console.error(
            `[pipeline] version ${job.version_id}: attempt ${attempts} failed, `
            + `retrying in ${Math.round(backoff / 1000)}s: ${summarizeError(e)}`);
          // Release the claim with the backoff: the row is waiting again, not in
          // flight. Leaving it 'processing' would make the next drain skip it
          // until CLAIM_TIMEOUT_MS elapsed, silently stretching every backoff to
          // at least ten minutes.
          db.prepare(
            `UPDATE memory_retry_queue
                SET attempts=?, next_attempt_at=?, last_error=?, status='pending', claimed_at=NULL
              WHERE id=?`,
          ).run(attempts, Date.now() + backoff, lastError, job.id);
        }
      }
    }
    if (exhausted) {
      gate.trip(exhausted);
      for (const rest of jobs.slice(index + 1)) release.run(rest.id);
      break;
    }
    if (unreachable) {
      reach.fail();
      console.error(
        `[pipeline] provider unreachable, ${jobs.length - index} job(s) wait ${UNREACHABLE_RETRY_MS / 1000}s `
        + `or until the network returns, no attempt spent: ${summarizeError(unreachable)}`);
      for (const rest of jobs.slice(index + 1)) release.run(rest.id);
      break;
    }
    // Any other outcome, a failure included, means the provider answered.
    reach.ok();
  }
  return done;
}

export interface ParkedCapture {
  versionId: string; app: string; attempts: number;
  parkedAt: number; capturedAt: number; error: string | null;
}

/** Captures the pipeline gave up on, newest first. Shown in Your Space. */
export function parkedCaptures(db: Database, key: Buffer): ParkedCapture[] {
  const rows = db.prepare(
    `SELECT q.version_id, q.attempts, q.parked_at, q.last_error, v.committed_at, t.source_app
       FROM memory_retry_queue q
       JOIN memory_versions v ON v.id = q.version_id
       JOIN memory_threads t ON t.id = v.thread_id
      WHERE q.parked_at IS NOT NULL
      ORDER BY q.parked_at DESC`,
  ).all() as {
    version_id: string; attempts: number; parked_at: number; last_error: string | null;
    committed_at: number; source_app: string;
  }[];
  return rows.map((r) => {
    let error: string | null = null;
    if (r.last_error) {
      try { error = decryptField(r.last_error, key); } catch { error = "(unreadable)"; }
    }
    return {
      versionId: r.version_id, app: r.source_app, attempts: r.attempts,
      parkedAt: r.parked_at, capturedAt: r.committed_at, error,
    };
  });
}

/**
 * Puts parked captures back in the queue with a fresh attempt budget, all of
 * them or the given versions. Returns how many were re-queued. The next drain
 * (within 15 s) picks them up.
 */
export function retryParked(db: Database, versionIds?: string[]): number {
  return db.transaction(() => {
    const ids = versionIds ?? (db.prepare(
      "SELECT version_id FROM memory_retry_queue WHERE parked_at IS NOT NULL",
    ).all() as { version_id: string }[]).map((r) => r.version_id);
    const requeue = db.prepare(
      `UPDATE memory_retry_queue
          SET parked_at=NULL, attempts=0, next_attempt_at=0, status='pending', claimed_at=NULL
        WHERE version_id=? AND parked_at IS NOT NULL`,
    );
    const pending = db.prepare("UPDATE memory_versions SET embedding_status='pending' WHERE id=?");
    let n = 0;
    for (const id of ids) {
      if (requeue.run(id).changes > 0) { pending.run(id); n++; }
    }
    return n;
  })();
}
