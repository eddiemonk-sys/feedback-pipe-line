# W2: Gate Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tune the `ClaudeFeedbackGate` system prompt using the gold standard dataset to reduce false positives, producing `prompts/gate/v2.md` with a measurably better F1 score than baseline.

**Architecture:** Read gold set false positives → identify dominant patterns → write v2 prompt targeting those patterns → run eval → compare delta. If improvement is insufficient, PM routes back for another iteration before sign-off.

**Tech Stack:** TypeScript/Node ESM, `tsx`, Anthropic SDK (claude-haiku-4-5-20251001). No new dependencies.

## Global Constraints

- All imports use `.js` specifiers even for `.ts` source files (ESM NodeNext)
- No build step — run via `npx tsx`
- Prompt in `prompts/gate/v2.md` — NOT hardcoded in the adapter
- Baseline numbers come from W1's eval output in `data/eval-results/`
- Model: `claude-haiku-4-5-20251001` — do not change
- `data/gold-set.csv` and `data/eval-results/` are gitignored

**Depends on W1 complete:** `prompts/config.yaml`, `scripts/runEval.ts`, `data/gold-set.csv` with `enriched_rationale` populated, `ClaudeFeedbackGate` accepting optional `systemPrompt`.

---

## Task 1: Analyse Gold Set False Positives

**Files:**
- Read: `data/gold-set.csv`

**Interfaces:**
- Produces: understanding of the dominant false-positive patterns to use in Task 2

- [ ] **Step 1: Read the baseline eval result**

```bash
ls -t data/eval-results/ | head -5
cat data/eval-results/<most-recent-gate-result>.json | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const r=JSON.parse(d); console.log(JSON.stringify(r.summary,null,2));"
```

Record: baseline F1, precision, recall, FP count.

- [ ] **Step 2: Extract false-positive rows from gold set**

Write and run a one-off analysis script in the terminal (do not commit):

```bash
node -e "
const fs = require('fs');
const csv = fs.readFileSync('./data/gold-set.csv', 'utf8');
const lines = csv.trim().split('\n');
const headers = lines[0].split(',');
// Find rows where is_feedback=false (gate FPs)
const fps = lines.slice(1).filter(l => {
  // Simple check for is_feedback column = false
  return l.includes(',false,') || l.includes(',false\r');
});
console.log('False positive count:', fps.length);
" 2>/dev/null || npx tsx -e "
import { readFileSync } from 'node:fs';
// Use the parseCSV logic inline to analyse false positives
"
```

Better: use the distillation CSV parser logic to load the gold set and print the `enriched_rationale` of all false-positive rows. Read each rationale and identify repeating themes. Look for the top 3–5 patterns.

Expected patterns (from the grilling analysis):
- Internal team updates / progress reports
- Scheduling / coordination / logistics
- Questions answered within the same thread (no unresolved customer signal)
- Social / greeting / celebration messages
- Deploy / release / status notices

- [ ] **Step 3: Note the top false-positive patterns**

Write a brief note (just for reference while writing v2.md — not committed):

```
Top FP patterns in gold set:
1. Internal progress/status updates ("We pushed the fix", "Deploy complete")
2. Internal logistics / scheduling ("Can we jump on a call?", "Moving this to next sprint")
3. Social messages ("Great work everyone", "Happy Monday!")
4. Questions with answers in thread (question was logged, but the thread resolution makes it not unresolved feedback)
5. Relayed updates that are internal restatements ("FYI, sales says the client liked the demo")
```

---

## Task 2: Write Gate v2 Prompt

**Files:**
- Create: `prompts/gate/v2.md`

**Interfaces:**
- Produces: `prompts/gate/v2.md` — updated system prompt with explicit false-positive rejection patterns added

- [ ] **Step 1: Read the current `prompts/gate/v1.md`**

Open it and understand what it currently does.

- [ ] **Step 2: Write `prompts/gate/v2.md`**

Start from v1 and add a "NOT feedback — reject these" section with concrete, named patterns (based on Task 1 analysis). Use language from the gold set `enriched_rationale` fields where possible — these are the best examples of what to reject.

Template structure:

```markdown
You are triaging Slack messages at a B2B SaaS company providing HR / talent-assessment software, to find CUSTOMER FEEDBACK that was never formally logged.

Customer feedback includes: bug reports, feature requests, complaints, praise, usability friction, pricing/commercial reactions, onboarding pain, reporting/data gaps, candidate-experience remarks, assessment accuracy/validity concerns, and compliance/legal/governance gaps — whether stated directly by a customer or relayed by a colleague ("client said X", "a candidate complained that Y").

## Definitely NOT feedback — reject these:

**Internal logistics and coordination:** scheduling requests, sprint planning, deployment notices, "can we jump on a call", task assignments, pull request / code review chatter. No customer signal — purely operational.

**Internal status updates:** "We pushed the fix", "the release is live", "rollback complete", progress reports on internal work. These describe what the team did, not what a customer experienced.

**Social / interpersonal messages:** greetings, celebrations, "great work", "happy Monday", memes, off-topic chatter. No product signal.

**Resolved questions with no residual signal:** if a question is immediately answered within the same message (e.g. "Quick question — actually figured it out!") or the message itself shows the issue is fully resolved internally, skip it. A question that REMAINS unanswered may still be a signal.

**Internal restatements of non-feedback:** "FYI the sales call went well", "I heard the client liked the demo" — relaying positive social information, not a product gap or customer complaint.

## Grey area — when in doubt, flag it:

A human reviews every message you flag. If a message plausibly carries any unresolved customer signal — even if buried in logistics — flag it. Only withhold messages with clearly no product/customer signal.

Bias toward RECALL. False negatives (missing real feedback) are worse than false positives (flagging internal messages that get rejected in review).
```

Write the actual `prompts/gate/v2.md` with the real patterns found in Task 1 (not just placeholders). Use the `enriched_rationale` text from the gold set to make the examples concrete.

- [ ] **Step 3: Commit the v2 prompt**

```bash
git add prompts/gate/v2.md
git commit -m "feat(gate): v2 system prompt targeting top 5 false-positive patterns from gold set"
```

---

## Task 3: Activate v2 and Run Eval

**Files:**
- Modify: `prompts/config.yaml`

**Interfaces:**
- Produces: eval result in `data/eval-results/` showing delta vs baseline

- [ ] **Step 1: Update `prompts/config.yaml` to activate v2**

```yaml
gate: v2
enricher: v1
judge: v1
```

- [ ] **Step 2: Run the gate eval**

```bash
npx tsx scripts/runEval.ts gate
```

Expected: console prints new precision/recall/F1. Compare with baseline from Task 1 Step 1.

- [ ] **Step 3: Check delta**

The eval result file is at `data/eval-results/<timestamp>-gate-v2.json`. Compare `summary.f1` (and `summary.precision`, `summary.recall`) against the baseline.

Expected: F1 improves (or at worst, precision improves without recall regressing badly). If F1 drops or recall drops significantly (we're missing true feedback), route back to Task 2 for another tuning iteration.

If F1 improves: proceed to Task 4.
If F1 doesn't improve or recall drops >5 points: revise `prompts/gate/v2.md` and re-run eval. Inform PM of the regression.

- [ ] **Step 4: Commit config update**

```bash
git add prompts/config.yaml
git commit -m "chore(prompts): activate gate v2 — delta: F1 <baseline> → <new>"
```

(Fill in the actual F1 numbers in the commit message.)

---

## Task 4: Integration Check + Sign-Off

- [ ] **Step 1: Run full typecheck + tests**

```bash
npx tsc --noEmit && npm test
```

Expected: zero errors, all tests pass.

- [ ] **Step 2: Spot-check with a real backfill scan (optional but recommended)**

If time allows, run `npx tsx scripts/backfillScan.ts` against the test channel with `--dry-run` (if that flag exists) or with a very short window:

```bash
BACKFILL_WEEKS_BACK=1 npx tsx scripts/backfillScan.ts
```

Check that internal messages are getting filtered (not flagged) and real feedback messages are still being flagged.

- [ ] **Step 3: Signal PM: W2 complete, delta measured**

PM will review the eval delta numbers and either sign off or request another tuning iteration.
