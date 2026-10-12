import { test, expect } from "bun:test";
import { fingerprint, isNovel } from "../src/fingerprint";
import { openDb } from "../src/db";

test("relative timestamps are collapsed before hashing", () => {
  // The same message read twice, minutes apart, must hash the same — otherwise
  // every re-read of a chat looks like new content.
  expect(fingerprint("alice: hi (3 minutes ago)"))
    .toBe(fingerprint("alice: hi (8 minutes ago)"));
  expect(fingerprint("alice: hi")).not.toBe(fingerprint("bob: hi"));
});

test("word-article relative form collapses with digit form", () => {
  expect(fingerprint("alice: hi (a minute ago)"))
    .toBe(fingerprint("alice: hi (3 minutes ago)"));
});

test("compact relative forms collapse together", () => {
  expect(fingerprint("alice: hi (2m ago)"))
    .toBe(fingerprint("alice: hi (5h ago)"));
});

test("bare relative forms collapse together", () => {
  expect(fingerprint("alice: hi (just now)"))
    .toBe(fingerprint("alice: hi (yesterday)"));
});

test("genuinely different content still produces distinct hashes", () => {
  expect(fingerprint("alice: hi (3 minutes ago)"))
    .not.toBe(fingerprint("alice: bye (3 minutes ago)"));
});

test("a fingerprint is novel once", async () => {
  const db = await openDb(":memory:");
  const fp = fingerprint("some captured text");
  expect(isNovel(db, "t1", fp)).toBe(true);
  expect(isNovel(db, "t1", fp)).toBe(false);
});
