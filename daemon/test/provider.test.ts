import { test, expect } from "bun:test";
import { FakeProvider, MalformedResponse, parseMemories, buildExtractPrompt, parseLoops } from "../src/provider";
import { redactOutbound } from "../src/sensitive";

test("parses the memories array out of a model response", () => {
  expect(parseMemories('{"memories":["A did X.","B did Y."]}'))
    .toEqual(["A did X.", "B did Y."]);
  // Models fence JSON even when told not to.
  expect(parseMemories('```json\n{"memories":["A did X."]}\n```'))
    .toEqual(["A did X."]);
});

// Returning [] here committed the version as done and deleted its queue row,
// so a truncated response lost the capture for good. Only {"memories": []} is
// an empty result; anything unreadable throws, and the version is retried.
test("malformed model output throws MalformedResponse instead of reading as no memories", () => {
  const orig = console.error;
  console.error = () => {};
  try {
    expect(() => parseMemories("I could not do that")).toThrow(MalformedResponse);
    expect(() => parseMemories('{"memories": ["cut off mid')).toThrow(MalformedResponse);
    expect(() => parseMemories('{"facts": []}')).toThrow(MalformedResponse);
  } finally {
    console.error = orig;
  }
});

test("the fake provider satisfies the interface", async () => {
  const p = new FakeProvider(["one fact"]);
  expect(await p.extract("anything")).toEqual(["one fact"]);
  const vecs = await p.embed(["a", "b"]);
  expect(vecs.length).toBe(2);
  expect(vecs[0]!.length).toBe(1536);
});

test("fake provider embeddings are content-sensitive, not just length-sensitive", async () => {
  const p = new FakeProvider();
  const [apple] = await p.embed(["apple"]);
  const [zebra] = await p.embed(["zebra"]);
  expect(apple).not.toEqual(zebra);
});

test("fake provider embeddings are deterministic for the same input", async () => {
  const p = new FakeProvider();
  const [a1] = await p.embed(["repeat me"]);
  const [a2] = await p.embed(["repeat me"]);
  expect(a1).toEqual(a2);
});

test("fake provider embeddings are unit vectors", async () => {
  const p = new FakeProvider();
  const [v] = await p.embed(["some text"]);
  let sumSquares = 0;
  for (let i = 0; i < v!.length; i++) sumSquares += v![i]! * v![i]!;
  expect(Math.sqrt(sumSquares)).toBeCloseTo(1, 5);
});

test("a genuinely empty memories result stays silent", () => {
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    expect(parseMemories('{"memories":[]}')).toEqual([]);
  } finally {
    console.error = orig;
  }
  expect(errors.length).toBe(0);
});

test("a genuine parse failure logs a traceable error", () => {
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    expect(() => parseMemories("I could not do that")).toThrow(MalformedResponse);
  } finally {
    console.error = orig;
  }
  expect(errors.length).toBe(1);
});

// --- prompt grounding ------------------------------------------------------
// Without a capture context the model invented both the date and the source.
// Measured 2026-08-25 on real captures: memories dated "June 25, 2025" and
// "2025-01-01" for content captured that morning, and "the user is working on
// a template file in VSCodium" filed against another app, whose window merely showed
// that text.

test("the prompt gives the read date but forbids dating content with it", () => {
  // Measured 2026-09-15: telling the model the capture date was "the only date
  // you know" made it stamp a scrolled Slack backlog with that date — messages
  // actually sent on 27 Aug and 11 Sep were all recorded as 15 Sep. Slack's AX
  // text carries bare clock times ("3:09 PM") and no day separators, so the
  // model cannot know the day and must not pretend to. Invented dates look
  // wrong; confidently misdated ones do not, which makes them worse.
  const p = buildExtractPrompt("some text", {
    app: "Slack", title: "Dana Reyes (DM)", url: null,
    capturedAt: Date.UTC(2026, 8, 15, 5, 35),
  });
  expect(p).toContain("2026-09-15");                    // the read date is stated
  expect(p).toContain("READ on");                       // ...explicitly as a READ
  expect(p).toContain("NOT when the content was");      // ...and not as authorship
  expect(p).toContain("ONLY when the content itself states one");
  expect(p).toContain("is not a date");                 // bare clock times
});

test("the prompt separates the source app from what the text is about", () => {
  const p = buildExtractPrompt("text about VSCodium", {
    app: "Acme Notes", title: "Acme Notes", url: null,
    capturedAt: Date.UTC(2026, 7, 25),
  });
  // The app is named as the source...
  expect(p).toContain('from the application "Acme Notes"');
  // ...and explicitly distinguished from the subject.
  expect(p).toContain("it is not");
  expect(p).toContain("do not rewrite the");
});

test("the prompt omits the URL line when a capture has no URL", () => {
  const withUrl = buildExtractPrompt("t", {
    app: "A", title: "T", url: "https://e.example/p", capturedAt: Date.UTC(2026, 0, 2),
  });
  const without = buildExtractPrompt("t", {
    app: "A", title: "T", url: null, capturedAt: Date.UTC(2026, 0, 2),
  });
  expect(withUrl).toContain("at the URL https://e.example/p");
  expect(without).not.toContain("at the URL");
  expect(without).toContain("2026-01-02");     // the date still lands
});

test("the prompt tells the model to drop interface noise", () => {
  // These exact shapes came back as memories and are worthless for recall:
  // "the user viewed a network tab showing 13 requests", "the page reported
  // total token consumption of 0".
  const p = buildExtractPrompt("t");
  expect(p).toContain("Record substance, not interface");
  expect(p).toContain("the user viewed");
});

test("a context-free prompt still asks for memories, without a date claim", () => {
  const p = buildExtractPrompt("some text");
  expect(p).toContain('{"memories"');
  expect(p).not.toContain("This was captured on");
});

test("with earlier content, the prompt separates it from what is new", () => {
  const p = buildExtractPrompt("Lee: the venue is booked", {
    app: "Slack", title: "Lee (DM)", url: null, capturedAt: Date.UTC(2026, 8, 23),
    earlier: "Lee: looking at venues",
  });
  expect(p).toContain("EARLIER CONTENT (already recorded; context only, extract nothing from it):\n"
    + "Lee: looking at venues\n\n"
    + "NEW CONTENT (extract only what this adds):\nLee: the venue is booked");
  expect(p).not.toContain("CONTENT:\n");

  const plain = buildExtractPrompt("Lee: the venue is booked");
  expect(plain).toContain("CONTENT:\nLee: the venue is booked");
  expect(plain).not.toContain("EARLIER CONTENT");
});

// --- D21: outbound redaction must not break the quote gate ---------------

test("a loop quoting a redacted line survives, because the gate sees what the model saw", () => {
  // The capture holds an address; the model is shown the scrubbed text, so its
  // quote comes back scrubbed too. The gate must compare against the same.
  const capture = "Jordan: send the invoice to accounts@acme.com by Friday";
  const shown = redactOutbound(capture);
  expect(shown).not.toContain("accounts@acme.com");

  const reply = JSON.stringify({
    loops: [{
      description: "send the invoice",
      closure_signature: "the invoice is sent to accounts",
      // Jordan wrote the line, so a request to the user is "unanswered":
      // gate 3 would reject "i_owe" on an author who is not the user.
      direction: "unanswered",
      counterparty: "Jordan",
      evidence: "send the invoice to [email] by Friday",
      // Gate 3 reads the direction against this: Jordan is not the user, so
      // "unanswered" is the direction a request to the user can have.
      author: "Jordan",
      due_signal: "Friday",
    }],
    tracked: [],
  });

  const kept = parseLoops(reply, shown, [], { name: "Alex", aliases: [] });
  expect(kept.loops).toHaveLength(1);
  expect(kept.loops[0]!.description).toBe("send the invoice");

  // The same quote against the UNSCRUBBED capture is what a mismatched seam
  // would do, and the gate correctly refuses it — which is why the scrub has
  // to happen once, before both the prompt and the gate.
  expect(parseLoops(reply, capture, [], { name: "Alex", aliases: [] }).loops).toHaveLength(0);
});
