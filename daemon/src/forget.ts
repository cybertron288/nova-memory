// Deleting what Nova holds (F5.3) and keeping it to a policy (F5.4).
//
// A delete names a scope — a time range, an app, or everything — and removes
// every row that scope reaches, in one transaction, children before parents
// so every foreign key holds. Nothing is soft-deleted: F5.3 says immediate and
// irreversible, and a hidden row is still a row an attacker with the key reads.
//
// The unit is the capture (a memory_versions row). A thread with no capture
// left goes with its last one.
import type { Database } from "bun:sqlite";
import { rmSync, statSync, truncateSync } from "node:fs";
import { encryptField } from "./db";

export type DeleteScope =
  /** Captures with committed_at in [from, to). Epoch ms. */
  | { kind: "range"; from: number; to: number }
  /** Every capture from one app, by the name threads store (source_app). */
  | { kind: "app"; app: string }
  | { kind: "all" };

export interface DeleteCounts {
  captures: number;
  memories: number;
  loops: number;
}

/**
 * Loads the doomed version ids and derivative ids into temp tables, so every
 * statement after this one is a join rather than a re-run of the scope.
 */
function stage(db: Database, scope: DeleteScope): void {
  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS doomed_versions (id TEXT PRIMARY KEY);
    CREATE TEMP TABLE IF NOT EXISTS doomed_derivatives (id TEXT PRIMARY KEY);
    DELETE FROM doomed_versions; DELETE FROM doomed_derivatives;`);
  switch (scope.kind) {
    case "range":
      db.prepare(
        `INSERT INTO doomed_versions SELECT id FROM memory_versions
          WHERE committed_at >= ? AND committed_at < ?`,
      ).run(scope.from, scope.to);
      break;
    case "app":
      db.prepare(
        `INSERT INTO doomed_versions SELECT v.id FROM memory_versions v
           JOIN memory_threads t ON t.id = v.thread_id WHERE t.source_app = ?`,
      ).run(scope.app);
      break;
    case "all":
      db.exec("INSERT INTO doomed_versions SELECT id FROM memory_versions");
      break;
  }
  db.exec(`INSERT INTO doomed_derivatives SELECT id FROM memory_derivatives
             WHERE version_id IN (SELECT id FROM doomed_versions)`);
}

/**
 * Loops the scope takes with it: a loop goes when the scope reaches it and
 * nothing outside the scope still backs it. A loop quotes what someone said,
 * so keeping one after its captures are gone keeps the deleted words.
 *
 * Backing is its evidence (loop_evidence -> derivatives) and the capture that
 * opened it (open_loops.version_id). Loops from before version_id existed and
 * with no evidence can only be placed in time, so a range takes them by
 * created_at (which is the capture's own time) and an app scope cannot.
 */
function doomedLoopsSql(scope: DeleteScope): { sql: string; params: number[] } {
  if (scope.kind === "all") return { sql: "SELECT id FROM open_loops", params: [] };
  const reached = `
       EXISTS (SELECT 1 FROM loop_evidence e WHERE e.loop_id = l.id
                 AND e.derivative_id IN (SELECT id FROM doomed_derivatives))
    OR l.version_id IN (SELECT id FROM doomed_versions)`;
  const backedElsewhere = `
       EXISTS (SELECT 1 FROM loop_evidence e WHERE e.loop_id = l.id
                 AND e.derivative_id NOT IN (SELECT id FROM doomed_derivatives))
    OR (l.version_id IS NOT NULL AND l.version_id NOT IN (SELECT id FROM doomed_versions))`;
  const legacy = scope.kind === "range"
    ? `OR (l.version_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM loop_evidence e WHERE e.loop_id = l.id)
           AND l.created_at >= ? AND l.created_at < ?)`
    : "";
  return {
    sql: `SELECT l.id FROM open_loops l
           WHERE ((${reached}) AND NOT (${backedElsewhere})) ${legacy}`,
    params: scope.kind === "range" ? [scope.from, scope.to] : [],
  };
}

/** What a delete would remove. Writes nothing the caller can see. */
export function countForDelete(db: Database, scope: DeleteScope): DeleteCounts {
  return db.transaction(() => {
    stage(db, scope);
    const loops = doomedLoopsSql(scope);
    const n = (sql: string, ...p: number[]) => (db.prepare(sql).get(...p) as { c: number }).c;
    return {
      captures: n("SELECT COUNT(*) c FROM doomed_versions"),
      memories: n("SELECT COUNT(*) c FROM doomed_derivatives"),
      loops: n(`SELECT COUNT(*) c FROM (${loops.sql})`, ...loops.params),
    };
  })();
}

/**
 * Removes everything the scope reaches. One transaction: a crash halfway
 * leaves the store as it was, never half-deleted.
 *
 * The call log (provider_calls) keeps its rows — it holds no text, and it is
 * the record of what left the Mac — but loses its links to deleted captures.
 * `clearCallLog` empties it too, for "delete everything".
 */
export function deleteScope(
  db: Database, scope: DeleteScope, opts: { clearCallLog?: boolean } = {},
): DeleteCounts {
  const counts = db.transaction((): DeleteCounts => {
    stage(db, scope);
    const loops = doomedLoopsSql(scope);
    db.exec("CREATE TEMP TABLE IF NOT EXISTS doomed_loops (id TEXT PRIMARY KEY); DELETE FROM doomed_loops;");
    db.prepare(`INSERT INTO doomed_loops ${loops.sql}`).run(...loops.params);
    const n = (t: string) => (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
    const result = { captures: n("doomed_versions"), memories: n("doomed_derivatives"), loops: n("doomed_loops") };

    const inDerivs = "IN (SELECT id FROM doomed_derivatives)";
    const inVersions = "IN (SELECT id FROM doomed_versions)";
    db.exec(`
      DELETE FROM loop_evidence WHERE loop_id IN (SELECT id FROM doomed_loops);
      DELETE FROM open_loops WHERE id IN (SELECT id FROM doomed_loops);
      DELETE FROM loop_evidence WHERE derivative_id ${inDerivs};
      UPDATE open_loops SET resolve_evidence = NULL WHERE resolve_evidence ${inDerivs};
      UPDATE open_loops SET version_id = NULL WHERE version_id ${inVersions};
      DELETE FROM memory_derivative_embeddings WHERE derivative_id ${inDerivs};
      DELETE FROM memory_derivative_vectors WHERE derivative_id ${inDerivs};
      DELETE FROM memory_derivatives WHERE id ${inDerivs};
      DELETE FROM memory_retry_queue WHERE version_id ${inVersions};
      DELETE FROM memory_versions WHERE id ${inVersions};`);

    // Fingerprints are what make a re-read of the same text a duplicate. They
    // go with the scope, so the same window read again later is captured
    // again rather than refused as already seen.
    if (scope.kind === "range") {
      db.prepare("DELETE FROM message_fingerprints WHERE seen_at >= ? AND seen_at < ?")
        .run(scope.from, scope.to);
    } else if (scope.kind === "app") {
      db.prepare(
        `DELETE FROM message_fingerprints WHERE thread_id IN
           (SELECT id FROM memory_threads WHERE source_app = ?)`,
      ).run(scope.app);
    } else {
      db.exec("DELETE FROM message_fingerprints");
    }

    // A thread is its captures. With none left it is a title and an address
    // pointing at nothing, which is still something the user asked to forget.
    db.exec(`
      DELETE FROM message_fingerprints WHERE thread_id IN
        (SELECT t.id FROM memory_threads t
          WHERE NOT EXISTS (SELECT 1 FROM memory_versions v WHERE v.thread_id = t.id));
      DELETE FROM memory_threads WHERE NOT EXISTS
        (SELECT 1 FROM memory_versions v WHERE v.thread_id = memory_threads.id);`);

    if (opts.clearCallLog) {
      db.exec("DELETE FROM provider_calls");
    } else if (scope.kind === "all") {
      db.exec("UPDATE provider_calls SET capture_ids = NULL WHERE capture_ids IS NOT NULL");
    } else {
      db.exec(`
        UPDATE provider_calls
           SET capture_ids = (SELECT json_group_array(j.value) FROM json_each(provider_calls.capture_ids) j
                               WHERE j.value NOT ${inVersions})
         WHERE capture_ids IS NOT NULL
           AND EXISTS (SELECT 1 FROM json_each(provider_calls.capture_ids) j WHERE j.value ${inVersions});`);
    }
    db.exec("DELETE FROM doomed_versions; DELETE FROM doomed_derivatives; DELETE FROM doomed_loops;");
    return result;
  })();

  // The write-ahead log still holds the pages the delete rewrote until a
  // checkpoint copies them back. secure_delete (set at open) zeroes freed
  // pages in the main file; the checkpoint is what gets them there.
  //
  // Everything gone: VACUUM first, so the file is the size of what is left.
  // Only here — it rewrites the whole store (0.8 s on a 60 MB store,
  // measured 2026-10-12). In WAL mode it writes the new copy into the WAL,
  // so the checkpoint has to come after it, not before.
  if (scope.kind === "all") db.exec("VACUUM;");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  return counts;
}

export interface DataSummary {
  captures: number;
  memories: number;
  loops: number;
  /** Captures whose text retention has already removed. */
  rawRemoved: number;
  oldest: number | null;
  apps: { app: string; captures: number; last: number }[];
  /** The store on disk, main file plus write-ahead log. Null when :memory:. */
  bytes: number | null;
}

/** What the Your data pane shows before anything is deleted. */
export function dataSummary(db: Database, path: string | null): DataSummary {
  const n = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  let bytes: number | null = null;
  if (path) {
    bytes = 0;
    for (const f of [path, `${path}-wal`]) {
      try { bytes += statSync(f).size; } catch { /* no WAL yet */ }
    }
  }
  return {
    captures: n("SELECT COUNT(*) c FROM memory_versions"),
    memories: n("SELECT COUNT(*) c FROM memory_derivatives"),
    loops: n("SELECT COUNT(*) c FROM open_loops"),
    rawRemoved: n("SELECT COUNT(*) c FROM memory_versions WHERE raw_purged_at IS NOT NULL"),
    oldest: (db.prepare("SELECT MIN(committed_at) t FROM memory_versions").get() as { t: number | null }).t,
    apps: db.prepare(
      `SELECT t.source_app AS app, COUNT(*) AS captures, MAX(v.committed_at) AS last
         FROM memory_versions v JOIN memory_threads t ON t.id = v.thread_id
        GROUP BY t.source_app ORDER BY captures DESC`,
    ).all() as DataSummary["apps"],
    bytes,
  };
}

// --- retention (F5.4) --------------------------------------------------------

/** Day counts the pane offers. null is "forever". */
export const RAW_DAYS = [7, 30, 90, 365] as const;
export const MEMORY_DAYS = [365] as const;

export interface Retention {
  /** Days the captured text is kept. Memories made from it stay. */
  rawDays: number | null;
  /** Days memories are kept. null by default: the PRD keeps summaries. */
  memoryDays: number | null;
}

export interface SweepResult { at: number; rawRemoved: number; deleted: DeleteCounts }

const RAW_KEY = "retention_raw_days";
const MEMORY_KEY = "retention_memory_days";
const SWEEP_KEY = "retention_last_sweep";
const DAY_MS = 86_400_000;
/** How often the sweep runs. It is checked from the drain tick, not a timer. */
export const SWEEP_EVERY_MS = DAY_MS;

function meta(db: Database, key: string): string | null {
  return (db.prepare("SELECT value FROM store_metadata WHERE key=?").get(key) as { value: string } | null)?.value ?? null;
}

function setMeta(db: Database, key: string, value: string): void {
  db.prepare(
    "INSERT INTO store_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(key, value);
}

export function getRetention(db: Database): Retention {
  const days = (v: string | null, fallback: number | null) =>
    v === null ? fallback : v === "forever" ? null : Number(v);
  return { rawDays: days(meta(db, RAW_KEY), 90), memoryDays: days(meta(db, MEMORY_KEY), null) };
}

/** Callers validate against RAW_DAYS / MEMORY_DAYS first; this stores. */
export function setRetention(db: Database, r: Retention): void {
  setMeta(db, RAW_KEY, r.rawDays === null ? "forever" : String(r.rawDays));
  setMeta(db, MEMORY_KEY, r.memoryDays === null ? "forever" : String(r.memoryDays));
}

export function lastSweep(db: Database): SweepResult | null {
  const v = meta(db, SWEEP_KEY);
  return v === null ? null : JSON.parse(v) as SweepResult;
}

/**
 * Applies the retention policy once.
 *
 * Raw text past its days is blanked, not deleted: the capture row stays so
 * the memories made from it keep their parent, which is the whole point of
 * "captures 90 days, memories forever". Memories past theirs go through
 * deleteScope, so they take their loops and vectors with them.
 *
 * A blanked capture still queued is dropped from the queue: there is no text
 * left to extract from, and leaving it would retry an empty string forever.
 */
export function sweepRetention(db: Database, key: Buffer, now = Date.now()): SweepResult {
  const r = getRetention(db);
  let rawRemoved = 0;
  if (r.rawDays !== null) {
    const before = now - r.rawDays * DAY_MS;
    const empty = encryptField("", key);
    rawRemoved = db.transaction(() => {
      const ids = db.prepare(
        "SELECT id FROM memory_versions WHERE committed_at < ? AND raw_purged_at IS NULL",
      ).all(before) as { id: string }[];
      const blank = db.prepare("UPDATE memory_versions SET content=?, raw_purged_at=? WHERE id=?");
      const unqueue = db.prepare("DELETE FROM memory_retry_queue WHERE version_id=?");
      for (const { id } of ids) { blank.run(empty, now, id); unqueue.run(id); }
      return ids.length;
    })();
  }
  const deleted = r.memoryDays === null
    ? { captures: 0, memories: 0, loops: 0 }
    : deleteScope(db, { kind: "range", from: 0, to: now - r.memoryDays * DAY_MS });
  if (rawRemoved > 0 && deleted.captures === 0) db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  const result = { at: now, rawRemoved, deleted };
  setMeta(db, SWEEP_KEY, JSON.stringify(result));
  return result;
}

/** True when a day has passed since the last sweep, or it never ran. */
export function sweepDue(db: Database, now = Date.now()): boolean {
  const last = lastSweep(db);
  return last === null || now - last.at >= SWEEP_EVERY_MS;
}

/**
 * A scope from the socket or the CLI, or the reason it is refused. Refused,
 * never coerced: a malformed "range" read as "all" would be the worst
 * default-instead-of-error this codebase could ship (CLAUDE.md #9).
 */
export function parseScope(raw: unknown): DeleteScope | string {
  if (typeof raw !== "object" || raw === null) return "scope must be an object";
  const s = raw as Record<string, unknown>;
  switch (s.kind) {
    case "range": {
      const ok = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
      if (!ok(s.from) || !ok(s.to)) return "range needs numeric from and to (epoch ms)";
      if ((s.from as number) >= (s.to as number)) return "range from must be before to";
      return { kind: "range", from: s.from as number, to: s.to as number };
    }
    case "app":
      if (typeof s.app !== "string" || s.app.trim() === "") return "app scope needs an app name";
      return { kind: "app", app: s.app };
    case "all":
      return { kind: "all" };
    default:
      return `unknown scope kind: ${JSON.stringify(s.kind)}`;
  }
}

/** A retention value from the socket, or the reason it is refused. */
export function parseRetention(raw: unknown): Retention | string {
  if (typeof raw !== "object" || raw === null) return "retention must be an object";
  const r = raw as Record<string, unknown>;
  const pick = (v: unknown, allowed: readonly number[], name: string): number | null | string =>
    v === null ? null
      : typeof v === "number" && allowed.includes(v) ? v
      : `${name} must be null or one of ${allowed.join(", ")}`;
  const rawDays = pick(r.rawDays, RAW_DAYS, "rawDays");
  if (typeof rawDays === "string") return rawDays;
  const memoryDays = pick(r.memoryDays, MEMORY_DAYS, "memoryDays");
  if (typeof memoryDays === "string") return memoryDays;
  return { rawDays, memoryDays };
}

/**
 * Empties daemon.log and removes last week's daemon.log.1. The shell writes
 * the log and seeks to its end on every write, so truncating under it is safe.
 */
export function clearLogs(logFile: string): void {
  try { truncateSync(logFile, 0); } catch { /* no log yet */ }
  rmSync(`${logFile}.1`, { force: true });
}
