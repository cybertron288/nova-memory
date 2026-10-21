import { test, expect } from "bun:test";
import { openDb } from "../src/db";
import { handleControlLine, type DaemonState } from "../src/control";
import { storeIdentity, userIdentity } from "../src/identity";
import { randomBytes } from "node:crypto";

const KEY = randomBytes(32);

function freshState(): DaemonState {
  return {
    gate: { paused: false },
    startedAt: Date.now(),
    lastCaptureAt: () => null,
    lastError: null,
    queued: () => 0, unreachableSince: () => null, networkUp: () => {},
  };
}

const call = (db: any, o: object) =>
  JSON.parse((handleControlLine(JSON.stringify(o), db, KEY, freshState()) as string).trim());

/** Runs `fn` with the identity env vars set as given (absent = unset), then restores them. */
function withEnv<T>(vars: { NOVA_USER_NAME?: string; NOVA_USER_ALIASES?: string }, fn: () => T): T {
  const names = ["NOVA_USER_NAME", "NOVA_USER_ALIASES"] as const;
  const prev = names.map((n) => process.env[n]);
  for (const n of names) {
    if (vars[n] === undefined) delete process.env[n]; else process.env[n] = vars[n];
  }
  try { return fn(); } finally {
    names.forEach((n, i) => { if (prev[i] === undefined) delete process.env[n]; else process.env[n] = prev[i]; });
  }
}

test("set_profile then get_profile round-trips, normalized, from the app", async () => {
  const db = await openDb(":memory:");
  const set = call(db, {
    id: 1, op: "set_profile", name: "  Sam Lee ",
    aliases: [" sam@example.com ", "", "Sam", "SAM@example.com", "   "],
  });
  expect(set).toEqual({
    id: 1, ok: true,
    result: { name: "Sam Lee", aliases: ["sam@example.com", "Sam"], source: "app" },
  });
  expect(call(db, { id: 2, op: "get_profile" })).toEqual({
    id: 2, ok: true,
    result: { name: "Sam Lee", aliases: ["sam@example.com", "Sam"], source: "app" },
  });
});

test("a stored identity overrides the env vars", async () => {
  const db = await openDb(":memory:");
  call(db, { id: 1, op: "set_profile", name: "Sam Lee", aliases: [] });
  withEnv({ NOVA_USER_NAME: "Dana Reyes", NOVA_USER_ALIASES: "dana" }, () => {
    expect(call(db, { id: 2, op: "get_profile" }).result)
      .toEqual({ name: "Sam Lee", aliases: [], source: "app" });
  });
});

test("with nothing stored the env vars are used, and say so", async () => {
  const db = await openDb(":memory:");
  withEnv({ NOVA_USER_NAME: " Dana Reyes ", NOVA_USER_ALIASES: "dana, dana@example.com" }, () => {
    expect(call(db, { id: 1, op: "get_profile" }).result)
      .toEqual({ name: "Dana Reyes", aliases: ["dana", "dana@example.com"], source: "env" });
  });
  expect(userIdentity(db, KEY, { NOVA_USER_NAME: "Dana Reyes" } as any))
    .toEqual({ identity: { name: "Dana Reyes", aliases: [] }, source: "env" });
});

test("with nothing stored and no env vars there is no identity", async () => {
  const db = await openDb(":memory:");
  withEnv({}, () => {
    expect(call(db, { id: 1, op: "get_profile" }).result)
      .toEqual({ name: null, aliases: [], source: "none" });
  });
  expect(userIdentity(db, KEY, {} as any)).toEqual({ identity: undefined, source: "none" });
});

test("set_profile refuses invalid input instead of coercing it", async () => {
  const db = await openDb(":memory:");
  const refused = (o: object) => {
    const r = call(db, { id: 9, op: "set_profile", ...o });
    expect(r.ok).toBe(false);
    return r.error;
  };
  expect(refused({ aliases: [] })).toBe("name must be a string");
  expect(refused({ name: 42, aliases: [] })).toBe("name must be a string");
  expect(refused({ name: "   ", aliases: [] })).toBe("name must not be empty");
  expect(refused({ name: "x".repeat(101), aliases: [] })).toBe("name must be at most 100 characters");
  expect(refused({ name: "Sam" })).toBe("aliases must be an array of strings");
  expect(refused({ name: "Sam", aliases: "sam" })).toBe("aliases must be an array of strings");
  expect(refused({ name: "Sam", aliases: ["sam", 3] })).toBe("aliases must be an array of strings");
  expect(refused({ name: "Sam", aliases: ["y".repeat(201)] }))
    .toBe("each alias must be at most 200 characters");
  expect(refused({ name: "Sam", aliases: Array.from({ length: 21 }, (_, i) => `h${i}`) }))
    .toBe("at most 20 aliases");
  // Nothing was stored by any refusal.
  expect(db.prepare("SELECT 1 FROM store_metadata WHERE key='user_identity'").get()).toBeNull();
});

test("100 characters of name and 20 handles are accepted", async () => {
  const db = await openDb(":memory:");
  const handles = Array.from({ length: 20 }, (_, i) => `h${i}`);
  const r = call(db, { id: 1, op: "set_profile", name: "n".repeat(100), aliases: handles });
  expect(r.ok).toBe(true);
  expect(r.result.aliases).toEqual(handles);
});

test("the stored identity is not plaintext", async () => {
  const db = await openDb(":memory:");
  storeIdentity(db, KEY, { name: "Sam Lee", aliases: ["sam@example.com"] });
  const row = db.prepare("SELECT value FROM store_metadata WHERE key='user_identity'").get() as
    { value: string };
  expect(row.value).not.toContain("Sam Lee");
  expect(row.value).not.toContain("sam@example.com");
  expect(userIdentity(db, KEY, {} as any))
    .toEqual({ identity: { name: "Sam Lee", aliases: ["sam@example.com"] }, source: "app" });
});
