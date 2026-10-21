#!/usr/bin/env bun
// nova — the M1 entry point.
//
//   nova start    spawn nova-capture and ingest what it emits
//   nova search   query the store from a terminal
//   nova status   counts, and why captures were skipped
//   nova mcp      serve MCP over stdio (this is what Claude Desktop runs)
//   nova loops    list open loops via the running daemon's control socket
//   nova done|snooze|dismiss <id>   act on a loop (F4.4)
//   nova precision                  how many rated loops were real (F4.5)
//   nova pause | resume             flip capture without restarting
//   nova logs [--tag t] [-n N] [--no-dim]   follow daemon.log, colored
//
// `mcp` must never write to stdout except through the protocol transport —
// stdout is the wire Claude Desktop reads. All diagnostics below go to
// stderr (console.error); console.log is used only for `search`/`status`
// terminal output, which is never reached in the `mcp` branch.
import { openDb, fieldKey } from "./db";
import { ingestStream } from "./ingest";
import { drainQueue, reachability, releaseStaleClaims } from "./pipeline";
import { parseScope, sweepDue, sweepRetention, type DeleteScope } from "./forget";
import { purgeSecrets } from "./purge";
import { recordCall, type ProviderCall, type CallTotal } from "./calls";
import { searchMemory } from "./search";
import { resolveCaptureBin } from "./capture-bin";
import { serveMcp, formatLoops } from "./mcp";
import { MissingKeyProvider, NotSignedIn, UnconfiguredProvider } from "./provider";
import { NovaCloudProvider } from "./cloud";
import { resolveProvider } from "./resolve";
import { startControlServer, storedPause, CONTROL_SOCKET_NAME, type DaemonState } from "./control";
import { controlRequest } from "./control-client";
import {
  PIDFILE_NAME, checkInstance, claimInstance, releaseInstance, terminateInstance,
} from "./single-instance";
import type { LoopPrecision, OpenLoop } from "./loops";
import { stampStderr, relayLines, formatLine, parseLine } from "./log";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const DIR = join(homedir(), "Library", "Application Support", "Nova");
mkdirSync(DIR, { recursive: true });
const DB_PATH = join(DIR, "memory.db");
/** Serialises Nova Cloud token refreshes across the daemon and `nova mcp`. */
const SESSION_LOCK = join(DIR, "session.lock");

const cmd = process.argv[2];

// Opened on first use, not at startup. Only `start`, `search`, `status` and
// `mcp` touch the store; the six control-socket subcommands must not, because
// the daemon being the sole process that opens the store is the architecture's
// central invariant — and an unconditional open here made every `nova loops`
// do a write-capable SQLCipher open and ask the keychain for the field key.
// Memoized so a branch that calls it twice still opens once.
let opened: Promise<{ db: Awaited<ReturnType<typeof openDb>>; key: Awaited<ReturnType<typeof fieldKey>> }> | undefined;
const store = () => (opened ??= (async () => ({ db: await openDb(DB_PATH), key: await fieldKey() }))());

if (cmd === "start") {
  stampStderr();
  // Refuse a second daemon before opening the store (D18). The control socket
  // unlinks a stale socket file when it binds, which means a second start
  // silently steals it and leaves the first daemon running and unreachable:
  // two capture children on one store, and `pause` reaching only one of them.
  // --force is the deliberate takeover; without it this exits.
  const PIDFILE = join(DIR, PIDFILE_NAME);
  const force = process.argv.includes("--force");
  const instance = checkInstance(PIDFILE);
  if (!instance.ok) {
    if (!force) {
      console.error(`[nova] already running (pid ${instance.pid}). Use --force to take over.`);
      process.exit(1);
    }
    console.error(`[nova] --force: stopping the daemon at pid ${instance.pid}`);
    if (!(await terminateInstance(instance.pid))) {
      console.error(`[nova] pid ${instance.pid} did not exit; refusing to start a second daemon`);
      process.exit(1);
    }
  } else if (instance.stale) {
    console.error("[nova] removing a stale pidfile from a daemon that did not shut down");
  }
  claimInstance(PIDFILE);

  const { db, key } = await store();

  // resolveProvider never throws (the MCP server depends on that), so probe
  // the configuration here instead and fail before spawning capture.
  // The sink records what left the machine, for the transparency panel
  // (F5.5). recordCall swallows its own failures, so logging can never turn a
  // successful extraction into a failed one.
  const { provider, mode, session } = await resolveProvider(process.env, (c) => recordCall(db, c), { lockPath: SESSION_LOCK });
  if (provider instanceof MissingKeyProvider || provider instanceof UnconfiguredProvider) {
    await provider.extract("").catch((e) => { console.error(`[nova] ${e.message}`); process.exit(1); });
  }
  // Nova Cloud's probe never stops the daemon: signed out, offline or over
  // the cap, captures are kept and wait, which is the point of the queue.
  if (provider instanceof NovaCloudProvider) {
    try {
      const u = await provider.usage();
      console.error(`[nova] Nova Cloud: ${u.plan} plan, ${u.usedToday} of ${u.capToday} tokens used today`);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error(e instanceof NotSignedIn
        ? "[nova] not signed in to Nova Cloud; captures are kept and wait for sign-in"
        : `[nova] Nova Cloud is not answering yet (${reason}); captures are kept and wait`);
    }
  }

  // Free any claim a previous run died holding, before the first drain. A
  // recovered job has to be explicable from the logs, so say so when there was
  // one — and stay quiet on a clean start, which is every normal start.
  const released = releaseStaleClaims(db);
  if (released > 0) {
    console.error(`[nova] released ${released} abandoned queue claim(s) from a previous run`);
  }
  const purged = purgeSecrets(db, key);
  if (purged.threads + purged.versions + purged.memories + purged.loops > 0) {
    console.error(`[nova] removed secrets: ${purged.threads} password-manager thread(s) deleted, `
      + `redacted ${purged.versions} capture(s), ${purged.memories} memories, ${purged.loops} loop(s)`);
  }

  const drain = () => {
    drainQueue(db, key, provider).catch((e) => {
      state.lastError = e instanceof Error ? e.message : String(e);
      console.error(`[nova] ${state.lastError}`);
    });
  };

  // Everything the control socket can be asked about, in one object shared
  // with the ingest loop. The gate is the pause flag; the rest is telemetry
  // the shell's status glyph and error line are built from.
  const state: DaemonState = {
    logFile: join(homedir(), "Library", "Logs", "Nova", "daemon.log"),
    gate: { paused: storedPause(db) },
    startedAt: Date.now(),
    lastCaptureAt: () =>
      (db.prepare("SELECT MAX(committed_at) t FROM memory_versions").get() as any).t ?? null,
    lastError: null,
    queued: () => (db.prepare("SELECT COUNT(*) c FROM memory_retry_queue WHERE parked_at IS NULL").get() as any).c,
    unreachableSince: () => reachability.since,
    networkUp: () => { reachability.retryNow(); drain(); },
    session,
    providerMode: mode,
  };
  const control = startControlServer(join(DIR, CONTROL_SOCKET_NAME), db, key, state, provider);
  console.error(`[nova] control socket -> ${join(DIR, CONTROL_SOCKET_NAME)}`);
  if (state.gate.paused) console.error("[nova] capture is paused (kept from before the restart); resume to read the screen");

  // Named in the log because the bundle and the checkout each have a capture,
  // and which one ran is the first question when capture misbehaves.
  const capture = resolveCaptureBin();
  if (capture.note) console.error(`[nova] ${capture.note}`);
  console.error(`[nova] capture -> ${capture.path}`);
  // OCR runs only when OCRGate finds AX unreadable, throttled per window.
  const proc = Bun.spawn([capture.path, "--emit"], { stdout: "pipe", stderr: "pipe" });
  void relayLines(proc.stderr);
  console.error(`[nova] capturing -> ${DB_PATH}`);

  // Clean shutdown. Without this, Ctrl-C orphaned nova-capture and would
  // now leave a stale socket for the next start to trip over. The shell's
  // supervisor sends SIGTERM and waits 3 s (spec §5) — this is what makes
  // that wait worth anything. Idempotent: both signals may arrive.
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.error(`[nova] ${signal}: stopping`);
    control.stop();
    releaseInstance(PIDFILE);
    proc.kill();
    // Give capture a moment to exit on SIGTERM, then leave regardless.
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Extraction runs on its own clock so a slow model never stalls ingest.
  // Its failures are the daemon's most likely error, so the most recent one
  // is kept for the socket's status.lastError — already summarised to one
  // readable line by drainQueue, so the shell shows it verbatim.
  // Retention (F5.4) is checked on the drain clock rather than its own
  // timer: a day-long timer drifts and dies with the process, while a check
  // against the last sweep's stored time cannot do either.
  const sweepIfDue = () => {
    if (!sweepDue(db)) return;
    try {
      const r = sweepRetention(db, key);
      console.error(`[forget] retention sweep: raw text removed from ${r.rawRemoved} capture(s), `
        + `deleted captures=${r.deleted.captures} memories=${r.deleted.memories} loops=${r.deleted.loops}`);
    } catch (e) {
      console.error(`[forget] retention sweep failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  sweepIfDue();

  setInterval(() => {
    sweepIfDue();
    drain();
  }, 15_000);

  await ingestStream(db, key, proc.stdout, state.gate);
  // Capture's stdout closed: it exited. Shut down so the supervisor sees a
  // clean exit and restarts us, rather than a daemon with no capture.
  shutdown("capture exited");
} else if (cmd === "search") {
  const { db, key } = await store();
  const q = process.argv.slice(3).join(" ");
  const { provider } = await resolveProvider(process.env, (c) => recordCall(db, c), { lockPath: SESSION_LOCK });
  const hits = await searchMemory(db, key, provider, q, { limit: 10 });
  for (const h of hits) {
    console.log(`${h.text}\n  ${new Date(h.at).toISOString().slice(0, 16)} · ${h.app} · ${h.url ?? h.windowTitle}\n`);
  }
  if (hits.length === 0) console.log("No matching memories.");
} else if (cmd === "status") {
  const { db } = await store();
  const one = (sql: string) => (db.prepare(sql).get() as any).c;
  console.log(`threads     ${one("SELECT COUNT(*) c FROM memory_threads")}`);
  console.log(`versions    ${one("SELECT COUNT(*) c FROM memory_versions")}`);
  console.log(`derivatives ${one("SELECT COUNT(*) c FROM memory_derivatives")}`);
  console.log(`embedded    ${one("SELECT COUNT(*) c FROM memory_derivative_embeddings")}`);
  console.log(`queued      ${one("SELECT COUNT(*) c FROM memory_retry_queue WHERE parked_at IS NULL")}`);
  console.log(`parked      ${one("SELECT COUNT(*) c FROM memory_retry_queue WHERE parked_at IS NOT NULL")}`);
} else if (cmd === "mcp") {
  const { db, key } = await store();
  // Logged like the daemon's own calls, so a query an MCP client sent shows in
  // Activity. recordCall swallows a busy store rather than fail the tool.
  // The same session store as the daemon, so a refresh here takes the shared
  // lock and MCP keeps working while the app is closed.
  const { provider } = await resolveProvider(process.env, (c) => recordCall(db, c), { lockPath: SESSION_LOCK });
  await serveMcp(db, key, provider);
} else if (cmd === "loops" || cmd === "done" || cmd === "snooze" || cmd === "dismiss"
        || cmd === "pause" || cmd === "resume" || cmd === "precision"
        || cmd === "exclude" || cmd === "exclusions" || cmd === "unexclude"
        || cmd === "calls" || cmd === "retry" || cmd === "forget") {
  // Every one of these talks to a running `nova start` over its control
  // socket. None opens the store: the daemon is the only process that does,
  // and these commands exist partly to prove that boundary works before the
  // Swift shell depends on it.
  const sock = join(DIR, CONTROL_SOCKET_NAME);
  const argv = process.argv.slice(3);
  const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  try {
    if (cmd === "loops") {
      const direction = flag("--direction") ?? "any";
      // `--limit abc` is NaN, which serialises to null and lets the server's
      // typeof check fall back to 20 — so the user asked for a broken limit
      // and silently got the default with exit 0. Exit 2 matches the
      // missing-id path below: the invocation itself was wrong.
      //
      // Two coercions have to be defeated to catch every bad form. A bare
      // `--limit` reads back as undefined from flag(), the same as an absent
      // flag, so presence is checked against argv instead; and Number("") is
      // 0 rather than NaN, so an empty value is rejected on its emptiness.
      const limitRaw = argv.includes("--limit") ? flag("--limit") ?? "" : undefined;
      if (limitRaw !== undefined && (limitRaw.trim() === "" || !Number.isFinite(Number(limitRaw)))) {
        console.error(`[nova] --limit must be a number, got ${JSON.stringify(limitRaw)}`);
        process.exit(2);
      }
      const limit = Number(limitRaw ?? 20);
      const loops = (await controlRequest(sock, "list_loops", { direction, limit })) as OpenLoop[];
      console.log(formatLoops(loops));
      for (const l of loops) console.log(`  id: ${l.id}`);
    } else if (cmd === "calls") {
      const limitRaw = argv.includes("-n") ? flag("-n") ?? "" : undefined;
      if (limitRaw !== undefined && (limitRaw.trim() === "" || !Number.isFinite(Number(limitRaw)))) {
        console.error(`[nova] -n must be a number, got ${JSON.stringify(limitRaw)}`);
        process.exit(2);
      }
      const { calls, totals } = (await controlRequest(
        sock, "list_calls", { limit: Number(limitRaw ?? 20) },
      )) as { calls: ProviderCall[]; totals: Record<string, CallTotal> };
      for (const t of ["chat", "embed"] as const) {
        const d = totals[t]!;
        console.log(`${t.padEnd(5)} ${d.calls} call(s), ${d.errors} error(s), `
          + `${d.items} item(s), ${d.inputChars.toLocaleString()} chars sent`);
      }
      if (calls.length > 0) console.log("");
      for (const c of calls) {
        const when = new Date(c.at).toLocaleTimeString();
        const mark = c.outcome === "ok" ? "ok " : "ERR";
        const detail = c.detail ? `  ${c.detail}` : "";
        console.log(`${when}  ${mark}  ${c.kind.padEnd(5)} ${c.provider} ${c.model}  `
          + `${c.items} item(s)  ${c.inputChars} chars  ${c.ms}ms${detail}`);
      }
      if (calls.length === 0) console.log("\nno calls recorded yet");
    } else if (cmd === "forget") {
      // nova forget (--all | --app <name> | --since <date> [--until <date>])
      //             [--clear-call-log] [--yes]
      // Counts first, then asks: the delete cannot be undone.
      const has = (name: string) => argv.includes(name);
      const when = (name: string): number | undefined => {
        if (!has(name)) return undefined;
        const v = flag(name) ?? "";
        const t = Date.parse(v);
        if (!Number.isFinite(t)) {
          console.error(`[nova] ${name} must be a date like 2026-10-01 or 2026-10-01T09:00, got ${JSON.stringify(v)}`);
          process.exit(2);
        }
        return t;
      };
      const picked = [has("--all"), has("--app"), has("--since")].filter(Boolean).length;
      if (picked !== 1) {
        console.error("[nova] usage: nova forget (--all | --app <name> | --since <date> [--until <date>]) "
          + "[--clear-call-log] [--yes]");
        process.exit(2);
      }
      if (has("--clear-call-log") && !has("--all")) {
        console.error("[nova] --clear-call-log only goes with --all");
        process.exit(2);
      }
      const raw: unknown = has("--all") ? { kind: "all" }
        : has("--app") ? { kind: "app", app: flag("--app") ?? "" }
        : { kind: "range", from: when("--since"), to: when("--until") ?? Date.now() };
      const scope = parseScope(raw);
      if (typeof scope === "string") { console.error(`[nova] ${scope}`); process.exit(2); }
      const n = (await controlRequest(sock, "count_for_delete", { scope }, 30_000)) as
        { captures: number; memories: number; loops: number };
      const what = describeScope(scope);
      console.log(`${what}: ${n.captures} capture(s), ${n.memories} memories, ${n.loops} loop(s)`);
      if (n.captures === 0 && n.loops === 0 && !has("--clear-call-log")) {
        console.log("nothing to delete");
      } else {
        const yes = has("--yes")
          || (prompt("This cannot be undone. Delete? [y/N]") ?? "").trim().toLowerCase() === "y";
        if (!yes) {
          console.log("nothing deleted");
        } else {
          const d = (await controlRequest(sock, "delete_data", {
            scope, clearCallLog: has("--clear-call-log"),
          }, 120_000)) as { captures: number; memories: number; loops: number };
          console.log(`deleted ${d.captures} capture(s), ${d.memories} memories, ${d.loops} loop(s)`);
          console.log("Memories already given to an AI app over MCP are outside Nova and are not recalled.");
        }
      }
    } else if (cmd === "retry") {
      // Lists what is parked, then re-queues all of it. Nothing to do is not
      // an error, but it is said rather than left silent.
      const { parked } = (await controlRequest(sock, "list_parked")) as
        { parked: { versionId: string; app: string; attempts: number; error: string | null }[] };
      if (parked.length === 0) {
        console.log("nothing parked");
      } else {
        for (const p of parked) {
          console.log(`${p.app}  ${p.attempts} attempt(s)  ${p.error ?? "-"}\n  version: ${p.versionId}`);
        }
        const { requeued } = (await controlRequest(sock, "retry_parked")) as { requeued: number };
        console.log(`\nre-queued ${requeued} capture(s); the next drain picks them up within 15 s`);
      }
    } else if (cmd === "exclusions") {
      const { exclusions } = (await controlRequest(sock, "list_exclusions")) as
        { exclusions: { id: string; kind: string; value: string }[] };
      if (exclusions.length === 0) console.log("no exclusions");
      for (const e of exclusions) console.log(`${e.kind.padEnd(7)} ${e.value}\n  id: ${e.id}`);
    } else if (cmd === "exclude") {
      // A domain unless told otherwise: a bare word is far more often an app
      // and a dotted string a site, but guessing either way would silently
      // store a rule that never matches. --app and --domain are explicit.
      const value = argv.find((a) => !a.startsWith("--")) ?? "";
      const kind = argv.includes("--app") ? "app" : argv.includes("--domain") ? "domain" : "";
      if (!value || !kind) {
        console.error("[nova] usage: nova exclude (--app <name> | --domain <host>)");
        process.exit(2);
      }
      const r = (await controlRequest(sock, "add_exclusion", { kind, value })) as
        { id: string; purged: { threads: number } };
      console.log(`excluded ${kind} ${value}`);
      if (r.purged.threads > 0) console.log(`removed ${r.purged.threads} already-captured thread(s)`);
    } else if (cmd === "unexclude") {
      const exclusionId = argv.find((a) => !a.startsWith("--")) ?? "";
      if (!exclusionId) {
        console.error("[nova] usage: nova unexclude <id>   (ids from `nova exclusions`)");
        process.exit(2);
      }
      await controlRequest(sock, "remove_exclusion", { exclusionId });
      console.log("removed");
    } else if (cmd === "precision") {
      const p = (await controlRequest(sock, "loop_precision")) as LoopPrecision;
      const pct = (real: number, notReal: number) =>
        real + notReal ? `${Math.round((100 * real) / (real + notReal))}%` : "—";
      console.log(`precision ${pct(p.real, p.notReal)}  (${p.real} real, ${p.notReal} not real)`);
      for (const [dir, d] of Object.entries(p.byDirection)) {
        console.log(`  ${dir.padEnd(11)} ${pct(d.real, d.notReal).padStart(4)}  (${d.real} real, ${d.notReal} not real)`);
      }
    } else if (cmd === "pause" || cmd === "resume") {
      const r = (await controlRequest(sock, cmd)) as { paused: boolean };
      console.log(r.paused ? "capture paused" : "capture resumed");
    } else {
      const id = argv[0];
      if (!id) { console.error(`usage: nova ${cmd} <loop-id>`); process.exit(2); }
      // Same treatment as --limit above, and for the same reason: Number of an
      // unparseable value is NaN, which serialises to null, so the server's
      // typeof check falls through to the default 09:00 while the CLI prints
      // "snoozed" as though the user's value had been honoured. A non-positive
      // value is rejected too — the server clamps a past timestamp to now+1ms,
      // so `--until 0` brought the loop straight back while reporting success,
      // and an epoch-millis timestamp of zero or less is never a real
      // "snooze until" anyway.
      const untilRaw = cmd === "snooze" && argv.includes("--until")
        ? flag("--until") ?? "" : undefined;
      if (untilRaw !== undefined
          && (untilRaw.trim() === "" || !Number.isFinite(Number(untilRaw)) || Number(untilRaw) <= 0)) {
        console.error(`[nova] --until must be a positive epoch-millis timestamp, got ${JSON.stringify(untilRaw)}`);
        process.exit(2);
      }
      const until = untilRaw !== undefined ? Number(untilRaw) : undefined;
      const r = (await controlRequest(sock, "act_on_loop", { loopId: id, action: cmd, until })) as { state: string };
      console.log(`${id}: ${r.state}`);
    }
  } catch (e) {
    // ControlUnavailable already says "is nova start running?"; a server-side
    // ok:false carries the loop's state. Either way, one line, exit 1.
    console.error(`[nova] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
} else if (cmd === "logs") {
  // Reads the file the shell's supervisor writes; `tail -F` follows it across
  // the supervisor reopening it on a daemon restart.
  const argv = process.argv.slice(3);
  const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const tag = flag("--tag");
  const lines = flag("-n") ?? "50";
  const opts = { color: process.stdout.isTTY === true && !process.env.NO_COLOR, dim: !argv.includes("--no-dim") };
  const file = join(homedir(), "Library", "Logs", "Nova", "daemon.log");
  const tail = Bun.spawn(["tail", "-n", lines, "-F", file], { stdout: "pipe", stderr: "inherit" });
  // tail would outlive us if only this process got the signal.
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => { tail.kill(); process.exit(0); });
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of tail.stdout) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (tag && parseLine(line).tag !== tag) continue;
      console.log(formatLine(line, opts));
    }
  }
} else {
  console.error("usage: nova start | search <query> | status | loops | done|snooze|dismiss <id> | retry | forget"
    + " | precision | calls | exclusions | exclude (--app <name>|--domain <host>) | unexclude <id>"
    + " | pause | resume | logs | mcp");
  process.exit(1);
}

function describeScope(s: DeleteScope): string {
  if (s.kind === "all") return "everything";
  if (s.kind === "app") return `everything from ${s.app}`;
  return `captures from ${new Date(s.from).toLocaleString()} to ${new Date(s.to).toLocaleString()}`;
}
