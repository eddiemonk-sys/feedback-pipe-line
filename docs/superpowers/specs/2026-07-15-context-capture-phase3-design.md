# Context Capture Phase 3 — Implementation Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve summary quality, replace text-based vision with direct multimodal enrichment, split multi-item Slack messages into separate Notion rows, and capture thread replies back onto the relevant feedback rows.

**Architecture:** Ports-and-adapters throughout. All new behaviour is expressed as port changes in `src/core/ports.ts` with adapters in `src/adapters/`. No core module imports from any adapter or SDK. The enricher becomes the single AI entry point for both classification and image understanding — the separate VisionReader is removed. Thread capture is a new core function (`handleThreadReply.ts`) wired into the existing Socket Mode transport.

**Tech Stack:** TypeScript + Node ESM, `tsx` runtime (no build step), NodeNext module resolution (`.js` imports), `@anthropic-ai/sdk`, `@notionhq/client`, `@slack/bolt`.

## Global Constraints

- `.js` extensions on all imports (NodeNext module resolution)
- No build step — `tsx` runs TypeScript directly
- Fail-open everywhere: all LLM calls return null on failure, never throw; a failed enrichment/judge/route must never block a capture
- Ports in `src/core/ports.ts` only — no SDK imports in core
- Test runner: `node --import tsx --test`
- Enricher model: `claude-sonnet-4-6` (via `ENRICHER_MODEL` env var)
- Judge model: `claude-sonnet-4-6` (via `JUDGE_MODEL` env var)
- Temperature: enricher=0, judge=0
- `VisionReader` port and all adapters are deleted — not deprecated, deleted
- `visualDescription` is removed from `FeedbackRecord` — not optional, removed
- All new Notion properties must be added to the live DB before Phase 2a code deploys
- `Visual Description` Notion property must be deleted AFTER Phase 2a code deploys (code first, then delete property)

---

## Sub-Agent Personas

These agents are available throughout the build. The PM decides when to invoke them.

**PM Agent** — reviews task completion, filters questions before they reach Eddie, decides when to call Refactor and QC, suggests when to `/commit`. Checks in with Eddie at the end of each phase.

**Refactor Agent** — invoked at the end of each phase, or when any file grows past ~200 lines. Simplifies, removes duplication, improves naming. Does not change behaviour.

**QC Agent** — invoked after each task within a phase. Checks: tests pass, `tsc --noEmit` clean, no regressions in existing tests.

---

## Port Changes — Complete List

### `LLMToolCall` — add optional `images` param

```typescript
complete(params: {
  system: string;
  userMessage: string;
  tool: { name: string; description: string; inputSchema: Record<string, unknown> };
  temperature?: number;
  maxTokens: number;
  images?: ImageAttachment[];   // NEW — optional; AnthropicLLMClient maps to content blocks; OpenAILLMClient ignores (no-op)
}): Promise<Record<string, unknown> | null>
```

### `Enricher` — add images param, return array

```typescript
interface Enricher {
  enrich(
    text: string,
    channelName: string,
    images?: ImageAttachment[],    // NEW
  ): Promise<EnrichmentResult[] | null>   // CHANGED: always array; length=1 for non-split
}
```

### `EnrichmentResult` — add batch metadata fields

```typescript
interface EnrichmentResult {
  summary: string;
  categories: FeedbackCategory[];
  // NEW — populated only on batch-split items:
  preambleContext?: string;     // framing text from message header
  clientName?: string;          // account name extracted from preamble (always explicit, never inferred)
  mentionedUsers?: string[];    // resolved @mention names within this item's bullet
  imageIndices?: number[];      // indices into the parent images[] this item claims
}
```

### `FeedbackRecord` — add batch fields, remove visualDescription

```typescript
interface FeedbackRecord {
  // REMOVED: visualDescription?: string
  // CHANGED: customerAccount now populated from clientName extraction (was always "")

  // NEW:
  sourceMessageKey?: string;   // channelId:messageTs of parent; present only on split rows
  preambleContext?: string;    // framing context from message header
  mentionedUsers?: string[];   // @mention routing signals per child item
  siblingPageIds?: string[];   // Notion page IDs of sibling rows (populated in pass 2)
}
```

### `NotionWriter` — add two methods

```typescript
interface NotionWriter {
  // existing methods unchanged
  updateSiblingLinks(pageId: string, siblingPageIds: string[]): Promise<void>;
  updateSummaryAndLog(
    pageId: string,
    replyText: string,
    replyAuthorName: string,
    replyTs: string,
    images?: ImageAttachment[],
  ): Promise<void>;
}
```

`updateSummaryAndLog` rewrites the `Summary` property and appends a timestamped thread log block to the page body via `blocks.children.append`.

### `DedupStore` — add multi-row methods

```typescript
interface DedupStore {
  // existing methods unchanged
  recordMultiple(key: string, pageIds: string[]): void;
  getPageIds(key: string): string[];   // returns [] if key absent
}
```

File format: values may be `string | null` (existing) or `string[]` (batch). Distinguish by `Array.isArray()` — no version flag.

### `VisionReader` — DELETED

Port, adapters (`ClaudeVisionReader`, `NullVisionReader`), and all references removed.

### `CaptureDeps` — remove vision fields

Remove `vision: VisionReader` and `visionEnabledChannelIds: Set<string>`.

### `ThreadRouter` — NEW PORT

```typescript
interface ThreadRouterResult {
  pageId: string;
  relevance: "primary" | "secondary";
  rationale: string;
}

interface ThreadRouter {
  route(
    replyText: string,
    replyImages: ImageAttachment[],
    candidates: Array<{ pageId: string; summary: string; preambleContext?: string }>,
  ): Promise<ThreadRouterResult[]>;  // [] on any failure (fail-open)
}
```

---

## New Files

| File | Purpose |
|------|---------|
| `prompts/enricher/v15.md` | Enricher prompt: new summary format, batch splitting, client extraction, image attribution, @mention capture |
| `prompts/judge/v4.md` | Judge prompt: evaluate new summary format and batch split quality |
| `prompts/threadRouter/v1.md` | Thread router prompt: golden criteria for routing replies to child rows |
| `src/core/handleThreadReply.ts` | Core thread reply logic: look up parent rows, invoke capture if missing, route, update |
| `src/adapters/threadRouter/claudeThreadRouter.ts` | ThreadRouter adapter using Anthropic LLM |
| `src/adapters/threadRouter/nullThreadRouter.ts` | ThreadRouter no-op adapter (returns []) |
| `data/golden-criteria.md` | Complete golden criteria document (all five sets) |

---

## Notion DB Schema Changes

Apply these changes to the live "Customer Feedback" database. Sequence matters — see deployment order in Implementation Risks.

| Property | Action | Type |
|----------|--------|------|
| `Visual Description` | Delete (AFTER Phase 2a code deploys) | rich_text |
| `Source Message Key` | Add | rich_text |
| `Preamble Context` | Add | rich_text |
| `Mentioned Users` | Add | rich_text |
| `Siblings` | Add | self-referencing relation |
| `Customer/Account` | No change — now populated from clientName extraction | rich_text (existing) |

Verify: Notion integration token has "Insert content" permission (needed for `blocks.children.append`).

---

## Golden Criteria

Format: named criteria, scored **Poor / Adequate / Strong** or **True / False**, with justification and examples. Full text lives in `data/golden-criteria.md`; summaries below.

### SQ — Summary Quality

**SQ-1: Lead Sentence** (Poor / Adequate / Strong)
- **Strong:** Names the most important point first; client name present if stated in source; no buried or omitted deadline.
  > "Merlin wants to know what's possible with AI interview and prefers a fully custom ATS integration, with a hard deadline of end of July to start testing."
- **Adequate:** Lead sentence present but buries the key point, or omits client name.
- **Poor:** No distinct lead; run-on blend of all points; or vague meta-commentary ("User shared several thoughts about…").

**SQ-2: Bullet Enumeration** (Poor / Adequate / Strong)
- **Strong:** Each distinct point is its own bullet. Dates, options (A/B/C), and flags ([quick win], [long term]) are preserved.
  > "• Case study [quick win]: monitor which meeting-summary template HMs use" / "• Timeline: end of July for testing; Aug–Sep testing; real use from Oct."
- **Adequate:** Bullets present but some points merged, or dates dropped from bullets.
- **Poor:** No bullets; or bullets collapse 4+ points into 1.

**SQ-3: Factual Faithfulness** (True / False)
- **True:** Every claim in the summary is present in the source message.
- **False:** Any bullet introduces a claim not in the source, or changes option → requirement or vice versa.

**SQ-4: Deadline / Date Preservation** (True / False)
- **True:** Every specific date or timeline appears verbatim as a bullet.
- **False:** A date in the source is absent from the summary.

### BS — Batch Splitting

**BS-1: Split Decision** (Poor / Adequate / Strong)
- **Strong:** Splits when items have distinct root causes / categories / owners. Does NOT split when items are symptoms of one issue, requirements for one fix, or options for one request.
  - Split: DTG message → 6 rows (each a distinct product gap)
  - No-split (Lidl): two invite options for one UX fix → 1 row
  - No-split (Merlin): three intro requirements for one complaint → 1 row
- **Adequate:** Correct split/no-split but wrong row count.
- **Poor:** Splits a no-split; or produces 1 row for 4+ distinct items.

**BS-2: Client Name Propagation** (True / False)
- **True:** Explicitly stated client name extracted from preamble and written to `Customer/Account` on every child row.
- **False:** Client name missing from any child row; or AI infers a name not stated.

**BS-3: Preamble Context Propagation** (True / False)
- **True:** Framing context from message header present in `preambleContext` on every child row.
- **False:** Preamble absent from any child row; or bullet content incorrectly treated as preamble.

**BS-4: @Mention Capture** (True / False)
- **True:** @mentions within a bullet captured in `mentionedUsers` for that row only. Preamble @mentions not attributed to individual rows.
- **False:** Bullet @mention omitted; or preamble @mention attached to a specific child row.

### IA — Image-to-Row Assignment

**IA-1: Explicit Attribution** (Poor / Adequate / Strong)
- **Strong:** "See example in screenshot below" → image assigned to that item only.
- **Adequate:** Plausible assignment but not the explicitly attributed item.
- **Poor:** Image broadcast to all rows or dropped.

**IA-2: Ambiguous Attribution** (True / False)
- **True:** Image without explicit reference routes to parent (sourceMessageKey) rather than guessing a child.
- **False:** AI guesses an assignment for an ambiguously attributed image.

**IA-3: Thread Reply Images** (True / False)
- **True:** Screenshot in a thread reply assigned to the row(s) the reply addresses.
- **False:** Thread reply image dropped or assigned to all rows.

### TR — Thread Routing

**TR-1: Single-Row Routing** (True / False)
- **True:** Reply clearly addressing one row is routed to that row only.
- **False:** Routed to wrong row, all rows, or dropped when a match exists.

**TR-2: Multi-Row Routing** (Poor / Adequate / Strong)
- **Strong:** Reply addressing multiple rows routes to all relevant rows with correct `relevance` labels.
  > "For both the language-per-stage and interview-stage points, this will be in the July release" → both rows as primary.
- **Adequate:** Routes to multiple rows but relevance labels wrong or one row missed.
- **Poor:** Routes to one row when two are clearly relevant; or routes to all rows indiscriminately.

**TR-3: Missing-Parent Recovery** (True / False)
- **True:** When parent not in DedupStore, full capture pipeline runs first, then reply is routed.
- **False:** Reply dropped when parent absent; or parent capture failure loses the reply without logging.

### CN — Client Name Extraction

**CN-1: Explicit Name** (True / False)
- **True:** Explicitly stated client name extracted. No inference.
- **False:** Stated name missed; or name inferred when not stated.

**CN-2: No-Client Handling** (True / False)
- **True:** No client name stated → `clientName` absent. Treated as internal process.
- **False:** AI invents or infers a client name not in the message.

---

## Phase Breakdown

### Phase 1 — Better Summaries
**Branch:** `work-area2`
**Scope:** Prompt-only. No code changes.

- Write `prompts/enricher/v15.md` — new summary format with lead sentence + bullets, date enforcement, batch split guidance stub
- Write `prompts/judge/v4.md` — evaluate new format
- Update `prompts/config.yaml` to point at v15 / v4
- Run `npm run eval:enricher` and `npm run eval:judge` — maintain ≥93.3% / ≥current baseline
- **PM check-in:** confirm eval scores before Phase 2 starts

### Phase 2a — Screenshot Multimodal
**Branch:** `work-area2` (sequential after Phase 1)
**Scope:** Remove VisionReader, thread images directly to enricher, embed image as Notion page block.

Key changes:
- Delete `VisionReader` port + all adapters
- Add `images?` to `LLMToolCall.complete()` — implement in `AnthropicLLMClient`, no-op in `OpenAILLMClient`
- Update `Enricher` port + `claudeEnricher.ts` to accept and pass images
- Remove `vision` / `visionEnabledChannelIds` from `CaptureDeps`
- Remove `visualDescription` from `FeedbackRecord`
- Remove vision path from `handleCapture.ts`
- Update `notionWriter.ts`: remove `visualDescription` write; embed image as inline page block (`blocks.children.append`) instead of property
- Notion: delete `Visual Description` property AFTER deploy
- **PM check-in before deploy:** confirm Notion token has Insert content permission

### Phase 2b — Batch Splitting
**Branch:** `work-area2` (sequential after Phase 2a)
**Scope:** One message → N Notion rows.

Key changes:
- Add `sourceMessageKey?`, `preambleContext?`, `mentionedUsers?`, `siblingPageIds?` to `FeedbackRecord`
- Add `preambleContext?`, `clientName?`, `mentionedUsers?`, `imageIndices?` to `EnrichmentResult`
- Change `Enricher.enrich()` return type to `EnrichmentResult[] | null`
- Update `claudeEnricher.ts` to return array; extract batch fields from tool call output
- Update `NullEnricher` return type
- Add `recordMultiple()`, `getPageIds()` to `DedupStore` port + `FileDedupStore`
- Update `handleCapture.ts`: iterate `EnrichmentResult[]`, write each row (pass 1), collect pageIds, call `recordMultiple()`, then `updateSiblingLinks()` for each row (pass 2)
- Add `updateSiblingLinks()` to `NotionWriter` port + `notionWriter.ts` + `localWriter.ts`
- Update re-reaction path: `getPageIds()` → `appendFlagger()` on all
- Notion: add `Source Message Key`, `Preamble Context`, `Mentioned Users`, `Siblings` properties
- **PM check-in:** verify sibling links round-trip correctly on the DTG example before Phase 3 starts

### Phase 3 — Thread Capture
**Branch:** `work-area2-thread` (new worktree, after Phase 2 merges to main)
**Scope:** Thread reply event handling.

Key changes:
- Add `ThreadRouter` port to `ports.ts`
- Add `updateSummaryAndLog()` to `NotionWriter` port
- Create `claudeThreadRouter.ts` + `nullThreadRouter.ts`
- Create `handleThreadReply.ts`: look up `getPageIds(channelId:threadTs)`; if empty, invoke `handleCapture` first (pass `handleCapture` as a dep); call `ThreadRouter.route()`; call `updateSummaryAndLog()` for each matched row
- Update `socketMode.ts`: add `message` event listener filtering `event.thread_ts && event.thread_ts !== event.ts && !event.bot_id`
- Wire `handleThreadReply` in `index.ts`; pass fully-wired `handleCapture` as a dep
- **PM check-in:** test with the NIQ thread example before merging

### Phase 4 — Golden Criteria + Eval
**Branch:** `work-area2-eval` (parallel with Phase 3)
**Scope:** Author criteria, extend eval.

Key changes:
- Write `data/golden-criteria.md` (all five sets from this spec)
- Wire criteria file as guide appended to enricher + thread router prompts
- Add `batch` and `thread` eval modes to `scripts/runEval.ts`
- Add DTG, Lidl, Merlin, NIQ examples to gold set as labelled eval rows
- **PM check-in:** Eddie reviews criteria draft before it's wired into prompts

---

## Implementation Risks

**R1 — Two-pass sibling write partial failure.** Pass 1 (write rows) may succeed; pass 2 (`updateSiblingLinks`) may fail for a row. Log and continue — rows without sibling links are valid captures. Do not roll back pass 1 rows.

**R2 — handleThreadReply → handleCapture dependency ordering.** Both in `src/core/`. Pass `handleCapture` as a callback dep in `ThreadReplyDeps`. The callback must be the fully-wired version from `index.ts`, not a partial closure. Document the wire order explicitly.

**R3 — DedupStore mixed old/new entries.** Load path must distinguish `string | null` (legacy) vs `string[]` (batch) by `Array.isArray()`, not a version flag. Backward compatible.

**R4 — Notion Insert content permission.** `blocks.children.append` requires "Insert content" on the integration token. Verify before Phase 2a deploys. Missing permission → `updateSummaryAndLog` silently fails (fail-open), thread log never written.

**R5 — imageIndices out-of-range guard.** Each index must be `>= 0 && < images.length`. Treat missing or out-of-range `imageIndices` as "unassigned" — attach to source message, not an error.

**R6 — Bot reply loop.** When `handleThreadReply` triggers `handleCapture` and `handleCapture` posts a `postReply` ack, that bot reply fires a `message` event. The listener must filter `event.bot_id` or `event.user === botUserId` to prevent a loop.

**R7 — Visual Description delete sequence.** Deploy Phase 2a code (which no longer writes the field) before deleting the Notion property. Reverse order causes 400 errors on in-flight captures.
