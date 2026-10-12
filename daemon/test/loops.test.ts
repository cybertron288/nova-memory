import { test, expect } from "bun:test";
import { openDb, decryptField } from "../src/db";
import { resolveThread, commitVersion } from "../src/threads";
import {
  recordLoops, listOpenLoops, actOnLoop, wakeExpiredSnoozes,
  trackedLoops, closeLoops, watchesForLoops, rateLoop, loopPrecision,
} from "../src/loops";
import { parseLoops, type LoopCandidate } from "../src/provider";
import { randomBytes } from "node:crypto";

const KEY = randomBytes(32);

const commitment: LoopCandidate = {
  description: "Alex will change the patient detail timeline to read from the detail view response.",
  direction: "i_owe",
  counterparty: "Dana Reyes",
  dueSignal: null,
  closureSignature: "the patient detail timeline was changed to read from the detail view response",
};

/** Unit vector pointing mostly along one axis, so similarity is controllable. */
function vec(dim: number, axis: number, noise = 0): Float32Array {
  const v = new Float32Array(dim);
  v[axis] = 1;
  for (let i = 0; i < dim; i++) if (i !== axis) v[i] = noise;
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  for (let i = 0; i < dim; i++) v[i]! /= n;
  return v;
}


/** Inserts real derivative rows, so resolve_evidence's FK is satisfiable. */
async function seedDerivatives(db: any, ids: string[]) {
  const rec = {
    ts: 1787331916548, app: "Slack", bundleId: "com.tinyspeck.slackmacgap",
    windowTitle: "thread", url: null,
    content: "seed", contentHash: "sha256:s", treeHash: "sha256:t",
  };
  const tid = resolveThread(db, KEY, rec);
  const { versionId } = commitVersion(db, KEY, tid, rec);
  for (const id of ids) {
    db.prepare(
      `INSERT INTO memory_derivatives (id, thread_id, version_id, content, content_hash, committed_at)
       VALUES (?, ?, ?, 'x', 'sha256:x', ?)`,
    ).run(id, tid, versionId, Date.now());
  }
}

test("a loop is stored encrypted and listed back", async () => {
  const db = await openDb(":memory:");
  expect(await recordLoops(db, KEY, [commitment], null)).toBe(1);

  // The description quotes the user's screen, so it must not sit in plaintext.
  const raw = db.prepare("SELECT description FROM open_loops").get() as any;
  expect(raw.description.startsWith("enc:v1:")).toBe(true);
  expect(raw.description).not.toContain("timeline");

  const loops = listOpenLoops(db, KEY);
  expect(loops.length).toBe(1);
  expect(loops[0]!.description).toBe(commitment.description);
  expect(loops[0]!.direction).toBe("i_owe");
  expect(loops[0]!.counterparty).toBe("Dana Reyes");
});

test("a restated loop with different wording is one loop, not three", async () => {
  const db = await openDb(":memory:");

  // The real shape, measured 2026-09-22: one EAS build problem, re-captured
  // three times as the Slack thread grew, phrased differently each time. The
  // dedup key hashes the description, so three phrasings made three loops.
  const base = { direction: "i_owe" as const, counterparty: "Taylor", dueSignal: null };
  const first = { ...base,
    description: "resolve the EAS iOS build Apple Developer authentication failure",
    closureSignature: "the iOS build authenticated with the Apple Developer account and proceeded" };
  const second = { ...base,
    description: "resolve the EAS CLI build issue and retry the iOS build",
    closureSignature: "the iOS build succeeds or the EAS CLI issue is reported fixed" };
  const third = { ...base,
    description: "try installing same CLI version as mobile app",
    closureSignature: "Alex reports the CLI version matches the mobile app or the iOS build succeeds" };

  // Closure signatures that all mean "the iOS build works" embed close
  // together; an unrelated commitment does not.
  const near = (axis: number, noise: number) => vec(8, axis, noise);
  const embed = async (texts: string[]) =>
    texts.map((t) => (/unrelated/.test(t) ? near(1, 0) : near(0, t.length % 3 * 0.02)));

  expect(await recordLoops(db, KEY, [first], null, { embed })).toBe(1);
  expect(await recordLoops(db, KEY, [second], null, { embed })).toBe(0);
  expect(await recordLoops(db, KEY, [third], null, { embed })).toBe(0);

  const loops = listOpenLoops(db, KEY);
  expect(loops.length).toBe(1);
  // The newest phrasing wins: it reflects where the problem actually stands.
  expect(loops[0]!.description).toBe(third.description);

  // A genuinely different commitment in the same thread still lands.
  const other = { ...base, description: "send Taylor the deploy notes",
    closureSignature: "an unrelated commitment about deploy notes" };
  expect(await recordLoops(db, KEY, [other], null, { embed })).toBe(1);
  expect(listOpenLoops(db, KEY).length).toBe(2);
});

test("a loop carries the app it was captured from, and null when unknown", async () => {
  const db = await openDb(":memory:");
  await seedDerivatives(db, ["d1"]);          // seeds a Slack thread
  expect(await recordLoops(db, KEY, [commitment], "d1")).toBe(1);

  // Provenance is what makes a surfaced loop checkable: "you said this, in
  // Slack" can be verified, "you said this" has to be taken on faith (F3.4).
  const [withApp] = listOpenLoops(db, KEY);
  expect(withApp!.sourceApp).toBe("Slack");

  // Evidence is optional — recordLoops accepts a null derivative, and a
  // same-hour overwrite deletes the link while the loop stays open. The app
  // is then genuinely unknown, and must read as null rather than be invented.
  db.prepare("DELETE FROM loop_evidence").run();
  const [without] = listOpenLoops(db, KEY);
  expect(without!.sourceApp).toBeNull();
});

test("a loop is dated when its evidence was captured, not when it was extracted", async () => {
  const db = await openDb(":memory:");
  // A capture from two hours ago, drained only now after a provider outage.
  const capturedAt = Date.now() - 2 * 3_600_000;
  await recordLoops(db, KEY, [commitment], null, undefined, undefined, capturedAt);
  expect(listOpenLoops(db, KEY)[0]!.createdAt).toBe(capturedAt);
});

test("the same commitment restated is one loop, not two", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  // Re-captured on the next tick with different casing and punctuation, which
  // is what actually happens when a thread is sampled repeatedly.
  const restated: LoopCandidate = {
    ...commitment,
    description: "Alex will change the patient detail timeline to read from the detail view response!!",
  };
  expect(await recordLoops(db, KEY, [restated], null)).toBe(0);
  expect(listOpenLoops(db, KEY).length).toBe(1);
});

test("the same sentence in the other direction is a different loop", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  await recordLoops(db, KEY, [{ ...commitment, direction: "owed_to_me" }], null);
  expect(listOpenLoops(db, KEY).length).toBe(2);
});

test("evidence links to the existing loop when a restatement is deduped", async () => {
  const db = await openDb(":memory:");
  const rec = {
    ts: 1787331916548, app: "Slack", bundleId: "com.tinyspeck.slackmacgap",
    windowTitle: "Dana Reyes", url: null,
    content: "timeline discussion", contentHash: "sha256:l1", treeHash: "sha256:l2",
  };
  const tid = resolveThread(db, KEY, rec);
  const { versionId } = commitVersion(db, KEY, tid, rec);
  const d1 = "d-1", d2 = "d-2";
  for (const id of [d1, d2]) {
    db.prepare(
      `INSERT INTO memory_derivatives (id, thread_id, version_id, content, content_hash, committed_at)
       VALUES (?, ?, ?, 'x', 'sha256:x', ?)`,
    ).run(id, tid, versionId, Date.now());
  }
  await recordLoops(db, KEY, [commitment], d1);
  await recordLoops(db, KEY, [commitment], d2);

  // One loop, two pieces of evidence — what the UI shows as "mentioned again".
  expect(listOpenLoops(db, KEY).length).toBe(1);
  const n = db.prepare("SELECT COUNT(*) c FROM loop_evidence").get() as any;
  expect(n.c).toBe(2);
});

// --- F4.2: the model closes tracked loops by quoting the capture ----------

test("trackedLoops offers open loops newest first under short ids", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const newer = { ...commitment, description: "send Dana the deploy notes",
    closureSignature: "the deploy notes were sent to Dana" };
  await recordLoops(db, KEY, [newer], null);
  // Both rows can land in the same millisecond; pin the order explicitly.
  db.prepare("UPDATE open_loops SET created_at=1000 WHERE state='open'").run();
  const newerId = listOpenLoops(db, KEY).find((l) => l.description === newer.description)!.id;
  db.prepare("UPDATE open_loops SET created_at=2000 WHERE id=?").run(newerId);

  const { tracked, storeIds } = trackedLoops(db, KEY);
  expect(tracked).toEqual([
    { id: "L1", description: newer.description, direction: "i_owe", counterparty: "Dana Reyes" },
    { id: "L2", description: commitment.description, direction: "i_owe", counterparty: "Dana Reyes" },
  ]);
  expect(storeIds.get("L1")).toBe(newerId);
});

test("closing an offered id marks the loop auto_resolved with its evidence", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  await seedDerivatives(db, ["d-done"]);
  const id = listOpenLoops(db, KEY)[0]!.id;

  const { storeIds } = trackedLoops(db, KEY);
  const reported: { description: string; evidence: string }[] = [];
  const closed = closeLoops(db, KEY, storeIds,
    [{ id: "L1", evidence: "timeline now reads from the detail view" }], "d-done",
    (c) => reported.push(c));

  expect(closed).toEqual([id]);
  const row = db.prepare("SELECT state, resolve_evidence FROM open_loops WHERE id=?").get(id) as any;
  expect(row.state).toBe("auto_resolved");
  expect(row.resolve_evidence).toBe("d-done");
  expect(reported).toEqual([
    { description: commitment.description, evidence: "timeline now reads from the detail view" },
  ]);
  expect(listOpenLoops(db, KEY).length).toBe(0);
});

test("a closure naming an id that was not offered changes nothing", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const { storeIds } = trackedLoops(db, KEY);

  expect(closeLoops(db, KEY, storeIds, [{ id: "L9", evidence: "done" }], null)).toEqual([]);
  expect(listOpenLoops(db, KEY).length).toBe(1);
});

test("a loop dismissed after it was offered is not closed", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const id = listOpenLoops(db, KEY)[0]!.id;

  // The dismissal lands during the provider round-trip, between offering the
  // loop and closing it. The user's action stands, and is not reported.
  const { storeIds } = trackedLoops(db, KEY);
  actOnLoop(db, id, "dismiss");
  expect(closeLoops(db, KEY, storeIds, [{ id: "L1", evidence: "done" }], null)).toEqual([]);

  const row = db.prepare("SELECT state FROM open_loops WHERE id=?").get(id) as any;
  expect(row.state).toBe("dismissed");
});

test("parseLoops keeps a loop whose evidence quotes the capture", () => {
  const source = "Jordan: can you send the deck by Friday?\nAlex: sure, I’ll send it";
  const { loops, closed } = parseLoops(JSON.stringify({
    loops: [
      { description: "Send the deck", direction: "i_owe", counterparty: "Jordan",
        due_signal: "by Friday", evidence: "I'll send it", closure_signature: "the deck was sent to Jordan" },
      { description: "No direction given", evidence: "I'll send it", closure_signature: "x" },
      { description: "Bad direction", direction: "maybe", evidence: "I'll send it", closure_signature: "x" },
      { direction: "i_owe", evidence: "I'll send it", closure_signature: "missing description" },
      { description: "No closure signature", direction: "i_owe", evidence: "I'll send it" },
    ],
  }), source);
  // The straight apostrophe in the evidence still matches the curly one in
  // the capture: a quote is compared on its words.
  expect(loops).toEqual([{
    description: "Send the deck", direction: "i_owe", counterparty: "Jordan",
    dueSignal: "by Friday", closureSignature: "the deck was sent to Jordan",
  }]);
  expect(closed).toEqual([]);
});

test("parseLoops drops a loop whose evidence is not in the capture", () => {
  const { loops } = parseLoops(JSON.stringify({
    loops: [{ description: "Send the deck", direction: "i_owe", counterparty: null,
      due_signal: null, evidence: "I will send the deck tonight", closure_signature: "the deck was sent" }],
  }), "Jordan: thanks for the call");
  expect(loops).toEqual([]);
});

test("parseLoops clears a counterparty and timing the capture does not contain", () => {
  const { loops } = parseLoops(JSON.stringify({
    loops: [{ description: "Send the deck", direction: "i_owe", counterparty: "Jordan Nair",
      due_signal: "by Monday", evidence: "I'll send the deck", closure_signature: "the deck was sent" }],
  }), "Lee: I'll send the deck by Friday");
  expect(loops).toEqual([{
    description: "Send the deck", direction: "i_owe", counterparty: null,
    dueSignal: null, closureSignature: "the deck was sent",
  }]);
});

test("parseLoops keeps a full name when the capture uses only the first", () => {
  const { loops } = parseLoops(JSON.stringify({
    loops: [{ description: "Send the deck", direction: "owed_to_me", counterparty: "Dana Reyes",
      due_signal: null, evidence: "I'll send the deck", closure_signature: "Dana sent the deck" }],
  }), "Dana: I'll send the deck");
  expect(loops[0]!.counterparty).toBe("Dana Reyes");
});

// --- D12: who wrote the evidence line bounds the direction ----------------

const USER = { name: "Alex Rivera", aliases: ["alexr42"] };

/** One loop response, varying only author and direction. */
function authored(author: string | undefined, direction: string, counterparty: string | null = "Dana") {
  return JSON.stringify({ loops: [{
    description: "answer which role lacks upload permission", direction, counterparty,
    due_signal: null, evidence: "which role doesn't have upload permission?", author,
    closure_signature: "the role lacking upload permission was named",
  }] });
}

test("with new lines given, a loop must quote one of them", () => {
  const source = "Alex: • update docs. 1:28 PM.\nAlex: • fix logout redirect. 3:43 PM.";
  const loop = (evidence: string) => JSON.stringify({ loops: [{
    description: evidence, direction: "i_owe", counterparty: null, due_signal: null,
    evidence, author: "Alex", closure_signature: `${evidence} is done`,
  }] });
  const added = "Alex: • fix logout redirect. 3:43 PM.";
  expect(parseLoops(loop("fix logout redirect"), source, [], USER, added).loops.length).toBe(1);
  expect(parseLoops(loop("update docs"), source, [], USER, added).loops).toEqual([]);
  // A thread's first read: everything is new.
  expect(parseLoops(loop("update docs"), source, [], USER).loops.length).toBe(1);
});

test("the prompt marks the new lines and confines new loops to them", async () => {
  const { buildLoopPrompt } = await import("../src/provider");
  const ctx = { app: "Slack", title: "Alex (DM)", url: null, capturedAt: Date.now(), user: USER };
  const p = buildLoopPrompt("Alex: a\nAlex: b", { ...ctx, added: "Alex: b" });
  expect(p).toContain("NEW SINCE THE LAST READ");
  expect(p).toContain("Take new loops ONLY from the NEW lines.");
  expect(p).toMatch(/to-do for themselves/);
  const first = buildLoopPrompt("Alex: a", ctx);
  expect(first).not.toContain("NEW SINCE THE LAST READ");
  expect(first).not.toContain("Take new loops ONLY");
});

test("the user's own question filed as unanswered is dropped", () => {
  const source = "Alex: which role doesn't have upload permission?";
  // Measured 2026-09-23: the user's own question came back as one they owed.
  expect(parseLoops(authored("Alex", "unanswered"), source, [], USER).loops).toEqual([]);
  expect(parseLoops(authored("Alex", "owed_to_me"), source, [], USER).loops.length).toBe(1);
});

test("an author of \"You\" counts as the user", () => {
  const source = "You: which role doesn't have upload permission?";
  expect(parseLoops(authored("You", "unanswered"), source, [], USER).loops).toEqual([]);
  expect(parseLoops(authored("You", "owed_to_me"), source, [], USER).loops.length).toBe(1);
});

test("someone else's line can be unanswered or owed, never the user's promise", () => {
  const source = "Dana: which role doesn't have upload permission?";
  expect(parseLoops(authored("Dana", "unanswered"), source, [], USER).loops.length).toBe(1);
  expect(parseLoops(authored("Dana", "i_owe"), source, [], USER).loops).toEqual([]);
});

test("a loop with no author is dropped once the user is known, and kept otherwise", () => {
  const source = "Dana: which role doesn't have upload permission?";
  expect(parseLoops(authored(undefined, "unanswered"), source, [], USER).loops).toEqual([]);
  expect(parseLoops(authored(undefined, "unanswered"), source).loops.length).toBe(1);
});

test("a counterparty that is the user is cleared", () => {
  const source = "Dana: which role doesn't have upload permission? cc Alex";
  const { loops } = parseLoops(authored("Dana", "unanswered", "Alex"), source, [], USER);
  expect(loops[0]!.counterparty).toBeNull();
});

test("parseLoops keeps a closure only for an offered id with quoted evidence", () => {
  const { closed } = parseLoops(JSON.stringify({
    loops: [],
    tracked: [
      { id: "L1", status: "closed", evidence: "sent the invoice just now" },
      { id: "L2", status: "closed", evidence: "the invoice has been paid" },   // not in the capture
      { id: "L3", status: "open", evidence: null },
      { id: "L7", status: "closed", evidence: "thanks" },                      // never offered
    ],
  }), "You: sent the invoice just now\nLee: thanks", ["L1", "L2", "L3"]);
  expect(closed).toEqual([{ id: "L1", evidence: "sent the invoice just now" }]);
});

test("parseLoops returns nothing for an unparseable response", () => {
  expect(parseLoops("I could not find any loops, sorry.", "x")).toEqual({ loops: [], closed: [] });
  expect(parseLoops(JSON.stringify({ result: [] }), "x")).toEqual({ loops: [], closed: [] });
});

test("parseLoops accepts a fenced response", () => {
  const raw = '```json\n{"loops":[{"description":"a","direction":"stalled","evidence":"ship it","closure_signature":"b"}]}\n```';
  expect(parseLoops(raw, "we agreed to ship it").loops.length).toBe(1);
});

test("watchesForLoops skips AI assistants, terminals and editors", () => {
  const cases: [string, string | null, boolean][] = [
    ["Slack", null, true],
    ["Google Chrome", "https://mail.google.com/mail/u/0", true],
    ["Google Chrome", "https://chatgpt.com/c/abc", false],
    ["Safari", "https://claude.ai/chat/1", false],
    ["Arc", "https://www.perplexity.ai/search", false],
    ["Google Chrome", "not a url", true],
    ["ChatGPT", null, false],
    ["Ghostty", null, false],
    ["VSCodium", null, false],
  ];
  for (const [app, url, expected] of cases) {
    expect([app, url, watchesForLoops(app, url)]).toEqual([app, url, expected]);
  }
});

// --- the MCP tool ---------------------------------------------------------

test("get_open_loops answers without a provider call", async () => {
  const { handleToolCall } = await import("../src/mcp");
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment, {
    description: "Casey needs the Apple ID to run the build.",
    direction: "owed_to_me", counterparty: "Casey",
    dueSignal: "today", closureSignature: "the Apple ID was provided to Casey",
  }], null);

  let embedCalls = 0;
  const provider = {
    extract: async () => [],
    embed: async () => { embedCalls++; return []; },
  } as any;

  const res = await handleToolCall(db, KEY, provider, { name: "get_open_loops", arguments: {} });
  const text = res.content[0]!.text;
  expect(text).toContain("You said you would");
  expect(text).toContain("Dana Reyes");
  expect(text).toContain("Someone owes you");
  // Loops are stored, so listing them needs no embedding — unlike search.
  expect(embedCalls).toBe(0);
});

test("get_open_loops filters by direction", async () => {
  const { handleToolCall } = await import("../src/mcp");
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment, { ...commitment, direction: "owed_to_me" }], null);
  const provider = { extract: async () => [], embed: async () => [] } as any;

  const res = await handleToolCall(db, KEY, provider, {
    name: "get_open_loops", arguments: { direction: "owed_to_me" },
  });
  expect(res.content[0]!.text).toContain("Someone owes you");
  expect(res.content[0]!.text).not.toContain("You said you would");
});

test("get_open_loops refuses an unknown direction or limit instead of returning everything", async () => {
  const { handleToolCall } = await import("../src/mcp");
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const provider = { extract: async () => [], embed: async () => [] } as any;
  const call = (args: unknown) => handleToolCall(db, KEY, provider, { name: "get_open_loops", arguments: args });

  await expect(call({ direction: "owes_me" })).rejects.toThrow(/direction/);
  await expect(call({ direction: 3 })).rejects.toThrow(/direction/);
  await expect(call({ limit: "5" })).rejects.toThrow(/limit/);
  await expect(call({ limit: 0 })).rejects.toThrow(/limit/);
  expect((await call({ direction: "any", limit: 5 })).content[0]!.text).toContain("You said you would");
});

test("get_open_loops says so when there are none", async () => {
  const { handleToolCall } = await import("../src/mcp");
  const db = await openDb(":memory:");
  const provider = { extract: async () => [], embed: async () => [] } as any;
  const res = await handleToolCall(db, KEY, provider, { name: "get_open_loops", arguments: {} });
  // An empty answer must be distinguishable from a broken one.
  expect(res.content[0]!.text).toContain("No open loops");
});

// --- D12: identity drives direction --------------------------------------

test("the loop prompt names the user and forbids self-as-counterparty", async () => {
  const { buildLoopPrompt } = await import("../src/provider");
  const p = buildLoopPrompt("Alex: I'll merge PR 11 today.", {
    app: "Slack", title: "Dana Reyes (DM)", url: null, capturedAt: Date.now(),
    user: { name: "Alex", aliases: ["alex@acme.com", "alexr42"] },
  });
  expect(p).toContain("THE USER IS: Alex");
  expect(p).toContain("alex@acme.com");
  // The measured D12 failure was four loops naming Alex as the counterparty.
  expect(p).toContain('Never put Alex in "counterparty"');
});

test("without an identity the prompt refuses to guess direction", async () => {
  const { buildLoopPrompt } = await import("../src/provider");
  const p = buildLoopPrompt("I'll merge PR 11 today.", {
    app: "Slack", title: "DM", url: null, capturedAt: Date.now(),
  });
  expect(p).toContain("THE USER'S IDENTITY IS NOT KNOWN");
  expect(p).toMatch(/return only\s+loops whose direction is unambiguous/);
});

test("the prompt excludes attendance notices", async () => {
  const { buildLoopPrompt } = await import("../src/provider");
  const p = buildLoopPrompt("x", {
    app: "Slack", title: "z-eom", url: null, capturedAt: Date.now(),
  });
  // The four measured false positives were all of this shape.
  expect(p).toContain("availability or whereabouts notices");
  expect(p).toContain("on leave tomorrow");
});

// --- Description shape: a phrase to act on, not a summary of the thread ----

test("the prompt constrains the description to a short actionable phrase", async () => {
  const { buildLoopPrompt } = await import("../src/provider");
  const p = buildLoopPrompt("x", {
    app: "Slack", title: "Taylor (DM)", url: null, capturedAt: Date.now(),
    user: { name: "Alex", aliases: [] },
  });
  // Measured 2026-09-22: a TestFlight thread produced a 243-character
  // description that recounted the whole exchange. Every other field had a
  // rule; "description" had none, so the model summarised.
  // Asserting the constraint, not the sentence that carries it: the exact
  // prose has already been reworded once, and a test that breaks on a synonym
  // measures the wording rather than the rule.
  expect(p).toMatch(/under 60\s+characters/i);
  expect(p).toMatch(/never (exceed|over) \d+/);
  expect(p).toMatch(/do not narrate/i);
});

test("the prompt excludes AI assistant conversations", async () => {
  const { buildLoopPrompt } = await import("../src/provider");
  const p = buildLoopPrompt("x", {
    app: "Google Chrome", title: "Fix EAS Apple Authentication", url: null,
    capturedAt: Date.now(), user: { name: "Alex", aliases: [] },
  });
  // Measured 2026-09-22: two ChatGPT threads produced loops — "reply with
  // output of eas --version" and "paste the package.json for
  // a scaffolding CLI". The assistant asking for a paste is a turn
  // in a conversation the user is having, not a commitment anyone is owed.
  expect(p).toMatch(/AI assistant|ChatGPT|chat with an assistant/);
  expect(p).toMatch(/turn in a live chat, not a\s+commitment/);
});

test("the prompt says what to do when one commitment covers a list", async () => {
  const { buildLoopPrompt } = await import("../src/provider");
  const p = buildLoopPrompt("x", {
    app: "Slack", title: "Alex (DM)", url: null, capturedAt: Date.now(),
    user: { name: "Alex", aliases: [] },
  });
  // Measured 2026-09-22: a five-bullet list ending "I'll work on above tasks
  // tomorrow" produced "work on app developer skill tasks" — the first
  // bullet, named as if it were the whole scope. One commitment is one loop,
  // but its description must cover the list rather than pick from it.
  expect(p).toMatch(/covers a list|covers several items|list of items/);
  expect(p).toMatch(/never just the first item/);
  expect(p).toMatch(/ONE loop/);
});

test("the prompt rejects a loop whose own text contains its closure", async () => {
  const { buildLoopPrompt } = await import("../src/provider");
  const p = buildLoopPrompt("x", {
    app: "Slack", title: "Taylor (DM)", url: null, capturedAt: Date.now(),
    user: { name: "Alex", aliases: [] },
  });
  // The same measured case ended "...and the TestFlight invite was sent" —
  // it described the closure and filed the loop open anyway.
  // Two properties, however they are phrased: read the whole thread before
  // deciding, and treat a description that states its own closure as the
  // proof the loop is closed.
  expect(p).toMatch(/Read to the end/i);
  expect(p).toMatch(/forces you to (mention|say) (that )?the thing\s+was already\s+done/);
});

test("the prompt lists tracked loops under the ids it may close", async () => {
  const { buildLoopPrompt } = await import("../src/provider");
  const ctx = { app: "Slack", title: "Lee (DM)", url: null, capturedAt: Date.now() };
  const p = buildLoopPrompt("You: sent the invoice", ctx, [
    { id: "L1", description: "send Lee the invoice", direction: "i_owe", counterparty: "Lee" },
    { id: "L2", description: "book the venue", direction: "stalled", counterparty: null },
  ]);
  expect(p).toContain("TRACKED LOOPS (already on the user's list):\n"
    + "L1: [i_owe] send Lee the invoice (with Lee)\n"
    + "L2: [stalled] book the venue\n");

  const none = buildLoopPrompt("You: sent the invoice", ctx);
  expect(none).not.toContain("TRACKED LOOPS (already on the user's list)");
  expect(none).toContain('There are no tracked loops. "tracked" is [].');
});

test("userIdentityFromEnv parses name and aliases, and absence", async () => {
  const { userIdentityFromEnv } = await import("../src/provider");
  expect(userIdentityFromEnv({} as any)).toBeUndefined();
  expect(userIdentityFromEnv({ NOVA_USER_NAME: "  " } as any)).toBeUndefined();
  const id = userIdentityFromEnv({
    NOVA_USER_NAME: " Alex ", NOVA_USER_ALIASES: "alex@acme.com, alexr42 , ",
  } as any);
  expect(id).toEqual({ name: "Alex", aliases: ["alex@acme.com", "alexr42"] });
});

// --- F4.4: done / snooze / dismiss ------------------------------------------

test("done moves a loop to user_resolved, distinct from auto_resolved", async () => {
  const { actOnLoop } = await import("../src/loops");
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const id = listOpenLoops(db, KEY)[0]!.id;

  const r = actOnLoop(db, id, "done");
  expect(r.state).toBe("user_resolved");

  const row = db.prepare("SELECT state, resolved_at FROM open_loops WHERE id=?").get(id) as any;
  // user_resolved, never auto_resolved: F4.5 wants to measure how often the
  // user beats the resolver, and that needs the two kept apart.
  expect(row.state).toBe("user_resolved");
  expect(row.resolved_at).toBeGreaterThan(0);
  expect(listOpenLoops(db, KEY).length).toBe(0);
});

test("snooze hides a loop until the given time, then it returns", async () => {
  const { actOnLoop } = await import("../src/loops");
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const id = listOpenLoops(db, KEY)[0]!.id;

  const until = Date.now() + 60_000;
  expect(actOnLoop(db, id, "snooze", until).state).toBe("snoozed");
  expect(listOpenLoops(db, KEY).length).toBe(0);

  // Simulate the clock passing: listOpenLoops compares against Date.now(), so
  // move snoozed_until into the past rather than mocking time.
  db.prepare("UPDATE open_loops SET snoozed_until=? WHERE id=?").run(Date.now() - 1, id);
  expect(listOpenLoops(db, KEY).length).toBe(1);
});

test("snooze without a time defaults to the next 09:00 local", async () => {
  const { actOnLoop, nextNineAmLocal } = await import("../src/loops");
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const id = listOpenLoops(db, KEY)[0]!.id;

  const before = Date.now();
  actOnLoop(db, id, "snooze");
  const row = db.prepare("SELECT snoozed_until FROM open_loops WHERE id=?").get(id) as any;
  const d = new Date(row.snoozed_until);
  expect(d.getHours()).toBe(9);
  expect(d.getMinutes()).toBe(0);
  expect(row.snoozed_until).toBeGreaterThan(before);
  expect(row.snoozed_until).toBe(nextNineAmLocal(new Date(before)));
});

test("nextNineAmLocal rolls to tomorrow once today's 09:00 has passed", async () => {
  const { nextNineAmLocal } = await import("../src/loops");
  const at0830 = new Date(2026, 8, 21, 8, 30);    // 21 Sep 2026 08:30 local
  const at0930 = new Date(2026, 8, 21, 9, 30);
  expect(new Date(nextNineAmLocal(at0830)).getDate()).toBe(21);
  expect(new Date(nextNineAmLocal(at0930)).getDate()).toBe(22);
  expect(new Date(nextNineAmLocal(at0930)).getHours()).toBe(9);
});

test("dismiss is permanent: the same commitment never comes back", async () => {
  const { actOnLoop } = await import("../src/loops");
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const id = listOpenLoops(db, KEY)[0]!.id;

  expect(actOnLoop(db, id, "dismiss").state).toBe("dismissed");
  expect(listOpenLoops(db, KEY).length).toBe(0);

  // F4.4 says "never suggest again". The dismissed row keeps its dedup_key, so
  // re-extracting the same commitment tomorrow hits ON CONFLICT DO NOTHING.
  // This is the property that makes dismiss trustworthy, and it is a test
  // rather than a hope.
  expect(await recordLoops(db, KEY, [commitment], null)).toBe(0);
  expect(listOpenLoops(db, KEY).length).toBe(0);
  const row = db.prepare("SELECT state FROM open_loops WHERE id=?").get(id) as any;
  expect(row.state).toBe("dismissed");
});

test("acting on a non-actionable loop throws with the state, not a silent no-op", async () => {
  const { actOnLoop, LoopNotActionable } = await import("../src/loops");
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const id = listOpenLoops(db, KEY)[0]!.id;
  actOnLoop(db, id, "dismiss");

  let err: any;
  try { actOnLoop(db, id, "done"); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(LoopNotActionable);
  expect(err.state).toBe("dismissed");
  expect(String(err.message)).toContain("dismissed");
});

test("acting on an unknown id throws with state null", async () => {
  const { actOnLoop, LoopNotActionable } = await import("../src/loops");
  const db = await openDb(":memory:");
  let err: any;
  try { actOnLoop(db, "no-such-id", "done"); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(LoopNotActionable);
  expect(err.state).toBeNull();
});

test("a snoozed loop can still be done or dismissed", async () => {
  const { actOnLoop } = await import("../src/loops");
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const id = listOpenLoops(db, KEY)[0]!.id;
  actOnLoop(db, id, "snooze", Date.now() + 60_000);
  // Snoozed is still actionable: the user may decide it's done before it returns.
  expect(actOnLoop(db, id, "done").state).toBe("user_resolved");
});

// --- D17: snooze means "stop processing until later" ----------------------

test("an expired snooze returns to open so it can be reconsidered", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const id = (db.prepare("SELECT id FROM open_loops").get() as any).id;

  // Snooze into the past: the moment it is due to be seen again.
  db.prepare("UPDATE open_loops SET state='snoozed', snoozed_until=? WHERE id=?")
    .run(Date.now() - 1000, id);

  expect(wakeExpiredSnoozes(db)).toBe(1);
  const row = db.prepare("SELECT state, snoozed_until FROM open_loops WHERE id=?").get(id) as any;
  expect(row.state).toBe("open");
  expect(row.snoozed_until).toBeNull();
});

test("a snooze that has not expired is left alone", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const id = (db.prepare("SELECT id FROM open_loops").get() as any).id;
  db.prepare("UPDATE open_loops SET state='snoozed', snoozed_until=? WHERE id=?")
    .run(Date.now() + 3_600_000, id);

  expect(wakeExpiredSnoozes(db)).toBe(0);
  expect((db.prepare("SELECT state FROM open_loops WHERE id=?").get(id) as any).state)
    .toBe("snoozed");
});

test("work finished during a snooze closes the loop instead of resurfacing it", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const id = (db.prepare("SELECT id FROM open_loops").get() as any).id;
  db.prepare("UPDATE open_loops SET state='snoozed', snoozed_until=? WHERE id=?")
    .run(Date.now() - 1000, id);

  // The D17 scenario end to end: snooze a loop, finish the thing it tracks,
  // and the next capture closes it rather than showing it again.
  const { tracked, storeIds } = trackedLoops(db, KEY);
  expect(tracked.map((l) => l.id)).toEqual(["L1"]);
  expect(closeLoops(db, KEY, storeIds, [{ id: "L1", evidence: "done" }], null)).toEqual([id]);
  expect(listOpenLoops(db, KEY).length).toBe(0);
});

test("a live snooze is not offered, so nothing can close it", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const id = (db.prepare("SELECT id FROM open_loops").get() as any).id;
  db.prepare("UPDATE open_loops SET state='snoozed', snoozed_until=? WHERE id=?")
    .run(Date.now() + 3_600_000, id);

  // "Stop processing until later" is the whole point: a loop still snoozed is
  // not being watched, even by content that would otherwise close it.
  const { tracked, storeIds } = trackedLoops(db, KEY);
  expect(tracked).toEqual([]);
  expect(closeLoops(db, KEY, storeIds, [{ id: "L1", evidence: "done" }], null)).toEqual([]);
  expect((db.prepare("SELECT state FROM open_loops WHERE id=?").get(id) as any).state)
    .toBe("snoozed");
});

// --- F4.5: the user's verdict ------------------------------------------------

test("a real verdict is stored and listed, and can be cleared", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const id = listOpenLoops(db, KEY)[0]!.id;
  expect(listOpenLoops(db, KEY)[0]!.feedback).toBeNull();

  expect(rateLoop(db, id, 1)).toEqual({ feedback: 1, state: "open" });
  expect(listOpenLoops(db, KEY)[0]!.feedback).toBe(1);

  rateLoop(db, id, null);
  expect(listOpenLoops(db, KEY)[0]!.feedback).toBeNull();
});

test("a not-real verdict dismisses the loop, and it is not raised again", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const id = listOpenLoops(db, KEY)[0]!.id;

  expect(rateLoop(db, id, -1)).toEqual({ feedback: -1, state: "dismissed" });
  expect(listOpenLoops(db, KEY).length).toBe(0);
  // The same false loop extracted again hits the kept dedup_key.
  expect(await recordLoops(db, KEY, [commitment], null)).toBe(0);
});

test("a closed loop can still be rated, and keeps its state", async () => {
  const db = await openDb(":memory:");
  await recordLoops(db, KEY, [commitment], null);
  const id = listOpenLoops(db, KEY)[0]!.id;
  actOnLoop(db, id, "done");
  expect(rateLoop(db, id, -1)).toEqual({ feedback: -1, state: "user_resolved" });
});

test("rating an unknown loop says it does not exist", async () => {
  const db = await openDb(":memory:");
  expect(() => rateLoop(db, "nope", 1)).toThrow("does not exist");
});

test("precision is real over rated, overall and by direction", async () => {
  const db = await openDb(":memory:");
  expect(loopPrecision(db).precision).toBeNull();
  await recordLoops(db, KEY, [
    commitment,
    { ...commitment, description: "send Dana the deck" },
    { ...commitment, description: "Dana will send the doc", direction: "owed_to_me" },
    { ...commitment, description: "an unrated one" },
  ], null);
  const byDesc = Object.fromEntries(listOpenLoops(db, KEY).map((l) => [l.description, l.id]));
  rateLoop(db, byDesc[commitment.description]!, 1);
  rateLoop(db, byDesc["send Dana the deck"]!, -1);
  rateLoop(db, byDesc["Dana will send the doc"]!, 1);

  const p = loopPrecision(db);
  expect(p.real).toBe(2);
  expect(p.notReal).toBe(1);
  expect(p.precision).toBeCloseTo(2 / 3);
  expect(p.byDirection.i_owe).toEqual({ real: 1, notReal: 1 });
  expect(p.byDirection.owed_to_me).toEqual({ real: 1, notReal: 0 });
});
