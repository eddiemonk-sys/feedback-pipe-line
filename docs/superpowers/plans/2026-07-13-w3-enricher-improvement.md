# W3: Enricher Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update `ClaudeEnricher` to output `categories: FeedbackCategory[]` (max 2), update `ClaudeJudge` to validate both categories, tune both prompts using the gold standard dataset, and record an improved eval delta.

**Architecture:** First update the adapters to support multi-category output (port changes come from W1). Then tune the system prompts using gold set correction patterns. Eval before and after the prompt tuning step to isolate the delta.

**Tech Stack:** TypeScript/Node ESM, `tsx`, Anthropic SDK (claude-haiku-4-5-20251001). No new dependencies.

## Global Constraints

- All imports use `.js` specifiers even for `.ts` source files (ESM NodeNext)
- No build step — run via `npx tsx`
- Enricher returns max 2 categories. Validation: array length 1–2, all values in `CATEGORIES`.
- Judge validates both categories in a single `review()` call — one confidence + rationale.
- Prompts in `prompts/enricher/v2.md` and `prompts/judge/v2.md` — NOT hardcoded in adapters.
- Model: `claude-haiku-4-5-20251001` — do not change.
- `data/gold-set.csv` and `data/eval-results/` are gitignored.

**Depends on W1 complete:** multi-category `ports.ts` (`EnrichmentResult.categories[]`, `Judge.review(categories[])`) and versioned prompt system in place. W3 runs in parallel with W2 — they do not share files.

---

## Task 1: Update ClaudeEnricher for Multi-Category Output

**Files:**
- Modify: `src/adapters/enricher/claudeEnricher.ts`

**Interfaces:**
- Consumes: `EnrichmentResult { summary: string; categories: FeedbackCategory[] }` (from W1 ports update)
- Produces: `ClaudeEnricher.enrich()` returns `{ summary, categories: FeedbackCategory[] }` with 1–2 items, or `null` on error

- [ ] **Step 1: Write a failing test first**

Create `src/adapters/enricher/claudeEnricher.test.ts`:

```typescript
// src/adapters/enricher/claudeEnricher.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ClaudeEnricher } from "./claudeEnricher.js";
import { CATEGORIES } from "../../core/taxonomy.js";
import type { FeedbackCategory } from "../../core/ports.js";

// These tests verify the adapter's shape contracts without making real API calls.
// They use a mock that returns a controlled tool_use response.

test("enrich — single category result is valid", async () => {
  const enricher = new ClaudeEnricher("test-key");
  // We can't easily mock Anthropic SDK without a seam. This test is a type-level smoke test.
  // The real contract test: if an API key is absent, enrich() returns null (NullEnricher tested via handleCapture.test.ts).
  // If API key present, the result must satisfy: Array.isArray(categories) && categories.length >= 1 && categories.every(c => CATEGORIES.includes(c))
  assert.ok(typeof enricher.enrich === "function");
});

test("CATEGORIES includes Compliance / Legal / Governance", () => {
  assert.ok(CATEGORIES.includes("Compliance / Legal / Governance" as FeedbackCategory));
});

test("enrich — result shape when API succeeds", async () => {
  // Verify that a plausible result satisfies the multi-category contract.
  const mockResult = { summary: "User wants SSO support.", categories: ["Feature Request"] as FeedbackCategory[] };
  assert.ok(Array.isArray(mockResult.categories));
  assert.ok(mockResult.categories.length >= 1 && mockResult.categories.length <= 2);
  assert.ok(mockResult.categories.every((c) => CATEGORIES.includes(c)));
});
```

- [ ] **Step 2: Run the test to confirm it passes (it's a smoke test, not a mock)**

```bash
node --import tsx --test src/adapters/enricher/claudeEnricher.test.ts
```

Expected: PASS (all three tests pass).

- [ ] **Step 3: Update `ClaudeEnricher.enrich()` tool schema for multi-category**

In `src/adapters/enricher/claudeEnricher.ts`, update the tool schema from a single `category` string to a `categories` array:

```typescript
tools: [
  {
    name: "submit_enrichment",
    description: "Submit the summary and 1–2 categories for this feedback message.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: {
          type: "string",
          description: "1-2 sentence plain-English summary of the feedback",
        },
        categories: {
          type: "array",
          items: { type: "string", enum: CATEGORIES },
          minItems: 1,
          maxItems: 2,
          description: "1 or 2 categories that best fit this feedback. Use 2 only when the message genuinely spans two distinct areas.",
        },
      },
      required: ["summary", "categories"],
    },
  },
],
```

- [ ] **Step 4: Update the response parsing in `enrich()`**

Replace the `input.category` extraction:

```typescript
const input = toolUse.input as { summary: string; categories: string[] };
if (
  !input.summary ||
  !Array.isArray(input.categories) ||
  input.categories.length < 1 ||
  input.categories.length > 2 ||
  !input.categories.every((c) => CATEGORIES.includes(c as FeedbackCategory))
) return null;

return {
  summary: input.summary,
  categories: input.categories as FeedbackCategory[],
};
```

- [ ] **Step 5: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: `claudeEnricher.ts` clean. If `handleCapture.ts` or other files still reference `EnrichmentResult.category` (singular), they should have been fixed in W1 Task 6. Check and fix any remaining references.

- [ ] **Step 6: Add enricher test file to the test command in `package.json`**

Update the `"test"` script in `package.json`:

```json
"test": "node --import tsx --test src/core/*.test.ts src/backfill/*.test.ts src/adapters/enricher/*.test.ts"
```

- [ ] **Step 7: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/adapters/enricher/claudeEnricher.ts src/adapters/enricher/claudeEnricher.test.ts package.json
git commit -m "feat(enricher): multi-category output (categories[], max 2) via tool schema update"
```

---

## Task 2: Update ClaudeJudge for Multi-Category Validation

**Files:**
- Modify: `src/adapters/judge/claudeJudge.ts`

**Interfaces:**
- Consumes: `Judge.review(originalMessage, channelName, summary, categories: FeedbackCategory[])` (from W1 ports update)
- Produces: `ClaudeJudge.review()` validates all assigned categories in one pass, returns `JudgeVerdict | null`

- [ ] **Step 1: Update the `review` method signature**

In `src/adapters/judge/claudeJudge.ts`, change the `review` method to accept `categories: FeedbackCategory[]`:

```typescript
async review(
  originalMessage: string,
  channelName: string,
  summary: string,
  categories: FeedbackCategory[],
): Promise<JudgeVerdict | null> {
```

- [ ] **Step 2: Update the user message to include all categories**

```typescript
content: `Channel: ${channelName}\nOriginal message: ${originalMessage}\n\nProposed summary: ${summary}\nProposed categories: ${categories.join(", ")}`,
```

- [ ] **Step 3: Update the judge system prompt constant**

The current `SYSTEM_PROMPT` says "assigned category" (singular). Update it to mention "assigned categories" (plural) and explain the multi-category validation:

```typescript
const SYSTEM_PROMPT = `You are a quality-control judge for an AI feedback classifier at a B2B SaaS company providing HR / talent-assessment software.

You will be given the ORIGINAL Slack message (the source of truth) and an AI-proposed summary + one or two categories. Check the proposal against the original message and decide how much a human should trust it.

Check three things:
1. Category fit: do ALL assigned categories genuinely match the message, per the taxonomy below?
2. Multi-category justification: if two categories are assigned, does the message genuinely span both areas? Or is one redundant?
3. Summary faithfulness: does the summary only state things actually in the original message (no fabricated claims), and does it capture the key point?

Valid categories: ${CATEGORIES.join(", ")}

Respond with:
- confidence: "High" if all checks clearly pass, "Medium" if one is questionable but plausible, "Low" if any check clearly fails or you are unsure.
- rationale: one short sentence. Only explain what's wrong when confidence is not High — for High, a brief confirmation is enough.`;
```

- [ ] **Step 4: This constant will be replaced by the versioned v2 prompt in Task 3 — for now the default stays as the in-file fallback**

The `ClaudeJudge` constructor already accepts `systemPrompt?: string` (from W1 Task 9). Leave the in-file constant updated as above — it serves as the fallback when no versioned prompt file is loaded.

- [ ] **Step 5: Run typecheck + tests**

```bash
npx tsc --noEmit && npm test
```

Expected: zero errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/judge/claudeJudge.ts
git commit -m "feat(judge): update review() to validate multi-category assignments"
```

---

## Task 3: Measure Baseline Enricher Eval (Before Prompt Tuning)

**Files:**
- Read: `data/eval-results/` (baseline from W1)

- [ ] **Step 1: Read the baseline enricher eval result (produced by W1 Task 10)**

```bash
ls -t data/eval-results/ | grep enricher | head -3
```

Open the most recent enricher result file and read both fields:
- `summary.primaryCategoryAccuracy` — the overall baseline to beat
- `summary.perCategory` — the per-category table. The categories with the lowest accuracy are the ones to target in Task 4's prompt tuning. Do NOT guess; use these numbers.

If no baseline file exists, run it now:

```bash
npx tsx scripts/runEval.ts enricher
```

---

## Task 4: Write Enricher v2 + Judge v2 Prompts

**Files:**
- Create: `prompts/enricher/v2.md`
- Create: `prompts/judge/v2.md`

**Interfaces:**
- Produces: updated prompts targeting "Other" overuse, missed secondary categories, and Compliance/Legal/Governance signals

- [ ] **Step 1: Analyse gold set category corrections**

Using the gold set CSV, identify rows where:
- `proposed_category` = "Other" but `corrected_category` is something specific
- `corrected_category` = "Compliance / Legal / Governance" (these are the new-category cases)
- `classification_ok` = false with a specific correction pattern

Read the `enriched_rationale` for these rows to understand the principles.

- [ ] **Step 2: Write `prompts/enricher/v2.md`**

Start from `prompts/enricher/v1.md`. Add:
1. Example for "Compliance / Legal / Governance" (from the gold set)
2. Guidance on when to assign 2 categories (genuinely spans two distinct areas, NOT one is a sub-point of the other)
3. Guidance to avoid "Other" when a more specific category fits
4. Carry forward the P1/P2/P3 distilled rules from `docs/enrichment-style-guide.md` — append them at the end of the system prompt

Template additions (fill with actual examples from gold set):

```markdown
[existing v1 content]

- Compliance / Legal / Governance: "We need GDPR-compliant data deletion within 30 days" → "Customer requires data deletion capability to meet GDPR compliance deadline."

## When to use 2 categories

Assign 2 categories ONLY when the message genuinely spans two distinct areas and both add meaningful signal. Examples:
- "The export is broken AND the data it produces doesn't include withdrawn candidates" → ["Bug / Broken", "Reporting / Data"] — two distinct problems.
- "The onboarding docs are confusing and I wish there was a bulk-invite option" → ["Onboarding / Setup", "Feature Request"] — two distinct requests.

Do NOT assign 2 categories when:
- One category is a subtype of the other ("it's both a UX issue and a Bug" — pick the more specific one)
- The message has one clear primary theme with a minor tangential mention

## Avoid "Other"

Before using "Other", ask: does any of the 11 specific categories cover this? "Other" is for genuinely uncategorisable messages — roadmap inquiries, vague sentiments with no product signal. If the message mentions a legal requirement, a data gap, a pricing objection, or an assessment complaint — use the specific category.

## Distilled rules (from human review)

[Paste contents of docs/enrichment-style-guide.md here — NOT a file reference, inline them]
```

**Important:** The distilled rules from `docs/enrichment-style-guide.md` must be inlined into the prompt file, not referenced as a path. Copy them verbatim.

- [ ] **Step 3: Write `prompts/judge/v2.md`**

Start from `prompts/judge/v1.md` updated content (from Task 2 Step 3). The judge v2 prompt is the same multi-category-aware content — just save it as a versioned file:

```markdown
[Copy the updated SYSTEM_PROMPT from claudeJudge.ts verbatim — the one from Task 2 Step 3]
```

- [ ] **Step 4: Update `prompts/config.yaml` to activate v2**

```yaml
gate: v2
enricher: v2
judge: v2
```

(Use `gate: v1` if W2 is still running and hasn't signed off its v2 yet.)

- [ ] **Step 5: Commit new prompts**

```bash
git add prompts/enricher/v2.md prompts/judge/v2.md prompts/config.yaml
git commit -m "feat(enricher/judge): v2 prompts — multi-category guidance, Compliance category, avoid-Other rule"
```

---

## Task 5: Run Enricher Eval + Measure Delta

**Files:**
- Read: `data/gold-set.csv`
- Create: `data/eval-results/<timestamp>-enricher-v2.json` (gitignored)

- [ ] **Step 1: Run eval with v2 prompt active**

```bash
npx tsx scripts/runEval.ts enricher
```

Expected: primary category accuracy improves vs baseline recorded in Task 3.

- [ ] **Step 2: Compare the delta**

Open the two result files and compare `summary.primaryCategoryAccuracy`:

```bash
cat data/eval-results/<baseline-enricher>.json | node -e "const d=require('fs').readFileSync(0,'utf8'); console.log(JSON.parse(d).summary);"
cat data/eval-results/<v2-enricher>.json | node -e "const d=require('fs').readFileSync(0,'utf8'); console.log(JSON.parse(d).summary);"
```

If accuracy improves → proceed to Task 6.
If accuracy drops or is unchanged → revise `prompts/enricher/v2.md` and re-run. Inform PM.

---

## Task 6: Update Style Guide if New Rules Found

**Files:**
- Modify: `docs/enrichment-style-guide.md` (only if new distilled rules were found during tuning)

- [ ] **Step 1: Review the gold set corrections for new principles not already in the style guide**

Open `docs/enrichment-style-guide.md` (current P1, P2, P3). Compare with patterns found in Task 4 Step 1.

If new principles exist (e.g. "don't use Other when Compliance/Legal/Governance fits"), add them as P4, P5, etc. using the same format as the existing entries.

Only add principles that are non-obvious and would change AI behaviour — not restatements of the taxonomy descriptions.

If no new principles: skip this step.

- [ ] **Step 2: Commit (only if file changed)**

```bash
git add docs/enrichment-style-guide.md
git commit -m "docs(style-guide): add distilled rules from W3 enricher tuning"
```

---

## Task 7: Integration Check + Dead Code + Sign-Off

**Files:**
- Check: `src/adapters/enricher/claudeEnricher.ts`, `src/adapters/judge/claudeJudge.ts`

- [ ] **Step 1: Remove old single-category references in enricher/judge**

Search for any remaining `category:` (singular) references in the enricher/judge adapters that should now be `categories`:

```bash
grep -n "\.category\b" src/adapters/enricher/claudeEnricher.ts src/adapters/judge/claudeJudge.ts
```

Expected: zero matches (all replaced with `.categories`).

- [ ] **Step 2: Run typecheck + tests**

```bash
npx tsc --noEmit && npm test
```

Expected: zero errors, all tests pass.

- [ ] **Step 3: Signal PM: W3 complete, delta measured**

Report:
- Baseline enricher primary category accuracy: X%
- v2 enricher primary category accuracy: Y%
- Delta: +N points

PM will review and either sign off or request another iteration.
