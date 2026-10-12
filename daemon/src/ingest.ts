// Capture -> store (spec 4.1, 4.2). Every rejection carries a reason: the
// silent-failure rule exists because M0 lost a session to a capture path that
// reported success while producing nothing.
import type { Database } from "bun:sqlite";
import { resolveThread, commitVersion, type CaptureRecord } from "./threads";
import { fingerprint, isNovel } from "./fingerprint";
import { enqueueExtraction } from "./pipeline";
import { deniedSourceRule, redactSecrets } from "./sensitive";
import { countSkip, userExcludedRule } from "./exclusions";

export interface IngestResult { stored: boolean; reason?: string }

// Far above any realistic capture line. Guards against an unbounded buffer
// if the stream never emits a newline (a stalled producer, or a
// pathologically long line) — without this, buf grows forever instead of
// failing loudly.
const MAX_BUFFER_BYTES = 4 * 1024 * 1024;

export function handleLine(db: Database, key: Buffer, line: string): IngestResult {
  let rec: CaptureRecord;
  try {
    rec = JSON.parse(line);
  } catch {
    return { stored: false, reason: "malformed-json" };
  }

  if (typeof rec?.content !== "string" || rec.content.trim().length === 0)
    return { stored: false, reason: "empty-content" };
  if (typeof rec.app !== "string" || rec.app.length === 0)
    return { stored: false, reason: "missing-app" };
  if (typeof rec.ts !== "number" || !Number.isFinite(rec.ts))
    return { stored: false, reason: "missing-timestamp" };

  // D1: before the store and before any provider. A password manager is
  // refused whole; anywhere else only the credential-shaped spans go.
  const denial = deniedSourceRule(rec.app, rec.url, rec.windowTitle ?? "");
  if (denial) {
    // Counted per rule so the Blocked apps pane can say how many windows each
    // one has refused. Persistent, because the tally this function's caller
    // keeps is flushed to stderr and lost on restart.
    countSkip(db, denial.rule);
    return { stored: false, reason: "sensitive-source" };
  }
  // The user's own list (D21). Additive: it refuses more than the hard
  // exclusions above, never less.
  const excluded = userExcludedRule(
    db, key, rec.app, rec.url, rec.windowTitle ?? "", rec.bundleId);
  if (excluded) {
    countSkip(db, excluded.id);
    return { stored: false, reason: "user-excluded" };
  }
  rec = { ...rec, content: redactSecrets(rec.content).text };

  // Backstop for anything the checks above don't catch — a malformed url
  // (normalizeUrl throws on an unparseable string), a missing windowTitle
  // (encryptField throws on non-string input), or any other write-path
  // surprise from AX-tree drift. Without this, the exception escapes
  // handleLine and, inside ingestStream's `for await`, kills the whole
  // stream silently: worse than the M0 failure this rule exists to prevent.
  try {
    // One transaction across novelty, version, and enqueue. isNovel records the
    // fingerprint as a side effect of the check, so if commitVersion throws —
    // or the process dies between the two — a separately committed fingerprint
    // would blacklist this exact capture forever: nothing ever deletes from
    // message_fingerprints, and the retry comes back "duplicate-fingerprint"
    // with no version to show for it. Rolling all three back together is what
    // makes a failed write transient instead of permanent.
    return db.transaction((): IngestResult => {
      const threadId = resolveThread(db, key, rec);
      if (!isNovel(db, threadId, fingerprint(rec.content)))
        return { stored: false, reason: "duplicate-fingerprint" };

      const { versionId } = commitVersion(db, key, threadId, rec);
      enqueueExtraction(db, versionId);
      return { stored: true };
    })();
  } catch (e) {
    console.error(`[ingest] write failed for app=${rec.app} ts=${rec.ts}: ${e}`);
    return { stored: false, reason: "write-failed" };
  }
}

/**
 * A flag the ingest loop checks per line. The daemon's control socket flips
 * it (spec §6 pause/resume). A plain object rather than a callback so the
 * caller keeps ownership and there is nothing to unsubscribe.
 */
export interface IngestGate { paused: boolean }

/** Consume JSONL from a stream, logging outcome counts so an empty database
 * can always be explained from the logs alone (the silent-failure rule). */
export async function ingestStream(
  db: Database, key: Buffer, stream: ReadableStream<Uint8Array>,
  gate: IngestGate = { paused: false },
): Promise<void> {
  const counts = new Map<string, number>();
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    if (buf.length > MAX_BUFFER_BYTES) {
      console.error(`[ingest] buffer exceeded ${MAX_BUFFER_BYTES} bytes with no newline; discarding and continuing`);
      counts.set("buffer-overflow", (counts.get("buffer-overflow") ?? 0) + 1);
      buf = "";
      continue;
    }
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      // Paused: nova-capture keeps running (so resume is instant and needs
      // no restart), but nothing it emits reaches the store. Counted, so an
      // all-paused run is distinguishable from a broken one in the periodic
      // summary below — the silent-failure rule applies to pause too.
      if (gate.paused) {
        counts.set("paused", (counts.get("paused") ?? 0) + 1);
        continue;
      }
      const r = handleLine(db, key, line);
      const k = r.stored ? "stored" : (r.reason ?? "unknown-rejection");
      counts.set(k, (counts.get(k) ?? 0) + 1);
      if (!r.stored) {
        console.error(`[ingest] dropped line: ${k}`);
      }
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      if (total % 10 === 0) {
        console.error(`[ingest] ${[...counts].map(([kk, v]) => `${kk}=${v}`).join(" ")}`);
      }
    }
  }
  const remainder = buf.trim();
  if (remainder) {
    // Paused: the remainder fires only after the stream closes. Capture exit
    // is about to become a live shutdown path, which makes this code path
    // reachable in normal operation; gating it here removes the one exception
    // to "nothing reaches the store while paused".
    if (gate.paused) {
      counts.set("paused", (counts.get("paused") ?? 0) + 1);
    } else {
      const r = handleLine(db, key, remainder);
      const k = r.stored ? "stored" : (r.reason ?? "unknown-rejection");
      counts.set(k, (counts.get(k) ?? 0) + 1);
      if (!r.stored) console.error(`[ingest] dropped line: ${k}`);
    }
  }
  console.error(`[ingest] stream ended: ${[...counts].map(([k, v]) => `${k}=${v}`).join(" ") || "no lines"}`);
}
