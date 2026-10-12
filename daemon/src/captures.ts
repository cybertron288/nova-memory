// What was captured recently, for the transparency panel (F5.5).
//
// The Memory tab already shows what Nova *remembered*. This is the layer
// under it: the captures themselves, so a user can see Nova reading their
// screen and recognise the windows. It answers "is it capturing, and from
// where" — the question a menu-bar app that claims to watch everything has to
// be able to answer without being believed on trust.
//
// Sizes, not content. The panel names the window and says how much text came
// from it; the text itself is in the Memory tab, one deliberate click away,
// rather than scrolling past in a feed the user leaves open.
import type { Database } from "bun:sqlite";
import { decryptField } from "./db";

export interface RecentCapture {
  id: string;
  at: number;
  app: string;
  title: string;
  url: string | null;
  /** How much text this capture stored. Never the text. */
  chars: number;
  words: number;
}

/** The most recent captures, newest first. */
export function listRecentCaptures(db: Database, key: Buffer, limit = 30): RecentCapture[] {
  const n = Math.min(Math.max(limit, 1), 200);
  const rows = db
    .prepare(
      `SELECT v.id, v.committed_at, v.word_count, v.content,
              t.source_app, t.source_title, t.source_url
         FROM memory_versions v
         LEFT JOIN memory_threads t ON t.id = v.thread_id
        ORDER BY v.committed_at DESC, v.rowid DESC
        LIMIT ?`,
    )
    .all(n) as {
      id: string; committed_at: number; word_count: number; content: string;
      source_app: string | null; source_title: string | null; source_url: string | null;
    }[];

  const out: RecentCapture[] = [];
  for (const r of rows) {
    // One unreadable row must not empty the tab, the same line listMemories
    // and the loops list already take (spec §9).
    try {
      out.push({
        id: r.id,
        at: r.committed_at,
        app: r.source_app ?? "unknown",
        title: r.source_title ? decryptField(r.source_title, key) : "",
        url: r.source_url ? decryptField(r.source_url, key) : null,
        // Decrypted to count, because the stored column is ciphertext and its
        // length includes the IV, the tag and base64 expansion — reporting
        // that would overstate every capture. The panel asks for a page at a
        // time, so this is a few dozen decrypts, not a scan.
        chars: decryptField(r.content, key).length,
        words: r.word_count,
      });
    } catch {
      continue;
    }
  }
  return out;
}

/** How many captures were stored at or after `since` (epoch ms). */
export function countCapturesSince(db: Database, since: number): number {
  const r = db.prepare("SELECT count(*) AS n FROM memory_versions WHERE committed_at >= ?")
    .get(since) as { n: number };
  return r.n;
}
