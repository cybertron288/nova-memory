import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkInstance, claimInstance, releaseInstance, isAlive, terminateInstance,
} from "../src/single-instance";

const dir = () => mkdtempSync(join(tmpdir(), "nova-instance-"));

test("no pidfile means this process may start", () => {
  const p = join(dir(), "daemon.pid");
  expect(checkInstance(p)).toEqual({ ok: true, stale: false });
});

test("a pidfile naming a live process refuses the start", () => {
  const p = join(dir(), "daemon.pid");
  // This test process is the most reliable live pid available.
  claimInstance(p, process.pid);
  expect(checkInstance(p)).toEqual({ ok: false, pid: process.pid });
});

test("a pidfile naming a dead process is stale, not a refusal", () => {
  const p = join(dir(), "daemon.pid");
  // A pid that cannot be running: the kernel reserves 0 and never assigns it
  // to a user process, so this is dead without having to kill anything.
  writeFileSync(p, "999999\n");
  expect(checkInstance(p)).toEqual({ ok: true, stale: true });
});

test("a malformed pidfile is stale rather than fatal", () => {
  const p = join(dir(), "daemon.pid");
  writeFileSync(p, "not-a-pid\n");
  // It cannot name a daemon to defer to, so refusing to start on it would
  // wedge the daemon behind a file nothing will ever clean up.
  expect(checkInstance(p)).toEqual({ ok: true, stale: true });
});

test("claim then release leaves no file behind", () => {
  const p = join(dir(), "daemon.pid");
  claimInstance(p);
  expect(readFileSync(p, "utf8").trim()).toBe(String(process.pid));
  releaseInstance(p);
  expect(existsSync(p)).toBe(false);
});

test("release leaves a pidfile that belongs to another process", () => {
  const p = join(dir(), "daemon.pid");
  // The supervisor-restart case: a replacement daemon has already claimed the
  // file by the time the old one's shutdown runs. Deleting it here would leave
  // the live daemon unprotected.
  claimInstance(p, 4242);
  releaseInstance(p, process.pid);
  expect(existsSync(p)).toBe(true);
  expect(readFileSync(p, "utf8").trim()).toBe("4242");
});

test("isAlive rejects values that are not pids", () => {
  expect(isAlive(0)).toBe(false);
  expect(isAlive(-1)).toBe(false);
  expect(isAlive(Number.NaN)).toBe(false);
});

test("terminateInstance reports success for a pid that is already gone", async () => {
  expect(await terminateInstance(999999, 200)).toBe(true);
});

test("terminateInstance stops a real process", async () => {
  const child = Bun.spawn(["sleep", "30"], { stdout: "ignore", stderr: "ignore" });
  expect(isAlive(child.pid)).toBe(true);
  expect(await terminateInstance(child.pid, 2000)).toBe(true);
  expect(isAlive(child.pid)).toBe(false);
});
