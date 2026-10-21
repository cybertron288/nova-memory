import { test, expect } from "bun:test";
import { dayKey, decide, monthKey, secondsUntilUtcMidnight } from "../src/limits";
import type { Allowance } from "../src/ledger";

const NOON = Date.UTC(2026, 9, 21, 12, 0, 0);
const CEILING = 20;
const IP_LIMIT = 5000;

const fresh: Allowance = {
  plan: "free", cap: 1_000_000, deviceUsedToday: 0, accountUsedToday: 0, monthCostMicros: 0,
  deviceLinked: true, deviceBlocked: false, signupRefused: false, ipRequestsToday: 0,
};
const at = (a: Partial<Allowance>, now = NOON) => decide({ ...fresh, ...a }, now, CEILING, IP_LIMIT);

test("a fourth device key within 30 days is refused with 403", () => {
  expect(at({ deviceLinked: false })).toMatchObject({ ok: false, status: 403 });
});

test("a blocked device is refused with 403", () => {
  expect(at({ deviceBlocked: true })).toMatchObject({ ok: false, status: 403 });
});

test("under the cap is allowed", () => {
  expect(at({ deviceUsedToday: 999_999, accountUsedToday: 0 })).toEqual({ ok: true });
});

test("the device at its cap is 429 until UTC midnight", () => {
  expect(at({ deviceUsedToday: 1_000_000 }, Date.UTC(2026, 9, 21, 22, 0, 0)))
    .toMatchObject({ ok: false, status: 429, retryAfter: 7200 });
});

test("the account at its cap is 429 even on a fresh device", () => {
  expect(at({ deviceUsedToday: 0, accountUsedToday: 1_000_000 })).toMatchObject({ ok: false, status: 429 });
});

test("one half-second before midnight gives Retry-After 1", () => {
  expect(at({ deviceUsedToday: 1_000_000 }, Date.UTC(2026, 9, 21, 23, 59, 59, 500)))
    .toMatchObject({ status: 429, retryAfter: 1 });
  expect(secondsUntilUtcMidnight(Date.UTC(2026, 9, 21, 23, 59, 59, 999))).toBe(1);
});

test("dayKey rolls over at UTC midnight", () => {
  expect(dayKey(Date.UTC(2026, 9, 21, 23, 59, 59, 999))).toBe("2026-10-21");
  expect(dayKey(Date.UTC(2026, 9, 22))).toBe("2026-10-22");
  expect(monthKey(Date.UTC(2026, 9, 31, 23, 59, 59, 999))).toBe("2026-10");
});

test("the monthly ceiling stops everyone with Retry-After 3600", () => {
  expect(at({ monthCostMicros: 20_000_000 })).toMatchObject({ ok: false, status: 429, retryAfter: 3600 });
});

test("the ceiling is checked before the daily cap", () => {
  expect(at({ monthCostMicros: 20_000_000, deviceUsedToday: 1_000_000 }))
    .toMatchObject({ status: 429, retryAfter: 3600 });
});

test("an IP over its daily limit is 429 until midnight", () => {
  expect(at({ ipRequestsToday: 5000 }, Date.UTC(2026, 9, 21, 23, 0, 0)))
    .toMatchObject({ ok: false, status: 429, retryAfter: 3600 });
});

test("a new account refused for its IP's sign-up limit is 429 until midnight", () => {
  expect(at({ signupRefused: true }, Date.UTC(2026, 9, 21, 22, 0, 0)))
    .toMatchObject({ ok: false, status: 429, retryAfter: 7200 });
});
