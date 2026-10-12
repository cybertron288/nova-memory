import { test, expect } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

/**
 * Runs the CLI in a throwaway HOME, so the Nova support directory it derives
 * from homedir() is empty and anything that appears in it was created by this
 * run. node:os homedir() reads HOME on darwin, which is what makes this work.
 */
function runCli(args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "nova-cli-home-"));
  const proc = Bun.spawnSync([process.execPath, "run", CLI, ...args], {
    env: { ...process.env, HOME: home },
    stdout: "pipe", stderr: "pipe",
  });
  return {
    home,
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    dbExists: existsSync(join(home, "Library", "Application Support", "Nova", "memory.db")),
  };
}

test("a control-socket subcommand never opens the store", () => {
  // The README's claim, and the architecture's central invariant: the daemon
  // is the only process that opens the store. With no daemon running, `loops`
  // must fail on the missing socket and leave no database behind — not do a
  // write-capable SQLCipher open (PRAGMA key, WAL, DDL) first.
  const r = runCli(["loops"]);
  expect(r.dbExists).toBe(false);
  expect(r.code).toBe(1);
  expect(r.stderr).toContain("nova start");
});

test("the usage branch never opens the store either", () => {
  const r = runCli(["nonsense"]);
  expect(r.dbExists).toBe(false);
  expect(r.code).toBe(1);
  expect(r.stderr).toContain("usage:");
});

test("loops rejects a --limit that is not a number instead of silently using 20", () => {
  // Number("abc") is NaN, which serialises to null over the wire, and the
  // server's typeof check then falls back to 20 — so the user asked for a
  // broken limit and got the default with exit 0. Exit 2 matches the
  // missing-id path: the invocation itself was wrong.
  const r = runCli(["loops", "--limit", "abc"]);
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("--limit");
  expect(r.stdout).toBe("");
});

test("a bare --limit with no value is rejected too", () => {
  const r = runCli(["loops", "--limit"]);
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("--limit");
});

test("an absent --limit is still fine and reaches the socket", () => {
  const r = runCli(["loops"]);
  expect(r.code).toBe(1);
  expect(r.stderr).toContain("nova start");
});

test("snooze rejects an --until that is not a number instead of silently using 09:00", () => {
  // Same bug class as --limit above, which this branch already closed; --until
  // was simply missed. Number("tomorrow") is NaN, which serialises to null, so
  // the server's `typeof === "number"` check falls through and the default
  // 09:00 is applied — while the CLI prints "snoozed" as though the user's own
  // value had been honoured.
  const r = runCli(["snooze", "loop-1", "--until", "tomorrow"]);
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("--until");
  expect(r.stdout).toBe("");
  // Rejected client-side, so it must not have reached the store either.
  expect(r.dbExists).toBe(false);
});

test("a bare --until with no value is rejected too", () => {
  const r = runCli(["snooze", "loop-1", "--until"]);
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("--until");
});

test("an empty --until is rejected, since Number('') is 0 rather than NaN", () => {
  const r = runCli(["snooze", "loop-1", "--until", ""]);
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("--until");
});

test("a non-positive --until is rejected rather than clamped to now+1ms", () => {
  // The server clamps a past timestamp to now+1ms, so `--until 0` made the
  // loop reappear immediately while the CLI still reported success. An epoch
  // -millis timestamp of zero or below is never a real "snooze until".
  for (const v of ["0", "-1"]) {
    const r = runCli(["snooze", "loop-1", "--until", v]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--until");
  }
});

test("an absent --until is still fine and reaches the socket", () => {
  // The default-09:00 path is the common case and must keep working: it fails
  // on the missing socket, not on validation.
  const r = runCli(["snooze", "loop-1"]);
  expect(r.code).toBe(1);
  expect(r.stderr).toContain("nova start");
});
