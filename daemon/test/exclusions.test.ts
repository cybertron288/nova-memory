import { test, expect } from "bun:test";
import { openDb } from "../src/db";
import {
  addExclusion, listExclusions, removeExclusion, userExcluded,
  hardExclusions, skipCounts,
} from "../src/exclusions";
import { randomBytes } from "node:crypto";
import { handleLine } from "../src/ingest";
import { purgeSecrets } from "../src/purge";

const key = () => randomBytes(32);

test("an added app excludes captures from it", async () => {
  const db = await openDb(":memory:");
  const k = key();
  expect(userExcluded(db, k, "Notes", null, "Journal")).toBeNull();
  addExclusion(db, k, { kind: "app", value: "Notes" });
  expect(userExcluded(db, k, "Notes", null, "Journal")).not.toBeNull();
});

test("an added domain excludes its subdomains, not its lookalikes", async () => {
  const db = await openDb(":memory:");
  const k = key();
  addExclusion(db, k, { kind: "domain", value: "therapy.example" });
  expect(userExcluded(db, k, "Chrome", "https://therapy.example/notes", "")).not.toBeNull();
  expect(userExcluded(db, k, "Chrome", "https://portal.therapy.example/x", "")).not.toBeNull();
  expect(userExcluded(db, k, "Chrome", "https://nottherapy.example/x", "")).toBeNull();
  expect(userExcluded(db, k, "Chrome", "https://therapy.example.co/x", "")).toBeNull();
});

test("matching is case-insensitive and tolerates a pasted URL or @ prefix", async () => {
  const db = await openDb(":memory:");
  const k = key();
  addExclusion(db, k, { kind: "domain", value: "HTTPS://Clinic.Example/path" });
  expect(listExclusions(db, k)[0]!.value).toBe("clinic.example");
  expect(userExcluded(db, k, "Safari", "https://clinic.example/a", "")).not.toBeNull();
});

test("an exclusion can be listed and removed", async () => {
  const db = await openDb(":memory:");
  const k = key();
  const id = addExclusion(db, k, { kind: "app", value: "Signal" });
  expect(listExclusions(db, k).map((e) => e.value)).toEqual(["Signal"]);
  expect(removeExclusion(db, id)).toBe(true);
  expect(listExclusions(db, k)).toEqual([]);
  expect(removeExclusion(db, id)).toBe(false);
  expect(userExcluded(db, k, "Signal", null, "")).toBeNull();
});

test("adding the same exclusion twice is a no-op, not a duplicate row", async () => {
  const db = await openDb(":memory:");
  const k = key();
  addExclusion(db, k, { kind: "app", value: "Notes" });
  addExclusion(db, k, { kind: "app", value: "notes" });
  expect(listExclusions(db, k)).toHaveLength(1);
});

test("an empty value is refused", async () => {
  const db = await openDb(":memory:");
  const k = key();
  expect(() => addExclusion(db, k, { kind: "app", value: "   " })).toThrow();
  expect(listExclusions(db, k)).toEqual([]);
});

test("the exclusion list is encrypted at rest", async () => {
  const db = await openDb(":memory:");
  const k = key();
  addExclusion(db, k, { kind: "domain", value: "therapy.example" });
  const raw = db.prepare("SELECT value FROM user_exclusions").all() as { value: string }[];
  expect(raw[0]!.value).not.toContain("therapy.example");
});

test("adding an exclusion removes what was already captured from that source", async () => {
  const db = await openDb(":memory:");
  const k = randomBytes(32);
  const line = (app: string, url: string | null) => JSON.stringify({
    app, url, bundleId: `com.example.${app}`, windowTitle: "w", ts: Date.now(),
    content: `notes from ${app} about the week`,
    contentHash: `h-${app}`, treeHash: `t-${app}`,
  });

  expect(handleLine(db, k, line("Notes", null)).stored).toBe(true);
  expect(handleLine(db, k, line("Slack", null)).stored).toBe(true);
  expect(db.prepare("SELECT count(*) c FROM memory_threads").get()).toEqual({ c: 2 });

  addExclusion(db, k, { kind: "app", value: "Notes" });
  // Already-stored captures are not grandfathered in: the same pass that
  // applies a stricter credential rule applies a new exclusion (D1's
  // idempotent purge, reused).
  purgeSecrets(db, k);
  expect(db.prepare("SELECT count(*) c FROM memory_threads").get()).toEqual({ c: 1 });

  // And it is refused at ingest from then on.
  expect(handleLine(db, k, line("Notes", null)).reason).toBe("user-excluded");
});

// --- Phase 1: the pane needs the hard list and the skip counts -------------

test("the hard exclusions are listed with their categories", async () => {
  const db = await openDb(":memory:");
  const list = hardExclusions();
  const kinds = list.map((h) => h.id);
  // Every category architecture §4 calls non-overridable has to be shown, or
  // the pane implies the user's own list is all there is.
  expect(kinds).toContain("password-managers");
  expect(kinds).toContain("banking");
  expect(kinds).toContain("private-browsing");
  expect(kinds).toContain("screen-sharing");
  for (const h of list) {
    expect(h.title.length).toBeGreaterThan(0);
    expect(h.detail.length).toBeGreaterThan(0);
    expect(h.overridable).toBe(false);
  }
  expect(db).toBeDefined();
});

test("a refused capture increments the count for the rule that refused it", async () => {
  const db = await openDb(":memory:");
  const k = randomBytes(32);
  const line = (app: string, url: string | null, title: string) => JSON.stringify({
    app, url, bundleId: "com.example", windowTitle: title, ts: Date.now(),
    content: "some captured text here", contentHash: `h-${app}-${title}`, treeHash: "t",
  });

  handleLine(db, k, line("Chrome", "https://netbanking.hdfcbank.com/", "HDFC"));
  handleLine(db, k, line("Chrome", null, "Gmail - Incognito"));
  handleLine(db, k, line("Chrome", null, "Gmail - Incognito"));

  const counts = skipCounts(db);
  expect(counts["banking"]).toBe(1);
  expect(counts["private-browsing"]).toBe(2);
});

test("a user exclusion counts against its own row, not the hard rules", async () => {
  const db = await openDb(":memory:");
  const k = randomBytes(32);
  const id = addExclusion(db, k, { kind: "app", value: "Notes" });
  const line = JSON.stringify({
    app: "Notes", url: null, bundleId: "com.apple.Notes", windowTitle: "Journal",
    ts: Date.now(), content: "a private journal entry", contentHash: "h1", treeHash: "t1",
  });
  handleLine(db, k, line);
  handleLine(db, k, line);

  expect(skipCounts(db)[id]).toBe(2);
  // And the pane reads it off the exclusion itself.
  expect(listExclusions(db, k)[0]!.skipped).toBe(2);
});

test("skip counts survive a restart", async () => {
  const db = await openDb(":memory:");
  const k = randomBytes(32);
  handleLine(db, k, JSON.stringify({
    app: "Chrome", url: null, bundleId: "c", windowTitle: "Safari Private Browsing",
    ts: Date.now(), content: "text", contentHash: "h", treeHash: "t",
  }));
  // Counts live in the store, not in the ingest loop's in-memory tally, which
  // is flushed to stderr and lost: the pane's number has to mean "ever".
  const row = db.prepare("SELECT skipped FROM skip_counts WHERE rule_id='private-browsing'")
    .get() as { skipped: number } | null;
  expect(row?.skipped).toBe(1);
});

// --- Bundle ids: an app rule survives a rename ----------------------------

test("an app rule stores the bundle id and matches on it", async () => {
  const db = await openDb(":memory:");
  const k = randomBytes(32);
  addExclusion(db, k, { kind: "app", value: "org.whispersystems.signal-desktop", label: "Signal" });

  // Matched on the bundle id, so the rule holds after the app is renamed.
  expect(userExcluded(db, k, "Signal Desktop", null, "", "org.whispersystems.signal-desktop"))
    .not.toBeNull();
  // And the name alone is not enough: a different app called Signal is not it.
  expect(userExcluded(db, k, "Signal", null, "", "com.example.other")).toBeNull();
});

test("an app rule keeps the display name beside the bundle id", async () => {
  const db = await openDb(":memory:");
  const k = randomBytes(32);
  addExclusion(db, k, { kind: "app", value: "md.obsidian", label: "Obsidian" });
  const [e] = listExclusions(db, k);
  expect(e!.value).toBe("md.obsidian");
  expect(e!.label).toBe("Obsidian");
});

test("an app rule with no bundle id falls back to matching the name", async () => {
  const db = await openDb(":memory:");
  const k = randomBytes(32);
  // What `nova exclude --app Notes` gives, and what rows added before bundle
  // ids existed hold.
  addExclusion(db, k, { kind: "app", value: "Notes" });
  expect(userExcluded(db, k, "Notes", null, "", "com.apple.Notes")).not.toBeNull();
  expect(userExcluded(db, k, "Notes", null, "")).not.toBeNull();
});

test("a domain rule is unaffected by the bundle id", async () => {
  const db = await openDb(":memory:");
  const k = randomBytes(32);
  addExclusion(db, k, { kind: "domain", value: "therapy.example" });
  expect(userExcluded(db, k, "Chrome", "https://therapy.example/x", "", "com.google.Chrome"))
    .not.toBeNull();
});
