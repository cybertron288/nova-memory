// Thread identity and the version chain (spec 4.2; docs/05 v2.1 1.1).
import type { Database } from "bun:sqlite";
import { encryptField, lookupDigest } from "./db";
import { randomUUID } from "node:crypto";

export interface CaptureRecord {
  ts: number; app: string; bundleId: string; windowTitle: string;
  url?: string | null; content: string; contentHash: string; treeHash: string;
}

/**
 * The stable identity of a page. Query strings and fragments are dropped:
 * `?utm_source=…` and `#section` address the same document, and keeping them
 * would split one page into a new thread per visit.
 */
export function normalizeUrl(url: string): string {
  const u = new URL(url);
  let path = u.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path === "") path = "/";
  return `${u.protocol}//${u.host}${path}`;
}

const hourBucket = (ts: number) => Math.floor(ts / 3_600_000);

/**
 * Find or create the thread for a capture.
 *
 * Thread identity is unchanged: a browser capture is identified by its
 * normalized URL, anything else by its window title. What changed is that the
 * identity string is never stored — source_key holds a keyed digest of it
 * (lookupDigest), which is what a randomised AEAD ciphertext cannot be: stable
 * enough for the equality lookup and the UNIQUE(source_app, source_key)
 * constraint. The URL used to sit in that column in the clear while
 * source_title on the very same INSERT was encrypted, so spec 8's field-level
 * layer covered two of the three fields it names and skipped the one that is a
 * full browsing history.
 *
 * The URL is kept for display in source_url, encrypted like source_title.
 * A non-browser capture digests its window title into source_key — that value
 * is confidential too, and the digest is one-way — but leaves source_url NULL
 * rather than storing a title in a column that means "the URL this came from":
 * the read path surfaces source_url as provenance, and a window title is not a
 * URL.
 */
export function resolveThread(db: Database, key: Buffer, rec: CaptureRecord): string {
  const url = rec.url ? normalizeUrl(rec.url) : null;
  const sourceKey = lookupDigest(url ?? rec.windowTitle, key);
  const found = db.prepare(
    "SELECT id FROM memory_threads WHERE source_app=? AND source_key=?"
  ).get(rec.app, sourceKey) as { id: string } | null;
  if (found) {
    db.prepare("UPDATE memory_threads SET updated_at=?, last_tree_hash=? WHERE id=?")
      .run(rec.ts, rec.treeHash, found.id);
    return found.id;
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO memory_threads
      (id, source_app, source_key, source_title, source_url, last_timestamp,
       last_tree_hash, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, rec.app, sourceKey, encryptField(rec.windowTitle, key),
         url === null ? null : encryptField(url, key),
         rec.ts, rec.treeHash, rec.ts, rec.ts);
  return id;
}

/**
 * Write the capture into the thread's mutable head, freezing first if the head
 * belongs to an earlier hour. At most one `is_frozen = 0` row per thread.
 * Captures that arrive out of order (bucket <= the head's bucket) overwrite
 * the head in place rather than freezing it, so the chain's ordering can
 * never be corrupted by clock skew or delayed delivery.
 */
export function commitVersion(
  db: Database, key: Buffer, threadId: string, rec: CaptureRecord,
): { versionId: string; froze: boolean } {
  const bucket = hourBucket(rec.ts);
  const head = db.prepare(
    "SELECT id, hour_bucket FROM memory_versions WHERE thread_id=? AND is_frozen=0"
  ).get(threadId) as { id: string; hour_bucket: number } | null;

  // An out-of-order capture (clock skew, delayed delivery) must never displace
  // a newer head: bucket <= head.hour_bucket is treated as "same hour" so it
  // overwrites in place instead of freezing the newer row and chaining an
  // older-stamped one in front of it, which would corrupt version ordering.
  if (head && bucket <= head.hour_bucket) {
    const overwrite = db.transaction(() => {
      db.prepare(`UPDATE memory_versions
          SET content=?, content_hash=?, word_count=?, committed_at=?,
              embedding_status='pending' WHERE id=?`)
        .run(encryptField(rec.content, key), rec.contentHash,
             rec.content.split(/\s+/).length, rec.ts, head.id);
      // The stored derivatives and vectors no longer match the content they
      // came from: drop the vec0 index row, the float32 rescore sidecar, the
      // evidence links, and the derivative rows themselves, in FK-safe order.
      //
      // loop_evidence references memory_derivatives(id), so it has to go
      // first. Measured 2026-09-22: it did not, and a re-captured Slack thread
      // whose derivative had already been cited as a loop's evidence failed
      // with "FOREIGN KEY constraint failed" — the whole capture was dropped,
      // and every later capture of that same thread in the same hour with it.
      // The loop itself is deliberately left alone: the commitment is still
      // outstanding whatever happened to the capture that revealed it, and
      // deleting a user's open loop to make an internal write succeed would
      // be the worst possible reading of "clean up".
      db.prepare("DELETE FROM loop_evidence WHERE derivative_id IN "
               + "(SELECT id FROM memory_derivatives WHERE version_id=?)").run(head.id);
      // A closed loop cites its closing derivative the same way. The closure
      // stands; only the pointer to the replaced text goes.
      db.prepare("UPDATE open_loops SET resolve_evidence=NULL WHERE resolve_evidence IN "
               + "(SELECT id FROM memory_derivatives WHERE version_id=?)").run(head.id);
      db.prepare("DELETE FROM memory_derivative_embeddings WHERE derivative_id IN "
               + "(SELECT id FROM memory_derivatives WHERE version_id=?)").run(head.id);
      db.prepare("DELETE FROM memory_derivative_vectors WHERE derivative_id IN "
               + "(SELECT id FROM memory_derivatives WHERE version_id=?)").run(head.id);
      db.prepare("DELETE FROM memory_derivatives WHERE version_id=?").run(head.id);
    });
    overwrite();
    return { versionId: head.id, froze: false };
  }

  let froze = false;
  if (head) {
    db.prepare("UPDATE memory_versions SET is_frozen=1 WHERE id=?").run(head.id);
    froze = true;
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO memory_versions
      (id, thread_id, hour_bucket, content, content_hash, word_count, is_frozen,
       parent_version_id, committed_at, embedding_status)
      VALUES (?,?,?,?,?,?,0,?,?, 'pending')`)
    .run(id, threadId, bucket, encryptField(rec.content, key), rec.contentHash,
         rec.content.split(/\s+/).length, head?.id ?? null, rec.ts);
  return { versionId: id, froze };
}
