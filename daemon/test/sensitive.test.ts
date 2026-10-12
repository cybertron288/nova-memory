import { test, expect } from "bun:test";
import { openDb, encryptField, decryptField } from "../src/db";
import { handleLine } from "../src/ingest";
import { purgeSecrets } from "../src/purge";
import { deniedSource, redactSecrets, redactOutbound } from "../src/sensitive";
import { randomBytes } from "node:crypto";

const KEY = randomBytes(32);

test("password managers and vault pages are refused whole", () => {
  expect(deniedSource("1Password", null, "All Items")).toBe("app 1Password");
  expect(deniedSource("Passwords", null, "Passwords")).toBe("app Passwords");
  expect(deniedSource("Google Chrome", "chrome://password-manager/passwords", "Passwords")).toBe("password page");
  expect(deniedSource("Google Chrome", "https://passwords.google.com/", "x")).toBe("password page");
  expect(deniedSource("Google Chrome", "https://vault.bitwarden.com/#/vault", "x")).toBe("password page");
  expect(deniedSource("Google Chrome", null, "Google Password Manager")).toBe("password window");
  expect(deniedSource("Slack", null, "Dana Reyes (DM)")).toBeNull();
  expect(deniedSource("Google Chrome", "https://appstoreconnect.apple.com/login", "App Store Connect")).toBeNull();
});

test("vendor tokens and labelled secrets are redacted, labels kept", () => {
  const r = redactSecrets([
    `export GEMINI_API_KEY="AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q"`,
    "ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuv",
    "//registry.npmjs.org/:_authToken=npm_abcdefghijklmnopqrstuvwxyz0123456789",
    "Authorization: Bearer abcdef0123456789abcdef",
    "Password: Test@1234",
  ].join("\n"));
  expect(r.text).toBe([
    `export GEMINI_API_KEY="[redacted]"`,
    "ANTHROPIC_API_KEY=[redacted]",
    "//registry.npmjs.org/:_authToken=[redacted]",
    "Authorization: Bearer [redacted]",
    "Password: [redacted]",
  ].join("\n"));
  expect(r.count).toBe(5);
});

test("an account paired with its credential loses the credential", () => {
  expect(redactSecrets("use test_distributor@acme.com / Dist@2024 for now").text)
    .toBe("use test_distributor@acme.com / [redacted] for now");
});

test("prose that only mentions passwords is left alone", () => {
  const prose = [
    "The password is only used to authenticate with Apple servers.",
    "Secrets: export DEEPGRAM_API_KEY plus an inference provider",
    "Forgot password? Reset it from settings.",
    `File "/opt/homebrew/Cellar/python@3.10/3.10.14/lib/python3.10/site.py", line 12`,
    "Build 5cee51b9 finished in 482113 ms",
  ].join("\n");
  expect(redactSecrets(prose)).toEqual({ text: prose, count: 0 });
});

test("a one-time code is redacted only next to the request for it", () => {
  expect(redactSecrets("Taylor: otp pls? 1:46 PM.\nAlex: 817930. 1:47 PM.").text)
    .toBe("Taylor: otp pls? 1:46 PM.\nAlex: [redacted]. 1:47 PM.");
  expect(redactSecrets("1:46 PM otp pls?\n1:47 PM 817930").text)
    .toBe("1:46 PM otp pls?\n1:47 PM [redacted]");
  expect(redactSecrets("The Apple ID OTP 817930 was provided.").text)
    .toBe("The Apple ID OTP [redacted] was provided.");
  const unrelated = "Ticket count\n482113";
  expect(redactSecrets(unrelated).text).toBe(unrelated);
});

test("redacting twice changes nothing", () => {
  const once = redactSecrets("Password: Test@1234 and a@b.com / Xy9!long").text;
  expect(redactSecrets(once)).toEqual({ text: once, count: 0 });
});

const line = (over: Record<string, unknown> = {}) => JSON.stringify({
  ts: Date.now(), app: "Slack", bundleId: "com.tinyspeck.slackmacgap",
  windowTitle: "Taylor (DM)", url: null,
  content: "Taylor: otp pls? 1:46 PM.\nAlex: 817930. 1:47 PM.", contentHash: "sha256:a",
  treeHash: "sha256:b", ...over,
});

test("ingest stores the capture with its secrets redacted", async () => {
  const db = await openDb(":memory:");
  expect(handleLine(db, KEY, line()).stored).toBe(true);
  const v = db.prepare("SELECT content FROM memory_versions").get() as { content: string };
  expect(decryptField(v.content, KEY)).toBe("Taylor: otp pls? 1:46 PM.\nAlex: [redacted]. 1:47 PM.");
});

test("ingest refuses a password manager with a reason, storing nothing", async () => {
  const db = await openDb(":memory:");
  const r = handleLine(db, KEY, line({
    app: "Google Chrome", url: "chrome://password-manager/passwords", windowTitle: "Passwords",
    content: "app0 alex@acme.com",
  }));
  expect(r).toEqual({ stored: false, reason: "sensitive-source" });
  expect((db.prepare("SELECT COUNT(*) c FROM memory_threads").get() as any).c).toBe(0);
});

test("purge redacts stored captures, memories and loops, and deletes vault threads", async () => {
  const db = await openDb(":memory:");
  handleLine(db, KEY, line({ content: "Slack text" }));
  const thread = db.prepare("SELECT id FROM memory_threads").get() as { id: string };
  const version = db.prepare("SELECT id FROM memory_versions").get() as { id: string };
  // Written as a store from before ingest redacted anything.
  db.prepare("UPDATE memory_versions SET content=? WHERE id=?")
    .run(encryptField("Password: Test@1234", KEY), version.id);
  db.prepare(`INSERT INTO memory_derivatives (id, thread_id, version_id, content, content_hash, committed_at)
              VALUES ('d1', ?, ?, ?, 'h', 0)`)
    .run(thread.id, version.id, encryptField("The Apple ID OTP 817930 was provided.", KEY));
  db.prepare(`INSERT INTO open_loops (id, created_at, description, direction, state, closure_sig, dedup_key)
              VALUES ('l1', 0, ?, 'i_owe', 'open', ?, 'k')`)
    .run(encryptField("send Taylor the OTP 817930", KEY), encryptField("the OTP was sent", KEY));
  db.prepare(`INSERT INTO memory_threads (id, source_app, source_key, source_title, created_at, updated_at)
              VALUES ('vault', '1Password', 'k2', ?, 0, 0)`).run(encryptField("All Items", KEY));

  expect(purgeSecrets(db, KEY)).toEqual({ threads: 1, versions: 1, memories: 1, loops: 1 });

  const v = db.prepare("SELECT content FROM memory_versions").get() as { content: string };
  expect(decryptField(v.content, KEY)).toBe("Password: [redacted]");
  const d = db.prepare("SELECT content FROM memory_derivatives").get() as { content: string };
  expect(decryptField(d.content, KEY)).toBe("The Apple ID OTP [redacted] was provided.");
  const l = db.prepare("SELECT description FROM open_loops").get() as { description: string };
  expect(decryptField(l.description, KEY)).toBe("send Taylor the OTP [redacted]");
  expect(db.prepare("SELECT id FROM memory_threads WHERE id='vault'").get()).toBeNull();

  expect(purgeSecrets(db, KEY)).toEqual({ threads: 0, versions: 0, memories: 0, loops: 0 });
});

// --- D21: hard exclusions -------------------------------------------------

test("banking apps and sites are refused, and the refusal is not overridable", () => {
  expect(deniedSource("Chrome", "https://netbanking.hdfcbank.com/accounts", "HDFC")).not.toBeNull();
  expect(deniedSource("Chrome", "https://www.icicibank.com/login", "ICICI")).not.toBeNull();
  expect(deniedSource("Chrome", "https://chase.com/banking", "Chase")).not.toBeNull();
  expect(deniedSource("Chrome", "https://paypal.com/myaccount", "PayPal")).not.toBeNull();
});

test("a bank's name in ordinary prose is not a banking source", () => {
  expect(deniedSource("Slack", "https://app.slack.com/client/T1", "general")).toBeNull();
  expect(deniedSource("Chrome", "https://news.ycombinator.com/item?id=1", "chase the bug")).toBeNull();
});

test("private browsing windows are refused whatever the app", () => {
  expect(deniedSource("Google Chrome", null, "Gmail - Incognito")).not.toBeNull();
  expect(deniedSource("Safari", null, "Private Browsing")).not.toBeNull();
  expect(deniedSource("Firefox", null, "Reddit — Private Browsing")).not.toBeNull();
  // The titles the browsers actually produce. "Safari Private Browsing" has
  // no separator before the marker, and an earlier rule that required one on
  // the left let the most common case through (found 2026-10-07).
  expect(deniedSource("Safari", null, "Safari Private Browsing")).not.toBeNull();
  expect(deniedSource("Google Chrome", null, "Incognito - Google Chrome")).not.toBeNull();
  expect(deniedSource("Microsoft Edge", null, "InPrivate - Edge")).not.toBeNull();
});

test("screen-sharing sessions are refused", () => {
  expect(deniedSource("zoom.us", null, "Zoom Meeting")).not.toBeNull();
  expect(deniedSource("Microsoft Teams", null, "Teams Meeting")).not.toBeNull();
  expect(deniedSource("Google Chrome", "https://meet.google.com/abc-defg-hij", "Meet")).not.toBeNull();
});

test("the word incognito inside page content does not refuse the source", () => {
  expect(deniedSource("Chrome", "https://example.com/blog", "How incognito mode works")).toBeNull();
});

// --- D21: personal-data redaction ----------------------------------------

test("card numbers go only when they pass the Luhn check", () => {
  const good = redactSecrets("card 4111 1111 1111 1111 exp 12/27");
  expect(good.text).not.toContain("4111 1111 1111 1111");
  expect(good.count).toBeGreaterThan(0);
  // One digit off: not a card, so it stays.
  expect(redactSecrets("ref 4111 1111 1111 1112 filed").text).toContain("4111 1111 1111 1112");
});

test("a long ordinary number is not a card", () => {
  expect(redactSecrets("build 1234567890123456 passed").text).toContain("1234567890123456");
});

test("Aadhaar, PAN and SSN are redacted", () => {
  expect(redactSecrets("Aadhaar 1234 5678 9012").text).not.toContain("1234 5678 9012");
  expect(redactSecrets("PAN ABCDE1234F here").text).not.toContain("ABCDE1234F");
  expect(redactSecrets("SSN 123-45-6789").text).not.toContain("123-45-6789");
});

test("a bank account number goes only when paired with an IFSC or a label", () => {
  const paired = redactSecrets("IFSC HDFC0001234 acct 50100123456789");
  expect(paired.text).not.toContain("50100123456789");
  expect(redactSecrets("order 50100123456789 shipped").text).toContain("50100123456789");
});

test("cvv is redacted next to its label", () => {
  expect(redactSecrets("cvv 123").text).not.toContain("123");
});

test("redacting personal data twice is a no-op", () => {
  const once = redactSecrets("card 4111 1111 1111 1111 and PAN ABCDE1234F").text;
  expect(redactSecrets(once).text).toBe(once);
});

// --- D21: outbound-only redaction ----------------------------------------

test("emails and phone numbers stay in the local store", () => {
  const r = redactSecrets("Jordan: mail me at jordan@example.com or +91 98765 43210");
  expect(r.text).toContain("jordan@example.com");
  expect(r.text).toContain("+91 98765 43210");
});

test("emails and phone numbers are stripped from what providers see", () => {
  const out = redactOutbound("Jordan: mail me at jordan@example.com or +91 98765 43210");
  expect(out).not.toContain("jordan@example.com");
  expect(out).not.toContain("98765 43210");
  // The person stays: loop direction depends on who said what.
  expect(out).toContain("Jordan");
});

test("outbound redaction keeps ordinary text and numbers intact", () => {
  const src = "deploy 1234567890 finished, see PR 4111 and the 10:30 standup";
  expect(redactOutbound(src)).toBe(src);
});

test("outbound redaction is a no-op on already-redacted text", () => {
  const once = redactOutbound("ping bob@example.com now");
  expect(redactOutbound(once)).toBe(once);
});

test("a version number is not a phone number", () => {
  expect(redactOutbound("upgraded to 5.1.2 on 2026-10-06")).toContain("5.1.2");
  expect(redactOutbound("build 20261006 shipped")).toContain("20261006");
});
