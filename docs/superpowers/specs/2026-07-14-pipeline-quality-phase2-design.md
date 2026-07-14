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

## 6. Automatic Capture Gate

### Overview

The live FeedbackGate already exists as an adapter (`src/adapters/gate/claudeFeedbackGate.ts`) and is fully designed in `docs/superpowers/plans/2026-07-13-w4-live-gate.md`. Phase 2 delivers the gate quality improvements (LLMToolCall abstraction + prompt v4). The W4 plan delivers the live wiring (Socket Mode message handler, pre-filter, config). Run Phase 2 first.

### Gate in LLMToolClient abstraction

`claudeFeedbackGate.ts` modified in place — Anthropic SDK internals replaced with `LLMToolCall`, class renamed from `ClaudeFeedbackGate` to `FeedbackGate`. New `GATE_MODEL` env var in `.env.example`, defaulting to `claude-haiku-4-5-20251001`.

Gate stays Haiku by default: it runs on every message in every monitored channel. Sonnet rates on that volume aren't justified for a binary yes/no filter — the Sonnet enricher+judge catches any gate misses downstream. Swappable via env when needed.

### Gate prompt v4 (`prompts/gate/v4.md`)

Base: v3 unchanged. Addition: `## Worked examples` section with ~6 feedback examples and ~6 non-feedback examples drawn from `data/gold-set.csv`.

**Selection criteria — pick the hard cases, not the obvious ones:**

Feedback examples to include:
- Employee relaying customer voice ("a client told me…", "one of our users flagged…")
- Indirect frustration ("we've been working around this for weeks")
- Compliance or legal concern embedded in a setup call note
- Feature gap identified in an internal team discussion
- Short ambiguous message that IS feedback (easy to miss)

Non-feedback examples to include:
- Internal logistics ("can you hop on a call to discuss?")
- Pure social with no product signal
- Admin message that mentions a product feature but isn't requesting anything
- Acknowledgement / response message ("sounds good, thanks")
- Message that looks like feedback but is clearly internal process only

The model already handles clear cases correctly — worked examples are only needed for the borderline calls.

### Medium confidence handling

Medium confidence → auto-capture with `Status = "Needs Review"`. Consistent with how Medium/Low enricher confidence works today. Human reviews the queue in Notion via `npm run report`.

Low confidence → skip (do not capture). The gate is high-recall biased — Low means the gate is confident it is NOT feedback.

### Eval gate

`npm run eval:gate` must show ≥ current precision/recall on the 95-row gold set (`data/gold-set.csv`, `is_feedback` column) before merging. Primary concern is recall (false negatives = missed feedback). Precision failures are caught downstream by the enricher+judge.

### W4 wiring (separate implementation)

Everything else — Socket Mode `message` event handler, pre-filter (`src/liveGate/filter.ts`), `LIVE_GATE_CHANNEL_IDS` config, `notionWebhookPort` for deletion flow — is specified in the W4 plan. Do not re-implement here.

---

## Data Flow Summary

```
Live Slack message (monitored channel, once W4 is wired)
  → pre-filter (drops short/bot/ack messages)
  → gate classify (Haiku, v4 prompt, LLMToolCall)
    → High → handleCapture, Status="New"
    → Medium → handleCapture, Status="Needs Review"
    → Low → skip

handleCapture
  → enrich (Sonnet, v14 prompt, LLMToolCall)
  → judge (Sonnet, v3 prompt, LLMToolCall)
  → [if Low] retry enrich with judge feedback note
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
| `src/adapters/enricher/claudeEnricher.ts` | Modify — swap Anthropic SDK for `LLMToolCall`, rename class to `Enricher` |
| `src/adapters/judge/claudeJudge.ts` | Modify — swap Anthropic SDK for `LLMToolCall`, rename class to `Judge`, add temperature/reasoning |
| `src/index.ts` | Wire provider selection from env |
| `src/core/handleCapture.ts` | Add retry loop |
| `prompts/enricher/v14.md` | New — v9 base + worked examples |
| `prompts/judge/v3.md` | New — v2 base + reasoning + examples + CandExp rule |
| `prompts/config.yaml` | Bump enricher → v14, judge → v3 |
| `scripts/accuracyReport.ts` | Add three new report sections |
| `src/adapters/gate/claudeFeedbackGate.ts` | Modify — swap Anthropic SDK for `LLMToolCall`, rename class to `FeedbackGate` |
| `prompts/gate/v4.md` | New — v3 base + worked examples from 95-row gold set |
| `prompts/config.yaml` | Bump enricher → v14, judge → v3, gate → v4 |
| `.env.example` | Add ENRICHER_MODEL, JUDGE_MODEL, GATE_MODEL, OPENAI_API_KEY |
| `package.json` | Add `openai` dependency |

---

## Prompt Construction Notes

### Enricher v14 base

Start from `prompts/enricher/v9.md` verbatim. Make two additions only:

1. After the `## How to classify` section, insert the CandExp vs Compliance disambiguation rule (before the existing `**Compliance / Legal / Governance**` block):
```
**Candidate Experience vs Compliance / Legal / Governance:** If a message is about what candidates see, access, or encounter during the hiring process — including privacy or data risks that affect candidates — that is Candidate Experience. Compliance is when a legal obligation or regulation is the explicit driver of a product or policy change. "Candidates can inadvertently access confidential interview recordings" = Candidate Experience (what candidates encounter). "We need GDPR-compliant data deletion" = Compliance (legal obligation).
```

2. Append `## Worked examples` at the end (see § Enricher v14 Examples below).

### Judge v3 base

Start from `prompts/judge/v2.md` verbatim. Add:
1. After the three checks paragraph: "Fill the `reasoning` field first — 1–2 sentences on which signals in the message support or contradict the proposed category."
2. CandExp vs Compliance rule (same text as enricher above).
3. Three confidence examples (see § Judge v3 Examples below).

### Gate v4 base

Start from `prompts/gate/v3.md` verbatim. Append `## Worked examples` (see § Gate v4 Examples below).

---

## § Enricher v14 Examples

Append this section verbatim to `prompts/enricher/v14.md`:

```markdown
## Worked examples

These are real verified messages from `data/gold-set.csv`. Use them to calibrate borderline cases.

**Feature Request — tentative question:**
> "Thanks. This is their current one, and they use it a fair bit. I've also recently added the Implementation tab. It might be good to have a separate one for Recruiters and HMs though?"
→ **Feature Request.** Phrased as a polite, uncertain question — but the underlying ask is a new product capability (separate views per role). Conversational or tentative framing does not make something Other.

**Feature Request — internal team identifying a gap:**
> "Useful call. That is very valuable feedback — a generalisability lever/setting is something that would be productive in these to help address some of that scope piece. We can take this to ds-op to discuss."
→ **Feature Request.** An internal team member recognising a customer-reported product gap and escalating it for prioritisation. The feature is vague and early-stage — that still counts.

**UX / Usability — existing feature, poor experience:**
> "Spot on mobiles... I feel like I should know this too. The challenge however, personally, is that very little of the company app is optimised for mobile. We managed to do the new RKO flow, but I don't think anything else is."
→ **UX / Usability.** The product works — the mobile experience is poor. Not a Bug (nothing is broken) and not a Feature Request (mobile support exists, just limited). An existing feature or interface being hard to use = UX.

**Bug / Broken — fix announcement:**
> "Hey mate! I have the fix ready for this, should be in the next release. Note that we'll populate a row with the new user rather than immediately add them to the project team though, like in the screenshot — this is because we always require users to select a 'Team member role' and I didn't want to enforce selecting this in the add new user modal."
→ **Bug / Broken.** A developer announcing a fix is ready still classifies as Bug / Broken. The category captures the bug's existence, not just the initial complaint. Fix announcements, investigation updates, and workaround explanations all belong here.

**Bug / Broken — system not behaving as designed:**
> "oh oops -- apparently our prompts are meant to look at this holistically since January! so if it's not doing it properly then this might be something you can check what's going on? maybe we need to tighten the prompt a bit."
→ **Bug / Broken.** The system has a specified design (holistic evaluation since January) that appears to have broken down — a malfunction, not a validity question. Ask: could the product be working perfectly as designed and the concern still exist? No → Bug.

**Onboarding / Setup — first client socialisation call:**
> "Hello team! Just joined a first socialisation call with some Merlin recruiters around AI interview, it went well! One Q was can we set up a demo for them to play around with. Is that something we can do please? Or do we think there's an existing version (the SDR one maybe?) that would be fine to share?"
→ **Onboarding / Setup.** Reads like a casual status update, but captures a client request to get set up with a demo environment. First client socialisation call with an embedded setup gap = Onboarding. This is broader than initial IT configuration — getting a client running with a feature counts.

**Candidate Experience — what candidates can see or access:**
> "Clients with Teams will often make separate calendar invites for interviews 1 for candidates and 1 for the interviews because: When you have a meeting with Teams, it automatically creates a meeting 'chat' with all attendees. Which any notes, or recordings e.g. chat before/after the meeting is shared. Where they have internal candidates, that means that candidate will have access to that chat and any content shared in it e.g. if the meeting was recorded/have automatic summaries may have them talking about the candidate before/after."
→ **Candidate Experience.** Describes a risk to what candidates can access during the hiring process — internal interviewer discussions may inadvertently leak to internal candidates via Teams chat. Not Compliance (no legal regulation is the explicit driver) — it's about what candidates encounter.

**Assessment Accuracy/Validity — validity question, not a malfunction:**
> "Definitely not the expected behaviour. I'm not 100% sure how the prompts behave on the scoring, so will need to rely on team members on this one."
→ **Assessment Accuracy/Validity.** Uncertainty about whether the scoring accurately measures what it's supposed to — a validity question. The system may be working as coded; the concern is whether it's measuring the right thing. (If it were technically broken, use Bug / Broken instead.)

**Compliance / Legal / Governance — regulatory driver:**
> "It's just Q2 we need more info on around timelines for the privacy notice being updated for AI features and ADM, and then where it will appear in the platform"
→ **Compliance / Legal / Governance.** "Privacy notice" and "ADM" (Automated Decision Making) are explicit regulatory signals. A compliance requirement is driving the ask, even though it's phrased as a product question about timing and placement.

**Praise — positive client outcome:**
> "The power of Skills Science bringing joy to United Utilities 😁🎉"
→ **Praise.** A team member sharing a positive client outcome. No product gap, no request — pure signal of success.

⚠️ **Reporting / Data:** Eddie to supply a real Slack message before this prompt is used in production. Use the v9 synthetic example ("The pipeline report doesn't include withdrawn candidates") as a placeholder only.

⚠️ **Pricing / Commercial:** Eddie to supply a real Slack message before this prompt is used in production. Use the v9 synthetic example ("The per-seat pricing is too high for us") as a placeholder only.

⚠️ **Other:** Eddie to supply a real Slack message before this prompt is used in production. Use the v9 synthetic example ("Quick question about your roadmap") as a placeholder only.
```

---

## § Judge v3 Examples

Append these three examples to `prompts/judge/v3.md` under a `## Confidence examples` heading:

```markdown
## Confidence examples

These are real messages with real enrichment outputs. Use them to calibrate your confidence scale.

---

**High confidence example:**

Original message:
> "Clients with Teams will often make separate calendar invites for interviews 1 for candidates and 1 for the interviews because: When you have a meeting with Teams, it automatically creates a meeting 'chat' with all attendees. Which any notes, or recordings e.g. chat before/after the meeting is shared. Where they have internal candidates, that means that candidate will have access to that chat and any content shared in it e.g. if the meeting was recorded/have automatic summaries may have them talking about the candidate before/after."

Proposed categories: `["Candidate Experience"]`

Proposed summary: "Clients using Teams are creating separate calendar invites for interviews (one for candidates, one for interviewers) because Teams auto-creates a meeting chat that includes all attendees, which can inadvertently expose internal candidate discussions, recordings, and interviewer thoughts to internal candidates."

Reasoning: "The message describes a real risk to what candidates encounter during the hiring process — internal interviewer discussions leaking to internal candidates via Teams chat. Summary is accurate and complete. Category is the precise fit; Compliance would require a legal obligation as the driver."

→ **Confidence: High.** All three checks pass: category fits precisely, no multi-category padding, summary is faithful.

---

**Medium confidence example:**

Original message:
> "Thanks for the feedback on this. Yes, the questions are designed to be uniquely generated across the different stages to hopefully eliminate any repetition in question focus across the different interview stages. It sounds like the issue here is that prompts are focusing in on the same small set of themes so it makes sense that it is also focusing on those themes in each stage. This shouldn't be too much work to fix, I'll add this to our Q3 backlog to investigate in July make some improvements there."

Proposed categories: `["Assessment Accuracy/Validity"]`

Proposed summary: "Assessment questions are generating repetitive themes across interview stages due to prompt design; team will investigate and improve by July as part of Q3 backlog."

Reasoning: "Assessment is plausible since this concerns how prompts generate questions. But 'this shouldn't be too much work to fix' and 'investigate' signal a malfunction: the questions were designed to be unique and aren't. Bug / Broken is the stronger read — the system has a specified design that appears to have broken down."

→ **Confidence: Medium.** Category is defensible but one signal (fix/investigate language) clearly points toward Bug / Broken.

---

**Low confidence example:**

Original message:
> "Okay, pulling a response together for this now — I'm a bit stuck on parts of it as I'm not sure what's already been agreed. Some of it also seems kinda counter-intuitive to what they've brought us in to do? 1. Participation isn't voluntary lol, they need to do it to progress, and outputs do impact their progression? Not sure how best to tackle this. 2. Sharing the privacy notice is fine, but on the second point it is not currently in-platform anywhere - just our website, are we okay just saying that? 3. This one is mostly fine, but I know we do ideally use anonymized data to feed into norm groups and validation studies. Are we okay just clarifying that we only do so with anonymized data?"

Proposed categories: `["Other"]`

Proposed summary: "BA team member clarifying status of internal agreements on candidate participation requirements, privacy notice placement, and anonymized data usage for norm groups/validation studies before finalising a response to stakeholders."

Reasoning: "The summary is accurate but 'Other' is wrong. The message explicitly discusses privacy notice placement, data usage for norm groups, and compliance with candidate participation requirements — these are Compliance / Legal / Governance signals. 'Other' applies only when no specific category fits; this message clearly fits Compliance."

→ **Confidence: Low.** Category check clearly fails — a more specific category (Compliance / Legal / Governance) obviously fits.
```

---

## § Gate v4 Examples

Append this section verbatim to `prompts/gate/v4.md`:

```markdown
## Worked examples

These are real messages from the gold set. The gate handles obvious cases correctly — these examples show the hard calls.

### Flag these — feedback buried in noise

**Internal team relaying a customer product gap:**
> "Useful call. That is very valuable feedback — a generalisability lever/setting is something that would be productive in these to help address some of that scope piece. We can take this to ds-op to discuss."
→ FLAG. Internal team member escalating a customer-reported product gap. Looks like chatter, contains a real feature gap signal.

**Short conversational message revealing an onboarding gap:**
> "They are planning on using automated scoring, yes. But exactly how, and human oversight etc is all up for discussion"
→ FLAG. Reads like a status update. Reveals that a client has no agreed ADM calibration plan — a real onboarding gap worth capturing.

**Internal coordination that reveals a compliance product gap:**
> "Okay, pulling a response together for this now — I'm a bit stuck on parts of it as I'm not sure what's already been agreed... Sharing the privacy notice is fine, but on the second point it is not currently in-platform anywhere - just our website, are we okay just saying that?"
→ FLAG. Long coordination message. Contains an explicit product compliance gap (privacy notice missing from platform). The product signal is real.

**Status update with an embedded client request:**
> "Hello team! Just joined a first socialisation call with some Merlin recruiters around AI interview, it went well! One Q was can we set up a demo for them to play around with. Is that something we can do please?"
→ FLAG. Reads like a positive team update. Embeds a client request (demo environment gap = Onboarding need).

**Client feedback relayed inside a long internal thread:**
> "Funnily enough NIQ has also raised that it's easy to miss the interview feedback summary generation — after each interview, recruiters and managers must click 'Generate Feedback' to create an AI-generated interview evaluation summary before submitting. If they submit without triggering it, the summary will not be available and cannot be generated retrospectively. This is a critical and easy-to-miss step that will cause data loss at scale."
→ FLAG. Embedded NIQ client report inside a longer internal response. The data-loss signal is real and product-relevant.

**Short reply with compliance gap buried in it:**
> "NIQ seem to do this consistently, whether external or internal candidate (also want to hide contact information)"
→ FLAG. One clause — "also want to hide contact information" — reveals a compliance product need. Don't drop short messages; they carry real signals.

---

### Do NOT flag — product mention without product signal

**Project tracking update:**
> "Good call with Merlin! Ran through confirmed process and timelines. They want to be full up and running by Halloween, but keen to do a bit of a phased rollout starting much sooner than that. Key limiter is the integration, timeline wise. Next steps: Merlin to confirm job families & stakeholder groups for each family + priority order."
→ DO NOT FLAG. Looks like onboarding notes. Pure project status update — confirms existing plans, no gap or product issue surfaces.

**Internal reasoning, no request:**
> "Yeh, I imagine that's just because DTG don't have an ATS. Whereas the aim with all other clients would be: we integrate with them so rejection triggers it / we're not integrated, but should be handled by the ATS. Which means, rejection comms to candidates is unlikely to be strategically important."
→ DO NOT FLAG. Mentions ATS integration and product features. But is internal team reasoning — not identifying a gap or asking for anything.

**Scheduling logistics that mentions a product topic:**
> "Hello, Just checking in ahead of our BA Emerging Talent all on Tuesday. Is that still OK? They want to have a conversation about what we recommend by way of human review on AI interviews."
→ DO NOT FLAG. Mentions AI interview human review (product topic). But the message is scheduling confirmation — not surfacing a gap or complaint.

**Direct answer to an internal question:**
> "Yes, it's still something we'll be encouraging for some roles on the Corporate Hire side. I'm not sure how much they'd need the screening questions though as they'll be more open to CVs."
→ DO NOT FLAG. Mentions screening questions and CVs. Pure internal clarification — answering a question, no product signal.

**Clarification request on a topic similar to real feedback:**
> "Hey Charlie, thanks for this. I think somewhere else I've asked you for this information, so ignore that. I can't remember where I asked for that. Just one question on this: I didn't quite understand the point about avoiding teams creating a visible shared chat."
→ DO NOT FLAG. Topic (Teams meeting chat) is similar to a real Candidate Experience feedback row. But this message is an internal clarification request — no product signal, just asking for explanation.

**Internal call notes distributing someone else's feedback:**
> "Notes from today's call: Interview guide blueprint demo: Lois walked the BA team through the platform's interview guide functionality. Question quality discussion: BA raised concerns from last week — questions can be too aviation-specific (excluding qualified candidates from adjacent sectors like rail)..."
→ DO NOT FLAG. "BA raised concerns" sounds like feedback. But this is a team distribution note summarising a meeting — the concern was already captured when it was first raised. Distribution of previously-captured feedback is not new feedback.
```

---

## Remaining Implementation Notes

- `OPENAI_API_KEY` is the correct env var name for the OpenAI SDK (`new OpenAI()` reads it automatically)
- `prompts/config.yaml` has one entry per key (`gate`, `enricher`, `judge`) — bump all three to the new versions in a single edit
- Enricher v14 examples for Reporting/Data, Pricing/Commercial, and Other are placeholder synthetic examples from v9 until Eddie supplies real gold-set messages
