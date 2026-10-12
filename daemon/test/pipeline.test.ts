import { test, expect } from "bun:test";
import { openDb, decryptField } from "../src/db";
import { resolveThread, commitVersion } from "../src/threads";
import {
  enqueueExtraction, drainQueue, releaseStaleClaims, summarizeError, CLAIM_TIMEOUT_MS,
  addedLines, parkedCaptures, retryParked,
  QuotaGate,
} from "../src/pipeline";
import { FakeProvider, MalformedResponse, ProviderUnreachable, QuotaExhausted, type CaptureContext, type LoopExtraction, type TrackedLoop } from "../src/provider";
import { recordLoops, listOpenLoops } from "../src/loops";
import { handleLine } from "../src/ingest";
import { randomBytes } from "node:crypto";

const KEY = randomBytes(32);
const rec = {
  ts: 1787331916548, app: "Google Chrome", bundleId: "com.google.Chrome",
  windowTitle: "Rust ownership", url: "https://doc.rust-lang.org/book/ch04.html",
  content: "Ownership is a set of rules.", contentHash: "sha256:a", treeHash: "sha256:b",
};

test("draining the queue writes derivatives and both vector stores", async () => {
  const db = await openDb(":memory:");
  const tid = resolveThread(db, KEY, rec);
  const { versionId } = commitVersion(db, KEY, tid, rec);
  enqueueExtraction(db, versionId);

  const n = await drainQueue(db, KEY, new FakeProvider(["Rust enforces ownership rules."]));
  expect(n).toBe(1);

  const d = db.prepare("SELECT id, content FROM memory_derivatives").all() as any[];
  expect(d.length).toBe(1);
  expect(decryptField(d[0].content, KEY)).toBe("Rust enforces ownership rules.");

  // Assert the JOIN, not two independent counts. Counting each table alone
  // passes even if the int8 row is written under a different id than the
  // sidecar and the derivative -- which would permanently decouple the KNN
  // index from the rescore source, so every search returns nothing because
  // search.ts's row.get(c.derivative_id) never matches. Index/sidecar lockstep
  // is this branch's known fault line, so it is what gets asserted.
  const joined = db.prepare(
    `SELECT COUNT(*) c FROM memory_derivative_embeddings e
       JOIN memory_derivative_vectors v USING(derivative_id)
       JOIN memory_derivatives d ON d.id = e.derivative_id`
  ).get() as any;
  expect(joined.c).toBe(1);
  expect(joined.c).toBe(d.length);

  // And no stragglers in either table beyond the joined row.
  const int8 = db.prepare("SELECT COUNT(*) c FROM memory_derivative_embeddings").get() as any;
  const f32 = db.prepare("SELECT COUNT(*) c FROM memory_derivative_vectors").get() as any;
  expect(int8.c).toBe(1);
  expect(f32.c).toBe(1);
});

test("a provider failure leaves the job queued for retry", async () => {
  const db = await openDb(":memory:");
  const tid = resolveThread(db, KEY, rec);
  const { versionId } = commitVersion(db, KEY, tid, rec);
  enqueueExtraction(db, versionId);

  const failing = { extract: async () => { throw new Error("network down"); },
                    embed: async () => [] };
  const n = await drainQueue(db, KEY, failing as any);
  expect(n).toBe(0);
  const q = db.prepare("SELECT attempts FROM memory_retry_queue").get() as any;
  expect(q.attempts).toBe(1);      // still queued, attempt counted
});

// BATCH is 64, so a 2-memory fixture makes the embed loop run exactly once and
// the failure is whole-batch, not mid-batch -- the name on the tin was never
// exercised. 150 memories spans three batches and fails on the SECOND, so the
// retry happens with one batch already embedded and the loop genuinely
// mid-flight. That is what distinguishes "the delete is per version, inside the
// commit" from "the delete is per batch": with a per-batch delete, batch 2's
// delete wipes batch 1's rows and the version ends up short.
test("a mid-batch embed failure does not duplicate or lose derivatives on retry", async () => {
  const db = await openDb(":memory:");
  const tid = resolveThread(db, KEY, rec);
  const { versionId } = commitVersion(db, KEY, tid, rec);
  enqueueExtraction(db, versionId);

  const memories = Array.from({ length: 150 }, (_, i) => `Fact number ${i}.`);
  let embedCalls = 0;
  const batchSizes: number[] = [];
  const flaky = {
    extract: async () => memories,
    embed: async (texts: string[]) => {
      embedCalls++;
      batchSizes.push(texts.length);
      // Fail on the second batch of the first attempt: batch 1 has already
      // been embedded, so the failure is genuinely mid-loop.
      if (embedCalls === 2) throw new Error("network blip");
      return texts.map(() => {
        const v = new Float32Array(1536);
        v[0] = 1;
        return v;
      });
    },
  };

  const n1 = await drainQueue(db, KEY, flaky as any);
  expect(n1).toBe(0);
  // The failure really was mid-loop, not on the first and only call.
  expect(embedCalls).toBe(2);
  expect(batchSizes[0]).toBe(64);

  // Nothing partial may have been committed by the failed attempt.
  const partial = db.prepare(
    "SELECT COUNT(*) c FROM memory_derivatives WHERE version_id=?"
  ).get(versionId) as any;
  expect(partial.c).toBe(0);

  // Simulate the backoff window elapsing so the retry is due.
  db.prepare("UPDATE memory_retry_queue SET next_attempt_at=0 WHERE version_id=?").run(versionId);

  const n2 = await drainQueue(db, KEY, flaky as any);
  expect(n2).toBe(1);

  // Every memory is present exactly once -- not duplicated by the retry, and
  // not truncated to the last batch by a delete running per batch.
  const d = db.prepare("SELECT id FROM memory_derivatives WHERE version_id=?").all(versionId) as any[];
  expect(d.length).toBe(memories.length);
  // Three batches on the successful attempt: 64 + 64 + 22.
  expect(batchSizes.slice(2)).toEqual([64, 64, 22]);

  // And both vector tables stay in lockstep with the derivatives across all
  // three batches -- the join, not three independent counts.
  const joined = db.prepare(
    `SELECT COUNT(*) c FROM memory_derivative_embeddings e
       JOIN memory_derivative_vectors v USING(derivative_id)
       JOIN memory_derivatives d ON d.id = e.derivative_id`
  ).get() as any;
  expect(joined.c).toBe(memories.length);
});

test("enqueueExtraction is idempotent per version", async () => {
  const db = await openDb(":memory:");
  const tid = resolveThread(db, KEY, rec);
  const { versionId } = commitVersion(db, KEY, tid, rec);

  enqueueExtraction(db, versionId);
  enqueueExtraction(db, versionId);

  const rows = db.prepare("SELECT COUNT(*) c FROM memory_retry_queue WHERE version_id=?").get(versionId) as any;
  expect(rows.c).toBe(1);
});

test("a successful drain marks the version's embedding_status completed", async () => {
  const db = await openDb(":memory:");
  const tid = resolveThread(db, KEY, rec);
  const { versionId } = commitVersion(db, KEY, tid, rec);
  enqueueExtraction(db, versionId);

  await drainQueue(db, KEY, new FakeProvider(["Rust enforces ownership rules."]));

  const v = db.prepare("SELECT embedding_status FROM memory_versions WHERE id=?").get(versionId) as any;
  expect(v.embedding_status).toBe("completed");
});

// Finding 1 regression coverage. `nova start` runs setInterval(drainQueue) and
// ingestStream on one event loop, so a capture line can land while a drain is
// parked on the network. The drain used to insert derivatives, await the
// network, then write both vector tables with no transaction across that span —
// so a same-hour overwrite running in the gap deleted the derivatives, and the
// drain then wrote vector rows for ids that no longer existed. Those orphans are
// unreclaimable: every DELETE against either vector table keys off a subquery
// into memory_derivatives. The version was also marked completed, so nothing
// ever re-extracted it.
//
// No hooks into the modules: a provider that awaits, and a handleLine call
// issued partway into the drain, is the real interleaving.
test("a same-hour overwrite during a drain's network await orphans nothing and loses nothing", async () => {
  const db = await openDb(":memory:");
  const captured = { ...rec, ts: Date.now(), content: "Ownership is a set of rules." };
  const tid = resolveThread(db, KEY, captured);
  const { versionId } = commitVersion(db, KEY, tid, captured);
  enqueueExtraction(db, versionId);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const slow = {
    extract: async () => { await sleep(50); return ["First fact.", "Second fact."]; },
    embed: async (texts: string[]) => {
      await sleep(50);
      return texts.map(() => { const v = new Float32Array(1536); v[0] = 1; return v; });
    },
  };

  const draining = drainQueue(db, KEY, slow as any);
  // 60 ms in: extract has returned and the drain is parked inside embed.
  await sleep(60);
  const overwrite = handleLine(db, KEY, JSON.stringify({
    ...captured, content: "Ownership is a set of rules, revised.", contentHash: "sha256:revised",
  }));
  expect(overwrite.stored).toBe(true);
  await draining;

  // Whatever the interleaving decided, the store must be self-consistent: no
  // vector row may reference a derivative that does not exist, in either table.
  const orphanInt8 = db.prepare(
    `SELECT COUNT(*) c FROM memory_derivative_embeddings e
      WHERE NOT EXISTS (SELECT 1 FROM memory_derivatives d WHERE d.id = e.derivative_id)`
  ).get() as any;
  const orphanF32 = db.prepare(
    `SELECT COUNT(*) c FROM memory_derivative_vectors v
      WHERE NOT EXISTS (SELECT 1 FROM memory_derivatives d WHERE d.id = v.derivative_id)`
  ).get() as any;
  expect(orphanInt8.c).toBe(0);
  expect(orphanF32.c).toBe(0);

  // And the newer content must not be stranded: either the drain's output is
  // still there, or the version is queued so the newer content gets extracted.
  const derivatives = db.prepare(
    "SELECT COUNT(*) c FROM memory_derivatives WHERE version_id=?"
  ).get(versionId) as any;
  const queued = db.prepare(
    "SELECT COUNT(*) c FROM memory_retry_queue WHERE version_id=?"
  ).get(versionId) as any;
  expect(derivatives.c > 0 || queued.c > 0).toBe(true);

  // And it must converge rather than spin: the next quiet drain extracts the
  // NEW content, clears the queue, and leaves the memory searchable.
  await drainQueue(db, KEY, slow as any);
  const after = db.prepare(
    "SELECT COUNT(*) c FROM memory_derivatives WHERE version_id=?"
  ).get(versionId) as any;
  const stillQueued = db.prepare(
    "SELECT COUNT(*) c FROM memory_retry_queue WHERE version_id=?"
  ).get(versionId) as any;
  expect(after.c).toBe(2);
  expect(stillQueued.c).toBe(0);
  const status = db.prepare(
    "SELECT embedding_status s FROM memory_versions WHERE id=?"
  ).get(versionId) as any;
  expect(status.s).toBe("completed");
  const joined = db.prepare(
    `SELECT COUNT(*) c FROM memory_derivative_embeddings e
       JOIN memory_derivative_vectors v USING(derivative_id)
       JOIN memory_derivatives d ON d.id = e.derivative_id`
  ).get() as any;
  expect(joined.c).toBe(2);
});

// The stale-content check specifically. One transaction alone keeps the store
// self-consistent — no orphans — but is still wrong: an extraction of the OLD
// content would be committed against the NEW content and the version marked
// completed, so the memories permanently describe text the version no longer
// holds and nothing re-extracts it. This is what makes the interleaving safe
// rather than merely narrow, so it is asserted on its own.
test("an extraction of content that changed mid-flight is discarded, not committed against the new content", async () => {
  const db = await openDb(":memory:");
  const captured = { ...rec, ts: Date.now(), content: "OLD CONTENT", contentHash: "sha256:old" };
  const tid = resolveThread(db, KEY, captured);
  const { versionId } = commitVersion(db, KEY, tid, captured);
  enqueueExtraction(db, versionId);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // extract() echoes what it was given, so a derivative's text proves which
  // version content it was derived from.
  const echoing = {
    extract: async (text: string) => { await sleep(50); return ["derived from: " + text]; },
    embed: async (texts: string[]) => {
      await sleep(50);
      return texts.map(() => { const v = new Float32Array(1536); v[0] = 1; return v; });
    },
  };

  const draining = drainQueue(db, KEY, echoing as any);
  await sleep(60);
  handleLine(db, KEY, JSON.stringify({
    ...captured, content: "NEW CONTENT", contentHash: "sha256:new",
  }));
  await draining;

  const stored = db.prepare(
    "SELECT content FROM memory_derivatives WHERE version_id=?"
  ).all(versionId) as any[];
  for (const d of stored) {
    expect(decryptField(d.content, KEY)).not.toContain("OLD CONTENT");
  }
  // Discarded, so the version stays queued for the newer content rather than
  // being sealed as completed with memories of text it no longer holds.
  const status = db.prepare(
    "SELECT embedding_status s FROM memory_versions WHERE id=?"
  ).get(versionId) as any;
  expect(status.s).toBe("pending");
  const queued = db.prepare(
    "SELECT COUNT(*) c FROM memory_retry_queue WHERE version_id=?"
  ).get(versionId) as any;
  expect(queued.c).toBe(1);

  // The retry then describes the content that is actually stored.
  await drainQueue(db, KEY, echoing as any);
  const after = db.prepare(
    "SELECT content FROM memory_derivatives WHERE version_id=?"
  ).all(versionId) as any[];
  expect(after.length).toBe(1);
  expect(decryptField(after[0].content, KEY)).toContain("NEW CONTENT");
});

test("a provider error logs as one readable line that still carries the reason", () => {
  // Providers pretty-print error bodies, so the reason sits on line 3+ of the
  // message. The first version of this collapsed to the first newline, which
  // logged a bare "embed gemini-embedding-001 400: {" on every attempt and hid
  // the cause completely. One line is the requirement; losing the reason is not.
  const real = new Error(`gemini extract 429: {
  "error": {
    "code": 429,
    "message": "You exceeded your current quota, please check your plan and billing details.",
    "status": "RESOURCE_EXHAUSTED"
  }
}`);
  const out = summarizeError(real);
  expect(out.split("\n").length).toBe(1);        // one line
  expect(out).toContain("429");
  expect(out).toContain("exceeded your current quota");   // the REASON survives
  expect(out).toContain("rate limited");

  // A 400 whose reason is buried the same way must also survive.
  const four00 = summarizeError(new Error(`embed gemini-embedding-001 400: {
  "error": {
    "code": 400,
    "message": "Unable to submit request because the input token count exceeds the limit.",
    "status": "INVALID_ARGUMENT"
  }
}`));
  expect(four00.split("\n").length).toBe(1);
  expect(four00).toContain("input token count exceeds");
  expect(four00).not.toContain("rate limited");

  // A single-line error is unchanged.
  const other = summarizeError(new Error("gemini extract 401: bad key"));
  expect(other).toContain("401");
  expect(other).not.toContain("rate limited");
});

test("drainQueue hands extract the capture's own app, title, url and date", async () => {
  // The model cannot know where a capture came from or when. Handing it the
  // thread's real provenance is what stopped invented dates and memories filed
  // against whichever window happened to display the text.
  const db = await openDb(":memory:");
  const tid = resolveThread(db, KEY, rec);
  const { versionId } = commitVersion(db, KEY, tid, rec);
  enqueueExtraction(db, versionId);

  const provider = new FakeProvider(["A fact."]);
  await drainQueue(db, KEY, provider);

  const ctx = provider.lastContext;
  expect(ctx).toBeDefined();
  expect(ctx!.app).toBe("Google Chrome");
  expect(ctx!.title).toBe("Rust ownership");
  expect(ctx!.url).toBe("https://doc.rust-lang.org/book/ch04.html");
  // The date must be the capture's, not now() — a memory dated by processing
  // time is wrong for anything drained after a retry backoff.
  expect(ctx!.capturedAt).toBe(rec.ts);
});

// --- A1: the queue must survive a crash and concurrent drains -------------

/** A provider that blocks until released, so two drains can overlap. */
class BlockingProvider extends FakeProvider {
  calls = 0;
  private release!: () => void;
  readonly blocked = new Promise<void>((r) => { this.release = r; });
  unblock() { this.release(); }
  async extract(text: string, ctx?: unknown): Promise<string[]> {
    this.calls++;
    await this.blocked;
    return super.extract(text, ctx as any);
  }
}

test("two overlapping drains do not both extract the same job", async () => {
  const db = await openDb(":memory:");
  const tid = resolveThread(db, KEY, rec);
  const { versionId } = commitVersion(db, KEY, tid, rec);
  enqueueExtraction(db, versionId);

  const provider = new BlockingProvider(["Ownership is enforced at compile time."]);
  // Start both before either finishes: this is the 15s-tick-plus-slow-provider
  // case, where the second drain finds the job still sitting unclaimed.
  const first = drainQueue(db, KEY, provider);
  const second = drainQueue(db, KEY, provider);
  provider.unblock();
  await Promise.all([first, second]);

  // The commit is idempotent so the store stays correct either way — the cost
  // of a double claim is paying the provider twice, which is what this asserts.
  expect(provider.calls).toBe(1);
});

test("a job whose process dies mid-flight is reclaimable, not stuck", async () => {
  const db = await openDb(":memory:");
  const tid = resolveThread(db, KEY, rec);
  const { versionId } = commitVersion(db, KEY, tid, rec);
  enqueueExtraction(db, versionId);

  // A thrown error is already handled: the catch raises `attempts` and sets a
  // backoff. What is not handled is the process dying between claim and
  // handler — no catch runs, so the row must not be left claimed forever.
  // That cannot be simulated in-process, so this asserts the recovery
  // property instead: a row left in 'processing' past the claim timeout is
  // picked up again rather than stranded.
  db.prepare(
    `UPDATE memory_retry_queue
        SET status='processing', claimed_at=?, attempts=1
      WHERE version_id=?`,
  ).run(Date.now() - CLAIM_TIMEOUT_MS - 1, versionId);

  const n = await drainQueue(db, KEY, new FakeProvider(["Ownership is enforced."]));
  expect(n).toBe(1);
});

test("a freshly claimed job is not stolen by an overlapping drain", async () => {
  const db = await openDb(":memory:");
  const tid = resolveThread(db, KEY, rec);
  const { versionId } = commitVersion(db, KEY, tid, rec);
  enqueueExtraction(db, versionId);

  // Same shape as the timeout test, but *inside* the window: a row claimed a
  // moment ago belongs to the drain that holds it.
  db.prepare(
    "UPDATE memory_retry_queue SET status='processing', claimed_at=? WHERE version_id=?",
  ).run(Date.now(), versionId);

  const n = await drainQueue(db, KEY, new FakeProvider(["Should not run."]));
  expect(n).toBe(0);
});

test("a claim abandoned by a killed daemon is released at startup, not after ten minutes", async () => {
  const db = await openDb(":memory:");
  const tid = resolveThread(db, KEY, rec);
  const { versionId } = commitVersion(db, KEY, tid, rec);
  enqueueExtraction(db, versionId);

  // shutdown() calls process.exit(0), so a drain in flight is abandoned while
  // it still holds its claim — with a *recent* claimed_at, which the reclaim
  // arm will not touch for CLAIM_TIMEOUT_MS. Restarting in two seconds must
  // not mean waiting out ten minutes: at startup no drain can legitimately be
  // in flight in this process, so any 'processing' row is abandoned by
  // definition. The claim timeout still covers the case this cannot see — a
  // holder dying while another process is live — so it is deliberately left
  // alone.
  db.prepare(
    "UPDATE memory_retry_queue SET status='processing', claimed_at=? WHERE version_id=?",
  ).run(Date.now(), versionId);

  expect(releaseStaleClaims(db)).toBe(1);
  const q = db.prepare(
    "SELECT status, claimed_at FROM memory_retry_queue WHERE version_id=?",
  ).get(versionId) as any;
  expect(q.status).toBe("pending");
  expect(q.claimed_at).toBe(null);

  // The point of the release: the very next drain sees the job as eligible.
  const n = await drainQueue(db, KEY, new FakeProvider(["Ownership is enforced."]));
  expect(n).toBe(1);
});

test("releasing stale claims leaves a pending queue untouched and reports zero", async () => {
  const db = await openDb(":memory:");
  const tid = resolveThread(db, KEY, rec);
  const { versionId } = commitVersion(db, KEY, tid, rec);
  enqueueExtraction(db, versionId);

  // Nothing was claimed, so nothing is released — and the count is what the
  // start branch keys its log line off, so a clean start must stay silent.
  expect(releaseStaleClaims(db)).toBe(0);
  const q = db.prepare("SELECT status FROM memory_retry_queue").get() as any;
  expect(q.status).toBe("pending");
});

// --- extraction reads only what a version adds ----------------------------

/** Records every extract and extractLoops call it receives. */
class RecordingProvider extends FakeProvider {
  extracts: { text: string; ctx?: CaptureContext }[] = [];
  loopCalls: string[] = [];
  loopAdded: (string | undefined)[] = [];
  async extract(text: string, ctx?: CaptureContext): Promise<string[]> {
    this.extracts.push({ text, ctx });
    return super.extract(text, ctx);
  }
  async extractLoops(text: string, ctx?: CaptureContext, tracked: TrackedLoop[] = []): Promise<LoopExtraction> {
    this.loopCalls.push(text);
    this.loopAdded.push(ctx?.added);
    return super.extractLoops(text, ctx, tracked);
  }
}

/** Stores and drains one capture of a thread. */
async function capture(db: any, provider: FakeProvider, r: Parameters<typeof resolveThread>[2]) {
  const tid = resolveThread(db, KEY, r);
  const { versionId } = commitVersion(db, KEY, tid, r);
  enqueueExtraction(db, versionId);
  await drainQueue(db, KEY, provider);
  return versionId;
}

test("addedLines returns only the lines the earlier text lacked, in order", () => {
  expect(addedLines("Lee: hi\nLee: venues?", "Lee: hi\nLee: venues?\nYou: booked\n\nLee: great"))
    .toBe("You: booked\nLee: great");
  // Re-indentation and blank lines are not news.
  expect(addedLines("Lee: hi\nLee: venues?", "  Lee: hi\n\nLee: venues?  ")).toBe("");
});

test("a later version of a thread sends only its new lines to extract", async () => {
  const db = await openDb(":memory:");
  const provider = new RecordingProvider(["A fact."]);
  const slack = { ...rec, app: "Slack", bundleId: "com.tinyspeck.slackmacgap",
    windowTitle: "Lee (DM)", url: null };
  const first = "Lee: looking at venues\nYou: the hall on 5th?";
  const second = `${first}\nLee: booked it`;

  await capture(db, provider, { ...slack, content: first, contentHash: "sha256:v1" });
  // An hour later, so the thread gets a new version instead of an overwrite.
  const v2 = await capture(db, provider,
    { ...slack, ts: slack.ts + 3_600_000, content: second, contentHash: "sha256:v2" });

  expect(provider.extracts.map((e) => e.text)).toEqual([first, "Lee: booked it"]);
  expect(provider.extracts[0]!.ctx!.earlier).toBeUndefined();
  expect(provider.extracts[1]!.ctx!.earlier).toBe(first);
  const v = db.prepare("SELECT embedding_status s FROM memory_versions WHERE id=?").get(v2) as any;
  expect(v.s).toBe("completed");

  // A version that adds nothing costs no extract call, and still completes.
  const v3 = await capture(db, provider,
    { ...slack, ts: slack.ts + 7_200_000, content: `  ${second}`, contentHash: "sha256:v3" });
  expect(provider.extracts.length).toBe(2);
  const done = db.prepare("SELECT embedding_status s FROM memory_versions WHERE id=?").get(v3) as any;
  expect(done.s).toBe("completed");
});

test("the loop pass reads the whole capture but is told which lines are new", async () => {
  const db = await openDb(":memory:");
  const provider = new RecordingProvider(["A fact."]);
  const self = { ...rec, app: "Slack", bundleId: "com.tinyspeck.slackmacgap",
    windowTitle: "Alex (DM)", url: null };
  const backlog = "Alex: • update frontend docs. 1:28 PM.";
  const today = "Alex: • fix logout redirect. • fix date field. 3:43 PM.";

  await capture(db, provider, { ...self, content: backlog, contentHash: "sha256:s1" });
  await capture(db, provider,
    { ...self, ts: self.ts + 3_600_000, content: `${backlog}\n${today}`, contentHash: "sha256:s2" });

  expect(provider.loopCalls).toEqual([backlog, `${backlog}\n${today}`]);
  expect(provider.loopAdded).toEqual([undefined, today]);

  // Nothing new and nothing tracked: nothing to find or close, so no call.
  await capture(db, provider,
    { ...self, ts: self.ts + 7_200_000, content: ` ${backlog}\n${today}`, contentHash: "sha256:s3" });
  expect(provider.loopCalls.length).toBe(2);
});

test("a terminal capture gets no loop pass; a chat capture does", async () => {
  const db = await openDb(":memory:");
  const provider = new RecordingProvider(["A fact."]);
  await capture(db, provider, { ...rec, app: "Ghostty", bundleId: "com.mitchellh.ghostty",
    windowTitle: "claude", url: null, content: "Agent: paste the log", contentHash: "sha256:g" });
  expect(provider.loopCalls).toEqual([]);

  await capture(db, provider, { ...rec, app: "Slack", bundleId: "com.tinyspeck.slackmacgap",
    windowTitle: "Lee (DM)", url: null, content: "Lee: can you send the invoice?", contentHash: "sha256:s" });
  expect(provider.loopCalls).toEqual(["Lee: can you send the invoice?"]);
});

test("a capture the model says finishes a tracked loop closes it", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [{
    description: "send Lee the invoice", direction: "i_owe", counterparty: "Lee",
    dueSignal: null, closureSignature: "the invoice was sent to Lee",
  }], null);
  const id = listOpenLoops(db, KEY)[0]!.id;

  const provider = new FakeProvider(["Alex sent Lee the invoice."], [], ["L1"]);
  const versionId = await capture(db, provider, { ...rec, app: "Slack",
    bundleId: "com.tinyspeck.slackmacgap", windowTitle: "Lee (DM)", url: null,
    content: "You: sent the invoice\nLee: thanks", contentHash: "sha256:c" });

  expect(provider.lastTracked).toEqual([
    { id: "L1", description: "send Lee the invoice", direction: "i_owe", counterparty: "Lee" },
  ]);
  const row = db.prepare("SELECT state, resolve_evidence FROM open_loops WHERE id=?").get(id) as any;
  const derivative = db.prepare("SELECT id FROM memory_derivatives WHERE version_id=?").get(versionId) as any;
  expect(row.state).toBe("auto_resolved");
  expect(row.resolve_evidence).toBe(derivative.id);
});

// --- one quota out pauses every provider call ------------------------------

/** Counts calls, and refuses one side with a quota error while `out` says so. */
class QuotaProvider extends FakeProvider {
  out: "chat" | "embed" | null = null;
  calls = { extract: 0, embed: 0 };
  async extract(text: string, ctx?: CaptureContext): Promise<string[]> {
    this.calls.extract++;
    if (this.out === "chat") throw new QuotaExhausted("chat", "chat deepseek-chat 402: Insufficient Balance");
    return super.extract(text, ctx);
  }
  async embed(texts: string[]): Promise<Float32Array[]> {
    this.calls.embed++;
    if (this.out === "embed") throw new QuotaExhausted("embed", "embed gemini-embedding-001 429: quota");
    return super.embed(texts);
  }
}

function queueVersions(db: any, n: number) {
  for (let i = 0; i < n; i++) {
    const r = { ...rec, windowTitle: `page ${i}`, url: `https://e.example/${i}`,
      content: `text ${i}`, contentHash: `sha256:q${i}` };
    const { versionId } = commitVersion(db, KEY, resolveThread(db, KEY, r), r);
    enqueueExtraction(db, versionId);
  }
}

test("an embedding quota refusal pauses chat too, and spends no attempt", async () => {
  const db = await openDb(":memory:");
  queueVersions(db, 3);
  const provider = new QuotaProvider(["A fact."]);
  const gate = new QuotaGate();
  provider.out = "embed";

  expect(await drainQueue(db, KEY, provider, gate)).toBe(0);
  // The first job paid for its extract before embedding refused; the other
  // two were never started.
  expect(provider.calls).toEqual({ extract: 1, embed: 1 });
  expect(gate.kind).toBe("embed");
  const rows = db.prepare("SELECT status, attempts, claimed_at FROM memory_retry_queue").all() as any[];
  expect(rows).toEqual([
    { status: "pending", attempts: 0, claimed_at: null },
    { status: "pending", attempts: 0, claimed_at: null },
    { status: "pending", attempts: 0, claimed_at: null },
  ]);

  // Paused: no call of either kind.
  expect(await drainQueue(db, KEY, provider, gate)).toBe(0);
  expect(provider.calls).toEqual({ extract: 1, embed: 1 });

  // Pause over, embeddings still out: only the probe is made, not a chat call.
  gate.until = 0;
  expect(await drainQueue(db, KEY, provider, gate)).toBe(0);
  expect(provider.calls).toEqual({ extract: 1, embed: 2 });

  // Embeddings back: the probe passes and all three versions drain.
  gate.until = 0;
  provider.out = null;
  expect(await drainQueue(db, KEY, provider, gate)).toBe(3);
  expect(gate.kind).toBeNull();
});

test("a chat quota refusal stops the drain and leaves every job queued", async () => {
  const db = await openDb(":memory:");
  queueVersions(db, 2);
  const provider = new QuotaProvider(["A fact."]);
  const gate = new QuotaGate();
  provider.out = "chat";

  expect(await drainQueue(db, KEY, provider, gate)).toBe(0);
  expect(provider.calls).toEqual({ extract: 1, embed: 0 });
  expect(gate.kind).toBe("chat");
  expect(gate.until).toBeGreaterThan(Date.now());
  const pending = db.prepare(
    "SELECT COUNT(*) c FROM memory_retry_queue WHERE status='pending' AND attempts=0").get() as any;
  expect(pending.c).toBe(2);
});

test("the pause doubles while the quota stays out, and honours Retry-After", () => {
  const gate = new QuotaGate();
  const out = new QuotaExhausted("chat", "429");
  gate.trip(out, 0);
  expect(gate.until).toBe(60_000);
  gate.trip(out, 0);
  expect(gate.until).toBe(120_000);
  gate.trip(new QuotaExhausted("embed", "429", 5_000), 0);
  expect(gate.until).toBe(5_000);
  gate.clear();
  expect(gate.kind).toBeNull();
});

// --- a capture leaves the queue only when it succeeds ----------------------

test("a malformed 200 response keeps the capture queued and spends an attempt", async () => {
  const db = await openDb(":memory:");
  const tid = resolveThread(db, KEY, rec);
  const { versionId } = commitVersion(db, KEY, tid, rec);
  enqueueExtraction(db, versionId);

  const truncated = {
    extract: async () => { throw new MalformedResponse("response truncated at the token limit"); },
    embed: async () => [],
  };
  expect(await drainQueue(db, KEY, truncated as any)).toBe(0);
  const q = db.prepare("SELECT attempts, last_error FROM memory_retry_queue").get() as any;
  expect(q.attempts).toBe(1);
  expect(decryptField(q.last_error, KEY)).toContain("truncated");
  const v = db.prepare("SELECT embedding_status FROM memory_versions WHERE id=?").get(versionId) as any;
  expect(v.embedding_status).not.toBe("completed");
});

test("an unreachable provider spends no attempt and stops the drain", async () => {
  const db = await openDb(":memory:");
  const tid = resolveThread(db, KEY, rec);
  const a = commitVersion(db, KEY, tid, rec).versionId;
  const b = commitVersion(db, KEY, tid, { ...rec, ts: rec.ts + 7_200_000, content: "Borrowing.", contentHash: "sha256:c" }).versionId;
  enqueueExtraction(db, a);
  enqueueExtraction(db, b);

  let calls = 0;
  const offline = {
    extract: async () => { calls++; throw new ProviderUnreachable("chat", "chat unreachable: Unable to connect"); },
    embed: async () => [],
  };
  const before = Date.now();
  expect(await drainQueue(db, KEY, offline as any)).toBe(0);
  expect(calls).toBe(1);   // the second job was not tried against a dead network
  const rows = db.prepare("SELECT attempts, next_attempt_at, parked_at FROM memory_retry_queue").all() as any[];
  expect(rows.length).toBe(2);
  for (const r of rows) {
    expect(r.attempts).toBe(0);
    expect(r.parked_at).toBeNull();
    expect(r.next_attempt_at).toBeGreaterThan(before);
  }
});

test("the last failed attempt parks the row instead of deleting it, and retry re-queues it", async () => {
  const db = await openDb(":memory:");
  const tid = resolveThread(db, KEY, rec);
  const { versionId } = commitVersion(db, KEY, tid, rec);
  enqueueExtraction(db, versionId);
  db.prepare("UPDATE memory_retry_queue SET attempts=7").run();

  const failing = { extract: async () => { throw new Error("chat 500: upstream"); }, embed: async () => [] };
  await drainQueue(db, KEY, failing as any);

  const parked = parkedCaptures(db, KEY);
  expect(parked.length).toBe(1);
  expect(parked[0]!.versionId).toBe(versionId);
  expect(parked[0]!.attempts).toBe(8);
  expect(parked[0]!.error).toContain("upstream");

  // Parked rows are not drained on their own.
  let tried = false;
  await drainQueue(db, KEY, { extract: async () => { tried = true; return []; }, embed: async () => [] } as any);
  expect(tried).toBe(false);

  expect(retryParked(db)).toBe(1);
  expect(parkedCaptures(db, KEY)).toEqual([]);
  expect(await drainQueue(db, KEY, new FakeProvider(["Rust enforces ownership rules."]))).toBe(1);
  expect((db.prepare("SELECT COUNT(*) c FROM memory_retry_queue").get() as any).c).toBe(0);
});
