/**
 * Recent memories — the facts Nova has extracted, newest first.
 *
 * A read-only view over `memory_derivatives` for the shell's Memory tab. The
 * daemon serves it because the daemon holds the field key: every derivative is
 * encrypted at rest, and decrypting them is exactly the work no other process
 * is allowed to do (architecture rule 10).
 */
import type { Database } from "bun:sqlite";
import { decryptField } from "./db";

export interface Memory {
  id: string;
  /** The extracted fact, decrypted. */
  text: string;
  /** The app it was read from, or null if the thread is gone. */
  sourceApp: string | null;
  capturedAt: number;
}

/**
 * Newest first, capped. The cap is clamped rather than trusted: this crosses
 * a socket, and an unbounded limit would decrypt the whole store into one
 * reply.
 */
export function listMemories(db: Database, key: Buffer, limit = 30): Memory[] {
  const n = Math.min(Math.max(limit, 1), 200);
  const rows = db
    .prepare(
      `SELECT d.id, d.content, d.committed_at, t.source_app
         FROM memory_derivatives d
         LEFT JOIN memory_threads t ON t.id = d.thread_id
        ORDER BY d.committed_at DESC
        LIMIT ?`,
    )
    .all(n) as { id: string; content: string; committed_at: number; source_app: string | null }[];

  const out: Memory[] = [];
  for (const r of rows) {
    // One unreadable row must not empty the tab. The loops list already takes
    // this line — it omits a row it cannot decrypt and keeps serving the rest
    // (spec §9) — and the same reasoning holds here.
    try {
      out.push({
        id: r.id,
        text: decryptField(r.content, key),
        sourceApp: r.source_app,
        capturedAt: r.committed_at,
      });
    } catch {
      continue;
    }
  }
  return out;
}

export interface MemoryPage {
  items: Memory[];
  /** Pass back as `after` for the next page; null when there is none. */
  next: string | null;
}

/**
 * One page of the Memory tab, newest first, for infinite scroll. Keyset-paged
 * on (committed_at, id) like the loops list, so a memory extracted while the
 * user scrolls neither repeats a row nor skips one.
 */
export function listMemoriesPage(
  db: Database, key: Buffer, opts: { after?: string | null; limit?: number } = {},
): MemoryPage {
  const n = Math.min(Math.max(opts.limit ?? 30, 1), 200);
  const m = opts.after ? /^(\d+):(.+)$/.exec(opts.after) : null;
  const rows = db
    .prepare(
      `SELECT d.id, d.content, d.committed_at, t.source_app
         FROM memory_derivatives d
         LEFT JOIN memory_threads t ON t.id = d.thread_id
        WHERE (? IS NULL OR d.committed_at < ? OR (d.committed_at = ? AND d.id < ?))
        ORDER BY d.committed_at DESC, d.id DESC
        LIMIT ?`,
    )
    .all(m ? 1 : null, m ? Number(m[1]) : 0, m ? Number(m[1]) : 0, m ? m[2]! : "", n + 1) as
      { id: string; content: string; committed_at: number; source_app: string | null }[];
  const more = rows.length > n;
  const page = rows.slice(0, n);
  const items: Memory[] = [];
  for (const r of page) {
    // One unreadable row must not empty the tab (as listMemories).
    try {
      items.push({ id: r.id, text: decryptField(r.content, key), sourceApp: r.source_app,
                   capturedAt: r.committed_at });
    } catch { continue; }
  }
  const last = page[page.length - 1];
  return { items, next: more && last ? `${last.committed_at}:${last.id}` : null };
}
