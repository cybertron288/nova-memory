# Nova — R7 entity graph: design

**Version:** 1.0 · **Date:** 2026-09-22 · **Implements:** R7
(`decisions.md`) · **Refines:** `data-model.md` §1.2

> R7 decided to keep Nova's entity/fact graph as an additive layer over
> derivatives, calling it "a genuine Nova improvement; don't drop it."
> `data-model.md` §1.2 specified the tables. M2 shipped without
> them, for the reason recorded at `daemon/src/db.ts:117` — *"Entities, facts
> and fact_embeddings are specified but unbuilt, and waiting on them would
> roughly double M2."*
>
> This document is the build design for that deferred layer. It refines the §1.2
> schema rather than replacing it; every departure is called out in §2.4.

---

## 1. Why now, and what prompted it

The question that started this was whether Nova should be rebuilt on
[graphify](https://github.com/Graphify-Labs/graphify) (Graphify-Labs, YC S26,
Apache-2.0, Python, ~120k stars, active). The answer is no — but the
investigation produced evidence worth acting on, and one correction to Nova's
own assumptions.

A second, independent source arrived at the same structure from a different
direction, and is recorded in §1.4 as a witness rather than as a dependency.

### 1.1 What graphify is

A CLI that turns a codebase into a knowledge graph: tree-sitter AST parsing for
code (deterministic, no LLM), an LLM semantic pass for docs/PDFs/media, Leiden
community detection, output as `graph.json` plus an HTML visualization. Its
stated thesis is "not a vector index — a real graph you traverse."

Its published benchmarks are in Nova's domain, not just code:

| Benchmark | graphify | Field |
|---|---|---|
| LOCOMO (n=300) recall@10 | 0.497 | BM25 0.362, mem0 0.048 |
| LOCOMO (n=300) QA accuracy | 45.3% | supermemory 49.7%, BM25 31.3%, mem0 27.3% |
| LongMemEval-S (n=50) QA | 76% | dense RAG 76%, mem0 70% |

### 1.2 What the investigation actually found

Four findings, each of which narrows what is worth taking:

**The benchmark harness is not in the repository.** `BENCHMARKS.md` describes
suites at `memory/` and `crosstool/`. Neither exists on the `v8` branch (910
files, checked 2026-09-22). The numbers are published; the code that produced
them is not. They are a vendor claim, not reproducible evidence.

**There is no prose extractor.** `graphify/extractors/` contains ~30 files — all
tree-sitter language grammars plus `markdown.py` (headings and link structure).
Nothing reads dialogue. All non-code content goes through a single LLM prompt at
`graphify/skills/agents/references/extraction-spec.md`, oriented at documents and
papers: no speaker modeling, no temporal reasoning, no episode boundaries.

**Its retrieval is weaker than Nova's.** `graphify query` matches nodes by
case-folded substring plus IDF. The reference states it plainly: *"no stemming,
no synonyms, no cross-language match."* The `graph-expand` configuration that
scored 0.497 is: an LLM selects ≤12 tokens from the graph's own vocabulary file →
substring-match up to 3 seed nodes → BFS depth 3 → rank by term overlap →
truncate at a character budget.

Nova's seeding is strictly stronger already: 1536-dim embeddings, int8 KNN at
k=500, exact float32 rescore, measured 100% recall@10 at 77 ms p50
(`daemon/src/search.ts:19-30`).

**So the benchmark result does not say what it appears to say.** It is not a
graph algorithm beating vector search. It is LLM query expansion plus blind
neighborhood expansion beating a substring matcher's own seeds. The part Nova
lacks is not graphify's retrieval — it is *having a graph to expand into at all*.

### 1.3 The decision

**Do not adopt graphify as a dependency.** Four blockers, any one sufficient:

- **Wrong input.** Graphify's cost and determinism advantage comes entirely from
  parsing source code. On prose it falls back to the same LLM pass Nova already
  runs, and the advantage disappears.
- **Storage model conflict.** Graphify writes a plaintext `graph.json` intended
  to be committed to git. Nova's posture is SQLCipher whole-file plus per-field
  AES-256-GCM with Keychain-held per-install keys (R8). A plaintext graph of the
  user's private life beside the encrypted store would undo that.
- **Batch, not streaming.** Graphify rebuilds on `git commit` / `git checkout`,
  diffing files. Nova is a continuous event stream with hour-bucketed versions.
  There are no files to diff.
- **Runtime cost.** Embedding a Python 3.10+ runtime in a notarized menu-bar app,
  beside a Bun/TS daemon and Swift helpers, for a component whose value is an
  algorithm choice rather than a service.

**Do adopt three design elements**, detailed in §3.1: the edge-provenance model
with its discrete confidence rubric, `semantically_similar_to` edges, and graph
expansion as a rerank stage.

**Explicitly not taken:** tree-sitter extraction, `graph.json` as a storage
format, the substring matcher, the git-hook rebuild model, and Leiden community
detection (see §5.3 for why Leiden specifically is deferred rather than rejected).

### 1.4 A second witness: Karpathy's LLM Wiki

Independently of graphify, Andrej Karpathy published an
[LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
(April 2026), described as "a spec, not a piece of software". It is a pattern
for durable agent memory:

- **Three layers** — `raw/` immutable sources, `wiki/` LLM-maintained markdown,
  and a schema file setting the conventions.
- **Three operations** — *ingest* (read a source, write a summary page, update
  the index, update entity and concept pages, append to the log), *query*
  (search, synthesize with citations, file good answers back), and *lint*
  (find contradictions, stale claims, orphan pages, missing cross-references).
- **Filesystem-first** — markdown with `[[wiki-style]]` cross-links, explicitly
  "not a vector database, not a custom RAG pipeline".

Its slogan is *"stop re-deriving, start compiling."*

**Why it matters here.** It reaches entity pages plus cross-links from a
completely different direction than graphify — no benchmarks, no graph library,
no retrieval claim, just what an agent needs in order not to re-derive what it
already knew. Two independent paths landing on the same structure is the
strongest available signal that the R7 shape is right. The mapping is close
to one-to-one:

| LLM Wiki | Nova |
|---|---|
| `raw/` immutable sources | `memory_versions` — hour-bucketed, frozen, chained |
| ingest → summary pages | `extract()` → `memory_derivatives` |
| entity / concept pages | `entities` / `facts` (§2) |
| `[[cross-links]]` | `entity_edges` (§2.3) |
| `log.md` | the activity timeline |
| `index.md` | **nothing — §5.4** |
| **lint** | **nothing — §5.1** |

Two of those rows are empty, and both are now in scope.

**What is not taken.** The gist's "index before embeddings" guidance holds that
at roughly 100 sources a simple index beats a vector database. Nova operates at
120k derivatives — three orders of magnitude past that, with measurements
(77 ms p50, 100% recall@10) showing the vector path working. The scale
guidance does not transfer; the observation underneath it does, which is that a
good index is cheaper than retrieval, and is why §5.4 exists. The filesystem
substrate is also not taken: plaintext markdown of a user's private life
conflicts with R8 exactly as `graph.json` does (§1.3).

**Provenance caution.** A widely-circulated PDF titled
*"Graph-Engineering-Anthropic-Karpathy-Loop"* attributes a "graph engineering"
framework to Karpathy and to Anthropic. It is neither: the document's own cover
states it is *"independently compiled and is not affiliated with or endorsed by
Anthropic or Karpathy"*, and viral claims of Anthropic authorship are false.
Karpathy's actual publications are the LLM Wiki gist above and
`karpathy/autoresearch` (March 2026), an autonomous-experimentation loop that
uses git history as its ledger and is not a memory system. Cite the gist; do
not cite the PDF.

---

## 2. Schema

Three tables beside the existing ones. All content fields are field-encrypted
(`enc:v1:`) exactly as `open_loops.description` already is — an entity name is a
person's name, and an edge quotes what someone said.

### 2.1 entities

Per §1.2 of the data-model doc, with one addition.

```sql
CREATE TABLE IF NOT EXISTS entities (
  id              TEXT PRIMARY KEY,           -- UUIDv7
  kind            TEXT NOT NULL
    CHECK(kind IN ('person','project','artifact','org')),
  name            TEXT NOT NULL,              -- encrypted
  aliases         TEXT,                       -- encrypted JSON array
  last_seen       INTEGER,
  meta            TEXT,                       -- encrypted JSON
  -- Not in §1.2. A keyed digest of the case-folded, whitespace-collapsed name,
  -- built exactly like memory_threads.source_key (lookupDigest). Equality
  -- lookup and the UNIQUE constraint are both impossible against an encrypted
  -- name column; this serves both without exposing the name.
  name_digest     TEXT NOT NULL,
  UNIQUE(kind, name_digest));
CREATE INDEX IF NOT EXISTS idx_entities_last_seen ON entities(last_seen);
```

`name_digest` is the load-bearing addition. §1.2 wrote `name TEXT NOT NULL` with
no uniqueness, which cannot deduplicate entities under field encryption —
the same problem `memory_threads` already solved with `source_key`. This reuses
that solution rather than inventing one.

### 2.2 facts

Per §1.2 unchanged, except that `fact_embeddings` is **not built now** (§5.2).

```sql
CREATE TABLE IF NOT EXISTS facts (
  id            TEXT PRIMARY KEY,             -- UUIDv7
  entity_id     TEXT NOT NULL REFERENCES entities(id),
  stated_at     INTEGER NOT NULL,
  statement     TEXT NOT NULL,                -- encrypted
  confidence    REAL NOT NULL,
  evidence_id   TEXT NOT NULL REFERENCES memory_derivatives(id),
  superseded_by TEXT REFERENCES facts(id));
CREATE INDEX IF NOT EXISTS idx_facts_entity ON facts(entity_id, stated_at);
```

`evidence_id` is `NOT NULL` here where §1.2 left it nullable. A fact with no
derivative behind it cannot be shown to the user with provenance, and Nova's
transparency guarantee is that every claim can answer "why do you think that?".
A fact that cannot be sourced should not be stored.

### 2.3 entity_edges

New — not in §1.2, which specified entity-to-fact but no entity-to-entity
relation. This is the graph proper, and the table §3.3 expands into.

```sql
CREATE TABLE IF NOT EXISTS entity_edges (
  id               TEXT PRIMARY KEY,          -- UUIDv7
  source_id        TEXT NOT NULL REFERENCES entities(id),
  target_id        TEXT NOT NULL REFERENCES entities(id),
  relation         TEXT NOT NULL,             -- see §3.2
  confidence       TEXT NOT NULL
    CHECK(confidence IN ('EXTRACTED','INFERRED','AMBIGUOUS')),
  confidence_score REAL NOT NULL,
  derivative_id    TEXT NOT NULL REFERENCES memory_derivatives(id),
  created_at       INTEGER NOT NULL,
  -- One relation between two entities is one edge, however many captures
  -- restate it. Matches the dedup_key precedent in open_loops.
  UNIQUE(source_id, target_id, relation));
CREATE INDEX IF NOT EXISTS idx_edges_source ON entity_edges(source_id, confidence_score);
CREATE INDEX IF NOT EXISTS idx_edges_target ON entity_edges(target_id, confidence_score);
```

Both direction indexes exist because expansion (§3.3) traverses edges
without regard to direction: if a derivative mentions Jordan, an edge *into*
Jordan is as relevant as one out of her.

### 2.4 Departures from `data-model.md` §1.2

| Departure | Reason |
|---|---|
| `entities.name_digest` added, `UNIQUE(kind, name_digest)` | Deduplication is impossible against an encrypted `name`. Reuses the `memory_threads.source_key` pattern. |
| `facts.evidence_id` made `NOT NULL` | An unsourceable fact cannot satisfy the provenance guarantee. |
| `entity_edges` added | §1.2 had entity→fact but no entity→entity relation. §3.3 needs one. |
| `fact_embeddings` not built | Deferred, not dropped. See §5.2. |
| `open_loops.counterparty` stays TEXT until step 4 | Backfilled to an entity id in §4, per the plan already recorded at `db.ts:118`. |
| `entity_index` added | Derived, rebuilt nightly. Not a source of truth. See §5.4. |

Retention follows `data-model.md` §Retention, which already lists
`facts` as indefinite. `entities` and `entity_edges` inherit that: an edge is
deleted only when its evidence derivative is.

---

## 3. What we take from graphify, and where it goes

### 3.1 The three adopted elements

**Edge provenance with a discrete confidence rubric.** Every edge is tagged
`EXTRACTED` (the relation is explicit in the captured text), `INFERRED` (Nova
resolved it), or `AMBIGUOUS` (uncertain, kept and flagged rather than dropped).

The detail worth copying is the *discrete* score set. Graphify's spec documents
a production failure and its fix:

> *"the bimodal distribution observed in production (>50% at 0.5, >40% at 0.85+)
> shows the range guidance is being collapsed to a binary."*

Their remedy is five fixed values with an explicit ban on the midpoint:

| Score | Meaning |
|---|---|
| 1.0 | `EXTRACTED` — always |
| 0.95 | Direct structural evidence (named cross-reference) |
| 0.85 | Strong inference (clear alignment, no direct link) |
| 0.75 | Reasonable inference (shared domain, requires interpretation) |
| 0.65 | Weak inference (thematically related) |
| 0.55 | Speculative but plausible (co-occurrence only) |
| 0.1–0.3 | `AMBIGUOUS` |

If nothing above fits, the edge is marked `AMBIGUOUS` rather than scored 0.4 or
below. This is a prompt-engineering result that would otherwise be rediscovered
slowly, and it is free to adopt.

**`semantically_similar_to` edges.** Links between things with no structural
connection — graphify's example is "two functions that both validate user input
but never call each other." For Nova this is the edge type that connects a Slack
commitment to the meeting where it was made. It is the single highest-value
relation for the loops engine, and it is the one an AST-based tool could never
produce, which is why it is prompt-side.

**Graph expansion as a rerank stage.** Seed with what you have, expand a hop,
rerank. Nova's `searchMemory` currently returns top-k derivatives and stops.

### 3.2 Relation vocabulary

Constrained, unlike graphify's open set — a fixed vocabulary is checkable and
keeps the extraction prompt honest.

| Relation | Direction | Example |
|---|---|---|
| `works_with` | person ↔ person | co-occurrence in a thread |
| `owns` | person → project/artifact | "Jordan owns the Q3 deck" |
| `member_of` | person → org/project | |
| `mentions` | entity → entity | one named in the other's context |
| `depends_on` | project/artifact → project/artifact | |
| `semantically_similar_to` | any ↔ any | same subject, no structural link |

### 3.3 Retrieval

`searchMemory` gains one stage between rescore and rerank:

```
int8 KNN (k=500)
  → exact float32 rescore
  → recency filter
  → decrypt
  → NEW: entity expansion — 1 hop, confidence-weighted
  → in-memory rerank
  → return with provenance
```

Expansion is a SQL join over `entity_edges`, not a graph library. One hop over
an indexed table is sub-millisecond. The budget is not tight: measured p50 is
77 ms at k=500 against an 800 ms NFR, leaving ~720 ms of headroom
(`daemon/src/search.ts:19-30`).

Expanded hits enter the rerank at their edge's `confidence_score` as a
multiplier on the seed hit's score, so a 0.55 speculative edge cannot outrank a
direct vector hit. **Behind a flag**, so §6 can measure it both ways.

A note on expected magnitude: graphify's own ablation reports seed-only at 42.7%
against graph-expand's 45.3% — roughly 2.6 points, on top of a much weaker
seeder. On Nova's stronger seeds the marginal gain is plausibly smaller. This is
a measurement, not an assumption (§6).

---

## 4. Extraction

**One LLM call, not two.** The pipeline already calls `provider.extract()` per
version and receives `{memories: string[]}`
(`daemon/src/provider.ts:12`, `daemon/src/pipeline.ts:147`). The graph is
populated by widening that response, not by adding a pass.

This matters for cost: extraction is the per-version expense, and D4 fixed the
budget at $0.17/user/day. A second pass would roughly double it. A widened
response grows output tokens only.

```
{"memories": [
  {"text": "…",
   "entities": [{"name": "Jordan Hayes", "kind": "person"}],
   "relations": [{"source": "Jordan Hayes", "target": "Q3 deck",
                  "relation": "owns",
                  "confidence": "EXTRACTED", "confidence_score": 1.0}]}
]}
```

The existing prompt's discipline carries over unchanged and is load-bearing
here: third-person, pronouns resolved, identifiers verbatim, no relative dates,
substance over interface. Entity names inherit it — "Jordan Hayes", never "she".

The confidence rubric from §3.1 goes into the prompt verbatim, including the
ban on 0.5.

**Backward compatibility.** `parseMemories` already tolerates a malformed
response by returning no memories rather than crashing
(`daemon/src/provider.ts:100-107`). The widened parser keeps that contract and
extends it: a memory that parses as a bare string still works, a memory object
missing `entities`/`relations` yields a derivative with no graph rows. A
provider that ignores the new fields degrades to exactly today's behavior —
the same pattern `extractLoops?` already uses as an optional method.

---

## 5. Consolidation, lint, and what is deferred

The nightly pass does three things: it merges duplicate entities (§5.1), it
lints the graph for contradictions (§5.1.1), and it rebuilds the entity index
(§5.4).

### 5.1 Entity resolution

The nightly pass merges duplicates. Order:

1. **Exact** — `name_digest` match within a `kind`. Free, deterministic, catches
   the common case.
2. **Alias** — the incoming name matches an existing entity's `aliases`.
3. **Embedding tiebreak** — for survivors, cosine similarity over the entity
   name embedded in context, above a threshold set by measurement.

Merging rewrites `facts.entity_id` and both `entity_edges` endpoints to the
survivor, folds the loser's name into the survivor's `aliases`, and deletes the
loser. `UNIQUE(source_id, target_id, relation)` means a merge can collide; the
higher `confidence_score` wins.

### 5.1.1 Lint: the contradiction pass

Adopted from the LLM Wiki's third operation (§1.4). Nova has no analogue today,
and the gap is visible in the schema: `facts.superseded_by` exists in
`data-model.md` §1.2 and in §2.2 here, and **nothing ever sets it**.

Facts about the world change. "Jordan owns the Q3 deck" in March and "Alex took
over the Q3 deck" in June are both true statements, both correctly extracted,
both with sound evidence — and one of them is now wrong to report. Merging
duplicates (§5.1) does not catch this, because these are not duplicates.

The pass, nightly, per entity:

1. Select that entity's facts that are not already superseded, ordered by
   `stated_at`.
2. Ask the model, for the recent ones against the older ones, whether any pair
   states something that cannot both currently hold.
3. On a conflict, set the older fact's `superseded_by` to the newer fact's id.

Superseded facts are **not deleted**. They stay queryable with their evidence,
because "what did I believe in March" is a real question for a memory tool. They
are excluded by default from retrieval (§3.3) and from the digest (§5.4).

This is a scan over one entity's facts, not a cross-product over the store, and
it runs in the nightly window where latency does not matter.

**Why this earns its place.** A memory tool that confidently reports a
superseded fact is worse than one that reports nothing: the user cannot tell
from the output that it is stale, and the provenance link makes it look
well-sourced. This is the failure mode most damaging to the trust Nova's whole
pitch rests on.

**Deferred lint checks.** The LLM Wiki also lists orphan pages and missing
cross-references. Nova's equivalents — entities with no edges, derivatives
mentioning a known entity without an edge to it — are cheap to compute but have
no clear action attached yet. Compute them as diagnostics first; act on them
only once there is evidence they indicate a real extraction failure.

### 5.2 fact_embeddings — deferred

§1.2 specified `fact_embeddings` as `FLOAT[1536]`. It is not built here, for the
reason R5/R6 were amended: an unquantized float32 vec0 index measured 494 ms p50
and 21,279 ms p95 (`daemon/src/search.ts:19-30`). Building a second float32
index now would repeat a mistake already paid for once.

Facts are reachable through their entities and through the derivatives they cite,
which is sufficient for §3.3. If measurement later shows facts need their own
vector search, it gets the int8-plus-sidecar treatment derivatives already have —
not `FLOAT[1536]`.

### 5.3 Leiden clustering — deferred

Graphify uses Leiden community detection to split a graph into subsystems. It is
tempting for consolidation, and it is the wrong tool for it: Leiden finds
*communities in a graph*, which is a different problem from deciding whether two
names are the same person. §5.1 solves the actual problem more cheaply.

Leiden becomes interesting once the graph is large enough to have community
structure worth surfacing — plausibly for the daily digest, grouping a day's
activity into themes. Revisit then, with a measurement, not now.

### 5.4 The entity index — "who and what is in your memory"

The LLM Wiki's `index.md` is a content-oriented catalog: links plus one-line
summaries, organized by category (§1.4). Nova has no equivalent. Everything it
can show the user today is *reactive* — answers to a query, loops that surfaced.
Nothing answers the standing question **"what do you actually know about?"**

This is both a UI affordance and a retrieval aid, and the entity graph is what
makes it possible.

**What it is.** A nightly-built ranked list of the entities Nova holds, grouped
by `kind` (person, project, artifact, org). Each row: the name, a one-line
summary synthesized from that entity's non-superseded facts, `last_seen`, and a
count of open loops touching it.

**Ranking.** By recency-weighted activity — the same half-life the retrieval
path already uses (`HALF_LIFE_DAYS = 30`, `daemon/src/search.ts`) applied over
the entity's facts and edges. A person mentioned once in March ranks below one
mentioned all week. This reuses a decay constant already in the codebase rather
than introducing a second notion of recency.

**Where it surfaces.** F4.3 is the daily digest, and the PRD's fourth principle
is that Nova "speaks only when it has something high-value" (`features.md`). The
index must not turn the digest into a wall of names. So:

- **Digest:** the top few entities by *change* — who or what moved since the
  last digest — not the top few overall. A static list repeated each morning is
  noise by the second day.
- **In-app panel:** the full index, browsable by kind, as the answer to "what
  does Nova know about me?" This also serves F5.5's transparency purpose from
  the opposite direction: F5.5 shows *what was captured*, the index shows *what
  was understood*.

**Storage.** A derived table, rebuilt nightly, not a source of truth:

```sql
CREATE TABLE IF NOT EXISTS entity_index (
  entity_id    TEXT PRIMARY KEY REFERENCES entities(id),
  summary      TEXT NOT NULL,              -- encrypted, one line
  rank_score   REAL NOT NULL,
  loop_count   INTEGER NOT NULL DEFAULT 0,
  rebuilt_at   INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_entity_index_rank ON entity_index(rank_score DESC);
```

Rebuilt wholesale each night, so it cannot drift from the graph. Summaries cost
one LLM call per entity whose facts changed — bounded by change, not by store
size, which keeps it inside the D4 budget.

**Excluded:** superseded facts (§5.1.1) never appear in a summary, and an entity
whose facts are all superseded drops out of the index.

---

## 6. Sequencing and gates

Each step is independently shippable, and each has a gate that can stop the next.

**Step 1 — Schema and migration.** `entities`, `facts`, `entity_edges` via the
existing `CREATE TABLE IF NOT EXISTS` path. These are new tables, so that path
is sufficient — note the caveat recorded at `daemon/src/db.ts:167`, that
`IF NOT EXISTS` silently leaves an *existing* table alone, which is why any
later column added to these three needs an explicit `ADD COLUMN` migration.
No behavior change. *Gate:* existing suite green; a store from before the change
opens and serves unchanged.

**Step 2 — Extraction and population.** Widen the response shape, populate the
graph. Nothing reads it yet. *Gate:* **edge quality, judged on real captures.**
Graphify's prompt is tuned for documents and papers; Nova's corpus is Slack
fragments and meeting transcripts. Run over existing captured data and read the
edges before building on them. If entity extraction is noisy on prose, this
design stops here and the prompt is reworked — the finding would be that prose
needs different treatment, which nothing in graphify's evidence rules out.

**Step 3 — Entity expansion in `searchMemory`,** behind a flag. *Gate:* recall
improves and p50 stays under 800 ms, measured both ways on the same queries. If
expansion does not measurably help, the flag stays off and steps 1, 2, 4 and 5
still stand on their own.

**Step 4 — Loops backfill.** `open_loops.counterparty` from name string to
entity id — "one backfill pass", as `db.ts:118` anticipated. Closure detection
can then ask whether an *entity* responded anywhere, rather than matching a name
string. *Gate:* loop precision does not regress (M2's ≥60% gate,
`roadmap.md`).

**Step 5 — Nightly entity merge.** §5.1. *Gate:* merge precision sampled by hand
on real entities; a wrong merge conflates two people, which is worse than a
duplicate.

**Step 6 — Lint: the contradiction pass.** §5.1.1. Populates
`facts.superseded_by`, and excludes superseded facts from retrieval and the
digest. *Gate:* **supersession precision, sampled by hand.** A wrong
supersession is worse than a wrong merge — it removes a true fact from the
user's view while leaving it in the store, so the user sees neither the fact nor
any sign it was hidden. Ship conservative: when the model is unsure whether two
facts conflict, leave both standing.

**Step 7 — The entity index.** §5.4. Derived table, nightly rebuild, digest and
in-app panel. *Gate:* digest noise — the top-by-change selection must not make
the morning digest longer or more repetitive, measured against F4.3's existing
conservative shape (`features.md` §F4.3, top 5/day). If it does, the index ships to
the in-app panel only and stays out of the digest.

Steps 6 and 7 both depend on the graph being populated (step 2) but not on
expansion (step 3): if step 3's gate fails and the flag stays off, steps 6 and 7
still stand.

### 6.1 Measurement notes

The step-2, step-3, step-5, step-6 and step-7 gates are all **sampled**
measurements — a few hundred derivatives or a few dozen entities, not a full
corpus build. Local benchmarks stay light and extrapolate; a full build is not
needed to judge any of them, and the development machine should not be asked for
one.

---

## 7. Open questions

- **Edge quality on prose** (step 2 gate). The single largest unknown. Graphify's
  extraction prompt has no evidence behind it for dialogue.
- **Expansion's real marginal value** (step 3 gate). Graphify bought ~2.6 points
  on a weak seeder. Nova's seeder is strong. The gain could be near zero.
- **Entity-resolution threshold** (§5.1). Needs a measured precision/recall curve
  on real names before a number is chosen.
- **Whether `AMBIGUOUS` edges should be stored at all.** Graphify keeps them for
  human review. Nova has no review surface. They may be write-only noise — decide
  from step 2's output. (§5.4's in-app panel is a candidate review surface, which
  would change this answer.)
- **Whether a model can reliably tell supersession from coexistence** (§5.1.1).
  "Jordan owns the deck" and "Alex owns the deck" may mean a handover, or joint
  ownership, or two different decks. The pass is only as good as that judgment.
- **How the digest should present a changed entity** (§5.4). "Jordan moved" is
  not useful; "Jordan handed the Q3 deck to Alex" is. The difference is whether
  the digest cites the superseding fact, which couples §5.4 to §5.1.1 more
  tightly than the step ordering suggests.
