// Whether a request may go upstream, decided from one Allowance read. Pure, so
// every limit is tested without a database or a clock.
import type { Allowance } from "./ledger";

export type Decision =
  | { ok: true }
  | { ok: false; status: 403 | 429; retryAfter?: number; error: string };

const DAY_MS = 86_400_000;
/** The ceiling's retry: hourly, matching the daemon's longest quota backoff. */
const CEILING_RETRY_S = 3600;

export function nextUtcMidnight(now: number): number {
  return Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;
}

/** Never 0: a Retry-After of 0 tells the daemon to retry at once. */
export function secondsUntilUtcMidnight(now: number): number {
  return Math.max(1, Math.ceil((nextUtcMidnight(now) - now) / 1000));
}

export function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function monthKey(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

export function decide(a: Allowance, now: number, ceilingUsd: number, ipDailyLimit: number): Decision {
  if (a.deviceBlocked) return { ok: false, status: 403, error: "this device is blocked" };
  if (!a.deviceLinked) {
    return { ok: false, status: 403, error: "this account has linked too many devices in the last 30 days" };
  }
  // The ceiling first: when it is reached, the daily caps no longer matter and
  // the hourly retry is the one the daemon should follow.
  if (a.monthCostMicros >= ceilingUsd * 1_000_000) {
    return { ok: false, status: 429, retryAfter: CEILING_RETRY_S, error: "Nova Cloud is paused for this month" };
  }
  const untilMidnight = secondsUntilUtcMidnight(now);
  if (a.signupRefused) {
    return { ok: false, status: 429, retryAfter: untilMidnight, error: "too many new accounts from this network today" };
  }
  if (a.ipRequestsToday >= ipDailyLimit) {
    return { ok: false, status: 429, retryAfter: untilMidnight, error: "too many requests from this network today" };
  }
  if (Math.max(a.deviceUsedToday, a.accountUsedToday) >= a.cap) {
    return { ok: false, status: 429, retryAfter: untilMidnight, error: "today's Nova Cloud allowance is used up" };
  }
  return { ok: true };
}
