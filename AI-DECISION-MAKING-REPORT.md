# How the Bot's AI Decision-Making Actually Works — Code-Verified Report

**Date:** 2026-07-02 · **Method:** every claim in Parts 1–3 is cited to a specific file/line in the
current codebase, re-read for this report — nothing here is from memory of what was intended.
**Part 4 is a design proposal**, clearly separated from the verified parts, extending
`ENRICHMENT-RESEARCH-BRIEF.md` §9 and `ENRICHMENT-DESIGN-DECISIONS.md` — it does not restate or
contradict either.

---

## Part 1 — Enrichment (`src/adapters/enricher/claudeEnricher.ts`, `src/core/taxonomy.ts`)

### The taxonomy

`src/core/taxonomy.ts` is the single source of truth for the 10-category list, imported by both
the enricher and the judge "so the two can never drift apart" (its own doc comment, line 4–5):

> Bug / Broken · Feature Request · Pricing / Commercial · Onboarding / Setup · UX / Usability ·
> Reporting / Data · Praise · Other · Candidate Experience · Assessment Accuracy/Validity

### The de facto rubric — what the system prompt actually contains

`claudeEnricher.ts` lines 5–21 is the entire instruction the model receives. It is **one worked
example per category** (an input phrase → an output summary), not a decision tree or a set of
disambiguation rules:

```
- Bug / Broken: "The export button throws an error" → "Export feature is broken and throws an error when clicked."
- Feature Request: "It would be great if we could bulk-assign candidates" → "..."
- ... (one line per category, same pattern) ...
```

**There is exactly ONE explicit disambiguation rule in the whole prompt** (line 19), for one
category only:

> "Use Assessment Accuracy/Validity only when the concern is about whether the assessment
> MEASURES THE RIGHT THING or scores correctly — not general bugs or UX complaints about the
> assessment tool itself."

No other category has a stated boundary. There is nothing distinguishing, for example, a
borderline "the report is confusing" case between `UX / Usability` and `Reporting / Data`, or a
candidate-facing onboarding issue between `Onboarding / Setup` and `Candidate Experience`. The
worked examples are illustrative anchors, not a rubric that resolves edge cases — this is worth
being precise about rather than assuming a fuller rubric exists than what's actually written.

One general (non-category) instruction also applies: *"Remove Slack noise (raw @mentions, filler
phrases). Keep the summary factual and concise."*

### How a valid category is guaranteed

Two independent layers, both verified in code:

1. **Constrained decoding.** The API call forces tool use — `tool_choice: { type: "tool", name:
   "submit_enrichment" }` (line 63) — and the `category` field's JSON schema sets `enum:
   CATEGORIES` (line 55). Anthropic's structured-output mechanism means the model is mechanically
   restricted to emitting one of the 10 valid strings for that field; it cannot return arbitrary
   text there.
2. **Defensive re-check in code**, belt-and-suspenders on top of layer 1: line 70 —
   `if (!input.summary || !CATEGORIES.includes(input.category as FeedbackCategory)) return null;`
   — plus the entire method is wrapped in try/catch returning `null` on any exception (lines
   31–78). So enrichment fails **open**: any malformed output or API error means the record is
   captured with no summary/category, never a bad one.

Model: `claude-haiku-4-5-20251001` (constructor default, line 26) — `index.ts` never overrides it.

---

## Part 2 — The Judge (`src/adapters/judge/claudeJudge.ts`)

### What it checks — exact wording, not paraphrase

The system prompt (lines 7–19) states two checks, verbatim:

> 1. Category fit: does the assigned category genuinely match the message, per the taxonomy below?
> 2. Summary faithfulness: does the summary only state things that are actually in the original
>    message (no fabricated claims), and does it capture the key point?

Nothing else is checked. There is no gate on whether the message is feedback at all (deliberately
— `ENRICHMENT-DESIGN-DECISIONS.md` §2 defers that to a later phase not yet built).

### Reference-grounded, not self-comparison — confirmed, with a precise caveat

Confirmed on two counts:
- The prompt explicitly instructs: *"Check the proposal against the original message — not
  against your own preference"* (line 9).
- Mechanically, `claudeJudge.ts` makes its own **separate** `messages.create` call (line 40),
  fed `Original message: ${originalMessage}` (line 47) — the same `text` variable `handleCapture.ts`
  also gave to the enricher (line 108: `deps.judge.review(text, channelName, ...)`), not the
  enricher's own reasoning or any prior conversation turn.

**Precise caveat worth stating plainly:** this is the same underlying model (Claude Haiku) making
a second, independent call — not a different model or provider. The mitigation actually
implemented is *prompt-level reference-grounding* (grade against source text), exactly what
`ENRICHMENT-DESIGN-DECISIONS.md` §2 specifies. A cross-model-family judge was one option the
research surfaced but was not adopted here, and the research itself found a multi-family ensemble
"REFUTED as 'the' fix" for this volume (`ENRICHMENT-RESEARCH-BRIEF.md` §1) — so this isn't a gap
against the plan, it matches it.

### What each confidence level means — exact wording

From the system prompt (line 18), verbatim:

> - **High**: "if both checks clearly pass"
> - **Medium**: "if one is questionable but plausible"
> - **Low**: "if either check clearly fails **or you are unsure**"

Note the last clause: `Low` is also the fallback for the judge's own uncertainty, not only for a
clear-cut failure. The rationale field (line 19) is instructed to be *"one short sentence... Only
explain what's wrong when confidence is not High — for High, a brief confirmation is enough."*

Guaranteed validity the same two-layer way as enrichment: forced tool call with `enum:
CONFIDENCE_LEVELS` (lines 5, 59, 71) plus a defensive re-check (line 78) and fail-open on any
exception, returning `null`.

### Where it surfaces — and whether anything auto-escalates on Low

**Notion fields**, confirmed in `notionWriter.ts` lines 43–46:
- `"Enrichment Confidence"` — a Select property, written from `r.confidence` (one of High/Medium/Low)
- `"Judge Rationale"` — a rich-text property, written from `r.rationale`

**Nothing auto-escalates on Low confidence today — verified, not assumed.** Tracing the full path:

- `handleCapture.ts` lines 106–134: the judge's `verdict` is fetched, then passed straight through
  — `confidence: verdict?.confidence, rationale: verdict?.rationale` — into `notion.createFeedback(...)`.
  There is no `if` statement anywhere that branches on the confidence *value*.
- `index.ts`'s `acknowledge()` function (lines 28–50) — the function that decides the Slack
  reaction and reply — takes `result: CaptureResult` as its only capture-outcome input.
  `CaptureResult` (from `handleCapture.ts` line 5–11) is `{ status, key, detail? }`; it does not
  carry confidence at all. The emoji choice (line 33–35) branches only on `result.status`
  (`captured` / `flagger_added` / `duplicate` / `no_message` / `error`) — never on judge confidence.

**Conclusion:** a `Low`-confidence capture gets the exact same ✅ reaction, the exact same (or
absent) threaded reply, and the exact same code path as a `High`-confidence one. The confidence
level is written as data and nothing more — it is a **filterable Notion property today, not a
trigger for any different behavior.** This matches `ENRICHMENT-DESIGN-DECISIONS.md` §3's routing
rule at the *storage* level ("Low → auto-file, flagged... never silently drop") but that
document's word "prominently" should not be read as the code doing anything extra — any visual
prominence (e.g. a red color on the Low option) would be a Notion property-display setting
configured separately in the workspace, not something the bot's code produces.

---

## Part 3 — No Feedback Loop Exists Yet

Stated plainly, because it matters for Part 4: **there is currently no mechanism, anywhere in this
codebase, that reads a human's agreement or correction back out of Notion.**

Verified by inspection, not assumption:
- `NotionWriter` (the only port touching Notion) exposes exactly two methods —
  `createFeedback` and `appendFlagger` — both writes. There is no read-back method.
- A repository-wide search for `gold`, `eval`, `agreement`, `feedback loop`, `confusion matrix`,
  `kappa`, `retrain`, and `label` across `src/` returns **zero matches**.
- No `scripts/` directory currently exists for any evaluation or export purpose.

Once a row is written, nothing in the running system ever looks at it again. If a human edits the
`Category` dropdown in Notion, corrects the summary, or simply reads and does nothing — the bot
has no way to distinguish any of those states, today. This is the exact gap Part 4 addresses.

---

## Part 4 — Design: A Feedback Loop for Agreement *and* Disagreement

*(Design proposal, not yet built. Extends `ENRICHMENT-RESEARCH-BRIEF.md` §9 and
`ENRICHMENT-DESIGN-DECISIONS.md` §2 — cited inline, not restated.)*

### The actual problem

`ENRICHMENT-RESEARCH-BRIEF.md` §9 says to "measure the judge against your own small human-labeled
gold set" and track "per-category precision/recall/F1, a confusion matrix, and human-agreement
(kappa)." `ENRICHMENT-DESIGN-DECISIONS.md` §2 makes the Phase 2 "is this feedback?" gate
conditional on "the judge's reliability... proven on Phase 1 jobs via the gold set." Both assume a
gold set exists or will exist via the 4-month backfill agent (research brief §9: *"The 4-month
human-reviewed backfill (Feature C) IS this gold set"*). **That backfill agent is currently paused**
(`ENRICHMENT-DESIGN-DECISIONS.md` §6) — so as things stand, there is no path to that gold set at
all right now, blocked or not.

This design is a **separate, complementary source**: a live loop that starts accumulating labeled
examples from ordinary day-to-day review, going forward, independent of whether/when the backfill
agent is ever unblocked. It doesn't replace the bootstrap idea — it's a second channel that starts
producing data immediately once built.

The core difficulty, correctly identified in the brief for this task: **disagreement is
self-evident (a correction IS the signal); agreement is not.** Silence on a row proves nothing —
it's indistinguishable from "nobody has looked at this yet."

### Where review actually happens (and where it structurally can't)

The AI's summary, category, confidence, and rationale are visible in **Notion** — that's the only
place a human can see all four side by side. **Slack cannot show any of this today**: the bot's
only Slack-side outputs are a ✅/⚠️ reaction and, for `@mention` captures, a generic
"Got it — feedback captured!" reply (`index.ts` lines 39–44) — never the assigned category or
summary. Asking someone to confirm-in-Slack something Slack never displayed would mean asking them
to judge blind, or to go check Notion first anyway — at which point Notion was always the natural
place to give the verdict.

### Two candidate designs, weighed rather than defaulted

**Option A — reuse the Slack reaction pattern.** Rejected as the primary mechanism, for three
concrete reasons, not a vague preference:
1. It requires the bot to start posting the category/summary into the Slack thread first (a
   real, unbuilt prerequisite with its own cost: channel clutter, and making every AI category
   call publicly visible/scrutinizable in-channel).
2. A single reaction is a lump signal — it cannot distinguish "the category's right" from "the
   summary's right," which the task explicitly requires kept separate.
3. The bot already uses ✅ to mean "captured successfully." Reusing it (or a near-identical emoji)
   to also mean "confirmed correct" creates a real semantic collision between two different facts
   about the same message.

**Option B — Notion-native properties, filled in at the point of review.** This is where review
already happens, so it's recommended as the primary mechanism. Two sub-designs, with different
trade-offs:

| | Design B1: explicit verdict property per field | Design B2 (recommended): frozen-original diff for Category, explicit verdict for Summary |
|---|---|---|
| New properties | `Category Verdict` (Select: —/Correct/Incorrect), `Summary Verdict` (same) | `AI Suggested Category` (Select, frozen at write time, never edited again), `Category Reviewed` (Checkbox), `Summary Verdict` (Select: —/Confirmed Faithful/Confirmed Not Faithful) |
| How disagreement is captured | A separate explicit click, decoupled from actually fixing the category | The human just edits the live `Category` dropdown, as they'd naturally do anyway to keep the database accurate — the diff against `AI Suggested Category` **is** the disagreement signal, and it comes with the *correct* answer for free |
| How agreement is captured | Explicit click | Tick `Category Reviewed`, leave `Category` unchanged |
| Known weakness | Two actions per correction (fix it + flag it) — easy for the two to drift out of sync | If someone notices the category's wrong but doesn't get around to fixing the dropdown, an untouched value would be misread as agreement. Accepted trade-off: in an actively-used working database, people tend to fix what they're already looking at rather than leave a known-wrong value sitting there |
| Why Summary can't use the same diff trick | Free-text edits are noisy — fixing a typo would register as "changed" under a naive diff, and someone judging a summary unfaithful may not bother rewriting AI prose the way they'd casually fix a dropdown | *(same reasoning applies in both designs — Summary always needs its own explicit verdict)* |

**Recommendation: Design B2.** It asks for one fewer new action per correction than B1, and — the
more important reason — a category *correction* is far more useful for improving the taxonomy
later than a bare "wrong" flag would be, because it tells you what the right answer actually was,
not just that the AI missed.

### Confidence doesn't need its own verdict UI — it's derived, not confirmed

The task asks for agreement/disagreement on category, summary, *and* confidence. Adding a third
"was the AI's confidence level itself right?" property would be a confusing question to put to a
human. It doesn't need one: once `Category Reviewed`/`Summary Verdict` exist, **confidence
calibration is a cross-tabulation, not a new input** — e.g. "of rows the judge marked `Low`, what
fraction were confirmed wrong?" vs. the same question for `High`. That comparison is exactly a
calibration check, computed for free from data this design already collects.

### A low-friction integration point that already exists

The `Status` field (New → Reviewed → Actioned) is already human-owned workflow state
(`ENRICHMENT-DESIGN-DECISIONS.md` §4: *"it's human-owned workflow state; confidence is a separate
AI signal, not folded into it"*). Moving a row from `New` to `Reviewed` is already the moment
someone looks at it. The practical habit to establish is simply: **set the verdict fields at the
same moment you move Status to `Reviewed`** — no new process needs inventing, just attaching a
second small action to a workflow step that already happens.

### How this becomes a real labeled set with an actual denominator

Once rows accumulate verdicts, the *denominator* for any agreement-rate calculation is "rows where
`Category Reviewed` is ticked or `Summary Verdict` is set" — not "every row ever captured," and not
"every complaint anyone happened to voice." A count of 5 corrections only means something once you
know it's 5-out-of-12-reviewed (a serious problem) versus 5-out-of-400-reviewed (a rounding error).
This is precisely the gap silence leaves open, and precisely what an explicit-but-optional field
closes: it's fine for most rows to stay unreviewed, as long as "unreviewed" is visibly distinct
from "reviewed and agreed."

This dataset directly produces the metrics `ENRICHMENT-RESEARCH-BRIEF.md` §9 named:
- **Per-category precision/recall** — from `AI Suggested Category` vs. the corrected `Category`,
  per category.
- **Confusion matrix** — every (AI said X, human corrected to Y) pair, tallied.
- **Human-agreement (kappa)** — computable from the confirmed-correct/confirmed-incorrect tally.

### Two tiers of "how it gets built" — minimal vs. richer

**Tier 1 (no new code):** add the three Notion properties, and adopt the Status-transition habit
above. A human periodically opens a Notion view filtered to reviewed rows and reads the pattern
directly — this alone *is* "periodic human review," matching the brief exactly, with zero
automation and zero new code.

**Tier 2 (optional, small script):** a script that queries Notion (read-only, via
`@notionhq/client`, the same package already in use) and computes the precision/recall/confusion
matrix/kappa numbers explicitly, rather than relying on a human eyeballing a filtered view. This is
new code, but it only *reads* Notion and does local arithmetic — it makes no call to any
third-party LLM, unlike the judge, vision, or backfill agent.

### What refines over time, and how — explicitly not automated retraining

The mechanism for improvement is: **periodically, a person reads the confusion matrix / the
filtered view of corrections, and manually edits the system prompt or taxonomy** in
`claudeEnricher.ts` / `claudeJudge.ts` / `taxonomy.ts` — e.g., if "UX / Usability" corrections to
"Candidate Experience" cluster around a specific phrasing, that becomes a new disambiguation line
in the prompt, the same way the one existing rule for Assessment Accuracy/Validity was added.
Nothing here retrains a model or touches weights — the loop's output is a periodic, human-read
report that informs a manual prompt edit, same as any other code change.

### One thing worth confirming before *building* this (not before designing it)

This design was asked for as a design, and that's what's above. If it moves to implementation:
the core mechanism (new Notion properties + a workflow habit) sends nothing new to any
third-party API — it doesn't touch the GDPR/data-retention question the same way vision, the
judge, or the backfill agent did, since it's Notion-schema-and-habit, not a new LLM call. The
optional Tier 2 script is read-only against Notion and does local computation, same reasoning.
That's my own read, consistent with how the project has drawn this line elsewhere — but given how
carefully every other data-facing addition this session went through an explicit check first, this
one should get the same five-second confirmation before work starts, not a silent assumption that
it's exempt.
