// Keeps credentials out of the store and away from providers (D1).
//
// Two layers, applied at ingest before anything is stored or sent:
//
//   - A source that exists to show secrets (a password manager, a vault) is
//     refused whole. Its list renders as ordinary text, so the AX reader's
//     AXSecureTextField exclusion never sees it: measured 2026-09-15, a Chrome
//     password-manager page gave 9 memories mapping eight accounts to hosts.
//   - Anywhere else, credential-shaped spans are replaced with REDACTED. A
//     Slack DM gave a memory holding a live shared password, and nothing about
//     the source would have predicted it.
//
// Every pattern here is meant to be precise rather than broad: a redaction
// the user did not need costs a word of context, but a pattern that fires on
// ordinary prose would quietly erase what Nova exists to remember. None of
// them matches text they have already redacted, so redacting twice is a no-op.

export const REDACTED = "[redacted]";

/** Apps whose whole purpose is holding secrets. */
const DENIED_APPS = new Set([
  "1Password", "1Password 7", "Bitwarden", "KeePassXC", "Keychain Access",
  "Passwords", "Dashlane", "LastPass", "Enpass", "Proton Pass",
]);

/** Browser pages that list saved passwords or vault contents. */
const DENIED_URLS: RegExp[] = [
  /^(chrome|brave|edge|arc|vivaldi|opera):\/\/(settings\/passwords|password-manager)/i,
  /^about:logins/i,
  /^https:\/\/passwords\.google\.com/i,
  /^https:\/\/([a-z0-9-]+\.)?1password\.(com|eu|ca)\//i,
  /^https:\/\/vault\.bitwarden\.(com|eu)/i,
  /^https:\/\/([a-z0-9-]+\.)?lastpass\.com\/vault/i,
  /^https:\/\/app\.dashlane\.com/i,
  /^https:\/\/pass\.proton\.me/i,
];

const DENIED_TITLES = /\b(password manager|google password|keychain access)\b/i;

/**
 * Banking and payment sites (D21, architecture §4: non-overridable). Matched
 * on the host, never on prose: a title test would refuse a Slack thread about
 * chasing a bug, and "chase" is a bank.
 */
const DENIED_HOSTS: RegExp[] = [
  // Indian retail banking, where netbanking.* is the common login host.
  /^(netbanking|retail|online|secure)\./i,
  /\b(hdfcbank|icicibank|axisbank|sbi|kotak|yesbank|idfcfirstbank|indusind|pnbindia|bankofbaroda|canarabank)\.(com|co\.in|in)$/i,
  // US/EU retail banking and payments.
  /\b(chase|bankofamerica|wellsfargo|citibank|capitalone|usbank|pnc|truist|schwab|fidelity|vanguard)\.com$/i,
  /\b(hsbc|barclays|lloydsbank|natwest|santander|revolut|monzo|starlingbank|n26|wise)\.(com|co\.uk|de)$/i,
  /\b(paypal|stripe|squareup|razorpay|payu|billdesk|phonepe|paytm)\.(com|in)$/i,
];

/** Apps that are a bank or a payment surface in their own right. */
const DENIED_FINANCE_APPS = /\b(banking|netbanking)\b/i;

/**
 * A private-browsing window, by the marker the browser itself puts in the
 * title.
 *
 * The marker has to END the title (or be followed by a separator): Safari's
 * own title is "Safari Private Browsing", with no separator before it, so
 * requiring one on the left missed the most common case outright. Anchoring
 * on the right instead still leaves an article *about* incognito mode
 * readable, because prose continues past the phrase.
 */
const PRIVATE_BROWSING =
  /\b(incognito|private browsing|private window|inprivate)\b(\s*[-—|·].*)?$/i;

/**
 * A live screen share. The whole window is refused, not because its own
 * content is sensitive, but because what is on screen is being shown to other
 * people and may be anything.
 */
const SHARING_APPS = new Set([
  "zoom.us", "Zoom", "Microsoft Teams", "Webex", "Webex Meetings",
  "Google Meet", "Slack Huddle", "Around", "Whereby", "GoToMeeting",
  "join.me", "AnyDesk", "TeamViewer", "Chrome Remote Desktop", "Screens",
]);
const SHARING_HOSTS = /\b(meet\.google\.com|zoom\.us|teams\.microsoft\.com|whereby\.com|webex\.com)$/i;
const SHARING_TITLES = /\b(zoom meeting|teams meeting|is sharing (your|the) screen|you are sharing|screen sharing)\b/i;

function host(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

/**
 * The stable identity of a hard-exclusion category.
 *
 * Separate from the human-readable reason because two different things need
 * two different strings: the log wants "banking site", and the skip counter
 * and the Blocked apps pane want a key that survives a reworded message.
 */
export type HardRuleId =
  | "password-managers" | "banking" | "private-browsing" | "screen-sharing";

export interface Denial {
  /** The category, for counting and for the pane. */
  rule: HardRuleId;
  /** What to say in a log line. */
  reason: string;
}

/**
 * Why a capture's source must not be read at all, or null when it may be.
 *
 * Everything here is non-overridable by design (architecture §4): the user
 * deny-list is a separate, additive layer, and nothing subtracts from this
 * one. The order is cheapest first, and a refusal names its reason because
 * `ingest` counts refusals by reason and a silent one would be unexplainable.
 */
export function deniedSourceRule(
  app: string, url: string | null | undefined, title: string,
): Denial | null {
  if (DENIED_APPS.has(app)) return { rule: "password-managers", reason: `app ${app}` };
  if (DENIED_FINANCE_APPS.test(app)) return { rule: "banking", reason: `banking app ${app}` };
  if (SHARING_APPS.has(app)) return { rule: "screen-sharing", reason: `screen sharing (${app})` };
  if (DENIED_TITLES.test(title)) return { rule: "password-managers", reason: "password window" };
  if (PRIVATE_BROWSING.test(title)) return { rule: "private-browsing", reason: "private browsing" };
  if (SHARING_TITLES.test(title)) return { rule: "screen-sharing", reason: "screen sharing" };
  if (url) {
    if (DENIED_URLS.some((r) => r.test(url)))
      return { rule: "password-managers", reason: "password page" };
    const h = host(url);
    if (h && SHARING_HOSTS.test(h)) return { rule: "screen-sharing", reason: "screen sharing" };
    if (h && DENIED_HOSTS.some((r) => r.test(h)))
      return { rule: "banking", reason: "banking site" };
  }
  return null;
}

/** The reason alone, for the callers that only log or branch on it. */
export function deniedSource(
  app: string, url: string | null | undefined, title: string,
): string | null {
  return deniedSourceRule(app, url, title)?.reason ?? null;
}

/**
 * Tokens with a vendor prefix. Each is specific enough that a match is a key,
 * not a word that happens to look like one.
 */
const TOKENS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g,           // Anthropic, OpenAI
  /\bAKIA[0-9A-Z]{16}\b/g,                              // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,                    // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,                      // GitLab
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,                  // Slack
  /\bAIza[0-9A-Za-z_-]{35}\b/g,                         // Google API key
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
];

/**
 * A secret named by its label: "password: hunter2", "API_KEY=abc…",
 * "Bearer abc…". The separator is required, so "forgot password?" and
 * "token count" are left alone. The label is kept; only the value goes.
 *
 * The value must hold a digit or a symbol. Apple's sign-in prompt reads "The
 * password is only used to…", and a README heading reads "Secrets: export…":
 * on the live store (2026-09-23) every all-letter value was an English word.
 */
const LABELLED =
  /(\b(?:[A-Za-z0-9_]*(?:password|passwd|pwd|passcode|secret|api[_ -]?key|access[_ -]?token|auth[_ -]?token|client[_ -]?secret|private[_ -]?key)[A-Za-z0-9_]*)\s*(?:is|=|:)\s*["'`]?)((?=[^\s"'`,;]*[^A-Za-z\s"'`,;])(?!\[redacted\])[^\s"'`,;]{4,})/gi;

const BEARER = /(\bBearer\s+)([A-Za-z0-9._~+/-]{16,}=*)/g;

/**
 * "user@host / s3cret!" or "user@host : s3cret!": an account paired with the
 * credential that opens it, the shape of the Slack DM in D1. The value must
 * mix letters with digits or symbols, which a following English word does not,
 * and the domain must end in letters, so "python@3.10/…" is a path, not an
 * account.
 */
const ACCOUNT_PAIR =
  /(\b[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}\s*[/:|]\s*)((?!\[redacted\])(?=[^\s]*[A-Za-z])(?=[^\s]*[\d!@#$%^&*])[^\s,;]{6,})/g;

/** A line that asks for or announces a one-time code. */
const CODE_REQUEST = /\b(otp|2fa|mfa|one[- ]time|verification code|security code|passcode|auth(?:entication)? code)\b/i;
/**
 * A line whose message is only a 4–8 digit code, as a chat app prints it:
 * "Alex: 817930. 1:47 PM." now, "1:47 PM 817930" in older captures.
 */
const CODE_REPLY =
  /^((?:\d{1,2}:\d{2}\s*(?:AM|PM)\s+|[^:\n]{1,40}:\s*)?)(\d{4,8})(\.?\s*(?:\d{1,2}:\d{2}\s*(?:AM|PM)\.?)?\s*)$/i;
/** A code written next to its name: "OTP 817930 was provided". */
const NAMED_CODE =
  /(\b(?:otp|2fa code|mfa code|verification code|security code|auth(?:entication)? code|passcode)\s*(?:is|:|=)?\s*)(\d{4,8})\b/gi;
const CODE_WINDOW = 3;

// --- Personal data (D21) --------------------------------------------------
//
// Same standard as the credential rules: precise over broad. A card number is
// only redacted when it passes Luhn, an account number only when something
// names it as one. The identifiers below (Aadhaar, PAN, SSN) have checkable
// shapes distinctive enough to stand on their own.
//
// Emails and phone numbers are deliberately NOT here. Redacting them locally
// would erase who the user talked to, which is what Nova exists to remember,
// and loop direction depends on it. They are stripped from what goes to the
// providers instead — see `redactOutbound`.

/**
 * 13–19 digits, optionally in groups, as a card is written. The lookarounds
 * make the match consume the *whole* digit run: without them the quantifier
 * finds a shorter Luhn-valid window inside a longer number, and
 * "ref 4111 1111 1111 1112" lost its first twelve digits to a card that was
 * never there.
 */
const CARD_CANDIDATE = /\d[\d -]*\d/g;

/**
 * Luhn alone is not enough to call a number a card: it is a checksum one in
 * ten arbitrary numbers passes, and an Indian bank account number in the live
 * sample (`50100123456789`, 14 digits) passed it. Requiring a real issuer
 * prefix and a length that issuer actually uses is what separates a card from
 * a long number that happens to check out.
 */
const ISSUER =
  /^(?:4\d{12}(?:\d{3}|\d{6})?|5[1-5]\d{14}|2(?:2[2-9]\d|[3-6]\d\d|7[01]\d|720)\d{12}|3[47]\d{13}|6(?:011|5\d\d|4[4-9]\d)\d{12}|(?:2131|1800|35\d\d)\d{11})$/;

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Aadhaar: 12 digits as 3 groups of 4. Verhoeff is not checked; the shape plus
 * the grouping is already specific, and a bare 12-digit run is left alone.
 *
 * The lookaround rejects a run that continues: a 16-digit card is written in
 * exactly this grouping, and its first three groups are an Aadhaar shape. A
 * card that fails Luhn must stay whole rather than lose twelve digits here.
 */
const AADHAAR = /(?<![\d-])(?<!\d )\d{4}\s\d{4}\s\d{4}(?! *[\d-])/g;
/**
 * PAN: five letters, four digits, one letter — but that shape is also an
 * ordinary ticket or SKU ("ticket ABCDE1234F"), so a bare match is not a
 * claim. The real PAN encodes its holder type in the fourth character, and
 * is named in practice; requiring either the label or a P/C/H/F/A/T/B/L/J/G
 * fourth character keeps the common disclosure and drops the SKU.
 */
const PAN = /(\bpan\s*(?:no\.?|number|card|#)?\s*(?:is|=|:)?\s*)([A-Z]{5}\d{4}[A-Z])\b|\b([A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z])\b/gi;
/** US SSN, hyphenated only: a bare 9-digit run is far too common to claim. */
const SSN = /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g;

/** An account number is only a claim when something names it as one. */
const ACCOUNT_LABELLED =
  /(\b(?:a\/c|acct|account|ifsc|iban|sort[- ]code|routing)\s*(?:no\.?|number|#)?\s*(?:is|=|:)?\s*)((?!\[redacted\])[A-Z0-9]{8,24})\b/gi;
/** An IFSC next to a bare number: the pair is the disclosure. */
const IFSC = /\b[A-Z]{4}0[A-Z0-9]{6}\b/g;
const BARE_LONG_NUMBER = /\b\d{9,18}\b/g;

/** CVV and expiry, which are only meaningful beside a card. */
const CVV = /(\b(?:cvv|cvc|cvv2|security code)\s*(?:is|=|:)?\s*)(\d{3,4})\b/gi;

function redactPersonal(text: string, bump: () => void): string {
  // CARD_CANDIDATE takes the whole digit run and the length check is applied
  // to all of it, so a Luhn-valid window inside a longer number is never
  // mistaken for a card: "ref 4111 1111 1111 1112" is 16 digits that fail,
  // not 12 digits that pass.
  let out = text.replace(CARD_CANDIDATE, (m) => {
    const digits = m.replace(/[^\d]/g, "");
    if (!ISSUER.test(digits) || !luhnValid(digits)) return m;
    bump();
    return REDACTED;
  });

  // An IFSC names every long number on its line as an account number. This
  // runs before ACCOUNT_LABELLED, which would otherwise consume "IFSC <code>"
  // as a labelled value and leave the account number it was paired with.
  out = out
    .split("\n")
    .map((line) => {
      IFSC.lastIndex = 0;
      if (!IFSC.test(line)) return line;
      return line.replace(BARE_LONG_NUMBER, () => {
        bump();
        return REDACTED;
      });
    })
    .join("\n");

  out = out.replace(ACCOUNT_LABELLED, (_m, label: string) => { bump(); return label + REDACTED; });
  out = out.replace(AADHAAR, () => { bump(); return REDACTED; });
  out = out.replace(PAN, (_m, label: string | undefined) => {
    bump();
    return label ? label + REDACTED : REDACTED;
  });
  out = out.replace(SSN, () => { bump(); return REDACTED; });
  out = out.replace(CVV, (_m, label: string) => { bump(); return label + REDACTED; });
  return out;
}

export interface Redaction { text: string; count: number }

/** Replaces credential-shaped spans with REDACTED, and counts them. */
export function redactSecrets(text: string): Redaction {
  let count = 0;
  let out = text;
  for (const r of TOKENS) {
    out = out.replace(r, () => { count++; return REDACTED; });
  }
  out = out.replace(LABELLED, (_m, label: string) => { count++; return label + REDACTED; });
  out = out.replace(BEARER, (_m, label: string) => { count++; return label + REDACTED; });
  out = out.replace(ACCOUNT_PAIR, (_m, account: string) => { count++; return account + REDACTED; });
  out = out.replace(NAMED_CODE, (_m, label: string) => { count++; return label + REDACTED; });
  out = redactPersonal(out, () => { count++; });

  // A bare code is only a secret next to the request for it: "otp pls?"
  // answered by "817930" two minutes later. Anywhere else a six-digit number
  // is a ticket, an amount or a build, and stays.
  const lines = out.split("\n");
  let sinceRequest = Infinity;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = sinceRequest <= CODE_WINDOW ? CODE_REPLY.exec(line) : null;
    if (m) {
      lines[i] = `${m[1]}${REDACTED}${m[3]}`;
      count++;
    }
    sinceRequest = CODE_REQUEST.test(line) ? 1 : sinceRequest + 1;
  }
  return { text: count > 0 ? lines.join("\n") : text, count };
}

// --- Outbound-only redaction (D21 item 3) --------------------------------
//
// Emails and phone numbers are a decision, not a pattern. Redacting them from
// the store would erase who the user talked to, which is what Nova exists to
// remember and what loop direction is derived from. Keeping them in the store
// and stripping them from what leaves the machine gets both: the memory still
// names the person, and the provider never sees their contact details.
//
// This is the last thing applied before an outbound call, so it runs over text
// that `redactSecrets` has already been through at ingest. The name beside the
// address is deliberately kept — "Jordan: mail me at [email]" still attributes
// the line.

/** An email address. The local part may hold dots, plus-tags and dashes. */
const EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}\b/g;

/**
 * A phone number: an optional country code then 7–14 digits in the groupings
 * people actually write. Anchored away from decimals and bare digit runs so a
 * version string, a build number, a date or an amount is not a phone number.
 */
const PHONE =
  /(?<![\d.\w])(?:\+\d{1,3}[ -]?)?(?:\(\d{2,4}\)[ -]?|\d{2,5}[ -])\d{3,5}[ -]?\d{3,5}(?![\d.])/g;

export const REDACTED_EMAIL = "[email]";
export const REDACTED_PHONE = "[phone]";

/**
 * Strips contact details from text on its way to a provider. Never applied to
 * what is stored.
 *
 * Loop evidence must stay a verbatim quote of what the model was shown, so
 * this must be applied once, before both the prompt and the quote gate read
 * the text — see `extractLoops`. Redacting only the prompt would make every
 * loop quoting one of these lines fail its gate and vanish.
 */
export function redactOutbound(text: string): string {
  return text
    .replace(EMAIL, REDACTED_EMAIL)
    .replace(PHONE, (m) => (/\d{7,}/.test(m.replace(/[^\d]/g, "")) ? REDACTED_PHONE : m));
}
