# Gold Standard Pipeline Improvement — Design Spec

**Date:** 2026-07-13
**Scope:** Gold standard dataset, gate improvement, enricher improvement, live auto-capture gate
**Workspaces:** 4 sequential/parallel child workspaces + PM agent + Refactor agent + QC agent

---

## Goal

Use 95 human-reviewed backfill feedback items to build a gold standard dataset, then use that data to measurably improve the feedback pipeline across three dimensions:

1. **Gate accuracy** — reduce false positives (internal noise incorrectly flagged as feedback)
2. **Enrichment quality** — richer summaries, correct multi-category assignment
3. **Live auto-capture** — bot monitors channels and captures feedback automatically, without requiring a human `:mega:` reaction

---

## Decisions Made (Grill Session Summary)

| Decision | Choice |
|---|---|
| Category model | Multi-select ("Categories"), max 2 per item. Old single "Category" field retired. |
| Taxonomy | 11 categories — adds "Compliance / Legal / Governance" |
| Schema migration | One-time script migrates existing rows' "Category" → "Categories" |
| Judge scope | Validates both categories (not just primary) |
| Gate false positive handling | All messages captured to Customer Feedback DB; high confidence → Status "New"; medium/low → Status "Needs Review" |
| Human review mechanism | "Gate Verdict" select property: unset / "Confirmed" / "Not Feedback" |
| Deletion trigger | Notion webhook → bot deletes row + clears dedup store |
| Hosting | Out of scope for this sprint; webhook tested locally via ngrok |
| Live gate channels | Opt-in per channel via `LIVE_GATE_CHANNEL_IDS` env var |
| Pre-filter | Pure function drops obvious non-candidates before Claude call (mirrors `src/backfill/filter.ts` pattern) |
| Eval success metric | Measurably better than baseline — no hard accuracy target for first pass |
| Reasoning distillation | W1 sub-task: agent enriches gold set rationale from Eddie's notes; flags ambiguous rows |
| Prompt versioning | `prompts/` directory + `prompts/config.yaml` tracking active version per adapter |
| Eval infrastructure | Built in W1, used by W2 and W3 to record before/after deltas |
| Rubric scoring | Deferred — not in this sprint |
| Workspace sequencing | Option A: W1 completes first, then W2 + W3 in parallel, then W4 |

---

## Workspace Structure

```
[W1: Foundation]  (must complete before W2/W3 start)
  Gold set CSV → Reasoning distillation → Versioned prompts
  Taxonomy update → Schema migration → Eval infrastructure + baseline

        ↓ hands off to ↓

[W2: Gate]                    [W3: Enricher]
  Tune gate prompt              Multi-category output + summary quality
  Measure delta vs baseline     Measure delta vs baseline
  (parallel)                    (parallel)

        ↓ both complete ↓

[W4: Live Gate]
  Auto-capture with confidence flagging + webhook deletion

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[PM Agent] — coordinates all workspaces throughout
[Refactor Agent] — called by PM after each workspace phase
[QC Agent] — called by PM before each workspace phase sign-off
```

---

## Workspace 1: Foundation

**Goal:** Produce the gold standard dataset, enriched reasoning, versioned prompt system, updated taxonomy/schema, and eval baseline. Everything W2/W3/W4 depends on.

**File ownership:** `data/`, `prompts/`, `src/core/taxonomy.ts`, `src/core/ports.ts`, `src/adapters/notion/notionWriter.ts`, `src/core/accuracyReport.ts`, `src/core/correctionLog.ts`, `docs/enrichment-style-guide.md`, `docs/similarity-rules.md`, `scripts/`

### Phase 1: Gold Set + Reasoning Distillation

1. Update `scripts/backfillExportGoldSet.ts` to output `data/gold-set.csv` (not JSONL). Columns: `message`, `is_feedback`, `proposed_category`, `proposed_summary`, `corrected_categories`, `corrected_summary`, `eddie_notes`, `gate_confidence`, `enriched_rationale` (empty initially).

2. Run the export against the most recent Backfill Review DB (`396a5bba-35bc-81e9-9dba-d9486f2267a5`). Produces `data/gold-set.csv` (gitignored — contains customer text).

3. **Reasoning distillation agent:** For each row, reads `is_feedback` + `eddie_notes` and writes an `enriched_rationale` — a fuller explanation of the principle behind Eddie's verdict. Told explicitly: "Eddie's verdict is final — articulate the reasoning behind it." Flags rows where notes are too brief to reason from (shortlist returned to Eddie for a quick annotation pass before rules are distilled). Writes enriched rationale back to the CSV.

4. Eddie reviews flagged rows (~10–15 expected) and adds brief notes. Reasoning distillation re-runs on those rows.

**Human check-in:** PM sends phase summary — "Gold set exported, rationale enriched, N rows flagged for your input." Eddie annotates flagged rows. PM confirms and signals W1 Phase 2 can start.

### Phase 2: Taxonomy + Schema + Prompts

**Taxonomy (src/core/taxonomy.ts):**
- Add `"Compliance / Legal / Governance"` as 11th item in `CATEGORIES`
- Update all files that reference `CATEGORIES` (enricher, judge, gate, backfill review DB schema)

**Schema migration:**
- Add `"Categories"` multi-select property to the live Customer Feedback Notion DB (11 options)
- Add `"AI Suggested Categories"` multi-select property (replaces `"AI Suggested Category"` single-select)
- Add `"Gate Verdict"` select property: options `"Confirmed"` / `"Not Feedback"`
- Write one-time migration script: `scripts/migrateCategoriesToMultiSelect.ts` — copies each existing row's `"Category"` value into the new `"Categories"` field
- Update `src/adapters/notion/notionWriter.ts`:
  - Write `categories: FeedbackCategory[]` → `"Categories"` multi-select
  - Write `categories` → `"AI Suggested Categories"` multi-select (frozen AI copy)
  - Remove writes to old `"Category"` / `"AI Suggested Category"` single-select fields
- Update `src/core/ports.ts`: `FeedbackRecord` gains `categories: FeedbackCategory[]` (replaces `category?: FeedbackCategory`)
- Update `EnrichmentResult`: `categories: FeedbackCategory[]` (max 2, replaces `category`)
- Update `src/core/accuracyReport.ts` and `src/core/correctionLog.ts` to read `"Categories"` and `"AI Suggested Categories"`

**Versioned prompt system:**
```
prompts/
├── config.yaml              ← active version per adapter
├── gate/
│   └── v1.md                ← current gate system prompt
├── enricher/
│   └── v1.md                ← current enricher system prompt
└── judge/
    └── v1.md                ← current judge system prompt
```

`prompts/config.yaml`:
```yaml
gate: v1
enricher: v1
judge: v1
```

Add `src/util/loadPrompt.ts` — reads `prompts/config.yaml`, loads the active version file, returns the prompt string. Fail-open: if file missing, falls back to the hardcoded default in the adapter.

Update `ClaudeFeedbackGate`, `ClaudeEnricher`, `ClaudeJudge` constructors to accept an optional `systemPrompt` string (injected from `loadPrompt` at composition root — `src/index.ts`). Keeps adapter logic unchanged.

**Human check-in:** PM sends phase summary — taxonomy updated, schema migrated, versioned prompts scaffolded. No decision needed from Eddie unless PM flagged a conflict.

### Phase 3: Eval Infrastructure + Baseline

**Eval script:** `scripts/runEval.ts`
- Reads `data/gold-set.csv`
- For each row, runs the configured gate / enricher against the message text
- Records: predicted vs human verdict, predicted categories vs corrected categories
- Outputs `data/eval-results/YYYY-MM-DD-HH-gate-v1.json` and `data/eval-results/YYYY-MM-DD-HH-enricher-v1.json`
- Prints summary: gate precision/recall, enricher category accuracy, prompt version used

Results files gitignored (contain customer text). The eval script is committed.

Run baseline: `npx tsx scripts/runEval.ts --adapter gate --version v1` and `--adapter enricher --version v1`. Baseline numbers recorded in `data/eval-results/` for W2/W3 to diff against.

**Typecheck + tests must pass before W1 is complete.**

**PM signals W2 and W3 can start.**

---

## Workspace 2: Gate Improvement

**Goal:** Tune the `ClaudeFeedbackGate` system prompt to reduce false positives using the enriched gold set. Output a versioned `gate/v2.md` prompt with a measured improvement over baseline.

**File ownership:** `src/adapters/gate/claudeFeedbackGate.ts`, `prompts/gate/`

**Depends on:** W1 complete (gold set, eval infrastructure, prompt versioning)

### Phase 1: Analysis + Prompt Tuning

1. Read `data/gold-set.csv` — filter to `is_feedback = false` (the ~49 false positives). Identify the dominant patterns in `enriched_rationale`: internal team updates, question-answering, coordination handoffs, general chat.

2. Write `prompts/gate/v2.md` — updated system prompt that explicitly names and rejects these patterns. Uses the gold set false positive language as negative examples.

3. Run eval: `npx tsx scripts/runEval.ts --adapter gate --version v2`. Compare precision/recall delta vs baseline.

**Human check-in (via PM):** PM phase summary — "Gate precision improved from X% to Y%. Here's what changed in the prompt." Eddie reviews delta. If regression, PM routes back for another tuning iteration.

### Phase 2: Integration + Sign-off

1. Update `prompts/config.yaml`: set `gate: v2`
2. Run full test suite — all existing tests must pass
3. QC agent runs checklist before sign-off
4. Refactor agent checks gate adapter for DRY violations / boundary issues
5. Commit

**PM signals W1 + W2 are done. W4 can reference v2 gate prompt.**

---

## Workspace 3: Enricher Improvement

**Goal:** Update the enricher to output `categories: FeedbackCategory[]` (max 2), tune the system prompt using gold set corrections, update the judge to validate both categories. Output versioned `enricher/v2.md` and `judge/v2.md`.

**File ownership:** `src/adapters/enricher/claudeEnricher.ts`, `src/adapters/enricher/claudeEnricher.test.ts`, `src/adapters/judge/claudeJudge.ts`, `prompts/enricher/`, `prompts/judge/`

**Depends on:** W1 complete (multi-category ports, eval infrastructure, prompt versioning)

### Phase 1: Multi-Category Output

1. Update `ClaudeEnricher.enrich()`:
   - Tool schema: `categories: string[]` (array, max 2, items from `CATEGORIES`)
   - Returns `{ summary: string; categories: FeedbackCategory[] }`
   - Validation: array length 1–2, all values in `CATEGORIES`

2. Update `ClaudeEnricher` test (`claudeEnricher.test.ts`):
   - Test: non-empty guide appended correctly (existing)
   - Test: single-category result valid
   - Test: two-category result valid
   - Test: returns null on API error (fail-open)

3. Update `ClaudeJudge` to receive and validate `categories[]` — checks both categories fit the original message, assigns single High/Medium/Low confidence + rationale covering both.

4. Update `handleCapture.ts`: passes `enrichment.categories` to `createFeedback`

**Human check-in (via PM):** "Multi-category is working end-to-end. Ready to tune prompts?"

### Phase 2: Prompt Tuning

1. Read `data/gold-set.csv` — filter to `is_feedback = true`, `classification_ok = false`. Identify patterns: "Other" overuse, missed secondary categories, compliance signals missed.

2. Write `prompts/enricher/v2.md` — updated system prompt with:
   - Examples showing correct multi-category assignment
   - Explicit guidance: "Compliance / Legal / Governance" when a legal requirement drives a product gap
   - P1/P2/P3 distilled rules carried forward (from `docs/enrichment-style-guide.md`)
   - Guidance on when to assign 1 vs 2 categories

3. Write `prompts/judge/v2.md` — updated to validate up to 2 categories explicitly.

4. Run eval: `npx tsx scripts/runEval.ts --adapter enricher --version v2`. Compare category accuracy delta vs baseline.

**Human check-in (via PM):** Delta summary. Eddie reviews.

### Phase 3: Integration + Sign-off

1. Update `prompts/config.yaml`: `enricher: v2`, `judge: v2`
2. Update `docs/enrichment-style-guide.md` — add any new distilled rules extracted from the tuning
3. Full test suite passes
4. QC agent checklist
5. Refactor agent — dead code from old single-category model removed (grep + typecheck + PM review)
6. Commit

---

## Workspace 4: Live Auto-Capture Gate

**Goal:** Bot monitors opted-in channels passively and captures feedback automatically. High confidence → silent capture. Medium/low → flagged for review. Eddie marks "Not Feedback" → webhook deletes row.

**File ownership:** `src/adapters/slack/boltGateway.ts`, `src/adapters/transport/socketMode.ts`, `src/index.ts`, `src/config.ts` (new env var), new `src/adapters/webhook/` directory

**Depends on:** W1 complete (taxonomy, schema, Gate Verdict property in Notion)

### Phase 1: Pre-Filter + Live Gate Handler

**Pre-filter (`src/backfill/filter.ts` — extend or new `src/liveGate/filter.ts`):**
Pure function `isLiveGateCandidate(msg)` — drops:
- Messages from bots / the bot itself
- Messages under 10 words with no image
- Messages that are pure emoji, reaction confirmations ("👍", "sounds good", "thanks!")
- Messages the bot already has a dedup record for (already captured)

**Live gate handler:**
1. Add `LIVE_GATE_CHANNEL_IDS` to `src/config.ts` (comma-separated, like `VISION_ENABLED_CHANNEL_IDS`)
2. Subscribe to Slack `message` event in `src/adapters/transport/socketMode.ts`
3. On each message event:
   - Check channel is in `LIVE_GATE_CHANNEL_IDS` — skip if not
   - Run `isLiveGateCandidate` — skip if false
   - Run `ClaudeFeedbackGate.classify()` (using versioned prompt from W2)
   - `null` result (API failure) → skip silently (fail-open)
   - `isLikelyFeedback = false` → skip
   - `isLikelyFeedback = true` → call `handleCapture` with `triggerType: "live_gate"`
4. `handleCapture` sets Status based on gate confidence:
   - `High` → `"New"` (silent, no flag)
   - `Medium` / `Low` → `"Needs Review"`

**Human check-in (via PM):** "Live gate wired up. Pre-filter and confidence routing working. Ready to build webhook deletion?"

### Phase 2: Webhook Deletion + Dedup Cleanup

**Notion webhook handler (`src/adapters/webhook/notionWebhook.ts`):**
- Small HTTP server (e.g. Express) running alongside Socket Mode bot
- Listens for Notion `page.updated` events on the Customer Feedback DB
- On each event: check if `"Gate Verdict"` = `"Not Feedback"`
  - If yes: delete the Notion page + call `dedup.delete(key)` to clear the dedup store
  - If no: ignore

**`FileDedupStore`** gains a `delete(key: string): void` method.

**`DedupStore` port** gains `delete(key: string): void`.

**Local testing:** ngrok tunnel to expose local HTTP server. Document setup in W4's README section.

**Slack app checklist (in W4 plan):**
- [ ] Verify `message.channels` event subscription enabled in Slack app settings (api.slack.com → Event Subscriptions)
- [ ] Verify `message.groups` enabled for private channels

**Human check-in (via PM):** "Webhook handler built. Tested locally with ngrok — deletion and dedup clear both work."

### Phase 3: Integration + Sign-off

1. Full test suite passes (new pure logic in pre-filter is unit-tested)
2. QC agent checklist
3. Refactor agent
4. Commit + env var documentation in `.env.example`

---

## PM Agent Design

**Brief:** The PM agent coordinates W1→W4, filters questions from child agents, decides when to call Refactor and QC agents, and protects Eddie from noise.

**Autonomy — decides independently:**
- Questions about established conventions (model name, import style, test runner, fail-open rules)
- Which Refactor/QC agent to spin up and when
- Workspace sequencing ("W2 is done, start W4")
- Questions with clear answers in the plan or codebase

**Autonomy — must escalate to Eddie:**
- Any change to the data model beyond what's in this spec
- A new external dependency (package or API)
- A conflict between two workspaces touching the same file
- Anything that changes the scope or phases of a workspace

**Four operating artifacts:**
1. `pm-decisions.md` — one line per autonomous decision: what, why, when
2. File ownership map (embedded in PM briefing doc) — which workspace owns which files
3. Question queue — agents send questions to PM first; PM answers or batches non-blockers; only truly blocked items escalate
4. Phase summaries — before each human check-in, PM writes: what was built, decisions made autonomously, what (if anything) Eddie needs to decide

---

## Refactor Agent Design

**Called by PM after each workspace completes a phase.**

**Mandate — four checks only:**
1. **DRY violations** — gate/enricher/judge/vision all share the same Claude call + tool_use + fail-open pattern. New adapters that duplicate it get flagged; PM proposes a shared helper.
2. **File size** — files over ~150 lines that grew during the sprint get flagged for potential splitting.
3. **Core/adapter boundary** — no vendor SDK imports in `src/core/`, no business logic in adapter files.
4. **Dead code** — old "Category" single-select references, old `category: string` type shapes, old single-category logic made redundant by this sprint's changes.

**Safety rules:**
- Dead code removal requires: grep for all references (zero hits) + `npx tsc --noEmit` still passes after tentative removal
- All removals are proposals to PM — never auto-committed
- PM cross-references the file ownership map before approving any removal
- Test files and `pm-decisions.md` are never touched

---

## QC Agent Design

**Called by PM before each phase sign-off.**

**Checklist — applied to every new/modified file in the workspace:**
- [ ] All imports use `.js` specifiers (not `.ts`)
- [ ] Every AI adapter method returns `null` on error — never throws
- [ ] Every new port has a `Null*` implementation
- [ ] Pure logic is unit-tested; adapters are not
- [ ] No vendor SDK imports in `src/core/`
- [ ] New Notion properties use conditional spread (won't break if field missing)
- [ ] Enricher returns max 2 categories
- [ ] `prompts/config.yaml` updated if a new prompt version was written
- [ ] Eval script run and delta recorded if W2 or W3

Violations reported to PM. PM decides if they are blockers before sign-off.

---

## File Changes Summary

### New files
```
prompts/
├── config.yaml
├── gate/v1.md
├── enricher/v1.md
└── judge/v1.md

src/util/loadPrompt.ts
src/adapters/webhook/notionWebhook.ts
src/liveGate/filter.ts
src/liveGate/filter.test.ts

scripts/migrateCategoriesToMultiSelect.ts
scripts/runEval.ts

data/eval-results/           (gitignored)
data/gold-set.csv            (gitignored)
```

### Modified files
```
src/core/taxonomy.ts         — 11th category
src/core/ports.ts            — categories[], delete() on DedupStore
src/adapters/enricher/claudeEnricher.ts     — multi-category output, loadPrompt
src/adapters/enricher/claudeEnricher.test.ts
src/adapters/judge/claudeJudge.ts           — validate both categories, loadPrompt
src/adapters/gate/claudeFeedbackGate.ts     — loadPrompt
src/adapters/notion/notionWriter.ts         — write Categories multi-select, Gate Verdict
src/adapters/dedup/fileStore.ts             — delete() method
src/adapters/transport/socketMode.ts        — message event subscription
src/adapters/slack/boltGateway.ts           — expose any needed helpers
src/core/handleCapture.ts                   — categories[], "Needs Review" status routing
src/core/accuracyReport.ts                  — read Categories field
src/core/correctionLog.ts                   — read Categories field
src/config.ts                               — LIVE_GATE_CHANNEL_IDS
src/index.ts                                — wire loadPrompt, live gate handler, webhook server
.env.example                                — LIVE_GATE_CHANNEL_IDS
docs/enrichment-style-guide.md              — updated rules after W3
```

---

## Human Check-In Schedule

| Check-in | Trigger | What Eddie decides |
|---|---|---|
| W1-1 | Gold set exported, reasoning enriched | Annotate ~10–15 flagged rows |
| W1-2 | Schema + taxonomy + prompts done | Review if PM flagged a conflict |
| W2-1 | Gate tuned, delta measured | Approve improvement or request another iteration |
| W3-1 | Multi-category working | Approve before prompt tuning starts |
| W3-2 | Enricher tuned, delta measured | Approve or request iteration |
| W4-1 | Live gate wired | Approve before webhook work starts |
| W4-2 | Webhook deletion built + tested | Final sign-off |

**~7 check-ins total across the full sprint.** All routed through PM. Eddie only sees the ones that genuinely need a decision.

---

## Non-Goals (This Sprint)

- Rubric-based summary quality scoring (deferred)
- Always-on hosting / production webhook deployment (deferred)
- Slice 2 (weekly digest) or Slice 5 (Slack replies to submitters)
- Ask Spot RAG, vector search, or caching patterns
- Broadening backfill to channels beyond `#test-bot-to-capture-feedback`
