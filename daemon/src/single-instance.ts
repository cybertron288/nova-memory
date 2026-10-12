/**
 * One daemon per store (D18).
 *
 * `startControlServer` unlinks any existing socket before binding, which is
 * correct — a crashed daemon leaves a stale socket, and without the unlink
 * every restart after a crash fails with EADDRINUSE. The side effect is that a
 * second `nova start` does not fail. It takes the socket, and the first daemon
 * keeps running unreachable: two capture children, one store, double the
 * extraction cost.
 *
 * The consequence that decides the design is `pause`. With two daemons it
 * pauses whichever one answers the socket and leaves the other capturing, so a
 * user who pauses because something sensitive is on screen is told capture
 * stopped when it did not. That is a privacy failure and it is silent, which
 * is why a second daemon is refused rather than tolerated.
 *
 * A pidfile rather than a lock. A lock released on process death reads cleaner
 * but behaves differently across SIGKILL and network filesystems, and a pid can
 * be probed, which is what lets the refusal name who holds the daemon instead
 * of saying "locked".
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";

export const PIDFILE_NAME = "daemon.pid";

/** Why a start attempt was refused, or that it may proceed. */
export type InstanceCheck =
  | { ok: true; stale: boolean }
  | { ok: false; pid: number };

/**
 * True when a process with this pid exists and we may signal it.
 *
 * Signal 0 performs the permission and existence checks without delivering
 * anything. EPERM means the process exists but belongs to another user, which
 * still counts as alive: refusing is safer than assuming a stale file and
 * starting a second daemon.
 */
export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Decides whether this process may become the daemon.
 *
 * A pidfile naming a live process refuses the start. A pidfile naming a dead
 * one is stale — the daemon was killed without running its shutdown — so it is
 * reported as stale and the caller may proceed. An unreadable or malformed file
 * is treated as stale for the same reason: it cannot name a daemon to defer to.
 */
export function checkInstance(path: string): InstanceCheck {
  if (!existsSync(path)) return { ok: true, stale: false };
  let pid: number;
  try {
    pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
  } catch {
    return { ok: true, stale: true };
  }
  if (!isAlive(pid)) return { ok: true, stale: true };
  return { ok: false, pid };
}

/** Records this process as the daemon. Overwrites a stale file. */
export function claimInstance(path: string, pid: number = process.pid): void {
  writeFileSync(path, `${pid}\n`, "utf8");
}

/**
 * Removes the pidfile, if it still names this process.
 *
 * The ownership check matters during a supervisor restart: a replacement daemon
 * may already have claimed the file by the time this one's shutdown runs, and
 * deleting the file then would leave the live daemon unprotected.
 */
export function releaseInstance(path: string, pid: number = process.pid): void {
  try {
    if (!existsSync(path)) return;
    const held = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    if (held === pid) unlinkSync(path);
  } catch {
    // Releasing is best-effort. A pidfile left behind is recovered by the
    // staleness check on the next start; throwing here would turn a clean
    // shutdown into a crash.
  }
}

/**
 * Stops the daemon named by the pidfile and waits for it to exit.
 *
 * Only for `nova start --force`, where the user has said to take over.
 * SIGTERM first so the running daemon unlinks its socket and stops its capture
 * child, then SIGKILL if it has not gone. Returns false when the process
 * outlives both, so the caller refuses rather than starting a second daemon
 * anyway.
 */
export async function terminateInstance(pid: number, waitMs = 3000): Promise<boolean> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return true;   // already gone
  }
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return true;
  }
  await new Promise((r) => setTimeout(r, 200));
  return !isAlive(pid);
}
