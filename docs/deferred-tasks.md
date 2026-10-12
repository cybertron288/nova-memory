# Deferred tasks

Known problems, parked deliberately. Each entry says what is wrong, how it was
found, and what it would cost to leave. Nothing here is speculative — every item
was observed on real captures.

Ordered by severity, not by when to do them.

| # | Item | Status |
|---|---|---|
| D1 | Nova indexes credentials and secrets | closed 2026-09-23 — credentials only; personal data is D21 |
| D2 | Chrome content extraction regressed to zero | closed 2026-09-17 |
| D3 | Content/chrome split discards the better text | open — Slack only, since D2 removed Chrome |
| D4 | Slack day separators captured but unused | open, largely subsumed by D3 |
| D5 | Empty captures counted but not explained | open, low |
| D6 | int8 vectors: revisit precision | closed 2026-09-18 |
| D7 | Extraction drains one version per 15 s tick | open, low |
| D8 | Zed publishes no accessibility tree | addressed 2026-10-05 — generic OCR fallback |
| D9 | Warm-up retries cost 1.3 s on an empty window | open, low — introduced by the D2 fix |
| D10 | The observer-framing prompt change is unmeasured | open, low — blocked on the same judgement as D1 |
| D11 | Entities/facts unbuilt; loops hold name strings | open — deliberate M2 tradeoff |
| D12 | Loop detection precision 47% vs 70% target | closed 2026-09-19 — now 88% |
| D13 | `until` clamp test asserts a future default | open, low — latent clock-dependent flake |
| D14 | A drain in flight is abandoned at shutdown | corrected 2026-09-21 — the premise was wrong; fixed, not deferred |
| D15 | Shutdown never waits for the capture child | open, low — latent until capture traps SIGTERM |
| D16 | No TypeScript typecheck exists | closed 2026-09-21 |
| D17 | A snoozed loop can never auto-resolve | closed 2026-09-21 |
| D18 | Nothing prevents two daemons running at once | closed 2026-09-21 |
| D19 | The panel drops D9's search and timeline sections | decided, recorded for the trail |
| D19a | skip incognito window by default | closed 2026-10-06 — private browsing is a hard exclusion (D21) |
| D20 | Nova on a managed or monitored Mac | open, low — research |
| D21 | Personal data and the unbuilt hard exclusions | closed 2026-10-06 — exclusions, redaction and the user deny-list all built |
| D22 | The transparency panel does not belong in the loop panel | closed 2026-10-06 — Your Space → Activity |
| D23 | F4.4's "open source context" cannot work for every app | decided 2026-10-07 — out of P0, deferred until it does |
| D24 | Profile shows facts Nova formed, which are unbuilt | decided 2026-10-07 — name and handles in M2, facts to M3 |
| D25 | Delete and retention have no home in Your Space | decided 2026-10-07 — a fifth pane, "Your data" |
| D26 | The beta gates need data no backend can receive | decided 2026-10-07 — local counters plus Export diagnostics |
| D27 | Another Mac cannot run Nova | decided 2026-10-07 — Apple Developer ID, signed and notarized |
| D28 | M1 named an auth service and relays the product no longer has | decided 2026-10-07 — no account, no relay in M2 |

---

## D1 — Nova indexes credentials and secrets (SECURITY)

**Status:** parked 2026-09-15, at the user's direction, to keep M1 moving.

Nothing in the capture or extraction path filters sensitive content. Measured on
a real 27-derivative store:

- A Chrome password-manager page produced **9 derivatives** mapping eight
  work accounts to their hosts, plus a personal username.
- A Slack DM produced a memory containing a **live plaintext password**
  (`test_distributor@acme.com` / a shared test credential).
- Another captured a colleague's Apple ID.

These were encrypted at rest, but they were **sent to the chat and embedding
providers** during extraction, and they sit in a searchable index that the MCP
server exposes to Claude Desktop.

`AXReader.forbiddenRoles` already excludes `AXSecureTextField`, so masked input
fields are never read. That does not help here: a password manager renders its
list as ordinary `AXStaticText`.

**Compounding:** the terminal re-captures Nova's own search output, so
credentials already extracted get re-ingested on later ticks.

**Two parts to fix:**

1. **Purge** the existing credential derivatives from the local store.
2. **Prevent.** Options, in the order I would try them:
   - Deny-list at capture by URL and window title (password managers, keychain
     UIs, vaults) — refuses before any text reaches a provider. Cheapest and
     most reliable.
   - Detect credential-shaped content and skip the version entirely.
   - Prompt-level refusal. Weakest: depends on model compliance, which is
     exactly what failed for dates (see D4 history).

Capture-side denial is the recommendation — nothing should reach a provider that
we would not want indexed.

**Cost of leaving it:** every browsing session adds secrets to a searchable
index, and each extraction ships them to two third parties.

---

## D2 — Chrome content extraction regressed to zero

**Status:** CLOSED 2026-09-17. Chrome went from 0 content
chars to **8,335**, a 56% content-share, stable across repeated fresh captures.
The cause was a cold accessibility tree, in two stages (D2a, D2b below); region
scoring was never at fault.

Measured 2026-09-16 over 18 Chrome ticks: **0 content chars, 981 chrome chars
per tick, content-share 0.0%.**

The M0 screen spike measured **19,719 content chars** from Chrome with
`sawContentRole=100%` (`spikes/reports/screen.md`). So this is a regression, not
a known limitation, and it means browsing is currently barely captured at all.

**Localised 2026-09-17 to AX-tree reachability, not region scoring.** Two
Chrome captures, taken with the `--app` / `--delay` flags added the same day
(both needed: running `--dump` from a shell makes the *terminal* frontmost, so
every earlier sample measured the terminal and Chrome was unmeasurable from a
shell at all):

| Run | Chrome state | basis | content | chrome | nodes | depth | sawContentRole |
|---|---|---|---|---|---|---|---|
| `--app Chrome` | background | `none` | 0 | 2433 | 82 | 9 | false |
| `--delay 12`, no `--app` | frontmost, caret in page body | `none` | 0 | 2106 | 70–71 | 9 | false |

Both hypotheses standing on 2026-09-16 are **refuted** by those numbers:

- **Not the focus branch.** The theory was that `selectContentRegion` returned
  the address bar because the focus branch (`ContentScoring.swift:68`) picks the
  smallest focused region with no area or prose gate. But `basis=none` means the
  function returned nil — *no candidate region held any text* — so the focus
  branch never ran. Gating it would have changed nothing. Recorded here because
  the fix was already drafted against the wrong cause.
- **Not a background-read limitation.** Frontmost with the caret in the page
  body gives the same tree (70 nodes vs 82, still 0 content, still
  `basis=none`), so `kAXFocusedWindowAttribute` returning a thin tree for a
  background app is not the explanation either.

What both runs agree on: the walk stops at ~70–82 nodes and depth 9 — browser
frame and toolbar — and never enters a web area. Chrome's page content is not
being mis-scored; it is **never reached**. The ~2.1–2.4k chars are all chrome.

### D2a — reachability: FIXED

The cause was not an accessibility opt-in. `enableManualAccessibility` was
discarding the `AXError` from its set call, and surfacing it showed
Chrome rejecting `AXManualAccessibility` with `kAXErrorAttributeUnsupported`
(-25205) — and `AXEnhancedUserInterface` with -25208. Chrome implements
neither, so the poke had been a silent no-op for Chrome since it was written.

A probe then measured what *does* populate the tree: **being walked**. With
neither attribute set, Chrome went 561 → 963 nodes, depth 10 → 25, no web area
→ web area, within 0.5 s of a walk. Chromium builds the tree in response to a
client querying it, asynchronously, and tears it down when no client holds it.
So the first walk both measured and triggered population, the payoff always
landed after the measurement, and each isolated 3 s tick paid the cold-start
cost again.

Fix: a window whose walk found no content role is walked again after 0.6 s
(`AXReader.warmUpDelay`). Keyed on the *result*, never on app identity, so it
covers any lazily-built tree. Measured on Chrome:

| | before | after |
|---|---|---|
| nodes | 70 | 1672 |
| depth | 9 | 41 |
| `sawContentRole` | false | true |
| `axChars` | 2102 | 13180 |
| `basis` | `none` | `focus` |

Cost: 317 ms on the first tick, 251 ms after, and only on windows that come
back empty.

### D2b — selection: NOT A BUG (closed 2026-09-17)

**Region scoring was correct the whole time.** `--regions`, added to print the
candidate list a capture never exposes, settles it — on a warm tree Chrome
offers three candidates and scoring picks the right one:

```
  id   area%  focus  prose  chars   head
*  0    91.7   yes    yes    8377   Skip to content Chat history…
   1     7.4   —      yes     696   India Sub Accounts App…
   2     5.3   —      yes      66   daily.dev | Where developers…
```

The 802-content reading that opened D2b came from a **half-warmed tree**, not
a bad pick. `warmUpDelay`'s single 0.6 s retry stopped as soon as it found *a*
content role, which on a cold Chrome window is a thin one: 70 nodes cold, 182
after one retry, against the 1,085 the tree settles at. Fixed by retrying while
the tree still grows; Chrome now reads 8,335 content / 6,639 chrome,
a 56% content-share.

Four hypotheses were tried and each is disproved by measurement. Recorded so
none is re-attempted:

1. **Focus branch picks the address bar.** No — the focused element in Chrome
   is `AXWebArea` / `AXLink` / `AXButton`, never a text field, and the winning
   region is the 91.7% page body.
2. **Gate the focus branch on area + prose.** Breaks Slack's compose box (10%
   of window area) and falls through to the sidebar-plus-document blob.
3. **Gate on text share.** Slack's compose box is 19% against a 20% threshold —
   noise, not signal.
4. **`textRoles` is too narrow an allowlist.** No — it keeps 8,849 of 9,012
   chars (98%); `AXStaticText` alone carries 8,523.

The lesson worth keeping: a capture reports the winner and the basis but never
the field of candidates, so a bad pick and a bad candidate set are
indistinguishable from outside. Four wrong hypotheses came from theorising about
selection without ever looking at what selection was choosing between. Reach for
`--regions` first next time.

---

## D3 — The content/chrome split discards the better text

**Status:** open. No longer the active work item — M1 closed and D2 removed
Chrome from this entry's scope, leaving Slack as the one measured case.

Region scoring picks one winning region as "content" and discards everything
else as "chrome". For several apps the discarded half is the *better* text.

Measured on Slack, same capture:

| Half | What it contained |
|---|---|
| content (1020 chars) | bare clock times, mangled words (`V edant`), no speakers, no dates |
| chrome (9509 chars) | `Alex: Casey, I need your Apple ID. 4:34 PM.` — speaker attribution, clean text, **and day separators correctly interleaved between message runs** |

Content-share by app, 2026-09-16:

| App | n | content/tick | chrome/tick | content-share |
|---|---|---|---|---|
| Google Chrome | 18 | 0 | 981 | 0.0% |
| Slack | 12 | 644 | 2134 | 23.2% |
| Zed | 5 | 0 | 29 | 0.0% |
| Ghostty | 4 | 15526 | 30 | 99.8% |

The text was already captured — `axChars` held it — and then thrown away by
classification. This is a category error, not a threshold that needs tuning.

**Chrome's 0.0% row was a different fault, now fixed.** It was not the split
discarding good text: the page content never entered the AX tree at all (D2).
Chrome now measures **8,335 content / 6,639 chrome, a 56% content-share**, and
is no longer a D3 case. The table below predates that fix.

**Zed is a third, distinct fault.** Re-measured 2026-09-17 with the warm-up
retry in place: **5 nodes, depth 2, 23 chars, `basis=none`, `axMs=794`** — the
retry ran (hence the ~0.8 s) and changed nothing. Zed also rejects
`AXManualAccessibility` (-25205). So this is neither D2a's lazily-built tree nor
D3's discarded half: Zed exposes essentially no accessibility tree at all, and
there is no text to recover by any scoring change. Zed is GPUI-rendered, which
draws its own UI rather than using AppKit controls, so this is likely a real
platform limitation rather than a bug in Nova — the OCR path (spec Flow 2) is
the only plausible route to Zed's content. Tracked here rather than in D2,
which is Chrome-specific.

**Direction:** when content-share falls below a threshold, hand the extractor
both halves instead of one. One generic rule, no app names in the code. The
prompt already instructs the model to skip interface noise, which is the job
this would lean on.

**Explicitly rejected:** per-app parsers. The user's reasoning is correct —
macOS has thousands of apps, and a parser per app is unmaintainable and breaks
on every app update. The M0 report's per-app-parser recommendation should be
read as describing the symptom, not prescribing the cure.

---

## D4 — Slack day separators are captured but unused

**Status:** open, partially mitigated.

Slack's day separators (`Wednesday, August 5th`, `Today`) **are** in the AX tree
and **are** positionally interleaved with messages — but they land in the chrome
half, which extraction never sees. The content half carries bare clock times
(`3:09 PM`) with no day at all.

History worth keeping, because it cost two rounds:

1. With no capture context, the model invented dates outright (`June 25, 2025`,
   `2025-01-01` for content captured that morning).
2. Told the capture date was "the only date you know", it stamped a scrolled
   backlog with it — messages from 27 Aug and 11 Sep all recorded as 15 Sep.
   **Worse than the invention**: an invented date reads as wrong, a confidently
   misdated one does not, and nothing downstream can detect it.

Current contract (current): the read date is given as when the *screen
was read*, explicitly not as authorship; a memory gets a date only when the
content states one; a bare clock time is not a date. Undated is the correct
outcome, and provenance still carries the capture time, which is what recency
ranking actually uses.

Separators carry a UI suffix (`… Press enter to select a date to jump to.`) that
must be stripped before the date is usable.

**Largely subsumed by D3** — fixing the split brings the separators along. Worth
re-measuring after D3 rather than building separately.

---

## D5 — Empty captures are counted but not explained

**Status:** open, low severity.

`[capture] suppressed 180 (empty=88 not-novel=92)` — roughly half of all
suppressions were empty AX reads, with no record of which app produced them.

The spec's silent-failure rule (§7) requires an empty capture be "logged with a
reason — never silently treated as normal". A bare counter does not meet that.

If empties stay near half, they may indicate a whole surface Nova cannot read —
the Zed-class gap, which the table in D3 shows is real (Zed: 0 content, 29
chrome chars per tick).

---

## D6 — int8 vectors: revisit precision

**Status:** CLOSED 2026-09-18 (§4.1a).

Re-measured on 277 real embeddings tiled to 120k rows. The answer inverted the
expected preference order: **int8[1536] stays**, because at k=500 it beats
768/1536-dim float32 on every axis at once. What actually needed fixing was the
over-fetch depth — k=50 recovered only **68%** of the true top-10, not the
98.5% the synthetic benchmark claimed. k=500 reaches 100% at 77 ms p50.

Two side findings recorded in §4.1a: `gemini-embedding-001` does not
renormalize truncated dimensions (real vectors have norm ≈0.699), which is
harmless under the shipped max-abs quantizer but would cost ~30% of int8 range
under the `'unit'` quantizer §4.1's *text* names — the spec was wrong, the code
was right. Native 768-dim was never measured and is now a cost/storage
question, not a quality one.

---

## D7 — Extraction drains one version per 15s tick

**Status:** open, low severity.

`nova start` runs `setInterval(drainQueue, 15_000)` and processes one version
per tick. A backlog of 20+ versions takes minutes to clear. Fine for a single
user browsing live; slow after any outage or a long retry backoff.

Draining until the queue is empty, or a few per tick, is a small change.

---

## D8 — Zed publishes no accessibility tree

**Status:** addressed 2026-10-05 by the generic OCR fallback. Capture now OCRs
any window `OCRGate` finds AX-unreadable, throttled per window, so Zed needs no
per-app code. Unmeasured on Zed itself.

Re-measured 2026-09-17 with the warm-up retry in place: **5 nodes, depth 2,
23 chars, `basis=none`, `axMs=794`** — the retry ran and changed nothing. Zed
also rejects `AXManualAccessibility` (-25205).

This is neither D2a's lazily-built tree nor D3's discarded half: Zed renders
through GPUI, which draws its own UI rather than using AppKit controls, so there
is no tree to warm and no text for any scoring change to recover. The OCR path
(spec Flow 2) is the only plausible route to its content, and `OCRGate` already
classifies Zed correctly as `no-content-role`.

**Cost of leaving it:** an editor-class app is invisible to Nova. The M0 report
anticipated this for VSCodium, which `AXManualAccessibility` fixed; Zed does not
have that escape hatch.

---

## D9 — Warm-up retries cost 1.3 s on every genuinely empty window

**Status:** open, low severity. Introduced by the D2a/D2b fix.

`AXReader` now walks a window up to `maxWarmUpAttempts` (3) times with a 0.6 s
sleep between attempts when no content role is found. For a cold Chromium window
that recovers the tree — the point of the fix. For a window that genuinely
exposes nothing it is pure cost, paid on every tick forever: Zed measures
`axMs=794` against Ghostty's 100 ms, and a window with no tree at all would pay
the full ~1.8 s.

The capture loop ticks every 3 s, so this is not yet a correctness problem. It
becomes one if the daemon ever samples several apps per tick.

**Fix shape:** remember pids that have failed to warm N times and skip the retry
for them, with a periodic re-check so an app that later gains a tree is not
permanently written off. Deliberately not built yet — it needs a real dogfood
run to show which apps actually sit in that state.

---

## D10 — The observer-framing prompt change is unmeasured

**Status:** open, low severity. Shipped without its verification.

The observer-framing paragraph added to `buildExtractPrompt` is reasoned but not
measured. Its verify step asks for an A/B over *stored* versions — re-extract
content already in the store under both prompts and diff, never new captures,
since new content makes the comparison meaningless.

That run was attempted and abandoned: the obvious sample (most recent versions)
includes captured credential pages, so re-extracting them would send that
content to the provider twice over. One decrypted password line reached a
session transcript before the script was deleted.

**To finish it:** select the A/B corpus to exclude sensitive captures — either
filter by source title/URL, or A/B on hand-written synthetic captures, which
tests prompt behaviour without touching real data. Blocked on the same judgement
D1 exists to solve, which is why it is parked here rather than retried.

---

## D11 — Entities and facts are specified but unbuilt; loops hold name strings

**Status:** open, deliberate. Deferred at the start of M2 (2026-09-18).

`docs/data-model.md` §1.2 specifies `entities`, `facts` and
`fact_embeddings`, and §2.4 specifies a `get_entity` MCP tool. None of it is
built — M1 delivered the memory layer only (`memory_threads`, `memory_versions`,
`memory_derivatives` plus vectors).

F4's `open_loops` schema declares `counterparty TEXT REFERENCES entities(id)`,
which therefore cannot be satisfied as written. **M2 stores the counterparty as
a plain name string instead** ("Dana Reyes"), so F4 ships without waiting on an
entity subsystem.

**What that costs today.** No counterparty deduplication: loops mentioning
"Dana", "Dana Reyes" and "dana@acme.com" are three different strings and
will not aggregate. Tolerable for a single-user store; wrong at scale. It also
means no cross-loop views ("everything involving Dana") and no answer to the
PRD's "who have I not spoken to in 30+ days", which §2.4 assigns to
`get_entity`.

**Why it was deferred.** The entity work is not the table — it is resolution
(aliases, fuzzy matching, a merge path for wrong merges), an extraction prompt
for entity mentions, the `facts` table with its `superseded_by` chain, and the
`get_entity` tool. Estimated 2-3 days on top of F4's own 2-3, and like loop
precision its quality is only knowable by measuring it against real data. F4's
value does not depend on it: a loop naming a counterparty as a string is still
actionable.

**Migration path when it lands.** `open_loops.counterparty` already holds the
names, so resolving them to entity ids is one backfill pass over that column
plus a schema change to add the FK. Nothing needs re-extracting.

---

## D12 — Loop detection precision is 47%, target is 70%

**Status:** CLOSED 2026-09-19. Precision is **88%** on the same six
captures, against F4.5's ≥70% bar.

| | before | after |
|---|---|---|
| candidates | 17 | 8 |
| rated real | 8 | 7 |
| **precision** | **47%** | **88%** |
| attendance false positives | 4 | 0 |
| self-as-counterparty | 4 | 0 |

Recall fell with it (17 candidates to 8), which is the trade F4.5 asks for in
so many words. One of the remaining 8 is still wrong — a loop describing
something already done, which the prompt's own "already visibly done" exclusion
should have caught. Left at 88% rather than tuned further: the next change
should be measured against a larger sample than six captures.

**Identity is configured, not derived.** `NOVA_USER_NAME` and
`NOVA_USER_ALIASES` today; when the app ships a login (F6.2) it comes from the
signed-in profile and the env vars become the self-host escape hatch. Unset
identity is supported and degrades to refusing a direction rather than guessing
one.

The original diagnosis, kept because the second half was a design gap rather
than a wording problem:

F4.5 sets the bar at "≥ 70% of surfaced loops rated real", and states why:
false loops erode trust. Six real Slack captures produced **17 candidates, 8 of
them real — about 47%.** The machinery works; the prompt does not clear the bar.

The failures are specific, not diffuse, which is why this is worth a task rather
than a rewrite:

**1. Attendance and availability notices (4 of 9 false positives).** A standup
channel produced "Will reach by 12", "Won't be available post 4 PM today",
"available after 12:30 due to fever". These are status announcements — nobody
tracks them, and nothing closes them. The prompt's exclusion list covers
articles, task trackers and interface text but never anticipated this shape.
Fix: name it in the exclusion list. Cheap.

**2. Direction inverts when the user is a named participant.** Four loops from
one capture read `owed_to_me` with `counterparty: "Alex"` — Alex is the user, so
every one should be `i_owe`. The prompt is never told who the user is, so it
cannot tell which side of a conversation they are on, and defaults to reading
the named person as the counterparty.

This is a design gap, not wording. `CaptureContext` carries app, title, url and
capturedAt; it has no notion of identity. Options:

  - Ask at onboarding and store it (F6.2 already has an onboarding flow).
  - Derive it per app: Slack exposes the signed-in user, browsers do not.
  - Infer from the corpus — the name appearing in most first-person
    constructions. Cheapest, and unreliable in exactly the DM case that matters.

Storing a configured identity is the honest fix, and it is a prerequisite for
F4 being useful at all: a to-do list that cannot tell what *you* owe from what
someone owes you is worse than none.

**Cost of leaving it:** F4.3's digest would surface roughly one false item per
real one, which is the failure mode F4.5 exists to prevent. Do not build the
digest on top of this.

## D13 — The `until` clamp test asserts a future default

**Found** 2026-09-21, reviewing Task 3 of the M2 daemon-control plan.

`daemon/test/control.test.ts`'s clamp test, Case 2, sends `until: null` and
asserts the resulting snooze lands in the future. That holds today because
`nextNineAmLocal()` returns *tomorrow* 09:00 whenever the clock is past 09:00,
and the suite has only ever run in the late morning. Run the same assertion
between 00:00 and 09:00 local and the default is *today* 09:00 — already past —
and the test fails against correct code.

The defect is mine, not the implementer's: my dispatch told the agent to assert
the null case "falls back to the default 09:00 snooze" without noticing the
default can be in the past.

Not a code bug. `actOnLoop`'s default is what it tests, and that default is
deliberate — a loop snoozed at 02:00 surfacing at 09:00 the same morning is the
intended behaviour. The fix is to assert the value equals `nextNineAmLocal()`
rather than that it exceeds `Date.now()`.

**Cost of leaving it:** a red suite for anyone running tests before 09:00.

---

## D14 — A drain in flight is abandoned at shutdown

**Found** 2026-09-21, reviewing Task 5 of the M2 daemon-control plan.

`nova start` schedules extraction drains on a `setInterval` that `shutdown()`
never clears. The timer cannot outlive the process — `shutdown` calls
`process.exit(0)` within 500 ms — so this is not a leak. The real consequence is
narrower: a drain already in flight when a signal arrives is abandoned mid-work
rather than awaited.

### The original rationale was wrong

This entry first said the abandoned work "is picked up on the next start, which
is what that queue exists for," and deferred it on that basis. The final
whole-branch review disproved it, and the correction is recorded here rather
than quietly edited away.

The abandoned job is **not** retried on the next start. It is retried ten
minutes later, at the earliest. The drain holds a queue claim
(`status='processing'`, `claimed_at=now`), and the reclaim arm only re-picks a
row once `claimed_at < now - CLAIM_TIMEOUT_MS`, which is 10 minutes. So a
daemon that restarts two seconds later still waits out the whole window.
Nothing else rescues the row: `enqueueExtraction` uses `INSERT OR IGNORE`, so
it no-ops against the existing row, and the overwrite path in `threads.ts`
resets `embedding_status` but not the queue row's `status` or `claimed_at`.

This was only visible with three things in view at once — the claim column, the
new signal handling, and the re-enqueue path — each from a different task. No
single-task review could have caught it, which is what a whole-branch review is
for.

### Fixed rather than deferred

Stale claims are now released at daemon startup: any row still `processing` when
a fresh `nova start` begins was abandoned by a previous run, since no drain can
legitimately be in flight in a process that has not started one yet.
`CLAIM_TIMEOUT_MS` and the reclaim arm are unchanged — the timeout still covers
what startup release cannot, namely a holder dying while another process runs.

What remains deferred is only the original narrow point: `shutdown` does not
*await* an in-flight drain. That is now harmless, because the work is recovered
promptly instead of sitting for ten minutes. Awaiting properly belongs with the
native Swift supervisor that will own process lifecycle. See also [[D15]].

---

## D15 — Shutdown never waits for the capture child

**Found** 2026-09-21, in review of Task 5 of the M2 daemon-control plan.

`shutdown()` in `daemon/src/cli.ts` sends `proc.kill()` to the capture child and
then exits after a fixed 500 ms, with no `await proc.exited` and no escalation
to `SIGKILL`.

Today this is harmless, and verified so: `nova-capture` installs no signal
handler at all, so the default `SIGTERM` disposition terminates it immediately
and the 500 ms window is never needed. The grace period buys nothing.

It becomes a real bug the moment capture traps `SIGTERM` — to flush a frame or
release the AX tree, say. A handler that takes longer than 500 ms, or that
blocks, leaves the parent exiting first and the child reparented to PID 1 as an
orphan holding screen-recording permission. The mechanism was reproduced in
review with a `trap '' TERM` child.

The correct fix is to await the child's exit and escalate to `SIGKILL` on a
timeout. That is process-lifecycle work, and the native Swift supervisor
(spec §8) is the component that will own it, so the fix belongs there rather
than in the CLI wiring.

**Cost of leaving it:** nil today. One orphaned capture process per stop, once
a capture-side signal handler exists.

---

## D16 — No TypeScript typecheck exists

**Status:** closed 2026-09-21.

**Found** 2026-09-21, while fixing Task 5's review findings.

The daemon is TypeScript and has never been type-checked. Verified:

- `daemon/package.json` lists no `typescript` in `devDependencies` and defines
  no typecheck script. Its only script is `start`.
- `npx tsc --version` in `daemon/` resolves to a **global TypeScript 3.7.5
  (2019)**, which cannot parse `import type` and errors on files nobody
  touched.
- `bun test` is the only gate. Bun strips types at load and does not check
  them, so a genuine type error passes the suite.

So no command in this repository can currently catch a type error.

This matters beyond tidiness: the project's own verification rule requires a
type-check before pushing. That step has been silently unenforceable, which
means "verified before push" has meant tests-only for the whole project.

**Closed 2026-09-21**, at the branch's pre-push gate rather than
inside a fix round. Added `typescript` to `devDependencies` (7.0.2) and a
`typecheck` script running `tsc --noEmit`. The strict tsconfig was already
present; it had no compiler able to run it.

The first run found exactly one real error, in code from this same branch:
`params` in `actOnLoop` was typed `unknown[]`, which `bun:sqlite`'s `run()`
rejects as bindings. Typed `SQLQueryBindings` instead, imported from the same
module as `Database`, so no cast was needed. `bun run typecheck` is clean and
the suite stayed at 155 pass / 0 fail.

One finding from one first run is a better outcome than expected, and it
argues the strict tsconfig was doing useful work through editor tooling even
while no command could enforce it.

---

## D17 — A snoozed loop can never auto-resolve

**Status:** CLOSED 2026-09-21. The operator chose the second
reading: **snooze means "stop processing this until later."** So skipping
snoozed loops in `resolveLoops` is correct and stays.

What was missing was the second half of "until later". A loop whose snooze had
expired was shown again by `listOpenLoops`, which surfaces on `snoozed_until`,
but stayed `state='snoozed'` and was never reconsidered. `wakeExpiredSnoozes`
now returns expired snoozes to `'open'`, and `resolveLoops` calls it first —
before resolution rather than on a timer, so there is no scheduler and no
drift. A loop still inside its snooze is untouched, which is what makes the
chosen semantics real.

**Found** 2026-09-21, in the final whole-branch review of the M2 control branch.

`resolveLoops` in `daemon/src/loops.ts` selects candidates with
`WHERE state='open'`. Both `listOpenLoops` and `actOnLoop` treat
`('open','snoozed')` as the actionable set. So auto-resolution is the one path
that ignores snoozed loops.

The consequence: snooze a loop, then finish the thing it tracks. F4.2 never
notices, because the loop is no longer `state='open'`. At 09:00 the loop
reappears as outstanding even though the work is done, and the user has to
dismiss it by hand — exactly the manual bookkeeping open loops exist to remove.

**Why this is not filed as a bug.** Both readings are defensible, and they
differ in what "snooze" means:

- *Snooze means "hide it, keep watching."* Then auto-resolution should include
  snoozed loops, and the filter is simply wrong.
- *Snooze means "stop processing this until later."* Then skipping it is
  correct, and the fix is instead to auto-resolve at wake-up time, before the
  loop is shown again.

The first is a one-word change. The second is a different feature. Picking
without a decision would be guessing at intended behaviour, so this waits for
one.

**Cost of leaving it:** a snoozed loop that got done still comes back at 09:00
and needs dismissing by hand.

---

## D18 — Nothing prevents two daemons running at once

**Status:** CLOSED 2026-09-21. **Refuse to start**, the option this
entry called almost certainly right, with `--force` as the deliberate takeover.

The deciding consequence was `pause`: with two daemons it reaches only the one
holding the socket, so a user who pauses because something sensitive is on
screen is told capture stopped when it did not. Silent, and a privacy failure
rather than an annoyance.

A pidfile beside the socket, checked before the store opens so a refused start
touches nothing. Liveness via signal 0; `EPERM` counts as alive, since refusing
is safer than assuming stale. A dead or unparseable pid is stale and replaced,
so the guard cannot wedge the daemon behind a file nothing cleans up.

The "take over" option was rejected for the bare command and kept for
`--force`. The project rule against killing processes was clarified to cover
local dev servers rather than this app's own daemon, so the objection recorded
below no longer applies; what rules it out for a bare `nova start` is that
silently killing a daemon mid-extraction discards provider calls already paid
for, and the usual second start is a mistake rather than an intent.

**Found** 2026-09-21, checking the startup claim release (see [[D14]]) for a
concurrency regression.

`startControlServer` unlinks any existing socket file before binding:

```
if (existsSync(path)) unlinkSync(path);
```

The reason is sound and documented in place — a crashed daemon leaves a stale
socket file, and without the unlink every restart after a crash would fail with
`EADDRINUSE`, exactly when restarting matters most.

The side effect is that a second `nova start` does **not** fail. It removes the
running daemon's socket and binds its own. The first daemon keeps running, keeps
its capture child, and keeps writing to the store, but is now unreachable: its
socket file no longer exists, so every client command talks to the second
daemon. Two daemons then run with two capture children, writing to one store.

Consequences, in rough order of how much they would annoy someone:

- Duplicate captures and double extraction cost, since both daemons drain the
  same queue.
- `pause` now only pauses the daemon that answers, leaving the other capturing.
  A user who pauses because something sensitive is on screen would believe
  capture had stopped when it had not.
- The startup claim release added for D14 fires in the second daemon and frees
  claims the first daemon is actively working, so both may extract the same
  version. The write is idempotent, so this costs duplicated provider calls
  rather than corruption.

None of this is caused by the D14 fix; it makes an existing hole easier to fall
into, which is why it is recorded now.

**The fix needs a decision, which is why this is not filed as a bug.** The
options differ in behaviour a user would notice:

- *Refuse to start.* Take an exclusive lock, and a second `nova start` exits
  with "already running". Simplest and safest. The lock must not reintroduce
  the stale-file problem the unlink exists to solve, so it needs liveness
  detection, for example checking the recorded pid.
- *Take over.* The second daemon deliberately stops the first. Recorded here as
  colliding with the project's rule against killing running processes; the
  operator later clarified that rule covers local dev servers, not this app's
  own daemon, so take-over became available and is what `--force` does.

The first option is almost certainly right, but it is a behaviour change to a
command the user runs by hand, so it waits for a decision.

**Cost of leaving it:** a mistaken second `nova start` silently doubles capture
and makes `pause` unreliable, with nothing in the logs naming the cause.

---

## D19 — The panel drops D9's search and timeline sections

**Recorded:** 2026-09-22 · **Status:** decided, recorded for the trail
**Source:** `design/design-system.md` §9.F

D9 (2026-08-12) decided the menu-bar surface would be a digest-first single
scroll: search → open loops → today's timeline, with a gear for settings. The
M2 shell spec §8 implements that layout and renders honest placeholders in the
two unbuilt sections, arguing correctly that omitting them would present a
finished shape D9 did not decide.

The design spec changes the surface D9 was describing, so the layout decision
no longer transfers cleanly.

**What changed.** There is no popover. One floating panel, opened by ⌃⌥ *or* by
clicking the menu-bar icon, is the only surface that lists loops; the icon
keeps a native menu for pause, settings, and quit. The panel renders a header,
the loop rows, and a keyboard legend — and **no placeholder sections**.

**Why the placeholders went.** D9's argument for them assumed a panel the user
opens to browse. The panel is summoned to answer one question, and it is
optimised to be read in about two seconds. An empty "Today's timeline" heading
in a two-second surface spends attention on something that does not exist yet,
which is a different trade than a placeholder in a scrolling digest.

The property D9's placeholder rule protected — not implying a finished shape —
is preserved a different way: the design spec states in §9.F that search and
timeline return **as modes** if they are built, rather than as sections, so the
panel's shape is explicitly provisional rather than silently truncated.

**What this does not change.** Search still lands via a socket `search` op when
it is built, and the timeline still waits on A3 `get_timeline`. Only their
presentation changed: a mode in the panel, not a section in a scroll.

**If the panel proves wrong in use** — if users do want to browse rather than
triage — the honest fix is to reopen D9 with evidence, not to quietly grow
sections back into the panel.

---

---

## Nova.app, stage 2: distributable

Stage 1 (the stage 1 app-bundle design) signs
`build/Nova.app` with a self-signed identity and runs the daemon from the
checkout, so it runs on this Mac only. To hand it to anyone else:

- a Developer ID Application certificate, named through `NOVA_SIGN_IDENTITY`;
- hardened runtime and whatever entitlements it then needs (audio capture will
  need its own — see the spike 2 note in `roadmap.md`);
- notarization and stapling;
- the daemon, its `node_modules` and a Bun binary inside `Contents/Resources`,
  with the native SQLCipher and sqlite-vec libraries signed — or the daemon
  compiled with `bun build --compile`, once that is shown to load them;
- Sparkle, per `architecture.md`.

The bundle id `io.github.cybertron288.nova` stays; the Accessibility grant is keyed to it.

---

## D20 — Nova on a managed or monitored Mac

**Recorded:** 2026-09-22 (as a one-line note) · **Status:** open, low — research

Added as a row without a body, alongside the D19 note. Recorded here with
what is actually known, so the row is not a reminder with no content.

**The question.** A Mac with an MDM profile, an EDR agent or corporate
monitoring software is a different privacy situation from a personal one.
Nova reads the screen and sends derived text to a provider the user chooses.
On a managed device:

- the employer may already be recording the same screen, so Nova is not the
  only reader and the user's consent is not the only one that matters;
- the provider key in `.env` may be the employer's, which makes captured
  work content their data rather than the user's;
- an MDM policy may forbid sending screen content off the device at all,
  which Nova cannot detect and would silently violate.

**Why it is low.** Nothing is broken today, and every unknown here is about a
deployment Nova has not shipped into. It stays open as research rather than
work because the answer is a policy decision, not a patch.

**What would move it.** A beta user on a managed Mac, or the first enterprise
enquiry. Either turns this from a hypothetical into a requirement, and the
likely shape of the answer is detection plus a refusal to capture, in the
same family as D21's non-overridable exclusions.

---

## D21 — Personal data and the unbuilt hard exclusions (PRIVACY)

**Closed 2026-10-06.** All three parts of the work below are built.

1. **Hard exclusions**, refused in `deniedSource` before anything is read:
   banking and payment hosts (matched on host, so prose about a bank is still
   ordinary content), private browsing windows (which also closes D19),
   screen-sharing apps and meeting hosts, and the user's own deny-list.
2. **Personal-data redaction** in `sensitive.ts`: cards on an issuer prefix
   plus Luhn, Aadhaar, PAN, SSN, CVV, and account numbers paired with an IFSC
   or a label. Luhn alone was not enough — the live sample's 14-digit account
   number passes it, which is why a real issuer prefix is required too.
3. **The emails-and-phones decision**: they stay in the store and are stripped
   from everything sent to a provider (`redactOutbound`, applied at the
   provider call boundary). A memory that cannot say who the user talked to is
   not worth keeping, and loop direction depends on the name; the provider
   does not need the address to read the sentence.

The user deny-list is a `user_exclusions` table edited over the control socket
(`nova exclusions` / `exclude` / `unexclude`, and the Activity tab). Adding an
exclusion also runs the purge, so an app excluded today leaves no history
behind. It is additive only: nothing subtracts from the refusals in part 1.

What remains out of scope, deliberately: the health-information line in the
original sample table is not a pattern anyone can match precisely, and a
regex that tried would fire on ordinary prose. An app or site that shows
such records belongs on the user deny-list.

---

## D22 — The transparency panel does not belong in the loop panel

**Recorded:** 2026-10-06 · **Status:** closed 2026-10-06
**Supersedes:** the Activity tab added earlier

F5.5 shipped as a third tab in the loop panel. That was the wrong surface, and
D19 had already said so: the panel is "summoned to answer one question, and it
is optimised to be read in about two seconds", and §9.F of the design spec
says deferred surfaces return **as modes, not as sections**. D19 removed two
*placeholder* sections for spending attention in a two-second surface; the
Activity tab put two working scrolling sections back into it.

**The category difference.** The panel is scanned; transparency is audited. A
user opens Activity when they are suspicious, when they are configuring, or
when they are deciding whether to trust Nova with their screen — and then they
read it, for minutes, wanting scroll and eventually filters. Those are
opposite design targets, and one surface cannot hold both without the
two-second claim quietly becoming false.

**The decision.** An **Inspector window** in the same app — not a second app.
One bundle, one signature, one supervisor, opened from the menu-bar menu.
A separate binary would buy clean separation and cost a second
signing/notarization target, a second update path and two Finder entries, for
a surface the user opens rarely.

**Why a window at all, rather than leaving it in the CLI.** Five unbuilt
things need the same home, and without one each gets bolted onto the panel
and D19 dies by a thousand cuts:

- F5.5 activity (this item)
- F5.4 retention policy
- D21's user deny-list (CLI-only today)
- F5.6 telemetry opt-in
- F6.2 onboarding and the MCP connect instructions
- F2.5 daily summaries and F3.3 `get_timeline`, when they browse

**Scope of the first version:** Activity only, with the pane structure ready
for the rest. Everything on the daemon side stays as built — `provider_calls`,
`listRecentCaptures`, and the `list_calls` / `list_captures` / exclusion ops
are surface-agnostic and were never the mistake.

**What would reopen this:** evidence that users do want to browse in the
panel. Per D19's own closing line, that reopens D9 with evidence rather than
growing sections back into the panel.

---

## D23 — F4.4's "open source context" cannot work for every app

**Recorded:** 2026-10-07 · **Status:** decided — out of P0, deferred
**Source:** operator judgement 2026-09-24, formalised in the M2 plan §2.1

A loop row offered to open the app the loop came from. Slack can be raised but
not scrolled to the message, so the button lands the user in the right app and
the wrong place — which is worse than no button, because it implies precision
it does not have.

**Decided:** moved out of F4.4's P0 set. It returns when it can work for every
app Nova captures, not before. `features.md` records the same, so the M2 gate
does not depend on it.

**Why not a partial version.** The "polished or not at all" rule: a button
that works in two apps and misleads in the rest trains the user to distrust
every row it appears on.

---

## D24 — Profile shows facts Nova formed, which are unbuilt

**Recorded:** 2026-10-07 · **Status:** decided — name and handles in M2
**Source:** M2 plan §2.2, 2026-10-07

The Your Space design promises a Profile pane holding "the facts Nova has
formed about you". That needs entities and facts, which are D11 and unbuilt.

**Decided:** M2 ships Profile as the user's **name and handles**, editable —
`NOVA_USER_NAME` and `NOVA_USER_ALIASES`, which today can only be set by
editing `.env`. Facts wait for D11 in M3, and the design's promise text is
corrected to match what the pane does.

**Why this is the valuable half anyway.** Loop direction is unanswerable
without the identity (D12: four commitments came back inverted, with the
user's own name as counterparty). A pane that fixes a wrong name is worth more
to a beta user than one that lists facts.

---

## D25 — Delete and retention have no home in Your Space

**Recorded:** 2026-10-07 · **Status:** decided — a fifth pane
**Source:** M2 plan §2.3, 2026-10-07

F5.3 (delete memories by range, app or all) and F5.4 (retention policy) are
both unbuilt and both need a surface. The sidebar holds Activity, Blocked
apps, Permissions and Profile.

**Decided:** a fifth pane, **"Your data"**, holding delete and retention.
Drawn in Claude Design before it is built, the same way Activity was.

**Why its own pane.** Deleting memories and setting how long they live are the
same question asked two ways — how much of this do I keep — and both are
destructive enough to want their own surface rather than a corner of Activity.

---

## D26 — The beta gates need data no backend can receive

**Recorded:** 2026-10-07 · **Status:** decided — local counters plus export
**Source:** M2 plan §2.4, 2026-10-07

Two of the three M2→M3 gates cannot be measured today: activation ≥ 50% needs
an onboarding funnel, and crash-free ≥ 99.5% needs crash reporting. F5.6 says
telemetry is opt-in and metadata-only, and no backend exists to receive it.

**Decided:** **local counters plus an "Export diagnostics" button** that a
beta user attaches to feedback. The gates are computed from the exports.

**Why not a hosted collector.** It needs no server, it cannot leak what it
never transmits, and it matches the privacy claim the product is sold on. A
collector is revisited for M3, when the relays exist and there is already a
server to put it beside.

**What this costs.** The gates are measured from whatever users send back, so
the sample is self-selected. Acceptable for ~200 invited users; not acceptable
once the funnel decides spend.

---

## D27 — Another Mac cannot run Nova

**Recorded:** 2026-10-07 · **Status:** decided — Developer ID, notarize
**Source:** M2 plan §2.5, 2026-10-07

The daemon runs from the checkout with Bun, and the app is signed with a
self-signed "Nova Dev" identity that only this machine trusts. M2's
deliverable is an invite-only beta of about 200 users, which is impossible in
that state regardless of how many features land.

**Decided:** pay for an **Apple Developer ID** ($99/year) and ship a signed,
notarized build.

**Why there is no alternative.** Nova asks for Accessibility and Screen
Recording. macOS will not let a non-developer grant those to an unnotarized
app without steps no beta user should be asked to take. Without this the beta
is limited to developers who build from source, which does not test what the
beta exists to test.

---

## D28 — M1 named an auth service and relays the product no longer has

**Recorded:** 2026-10-07 · **Status:** decided — neither ships in M2
**Source:** M2 plan §2.6, 2026-10-07

M1's scope named an auth service and embedding/transcription relays. The
product has since moved to bring-your-own provider, so F6.2's "sign in" step
has nothing to sign into.

**Decided:** M2 ships with **no account and no relay**. Both move to M3
alongside F3.2's remote MCP, which is the first thing that actually needs an
identity.

**What this changes in M2.** Onboarding (F6.2) loses its sign-in step and
becomes: grant permissions → choose a capture policy → connect your AI. That
is a shorter funnel than the one the ≤3-minute target was written against,
which makes the target easier rather than harder.
