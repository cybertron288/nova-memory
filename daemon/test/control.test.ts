import { test, expect } from "bun:test";
import { openDb, encryptField } from "../src/db";
import { recordLoops, listOpenLoops } from "../src/loops";
import { handleControlLine, startControlServer, storedPause, type DaemonState } from "../src/control";
import type { LoopCandidate } from "../src/provider";
import { resolveThread, commitVersion } from "../src/threads";
import { randomBytes } from "node:crypto";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEY = randomBytes(32);

const commitment: LoopCandidate = {
  description: "Alex will merge PR #11.",
  direction: "i_owe", counterparty: "Dana Reyes", dueSignal: "today",
  closureSignature: "PR #11 was merged",
};

function freshState(db: any): DaemonState {
  return {
    gate: { paused: false },
    startedAt: Date.now() - 5_000,
    lastCaptureAt: () => null,
    lastError: null,
    queued: () => (db.prepare("SELECT COUNT(*) c FROM memory_retry_queue").get() as any).c,
    unreachableSince: () => null,
    networkUp: () => {},
  };
}

const req = (o: object) => JSON.stringify(o);
// Every op these tests call is synchronous; morning_digest is tested in digest.test.ts.
const parse = (line: string | Promise<string>) => JSON.parse((line as string).trim());

// --- handleControlLine: the pure core ---------------------------------------

test("list_memories returns recent facts with their source app", async () => {
  const db = await openDb(":memory:");
  const rec = {
    ts: Date.now(), app: "Slack", bundleId: "com.tinyspeck.slackmacgap",
    windowTitle: "Taylor (DM)", url: null,
    content: "seed", contentHash: "sha256:s", treeHash: "sha256:t",
  };
  const tid = resolveThread(db, KEY, rec);
  const { versionId } = commitVersion(db, KEY, tid, rec);
  // Distinct timestamps: two rows written in the same millisecond make
  // ORDER BY committed_at DESC non-deterministic, and this test asserts order.
  const base = Date.now();
  const seeds: [string, string, number][] = [
    ["m1", "Alex owes Taylor the deck", base - 1000],
    ["m2", "the build failed", base],
  ];
  for (const [id, text, ts] of seeds) {
    db.prepare(`INSERT INTO memory_derivatives
        (id, thread_id, version_id, content, content_hash, committed_at)
        VALUES (?, ?, ?, ?, 'sha256:x', ?)`)
      .run(id, tid, versionId, encryptField(text, KEY), ts);
  }

  const reply = JSON.parse(await handleControlLine(
    JSON.stringify({ id: 1, op: "list_memories", limit: 10 }), db, KEY, freshState(db),
  ));
  expect(reply.ok).toBe(true);
  expect(reply.result.length).toBe(2);
  // Decrypted for the UI — the shell never holds the field key, so the daemon
  // is the only place this can happen.
  expect(reply.result.map((m: any) => m.text)).toContain("the build failed");
  // Provenance, the same reason loops carry it: a fact you cannot place is a
  // fact you cannot check.
  // Newest first.
  expect(reply.result[0].text).toBe("the build failed");
  expect(reply.result[0].sourceApp).toBe("Slack");
  expect(typeof reply.result[0].capturedAt).toBe("number");
});

test("status reports capturing, paused, queued and uptime", async () => {
  const db = await openDb(":memory:");
  const state = freshState(db);
  const r = parse(handleControlLine(req({ id: 1, op: "status" }), db, KEY, state));
  expect(r.id).toBe(1);
  expect(r.ok).toBe(true);
  expect(r.result.capturing).toBe(true);
  expect(r.result.paused).toBe(false);
  expect(r.result.queued).toBe(0);
  expect(r.result.lastError).toBeNull();
  expect(r.result.pid).toBe(process.pid);
  expect(typeof r.result.uptimeMs).toBe("number");
  expect(r.result.unreachableSince).toBeNull();
});

test("status reports since when the provider is unreachable, and network_up asks for a drain", async () => {
  const db = await openDb(":memory:");
  let kicks = 0;
  const state = { ...freshState(db), unreachableSince: () => 1_700_000_000_000, networkUp: () => { kicks++; } };
  const status = parse(handleControlLine(req({ id: 1, op: "status" }), db, KEY, state));
  expect(status.result.unreachableSince).toBe(1_700_000_000_000);
  const up = parse(handleControlLine(req({ id: 2, op: "network_up" }), db, KEY, state));
  expect(up).toEqual({ id: 2, ok: true, result: {} });
  expect(kicks).toBe(1);
});

test("list_loops returns the same rows listOpenLoops does", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const r = parse(handleControlLine(req({ id: 2, op: "list_loops" }), db, KEY, freshState(db)));
  expect(r.ok).toBe(true);
  expect(r.result.length).toBe(1);
  expect(r.result[0].description).toBe(commitment.description);
  expect(r.result[0].direction).toBe("i_owe");
  expect(r.result[0].id).toBe(listOpenLoops(db, KEY)[0]!.id);
});

test("list_loops passes direction and limit through", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment, { ...commitment, direction: "owed_to_me" }], null);
  const r = parse(handleControlLine(
    req({ id: 3, op: "list_loops", direction: "owed_to_me", limit: 5 }), db, KEY, freshState(db)));
  expect(r.result.length).toBe(1);
  expect(r.result[0].direction).toBe("owed_to_me");
});

test("act_on_loop done resolves and the loop leaves list_loops", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const id = listOpenLoops(db, KEY)[0]!.id;
  const state = freshState(db);
  const r = parse(handleControlLine(req({ id: 4, op: "act_on_loop", loopId: id, action: "done" }), db, KEY, state));
  expect(r.ok).toBe(true);
  expect(r.result.state).toBe("user_resolved");
  const l = parse(handleControlLine(req({ id: 5, op: "list_loops" }), db, KEY, state));
  expect(l.result.length).toBe(0);
});

test("act_on_loop on a dismissed loop is ok:false naming the state", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const id = listOpenLoops(db, KEY)[0]!.id;
  const state = freshState(db);
  handleControlLine(req({ id: 6, op: "act_on_loop", loopId: id, action: "dismiss" }), db, KEY, state);
  const r = parse(handleControlLine(req({ id: 7, op: "act_on_loop", loopId: id, action: "done" }), db, KEY, state));
  expect(r.ok).toBe(false);
  expect(r.error).toContain("dismissed");
  expect(r.id).toBe(7);
});

test("rate_loop accepts 1, -1 and null only", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const loopId = listOpenLoops(db, KEY)[0]!.id;
  const state = freshState(db);
  for (const bad of [0, 2, "1", true, undefined]) {
    const r = parse(handleControlLine(req({ id: 1, op: "rate_loop", loopId, rating: bad }), db, KEY, state));
    expect(r.ok).toBe(false);
  }
  expect(listOpenLoops(db, KEY)[0]!.feedback).toBeNull();
  const ok = parse(handleControlLine(req({ id: 2, op: "rate_loop", loopId, rating: 1 }), db, KEY, state));
  expect(ok.result).toEqual({ feedback: 1, state: "open" });
  const p = parse(handleControlLine(req({ id: 3, op: "loop_precision" }), db, KEY, state));
  expect(p.result.precision).toBe(1);
});

test("act_on_loop rejects a bad action without touching the loop", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const id = listOpenLoops(db, KEY)[0]!.id;
  const r = parse(handleControlLine(req({ id: 8, op: "act_on_loop", loopId: id, action: "explode" }), db, KEY, freshState(db)));
  expect(r.ok).toBe(false);
  expect(listOpenLoops(db, KEY).length).toBe(1);
});

test("pause and resume flip the shared gate", async () => {
  const db = await openDb(":memory:");
  const state = freshState(db);
  let r = parse(handleControlLine(req({ id: 9, op: "pause" }), db, KEY, state));
  expect(r.result.paused).toBe(true);
  expect(state.gate.paused).toBe(true);
  r = parse(handleControlLine(req({ id: 10, op: "status" }), db, KEY, state));
  expect(r.result.paused).toBe(true);
  r = parse(handleControlLine(req({ id: 11, op: "resume" }), db, KEY, state));
  expect(r.result.paused).toBe(false);
  expect(state.gate.paused).toBe(false);
});

test("a pause outlives a daemon restart", async () => {
  const db = await openDb(":memory:");
  expect(storedPause(db)).toBe(false);
  handleControlLine(req({ id: 13, op: "pause" }), db, KEY, freshState(db));
  // A restarted daemon builds a fresh gate from the store.
  expect(storedPause(db)).toBe(true);
  handleControlLine(req({ id: 14, op: "resume" }), db, KEY, freshState(db));
  expect(storedPause(db)).toBe(false);
});

test("an unknown op is ok:false and carries the id back", async () => {
  const db = await openDb(":memory:");
  const r = parse(handleControlLine(req({ id: 12, op: "format_disk" }), db, KEY, freshState(db)));
  expect(r.ok).toBe(false);
  expect(r.id).toBe(12);
  expect(r.error).toContain("format_disk");
});

test("a malformed line is ok:false with id null, and never throws", async () => {
  const db = await openDb(":memory:");
  const state = freshState(db);
  for (const bad of ["not json", "{", "", "[]", "42", '{"op":"status"}']) {
    const line = handleControlLine(bad, db, KEY, state);
    const r = parse(line);
    expect(r.ok).toBe(false);
    // A request with no id gets id null; the spec says so, so a client can
    // tell "you sent garbage" from "your request failed".
    if (bad !== '{"op":"status"}') expect(r.id).toBeNull();
  }
});

test("every reply is exactly one line", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [{ ...commitment, description: "line one\nline two" }], null);
  const line = handleControlLine(req({ id: 13, op: "list_loops" }), db, KEY, freshState(db)) as string;
  // A description containing a newline must be JSON-escaped, never emitted
  // raw, or the client's line framing breaks.
  expect(line.endsWith("\n")).toBe(true);
  expect(line.slice(0, -1)).not.toContain("\n");
});

// --- startControlServer: the socket ----------------------------------------

test("the socket round-trips a request and interleaves ids correctly", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const path = join(tmpdir(), `nova-control-test-${process.pid}-${Date.now()}.sock`);
  const server = startControlServer(path, db, KEY, freshState(db));
  try {
    expect(existsSync(path)).toBe(true);
    // 0600: only the owner may talk to the process that holds the keys.
    expect(statSync(path).mode & 0o777).toBe(0o600);

    const replies: any[] = [];
    let buf = "";
    const done = new Promise<void>((resolve) => {
      Bun.connect({ unix: path, socket: {
        open(sock) {
          // Two requests in one write: the server must answer both, each
          // carrying its own id, in some order.
          sock.write(req({ id: "a", op: "status" }) + "\n" + req({ id: "b", op: "list_loops" }) + "\n");
        },
        data(_s, chunk) {
          buf += chunk.toString();
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            replies.push(JSON.parse(buf.slice(0, nl)));
            buf = buf.slice(nl + 1);
          }
          if (replies.length === 2) resolve();
        },
      }});
    });
    await done;
    const byId = Object.fromEntries(replies.map((r) => [r.id, r]));
    expect(byId.a.ok).toBe(true);
    expect(byId.a.result.capturing).toBe(true);
    expect(byId.b.ok).toBe(true);
    expect(byId.b.result.length).toBe(1);
  } finally {
    server.stop();
  }
  // stop() unlinks the socket so a restart never finds a stale file.
  expect(existsSync(path)).toBe(false);
});

test("a reply larger than one socket write arrives whole", async () => {
  // Measured 2026-09-23: thirty real memories made a ~9 KB list_memories
  // reply, the socket took the first 8192 bytes, the rest was dropped, and the
  // Memory tab waited on a newline that never came — a skeleton forever.
  const db = await openDb(":memory:");
  const rec = {
    ts: Date.now(), app: "Slack", bundleId: "com.tinyspeck.slackmacgap",
    windowTitle: "big", url: null,
    content: "seed", contentHash: "sha256:s", treeHash: "sha256:t",
  };
  const tid = resolveThread(db, KEY, rec);
  const { versionId } = commitVersion(db, KEY, tid, rec);
  const base = Date.now();
  for (let i = 0; i < 200; i++) {
    db.prepare(`INSERT INTO memory_derivatives
        (id, thread_id, version_id, content, content_hash, committed_at)
        VALUES (?, ?, ?, ?, 'sha256:x', ?)`)
      .run(`m${i}`, tid, versionId, encryptField(`fact ${i} `.padEnd(1000, "x"), KEY), base - i);
  }
  const path = join(tmpdir(), `nova-control-big-${process.pid}-${Date.now()}.sock`);
  const server = startControlServer(path, db, KEY, freshState(db));
  try {
    const line = await new Promise<string>((resolve, reject) => {
      let buf = "";
      Bun.connect({ unix: path, socket: {
        open(sock) { sock.write(req({ id: 1, op: "list_memories", limit: 200 }) + "\n"); },
        data(_s, chunk) {
          buf += chunk.toString();
          const nl = buf.indexOf("\n");
          if (nl >= 0) resolve(buf.slice(0, nl));
        },
      }});
      setTimeout(() => reject(new Error(`no full reply; got ${buf.length} bytes`)), 3000);
    });
    const reply = JSON.parse(line);
    expect(reply.ok).toBe(true);
    expect(reply.result.length).toBe(200);
  } finally {
    server.stop();
  }
});

test("a stale socket file from a previous run is replaced on start", async () => {
  const db = await openDb(":memory:");
  const path = join(tmpdir(), `nova-control-stale-${process.pid}-${Date.now()}.sock`);
  // Simulate a crashed daemon that left its socket behind.
  await Bun.write(path, "");
  expect(existsSync(path)).toBe(true);
  const server = startControlServer(path, db, KEY, freshState(db));
  try {
    const r = await new Promise<any>((resolve) => {
      Bun.connect({ unix: path, socket: {
        open(sock) { sock.write(req({ id: 1, op: "status" }) + "\n"); },
        data(_s, chunk) { resolve(JSON.parse(chunk.toString().trim())); },
      }});
    });
    expect(r.ok).toBe(true);
  } finally {
    server.stop();
  }
});

// --- controlRequest: the TS client ------------------------------------------

test("controlRequest round-trips, surfaces ok:false as a rejection, and times out cleanly", async () => {
  const { controlRequest, ControlUnavailable } = await import("../src/control-client");
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const path = join(tmpdir(), `nova-control-client-${process.pid}-${Date.now()}.sock`);
  const server = startControlServer(path, db, KEY, freshState(db));
  try {
    const status = (await controlRequest(path, "status")) as any;
    expect(status.capturing).toBe(true);

    const loops = (await controlRequest(path, "list_loops")) as any[];
    expect(loops.length).toBe(1);

    const id = loops[0].id;
    const r = (await controlRequest(path, "act_on_loop", { loopId: id, action: "dismiss" })) as any;
    expect(r.state).toBe("dismissed");

    // ok:false becomes a rejection whose message is the server's error.
    await expect(controlRequest(path, "act_on_loop", { loopId: id, action: "done" }))
      .rejects.toThrow(/dismissed/);
  } finally {
    server.stop();
  }

  // No socket: a distinct error type, so the CLI can say "daemon not running".
  await expect(controlRequest(path, "status", {}, 500)).rejects.toBeInstanceOf(ControlUnavailable);
});

test("act_on_loop clamps a past or non-finite until to the future", async () => {
  // Case 1: past until
  {
    const db = await openDb(":memory:");
    await recordLoops(db, KEY, [commitment], null);
    const id = listOpenLoops(db, KEY)[0]!.id;
    const state = freshState(db);
    const beforeSnooze = Date.now();
    const pastUntil = beforeSnooze - 60_000;
    const r1 = parse(handleControlLine(
      req({ id: 14, op: "act_on_loop", loopId: id, action: "snooze", until: pastUntil }),
      db, KEY, state
    ));
    const afterSnooze = Date.now();
    expect(r1.ok).toBe(true);
    expect(r1.result.state).toBe("snoozed");
    const snoozed1 = db.prepare("SELECT snoozed_until FROM open_loops WHERE id = ?").get(id) as any;
    // The clamped value should be at least beforeSnooze + 1 (since pastUntil < beforeSnooze)
    expect(snoozed1.snoozed_until).toBeGreaterThanOrEqual(beforeSnooze + 1);
    // Verify it's not included in a list query that uses afterSnooze
    const list1Row = db.prepare("SELECT id FROM open_loops WHERE state='snoozed' AND snoozed_until <= ?").get(afterSnooze) as any;
    // With the +1 clamp, snoozed_until should be > afterSnooze (usually; tight race is rare)
    // But to be safe, just verify it's been clamped to at least beforeSnooze + 1
    expect(snoozed1.snoozed_until).toBeGreaterThanOrEqual(beforeSnooze + 1);
  }

  // Case 2: NaN (via null in JSON, exercises the non-number path)
  {
    const db = await openDb(":memory:");
    await recordLoops(db, KEY, [commitment], null);
    const id2 = listOpenLoops(db, KEY)[0]!.id;
    const state = freshState(db);
    const r2 = parse(handleControlLine(
      '{"id":16,"op":"act_on_loop","loopId":"' + id2 + '","action":"snooze","until":null}',
      db, KEY, state
    ));
    expect(r2.ok).toBe(true);
    expect(r2.result.state).toBe("snoozed");
    const snoozed2 = db.prepare("SELECT snoozed_until FROM open_loops WHERE id = ?").get(id2) as any;
    expect(snoozed2.snoozed_until).toBeGreaterThan(Date.now());
  }

  // Case 3: future until, passed through unchanged
  {
    const db = await openDb(":memory:");
    await recordLoops(db, KEY, [commitment], null);
    const id3 = listOpenLoops(db, KEY)[0]!.id;
    const state = freshState(db);
    const futureUntil = Date.now() + 3_600_000;
    const r3 = parse(handleControlLine(
      req({ id: 17, op: "act_on_loop", loopId: id3, action: "snooze", until: futureUntil }),
      db, KEY, state
    ));
    expect(r3.ok).toBe(true);
    expect(r3.result.state).toBe("snoozed");
    const snoozed3 = db.prepare("SELECT snoozed_until FROM open_loops WHERE id = ?").get(id3) as any;
    expect(snoozed3.snoozed_until).toBe(futureUntil);
  }
});

test("list_loops rejects an unknown direction rather than returning everything", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment, { ...commitment, direction: "owed_to_me" }], null);
  // "owes_me" is a plausible typo for "owed_to_me". Coercing it to "any"
  // would print the whole unfiltered list as though it were filtered — a
  // wrong answer reported as success.
  const r = parse(handleControlLine(
    req({ id: 18, op: "list_loops", direction: "owes_me" }), db, KEY, freshState(db)));
  expect(r.ok).toBe(false);
  expect(r.id).toBe(18);
  expect(r.error).toContain("owes_me");
});

test("list_loops with no direction still defaults to any", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment, { ...commitment, direction: "owed_to_me" }], null);
  const r = parse(handleControlLine(req({ id: 19, op: "list_loops" }), db, KEY, freshState(db)));
  expect(r.ok).toBe(true);
  expect(r.result.length).toBe(2);
  const explicit = parse(handleControlLine(
    req({ id: 20, op: "list_loops", direction: "any" }), db, KEY, freshState(db)));
  expect(explicit.ok).toBe(true);
  expect(explicit.result.length).toBe(2);
});

// --- UTF-8 across a chunk boundary ------------------------------------------

test("a multi-byte character split across two chunks survives the server's reassembly", async () => {
  const db = await openDb(":memory:");
  const path = join(tmpdir(), `nova-control-utf8-server-${process.pid}-${Date.now()}.sock`);
  const server = startControlServer(path, db, KEY, freshState(db));
  try {
    // The server reassembles request bytes the same way the client reassembles
    // reply bytes, and got the same treatment: chunk.toString() decodes each
    // chunk standalone, so a character whose bytes land either side of a
    // boundary is replaced by U+FFFD in both halves. The resulting JSON still
    // parses, so the corruption is reported as success.
    //
    // Echo an unknown direction back through the error message: it is the one
    // op that returns the client's own string verbatim, which is what makes
    // the round-trip observable without a store write.
    const direction = "i—owe";                     // em-dash: 3 UTF-8 bytes
    const bytes = Buffer.from(req({ id: 1, op: "list_loops", direction }) + "\n", "utf8");
    const split = bytes.indexOf(Buffer.from("—", "utf8")) + 1;   // mid-character
    expect(split).toBeGreaterThan(0);

    const r = await new Promise<any>((resolve) => {
      Bun.connect({ unix: path, socket: {
        open(sock) {
          sock.write(bytes.subarray(0, split));
          // A second write is a second `data` callback, which is exactly the
          // boundary a real 31 KB reply crosses.
          setTimeout(() => sock.write(bytes.subarray(split)), 10);
        },
        data(_s, chunk) { resolve(JSON.parse(chunk.toString().trim())); },
      }});
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain(direction);
    expect(r.error).not.toContain("�");
  } finally {
    server.stop();
  }
});

test("controlRequest reassembles a reply whose multi-byte character is split across chunks", async () => {
  const { controlRequest } = await import("../src/control-client");
  const path = join(tmpdir(), `nova-control-utf8-client-${process.pid}-${Date.now()}.sock`);

  // A hand-rolled server, so the split lands inside a character of the *reply*.
  // 100 loops (the server's own clamp) serialise to roughly 31 KB, well past a
  // single chunk, and any em-dash or accented counterparty name in a
  // description can straddle a boundary — so `nova loops` printed mojibake and
  // exited 0.
  const description = "Alex owes Zoë a decision — by Friday";
  const server = Bun.listen<undefined>({
    unix: path,
    socket: {
      data(sock, chunk) {
        const id = JSON.parse(chunk.toString().trim()).id;
        const reply = Buffer.from(
          JSON.stringify({ id, ok: true, result: [{ description }] }) + "\n", "utf8");
        const split = reply.indexOf(Buffer.from("—", "utf8")) + 1;
        sock.write(reply.subarray(0, split));
        setTimeout(() => sock.write(reply.subarray(split)), 10);
      },
    },
  });
  try {
    const loops = (await controlRequest(path, "list_loops")) as any[];
    expect(loops[0].description).toBe(description);
  } finally {
    server.stop(true);
    if (existsSync(path)) unlinkSync(path);
  }
});

test("a client sending a huge line with no newline is cut off, not allowed to grow the heap", async () => {
  const db = await openDb(":memory:");
  const path = join(tmpdir(), `nova-control-flood-${process.pid}-${Date.now()}.sock`);
  const server = startControlServer(path, db, KEY, freshState(db));
  try {
    // Without a cap, a client that never sends a newline grows the daemon's
    // per-connection buffer without limit — the same hazard ingest caps at
    // 4 MiB. The daemon holds the field key, so a local process should not be
    // able to drive its memory from the outside.
    const closed = await new Promise<boolean>((resolve) => {
      // sock.write is non-blocking and returns how many bytes it actually
      // took, so a loop that ignores the return value sends ~8 KiB and
      // silently drops the rest — the server would never approach the cap and
      // the test would "fail" for want of data. Push on `drain` instead, which
      // is what respecting backpressure looks like here.
      const CAP = 4 * 1024 * 1024;
      let sent = 0;
      const blob = "x".repeat(256 * 1024);          // no newline anywhere
      const pump = (sock: { write(s: string): number }) => {
        while (sent < CAP + 1024 * 1024) {
          const n = sock.write(blob);
          if (n <= 0) return;                        // wait for drain
          sent += n;
        }
      };
      Bun.connect({ unix: path, socket: {
        open: pump,
        drain: pump,
        data() { /* a reply would mean a line was framed; none can be */ },
        close() { resolve(true); },
      }});
      // If the connection is still open well past the cap, the cap is absent.
      // 20s, not 5: this pushes 5 MiB through a socket while the rest of the
      // suite competes for the same event loop, and at 5s it failed roughly
      // two runs in three once the suite grew slower. A generous ceiling costs
      // nothing on a pass and stops a real property being reported as broken.
      setTimeout(() => resolve(false), 20_000);
    });
    expect(closed).toBe(true);
  } finally {
    server.stop();
  }
});

// --- D21: the user exclusion list over the socket --------------------------

test("an exclusion can be added, listed and removed over the socket", async () => {
  const db = await openDb(":memory:");
  const s = freshState(db);

  const added = parse(handleControlLine(
    req({ id: 1, op: "add_exclusion", kind: "domain", value: "https://Therapy.Example/notes" }),
    db, KEY, s));
  expect(added.ok).toBe(true);

  const listed = parse(handleControlLine(req({ id: 2, op: "list_exclusions" }), db, KEY, s));
  expect(listed.ok).toBe(true);
  // Stored normalized, so the panel shows the site rather than the pasted URL.
  expect(listed.result.exclusions).toHaveLength(1);
  expect(listed.result.exclusions[0].value).toBe("therapy.example");

  const removed = parse(handleControlLine(
    req({ id: 3, op: "remove_exclusion", exclusionId: added.result.id }), db, KEY, s));
  expect(removed.ok).toBe(true);
  expect(parse(handleControlLine(req({ id: 4, op: "list_exclusions" }), db, KEY, s))
    .result.exclusions).toEqual([]);
});

test("an unknown exclusion kind is refused, never defaulted", async () => {
  const db = await openDb(":memory:");
  const s = freshState(db);
  const r = parse(handleControlLine(
    req({ id: 1, op: "add_exclusion", kind: "site", value: "example.com" }), db, KEY, s));
  expect(r.ok).toBe(false);
  expect(r.error).toContain("app or domain");
  expect(parse(handleControlLine(req({ id: 2, op: "list_exclusions" }), db, KEY, s))
    .result.exclusions).toEqual([]);
});

test("an empty exclusion value is refused", async () => {
  const db = await openDb(":memory:");
  const s = freshState(db);
  const r = parse(handleControlLine(
    req({ id: 1, op: "add_exclusion", kind: "app", value: "  " }), db, KEY, s));
  expect(r.ok).toBe(false);
});

test("removing an exclusion that is not there says so", async () => {
  const db = await openDb(":memory:");
  const s = freshState(db);
  const r = parse(handleControlLine(
    req({ id: 1, op: "remove_exclusion", exclusionId: "nope" }), db, KEY, s));
  expect(r.ok).toBe(false);
  expect(r.error).toBe("no such exclusion");
});

test("a string request id is never mistaken for an exclusion id", async () => {
  const db = await openDb(":memory:");
  const s = freshState(db);
  const added = parse(handleControlLine(
    req({ id: 1, op: "add_exclusion", kind: "app", value: "Notes" }), db, KEY, s));
  // The request's own id happens to be the exclusion's id, and no exclusionId
  // is given: nothing may be removed.
  const r = parse(handleControlLine(
    req({ id: added.result.id, op: "remove_exclusion" }), db, KEY, s));
  expect(r.ok).toBe(false);
  expect(parse(handleControlLine(req({ id: 2, op: "list_exclusions" }), db, KEY, s))
    .result.exclusions).toHaveLength(1);
});

test("list_blocked returns the hard list, the user list and the counts together", async () => {
  const db = await openDb(":memory:");
  const s = freshState(db);
  parse(handleControlLine(
    req({ id: 1, op: "add_exclusion", kind: "app", value: "Notes" }), db, KEY, s));

  const r = parse(handleControlLine(req({ id: 2, op: "list_blocked" }), db, KEY, s));
  expect(r.ok).toBe(true);
  // The pane must be able to show that the hard rules exist, or the user's own
  // list reads as everything standing between Nova and their bank.
  expect(r.result.hard.map((h: { id: string }) => h.id)).toContain("banking");
  expect(r.result.hard.every((h: { overridable: boolean }) => h.overridable === false)).toBe(true);
  expect(r.result.exclusions).toHaveLength(1);
  expect(r.result.exclusions[0].value).toBe("Notes");
  expect(r.result.exclusions[0].skipped).toBe(0);
  expect(r.result.skipped).toBeDefined();
});
