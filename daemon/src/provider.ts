// The inference seam (spec 5). Two implementations ship: GeminiProvider (the
// original default, native Gemini API) and OpenAICompatProvider (any endpoint
// speaking the OpenAI /chat/completions and /embeddings shapes, with chat and
// embeddings configured independently). Local inference replaces either one
// without touching the pipeline.
import { redactOutbound } from "./sensitive";
import type { NewCall } from "./calls";

/**
 * Where a provider reports what it just sent (F5.5). A callback rather than a
 * store handle, so this module stays unaware of the database and the test
 * fakes need nothing: an absent sink means nothing is recorded.
 *
 * It must never throw — see calls.recordCall.
 */
export type CallSink = (c: NewCall) => void;

export interface InferenceProvider {
  /**
   * `ctx` is optional so existing callers and fakes keep working, but the
   * pipeline always supplies it: without the capture's own date and source app
   * the model invents both (measured 2026-08-25). See buildExtractPrompt.
   */
  extract(versionText: string, ctx?: CaptureContext): Promise<string[]>;
  embed(texts: string[]): Promise<Float32Array[]>;   // 1536-dim
  /**
   * New open-loop candidates from one capture (F4.1), and which of the
   * `tracked` loops the capture shows finished (F4.2). Optional so a provider
   * without it contributes no loops rather than breaking the pipeline.
   */
  extractLoops?(
    versionText: string, ctx?: CaptureContext, tracked?: TrackedLoop[],
  ): Promise<LoopExtraction>;
  /**
   * The morning digest's sentences (F4.3). Optional: without it the digest
   * uses plain per-person lines. Throws when the reply does not fit.
   */
  summarizeDigest?(input: DigestSummaryInput): Promise<DigestSummary>;
}

/** One unfinished thing found in a capture, before it is stored (F4.1). */
export interface LoopCandidate {
  description: string;
  direction: "i_owe" | "owed_to_me" | "unanswered" | "stalled";
  counterparty: string | null;
  /** The phrase that signals timing ("by Friday"), verbatim, or null. */
  dueSignal: string | null;
  /** What later evidence would close this — one sentence, used for matching. */
  closureSignature: string;
}

/** A loop already in the store, shown to the model so it can close it. */
export interface TrackedLoop {
  id: string;
  description: string;
  direction: LoopCandidate["direction"];
  counterparty: string | null;
}

export interface LoopClosure {
  id: string;
  /** Verbatim text from the capture that shows the loop finished. */
  evidence: string;
}

export interface LoopExtraction {
  loops: LoopCandidate[];
  closed: LoopClosure[];
}

const LOOP_DIRECTIONS = new Set(["i_owe", "owed_to_me", "unanswered", "stalled"]);

/**
 * Lowercase, letters and digits only, single spaces. Quotes come back with
 * curly apostrophes, dropped punctuation and reflowed line breaks, none of
 * which make them less verbatim.
 */
function normalizeForQuote(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * The directions a loop can take, by who wrote the line that evidences it.
 * The user's own line is a promise (i_owe) or a question they wait on
 * (owed_to_me); another person's line is their promise (owed_to_me) or a
 * question put to the user (unanswered).
 */
const DIRECTIONS_BY_AUTHOR: Record<"user" | "other", ReadonlySet<string>> = {
  user: new Set(["i_owe", "owed_to_me"]),
  other: new Set(["owed_to_me", "unanswered"]),
};

/** Chat apps write the user as "You"; otherwise match name or alias by first word. */
function isUser(name: string, user: UserIdentity): boolean {
  const n = normalizeForQuote(name);
  if (n === "you") return true;
  const first = (s: string) => normalizeForQuote(s).split(" ")[0] ?? "";
  return [user.name, ...user.aliases].some((a) => {
    const alias = normalizeForQuote(a);
    return alias !== "" && (n === alias || first(name) === first(a));
  });
}

/**
 * Pull loops and closures out of a model response, keeping only what the
 * capture itself supports.
 *
 * An unparseable answer means nothing found, never a crash. Every candidate
 * must quote the capture: a loop or a closure whose evidence is not in the
 * text is the model reasoning past what it saw, and F4.5 ranks a false loop
 * below a missed one. A counterparty or timing phrase the text does not
 * contain is cleared rather than trusted.
 *
 * With the user known, direction must agree with who wrote the evidence line
 * (DIRECTIONS_BY_AUTHOR). The prompt states the same rule, and at temperature
 * 0 the model still broke it in 1 run of 3 on the user's own question, so it
 * is enforced here as well.
 */
export function parseLoops(
  raw: string, sourceText: string, trackedIds: string[] = [], user?: UserIdentity,
  added?: string,
): LoopExtraction {
  const none: LoopExtraction = { loops: [], closed: [] };
  const text = raw.replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim();
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    console.error(`provider: could not parse loop response as JSON. snippet: ${raw.slice(0, 200)}`);
    return none;
  }
  const source = normalizeForQuote(sourceText);
  const quoted = (q: unknown): q is string => {
    if (typeof q !== "string") return false;
    const n = normalizeForQuote(q);
    return n.length > 0 && source.includes(n);
  };
  const r = (o ?? {}) as { loops?: unknown; tracked?: unknown };
  const fresh = added === undefined ? null : normalizeForQuote(added);

  const loops: LoopCandidate[] = [];
  for (const l of Array.isArray(r.loops) ? r.loops : []) {
    const c = l as Record<string, unknown>;
    const description = typeof c.description === "string" ? c.description.trim() : "";
    const direction = typeof c.direction === "string" ? c.direction : "";
    const closure = typeof c.closure_signature === "string" ? c.closure_signature.trim() : "";
    if (!description || !closure || !LOOP_DIRECTIONS.has(direction)) {
      console.error(`provider: dropped a loop candidate missing description/direction/closure`);
      continue;
    }
    if (!quoted(c.evidence)) {
      console.error(`provider: dropped loop "${description}": its evidence is not in the capture`);
      continue;
    }
    if (fresh !== null && !fresh.includes(normalizeForQuote(c.evidence))) {
      console.error(`provider: dropped loop "${description}": its evidence was already read before`);
      continue;
    }
    if (user && direction !== "stalled") {
      const author = typeof c.author === "string" ? c.author.trim() : "";
      const side = !author ? null : isUser(author, user) ? "user" : "other";
      if (!side || !DIRECTIONS_BY_AUTHOR[side].has(direction)) {
        console.error(`provider: dropped loop "${description}": ${direction} cannot come from `
          + `${author ? `a line written by ${author}` : "a line with no known author"}`);
        continue;
      }
    }
    const counterparty = typeof c.counterparty === "string" ? c.counterparty.trim() : "";
    const due = typeof c.due_signal === "string" ? c.due_signal.trim() : "";
    // A first name is enough: "Dana" names "Dana Reyes".
    const firstName = normalizeForQuote(counterparty).split(" ")[0] ?? "";
    const named = counterparty && firstName && ` ${source} `.includes(` ${firstName} `)
      && !(user && isUser(counterparty, user));
    loops.push({
      description,
      direction: direction as LoopCandidate["direction"],
      counterparty: named ? counterparty : null,
      dueSignal: due && quoted(due) ? due : null,
      closureSignature: closure,
    });
  }

  const known = new Set(trackedIds);
  const closed: LoopClosure[] = [];
  for (const x of Array.isArray(r.tracked) ? r.tracked : []) {
    const c = x as Record<string, unknown>;
    if (c.status !== "closed" || typeof c.id !== "string" || !known.has(c.id)) continue;
    if (!quoted(c.evidence)) {
      console.error(`provider: ignored closure of ${c.id}: its evidence is not in the capture`);
      continue;
    }
    closed.push({ id: c.id, evidence: c.evidence as string });
  }
  return { loops, closed };
}

/**
 * The provider refused for quota or balance, not because of this request.
 * Retrying soon only repeats the refusal, and the pipeline pauses every
 * provider call, chat and embeddings alike, until this `kind` answers again.
 */
export class QuotaExhausted extends Error {
  constructor(
    readonly kind: "chat" | "embed",
    message: string,
    /** From a Retry-After header, when the provider sent one. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "QuotaExhausted";
  }
}

/**
 * The provider could not be reached at all: DNS, refused connection, no
 * network. Nothing about the capture failed, so the pipeline spends no attempt
 * on it. Counting these sent eight captures to "giving up" overnight while the
 * Mac was offline (2026-10-08).
 */
export class ProviderUnreachable extends Error {
  constructor(readonly kind: "chat" | "embed", message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderUnreachable";
  }
}

/**
 * Nova Cloud has no usable session: never signed in, signed out, or the
 * refresh token was revoked. Like an outage, it is no fault of the capture,
 * so it spends no attempt and the queue waits for sign-in.
 */
export class NotSignedIn extends ProviderUnreachable {
  constructor(message = "not signed in to Nova Cloud") {
    super("chat", message);
    this.name = "NotSignedIn";
  }
}

/**
 * Nova Cloud refused this device (blocked, or too many device keys on the
 * account). Retrying the same capture cannot change that, so it spends no
 * attempt; the reason is kept for the app to show.
 */
export class ProviderRefused extends ProviderUnreachable {
  constructor(message: string) {
    super("chat", message);
    this.name = "ProviderRefused";
  }
}

/**
 * The provider answered 200 but the answer is unusable: truncated, empty, or
 * not the JSON asked for. Retryable, and it does spend an attempt — at
 * temperature 0 the same input can fail the same way every time.
 */
export class MalformedResponse extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedResponse";
  }
}

function unreachable(kind: "chat" | "embed", e: unknown): ProviderUnreachable {
  // A fetch wrapper (Nova Cloud's) may already have classified the failure.
  if (e instanceof ProviderUnreachable) return e;
  return new ProviderUnreachable(kind, `${kind} unreachable: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
}

/**
 * The error for a failed provider response. 429 is a rate limit or spent
 * quota; 402 is an unpaid balance (DeepSeek's "Insufficient Balance"); some
 * gateways answer quota with another status but say so in the body.
 */
function responseError(
  kind: "chat" | "embed", status: number, message: string, body: string, headers?: Headers,
): Error {
  const quota = status === 429 || status === 402
    || /RESOURCE_EXHAUSTED|insufficient[_ ]balance|exceeded your current quota/i.test(body);
  if (!quota) return new Error(message);
  const seconds = Number(headers?.get("retry-after"));
  return new QuotaExhausted(kind, message, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null);
}

const EXTRACT_MODEL = "gemini-3.6-flash";
const EMBED_MODEL = "gemini-embedding-001";
export const DIM = 1536;

/**
 * Extraction is a judgment against fixed rules, not writing, so sampling
 * variety only adds noise: at the default temperature one fixture gave its
 * loop in 1 run of 4, which made every prompt change unmeasurable.
 */
const GENERATION = { temperature: 0 };

/**
 * Pull the memories array out of a model response. Models wrap JSON in fences
 * despite instructions, so fences are stripped.
 *
 * An unparseable answer throws MalformedResponse rather than meaning "no
 * memories". Returning [] committed the version as done and deleted its queue
 * row, so a truncated response (seen 2026-10-07) lost that capture for good.
 * Only an explicit {"memories": []} is an empty result.
 */
export function parseMemories(raw: string): string[] {
  const text = raw.replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim();
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    console.error(
      `provider: could not parse model response as JSON. snippet: ${raw.slice(0, 200)}`
    );
    throw new MalformedResponse("model response was not valid JSON");
  }
  const memories = (o as { memories?: unknown })?.memories;
  if (!Array.isArray(memories)) {
    console.error(
      `provider: model response had no "memories" array. snippet: ${raw.slice(0, 200)}`
    );
    throw new MalformedResponse("model response had no \"memories\" array");
  }
  return memories.filter((m: unknown) => typeof m === "string");
}

/** Where and when a capture came from, so the model never has to guess. */
/**
 * Strips contact details from everything in one call's payload (D21 item 3).
 *
 * Applied once, at the top of each provider method, so the prompt and the
 * quote gate in `parseLoops` read the *same* text. Redacting only the prompt
 * would silently drop every loop whose evidence quotes a line holding an
 * email or a phone number — a precision regression wearing a privacy fix's
 * clothes.
 *
 * `title` and `url` go through it too: a window title is often a subject line
 * and holds addresses.
 */
function scrubOutbound<T extends CaptureContext | undefined>(
  versionText: string, ctx: T,
): { text: string; ctx: T } {
  const text = redactOutbound(versionText);
  if (!ctx) return { text, ctx };
  return {
    text,
    ctx: {
      ...ctx,
      title: redactOutbound(ctx.title),
      url: ctx.url ? redactOutbound(ctx.url) : ctx.url,
      ...(ctx.earlier === undefined ? {} : { earlier: redactOutbound(ctx.earlier) }),
      ...(ctx.added === undefined ? {} : { added: redactOutbound(ctx.added) }),
    } as T,
  };
}

export interface CaptureContext {
  app: string;
  title: string;
  url?: string | null;
  capturedAt: number;   // unix ms
  /**
   * Who the user is, when configured. Loop direction is unanswerable without
   * it: measured 2026-09-18, four commitments in one Slack DM came back
   * `owed_to_me` with counterparty "Alex" — the user's own name — because the
   * model had no way to tell which side of the conversation was theirs (D12).
   */
  user?: UserIdentity;
  /**
   * The thread's previous version, when there is one. The versionText passed
   * alongside it is then only what this version adds: the earlier text was
   * extracted when it was new, and re-extracting a scrolled chat on every
   * change stored 9% of a thread's memories twice (measured 2026-09-23).
   */
  earlier?: string;
  /**
   * For the loop pass: the lines this version adds to the previous one, or
   * undefined for a thread's first version, when everything is new. New loops
   * must come from these lines. Without it, a chat or a notes-to-self DM
   * raised its whole backlog as loops on every read, weeks-old lists included.
   */
  added?: string;
}

/**
 * The user's own name and the handles that refer to them.
 *
 * Set in the app's Profile pane (`identity.ts`), with `NOVA_USER_NAME` and
 * `NOVA_USER_ALIASES` as the fallback when nothing is stored.
 */
export interface UserIdentity {
  name: string;
  /** Emails, handles and short forms that mean the same person. */
  aliases: string[];
}

/** One person's loops, as the digest groups them (F4.3). */
export interface DigestGroup { person: string | null; loops: string[] }
export interface DigestSummaryInput {
  owe: DigestGroup[];
  waitingOn: DigestGroup[];
  /** Memory texts from yesterday, newest first. */
  yesterday: string[];
  user?: UserIdentity;
}
export interface DigestSummary { owe: string[]; waitingOn: string[]; yesterday: string | null }

const DIGEST_LINE_MAX = 300;
/** Two sentences of under 200 characters each, as the prompt allows. */
const DIGEST_YESTERDAY_MAX = 450;

/**
 * The morning digest's one call. Grouping is done by the caller, so the model
 * only writes sentences: one per group, in order, from that group's loops and
 * nothing else. A digest that invents a task is worse than a plain one, and
 * the caller falls back to plain lines on any reply that does not fit.
 */
export function buildDigestPrompt(input: DigestSummaryInput): string {
  const who = input.user ? `The user is ${input.user.name}.\n\n` : "";
  // Loops and memories are stored with emails and phone numbers intact (D21);
  // like extraction and embedding, this call strips them on the way out.
  const groups = (label: string, gs: DigestGroup[]) =>
    gs.map((g, i) => `${label} ${i + 1} (${g.person ? redactOutbound(g.person) : "no one named"}):\n`
      + g.loops.map((l) => `- ${redactOutbound(l)}`).join("\n")).join("\n\n") || "(none)";
  return `${who}Write the user's morning digest.

THINGS THE USER OWES, grouped by person:
${groups("OWE", input.owe)}

THINGS OTHERS OWE THE USER, grouped by person:
${groups("WAIT", input.waitingOn)}

WHAT NOVA SAW THE USER DO YESTERDAY:
${input.yesterday.map((m) => `- ${redactOutbound(m)}`).join("\n") || "(nothing)"}

Produce ONLY JSON:
{"owe": ${input.owe.length ? `["one sentence per OWE group, in order — exactly ${input.owe.length}"]` : "[] (none: return [])"},
 "waitingOn": ${input.waitingOn.length ? `["one sentence per WAIT group, in order — exactly ${input.waitingOn.length}"]` : "[] (none: return [])"},
 "yesterday": "at most two sentences, or null"}

Rules:
- "owe": for each OWE group, one imperative sentence that combines its items:
  "Check the calendar fix, fix the Upload Remaining permission, and review the
  status-key search." Do not name the person; the card already does.
- "waitingOn": for each WAIT group, a short noun phrase for what they owe:
  "The scoped-filter doc."
- "yesterday": what the user worked on, in at most two sentences, from the
  YESTERDAY lines only. null if they show no work. The user is reading it:
  start with the work ("Built…", "Worked on…"), never their name or a
  pronoun for them.
- Never add a task, a name, a date, a number or a detail that is not in the
  lines above. No emoji. Under 200 characters per sentence.`;
}

/**
 * Why a digest reply was refused, with the reply itself: without it a failed
 * summary is undiagnosable (2026-09-28: two mornings of "did not fit" and no
 * way to tell a wrong line count from a malformed reply). The daemon log is the
 * user's own (0600) and already names their loops.
 */
export function digestMisfit(raw: string, input: DigestSummaryInput): string {
  return `digest reply did not fit its input (expected ${input.owe.length} owe, `
    + `${input.waitingOn.length} waitingOn): ${raw.replace(/\s+/g, " ").slice(0, 600)}`;
}

/** The model's digest reply, or null when it does not fit the input exactly. */
export function parseDigestSummary(raw: string, input: DigestSummaryInput): DigestSummary | null {
  const text = raw.replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim();
  let o: any;
  try { o = JSON.parse(text); } catch { return null; }
  const line = (s: unknown) => typeof s === "string" && s.trim().length > 0 && s.length < DIGEST_LINE_MAX;
  // A section with no groups may come back as [] or be left out.
  const owe = o?.owe ?? (input.owe.length ? undefined : []);
  const waitingOn = o?.waitingOn ?? (input.waitingOn.length ? undefined : []);
  if (!Array.isArray(owe) || owe.length !== input.owe.length || !owe.every(line)) return null;
  if (!Array.isArray(waitingOn) || waitingOn.length !== input.waitingOn.length
      || !waitingOn.every(line)) return null;
  const y = o.yesterday;
  if (y !== null && y !== undefined && typeof y !== "string") return null;
  if (typeof y === "string" && y.length >= DIGEST_YESTERDAY_MAX) return null;
  return {
    owe: owe.map((s: string) => s.trim()),
    waitingOn: waitingOn.map((s: string) => s.trim()),
    yesterday: typeof y === "string" && y.trim() ? y.trim() : null,
  };
}

/**
 * Reads the identity from the env vars, or undefined when none is set.
 *
 * Undefined is a supported state, not an error: the prompts degrade to not
 * claiming a direction rather than guessing one, which is the F4.5-correct
 * behaviour. A wrong identity is worse than none — it inverts every loop
 * silently.
 */
export function userIdentityFromEnv(env: NodeJS.ProcessEnv = process.env): UserIdentity | undefined {
  const name = env.NOVA_USER_NAME?.trim();
  if (!name) return undefined;
  const aliases = (env.NOVA_USER_ALIASES ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
  return { name, aliases };
}

export function buildExtractPrompt(versionText: string, ctx?: CaptureContext): string {
  // Two measured failures shaped this block, and they pull in opposite
  // directions.
  //
  // 2026-08-25, no context at all: the model invented dates outright
  // ("June 25, 2025", "2025-01-01" for content captured that morning) and
  // filed "the user is working on a template file in VSCodium" against the capturing app,
  // whose window merely displayed that text.
  //
  // 2026-09-15, first attempt at a fix: stating the capture date as "the only
  // date you know" made it worse. Slack's AX text carries bare clock times
  // ("3:09 PM") with no day separators, so a scrolled backlog of weeks got
  // stamped with the read date — messages actually sent on 27 Aug and 11 Sep
  // were all recorded as 15 Sep. Invented dates read as wrong; confidently
  // misdated ones do not, and nothing downstream can detect them.
  //
  // The observer-framing paragraph and the interface ban-list below are not
  // redundant, and neither should be folded into the other. The ban-list
  // enumerates measured symptoms ("the page showed", "the panel displayed") and
  // catches them exactly; naming the model's role addresses the cause, so it
  // also covers phrasings nobody has enumerated yet. Keep both: the list is
  // precise about what has actually gone wrong, the framing generalises.
  //
  // So: name the source exactly (the record knows it), and give the read date
  // while forbidding its use as an authorship date. Undated is the correct
  // outcome when the content does not say — provenance still carries the
  // capture time, which is what recency ranking actually uses.
  const where = ctx
    ? `This screen was READ on ${new Date(ctx.capturedAt).toISOString().slice(0, 10)}, `
      + `from the application "${ctx.app}", in a window titled "${ctx.title}"`
      + (ctx.url ? `, at the URL ${ctx.url}` : "") + `.\n\n`
      + `That is when the screen was read. It is NOT when the content was\n`
      + `written, sent or published. A scrolled-back view shows weeks of\n`
      + `history at once, so most of what you see is older than that date —\n`
      + `often much older.\n\n`
      + `Give a memory a date ONLY when the content itself states one. A bare\n`
      + `clock time like "3:09 PM" is not a date: it proves nothing about which\n`
      + `day, so write the memory without one. Never reach for the read date to\n`
      + `fill the gap, and never infer a date from position or recency. An\n`
      + `undated memory is correct and expected; a wrongly dated one is a\n`
      + `falsehood that cannot be spotted later. When in doubt, omit the date.\n\n`
      + `"${ctx.app}" is the application the text was read from — it is not\n`
      + `necessarily what the text is ABOUT. If the content describes some other\n`
      + `tool, project or window, say so in the memory itself; do not rewrite the\n`
      + `source.\n\n`
    : "";

  const content = ctx?.earlier
    ? `EARLIER CONTENT (already recorded; context only, extract nothing from it):\n`
      + `${ctx.earlier}\n\n`
      + `NEW CONTENT (extract only what this adds):\n${versionText}`
    : `CONTENT:\n${versionText}`;

  const speakers = `In a conversation, name who said, asked or decided each thing
("Lee said the venue is booked"). Chat apps print a name once and then group
that person's following messages under it: an unnamed message belongs to the
author above it. Apps may call the user "You"`
    + (ctx?.user ? `; write "${ctx.user.name}" instead.` : ".");

  return `Below is text captured from one thing a user was looking at on screen.

${where}${content}

Extract the durable facts worth remembering. Produce ONLY JSON, exactly:
{"memories": ["...", "..."]}

Each memory must be one self-contained third-person sentence that names its
subjects explicitly and resolves every pronoun. Never write "today",
"yesterday" or "just now" — if the content gives the actual date, use it; if it
does not, leave the memory undated rather than guessing. Quote identifiers
verbatim. Return at most 6 memories. Zero is a normal answer for a screen with
nothing durable on it; never pad.

${speakers}

You are a recorder, not a participant. Write down what is true about the
subject matter — what a thing is, does, decides or states. Never describe the
act of looking at it, the window it was in, or your own reading of it. If a
sentence would still be true a year from now with the screen long gone, it is a
memory. If it only describes this moment of viewing, drop it.

Record substance, not interface. The capture includes whatever chrome the
application happened to render, and none of it is worth remembering: tab and
menu labels, button and panel names, counts of requests or tokens or bytes,
scrollbar and status-bar readings, "N results found", byte sizes, timers, and
any description of what a pane or tab was displaying. A memory that begins
"the user viewed", "the page showed", "the panel displayed" or "the editor
displayed" is almost always interface noise — drop it and keep the fact it was
wrapped around, if there is one.

Prefer what the user would want recalled weeks later: what a document or page
actually said, decisions, identifiers, code and its purpose, names, numbers
that mean something. If the content holds nothing worth remembering, return
{"memories": []}.`;
}

/**
 * Prompt for open loops (F4.1) and for closing tracked ones (F4.2).
 *
 * Written to refuse rather than guess. F4.5 sets the target at ≥70% of
 * surfaced loops rated real: "false loops erode trust." A missed commitment
 * costs nothing visible; an invented one trains the user to ignore the list.
 *
 * Every rule below comes from a measured failure. The prompt states the rule
 * with invented names; the incidents live here, so the model never sees a
 * real colleague's name it might echo back.
 *
 *   - Direction needs identity (D12, 2026-09-18). Four commitments in one DM
 *     came back owed_to_me with the user as counterparty.
 *   - A question the user asked is waited on, not owed (2026-09-23). "which
 *     role doesn't have upload permission?", answered two minutes later, came
 *     back as "answer which role lacks upload permission".
 *   - Chat apps group consecutive messages under one name. The old rule "no
 *     author shown means the user" filed a colleague's follow-ups as the
 *     user's own.
 *   - Availability notices (2026-09-18): a standup channel gave four false
 *     loops, all "will reach by 12"-style.
 *   - AI assistant turns (2026-09-22): ChatGPT asking for `eas --version`
 *     became "reply with output of eas --version".
 *   - Read to the end (2026-09-22): a thread ending "invited in testflight"
 *     was returned open, in a 243-character description that narrated the
 *     whole exchange including its own closure. Hence the description rule.
 *   - One promise over a list (2026-09-22): "I'll work on above tasks" after
 *     five bullets was named after the first bullet only.
 *   - Closure by resemblance. Cosine matching between a loop's closure
 *     signature and new memories closed 13 loops by 2026-09-23, most of them
 *     wrongly, and usually against the memories of the very capture that
 *     opened the loop: a memory restating a request reads like its
 *     completion. The model now judges closure against the text, with a quote.
 *
 * The read date is not an authorship date, and a bare clock time is not a
 * date, for the reasons in buildExtractPrompt. So `due_signal` stays verbatim.
 */
export function buildLoopPrompt(
  versionText: string, ctx?: CaptureContext, tracked: TrackedLoop[] = [],
): string {
  const where = ctx
    ? `This screen was READ on ${new Date(ctx.capturedAt).toISOString().slice(0, 10)}, `
      + `from "${ctx.app}", window titled "${ctx.title}"`
      + (ctx.url ? `, at ${ctx.url}` : "") + `.\n`
      + `That is when it was read, NOT when anything in it was written.\n\n`
    : "";

  // Without identity the model cannot tell which side of a conversation is the
  // user's, and a wrong direction is worse than a missing loop.
  const who = ctx?.user
    ? `THE USER IS: ${ctx.user.name}`
      + (ctx.user.aliases.length ? ` (also appears as ${ctx.user.aliases.join(", ")})` : "")
      + `. Apps may also call the user "You".\n`
      + `Never put ${ctx.user.name} in "counterparty": it is always the OTHER person.\n\n`
    : `THE USER'S IDENTITY IS NOT KNOWN. Apps may call the user "You". Otherwise\n`
      + `you cannot tell which side of a conversation is theirs, so return only\n`
      + `loops whose direction is unambiguous from the text. Returning nothing is\n`
      + `correct here.\n\n`;

  const trackedBlock = tracked.length
    ? `TRACKED LOOPS (already on the user's list):\n`
      + tracked.map((l) =>
          `${l.id}: [${l.direction}] ${l.description}`
          + (l.counterparty ? ` (with ${l.counterparty})` : "")).join("\n")
      + `\n\n`
    : "";

  const addedBlock = ctx?.added === undefined
    ? ""
    : `\n\nNEW SINCE THE LAST READ (these lines of CONTENT are new; everything else was\n`
      + `already read, and its loops were already found):\n`
      + (ctx.added.trim() ? ctx.added : "(nothing new)");

  return `Below is text captured from one screen a user was looking at.

${who}${where}${trackedBlock}CONTENT:
${versionText}${addedBlock}

Produce ONLY JSON:
{"tracked": [{"id": "L1", "status": "open|closed", "evidence": "verbatim quote or null"}],
 "loops": [{"description": "...", "direction": "i_owe|owed_to_me|unanswered|stalled",
   "counterparty": "name or null", "due_signal": "verbatim phrase or null",
   "evidence": "verbatim quote", "author": "who wrote the evidence line",
   "closure_signature": "..."}]}

## Directions

- "i_owe": the user committed to do something, or agreed to someone's request.
  The commitment is the user's own act: a promise in their own words, or a
  yes to something asked OF them. When the user asks how something works and
  the other person answers, nobody committed to anything, even if the answer
  names work the user will do and the user replies "ok". Measured 2026-09-24:
  such an answer was filed as the user's promise in 3 of 8 runs.
- "owed_to_me": someone else committed to do something for the user, OR the
  user asked someone a question or made a request and no reply is visible yet.
- "unanswered": someone asked the user a direct question or request, and no
  reply from the user is visible.
- "stalled": an explicitly agreed next step that visibly has not happened.

Who wrote a line decides its direction, so find the author before anything
else. Chat apps print the author's name before a message and then group that
person's following messages without repeating it: a message with no name
belongs to the author of the message above it. A question the user asked is
never "i_owe" or "unanswered". Someone else asking the user FOR something
("otp pls?", "can you try this branch?") is never "owed_to_me": the user is
the one who has to act. If you cannot tell who wrote a line, leave it out.

A loop is open only if nothing AFTER it answers or finishes it, and the answer
is often the very last message. Check every later line, including ones after
a "New" divider.

## First, every tracked loop

${tracked.length ? `Give every TRACKED loop a verdict in "tracked", one entry per loop.
"closed" only when CONTENT shows it actually finished: the promised thing was
sent or done, the question got an answer, or the person confirmed it. Discussing the topic, restating the request, or
describing the problem does NOT close it. For "closed", "evidence" must quote
the line that shows completion; for "open" it is null.

A question or request ("unanswered", or an "owed_to_me" question) closes as
soon as the other side replies to it, even when the reply is only a promise or
a partial answer. If the reply is a promise, close the old loop AND list the
promise as a new loop.` : `There are no tracked loops. "tracked" is [].`}

## New loops

${ctx?.added === undefined ? "" : `Take new loops ONLY from the NEW lines. The rest of CONTENT is context: use it
to see who is talking, whether a new line is answered or done, and to close
tracked loops, but never raise a loop from it. A loop whose evidence is not in
the NEW lines is discarded.

`}Return a loop only when the text shows the commitment or the question itself,
and it is still outstanding at the END of the text. Read to the end first: a
request followed by "done", "sent", an answer, or an equivalent reply is
finished. **Most screens have no loops. {"loops": []} is the expected answer.**
A false loop is far worse than a missed one.

But do not miss the plain cases, which are exactly what the list is for:
- someone asks the user to do something and the user agrees ("yes", "sure",
  "will do", "will upload in sometime"), and it is not visibly done: "i_owe"
- the user says they will do something: "i_owe"
- someone reports a problem to the user for them to handle (a bug, a failing
  build, an error they are expected to fix) and the user has not answered:
  "unanswered"
- the user asks someone a question and no answer follows: "owed_to_me"
- the user writes a to-do for themselves: a message in a DM to their own
  account, a personal note or checklist. Each item not marked done is its own
  "i_owe" loop with counterparty null, even with no "I will": writing it down
  is the commitment. This is the one case where a list is several loops.

One thing is one loop. Once the user has replied to a request or report, list
only the user's commitment ("i_owe"), not the request as well.

Not loops:
- availability or whereabouts notices ("stepping out", "on leave tomorrow",
  "in a meeting until 3"): they announce a schedule, nothing closes them
- articles, docs, READMEs: advice is not a commitment
- a conversation with an AI assistant (ChatGPT, Claude, Gemini, Copilot).
  The assistant asking for a file or a paste is a turn in a live chat, not a
  commitment. A promise the user makes to a PERSON is still a loop.
- issue trackers, boards and spreadsheets that track their own status (a
  to-do the user jots for themselves is NOT this; see above)
- interface text: buttons, placeholders, notification counts, "N pending"
- anything in TRACKED LOOPS, even reworded: it is already on the list

"evidence" is the shortest span copied exactly from CONTENT that shows the
commitment or question: for "i_owe", the user's own promise or agreement; for
"unanswered", the other person's question. It is checked against the text; a
loop whose evidence is not found there is discarded.
"author" is the name of whoever wrote the evidence line, as the text shows it
("You" is fine). A loop whose direction does not fit its author is discarded:
the user's own line is "i_owe" or "owed_to_me", another person's line is
"owed_to_me" or "unanswered".

"description" is the outstanding action alone, as a short imperative phrase:
"send Sam the signed contract", "reply to Lee about the venue". Under 60
characters, never over 100. Do not narrate the thread, name who asked, or
repeat the counterparty or timing. If writing it forces you to say the thing
was already done, it is not a loop.

When one promise to ANOTHER person covers a list ("I'll handle the items above"
after five bullets), return ONE loop that names the whole set ("work through
the 5 onboarding fixes"), never just the first item. A to-do list the user
writes for themselves is the opposite: one loop per item.

"counterparty" is the other person's name as the text writes it, or null.
"due_signal" is the timing phrase copied verbatim ("by Friday"), or null. Never
convert it to a date.
"closure_signature" is one sentence stating the observable fact that would
show it finished: "the signed contract was sent to Sam".

## Examples

Content: "Sam: which region is the bucket in?\\nLee: us-east-1"
User is Sam. Output: {"tracked": [], "loops": []} (asked and answered)

Content: "Lee: can you send me the invoice by Friday?"
User is Sam. Output: {"tracked": [], "loops": [{"description": "send Lee the
invoice", "direction": "unanswered", "counterparty": "Lee", "due_signal": "by
Friday", "evidence": "can you send me the invoice by Friday?", "author": "Lee",
"closure_signature": "the invoice was sent to Lee"}]}

Content: "Lee: I'll share the deck tomorrow\\nare you free at 3?\\nYou: yes"
User is Sam. Output: {"tracked": [], "loops": [{"description": "share the
deck", "direction": "owed_to_me", "counterparty": "Lee", "due_signal":
"tomorrow", "evidence": "I'll share the deck tomorrow", "author": "Lee",
"closure_signature":
"Lee shared the deck"}]} ("are you free at 3?" is Lee's too, and answered)

Content: "Lee: can you push the build to the store?\\nYou: yes\\nYou: will do it
in the evening"
User is Sam. Output: {"tracked": [], "loops": [{"description": "push the build to
the store", "direction": "i_owe", "counterparty": "Lee", "due_signal": "in the
evening", "evidence": "will do it in the evening", "author": "You",
"closure_signature": "the build was pushed to the store"}]}

Tracked "L1: [i_owe] send Lee the invoice". Content: "You: sent the invoice
just now\\nLee: thanks". Output: {"tracked": [{"id": "L1", "status": "closed",
"evidence": "sent the invoice just now"}], "loops": []}`;
}

export class GeminiProvider implements InferenceProvider {
  constructor(
    private key = process.env.GEMINI_API_KEY ?? "",
    private readonly sink?: CallSink,
  ) {
    if (!this.key) throw new Error("GEMINI_API_KEY is not set");
  }

  /**
   * The key travels as a query parameter and Google's error bodies sometimes
   * echo request details, so never let the raw body reach a thrown message.
   */
  private async redactedErrorBody(res: Response): Promise<string> {
    const body = await res.text();
    const redacted = this.key ? body.split(this.key).join("[redacted]") : body;
    return redacted.slice(0, 300);
  }

  private async generate(prompt: string, label: string): Promise<string> {
    const started = Date.now();
    const report = (outcome: "ok" | "error", extra?: { status?: number; detail?: string }) =>
      this.sink?.({
        provider: "gemini", model: EXTRACT_MODEL, kind: "chat", outcome,
        ms: Date.now() - started, inputChars: prompt.length, items: 1, ...extra,
      });
    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${EXTRACT_MODEL}:generateContent?key=${this.key}`,
        { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { ...GENERATION, responseMimeType: "application/json" } }) });
    } catch (e) {
      // A transport failure is still a call the user's machine made.
      report("error", { detail: e instanceof Error ? e.message : String(e) });
      throw unreachable("chat", e);
    }
    if (!res.ok) {
      const body = await this.redactedErrorBody(res);
      report("error", { status: res.status, detail: `${label} ${res.status}` });
      throw responseError("chat", res.status, `gemini ${label} ${res.status}: ${body}`, body, res.headers);
    }
    report("ok");
    const j = await res.json() as any;
    const candidate = j.candidates?.[0];
    // See OpenAICompatProvider.chat: a cut-off or empty answer is a failure to
    // retry, not an empty extraction.
    if (candidate?.finishReason === "MAX_TOKENS") {
      throw new MalformedResponse(`gemini ${label}: response truncated at the token limit`);
    }
    const text = candidate?.content?.parts?.[0]?.text;
    if (typeof text !== "string" || text.trim() === "") {
      throw new MalformedResponse(`gemini ${label}: response had no text`);
    }
    return text;
  }

  async extract(versionText: string, ctx?: CaptureContext): Promise<string[]> {
    const s = scrubOutbound(versionText, ctx);
    return parseMemories(await this.generate(buildExtractPrompt(s.text, s.ctx), "extract"));
  }

  async extractLoops(
    versionText: string, ctx?: CaptureContext, tracked: TrackedLoop[] = [],
  ): Promise<LoopExtraction> {
    const s = scrubOutbound(versionText, ctx);
    const raw = await this.generate(buildLoopPrompt(s.text, s.ctx, tracked), "loops");
    return parseLoops(raw, s.text, tracked.map((l) => l.id), s.ctx?.user, s.ctx?.added);
  }

  async summarizeDigest(input: DigestSummaryInput): Promise<DigestSummary> {
    const raw = await this.generate(buildDigestPrompt(input), "digest");
    const s = parseDigestSummary(raw, input);
    if (!s) throw new Error(digestMisfit(raw, input));
    return s;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    // Contact details do not leave the machine, not even as embedding input
    // (D21). The vector then describes the memory without them; search still
    // matches on everything else the line says.
    texts = texts.map(redactOutbound);
    const started = Date.now();
    const chars = texts.reduce((n, t) => n + t.length, 0);
    const report = (outcome: "ok" | "error", extra?: { status?: number; detail?: string }) =>
      this.sink?.({
        provider: "gemini", model: EMBED_MODEL, kind: "embed", outcome,
        ms: Date.now() - started, inputChars: chars, items: texts.length, ...extra,
      });
    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${this.key}`,
        { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requests: texts.map((t) => ({
              model: `models/${EMBED_MODEL}`,
              content: { parts: [{ text: t }] },
              outputDimensionality: DIM })) }) });
    } catch (e) {
      report("error", { detail: e instanceof Error ? e.message : String(e) });
      throw unreachable("embed", e);
    }
    if (!res.ok) {
      const body = await this.redactedErrorBody(res);
      report("error", { status: res.status, detail: `embed ${res.status}` });
      throw responseError("embed", res.status, `gemini embed ${res.status}: ${body}`, body, res.headers);
    }
    report("ok");
    const j = await res.json() as any;
    return (j.embeddings ?? []).map((e: any) => {
      const v = Float32Array.from(e.values);
      if (v.length !== DIM) {
        throw new Error(`gemini embed returned a ${v.length}-dim vector, expected ${DIM}`);
      }
      return v;
    });
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible provider
//
// Chat and embeddings are configured independently, because in practice they
// are two different vendors. Probed 2026-08-25: DeepSeek serves chat but
// returns 404 for /embeddings (it ships no embedding model at all), while the
// Gemini endpoints that do serve embeddings were quota-exhausted for chat. A
// single base URL cannot express the only combination that works.
// ---------------------------------------------------------------------------

export interface OpenAICompatConfig {
  chatBaseUrl: string; chatApiKey: string; chatModel: string;
  embedBaseUrl: string; embedApiKey: string; embedModel: string;
  embedDim: number;
}

const CHAT_VARS = ["NOVA_CHAT_BASE_URL", "NOVA_CHAT_API_KEY", "NOVA_CHAT_MODEL"] as const;
const EMBED_VARS = ["NOVA_EMBED_BASE_URL", "NOVA_EMBED_API_KEY", "NOVA_EMBED_MODEL"] as const;
/** Every variable whose presence selects the OpenAI-compatible provider.
 * NOVA_EMBED_DIM is deliberately excluded: on its own it is a tuning knob for
 * a config that does not exist yet, not a request to switch provider. */
export const OPENAI_COMPAT_VARS: readonly string[] = [...CHAT_VARS, ...EMBED_VARS];

/** Trailing slashes are a coin flip in a pasted base URL, and `${base}/path`
 * with one produces a double slash that some gateways 404 on. */
/**
 * The endpoint's host, as the transparency panel's "provider" (F5.5). The
 * configured base URL is the honest answer for an OpenAI-compatible setup:
 * the vendor name is not knowable, and a self-hosted endpoint should read as
 * itself rather than as a brand it is merely speaking the protocol of.
 */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * Read the six variables, or explain exactly which of them are missing.
 * A partial config is the likely mistake this guards: naming the specific
 * variables turns a vendor-side auth error into a one-line fix.
 */
export function openAICompatConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): OpenAICompatConfig {
  const get = (name: string) => (env[name] ?? "").trim();
  const missing = OPENAI_COMPAT_VARS.filter((v) => get(v) === "");
  if (missing.length > 0) {
    throw new Error(
      `Incomplete OpenAI-compatible configuration: ${missing.join(", ")} `
      + `${missing.length === 1 ? "is" : "are"} not set. Chat and embeddings are `
      + "configured independently and both are required — see daemon/README.md.");
  }

  const rawDim = get("NOVA_EMBED_DIM");
  const embedDim = rawDim === "" ? DIM : Number(rawDim);
  if (!Number.isInteger(embedDim) || embedDim <= 0) {
    throw new Error(`NOVA_EMBED_DIM must be a positive integer, got ${JSON.stringify(rawDim)}`);
  }
  // 1536 is the only supported width today. The vec0 index is declared
  // int8[DIM] at schema-creation time and the float32 sidecar is read back with
  // a hardcoded element count, so a different value would need a schema
  // migration this change does not perform. Rejecting it here is honest;
  // silently accepting it would corrupt every write and every query.
  if (embedDim !== DIM) {
    throw new Error(
      `NOVA_EMBED_DIM=${embedDim} is not supported: this build indexes ${DIM}-dimension `
      + `vectors only. Configure an embedding model that can return ${DIM} dimensions.`);
  }
  return {
    chatBaseUrl: get("NOVA_CHAT_BASE_URL"), chatApiKey: get("NOVA_CHAT_API_KEY"),
    chatModel: get("NOVA_CHAT_MODEL"),
    embedBaseUrl: get("NOVA_EMBED_BASE_URL"), embedApiKey: get("NOVA_EMBED_API_KEY"),
    embedModel: get("NOVA_EMBED_MODEL"), embedDim,
  };
}

/** Does this error body look like the endpoint rejecting `dimensions` itself,
 * rather than failing for an unrelated reason? Only a parameter complaint
 * earns the retry — retrying a 401 without `dimensions` would just burn a
 * second request and report the wrong cause. */
function looksLikeUnsupportedDimensions(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false;
  const b = body.toLowerCase();
  return b.includes("dimension")
    || b.includes("unknown parameter") || b.includes("unrecognized")
    || b.includes("unexpected") || b.includes("not supported")
    || b.includes("unsupported") || b.includes("invalid_request_error");
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Any endpoint that speaks the OpenAI /chat/completions and /embeddings
 * shapes. Implements the same InferenceProvider seam as GeminiProvider, and
 * reuses buildExtractPrompt/parseMemories rather than restating them.
 */
export class OpenAICompatProvider implements InferenceProvider {
  constructor(
    private readonly cfg: OpenAICompatConfig,
    private readonly fetchImpl: FetchLike = ((u, i) => fetch(u, i)) as FetchLike,
    private readonly sink?: CallSink,
  ) {}

  /**
   * Error bodies from gateways routinely echo the request, headers included.
   * Both keys are stripped from every body that can reach a thrown message or
   * a log line, because the chat and embed keys are different secrets and
   * either could appear in either response.
   */
  private redactedErrorBody(body: string): string {
    let out = body;
    for (const secret of [this.cfg.chatApiKey, this.cfg.embedApiKey]) {
      if (secret) out = out.split(secret).join("[redacted]");
    }
    return out.slice(0, 300);
  }

  private async chat(prompt: string): Promise<string> {
    const started = Date.now();
    const report = (outcome: "ok" | "error", extra?: { status?: number; detail?: string }) =>
      this.sink?.({
        provider: hostOf(this.cfg.chatBaseUrl), model: this.cfg.chatModel, kind: "chat",
        outcome, ms: Date.now() - started, inputChars: prompt.length, items: 1, ...extra,
      });
    let res: Response;
    try {
      res = await this.fetchImpl(joinUrl(this.cfg.chatBaseUrl, "chat/completions"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.cfg.chatApiKey}`,
        },
        body: JSON.stringify({
          model: this.cfg.chatModel,
          messages: [{ role: "user", content: prompt }],
          ...GENERATION,
          response_format: { type: "json_object" },
        }),
      });
    } catch (e) {
      report("error", { detail: e instanceof Error ? e.message : String(e) });
      throw unreachable("chat", e);
    }
    if (!res.ok) {
      const body = this.redactedErrorBody(await res.text());
      report("error", { status: res.status, detail: `chat ${res.status}` });
      throw responseError("chat", res.status, `chat ${this.cfg.chatModel} ${res.status}: ${body}`,
        body, res.headers);
    }
    report("ok");
    const j = await res.json() as any;
    const choice = j?.choices?.[0];
    // A cut-off answer parses as nothing, and nothing used to read as "no
    // memories". Say what happened instead, so the version is retried.
    if (choice?.finish_reason === "length") {
      throw new MalformedResponse(`chat ${this.cfg.chatModel}: response truncated at the token limit`);
    }
    const content = choice?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new MalformedResponse(`chat ${this.cfg.chatModel}: response had no message content`);
    }
    return content;
  }

  async extract(versionText: string, ctx?: CaptureContext): Promise<string[]> {
    const s = scrubOutbound(versionText, ctx);
    return parseMemories(await this.chat(buildExtractPrompt(s.text, s.ctx)));
  }

  async extractLoops(
    versionText: string, ctx?: CaptureContext, tracked: TrackedLoop[] = [],
  ): Promise<LoopExtraction> {
    const s = scrubOutbound(versionText, ctx);
    const raw = await this.chat(buildLoopPrompt(s.text, s.ctx, tracked));
    return parseLoops(raw, s.text, tracked.map((l) => l.id), s.ctx?.user, s.ctx?.added);
  }

  async summarizeDigest(input: DigestSummaryInput): Promise<DigestSummary> {
    const raw = await this.chat(buildDigestPrompt(input));
    const s = parseDigestSummary(raw, input);
    if (!s) throw new Error(digestMisfit(raw, input));
    return s;
  }

  private embedRequest(texts: string[], withDimensions: boolean): Promise<Response> {
    const body: Record<string, unknown> = { model: this.cfg.embedModel, input: texts };
    if (withDimensions) body.dimensions = this.cfg.embedDim;
    return this.fetchImpl(joinUrl(this.cfg.embedBaseUrl, "embeddings"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.cfg.embedApiKey}`,
      },
      body: JSON.stringify(body),
    });
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    texts = texts.map(redactOutbound);   // D21: see GeminiProvider.embed
    const started = Date.now();
    const chars = texts.reduce((n, t) => n + t.length, 0);
    // One row per embed() call, not per HTTP attempt: the dimensions retry is
    // one logical call from the user's point of view, and the panel counts
    // what Nova sent rather than how the client negotiated it.
    const report = (outcome: "ok" | "error", extra?: { status?: number; detail?: string }) =>
      this.sink?.({
        provider: hostOf(this.cfg.embedBaseUrl), model: this.cfg.embedModel, kind: "embed",
        outcome, ms: Date.now() - started, inputChars: chars, items: texts.length, ...extra,
      });
    let res: Response;
    try {
      res = await this.embedRequest(texts, true);
    } catch (e) {
      report("error", { detail: e instanceof Error ? e.message : String(e) });
      throw unreachable("embed", e);
    }
    if (!res.ok) {
      const body = await res.text();
      // Models with a fixed output width reject `dimensions` outright. Drop it
      // and try once more — but the returned width is still validated below,
      // so a fixed-width model of the wrong size fails loudly rather than
      // quietly filling the index with vectors of another shape.
      if (!looksLikeUnsupportedDimensions(res.status, body)) {
        const shown = this.redactedErrorBody(body);
        report("error", { status: res.status, detail: `embed ${res.status}` });
        throw responseError("embed", res.status, `embed ${this.cfg.embedModel} ${res.status}: ${shown}`,
          shown, res.headers);
      }
      console.error(
        `[provider] ${this.cfg.embedModel} rejected the "dimensions" parameter `
        + `(HTTP ${res.status}); retrying once without it`);
      try {
        res = await this.embedRequest(texts, false);
      } catch (e) {
        report("error", { detail: e instanceof Error ? e.message : String(e) });
        throw unreachable("embed", e);
      }
      if (!res.ok) {
        const shown = this.redactedErrorBody(await res.text());
        report("error", { status: res.status, detail: `embed ${res.status} (no dimensions)` });
        throw responseError("embed", res.status,
          `embed ${this.cfg.embedModel} ${res.status} (retried without dimensions): ${shown}`,
          shown, res.headers);
      }
    }
    report("ok");

    const j = await res.json() as any;
    const data = j?.data;
    if (!Array.isArray(data)) {
      throw new Error(`embed ${this.cfg.embedModel}: response had no "data" array`);
    }
    if (data.length !== texts.length) {
      throw new Error(
        `embed ${this.cfg.embedModel} returned ${data.length} embeddings for ${texts.length} inputs`);
    }

    // The OpenAI spec does not promise data[] comes back in input order — it
    // promises each element carries its own `index`. Trusting position instead
    // would attach every memory to another memory's vector: a silent,
    // undetectable corruption of the whole store, not a crash. So place each
    // vector by its stated index and refuse anything that does not slot in.
    //
    // An absent index means 0, and this is not a hypothetical: Gemini's
    // OpenAI-compat endpoint omits the field on element 0 and sends it on all
    // the rest (measured 2026-08-25 — data[0] had keys [object, embedding]
    // while data[1..n] carried index 1..n). That is proto3 JSON dropping a
    // zero-valued field, so it will show up on any protobuf-backed provider.
    // Reading absent-as-0 is safe here only because two elements claiming the
    // same slot still collide on the duplicate check below.
    const out = new Array<Float32Array | undefined>(texts.length);
    for (const e of data) {
      const idx = e?.index === undefined ? 0 : e.index;
      if (!Number.isInteger(idx) || idx < 0 || idx >= texts.length) {
        throw new Error(
          `embed ${this.cfg.embedModel}: embedding carried index ${JSON.stringify(e?.index)}, `
          + `outside 0..${texts.length - 1}`);
      }
      if (out[idx] !== undefined) {
        throw new Error(`embed ${this.cfg.embedModel}: duplicate embedding index ${idx}`);
      }
      if (!Array.isArray(e.embedding)) {
        throw new Error(`embed ${this.cfg.embedModel}: embedding at index ${idx} was not an array`);
      }
      const v = Float32Array.from(e.embedding as number[]);
      if (v.length !== this.cfg.embedDim) {
        throw new Error(
          `embed ${this.cfg.embedModel} returned a ${v.length}-dim vector, `
          + `expected ${this.cfg.embedDim}`);
      }
      out[idx] = v;
    }
    for (let i = 0; i < out.length; i++) {
      if (out[i] === undefined) {
        throw new Error(`embed ${this.cfg.embedModel}: no embedding returned for input ${i}`);
      }
    }
    return out as Float32Array[];
  }
}

/**
 * Stands in for a real provider when nothing is configured, so `nova mcp`
 * still starts and Claude Desktop gets an actionable error on the tool call
 * instead of a dead connector. Both methods fail identically and by design.
 *
 * The message names both supported configurations, because either one is a
 * valid fix and a user who chose the OpenAI-compatible route would otherwise
 * be told to set a key they deliberately do not have.
 */
export class MissingKeyProvider implements InferenceProvider {
  private fail(): never {
    throw new Error(
      "No inference provider is configured. Set either GEMINI_API_KEY, or the "
      + "OpenAI-compatible pair NOVA_CHAT_BASE_URL/NOVA_CHAT_API_KEY/NOVA_CHAT_MODEL "
      + "plus NOVA_EMBED_BASE_URL/NOVA_EMBED_API_KEY/NOVA_EMBED_MODEL. Under Claude "
      + "Desktop these go in the MCP server's env block; restart it after editing. "
      + "See daemon/README.md.");
  }
  async extract(_versionText: string): Promise<string[]> { this.fail(); }
  async embed(_texts: string[]): Promise<Float32Array[]> { this.fail(); }
}

/**
 * A provider that works when a configuration is present and explains itself
 * when it is not. Never throws at construction — callers that must stay alive
 * (the MCP server) depend on that.
 *
 * Resolution order:
 *   1. any NOVA_CHAT_* / NOVA_EMBED_* variable set -> OpenAICompatProvider
 *   2. GEMINI_API_KEY set                          -> GeminiProvider
 *   3. nothing                                     -> MissingKeyProvider
 *
 * Step 1 triggers on ANY of the six variables, not on all six. A half-filled
 * OpenAI-compatible config is a typo, not a request to use Gemini: falling
 * through would run the wrong endpoint (or none) and surface the mistake as a
 * quota or auth error from an unrelated vendor. So a partial config resolves
 * to a provider that names the missing variables on first use.
 */
export function providerFromEnv(
  env: NodeJS.ProcessEnv = process.env, sink?: CallSink,
): InferenceProvider {
  if (OPENAI_COMPAT_VARS.some((v) => (env[v] ?? "").trim() !== "")) {
    try {
      return new OpenAICompatProvider(openAICompatConfigFromEnv(env), undefined, sink);
    } catch (e) {
      // Construction must not throw here: `nova mcp` has to start regardless
      // so Claude Desktop shows an actionable tool error rather than a dead
      // connector. Carry the real reason through to first use.
      return new UnconfiguredProvider(e instanceof Error ? e.message : String(e));
    }
  }
  return env.GEMINI_API_KEY
    ? new GeminiProvider(env.GEMINI_API_KEY, sink)
    : new MissingKeyProvider();
}

/** Reports one specific configuration error, per call, without ever throwing
 * at construction. Same contract as MissingKeyProvider, different message. */
export class UnconfiguredProvider implements InferenceProvider {
  constructor(private readonly reason: string) {}
  private fail(): never { throw new Error(this.reason); }
  async extract(_versionText: string): Promise<string[]> { this.fail(); }
  async embed(_texts: string[]): Promise<Float32Array[]> { this.fail(); }
}

/** Deterministic provider for tests. No network. */
export class FakeProvider implements InferenceProvider {
  constructor(
    private memories: string[] = ["a fact"],
    /** Loop candidates to return; empty by default so existing tests see none. */
    private loops: LoopCandidate[] = [],
    /** Ids of tracked loops to report closed, when they are offered. */
    private closes: string[] = [],
    /** What summarizeDigest does: a reply, a thrown error, or never settling. */
    private digest?: DigestSummary | Error | "hang",
  ) {}
  /** The context of the last extract() call, for tests that assert on it. */
  lastContext?: CaptureContext;
  /** The tracked loops offered on the last extractLoops() call. */
  lastTracked?: TrackedLoop[];
  async extract(_versionText: string, ctx?: CaptureContext): Promise<string[]> {
    this.lastContext = ctx;
    return this.memories;
  }
  async extractLoops(
    _versionText: string, _ctx?: CaptureContext, tracked: TrackedLoop[] = [],
  ): Promise<LoopExtraction> {
    this.lastTracked = tracked;
    const offered = new Set(tracked.map((l) => l.id));
    return {
      loops: this.loops,
      closed: this.closes.filter((id) => offered.has(id)).map((id) => ({ id, evidence: "done" })),
    };
  }
  lastDigestInput?: DigestSummaryInput;
  async summarizeDigest(input: DigestSummaryInput): Promise<DigestSummary> {
    this.lastDigestInput = input;
    if (this.digest === "hang") return new Promise(() => {});
    if (this.digest instanceof Error) throw this.digest;
    if (!this.digest) throw new Error("no digest configured");
    return this.digest;
  }
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      // FNV-1a over the full string so distinct inputs (even same-length
      // ones) get distinct vectors, not just distinct-by-length ones.
      let h = 2166136261;
      for (let i = 0; i < t.length; i++) {
        h ^= t.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const seed = (h >>> 0) % 1000;
      const v = new Float32Array(DIM);
      for (let i = 0; i < DIM; i++) v[i] = Math.sin(i * 0.1 + seed);
      let sumSquares = 0;
      for (let i = 0; i < DIM; i++) sumSquares += v[i]! * v[i]!;
      const n = Math.sqrt(sumSquares) || 1;
      for (let i = 0; i < DIM; i++) v[i]! /= n;
      return v;
    });
  }
}
