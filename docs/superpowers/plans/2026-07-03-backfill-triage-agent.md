# Backfill Triage Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scan ~4 months of `#test-bot-to-capture-feedback` history, classify likely-feedback with a high-recall AI gate, present candidates in a Notion review database for Eddie to confirm/correct, then capture the confirmed ones through the existing live pipeline and mark each with `:mega:`.

**Architecture:** Two `tsx` scripts either side of a human review step. **Scan** (`backfillScan`) reads Slack history, runs a new high-recall `FeedbackGate` + reuses the existing enricher/vision to produce a *preview* classification, and writes one row per candidate into a purpose-built Notion "Backfill Review" database. Eddie reviews in Notion. **Capture** (`backfillCapture`) reads his decisions back and, for each confirmed row, calls the **existing** `handleCapture` in-process (no second write path), patches his corrections onto the created page, and adds `:mega:` to the original Slack message. All new I/O adapters are thin and verified via dry-run scripts (matching this repo's convention: only pure core logic is unit-tested — see `src/core/handleCapture.test.ts`; adapters like `ClaudeJudge` have no unit tests). Pure decision logic IS unit-tested via `node:test`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `tsx`, `@slack/web-api`, `@notionhq/client` (`notionVersion: "2022-06-28"`), `@anthropic-ai/sdk` (model `claude-haiku-4-5-20251001`), `node:test` + `node:assert/strict`.

## Global Constraints

- **Channel scope: `#test-bot-to-capture-feedback` (`C0BDD5KE91V`) ONLY.** Never widen without an explicit confirmed answer from Spotted Zebra's AI person (per `ENRICHMENT-DESIGN-DECISIONS.md` §6 + updates). The scan script must hard-code / config-guard this single channel.
- **Reuse the taxonomy** in `src/core/taxonomy.ts` (`CATEGORIES`, 10 values). Never invent categories.
- **Reuse `handleCapture`** (`src/core/handleCapture.ts`) for the actual capture. Do NOT write a second path into the "Customer Feedback" DB.
- **Secrets stay in the gitignored `.env`.** Never print the `SLACK_BOT_TOKEN` / `NOTION_API_KEY` / `ANTHROPIC_API_KEY` values.
- **`NOTION_DATABASE_ID=30f9ce0b212d403ab7b8e0a462f33cee`** is the live "Customer Feedback" DB (data source `329cad40-3b7b-42ba-b4dc-e79e55082c6f`).
- **Fail-open** on all AI calls (return `null`, keep going) — mirror `ClaudeJudge`/`ClaudeEnricher`.
- **Import specifiers use `.js`** even for `.ts` files (ESM/NodeNext), matching every existing import.
- **Run the backfill with the live Socket Mode bot STOPPED** so an incidental self-reaction can't double-fire (dedup would catch it, but stopping is cleaner).
- **Test command pattern:** `node --import tsx --test <file>` (see `package.json`).

---

## File Structure

**New files:**
- `src/core/ports.ts` — *modify*: add `FeedbackGate` port + `FeedbackGateResult`.
- `src/adapters/gate/claudeFeedbackGate.ts` — thin adapter, high-recall gate (mirrors `ClaudeJudge`).
- `src/adapters/gate/nullFeedbackGate.ts` — no-op fallback (mirrors `NullJudge`).
- `src/backfill/filter.ts` — pure: which raw Slack messages are scannable candidates.
- `src/backfill/filter.test.ts` — unit tests for the filter.
- `src/backfill/decisions.ts` — pure: parse a review row → decision; decision → `CaptureRequest`; correction extraction.
- `src/backfill/decisions.test.ts` — unit tests for the decision logic.
- `src/backfill/slackHistory.ts` — thin: paginated `conversations.history` + thread replies → raw candidate messages.
- `src/backfill/reviewDb.ts` — thin: create review DB, add candidate rows (best-effort image embed), read decision rows.
- `src/adapters/slack/boltGateway.ts` — *modify*: export `extractImageUrls` (DRY reuse by scanner) + add off-port `listChannelHistory` helper.
- `src/adapters/notion/notionWriter.ts` — *modify*: add off-port `updateClassification(pageId, {category?, summary?})`.
- `scripts/backfillScan.ts` — orchestrates scan → gate → preview enrich/vision → write review DB.
- `scripts/backfillCapture.ts` — orchestrates read decisions → `handleCapture` → patch → `:mega:`.
- `scripts/backfillExportGoldSet.ts` — dumps the review DB to `data/gold-set.jsonl` for eval/tuning (Task 11).
- `src/config.ts` — *modify*: add `backfillReviewParentPageId`, `backfillFlaggedByUserId` (optional).

**State passed between the two scripts:** `data/backfill-review.json` — `{ reviewDatabaseId, createdAtIso }`. The review DB rows themselves carry `Channel ID` + `Message TS` columns so `backfillCapture` can rebuild each `CaptureRequest`.

---

## Task 0: Add the missing `AI Suggested Category` property to the live DB

**Why first:** `handleCapture` + `notionWriter` already write this property, but the live DB lacks it — so every enriched capture (live *and* backfill) fails until it exists. Confirmed absent via fresh data-source fetch on 2026-07-03.

**Files:**
- Create: `scripts/addAiSuggestedCategory.ts`

- [ ] **Step 1: Write the one-off schema script**

```typescript
// scripts/addAiSuggestedCategory.ts
import "dotenv/config";
import { Client } from "@notionhq/client";
import { CATEGORIES } from "../src/core/taxonomy.js";

// Same option colours as the existing "Category" select (see live schema).
const COLORS: Record<string, string> = {
  "Bug / Broken": "red",
  "Feature Request": "blue",
  "Pricing / Commercial": "yellow",
  "Onboarding / Setup": "orange",
  "UX / Usability": "purple",
  "Reporting / Data": "green",
  "Praise": "pink",
  "Other": "gray",
  "Candidate Experience": "brown",
  "Assessment Accuracy/Validity": "default",
};

async function main() {
  const token = process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!token) throw new Error("NOTION_API_KEY missing in .env");
  if (!databaseId) throw new Error("NOTION_DATABASE_ID missing in .env");
  const notion = new Client({ auth: token, notionVersion: "2022-06-28" });

  await notion.databases.update({
    database_id: databaseId,
    properties: {
      "AI Suggested Category": {
        select: { options: CATEGORIES.map((name) => ({ name, color: COLORS[name] ?? "default" })) },
      },
    },
  });
  console.log("✅ Added 'AI Suggested Category' select property with 10 taxonomy options.");
}

main().catch((err) => { console.error("Failed:", err?.body ?? err); process.exit(1); });
```

- [ ] **Step 2: Run it**

Run: `cd /c/Users/eddie/feedback-pipeline && npx tsx scripts/addAiSuggestedCategory.ts`
Expected: `✅ Added 'AI Suggested Category' select property with 10 taxonomy options.`

- [ ] **Step 3: Verify the property now exists**

Re-fetch the data source (via Notion MCP `fetch` on `collection://329cad40-3b7b-42ba-b4dc-e79e55082c6f`) and confirm `AI Suggested Category` appears in the schema with 10 options.
Expected: property present.

- [ ] **Step 4: Commit**

```bash
git add scripts/addAiSuggestedCategory.ts
git commit -m "fix: add missing 'AI Suggested Category' Notion property used by capture path"
```

---

## Task 1: `FeedbackGate` port + `ClaudeFeedbackGate` adapter

**Files:**
- Modify: `src/core/ports.ts` (append)
- Create: `src/adapters/gate/claudeFeedbackGate.ts`
- Create: `src/adapters/gate/nullFeedbackGate.ts`

**Interfaces:**
- Produces: `FeedbackGate.classify(text: string, channelName: string): Promise<FeedbackGateResult | null>` where `FeedbackGateResult = { isLikelyFeedback: boolean; confidence: ConfidenceLevel; rationale: string }`. Consumed by `scripts/backfillScan.ts`.

- [ ] **Step 1: Add the port to `src/core/ports.ts`**

Append after the `VisionReader` interface:

```typescript
export interface FeedbackGateResult {
  /** True if this message is plausibly customer feedback (high-recall bias). */
  isLikelyFeedback: boolean;
  /** How confident the gate is in that call. */
  confidence: ConfidenceLevel;
  /** One short sentence of reasoning, shown to the human reviewer. */
  rationale: string;
}

/**
 * Backfill-only gate: a scoped-down version of the deferred "is this feedback?" check
 * (ENRICHMENT-DESIGN-DECISIONS.md §2). High-recall by design — a human confirms every hit.
 * NOT wired into the live pipeline.
 */
export interface FeedbackGate {
  classify(text: string, channelName: string): Promise<FeedbackGateResult | null>;
}
```

- [ ] **Step 2: Write the `ClaudeFeedbackGate` adapter**

```typescript
// src/adapters/gate/claudeFeedbackGate.ts
import Anthropic from "@anthropic-ai/sdk";
import type { FeedbackGate, FeedbackGateResult, ConfidenceLevel } from "../../core/ports.js";

const CONFIDENCE_LEVELS: ConfidenceLevel[] = ["High", "Medium", "Low"];

const SYSTEM_PROMPT = `You are triaging historical Slack messages at a B2B SaaS company providing HR / talent-assessment software, to find CUSTOMER FEEDBACK that was never formally logged.

Customer feedback includes: bug reports, feature requests, complaints, praise, usability friction, pricing/commercial reactions, onboarding pain, reporting/data gaps, candidate-experience remarks, and assessment accuracy/validity concerns — whether stated directly by a customer or relayed by a colleague ("client said X", "a candidate complained that Y").

NOT feedback: internal logistics, scheduling, greetings, standups, deploy notices, jokes, and generic chit-chat with no product signal.

Bias toward RECALL: a human reviews every message you flag, so when a message plausibly carries any customer signal, flag it. Only withhold messages with clearly no product/customer signal.`;

/** High-recall "is this likely customer feedback?" gate. Fails open (returns null) on error. */
export class ClaudeFeedbackGate implements FeedbackGate {
  private client: Anthropic;

  constructor(apiKey: string, private model = "claude-haiku-4-5-20251001") {
    this.client = new Anthropic({ apiKey });
  }

  async classify(text: string, channelName: string): Promise<FeedbackGateResult | null> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Channel: ${channelName}\nMessage: ${text}` }],
        tools: [
          {
            name: "submit_triage",
            description: "Submit whether this message is likely customer feedback.",
            input_schema: {
              type: "object" as const,
              properties: {
                is_likely_feedback: { type: "boolean", description: "True if plausibly customer feedback (recall-biased)" },
                confidence: { type: "string", enum: CONFIDENCE_LEVELS, description: "Confidence in the decision" },
                rationale: { type: "string", description: "One short sentence of reasoning" },
              },
              required: ["is_likely_feedback", "confidence", "rationale"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "submit_triage" },
      });

      const toolUse = response.content.find((b) => b.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") return null;
      const input = toolUse.input as { is_likely_feedback: boolean; confidence: string; rationale: string };
      if (!CONFIDENCE_LEVELS.includes(input.confidence as ConfidenceLevel) || typeof input.is_likely_feedback !== "boolean") return null;

      return {
        isLikelyFeedback: input.is_likely_feedback,
        confidence: input.confidence as ConfidenceLevel,
        rationale: input.rationale ?? "",
      };
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 3: Write the null fallback**

```typescript
// src/adapters/gate/nullFeedbackGate.ts
import type { FeedbackGate, FeedbackGateResult } from "../../core/ports.js";

/** Used when no ANTHROPIC_API_KEY is set: classifies nothing. */
export class NullFeedbackGate implements FeedbackGate {
  async classify(): Promise<FeedbackGateResult | null> {
    return null;
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `cd /c/Users/eddie/feedback-pipeline && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/ports.ts src/adapters/gate/
git commit -m "feat: add high-recall FeedbackGate port + Claude adapter (backfill-only)"
```

---

## Task 2: Scannable-message filter (pure, TDD)

**Files:**
- Create: `src/backfill/filter.ts`
- Test: `src/backfill/filter.test.ts`

**Interfaces:**
- Produces: `RawSlackMessage` (`{ ts: string; user?: string; text?: string; subtype?: string; hasImage: boolean; reactions?: string[] }`) and `isScannable(msg: RawSlackMessage, opts: { botUserId: string; triggerEmoji: string }): boolean`. Consumed by `slackHistory.ts` and `backfillScan.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/backfill/filter.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isScannable, type RawSlackMessage } from "./filter.js";

const opts = { botUserId: "UBOT", triggerEmoji: "mega" };
const base: RawSlackMessage = { ts: "1.1", user: "Ualice", text: "The export button is broken", hasImage: false };

test("keeps an ordinary user message with text", () => {
  assert.equal(isScannable(base, opts), true);
});

test("keeps a text-less message that has an image", () => {
  assert.equal(isScannable({ ts: "1.2", user: "Ualice", text: "", hasImage: true }, opts), true);
});

test("drops the bot's own messages", () => {
  assert.equal(isScannable({ ...base, user: "UBOT" }, opts), false);
});

test("drops system messages (any subtype)", () => {
  assert.equal(isScannable({ ...base, subtype: "channel_join" }, opts), false);
});

test("drops messages with no text and no image", () => {
  assert.equal(isScannable({ ts: "1.3", user: "Ualice", text: "   ", hasImage: false }, opts), false);
});

test("drops messages already carrying the trigger emoji", () => {
  assert.equal(isScannable({ ...base, reactions: ["mega"] }, opts), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/eddie/feedback-pipeline && node --import tsx --test src/backfill/filter.test.ts`
Expected: FAIL — cannot find module `./filter.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/backfill/filter.ts

/** A raw Slack history message reduced to what the filter needs. */
export interface RawSlackMessage {
  ts: string;
  user?: string;
  text?: string;
  subtype?: string;
  hasImage: boolean;
  reactions?: string[];
}

/**
 * True if this historical message is worth sending to the feedback gate.
 * Drops: the bot's own posts, any system message (subtype set), messages with
 * neither text nor image, and anything already flagged with the trigger emoji.
 */
export function isScannable(
  msg: RawSlackMessage,
  opts: { botUserId: string; triggerEmoji: string },
): boolean {
  if (!msg.user || msg.user === opts.botUserId) return false;
  if (msg.subtype) return false;
  if (!msg.text?.trim() && !msg.hasImage) return false;
  if (msg.reactions?.includes(opts.triggerEmoji)) return false;
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Users/eddie/feedback-pipeline && node --import tsx --test src/backfill/filter.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add src/backfill/filter.ts src/backfill/filter.test.ts
git commit -m "feat: add scannable-message filter for backfill (pure, tested)"
```

---

## Task 3: Review-decision logic (pure, TDD)

**Files:**
- Create: `src/backfill/decisions.ts`
- Test: `src/backfill/decisions.test.ts`

**Interfaces:**
- Consumes: `CaptureRequest` from `../core/events.js`; `FeedbackCategory` from `../core/ports.js`.
- Produces:
  - `ReviewDecision` = `{ channelId: string; messageTs: string; isFeedback: boolean; classificationOk: boolean; correctedCategory?: FeedbackCategory; correctedSummary?: string }`
  - `toCaptureRequest(d: ReviewDecision, triggeredBy: string): CaptureRequest`
  - `correctionFor(d: ReviewDecision): { category?: FeedbackCategory; summary?: string } | null` — null when nothing to patch.
  Both consumed by `scripts/backfillCapture.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/backfill/decisions.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { toCaptureRequest, correctionFor, type ReviewDecision } from "./decisions.js";

const confirmed: ReviewDecision = {
  channelId: "C0BDD5KE91V",
  messageTs: "1712000000.000100",
  isFeedback: true,
  classificationOk: true,
};

test("builds a mega_reaction CaptureRequest attributed to the given user", () => {
  const req = toCaptureRequest(confirmed, "Ueddie");
  assert.equal(req.triggerType, "mega_reaction");
  assert.equal(req.channelId, "C0BDD5KE91V");
  assert.equal(req.messageTs, "1712000000.000100");
  assert.equal(req.triggeredBy, "Ueddie");
});

test("no correction when classification was marked OK", () => {
  assert.equal(correctionFor(confirmed), null);
});

test("correction carries the corrected category when set", () => {
  const d: ReviewDecision = { ...confirmed, classificationOk: false, correctedCategory: "Pricing / Commercial" };
  assert.deepEqual(correctionFor(d), { category: "Pricing / Commercial" });
});

test("correction carries the corrected summary when set", () => {
  const d: ReviewDecision = { ...confirmed, classificationOk: false, correctedSummary: "Customer wants annual billing." };
  assert.deepEqual(correctionFor(d), { summary: "Customer wants annual billing." });
});

test("correction carries both fields when both set", () => {
  const d: ReviewDecision = {
    ...confirmed, classificationOk: false,
    correctedCategory: "Feature Request", correctedSummary: "Wants SSO.",
  };
  assert.deepEqual(correctionFor(d), { category: "Feature Request", summary: "Wants SSO." });
});

test("classification not OK but no corrections provided => null (nothing to patch)", () => {
  const d: ReviewDecision = { ...confirmed, classificationOk: false };
  assert.equal(correctionFor(d), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/eddie/feedback-pipeline && node --import tsx --test src/backfill/decisions.test.ts`
Expected: FAIL — cannot find module `./decisions.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/backfill/decisions.ts
import type { CaptureRequest } from "../core/events.js";
import type { FeedbackCategory } from "../core/ports.js";

export interface ReviewDecision {
  channelId: string;
  messageTs: string;
  /** "Is Feedback?" checkbox — only true rows are captured. */
  isFeedback: boolean;
  /** "Classification OK?" checkbox. */
  classificationOk: boolean;
  /** From the "Corrected Category" select, when the human overrode it. */
  correctedCategory?: FeedbackCategory;
  /** From the "Corrected Summary" text, when the human overrode it. */
  correctedSummary?: string;
}

/** Reconstruct the live-pipeline request from a confirmed review row. */
export function toCaptureRequest(d: ReviewDecision, triggeredBy: string): CaptureRequest {
  return {
    triggerType: "mega_reaction",
    channelId: d.channelId,
    messageTs: d.messageTs,
    triggeredBy,
  };
}

/**
 * The fields to patch onto the created Notion page after capture.
 * Returns null when the classification was accepted or no correction was supplied —
 * so the caller can skip the extra Notion write entirely.
 */
export function correctionFor(
  d: ReviewDecision,
): { category?: FeedbackCategory; summary?: string } | null {
  if (d.classificationOk) return null;
  const patch: { category?: FeedbackCategory; summary?: string } = {};
  if (d.correctedCategory) patch.category = d.correctedCategory;
  if (d.correctedSummary?.trim()) patch.summary = d.correctedSummary.trim();
  return Object.keys(patch).length ? patch : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Users/eddie/feedback-pipeline && node --import tsx --test src/backfill/decisions.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add src/backfill/decisions.ts src/backfill/decisions.test.ts
git commit -m "feat: add pure review-decision logic for backfill capture (tested)"
```

---

## Task 4: Slack history scanner + `extractImageUrls` reuse

**Files:**
- Modify: `src/adapters/slack/boltGateway.ts` (export `extractImageUrls`)
- Create: `src/backfill/slackHistory.ts`

**Interfaces:**
- Consumes: `extractImageUrls` from `../adapters/slack/boltGateway.js`; `RawSlackMessage` from `./filter.js`.
- Produces: `ScanCandidate` = `{ ts: string; user: string; text: string; imageUrls?: string[] }` and `scanChannelHistory(client: WebClient, channelId: string, oldestEpochSec: number, opts: { botUserId: string; triggerEmoji: string }): Promise<ScanCandidate[]>`. Consumed by `scripts/backfillScan.ts`.

**Note:** This is a thin I/O adapter. Per repo convention (adapters aren't unit-tested; only `handleCapture` core is), it is verified by the dry-run in Task 7, not a unit test. The pure filtering it delegates to is already tested in Task 2.

- [ ] **Step 1: Export `extractImageUrls` from the gateway**

In `src/adapters/slack/boltGateway.ts`, change the helper's declaration from `function extractImageUrls(` to `export function extractImageUrls(`. Leave all existing usage unchanged.

- [ ] **Step 2: Write the scanner**

```typescript
// src/backfill/slackHistory.ts
import type { WebClient } from "@slack/web-api";
import { extractImageUrls } from "../adapters/slack/boltGateway.js";
import { isScannable, type RawSlackMessage } from "./filter.js";

export interface ScanCandidate {
  ts: string;
  user: string;
  text: string;
  imageUrls?: string[];
}

function toRaw(m: any): RawSlackMessage {
  return {
    ts: m.ts,
    user: m.user,
    text: m.text ?? "",
    subtype: m.subtype,
    hasImage: !!extractImageUrls(m.files),
    reactions: Array.isArray(m.reactions) ? m.reactions.map((r: any) => r.name) : undefined,
  };
}

function toCandidate(m: any): ScanCandidate {
  return { ts: m.ts, user: m.user, text: m.text ?? "", imageUrls: extractImageUrls(m.files) };
}

/**
 * Paginated scan of a channel's history since `oldestEpochSec`, including thread
 * replies, keeping only messages the filter deems scannable. Thin I/O — the keep/drop
 * decision is the pure, tested `isScannable`.
 */
export async function scanChannelHistory(
  client: WebClient,
  channelId: string,
  oldestEpochSec: number,
  opts: { botUserId: string; triggerEmoji: string },
): Promise<ScanCandidate[]> {
  const out: ScanCandidate[] = [];
  let cursor: string | undefined;

  do {
    const page = await client.conversations.history({
      channel: channelId,
      oldest: String(oldestEpochSec),
      limit: 200,
      cursor,
    });
    for (const m of page.messages ?? []) {
      if (isScannable(toRaw(m), opts)) out.push(toCandidate(m));

      // Thread parent: pull its replies too (feedback often lives in threads).
      if ((m as any).thread_ts && (m as any).reply_count) {
        const replies = await client.conversations.replies({ channel: channelId, ts: (m as any).thread_ts });
        for (const r of replies.messages ?? []) {
          if (r.ts === (m as any).thread_ts) continue; // parent already handled
          if (isScannable(toRaw(r), opts)) out.push(toCandidate(r));
        }
      }
    }
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return out;
}
```

- [ ] **Step 3: Typecheck**

Run: `cd /c/Users/eddie/feedback-pipeline && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/adapters/slack/boltGateway.ts src/backfill/slackHistory.ts
git commit -m "feat: add paginated Slack history scanner (reuses extractImageUrls)"
```

---

## Task 5: Notion review database (create / add rows / read decisions)

**Files:**
- Create: `src/backfill/reviewDb.ts`

**Interfaces:**
- Consumes: `FeedbackCategory` from `../core/ports.js`; `CATEGORIES` from `../core/taxonomy.js`; `ReviewDecision` from `./decisions.js`; `ConfidenceLevel` from `../core/ports.js`.
- Produces class `BackfillReviewDb`:
  - `createDatabase(parentPageId: string): Promise<string>` (returns review DB id)
  - `addCandidate(dbId: string, row: ReviewRowInput): Promise<void>`
  - `readDecisions(dbId: string): Promise<ReviewDecision[]>`
  - type `ReviewRowInput = { channelId; messageTs; message; authorName; dateIso; slackUrl; proposedCategory?; proposedSummary?; visualDescription?; gateConfidence?; gateRationale?; imageUploadId?: string }`.
  Consumed by both scripts.

**Note:** Thin Notion I/O adapter — verified via Task 7/8 dry-runs, not unit tests (repo convention). Image embedding is best-effort with a link fallback (Task 6 supplies the upload id; here we just attach it if present).

- [ ] **Step 1: Write the module**

```typescript
// src/backfill/reviewDb.ts
import { Client } from "@notionhq/client";
import type { ConfidenceLevel, FeedbackCategory } from "../core/ports.js";
import { CATEGORIES } from "../core/taxonomy.js";
import type { ReviewDecision } from "./decisions.js";

const MAX_TEXT = 2000;
const CATEGORY_OPTIONS = CATEGORIES.map((name) => ({ name }));
const CONFIDENCE_OPTIONS = [{ name: "High" }, { name: "Medium" }, { name: "Low" }];

export interface ReviewRowInput {
  channelId: string;
  messageTs: string;
  message: string;
  authorName: string;
  dateIso: string;
  slackUrl: string;
  proposedCategory?: FeedbackCategory;
  proposedSummary?: string;
  visualDescription?: string;
  gateConfidence?: ConfidenceLevel;
  gateRationale?: string;
  /** Notion file-upload id from a successful image upload; omitted => link-only. */
  imageUploadId?: string;
}

function clamp(s: string): string { return s.slice(0, MAX_TEXT); }
function isCategory(v: unknown): v is FeedbackCategory { return CATEGORIES.includes(v as FeedbackCategory); }

export class BackfillReviewDb {
  private client: Client;
  constructor(apiKey: string) {
    this.client = new Client({ auth: apiKey, notionVersion: "2022-06-28" });
  }

  async createDatabase(parentPageId: string): Promise<string> {
    const res = await this.client.databases.create({
      parent: { type: "page_id", page_id: parentPageId },
      title: [{ type: "text", text: { content: "Backfill Review" } }],
      properties: {
        Message: { title: {} },
        Author: { rich_text: {} },
        Date: { date: {} },
        "Slack Link": { url: {} },
        Image: { files: {} },
        "Proposed Category": { select: { options: CATEGORY_OPTIONS } },
        "Proposed Summary": { rich_text: {} },
        "Visual Description": { rich_text: {} },
        "Gate Confidence": { select: { options: CONFIDENCE_OPTIONS } },
        "Gate Rationale": { rich_text: {} },
        // --- human inputs ---
        "Is Feedback?": { checkbox: {} },
        "Classification OK?": { checkbox: {} },
        "Corrected Category": { select: { options: CATEGORY_OPTIONS } },
        "Corrected Summary": { rich_text: {} },
        "Correction Notes": { rich_text: {} },
        // --- machine fields (needed to rebuild the CaptureRequest) ---
        "Channel ID": { rich_text: {} },
        "Message TS": { rich_text: {} },
      },
    });
    return res.id;
  }

  async addCandidate(dbId: string, row: ReviewRowInput): Promise<void> {
    const rt = (s: string) => ({ rich_text: [{ text: { content: clamp(s) } }] });
    await this.client.pages.create({
      parent: { database_id: dbId },
      properties: {
        Message: { title: [{ text: { content: clamp(row.message || "(no text — attachment or file)") } }] },
        Author: rt(row.authorName),
        Date: { date: { start: row.dateIso } },
        "Slack Link": { url: row.slackUrl || null },
        ...(row.imageUploadId
          ? { Image: { files: [{ type: "file_upload", file_upload: { id: row.imageUploadId }, name: "screenshot.png" }] } }
          : {}),
        ...(row.proposedCategory ? { "Proposed Category": { select: { name: row.proposedCategory } } } : {}),
        ...(row.proposedSummary ? { "Proposed Summary": rt(row.proposedSummary) } : {}),
        ...(row.visualDescription ? { "Visual Description": rt(row.visualDescription) } : {}),
        ...(row.gateConfidence ? { "Gate Confidence": { select: { name: row.gateConfidence } } } : {}),
        ...(row.gateRationale ? { "Gate Rationale": rt(row.gateRationale) } : {}),
        "Channel ID": rt(row.channelId),
        "Message TS": rt(row.messageTs),
      },
    });
  }

  /** Read all rows the human marked "Is Feedback?" = true, as structured decisions. */
  async readDecisions(dbId: string): Promise<ReviewDecision[]> {
    const decisions: ReviewDecision[] = [];
    let cursor: string | undefined;
    do {
      const res = await this.client.databases.query({
        database_id: dbId,
        filter: { property: "Is Feedback?", checkbox: { equals: true } },
        start_cursor: cursor,
      });
      for (const page of res.results as any[]) {
        const p = page.properties;
        const correctedCat = p["Corrected Category"]?.select?.name;
        decisions.push({
          channelId: p["Channel ID"]?.rich_text?.[0]?.plain_text ?? "",
          messageTs: p["Message TS"]?.rich_text?.[0]?.plain_text ?? "",
          isFeedback: true,
          classificationOk: !!p["Classification OK?"]?.checkbox,
          correctedCategory: isCategory(correctedCat) ? correctedCat : undefined,
          correctedSummary: p["Corrected Summary"]?.rich_text?.[0]?.plain_text || undefined,
        });
      }
      cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
    } while (cursor);
    return decisions;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /c/Users/eddie/feedback-pipeline && npx tsc --noEmit`
Expected: no errors. (If the `file_upload` shape trips the Notion types, cast that one property object to `any` — the upload path is best-effort and covered by Task 6's runtime fallback.)

- [ ] **Step 3: Commit**

```bash
git add src/backfill/reviewDb.ts
git commit -m "feat: add Backfill Review Notion database (create/add/read)"
```

---

## Task 6: Best-effort image upload helper (spike + fallback)

**Files:**
- Create: `src/backfill/imageUpload.ts`

**Interfaces:**
- Produces: `uploadImageToNotion(apiKey: string, image: { data: string; mimeType: string }): Promise<string | null>` — returns a Notion file-upload id, or `null` on any failure (caller then falls back to link-only). Consumed by `scripts/backfillScan.ts`.

**Note:** The design doc flags Notion image upload as never-verified. This helper isolates that risk: it always resolves (never throws), returning `null` on failure so the review row degrades gracefully to the Slack link.

- [ ] **Step 1: Write the helper**

```typescript
// src/backfill/imageUpload.ts
import { Client } from "@notionhq/client";

/**
 * Upload one image to Notion via the File Upload API and return its id, or null on
 * any failure. Never throws — image embed is best-effort; the Slack link is the fallback.
 */
export async function uploadImageToNotion(
  apiKey: string,
  image: { data: string; mimeType: string },
): Promise<string | null> {
  try {
    const client = new Client({ auth: apiKey, notionVersion: "2022-06-28" });
    const created: any = await (client as any).fileUploads.create({
      mode: "single_part",
      filename: "screenshot.png",
      content_type: image.mimeType,
    });
    const buffer = Buffer.from(image.data, "base64");
    const blob = new Blob([buffer], { type: image.mimeType });
    await (client as any).fileUploads.send({ file_upload_id: created.id, file: { data: blob, filename: "screenshot.png" } });
    return created.id ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Spike it against a real image (dry run)**

Write a throwaway `scripts/_uploadProbe.ts` that: downloads one real image from the test channel (reuse `BoltSlackGateway.downloadImage`), calls `uploadImageToNotion`, and logs the returned id or `null`. Run it.
Run: `cd /c/Users/eddie/feedback-pipeline && npx tsx scripts/_uploadProbe.ts`
Expected: either a non-null id (embed works — great) or `null` (embed unavailable — link fallback will be used). Either outcome is acceptable; record which. Delete the probe afterward.

- [ ] **Step 3: Commit**

```bash
git add src/backfill/imageUpload.ts
git commit -m "feat: best-effort Notion image upload with null fallback"
```

---

## Task 7: `backfillScan` script (scan → gate → preview → review DB)

**Files:**
- Modify: `src/config.ts` (add `backfillReviewParentPageId`)
- Create: `scripts/backfillScan.ts`

**Interfaces:**
- Consumes: `loadConfig`, `BoltSlackGateway`, `ClaudeFeedbackGate`/`NullFeedbackGate`, `ClaudeEnricher`/`NullEnricher`, `ClaudeVisionReader`/`NullVisionReader`, `scanChannelHistory`, `BackfillReviewDb`, `uploadImageToNotion`, `consoleLogger`.

- [ ] **Step 1: Add config field**

In `src/config.ts`, add to the `Config` interface:
```typescript
  /** Notion page (shared with the integration) under which the Backfill Review DB is created. */
  backfillReviewParentPageId?: string;
  /** Slack user id credited as "Flagged By" on backfilled captures (defaults to bot). */
  backfillFlaggedByUserId?: string;
```
and in `loadConfig`'s returned object:
```typescript
    backfillReviewParentPageId: optional("BACKFILL_REVIEW_PARENT_PAGE_ID"),
    backfillFlaggedByUserId: optional("BACKFILL_FLAGGED_BY_USER_ID"),
```

- [ ] **Step 2: Write the scan script**

```typescript
// scripts/backfillScan.ts
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { consoleLogger as logger } from "../src/util/logger.js";
import { BoltSlackGateway } from "../src/adapters/slack/boltGateway.js";
import { ClaudeFeedbackGate } from "../src/adapters/gate/claudeFeedbackGate.js";
import { NullFeedbackGate } from "../src/adapters/gate/nullFeedbackGate.js";
import { ClaudeEnricher } from "../src/adapters/enricher/claudeEnricher.js";
import { NullEnricher } from "../src/adapters/enricher/nullEnricher.js";
import { ClaudeVisionReader } from "../src/adapters/vision/claudeVisionReader.js";
import { NullVisionReader } from "../src/adapters/vision/nullVisionReader.js";
import { scanChannelHistory } from "../src/backfill/slackHistory.js";
import { BackfillReviewDb } from "../src/backfill/reviewDb.js";
import { uploadImageToNotion } from "../src/backfill/imageUpload.js";

const CHANNEL_ID = "C0BDD5KE91V"; // #test-bot-to-capture-feedback — DO NOT widen (see plan constraints)
const MONTHS_BACK = 4;
const STATE_PATH = "./data/backfill-review.json";

async function main() {
  const config = loadConfig();
  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY required for the gate/enrichment.");
  if (!config.notionApiKey) throw new Error("NOTION_API_KEY required.");
  if (!config.backfillReviewParentPageId) throw new Error("BACKFILL_REVIEW_PARENT_PAGE_ID required (a Notion page shared with the integration).");

  const slack = new BoltSlackGateway(config.slackBotToken, logger);
  const botUserId = await slack.getBotUserId();
  const gate = config.anthropicApiKey ? new ClaudeFeedbackGate(config.anthropicApiKey) : new NullFeedbackGate();
  const enricher = config.anthropicApiKey ? new ClaudeEnricher(config.anthropicApiKey) : new NullEnricher();
  const vision = config.anthropicApiKey ? new ClaudeVisionReader(config.anthropicApiKey) : new NullVisionReader();
  const reviewDb = new BackfillReviewDb(config.notionApiKey);
  const visionEnabled = new Set(config.visionEnabledChannelIds).has(CHANNEL_ID);

  const oldest = Math.floor((Date.now() - MONTHS_BACK * 30 * 24 * 60 * 60 * 1000) / 1000);
  const channelName = await slack.resolveChannelName(CHANNEL_ID);

  logger.info(`Scanning ${channelName} since ${new Date(oldest * 1000).toISOString().slice(0, 10)}...`);
  const raw = await scanChannelHistory((slack as any)["client"], CHANNEL_ID, oldest, { botUserId, triggerEmoji: config.triggerEmoji });
  logger.info(`Found ${raw.length} scannable message(s); running the gate...`);

  const dbId = await reviewDb.createDatabase(config.backfillReviewParentPageId);
  writeFileSync(STATE_PATH, JSON.stringify({ reviewDatabaseId: dbId, createdAtIso: new Date().toISOString() }, null, 2));
  logger.info(`Created Backfill Review DB: ${dbId}`);

  let kept = 0;
  for (const c of raw) {
    // Vision first so image-only messages get a description the gate/enricher can use.
    let visualDescription: string | undefined;
    let imageUploadId: string | undefined;
    const imageUrl = c.imageUrls?.[0];
    if (imageUrl && visionEnabled) {
      const img = await slack.downloadImage(imageUrl);
      if (img) {
        visualDescription = (await vision.describe(img, channelName))?.description;
        imageUploadId = (await uploadImageToNotion(config.notionApiKey, img)) ?? undefined; // best-effort
      }
    }
    const gateInput = visualDescription
      ? (c.text.trim() ? `${c.text}\n\n[Attached screenshot shows: ${visualDescription}]` : `[Screenshot only. Shows: ${visualDescription}]`)
      : c.text;

    const verdict = await gate.classify(gateInput, channelName);
    if (!verdict?.isLikelyFeedback) continue; // high recall, but skip clear non-feedback
    kept++;

    const enrichment = await enricher.enrich(gateInput, channelName).catch(() => null);
    const [authorName, slackUrl] = await Promise.all([
      slack.resolveUserName(c.user),
      slack.getPermalink(CHANNEL_ID, c.ts),
    ]);

    await reviewDb.addCandidate(dbId, {
      channelId: CHANNEL_ID,
      messageTs: c.ts,
      message: c.text,
      authorName,
      dateIso: new Date(Number(c.ts) * 1000).toISOString().slice(0, 10),
      slackUrl,
      proposedCategory: enrichment?.category,
      proposedSummary: enrichment?.summary,
      visualDescription,
      gateConfidence: verdict.confidence,
      gateRationale: verdict.rationale,
      imageUploadId,
    });
    logger.info(`  + candidate ${c.ts} (${verdict.confidence})`);
  }

  logger.info(`Done. ${kept} candidate(s) written to the review DB. Review them in Notion, then run backfillCapture.`);
}

main().catch((err) => { console.error("Scan failed:", err?.body ?? err); process.exit(1); });
```

- [ ] **Step 3: Dry-run the scan**

Ensure `BACKFILL_REVIEW_PARENT_PAGE_ID` is set in `.env` (a Notion page shared with the integration). Then:
Run: `cd /c/Users/eddie/feedback-pipeline && npx tsx scripts/backfillScan.ts`
Expected: logs a candidate count, creates the review DB, writes `data/backfill-review.json`, and populates rows. Manually open the DB in Notion and confirm rows have message, proposed category/summary, rationale, confidence, Slack link (and image where upload succeeded).

- [ ] **Step 4: Commit**

```bash
git add src/config.ts scripts/backfillScan.ts
git commit -m "feat: backfillScan script — history -> gate -> preview -> review DB"
```

---

## Task 8: `backfillCapture` script (decisions → handleCapture → patch → :mega:)

**Files:**
- Create: `scripts/backfillCapture.ts`

**Interfaces:**
- Consumes: the full live `CaptureDeps` bundle (assembled exactly as `src/index.ts` does), `BackfillReviewDb.readDecisions`, `toCaptureRequest`, `correctionFor`, `NotionFeedbackWriter.updateClassification` (Task 9), `dedupKey`.

- [ ] **Step 1: Write the capture script**

```typescript
// scripts/backfillCapture.ts
import "dotenv/config";
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { consoleLogger as logger } from "../src/util/logger.js";
import { BoltSlackGateway } from "../src/adapters/slack/boltGateway.js";
import { NotionFeedbackWriter } from "../src/adapters/notion/notionWriter.js";
import { FileDedupStore } from "../src/adapters/dedup/fileStore.js";
import { ClaudeEnricher } from "../src/adapters/enricher/claudeEnricher.js";
import { NullEnricher } from "../src/adapters/enricher/nullEnricher.js";
import { ClaudeJudge } from "../src/adapters/judge/claudeJudge.js";
import { NullJudge } from "../src/adapters/judge/nullJudge.js";
import { ClaudeVisionReader } from "../src/adapters/vision/claudeVisionReader.js";
import { NullVisionReader } from "../src/adapters/vision/nullVisionReader.js";
import { handleCapture, dedupKey, type CaptureDeps } from "../src/core/handleCapture.js";
import { BackfillReviewDb } from "../src/backfill/reviewDb.js";
import { toCaptureRequest, correctionFor } from "../src/backfill/decisions.js";

const STATE_PATH = "./data/backfill-review.json";
const MEGA = "mega";

async function main() {
  const config = loadConfig();
  if (config.captureSink !== "notion" || !config.notionApiKey || !config.notionDatabaseId) {
    throw new Error("backfillCapture requires CAPTURE_SINK=notion with NOTION_API_KEY + NOTION_DATABASE_ID.");
  }
  const { reviewDatabaseId } = JSON.parse(readFileSync(STATE_PATH, "utf8")) as { reviewDatabaseId: string };

  const slack = new BoltSlackGateway(config.slackBotToken, logger);
  const botUserId = await slack.getBotUserId();
  const notion = new NotionFeedbackWriter(config.notionApiKey, config.notionDatabaseId);
  const dedup = new FileDedupStore(config.dedupStorePath);
  const deps: CaptureDeps = {
    slack, notion, dedup, logger, source: "Slack", botUserId,
    enricher: config.anthropicApiKey ? new ClaudeEnricher(config.anthropicApiKey) : new NullEnricher(),
    judge: config.anthropicApiKey ? new ClaudeJudge(config.anthropicApiKey) : new NullJudge(),
    vision: config.anthropicApiKey ? new ClaudeVisionReader(config.anthropicApiKey) : new NullVisionReader(),
    visionEnabledChannelIds: new Set(config.visionEnabledChannelIds),
  };
  const triggeredBy = config.backfillFlaggedByUserId ?? botUserId;

  const reviewDb = new BackfillReviewDb(config.notionApiKey);
  const decisions = await reviewDb.readDecisions(reviewDatabaseId);
  logger.info(`${decisions.length} confirmed feedback row(s) to capture.`);

  let captured = 0, patched = 0, marked = 0;
  for (const d of decisions) {
    if (!d.channelId || !d.messageTs) { logger.warn("Row missing Channel ID / Message TS — skipping", { d }); continue; }
    const req = toCaptureRequest(d, triggeredBy);
    const result = await handleCapture(req, deps);
    if (result.status !== "captured" && result.status !== "flagger_added") {
      logger.warn(`Capture ${result.status} for ${d.messageTs}`, { detail: result.detail }); continue;
    }
    captured++;

    // Patch the human's correction onto the created page (frozen AI Suggested Category is left intact).
    const correction = correctionFor(d);
    const pageId = dedup.getPageId(dedupKey(req));
    if (correction && pageId) { await notion.updateClassification(pageId, correction); patched++; }

    // Add the visible :mega: marker to the original Slack message.
    await slack.addReaction(d.channelId, d.messageTs, MEGA);
    marked++;
  }
  dedup.close();
  logger.info(`Done. captured=${captured} patched=${patched} mega_marked=${marked}`);
}

main().catch((err) => { console.error("Capture failed:", err?.body ?? err); process.exit(1); });
```

- [ ] **Step 2: Dry-run readiness check (no captures yet)**

Temporarily confirm parsing by running with an empty confirmation set (don't tick any rows yet):
Run: `cd /c/Users/eddie/feedback-pipeline && npx tsx scripts/backfillCapture.ts`
Expected: `0 confirmed feedback row(s) to capture.` then `captured=0 patched=0 mega_marked=0`. Proves state-file + Notion read work before any real write.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfillCapture.ts
git commit -m "feat: backfillCapture script — confirmed rows -> handleCapture -> patch -> mega"
```

---

## Task 9: `updateClassification` on the Notion writer (TDD-lite via typecheck + live patch)

**Files:**
- Modify: `src/adapters/notion/notionWriter.ts`

**Interfaces:**
- Produces: `NotionFeedbackWriter.updateClassification(pageId: string, patch: { category?: FeedbackCategory; summary?: string }): Promise<void>`. Consumed by `scripts/backfillCapture.ts`.

- [ ] **Step 1: Add the method**

Add inside the `NotionFeedbackWriter` class (after `appendFlagger`), and add `FeedbackCategory` to the type import at the top (`import type { NotionWriter, FeedbackRecord, FeedbackCategory } from "../../core/ports.js";`):

```typescript
  /**
   * Backfill-only: overwrite the human-editable Category / Summary on an existing row.
   * Leaves "AI Suggested Category" untouched so the AI's original call stays diffable.
   */
  async updateClassification(
    pageId: string,
    patch: { category?: FeedbackCategory; summary?: string },
  ): Promise<void> {
    const properties: Record<string, any> = {};
    if (patch.category) properties["Category"] = { select: { name: patch.category } };
    if (patch.summary) properties["Summary"] = { rich_text: [{ text: { content: patch.summary.slice(0, MAX_TEXT) } }] };
    if (Object.keys(properties).length === 0) return;
    await this.client.pages.update({ page_id: pageId, properties });
  }
```

- [ ] **Step 2: Typecheck the whole project**

Run: `cd /c/Users/eddie/feedback-pipeline && npx tsc --noEmit`
Expected: no errors across all new + modified files.

- [ ] **Step 3: Run the full unit-test suite**

Run: `cd /c/Users/eddie/feedback-pipeline && node --import tsx --test src/backfill/filter.test.ts src/backfill/decisions.test.ts src/core/handleCapture.test.ts`
Expected: all pass (existing handleCapture tests unaffected + new filter/decisions tests green).

- [ ] **Step 4: Commit**

```bash
git add src/adapters/notion/notionWriter.ts
git commit -m "feat: add updateClassification for backfill corrections"
```

---

## Task 10: End-to-end live run (human-in-the-loop)

**Files:** none (operational).

- [ ] **Step 1:** Stop the live Socket Mode bot (so a self-reaction can't double-fire).
- [ ] **Step 2:** Run `npx tsx scripts/backfillScan.ts`. Confirm the Backfill Review DB fills with candidates.
- [ ] **Step 3:** In Notion, review each row: tick **Is Feedback?**, tick/untick **Classification OK?**, set **Corrected Category** / **Corrected Summary** / **Correction Notes** where wrong.
- [ ] **Step 4:** Run `npx tsx scripts/backfillCapture.ts`. Confirm the log's `captured/patched/mega_marked` counts match expectations.
- [ ] **Step 5:** Spot-check in the live "Customer Feedback" DB: rows exist, corrected ones show the human category/summary while `AI Suggested Category` holds the original. Spot-check Slack: confirmed messages now carry `:mega:`.
- [ ] **Step 6:** Restart the live bot.

---

## Task 11: Gold-set export (turns the review DB into a reusable eval/tuning dataset)

**Why:** The review DB accumulates `(message, AI proposal, human verdict, human correction)` — a labelled dataset for measuring and improving the gate/enricher/judge. This task makes it a durable, re-runnable artifact so the bot can actually be *improved and updated* from real human judgements, not just captured once. It reads ALL rows (not only confirmed ones — the rejected rows are the gate's false positives, which are the most valuable signal).

**Files:**
- Create: `scripts/backfillExportGoldSet.ts`

**Interfaces:**
- Consumes: `BackfillReviewDb` (add `readAllRows(dbId)` — see Step 1), `loadConfig`.
- Produces: `data/gold-set.jsonl` — one JSON object per reviewed candidate.

- [ ] **Step 1: Add `readAllRows` to `BackfillReviewDb` (`src/backfill/reviewDb.ts`)**

```typescript
  /** Read EVERY reviewed row (confirmed + rejected) as raw label records for eval. */
  async readAllRows(dbId: string): Promise<Array<Record<string, any>>> {
    const rows: Array<Record<string, any>> = [];
    let cursor: string | undefined;
    do {
      const res = await this.client.databases.query({ database_id: dbId, start_cursor: cursor });
      for (const page of res.results as any[]) {
        const p = page.properties;
        const txt = (k: string) => p[k]?.rich_text?.[0]?.plain_text ?? p[k]?.title?.[0]?.plain_text ?? "";
        rows.push({
          channelId: txt("Channel ID"),
          messageTs: txt("Message TS"),
          message: txt("Message"),
          gateConfidence: p["Gate Confidence"]?.select?.name ?? null,
          gateRationale: txt("Gate Rationale"),
          proposedCategory: p["Proposed Category"]?.select?.name ?? null,
          proposedSummary: txt("Proposed Summary"),
          isFeedback: !!p["Is Feedback?"]?.checkbox,
          classificationOk: !!p["Classification OK?"]?.checkbox,
          correctedCategory: p["Corrected Category"]?.select?.name ?? null,
          correctedSummary: txt("Corrected Summary"),
          correctionNotes: txt("Correction Notes"),
        });
      }
      cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
    } while (cursor);
    return rows;
  }
```

- [ ] **Step 2: Write the export script**

```typescript
// scripts/backfillExportGoldSet.ts
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { BackfillReviewDb } from "../src/backfill/reviewDb.js";

const STATE_PATH = "./data/backfill-review.json";
const OUT_PATH = "./data/gold-set.jsonl";

async function main() {
  const config = loadConfig();
  if (!config.notionApiKey) throw new Error("NOTION_API_KEY required.");
  const { reviewDatabaseId } = JSON.parse(readFileSync(STATE_PATH, "utf8")) as { reviewDatabaseId: string };

  const rows = await new BackfillReviewDb(config.notionApiKey).readAllRows(reviewDatabaseId);
  writeFileSync(OUT_PATH, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const labelled = rows.filter((r) => r.isFeedback || r.classificationOk !== undefined).length;
  const gateFalsePositives = rows.filter((r) => !r.isFeedback).length;
  console.log(`✅ Exported ${rows.length} reviewed rows to ${OUT_PATH}`);
  console.log(`   ${labelled} human-labelled; ${gateFalsePositives} gate false-positive(s) (highest-value signal for tuning the gate prompt).`);
}

main().catch((err) => { console.error("Export failed:", err?.body ?? err); process.exit(1); });
```

- [ ] **Step 3: Typecheck**

Run: `cd /c/Users/eddie/feedback-pipeline && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/backfill/reviewDb.ts scripts/backfillExportGoldSet.ts
git commit -m "feat: export backfill review DB as a gold-set JSONL for eval/prompt tuning"
```

**How this improves + updates the bot:** re-run this after each review pass to grow `data/gold-set.jsonl`. The `isFeedback=false` rows are gate false-positives and the `classificationOk=false` rows are enricher/judge misses — feed both into the eval/gold-set work (`ENRICHMENT-RESEARCH-BRIEF.md` §9) to measure accuracy and tune the `FeedbackGate` / enricher prompts over time. The review DB is the source of truth; **do not delete it between runs.**

## Self-Review

**Spec coverage (vs `BACKFILL-AGENT-BRIEF.md` + grill decisions):**
- History scanner (§4.1) → Task 4. ✅
- "Likely feedback?" gate as new `FeedbackGate` port mirroring `ClaudeJudge` (§4.2) → Task 1. ✅
- Vision reuse for image-only feedback (§4.3) → Task 7 (vision-first, feeds gate + enricher). ✅
- Present candidates for selection (§4.4) → review DB (Tasks 5/6) — decision: **Notion review database**. ✅
- Confirmed → capture (§4.5): decision **direct `handleCapture`** (not fire-a-reaction) → Task 8; `:mega:` added as marker → Task 8. ✅
- Respect dedup (§4.6) → reused automatically via `handleCapture` + `FileDedupStore`; `pageId` retrieved via `dedup.getPageId` for patching. ✅
- Corrections land in Notion (grill decision) → Task 9 `updateClassification` + Task 8 wiring. ✅
- Images: description + link always, embed where upload works (grill decision) → Tasks 5/6 (best-effort upload, link fallback). ✅
- High recall (grill decision) → Task 1 prompt bias. ✅
- Channel scope test-only, 4 months, incl. threads (constraints) → Task 7 (`CHANNEL_ID` const, `MONTHS_BACK`, thread replies in Task 4). ✅
- Phase A fields absent (verified) → no auto-set needed; noted. ✅
- Missing `AI Suggested Category` (verified defect blocking capture) → Task 0. ✅
- "Improve the bot / allow it to be updated" (Eddie): confirmed items build up the live DB (Task 8) + review DB becomes a durable, re-runnable gold set (Task 11). ✅

**Placeholder scan:** No TBD/TODO; every code step is complete.

**Type consistency:** `FeedbackGateResult`, `ReviewDecision`, `ReviewRowInput`, `correctionFor`, `toCaptureRequest`, `updateClassification`, `scanChannelHistory`, `isScannable` names are consistent across producing/consuming tasks.

**Known runtime risk carried deliberately:** Notion `fileUploads` API shape (Task 6) is unproven — isolated behind a `null`-returning helper with a link fallback, spiked in Task 6 Step 2. `(slack as any)["client"]` in Task 7 reaches the private `WebClient`; acceptable for a backfill script, or add a public getter on `BoltSlackGateway` if preferred.
</content>
</invoke>
