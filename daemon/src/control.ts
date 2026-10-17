/**
 * The daemon's control socket (spec §6).
 *
 * A Unix domain socket in the Nova support directory, serving five
 * newline-delimited JSON ops. This is the *only* way any other process — the
 * menu-bar shell, the `nova loops` CLI — reads or acts on loops: the daemon
 * stays the one process that opens the store and holds the field key
 * (spec §3 amendment A, architecture rule 10 as amended for R1a).
 *
 * Two layers, on purpose. `handleControlLine` is the pure core: one request
 * line in, one reply line out, never throws. It is what the tests exercise.
 * `startControlServer` is the thin Bun.listen wrapper that frames lines and
 * owns the socket file's lifecycle.
 *
 * Why a Unix socket and not TCP: file permissions gate access. A localhost
 * port is reachable by any process on the machine; a 0600 socket file is
 * reachable only by the user. The process that can ask for decrypted loops
 * must have the narrowest reachable surface available.
 */
import type { Database } from "bun:sqlite";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import type { IngestGate } from "./ingest";
import {
  actOnLoop, listLoopsPage, listOpenLoops, LoopNotActionable, loopPrecision, rateLoop,
  type LoopAction, type LoopDirection,
} from "./loops";
import { listMemories, listMemoriesPage } from "./memories";
import { buildMorningDigest } from "./digest";
import type { InferenceProvider } from "./provider";
import {
  addExclusion, listExclusions, removeExclusion, hardExclusions, skipCounts,
  type ExclusionKind,
} from "./exclusions";
import { purgeSecrets } from "./purge";
import { parkedCaptures, retryParked } from "./pipeline";
import {
  clearLogs, countForDelete, dataSummary, deleteScope, getRetention, lastSweep, parseRetention,
  parseScope, setRetention,
} from "./forget";
import { listCalls, callTotals } from "./calls";
import { countCapturesSince, listRecentCaptures } from "./captures";
import { parseIdentity, storeIdentity, userIdentity } from "./identity";

export const CONTROL_SOCKET_NAME = "control.sock";

/** What the daemon knows about itself, handed to the socket by the CLI. */
export interface DaemonState {
  /** Shared with ingestStream: pause/resume flip it, status reports it. */
  gate: IngestGate;
  startedAt: number;
  /** Read on demand from the store, like `queued`; null when nothing is stored yet. */
  lastCaptureAt: () => number | null;
  /** The most recent summarised error line, or null. Surfaced verbatim by the shell. */
  lastError: string | null;
  /** Read on demand so status never holds a stale count. */
  queued: () => number;
  /**
   * daemon.log, emptied by "delete everything": it names loops in plain text.
   * Absent in tests, so a test delete never touches the user's real log.
   */
  logFile?: string;
}

/**
 * Cap on a single connection's unframed buffer. Without it a client that never
 * sends a newline grows the daemon's heap without limit, and the daemon is the
 * one process holding the field key. ingest.ts caps its capture stream at the
 * same 4 MiB for the same hazard; a control line is far smaller than a capture
 * line, so this is already generous. Defined here rather than imported, so the
 * socket's own limit is readable at the boundary that enforces it.
 */
const MAX_BUFFER_BYTES = 4 * 1024 * 1024;

const OPS = new Set([
  "status", "list_loops", "act_on_loop", "rate_loop", "loop_precision", "pause", "resume", "list_memories",
  "morning_digest", "list_loops_page", "list_memories_page",
  "list_exclusions", "add_exclusion", "remove_exclusion", "list_calls",
  "list_captures", "list_blocked", "list_parked", "retry_parked",
  "data_summary", "count_for_delete", "delete_data", "set_retention",
  "get_profile", "set_profile",
]);
const ACTIONS = new Set<string>(["done", "snooze", "dismiss"]);
const EXCLUSION_KINDS = new Set<string>(["app", "domain"]);
const DIRECTIONS = new Set<string>(["i_owe", "owed_to_me", "unanswered", "stalled", "any"]);

/** A request's `since`, when it is a usable epoch-ms number. */
function sinceOf(msg: Record<string, unknown>): number | undefined {
  return typeof msg.since === "number" && Number.isFinite(msg.since) && msg.since >= 0
    ? Math.trunc(msg.since) : undefined;
}

function reply(id: unknown, body: { ok: true; result: unknown } | { ok: false; error: string }): string {
  // JSON.stringify escapes any newline inside a value, so the reply is
  // always exactly one line — the client frames on "\n" and must never see
  // a raw one inside a loop description.
  return JSON.stringify({ id: id ?? null, ...body }) + "\n";
}

/**
 * Whether the user paused capture, as last stored. Kept in the store so a
 * pause survives a daemon restart: the supervisor restarts the daemon on its
 * own, and a pause that silently lapsed would resume reading the screen.
 */
export function storedPause(db: Database): boolean {
  const row = db.prepare("SELECT value FROM store_metadata WHERE key='capture_paused'").get() as
    { value: string } | null;
  return row?.value === "1";
}

/** The Profile pane's view of the identity, and where it came from. */
function profile(db: Database, key: Buffer) {
  const { identity, source } = userIdentity(db, key);
  return { name: identity?.name ?? null, aliases: identity?.aliases ?? [], source };
}

function storePause(db: Database, paused: boolean): void {
  db.prepare(
    "INSERT INTO store_metadata (key, value) VALUES ('capture_paused', ?) "
    + "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(paused ? "1" : "0");
}

/**
 * One request line in, one reply line out. Never throws: every failure is a
 * reply with ok:false, because a thrown error here would close the
 * connection and the spec says a bad request must not (§6).
 */
export function handleControlLine(
  line: string, db: Database, key: Buffer, state: DaemonState, provider?: InferenceProvider,
): string | Promise<string> {
  let msg: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(line);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return reply(null, { ok: false, error: "request must be a JSON object" });
    }
    msg = parsed as Record<string, unknown>;
  } catch {
    return reply(null, { ok: false, error: "request is not valid JSON" });
  }

  const id = msg.id ?? null;
  const op = typeof msg.op === "string" ? msg.op : "";
  if (id === null) return reply(null, { ok: false, error: "request has no id" });
  if (!OPS.has(op)) return reply(id, { ok: false, error: `unknown op: ${op || "(missing)"}` });

  try {
    switch (op) {
      case "status":
        return reply(id, { ok: true, result: {
          capturing: !state.gate.paused,
          paused: state.gate.paused,
          queued: state.queued(),
          lastCaptureAt: state.lastCaptureAt(),
          lastError: state.lastError,
          uptimeMs: Date.now() - state.startedAt,
          pid: process.pid,
        }});

      case "list_loops": {
        // An absent direction means "any". A *present* one that is not in the
        // allowlist is an error, not an "any": coercing it would disable the
        // filter and return every loop with ok:true, so `--direction owes_me`
        // (a plausible typo for owed_to_me) would print the whole unfiltered
        // list as though it were filtered. Same policy as act_on_loop's
        // unknown action below.
        const raw = msg.direction;
        if (raw !== undefined && !(typeof raw === "string" && DIRECTIONS.has(raw))) {
          return reply(id, { ok: false, error: `unknown direction: ${JSON.stringify(raw)}` });
        }
        const direction = (typeof raw === "string" ? raw : "any") as LoopDirection | "any";
        const limit = typeof msg.limit === "number" ? msg.limit : 20;
        return reply(id, { ok: true, result: listOpenLoops(db, key, { direction, limit }) });
      }

      case "act_on_loop": {
        const loopId = typeof msg.loopId === "string" ? msg.loopId : "";
        const action = typeof msg.action === "string" ? msg.action : "";
        if (!loopId) return reply(id, { ok: false, error: "act_on_loop requires loopId" });
        if (!ACTIONS.has(action)) return reply(id, { ok: false, error: `unknown action: ${action || "(missing)"}` });
        // Clamp at the boundary: a past or non-finite `until` would be written
        // verbatim and listOpenLoops would immediately re-show the loop, so the
        // user's "hide until tomorrow" would silently do nothing. actOnLoop is
        // also called by trusted internal paths, so the guard lives here, at the
        // edge that receives untrusted input, rather than inside it.
        const untilRaw = typeof msg.until === "number" ? msg.until : undefined;
        const until = untilRaw !== undefined && Number.isFinite(untilRaw)
          ? Math.max(untilRaw, Date.now() + 1)
          : undefined;
        return reply(id, { ok: true, result: actOnLoop(db, loopId, action as LoopAction, until) });
      }

      case "rate_loop": {
        const loopId = typeof msg.loopId === "string" ? msg.loopId : "";
        if (!loopId) return reply(id, { ok: false, error: "rate_loop requires loopId" });
        // Exactly 1, -1 or null. Anything else — a string, 0, 2 — is refused
        // rather than coerced: a verdict is the one input precision is built on.
        const rating = msg.rating;
        if (rating !== 1 && rating !== -1 && rating !== null) {
          return reply(id, { ok: false, error: "rating must be 1, -1 or null" });
        }
        return reply(id, { ok: true, result: rateLoop(db, loopId, rating) });
      }

      case "loop_precision":
        return reply(id, { ok: true, result: loopPrecision(db) });

      case "list_captures": {
        const limit = typeof msg.limit === "number" && Number.isFinite(msg.limit)
          ? Math.trunc(msg.limit) : 30;
        if (limit < 1) return reply(id, { ok: false, error: "limit must be at least 1" });
        // `since` (epoch ms, the start of the user's day) adds a count over
        // the whole day, which the page alone cannot give: a busy day holds
        // more captures than one page.
        const since = sinceOf(msg);
        return reply(id, {
          ok: true,
          result: {
            captures: listRecentCaptures(db, key, limit),
            ...(since === undefined ? {} : { since, count: countCapturesSince(db, since) }),
            // When the daemon answered. "Nothing today" is only true as of a
            // moment, and the Inspector says which.
            asOf: Date.now(),
          },
        });
      }

      case "list_calls": {
        // The transparency panel's feed (F5.5): metadata only, newest first.
        const limit = typeof msg.limit === "number" && Number.isFinite(msg.limit)
          ? Math.trunc(msg.limit) : 50;
        if (limit < 1) return reply(id, { ok: false, error: "limit must be at least 1" });
        return reply(id, {
          ok: true,
          result: { calls: listCalls(db, limit), totals: callTotals(db, sinceOf(msg) ?? 0), asOf: Date.now() },
        });
      }

      case "list_parked":
        // Captures the pipeline gave up on. They stay queued, parked, until
        // retried: a capture leaves the queue only when it succeeds.
        return reply(id, { ok: true, result: { parked: parkedCaptures(db, key), asOf: Date.now() } });

      case "retry_parked": {
        // Absent means all. A present value must be an array of strings —
        // anything else is refused, not read as "all" (bug class #9).
        const raw = msg.versionIds;
        if (raw !== undefined
            && !(Array.isArray(raw) && raw.every((v) => typeof v === "string"))) {
          return reply(id, { ok: false, error: "versionIds must be an array of strings" });
        }
        const requeued = retryParked(db, raw as string[] | undefined);
        console.error(`[control] re-queued ${requeued} parked capture(s)`);
        return reply(id, { ok: true, result: { requeued } });
      }

      case "data_summary":
        // The Your data pane in one round trip, like list_blocked.
        return reply(id, { ok: true, result: {
          ...dataSummary(db, db.filename === ":memory:" ? null : db.filename),
          retention: getRetention(db),
          lastSweep: lastSweep(db),
          asOf: Date.now(),
        }});

      case "count_for_delete": {
        const scope = parseScope(msg.scope);
        if (typeof scope === "string") return reply(id, { ok: false, error: scope });
        return reply(id, { ok: true, result: countForDelete(db, scope) });
      }

      case "delete_data": {
        const scope = parseScope(msg.scope);
        if (typeof scope === "string") return reply(id, { ok: false, error: scope });
        if (msg.clearCallLog !== undefined && typeof msg.clearCallLog !== "boolean") {
          return reply(id, { ok: false, error: "clearCallLog must be a boolean" });
        }
        const deleted = deleteScope(db, scope, { clearCallLog: msg.clearCallLog === true });
        if (scope.kind === "all" && state.logFile) clearLogs(state.logFile);
        // Counts only: the log must say a delete happened without naming what.
        console.error(`[forget] ${scope.kind}: deleted captures=${deleted.captures} `
          + `memories=${deleted.memories} loops=${deleted.loops}`);
        return reply(id, { ok: true, result: deleted });
      }

      case "set_retention": {
        const r = parseRetention(msg.retention);
        if (typeof r === "string") return reply(id, { ok: false, error: r });
        setRetention(db, r);
        return reply(id, { ok: true, result: getRetention(db) });
      }

      case "get_profile":
        return reply(id, { ok: true, result: profile(db, key) });

      case "set_profile": {
        const identity = parseIdentity(msg.name, msg.aliases);
        if (typeof identity === "string") return reply(id, { ok: false, error: identity });
        storeIdentity(db, key, identity);
        // A count only: the log is plaintext and must not name the user.
        console.error(`[profile] updated: ${identity.aliases.length} handles`);
        return reply(id, { ok: true, result: profile(db, key) });
      }

      case "list_blocked":
        // One round trip for the whole pane: the non-overridable categories,
        // the user's own list, and the skip counts. Separate ops would let the
        // pane render the user's list while the hard list was still loading,
        // which reads as "this is everything that is blocked".
        return reply(id, {
          ok: true,
          result: {
            hard: hardExclusions(),
            exclusions: listExclusions(db, key),
            skipped: skipCounts(db),
          },
        });

      case "list_exclusions":
        return reply(id, { ok: true, result: { exclusions: listExclusions(db, key) } });

      case "add_exclusion": {
        // The kind is checked against the allowlist rather than defaulted: a
        // typo must not silently become an app rule that never matches the
        // domain the user meant to exclude.
        const kind = typeof msg.kind === "string" ? msg.kind : "";
        if (!EXCLUSION_KINDS.has(kind))
          return reply(id, { ok: false, error: "kind must be app or domain" });
        const value = typeof msg.value === "string" ? msg.value : "";
        // The picker supplies a bundle id as the value and the app's name as
        // the label, so the rule survives a rename and the pane still reads.
        const label = typeof msg.label === "string" ? msg.label : undefined;
        try {
          const exclusionId = addExclusion(db, key, { kind: kind as ExclusionKind, value, label });
          // The list only refuses future captures; what is already stored goes
          // in the same pass that applies a stricter credential rule, so the
          // user sees the source gone rather than merely stopped.
          const purged = purgeSecrets(db, key);
          return reply(id, { ok: true, result: { id: exclusionId, purged } });
        } catch (e) {
          return reply(id, { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }

      case "remove_exclusion": {
        // `exclusionId`, not `id`: `id` is the request's own correlation field,
        // and a client that sent a string one would otherwise delete whichever
        // exclusion happened to carry that id.
        const exclusionId = typeof msg.exclusionId === "string" ? msg.exclusionId : "";
        if (!exclusionId)
          return reply(id, { ok: false, error: "remove_exclusion requires exclusionId" });
        if (!removeExclusion(db, exclusionId))
          return reply(id, { ok: false, error: "no such exclusion" });
        return reply(id, { ok: true, result: { removed: true } });
      }

      case "morning_digest": {
        // The one op that waits: it may make an AI call. Everything else stays
        // synchronous. buildMorningDigest never rejects on a provider failure
        // (it falls back), so a rejection here is a store error.
        if (!provider) return reply(id, { ok: false, error: "morning_digest needs a provider" });
        // `plain: true` skips the AI and returns the fallback lines — for
        // showing the card while developing without paying for a call.
        return buildMorningDigest(db, key, msg.plain === true ? {} as InferenceProvider : provider)
          .then((d) => reply(id, { ok: true, result: d }))
          .catch((e) => {
            console.error(`[control] morning_digest failed: ${e instanceof Error ? e.message : String(e)}`);
            return reply(id, { ok: false, error: e instanceof Error ? e.message : String(e) });
          });
      }

      // Paged lists for the panel's infinite scroll. `after` is the opaque
      // cursor from the previous page; anything but a string starts over.
      case "list_loops_page": {
        const after = typeof msg.after === "string" ? msg.after : null;
        const limit = typeof msg.limit === "number" ? msg.limit : 30;
        return reply(id, { ok: true, result: listLoopsPage(db, key, { after, limit }) });
      }

      case "list_memories_page": {
        const after = typeof msg.after === "string" ? msg.after : null;
        const limit = typeof msg.limit === "number" ? msg.limit : 30;
        return reply(id, { ok: true, result: listMemoriesPage(db, key, { after, limit }) });
      }

      case "list_memories": {
        const limit = typeof msg.limit === "number" ? msg.limit : 30;
        return reply(id, { ok: true, result: listMemories(db, key, limit) });
      }

      case "pause":
        state.gate.paused = true;
        storePause(db, true);
        return reply(id, { ok: true, result: { paused: true } });

      case "resume":
        state.gate.paused = false;
        storePause(db, false);
        return reply(id, { ok: true, result: { paused: false } });
    }
  } catch (e) {
    // LoopNotActionable is the expected failure and its message already
    // names the state ("loop X is dismissed"). Anything else is unexpected,
    // still answered rather than thrown, and logged so it is not silent.
    if (!(e instanceof LoopNotActionable)) {
      console.error(`[control] ${op} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return reply(id, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
  return reply(id, { ok: false, error: "unreachable" });
}

/**
 * Binds the socket and serves `handleControlLine` over it.
 *
 * A stale socket file from a crashed daemon is unlinked first — bind would
 * otherwise fail with EADDRINUSE on every restart after a crash, which is
 * exactly when a restart matters most. The file is chmod 0600 after bind.
 */
type Conn = { write(data: Uint8Array): number; data: { out: Uint8Array | null } };

/** Queue a reply behind anything still unsent, then write what the socket takes. */
function send(sock: Conn, reply: string) {
  const bytes = new TextEncoder().encode(reply);
  const out = sock.data.out;
  if (out) {
    const joined = new Uint8Array(out.length + bytes.length);
    joined.set(out);
    joined.set(bytes, out.length);
    sock.data.out = joined;
  } else {
    sock.data.out = bytes;
  }
  flush(sock);
}

function flush(sock: Conn) {
  const out = sock.data.out;
  if (!out) return;
  const n = sock.write(out);
  sock.data.out = n >= out.length ? null : out.subarray(Math.max(n, 0));
}

export function startControlServer(
  path: string, db: Database, key: Buffer, state: DaemonState, provider?: InferenceProvider,
): { stop(): void } {
  if (existsSync(path)) unlinkSync(path);
  const server = Bun.listen<{ buf: string; decoder: TextDecoder; out: Uint8Array | null }>({
    unix: path,
    socket: {
      open(sock) { sock.data = { buf: "", decoder: new TextDecoder(), out: null }; },
      // The kernel takes what fits and write() says how much; the rest waits
      // here until the socket drains. Ignoring the count dropped everything
      // past the first 8 KB of a reply — measured 2026-09-23, a 30-memory
      // list_memories that never reached its newline, so the Memory tab showed
      // its skeleton forever.
      drain(sock) { flush(sock); },
      data(sock, chunk) {
        // One decoder per connection, decoding with { stream: true }, as
        // ingestStream does. chunk.toString() decodes each chunk standalone,
        // so a multi-byte character split across a chunk boundary becomes
        // U+FFFD on both sides — and the mangled JSON still parses, so a
        // corrupted request would be served as though it were valid.
        sock.data.buf += sock.data.decoder.decode(chunk, { stream: true });
        // Nothing framable and already past the cap: this client is not going
        // to send a newline. Say so once and drop the connection rather than
        // keep buffering. ingest discards and continues because its producer is
        // our own capture binary and the stream must survive one bad line;
        // here the peer is arbitrary, and closing is what actually stops it.
        if (sock.data.buf.length > MAX_BUFFER_BYTES) {
          console.error(`[control] connection sent ${sock.data.buf.length} bytes with no newline; closing it`);
          sock.data.buf = "";
          sock.end();
          return;
        }
        let nl: number;
        while ((nl = sock.data.buf.indexOf("\n")) >= 0) {
          const line = sock.data.buf.slice(0, nl).trim();
          sock.data.buf = sock.data.buf.slice(nl + 1);
          if (!line) continue;
          const out = handleControlLine(line, db, key, state, provider);
          // Replies carry their request id, so an async one may overtake a
          // later sync one; the client matches on id.
          if (typeof out === "string") send(sock, out);
          else void out.then((r) => send(sock, r));
        }
      },
      error(_sock, err) { console.error(`[control] socket error: ${err.message}`); },
    },
  });
  chmodSync(path, 0o600);
  return {
    stop() {
      server.stop(true);
      if (existsSync(path)) unlinkSync(path);
    },
  };
}
