// Removes credentials already in the store (D1, part 1).
//
// Ingest now refuses and redacts before anything is stored, but a store
// written before that holds what it held. This pass applies the same rules to
// everything already there. It runs at every daemon start: it is idempotent,
// so a later, stricter pattern also reaches old rows without a migration.
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { decryptField, encryptField } from "./db";
import { deniedSource, redactSecrets } from "./sensitive";
import { userExcluded } from "./exclusions";

export interface PurgeCounts {
  threads: number;
  versions: number;
  memories: number;
  loops: number;
}

export function purgeSecrets(db: Database, key: Buffer): PurgeCounts {
  const counts: PurgeCounts = { threads: 0, versions: 0, memories: 0, loops: 0 };
  const dec = (s: string | null) => (s ? decryptField(s, key) : "");

  db.transaction(() => {
    const threads = db
      .prepare("SELECT id, source_app, source_title, source_url FROM memory_threads")
      .all() as { id: string; source_app: string; source_title: string | null; source_url: string | null }[];
    for (const t of threads) {
      if (!deniedSource(t.source_app, dec(t.source_url), dec(t.source_title))
        && !userExcluded(db, key, t.source_app, dec(t.source_url), dec(t.source_title))) continue;
      deleteThread(db, t.id);
      counts.threads++;
    }

    const versions = db.prepare("SELECT id, content FROM memory_versions").all() as { id: string; content: string }[];
    const setVersion = db.prepare("UPDATE memory_versions SET content=? WHERE id=?");
    for (const v of versions) {
      const plain = dec(v.content);
      const { text } = redactSecrets(plain);
      if (text === plain) continue;
      setVersion.run(encryptField(text, key), v.id);
      counts.versions++;
    }

    // Memories keep their vectors: the embedding was computed and sent before
    // this fix, and deleting the row would lose the fact around the secret.
    // Search results, the panel and MCP read the text, which is what changes.
    const memories = db.prepare("SELECT id, content FROM memory_derivatives").all() as { id: string; content: string }[];
    const setMemory = db.prepare("UPDATE memory_derivatives SET content=?, content_hash=? WHERE id=?");
    for (const m of memories) {
      const plain = dec(m.content);
      const { text } = redactSecrets(plain);
      if (text === plain) continue;
      setMemory.run(encryptField(text, key), createHash("sha256").update(text).digest("hex"), m.id);
      counts.memories++;
    }

    const loops = db
      .prepare("SELECT id, description, closure_sig, due_signal FROM open_loops")
      .all() as { id: string; description: string; closure_sig: string; due_signal: string | null }[];
    const setLoop = db.prepare("UPDATE open_loops SET description=?, closure_sig=?, due_signal=? WHERE id=?");
    for (const l of loops) {
      const description = dec(l.description), sig = dec(l.closure_sig), due = l.due_signal ?? "";
      const [d, c, u] = [description, sig, due].map((s) => redactSecrets(s).text);
      if (d === description && c === sig && u === due) continue;
      setLoop.run(encryptField(d!, key), encryptField(c!, key), l.due_signal === null ? null : u, l.id);
      counts.loops++;
    }
  })();
  return counts;
}

/** Everything a thread owns, children first, so every foreign key holds. */
function deleteThread(db: Database, threadId: string): void {
  const derivs = "(SELECT id FROM memory_derivatives WHERE thread_id=?)";
  db.prepare(`DELETE FROM loop_evidence WHERE derivative_id IN ${derivs}`).run(threadId);
  db.prepare(`UPDATE open_loops SET resolve_evidence=NULL WHERE resolve_evidence IN ${derivs}`).run(threadId);
  db.prepare(`DELETE FROM memory_derivative_embeddings WHERE derivative_id IN ${derivs}`).run(threadId);
  db.prepare(`DELETE FROM memory_derivative_vectors WHERE derivative_id IN ${derivs}`).run(threadId);
  db.prepare("DELETE FROM memory_derivatives WHERE thread_id=?").run(threadId);
  db.prepare("DELETE FROM memory_retry_queue WHERE version_id IN (SELECT id FROM memory_versions WHERE thread_id=?)")
    .run(threadId);
  db.prepare("DELETE FROM memory_versions WHERE thread_id=?").run(threadId);
  db.prepare("DELETE FROM message_fingerprints WHERE thread_id=?").run(threadId);
  db.prepare("DELETE FROM memory_threads WHERE id=?").run(threadId);
}
