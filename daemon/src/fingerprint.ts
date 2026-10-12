// Level-3 dedup (spec 4.2 step 1). Relative timestamps are collapsed BEFORE
// hashing: without this, "3 minutes ago" ticking to "8 minutes ago" makes an
// unchanged conversation look novel on every capture. Covers digit, word-article,
// compact, and bare-relative forms so real chat/web UI variants all collapse
// to the same token before hashing.
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

const RELATIVE_PATTERNS: RegExp[] = [
  // "3 minutes ago", "a minute ago", "an hour ago"
  /\b(\d+|an?)\s+(second|minute|hour|day|week|month|year)s?\s+ago\b/gi,
  // compact: "2m ago", "5h ago", "3d ago", "1w ago", "6mo ago", "2y ago"
  /\b\d+\s*(mo|[smhdwy])\s+ago\b/gi,
  // bare relatives
  /\b(just\s+now|yesterday|today|now)\b/gi,
];

export function fingerprint(content: string): string {
  let normalized = content;
  for (const pattern of RELATIVE_PATTERNS) {
    normalized = normalized.replace(pattern, "<relative time>");
  }
  normalized = normalized.trim();
  return createHash("sha256").update(normalized).digest("hex");
}

/** True the first time this fingerprint is seen; records it as a side effect. */
export function isNovel(db: Database, threadId: string, fp: string): boolean {
  const seen = db.prepare("SELECT 1 FROM message_fingerprints WHERE fingerprint=?").get(fp);
  if (seen) return false;
  db.prepare("INSERT INTO message_fingerprints (fingerprint, thread_id, seen_at) VALUES (?,?,?)")
    .run(fp, threadId, Date.now());
  return true;
}
