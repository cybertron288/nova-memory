# Spike report: episode summarization — relay vs on-device (D4)

Measured 2026-08-13 on a MacBook Air, Apple M1, 8 GB RAM (1.5 GiB free at run
time), macOS 15.4. Fixture: one synthetic ~15-minute work episode (10 captures).

| Model | Latency | Valid JSON | Cost/episode | Cost/user/day (40 episodes) |
|---|---|---|---|---|
| gemini-3.6-flash (relay) | 7847 ms | true | $0.00430 | $0.172 |
| llama3.2:3b (on-device) | 41293 ms | true | $0.00000 | $0.000 |

Pricing verified 2026-08-13 against ai.google.dev/gemini-api/docs/pricing:
gemini-3.6-flash Standard is $1.50/M input, $7.50/M output (output includes
thinking tokens). Batch and Flex tiers are half that — relevant because episode
summarization is inherently batchable (see verdict).

An earlier run against `gemini-2.5-flash` returned HTTP 404 ("no longer
available to new users"); the model ID was updated to `gemini-3.6-flash` and the
pricing constants corrected from a stale $0.30/$2.50 before this run.

## Outputs (manual rubric: score each 1–5 on coverage / accuracy / loop precision)

### gemini-3.6-flash (relay)

- **coverage: 5/5 · accuracy: 5/5 · loop precision: 5/5**
  - Coverage: found both true loops — "Send Q3 planning deck to Jordan"
    (`i_owe`, Jordan, by Friday) and "Book team offsite venue" (`i_owe`, this
    week). Nothing missed.
  - Accuracy: summary is correct and appropriately compressed; entities are
    clean and correctly typed (Jordan/Marco as people, Q3 deck and relay.ts as
    artifacts, Stripe/Dodo as orgs). Evidence quotes are verbatim and point at
    the right captures.
  - Loop precision: **avoided the trap** — the offsite budget sign-off, which
    is resolved inside the episode at 10:10, is correctly reported as
    completed context in the summary and NOT emitted as an open loop.
    Directions are correct on both loops.
  - Only nit: `counterparty` is null on the venue loop where Marco is arguably
    the requester. Defensible either way — he assigned it rather than awaiting
    it — and not scored against.

```json
{
  "summary": "The user coordinated team tasks on Slack, confirming to Jordan that Marco approved a $12k budget for the team offsite, and subsequently searched for Lisbon venues on Airbnb. They also reviewed the Q3 planning deck, which needs to be sent by Friday. In between management tasks, the user implemented and successfully tested a rate-limiting middleware in relay.ts and researched merchant of record options.",
  "entities": [
    {
      "kind": "person",
      "name": "Jordan"
    },
    {
      "kind": "person",
      "name": "Marco"
    },
    {
      "kind": "artifact",
      "name": "Q3 Planning Deck"
    },
    {
      "kind": "artifact",
      "name": "relay.ts"
    },
    {
      "kind": "org",
      "name": "Stripe"
    },
    {
      "kind": "org",
      "name": "Dodo Payments"
    }
  ],
  "loop_candidates": [
    {
      "description": "Send Q3 planning deck to Jordan",
      "direction": "i_owe",
      "counterparty": "Jordan",
      "due_signal": "by friday",
      "evidence_quote": "[2026-08-12T10:00:05Z · Slack] jordan: can you send the q3 planning deck by friday? also the offsite budget needs sign-off"
    },
    {
      "description": "Book team offsite venue",
      "direction": "i_owe",
      "counterparty": null,
      "due_signal": "this week",
      "evidence_quote": "[2026-08-12T10:05:02Z · Mail] from marco: offsite budget approved at 12k, book venue this week"
    }
  ]
}
```

### llama3.2:3b (on-device)

- **coverage: 1/5 · accuracy: 1/5 · loop precision: 1/5**
  - Coverage: found 1 of 2 true loops, and even that one is malformed. The
    venue booking is missed entirely.
  - Accuracy: **hallucinated a completed action** — "They booked a venue in
    Lisbon for October 12-14." The captures show an Airbnb *search*, not a
    booking. This is the worst possible failure mode for a memory product:
    it would mark an open commitment as done. It also asserts the deck was
    already sent ("The user sent a Q3 planning deck") when the capture shows
    only a promise to send it.
  - Loop precision: the single loop conflates the deck and the budget into one
    item, emits an invalid `direction` value (`i_owed` — not in the schema's
    enum), gives an unusable `counterparty` ("Jordan or Marco"), and a
    meaningless `due_signal` ("approved"). It also inverts the semantics: the
    deck is owed BY the user, not to them.
  - Consistency note: an earlier run of the same fixture produced a different
    but equally wrong answer (that time reporting `owed_to_me` and folding in
    the budget), so this is not a single unlucky sample.

```json
{
  "summary": "The user sent a Q3 planning deck and received approval for an offsite budget of $12k. They booked a venue in Lisbon for October 12-14.",
  "entities": [
    {"kind": "person", "name": "Jordan"},
    {"kind": "person", "name": "Marco"}
  ],
  "loop_candidates": [
    {
      "description": "Sent Q3 planning deck and received approval",
      "direction": "i_owed",
      "counterparty": "Jordan or Marco",
      "due_signal": "approved",
      "evidence_quote": "[2026-08-12T10:01:12Z · Slack] you: yes will send the deck by friday. budget — checking with marco"
    }
  ]
}
```

## D4 verdict

**Decision: relay LLM (`gemini-3.6-flash`) for episode summarization. The
on-device 3B model is not viable.** Decided on quality; cost and latency agree.

| Axis | Relay | On-device | Winner |
|------|-------|-----------|--------|
| Quality (15/15 vs 3/15) | Perfect on the fixture | Hallucinated a completed booking, invalid enum, missed a loop | **Relay, decisively** |
| Latency | 7.8 s | 41.3 s (5.3× slower) | **Relay** |
| Cost | $0.0043/episode, $0.172/user/day | $0 marginal | On-device |
| Privacy | Content leaves device (transiently, via relay) | Never leaves device | On-device |

**Why quality settles it.** Cost and privacy favour running locally, and those
are real Nova values — but a memory product whose extraction layer *invents
completed actions* is worse than no extraction. The 3B model claimed a venue was
booked when the user had only searched, and claimed a deck was sent when it was
only promised. Nova's core promise is closing open loops; a model that silently
marks them closed inverts the product. No amount of cost saving compensates.

**Cost is affordable but not trivial.** $0.172/user/day is ~$5.20/month per
active user at 40 episodes/day — material against a free tier, and roughly 4×
what the plan's stale pricing constants implied. Mitigations, in order of
expected value:
1. **Batch tier halves it** to ~$2.60/user/month. Episode summarization is
   asynchronous by nature and an obvious fit for batched submission.
2. **Fewer, larger episodes.** 40/day assumes a 15-minute window; a 30-minute
   window roughly halves call count with more context per call.
3. **Dedupe before summarizing.** The screen spike measured 62.9% of samples as
   non-novel; episodes built only from novel content will be materially cheaper.

**Latency is a non-issue either way.** Episode summarization is a background
job; 7.8 s is irrelevant when the work is asynchronous. It would only matter if
summarization sat in an interactive path, which it does not.

**Do not read this as "on-device is dead."** It is a verdict on *3B-class models
for structured extraction*, on one fixture. Worth revisiting when: (a) a larger
local model fits comfortably in an 8 GB machine, (b) the extraction task is
split so a small model does the easy part (entity spotting) and the relay does
the judgment part (loop state), or (c) a user explicitly opts into lower quality
for full local privacy. Recommend M1 keep the summarizer behind an interface so
the backend is swappable rather than baked in.

**Caveats on this measurement.** Single fixture, single run per model, one
scorer. It is sufficient to decide D4 because the gap is enormous (15/15 vs
3/15) and the failure mode is categorical rather than marginal — but it is not a
benchmark. M1 should build a proper eval set of episodes with known-correct
extractions before tuning prompts.
