import { test, expect } from "bun:test";
import { randomBytes } from "node:crypto";
import { openDb } from "../src/db";
import { bindAccount, checkBinding, maskEmail, mismatchSummary } from "../src/account";
import { commitVersion, resolveThread } from "../src/threads";
import { enqueueExtraction, drainQueue } from "../src/pipeline";
import { recordLoops } from "../src/loops";
import { FakeProvider } from "../src/provider";

const KEY = randomBytes(32);

test("an empty store is unbound", async () => {
  const db = await openDb(":memory:");
  expect(checkBinding(db, KEY, "u1")).toEqual({ kind: "unbound" });
});

test("the bound account reads as same", async () => {
  const db = await openDb(":memory:");
  bindAccount(db, KEY, "u1", "a@example.com");
  expect(checkBinding(db, KEY, "u1")).toEqual({ kind: "same" });
});

test("another account reads as other with the previous email masked", async () => {
  const db = await openDb(":memory:");
  bindAccount(db, KEY, "u1", "a@example.com");
  expect(checkBinding(db, KEY, "u2")).toEqual({ kind: "other", previousEmail: "a•••@example.com" });
});

test("the user id and email are never stored in the clear", async () => {
  const db = await openDb(":memory:");
  bindAccount(db, KEY, "u1-0000-uuid", "a@example.com");
  const values = (db.prepare("SELECT value FROM store_metadata").all() as { value: string }[]).map((r) => r.value);
  expect(values.length).toBeGreaterThan(0);
  expect(values.some((v) => v.includes("u1-0000-uuid") || v.includes("a@example.com"))).toBe(false);
});

test("maskEmail handles a missing or odd address", () => {
  expect(maskEmail(null)).toBe("another account");
  expect(maskEmail("nobody")).toBe("another account");
  expect(maskEmail("alex@example.com")).toBe("a•••@example.com");
});

test("mismatchSummary counts memories and loops and the first capture", async () => {
  const db = await openDb(":memory:");
  const at = 1_790_000_000_000;
  const rec = {
    ts: at, app: "Slack", bundleId: "com.test.slack", windowTitle: "DM", url: null,
    content: "Alex will send the deck.", contentHash: "sha256:a", treeHash: "sha256:t",
  };
  const { versionId } = commitVersion(db, KEY, resolveThread(db, KEY, rec), rec);
  enqueueExtraction(db, versionId);
  await drainQueue(db, KEY, new FakeProvider(["Alex owes the deck"]));
  await recordLoops(db, KEY, [{
    description: "Send the deck", direction: "i_owe", counterparty: null, dueSignal: null,
    closureSignature: "deck sent",
  }], null);
  expect(mismatchSummary(db)).toEqual({ memories: 1, loops: 1, since: at });
});
