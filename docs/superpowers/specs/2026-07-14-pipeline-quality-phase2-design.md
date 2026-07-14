# Pipeline Quality Phase 2 — Design Spec

## Goal

Break through the 91.1% enricher ceiling by upgrading to Sonnet, adding real gold-set worked examples to both enricher and judge prompts, wiring an inline judge-feedback retry loop, and adding multi-provider (Anthropic + OpenAI) support behind a clean abstraction.

## Background

Phase 1 (Slice 4) delivered: Haiku enricher at temperature=0 with reasoning field, judge writing confidence/rationale to Notion, correction-log script for human review. Prompt iteration reached v9 at 91.1% (41/45 gold set). The remaining 4 misses are Haiku attention-limit problems — not fixable by prompt alone.

## Scope

Five changes shipped together as one sprint:

1. `LLMToolClient` port + Anthropic + OpenAI implementations
2. Enricher: Sonnet + v14 prompt (real gold examples per category)
3. Judge: Sonnet + v3 prompt (reasoning field + confidence examples)
4. Retry loop in `handleCapture.ts` (judge-feedback directed retry on Low)
5. Enhanced `npm run report` Notion page (review queue + corrections + activity)

**Out of scope:** Gold set auto-update from Notion corrections (deferred). Vision and FeedbackGate adapters stay Claude-only (multimodal input doesn't fit the tool-call abstraction).

---

## 1. LLMToolClient Port

### New port in `src/core/ports.ts`

```typescript
export interface LLMToolCall {
  complete(params: {
    system: string;
    userMessage: string;
    tool: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>; // JSON Schema object
    };
    temperature?: number;
    maxTokens: number;
  }): Promise<Record<string, unknown> | null>;
}
```

Returns the parsed tool input as a plain object, or `null` on any failure. Error handling (API errors, malformed responses, missing tool call) lives inside the implementation — callers never see SDK-specific errors.

### Implementations

**`src/adapters/llm/anthropicClient.ts`**
- Wraps `@anthropic-ai/sdk`
- Maps `inputSchema` → `input_schema`
- Sets `tool_choice: { type: "tool", name: tool.name }`
- Extracts result from `response.content.find(b => b.type === "tool_use")?.input`

**`src/adapters/llm/openaiClient.ts`**
- Wraps `openai` npm package
- Maps `tool` → `tools: [{ type: "function", function: { name, description, parameters: inputSchema } }]`
- Sets `tool_choice: { type: "function", function: { name: tool.name } }`
- Extracts result from `response.choices[0].message.tool_calls[0].function.arguments` (JSON-parsed)

### Provider selection in `src/index.ts`

Two new env vars in `.env` / `.env.example`:
```
ENRICHER_MODEL=claude-sonnet-4-6
JUDGE_MODEL=claude-sonnet-4-6
```

Provider detected from model name prefix at startup:
- `claude-*` → `AnthropicLLMClient`
- `gpt-*` → `OpenAILLMClient`

Both `ClaudeEnricher` and `ClaudeJudge` are renamed to `Enricher` and `Judge` (dropping the Claude-specific prefix) and refactored to accept `LLMToolCall` in their constructor instead of an Anthropic client directly.

The existing `ANTHROPIC_API_KEY` env var stays. Add `OPENAI_API_KEY` for OpenAI models (required only when an OpenAI model is selected).

---

## 2. Enricher: v14 Prompt + Sonnet

### Model

`ENRICHER_MODEL=claude-sonnet-4-6` (default). Configurable via env — no code change to switch models.

### Prompt: `prompts/enricher/v14.md`

Base: v9 unchanged (all existing category guidance, disambiguation rules, distilled rules P1–P3).

Addition: `## Worked examples` section appended after the distilled rules. One real example per all 11 categories, selected from `data/gold-set.csv`:

**Selection criteria:**
- Clear, unambiguous signal for the category (not a borderline case)
- Message text short enough to read quickly (prefer under 100 words)
- Not one of the 4 known v9 misses (those are still borderline)

**Format for each example:**
```
**Category Name:**
> "verbatim message text"
→ **Category Name.** One sentence: key signal that drove the choice and why the closest alternative was ruled out.
```

**For categories with zero gold set rows** (likely Pricing/Commercial, Praise, Reporting/Data): the implementation task flags each one; Eddie supplies a real message from Slack history rather than using a synthetic example.

### Config

`prompts/config.yaml` → `enricher: v14`

### Eval gate

`npm run eval:enricher` must show ≥ 41/45 (91.1%) before merging. Target: higher given Sonnet upgrade.

---

## 3. Judge: v3 Prompt + Sonnet

### Model

`JUDGE_MODEL=claude-sonnet-4-6` (default). Configurable via env.

### Adapter changes (`src/adapters/judge/judge.ts`)

- Add `temperature: 0`
- Bump `max_tokens` from 256 to 512
- Add `reasoning` as first required field in `submit_verdict` tool schema:
  ```typescript
  reasoning: {
    type: "string",
    description: "1-2 sentences: which signals support or contradict the proposed category and summary.",
  }
  ```
- Update tool description: "Fill reasoning first, then confidence and rationale."
- Parse `reasoning` from tool input (log it; do not write to Notion — `JudgeVerdict` interface unchanged, `rationale` field carries the human-facing sentence as before)

### Prompt: `prompts/judge/v3.md`

Base: v2 (three checks, confidence scale).

Additions:

**Reasoning instruction** (after the three checks):
> "Fill the `reasoning` field first — 1-2 sentences on which signals in the message support or contradict the proposed category."

**Three confidence-level examples** using real gold set messages:
- **High**: a correct enrichment — confirms category fits and summary is faithful
- **Medium**: one signal questionable — category plausible but summary slightly overstates or misses a nuance
- **Low**: wrong category — primary signal clearly points elsewhere

**CandExp vs Compliance disambiguation** (same text as enricher v9 — judge needs the same rule to spot a wrong call):
> "If a message is about what candidates see, access, or encounter during the hiring process — including privacy or data risks that affect candidates — that is Candidate Experience. Compliance is when a legal obligation or regulation is the explicit driver."

### Config

`prompts/config.yaml` → `judge: v3`

### Eval gate

`npm run eval:judge` — check confidence calibration: High verdicts should be ≥90% correct on the gold set.

---

## 4. Judge-Feedback Retry Loop

### Location

`src/core/handleCapture.ts` — inline block, no new files, no new ports.

### Flow

```
enrich(input) → judge(result)
  → if verdict.confidence === "Low":
      retryInput = prependJudgeNote(input, verdict.rationale)
      retryEnrichment = enrich(retryInput)
      retryVerdict = judge(retryEnrichment)
      enrichment = retryEnrichment
      verdict = retryVerdict
  → write to Notion (final enrichment + verdict)
```

### Retry input construction

```typescript
function buildRetryInput(originalInput: string, judgeRationale: string): string {
  return `${originalInput}\n\nNote: a previous classification of this message was rated Low confidence. Reviewer note: "${judgeRationale}". Reconsider the category — pay particular attention to which category most precisely matches the primary signal.`;
}
```

The enricher interface (`Enricher.enrich(text, channelName)`) is unchanged — the retry just passes a different `text` string.

### Failure handling

If the retry enricher call fails or returns null: keep the original `enrichment` and `verdict`. Log a warning. Never block a capture because a retry failed.

If the retry judge call fails: keep the retry enrichment result with `verdict = null` (same fail-open behaviour as today).

### Logging

```typescript
logger.info("Low confidence — retrying enrichment", {
  key,
  firstCategories: enrichment.categories,
  judgeRationale: verdict.rationale,
});
```

### Notion write

Unchanged. Retry result writes with `Status = "Needs Review"` as normal. No new Notion fields.

---

## 5. Enhanced `npm run report` Notion Page

### Location

`scripts/accuracyReport.ts` — three new sections appended to the existing Notion page (`NOTION_REPORT_PAGE_ID`).

### Section: Review Queue

Query: rows where `Status = "Needs Review"` and `Category Reviewed = false`.

Display: count at top ("N rows awaiting review"), then a table with columns: Date | Channel | Proposed Category | Confidence | Judge Rationale.

Purpose: Eddie's working queue — everything here needs a human sign-off.

### Section: Recent Corrections

Same query logic as `scripts/correctionLog.ts` — rows where `Category Reviewed = true` and `Categories ≠ AI Suggested Categories`. Most recent 20, reverse chronological.

Display: table with columns: Date | Message (excerpt, 80 chars) | AI Category → Human Category.

Purpose: replaces needing to open `enrichment-correction-log.md` locally to see what's been corrected.

### Section: Recent Activity

Query: last 20 captured rows (all statuses), reverse chronological.

Display: table with columns: Date | Channel | Category | Confidence.

Purpose: quick read on pipeline health — are confidence levels trending well?

### Behaviour

`npm run report` overwrites the full Notion page each run. All three sections are always current as of the run time. Existing calibration sections (accuracy by category, confusion matrix) remain at the top.

---

## Data Flow Summary

```
Slack message
  → handleCapture
    → enrich (Sonnet, v14 prompt, LLMToolCall)
    → judge (Sonnet, v3 prompt, LLMToolCall)
    → [if Low] retry enrich with judge note
    → [if Low] re-judge
    → write to Notion (final result, Status="Needs Review" if Low/Medium)
  
npm run report
  → Review Queue (unreviewed Low/Medium rows)
  → Recent Corrections (human category fixes)
  → Recent Activity (last 20 captures)
  → write to Notion accuracy page
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/core/ports.ts` | Add `LLMToolCall` interface |
| `src/adapters/llm/anthropicClient.ts` | New — Anthropic implementation |
| `src/adapters/llm/openaiClient.ts` | New — OpenAI implementation |
| `src/adapters/enricher/enricher.ts` | Rename + refactor to use `LLMToolCall` |
| `src/adapters/enricher/claudeEnricher.ts` | Delete (replaced) |
| `src/adapters/judge/judge.ts` | Rename + refactor to use `LLMToolCall`, add temperature/reasoning |
| `src/adapters/judge/claudeJudge.ts` | Delete (replaced) |
| `src/index.ts` | Wire provider selection from env |
| `src/core/handleCapture.ts` | Add retry loop |
| `prompts/enricher/v14.md` | New — v9 base + worked examples |
| `prompts/judge/v3.md` | New — v2 base + reasoning + examples + CandExp rule |
| `prompts/config.yaml` | Bump enricher → v14, judge → v3 |
| `scripts/accuracyReport.ts` | Add three new report sections |
| `.env.example` | Add ENRICHER_MODEL, JUDGE_MODEL, OPENAI_API_KEY |
| `package.json` | Add `openai` dependency |

---

## Open Items for Implementation

- Read `data/gold-set.csv` and select one example per category for v14 prompt; flag any category with no row for Eddie to supply
- Select three gold set rows for judge v3 confidence examples (High/Medium/Low)
- Confirm `OPENAI_API_KEY` env var name matches OpenAI SDK expectations
