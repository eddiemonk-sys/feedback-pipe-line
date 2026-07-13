# W1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the gold standard dataset, reasoning distillation, updated taxonomy + schema (multi-category), versioned prompt scaffolding, and eval baseline — everything W2/W3/W4 depend on.

**Architecture:** Three phases: (A) gold set CSV + reasoning distillation; (B) core type changes + Notion schema migration + dedup update + handleCapture wiring; (C) versioned prompt system + eval infra. All phases must complete before W2/W3 start.

**Tech Stack:** TypeScript/Node ESM, `tsx` (no build), Anthropic SDK (claude-haiku-4-5-20251001), `@notionhq/client`, node:fs, node:http. Test runner: `node --import tsx --test`. No new dependencies.

## Global Constraints

- All imports use `.js` specifiers even for `.ts` source files (ESM NodeNext)
- No build step — scripts run via `npx tsx`
- Every AI adapter method returns `null` on error, never throws (fail-open)
- No vendor SDK imports in `src/core/`
- Only unit-test pure logic in `src/core/` and `src/liveGate/`; adapters are not unit-tested
- `data/gold-set.csv` and `data/eval-results/` are gitignored (contain customer text)
- Taxonomy lives in `src/core/taxonomy.ts` — never hardcode category strings elsewhere
- Model: `claude-haiku-4-5-20251001` — do not change without updating all adapter constants
- `.env` is gitignored; update `.env.example` for any new env var

---

## Task 1: Gold Set CSV Export

**Files:**
- Modify: `scripts/backfillExportGoldSet.ts`
- Create: `data/gold-set.csv` (gitignored — verify `.gitignore` has `data/gold-set.csv`)

**Interfaces:**
- Consumes: Backfill Review DB via `BackfillReviewDb.readAllRows()` — returns `BackfillReviewRow[]`
- Produces: `data/gold-set.csv` with columns: `pageId,message,is_feedback,gate_confidence,proposed_category,proposed_summary,corrected_category,corrected_summary,classification_ok,eddie_notes,enriched_rationale`

- [ ] **Step 1: Check `.gitignore` covers the CSV**

Open `.gitignore` and verify `data/gold-set.csv` (or `data/*.csv`) is present. If not, add `data/gold-set.csv`.

- [ ] **Step 2: Read the current `BackfillReviewRow` shape**

In `src/backfill/reviewDb.ts`, find `readAllRows()` and inspect the `BackfillReviewRow` interface it returns. The key fields we need: `pageId`, `message`, `isFeedback`, `gateConfidence`, `proposedCategory`, `proposedSummary`, `correctedCategory`, `correctedSummary`, `classificationOk`, `correctionNotes`.

- [ ] **Step 3: Replace `backfillExportGoldSet.ts` with CSV output**

```typescript
// scripts/backfillExportGoldSet.ts
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { BackfillReviewDb } from "../src/backfill/reviewDb.js";

const STATE_PATH = "./data/backfill-review.json";
const OUT_PATH = "./data/gold-set.csv";

function csvCell(v: string | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cells: (string | boolean | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}

async function main() {
  const config = loadConfig();
  if (!config.notionApiKey) throw new Error("NOTION_API_KEY required.");
  const { reviewDatabaseId } = JSON.parse(readFileSync(STATE_PATH, "utf8")) as { reviewDatabaseId: string };

  const rows = await new BackfillReviewDb(config.notionApiKey).readAllRows(reviewDatabaseId);

  const header = csvRow([
    "pageId","message","is_feedback","gate_confidence",
    "proposed_category","proposed_summary","corrected_category",
    "corrected_summary","classification_ok","eddie_notes","enriched_rationale",
  ]);

  const lines = rows.map((r) =>
    csvRow([
      r.pageId,
      r.message,
      r.isFeedback ?? null,
      r.gateConfidence ?? null,
      r.proposedCategory ?? null,
      r.proposedSummary ?? null,
      r.correctedCategory ?? null,
      r.correctedSummary ?? null,
      r.classificationOk ?? null,
      r.correctionNotes ?? null,
      "", // enriched_rationale — filled by distillation script
    ])
  );

  writeFileSync(OUT_PATH, [header, ...lines].join("\n") + "\n");

  const labelled = rows.filter((r) => r.isFeedback !== undefined).length;
  const gateFP = rows.filter((r) => r.isFeedback === false).length;
  console.log(`Exported ${rows.length} rows to ${OUT_PATH}`);
  console.log(`  ${labelled} human-labelled, ${gateFP} gate false-positives`);
}

main().catch((err) => { console.error("Export failed:", err?.body ?? err); process.exit(1); });
```

Note: if `BackfillReviewRow` uses different field names than above (e.g. `notes` instead of `correctionNotes`), use the actual field names from the interface — do NOT rename them.

- [ ] **Step 4: Run the export**

```
npx tsx scripts/backfillExportGoldSet.ts
```

Expected: `data/gold-set.csv` created with 95 rows + header.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfillExportGoldSet.ts .gitignore
git commit -m "feat(gold-set): export Backfill Review to CSV with enriched_rationale column"
```

---

## Task 2: Reasoning Distillation Script

**Files:**
- Create: `scripts/distillGoldSetRationale.ts`
- Modify: `data/gold-set.csv` (adds enriched_rationale, marks ambiguous rows)

**Interfaces:**
- Consumes: `data/gold-set.csv`
- Produces: `data/gold-set.csv` updated with `enriched_rationale` column; prints list of `pageId`s that need Eddie's annotation (notes too sparse to reason from)

**Gold set encoding — read this before writing the script:**

The structured `corrected_category` and `corrected_summary` columns are nearly empty (0 and 2 entries respectively). The actual corrections and reasoning are almost all in the free-text `correction_notes` field — read and parse **every** `correction_notes` entry; that's where the real signal is.

Column encoding rules:
- `is_feedback=true` + `classification_ok=true` + `corrected_category` empty → proposed category was CORRECT; `correction_notes` may still contain summary tweaks or nuances.
- `is_feedback=true` + `classification_ok=false` OR `corrected_category` filled → category needs correction; `correction_notes` explains why.
- `is_feedback=false` → gate false positive; `correction_notes` explains what made it look like feedback but wasn't.

The distillation agent must read `correction_notes` first and use it as the primary reasoning source. The structured fields are secondary confirmation.

- [ ] **Step 1: Write the distillation script**

```typescript
// scripts/distillGoldSetRationale.ts
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const CSV_PATH = "./data/gold-set.csv";
const MODEL = "claude-haiku-4-5-20251001";

// Minimal RFC4180 CSV parser. Handles quoted fields (double-quote escaping).
function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n?/g, "\n").trim().split("\n");
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const cells = parseCSVLine(l);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
  return { headers, rows };
}

function parseCSVLine(line: string): string[] {
  const cells: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let cell = "";
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { cell += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { cell += line[i++]; }
      }
      cells.push(cell);
      if (line[i] === ",") i++;
    } else {
      const end = line.indexOf(",", i);
      cells.push(end === -1 ? line.slice(i) : line.slice(i, end));
      i = end === -1 ? line.length : end + 1;
    }
  }
  return cells;
}

function csvCell(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function serializeCSV(headers: string[], rows: Record<string, string>[]): string {
  const headerLine = headers.map(csvCell).join(",");
  const dataLines = rows.map((r) => headers.map((h) => csvCell(r[h] ?? "")).join(","));
  return [headerLine, ...dataLines].join("\n") + "\n";
}

const SYSTEM_PROMPT = `You are a reasoning distillation agent for a feedback pipeline.

You will be given a Slack message and a human reviewer's verdict. Your job is to write a clear, full principle explaining WHY the reviewer made their decision — one that a future AI can use as a rule.

## Gold set encoding — understand this first:

The CORRECTION_NOTES field is the primary signal. It contains free-text reasoning, category corrections, summary tweaks, and nuances. The structured corrected_category and corrected_summary fields are nearly empty (most corrections are in the notes). Read correction_notes FIRST.

- is_feedback=true + classification_ok=true + corrected_category empty → proposed category was correct; check correction_notes for any summary nuances.
- is_feedback=true + corrected_category filled OR classification_ok=false → the category was wrong; correction_notes explains the correct reasoning.
- is_feedback=false → gate false positive; correction_notes explains what signals made it look like feedback but wasn't.

## Rules for your rationale:
- Eddie's verdict is FINAL. Articulate the reasoning behind it, never question it.
- For false positives (is_feedback=false): explain exactly what signals identify this as NOT customer feedback. Be specific to THIS message.
- For true positives (is_feedback=true): confirm why it IS feedback and what the correct category is.
- Incorporate everything in correction_notes — that's the authoritative source.
- 2-4 sentences max. Specific to this message, not generic.
- Do not invent signals not present in the message or notes.

Set needs_annotation=true ONLY for feedback rows (is_feedback=true) where correction_notes is completely empty or contains only "yes"/"no" — meaning there is genuinely no reasoning to distill. Non-feedback rows with empty notes are fine (the message itself explains why it's not feedback).`;

async function distillRow(
  client: Anthropic,
  row: Record<string, string>,
): Promise<{ rationale: string; needsAnnotation: boolean }> {
  const isFeedback = row["is_feedback"] === "true";
  const classificationOk = row["classification_ok"] === "true";
  const correctionNotes = row["correction_notes"]?.trim() || "";

  const prompt = `Message: ${row["message"] || "(none)"}
is_feedback: ${row["is_feedback"]}
classification_ok: ${row["classification_ok"] || "(not set — not applicable for non-feedback rows)"}
proposed_category: ${row["proposed_category"] || "(none)"}
corrected_category: ${row["corrected_category"] || "(empty — see correction_notes or classification_ok)"}
corrected_summary: ${row["corrected_summary"] || "(empty)"}
correction_notes: ${correctionNotes || "(empty)"}`;

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 384,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
      tools: [
        {
          name: "submit_rationale",
          input_schema: {
            type: "object" as const,
            properties: {
              rationale: { type: "string" },
              needs_annotation: { type: "boolean" },
            },
            required: ["rationale", "needs_annotation"],
          },
          description: "Submit the distilled rationale",
        },
      ],
      tool_choice: { type: "tool", name: "submit_rationale" },
    });
    const toolUse = res.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return { rationale: "", needsAnnotation: true };
    const input = toolUse.input as { rationale: string; needs_annotation: boolean };
    return { rationale: input.rationale ?? "", needsAnnotation: !!input.needs_annotation };
  } catch {
    return { rationale: "", needsAnnotation: true };
  }
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY required.");

  const client = new Anthropic({ apiKey });
  const text = readFileSync(CSV_PATH, "utf8");
  const { headers, rows } = parseCSV(text);

  if (!headers.includes("enriched_rationale")) throw new Error("CSV missing enriched_rationale column. Run backfillExportGoldSet first.");

  // Only process rows that don't already have a rationale
  const toProcess = rows.filter((r) => !r["enriched_rationale"]?.trim());
  console.log(`Processing ${toProcess.length} rows (${rows.length - toProcess.length} already done)...`);

  const flaggedPageIds: string[] = [];
  let done = 0;

  for (const row of toProcess) {
    const { rationale, needsAnnotation } = await distillRow(client, row);
    // Only flag feedback rows — non-feedback rows with empty notes are fine (message speaks for itself)
    const shouldFlag = needsAnnotation && row["is_feedback"] === "true";
    if (shouldFlag) {
      flaggedPageIds.push(row["pageId"]);
      row["enriched_rationale"] = ""; // leave blank — needs Eddie's annotation
    } else {
      row["enriched_rationale"] = rationale;
    }
    done++;
    if (done % 10 === 0) console.log(`  ${done}/${toProcess.length}`);
  }

  writeFileSync(CSV_PATH, serializeCSV(headers, rows));
  console.log(`\nDone. enriched_rationale written for ${done - flaggedPageIds.length} rows.`);

  if (flaggedPageIds.length > 0) {
    console.log(`\n⚠️  ${flaggedPageIds.length} feedback rows need Eddie's annotation (correction_notes too sparse to distill):`);
    for (const id of flaggedPageIds) console.log(`  pageId: ${id}`);
    console.log("\nFor each flagged pageId, open the Backfill Review DB in Notion and add a brief Correction Notes entry explaining the category/summary decision, then re-run this script.");
  }
}

main().catch((err) => { console.error("Distillation failed:", err); process.exit(1); });
```

- [ ] **Step 2: Run the distillation (requires gold set CSV from Task 1 + ANTHROPIC_API_KEY)**

```
npx tsx scripts/distillGoldSetRationale.ts
```

Expected: console prints progress in batches of 10. Final line shows enriched count and any flagged pageIds. Re-run after Eddie adds notes to flagged rows.

- [ ] **Step 3: Commit**

```bash
git add scripts/distillGoldSetRationale.ts
git commit -m "feat(gold-set): reasoning distillation script for backfill rationale enrichment"
```

---

## Task 3: Taxonomy + Core Type Updates

**Files:**
- Modify: `src/core/taxonomy.ts` — add 11th category
- Modify: `src/core/ports.ts` — multi-category types, `DedupStore.delete`, `DedupStore.findKeyByPageId`, `Judge.review` multi-category signature, `NotionWriter.findRecentByCategories`, `SimilarityDetector.findSimilar` multi-category, `FeedbackRecord` multi-category fields, `EnrichmentResult` multi-category
- Modify: `src/core/handleCapture.test.ts` — update mock shapes to match new interfaces

**Interfaces:**
- Produces (used by W2, W3, W4): `FeedbackCategory` includes `"Compliance / Legal / Governance"`; `EnrichmentResult.categories: FeedbackCategory[]`; `FeedbackRecord.categories?: FeedbackCategory[]`

- [ ] **Step 1: Write a failing typecheck before making changes**

```bash
npx tsc --noEmit
```

Record any existing errors. All changes should not increase the error count.

- [ ] **Step 2: Update `src/core/taxonomy.ts`**

```typescript
import type { FeedbackCategory } from "./ports.js";

export const CATEGORIES: FeedbackCategory[] = [
  "Bug / Broken",
  "Feature Request",
  "Pricing / Commercial",
  "Onboarding / Setup",
  "UX / Usability",
  "Reporting / Data",
  "Praise",
  "Other",
  "Candidate Experience",
  "Assessment Accuracy/Validity",
  "Compliance / Legal / Governance",
];
```

- [ ] **Step 3: Update `src/core/ports.ts` — add 11th category to `FeedbackCategory`**

Add `"Compliance / Legal / Governance"` to the `FeedbackCategory` union type:

```typescript
export type FeedbackCategory =
  | "Bug / Broken"
  | "Feature Request"
  | "Pricing / Commercial"
  | "Onboarding / Setup"
  | "UX / Usability"
  | "Reporting / Data"
  | "Praise"
  | "Other"
  | "Candidate Experience"
  | "Assessment Accuracy/Validity"
  | "Compliance / Legal / Governance";
```

- [ ] **Step 4: Update `FeedbackRecord` in `ports.ts`**

Replace the single-category fields with multi-category arrays. Also add `status` for live-gate routing:

```typescript
export interface FeedbackRecord {
  message: string;
  channelName: string;
  authorName: string;
  dateIso: string;
  flaggedByName: string;
  source: string;
  messageUrl: string;
  customerAccount: string;
  summary?: string;
  /** AI-assigned categories (1–2 items). Absent when enrichment disabled or failed. */
  categories?: FeedbackCategory[];
  /** Frozen AI copy — never edited after initial write. */
  aiSuggestedCategories?: FeedbackCategory[];
  aiSuggestedSummary?: string;
  confidence?: ConfidenceLevel;
  rationale?: string;
  visualDescription?: string;
  image?: ImageAttachment;
  relatedFeedbackPageId?: string;
  relatedFeedbackRationale?: string;
  /** Initial Notion Status. Defaults to "New". Live gate sets "Needs Review" for medium/low confidence. */
  status?: "New" | "Needs Review";
}
```

- [ ] **Step 5: Update `EnrichmentResult` in `ports.ts`**

```typescript
export interface EnrichmentResult {
  summary: string;
  /** 1–2 categories. Never empty. */
  categories: FeedbackCategory[];
}
```

- [ ] **Step 6: Update `Judge.review` in `ports.ts`**

```typescript
export interface Judge {
  review(
    originalMessage: string,
    channelName: string,
    summary: string,
    categories: FeedbackCategory[],
  ): Promise<JudgeVerdict | null>;
}
```

- [ ] **Step 7: Update `NotionWriter.findRecentByCategories` in `ports.ts`**

Replace `findRecentByCategory` with a multi-category version:

```typescript
export interface NotionWriter {
  createFeedback(record: FeedbackRecord): Promise<string>;
  appendFlagger(pageId: string, newFlaggerName: string): Promise<void>;
  /** Recent rows in any of the given categories, for similarity comparison. */
  findRecentByCategories(categories: FeedbackCategory[], sinceDateIso: string): Promise<Array<{ pageId: string; summary: string }>>;
}
```

- [ ] **Step 8: Update `SimilarityDetector.findSimilar` in `ports.ts`**

```typescript
export interface SimilarityDetector {
  findSimilar(
    summary: string,
    categories: FeedbackCategory[],
    candidates: Array<{ pageId: string; summary: string }>,
  ): Promise<SimilarMatch | null>;
}
```

- [ ] **Step 9: Update `DedupStore` in `ports.ts`**

Add `delete` and `findKeyByPageId`:

```typescript
export interface DedupStore {
  has(key: string): boolean;
  record(key: string, pageId: string): void;
  getPageId(key: string): string | null;
  /** Remove a key from the store (used when a "Not Feedback" verdict deletes a row). */
  delete(key: string): void;
  /** Find the dedup key associated with a Notion page ID. Returns null if not found. */
  findKeyByPageId(pageId: string): string | null;
  close(): void;
}
```

- [ ] **Step 10: Update `handleCapture.test.ts` mock shapes**

The mock `notion.findRecentByCategory` becomes `notion.findRecentByCategories`. The mock `judge.review` now receives `categories: FeedbackCategory[]` instead of `category: FeedbackCategory`. The mock `dedup` needs `delete` and `findKeyByPageId`:

In `src/core/handleCapture.test.ts`, find the `deps` object and update:

```typescript
dedup: {
  has: (k) => store.has(k),
  record: (k, pageId) => { store.set(k, pageId); },
  getPageId: (k) => store.get(k) ?? null,
  delete: (k) => { store.delete(k); },
  findKeyByPageId: (pageId) => {
    for (const [k, v] of store) { if (v === pageId) return k; }
    return null;
  },
  close: () => {},
},
notion: {
  createFeedback: async (r) => {
    writes.push(r);
    return "page_001";
  },
  appendFlagger: async (pageId, name) => {
    appendedFlaggers.push({ pageId, name });
  },
  findRecentByCategories: async (categories, sinceDateIso) => {
    recentByCategoryCalls.push({ categories, sinceDateIso });
    return recentCandidates;
  },
},
```

Also update the judge mock in the `deps` object:

```typescript
judge: {
  review: async (originalMessage, channelName, summary, categories) => {
    judgeCalls.push({ originalMessage, channelName, summary, categories });
    return { confidence: "High", rationale: "looks good" };
  },
},
```

Update the type annotation for `recentByCategoryCalls`:

```typescript
const recentByCategoryCalls: Array<{ categories: FeedbackCategory[]; sinceDateIso: string }> = [];
```

And update the `judgeCalls` type:

```typescript
const judgeCalls: Array<{ originalMessage: string; channelName: string; summary: string; categories: FeedbackCategory[] }> = [];
```

- [ ] **Step 11: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: errors in adapters that use the old interfaces (notionWriter, claudeEnricher, claudeJudge, claudeSimilarityDetector). These are fixed in the next tasks.

- [ ] **Step 12: Run tests (will also fail until adapters updated — record which ones fail)**

```bash
npm test
```

- [ ] **Step 13: Commit the port + taxonomy changes**

```bash
git add src/core/taxonomy.ts src/core/ports.ts src/core/handleCapture.test.ts
git commit -m "feat(ports): multi-category types, 11th taxonomy category, DedupStore.delete"
```

---

## Task 4: Update NotionWriter

**Files:**
- Modify: `src/adapters/notion/notionWriter.ts`

**Interfaces:**
- Consumes: updated `FeedbackRecord` (categories[], aiSuggestedCategories[], status?) and `NotionWriter` port (findRecentByCategories)
- Produces: writes `"Categories"` multi-select and `"AI Suggested Categories"` multi-select to Notion; writes `Status` from `r.status ?? "New"`

**Before starting:** The Notion "Customer Feedback" DB needs these properties added manually (do this in Notion UI before running any code that writes to it):
- `"Categories"` — multi-select, same 11 options as the `FeedbackCategory` union
- `"AI Suggested Categories"` — multi-select, same 11 options
- `"Gate Verdict"` — select, options: `"Confirmed"` / `"Not Feedback"`

Leave the old `"Category"` and `"AI Suggested Category"` single-select fields in place — the migration script (Task 8) will copy from them and then they can be archived.

- [ ] **Step 1: Update `createFeedback` to write multi-select categories and `status`**

In `notionWriter.ts`, find the `createFeedback` method and replace the `category`/`aiSuggestedCategory` spreads:

```typescript
// Replace the two old category spreads with these:
...(r.categories && r.categories.length > 0
  ? { Categories: { multi_select: r.categories.map((name) => ({ name })) } }
  : {}),
...(r.aiSuggestedCategories && r.aiSuggestedCategories.length > 0
  ? { "AI Suggested Categories": { multi_select: r.aiSuggestedCategories.map((name) => ({ name })) } }
  : {}),
```

Also update the `Status` property to use `r.status`:

```typescript
Status: { select: { name: r.status ?? "New" } },
```

Keep the old `Category` and `AI Suggested Category` single-select writes in place for now (they'll be removed after migration completes). Add them back as no-ops that write the primary category for backward compat during the migration window:

```typescript
// Migration shim — remove after migration script has run
...(r.categories && r.categories.length > 0
  ? { Category: { select: { name: r.categories[0] } } }
  : {}),
...(r.aiSuggestedCategories && r.aiSuggestedCategories.length > 0
  ? { "AI Suggested Category": { select: { name: r.aiSuggestedCategories[0] } } }
  : {}),
```

- [ ] **Step 2: Replace `findRecentByCategory` with `findRecentByCategories`**

```typescript
async findRecentByCategories(
  categories: FeedbackCategory[],
  sinceDateIso: string,
): Promise<Array<{ pageId: string; summary: string }>> {
  if (categories.length === 0) return [];

  const filter =
    categories.length === 1
      ? { property: "Categories", multi_select: { contains: categories[0] } }
      : {
          or: categories.map((cat) => ({
            property: "Categories",
            multi_select: { contains: cat },
          })),
        };

  const res: any = await this.client.databases.query({
    database_id: this.databaseId,
    filter: {
      and: [filter, { property: "Date", date: { on_or_after: sinceDateIso } }],
    },
    page_size: MAX_RECENT_CANDIDATES,
  });

  return res.results
    .map((page: any) => ({
      pageId: page.id as string,
      summary: (page.properties?.["Summary"]?.rich_text?.[0]?.plain_text as string) ?? "",
    }))
    .filter((c: { summary: string }) => c.summary);
}
```

Remove the old `findRecentByCategory` method entirely.

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: `notionWriter.ts` errors resolved. Errors may remain in `handleCapture.ts` and similarity adapter.

- [ ] **Step 4: Commit**

```bash
git add src/adapters/notion/notionWriter.ts
git commit -m "feat(notion): multi-select Categories write + findRecentByCategories + status routing"
```

---

## Task 5: Update FileDedupStore

**Files:**
- Modify: `src/adapters/dedup/fileStore.ts`

**Interfaces:**
- Produces: `DedupStore.delete(key)` and `DedupStore.findKeyByPageId(pageId)` implemented

- [ ] **Step 1: Add `delete` and `findKeyByPageId` to `FileDedupStore`**

After the existing `getPageId` method, add:

```typescript
delete(key: string): void {
  if (!this.store.has(key)) return;
  this.store.delete(key);
  this.flush();
}

findKeyByPageId(pageId: string): string | null {
  for (const [k, v] of this.store) {
    if (v === pageId) return k;
  }
  return null;
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: `FileDedupStore` satisfies `DedupStore` interface.

- [ ] **Step 3: Commit**

```bash
git add src/adapters/dedup/fileStore.ts
git commit -m "feat(dedup): add delete and findKeyByPageId for webhook-triggered row removal"
```

---

## Task 6: Update handleCapture

**Files:**
- Modify: `src/core/handleCapture.ts`

**Interfaces:**
- Consumes: updated `EnrichmentResult.categories[]`, updated `Judge.review(categories[])`, updated `NotionWriter.findRecentByCategories`, updated `SimilarityDetector.findSimilar(categories[])`
- Produces: passes `status` through to `createFeedback`; passes arrays throughout

- [ ] **Step 1: Update the `createFeedback` call in `handleCapture`**

Find the `notion.createFeedback({...})` call and update category fields:

```typescript
const pageId = await notion.createFeedback({
  message: text,
  channelName,
  authorName,
  dateIso,
  flaggedByName,
  source,
  messageUrl,
  customerAccount: "",
  summary: enrichment?.summary,
  categories: enrichment?.categories,
  aiSuggestedCategories: enrichment?.categories,
  aiSuggestedSummary: enrichment?.summary,
  confidence: verdict?.confidence,
  rationale: verdict?.rationale,
  visualDescription,
  image: image ?? undefined,
  relatedFeedbackPageId: relatedMatch?.matchedPageId,
  relatedFeedbackRationale: relatedMatch?.rationale,
  status: req.initialStatus,   // see Step 2
});
```

- [ ] **Step 2: Add `initialStatus` to `CaptureRequest` (in `src/core/events.ts`)**

```typescript
export type TriggerType = "mega_reaction" | "mention" | "live_gate";

export interface CaptureRequest {
  triggerType: TriggerType;
  channelId: string;
  messageTs: string;
  triggeredBy: string;
  /** Status to write on the Notion row. Defaults to "New". Live gate sets "Needs Review" for medium/low confidence. */
  initialStatus?: "New" | "Needs Review";
}
```

- [ ] **Step 3: Update the judge call in `handleCapture`**

```typescript
const verdict = enrichment
  ? await deps.judge
      .review(enrichmentInput, channelName, enrichment.summary, enrichment.categories)
      .catch((err) => {
        logger.warn("Judging failed — capturing without confidence/rationale", { err: String(err) });
        return null;
      })
  : null;
```

- [ ] **Step 4: Update `findRelatedFeedback` helper and call site**

The `findRelatedFeedback` call:

```typescript
const relatedMatch = enrichment
  ? await findRelatedFeedback(deps, enrichment.summary, enrichment.categories, logger)
  : null;
```

The `findRelatedFeedback` function signature:

```typescript
async function findRelatedFeedback(
  deps: CaptureDeps,
  summary: string,
  categories: import("./ports.js").FeedbackCategory[],
  logger: Logger,
): Promise<import("./ports.js").SimilarMatch | null> {
  try {
    const sinceDateIso = new Date(Date.now() - deps.similarityWindowDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const candidates = await deps.notion.findRecentByCategories(categories, sinceDateIso);
    if (candidates.length === 0) return null;
    return await deps.similarityDetector.findSimilar(summary, categories, candidates);
  } catch (err) {
    logger.warn("Similarity check failed — capturing without a related-feedback link", { err: String(err) });
    return null;
  }
}
```

- [ ] **Step 5: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: errors now only in adapters that use old interfaces (claudeJudge, claudeSimilarityDetector, localWriter, nullEnricher etc).

- [ ] **Step 6: Fix adapter stubs for the interfaces**

The `NullEnricher` in `src/adapters/enricher/nullEnricher.ts` returns `{ summary, category }` — update to `{ summary, categories: [category] }`. Similar for `LocalFeedbackWriter` if it reads `r.category`. The `NullJudge` takes the new `categories` param. The `ClaudeSimilarityDetector` takes the new `categories` param (pass them to the prompt).

For `NullEnricher` (update the stub return):

```typescript
// src/adapters/enricher/nullEnricher.ts — update enrich() to return correct shape
// change: return { summary: ..., category: ... }
// to:     return { summary: ..., categories: [...] }
```

For `NullJudge` — update the `review` signature to accept `categories: FeedbackCategory[]`:

```typescript
// src/adapters/judge/nullJudge.ts
async review(
  _originalMessage: string,
  _channelName: string,
  _summary: string,
  _categories: FeedbackCategory[],
): Promise<JudgeVerdict | null> { return null; }
```

For `ClaudeSimilarityDetector` — update `findSimilar` signature to accept `categories: FeedbackCategory[]` and include them in the prompt (pass as comma-joined string).

For `LocalFeedbackWriter` — update any `r.category` reference to `r.categories?.[0]`.

- [ ] **Step 7: Run typecheck + tests**

```bash
npx tsc --noEmit && npm test
```

Expected: zero typecheck errors, tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/core/handleCapture.ts src/core/events.ts src/adapters/enricher/nullEnricher.ts src/adapters/judge/nullJudge.ts src/adapters/similarity/claudeSimilarityDetector.ts src/adapters/notion/localWriter.ts
git commit -m "feat(capture): wire multi-category through handleCapture and all adapters"
```

---

## Task 7: AccuracyReport + CorrectionLog Type Updates

**Files:**
- Modify: `src/core/accuracyReport.ts`
- Modify: `src/core/correctionLog.ts`
- Modify: `src/core/accuracyReport.test.ts`
- Modify: `src/core/correctionLog.test.ts`

**Interfaces:**
- Produces: `ReviewedRow.categories[]`, `ReviewedRow.aiSuggestedCategories[]`, `CorrectionRow.categories[]`, `CorrectionRow.aiSuggestedCategories[]`. Agreement = arrays are identical sets (order-independent).

- [ ] **Step 1: Update `ReviewedRow` in `accuracyReport.ts`**

```typescript
export interface ReviewedRow {
  /** Human-confirmed categories (may differ from AI suggestion). */
  categories: FeedbackCategory[];
  /** AI's original suggestion — frozen at write time. */
  aiSuggestedCategories: FeedbackCategory[];
  categoryReviewed: boolean;
  summaryVerdict: SummaryVerdict;
  confidence: ConfidenceLevel | null;
}
```

- [ ] **Step 2: Update `computeAccuracyReport` to compare category arrays**

The "category agreement" check. Replace the old `r.category === r.aiSuggestedCategory` comparison:

```typescript
function categoriesMatch(a: FeedbackCategory[], b: FeedbackCategory[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((c) => setA.has(c));
}
```

Use `categoriesMatch(r.categories, r.aiSuggestedCategories)` everywhere `r.category === r.aiSuggestedCategory` was used.

For `CategoryConfusion` (from/to single FeedbackCategory), compare primary (first) category only for confusion analysis:

```typescript
const primaryHuman = r.categories[0];
const primaryAI = r.aiSuggestedCategories[0];
if (primaryHuman && primaryAI && !categoriesMatch(r.categories, r.aiSuggestedCategories)) {
  const key = `${primaryAI} -> ${primaryHuman}`;
  // ... existing confusion counting
}
```

For `CategoryCoverage`, use primary category for existing coverage bucketing.

- [ ] **Step 3: Update `CorrectionRow` in `correctionLog.ts`**

```typescript
export interface CorrectionRow {
  pageId: string;
  message: string;
  categories: FeedbackCategory[] | null;
  aiSuggestedCategories: FeedbackCategory[] | null;
  categoryReviewed: boolean;
  summary: string | null;
  aiSuggestedSummary: string | null;
  summaryVerdict: SummaryVerdict;
  relatedVerdict: RelatedVerdict;
  relatedMatchedSummary: string | null;
  relatedRationale: string | null;
}
```

- [ ] **Step 4: Update `detectEnricherCorrections` in `correctionLog.ts`**

The `EnricherCorrection.category` field stays as `FeedbackCategory` (primary) for backward compat in the distillation output. Update the detection logic:

```typescript
// Category correction: primary category changed
const primaryHuman = r.categories?.[0];
const primaryAI = r.aiSuggestedCategories?.[0];
if (r.categoryReviewed && primaryAI && primaryHuman && primaryHuman !== primaryAI) {
  out.push({
    pageId: r.pageId,
    kind: "category",
    category: primaryHuman,
    message: r.message,
    before: primaryAI,
    after: primaryHuman,
  });
}
```

- [ ] **Step 5: Update the Notion-reading scripts that populate these types**

`scripts/accuracyReport.ts` and `scripts/correctionLog.ts` query Notion and populate `ReviewedRow[]` / `CorrectionRow[]`. Update them to read `"Categories"` multi-select (instead of `"Category"` select) and `"AI Suggested Categories"` multi-select (instead of `"AI Suggested Category"` select).

In the Notion page mapping:

```typescript
// Old:
category: page.properties?.["Category"]?.select?.name as FeedbackCategory,
aiSuggestedCategory: page.properties?.["AI Suggested Category"]?.select?.name as FeedbackCategory,

// New:
categories: (page.properties?.["Categories"]?.multi_select ?? []).map((o: any) => o.name as FeedbackCategory),
aiSuggestedCategories: (page.properties?.["AI Suggested Categories"]?.multi_select ?? []).map((o: any) => o.name as FeedbackCategory),
```

- [ ] **Step 6: Update test files for `accuracyReport.test.ts` and `correctionLog.test.ts`**

In `accuracyReport.test.ts`, update any `ReviewedRow` literals:
- `category: "Feature Request"` → `categories: ["Feature Request"]`
- `aiSuggestedCategory: "Bug / Broken"` → `aiSuggestedCategories: ["Bug / Broken"]`

In `correctionLog.test.ts`, update any `CorrectionRow` literals:
- `category: "Feature Request"` → `categories: ["Feature Request"]`
- `aiSuggestedCategory: "Bug / Broken"` → `aiSuggestedCategories: ["Bug / Broken"]`

- [ ] **Step 7: Run typecheck + tests**

```bash
npx tsc --noEmit && npm test
```

Expected: zero errors, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/core/accuracyReport.ts src/core/correctionLog.ts src/core/accuracyReport.test.ts src/core/correctionLog.test.ts scripts/accuracyReport.ts scripts/correctionLog.ts
git commit -m "feat(report): update accuracy report and correction log for multi-category"
```

---

## Task 8: Schema Migration Script

**Files:**
- Create: `scripts/migrateCategoriesToMultiSelect.ts`

**Interfaces:**
- Consumes: live Customer Feedback Notion DB
- Produces: each row's `"Category"` value copied to `"Categories"` multi-select if `"Categories"` is empty

**Note:** Run this script ONCE after the new Notion properties (`"Categories"`, `"AI Suggested Categories"`, `"Gate Verdict"`) have been added to the DB via the Notion UI. It is idempotent — it skips rows that already have `"Categories"` populated.

- [ ] **Step 1: Write migration script**

```typescript
// scripts/migrateCategoriesToMultiSelect.ts
import "dotenv/config";
import { Client } from "@notionhq/client";
import { loadConfig } from "../src/config.js";

async function main() {
  const config = loadConfig();
  if (!config.notionApiKey || !config.notionDatabaseId) throw new Error("NOTION_API_KEY and NOTION_DATABASE_ID required.");

  const client = new Client({ auth: config.notionApiKey, notionVersion: "2022-06-28" });

  let cursor: string | undefined;
  let migrated = 0;
  let skipped = 0;

  console.log("Starting migration: Category (select) → Categories (multi-select)...");

  do {
    const res: any = await client.databases.query({
      database_id: config.notionDatabaseId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of res.results) {
      const props = page.properties as Record<string, any>;
      const singleCategory: string | undefined = props["Category"]?.select?.name;
      const multiCategories: any[] = props["Categories"]?.multi_select ?? [];

      // Skip if already migrated
      if (multiCategories.length > 0) { skipped++; continue; }
      if (!singleCategory) { skipped++; continue; }

      await client.pages.update({
        page_id: page.id,
        properties: {
          Categories: { multi_select: [{ name: singleCategory }] },
        },
      });

      migrated++;
      if (migrated % 20 === 0) console.log(`  Migrated ${migrated} rows...`);

      // Rate limit: Notion allows ~3 req/s
      await new Promise((r) => setTimeout(r, 350));
    }

    cursor = res.next_cursor ?? undefined;
  } while (cursor);

  // Now migrate "AI Suggested Category" → "AI Suggested Categories"
  console.log("\nMigrating AI Suggested Category...");
  cursor = undefined;
  let aiMigrated = 0;

  do {
    const res: any = await client.databases.query({
      database_id: config.notionDatabaseId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of res.results) {
      const props = page.properties as Record<string, any>;
      const singleAI: string | undefined = props["AI Suggested Category"]?.select?.name;
      const multiAI: any[] = props["AI Suggested Categories"]?.multi_select ?? [];

      if (multiAI.length > 0 || !singleAI) continue;

      await client.pages.update({
        page_id: page.id,
        properties: {
          "AI Suggested Categories": { multi_select: [{ name: singleAI }] },
        },
      });

      aiMigrated++;
      await new Promise((r) => setTimeout(r, 350));
    }

    cursor = res.next_cursor ?? undefined;
  } while (cursor);

  console.log(`\nDone. ${migrated} rows migrated (Category), ${aiMigrated} rows migrated (AI Suggested), ${skipped} skipped.`);
}

main().catch((err) => { console.error("Migration failed:", err?.body ?? err); process.exit(1); });
```

- [ ] **Step 2: Add migration command to `package.json` scripts**

```json
"migrate:categories": "tsx scripts/migrateCategoriesToMultiSelect.ts"
```

- [ ] **Step 3: Commit**

```bash
git add scripts/migrateCategoriesToMultiSelect.ts package.json
git commit -m "feat(migration): one-time script to migrate Category → Categories multi-select"
```

Do NOT run the migration yet — it must only run after the Notion DB properties have been manually created via the UI (verified by PM before this task's sign-off).

---

## Task 9: Versioned Prompt System

**Files:**
- Create: `src/util/loadPrompt.ts`
- Create: `prompts/config.yaml`
- Create: `prompts/gate/v1.md` (current gate system prompt)
- Create: `prompts/enricher/v1.md` (current enricher system prompt)
- Create: `prompts/judge/v1.md` (current judge system prompt)
- Modify: `src/adapters/gate/claudeFeedbackGate.ts` — accept `systemPrompt?` in constructor
- Modify: `src/adapters/enricher/claudeEnricher.ts` — accept `systemPrompt?` in constructor
- Modify: `src/adapters/judge/claudeJudge.ts` — accept `systemPrompt?` in constructor
- Modify: `src/index.ts` — call `loadPrompt` and inject into constructors

**Interfaces:**
- Produces: `loadPrompt(key, fallback)` returns versioned prompt or fallback. Adapters use injected prompt when provided.

- [ ] **Step 1: Create `src/util/loadPrompt.ts`**

```typescript
// src/util/loadPrompt.ts
import { readFileSync, existsSync } from "node:fs";

type PromptKey = "gate" | "enricher" | "judge";

function readConfig(): Record<string, string> {
  const configPath = "./prompts/config.yaml";
  if (!existsSync(configPath)) return {};
  const config: Record<string, string> = {};
  for (const line of readFileSync(configPath, "utf8").split("\n")) {
    const colonAt = line.indexOf(":");
    if (colonAt === -1) continue;
    const key = line.slice(0, colonAt).trim();
    const value = line.slice(colonAt + 1).trim();
    if (key && value) config[key] = value;
  }
  return config;
}

/**
 * Reads the active prompt version from `prompts/config.yaml` and loads the file.
 * Returns `fallback` if the config or file is missing (fail-open).
 */
export function loadPrompt(key: PromptKey, fallback: string): string {
  try {
    const config = readConfig();
    const version = config[key];
    if (!version) return fallback;
    const promptPath = `./prompts/${key}/${version}.md`;
    if (!existsSync(promptPath)) return fallback;
    return readFileSync(promptPath, "utf8").trim();
  } catch {
    return fallback;
  }
}
```

- [ ] **Step 2: Create `prompts/config.yaml`**

```yaml
gate: v1
enricher: v1
judge: v1
```

- [ ] **Step 3: Create `prompts/gate/v1.md`**

Copy the current `SYSTEM_PROMPT` constant from `src/adapters/gate/claudeFeedbackGate.ts` verbatim:

```
You are triaging historical Slack messages at a B2B SaaS company providing HR / talent-assessment software, to find CUSTOMER FEEDBACK that was never formally logged.

Customer feedback includes: bug reports, feature requests, complaints, praise, usability friction, pricing/commercial reactions, onboarding pain, reporting/data gaps, candidate-experience remarks, and assessment accuracy/validity concerns — whether stated directly by a customer or relayed by a colleague ("client said X", "a candidate complained that Y").

NOT feedback: internal logistics, scheduling, greetings, standups, deploy notices, jokes, and generic chit-chat with no product signal.

Bias toward RECALL: a human reviews every message you flag, so when a message plausibly carries any customer signal, flag it. Only withhold messages with clearly no product/customer signal.
```

- [ ] **Step 4: Create `prompts/enricher/v1.md`**

Copy the current `SYSTEM_PROMPT` constant from `src/adapters/enricher/claudeEnricher.ts` verbatim. (It is the long multi-line string starting with "You are a feedback classifier...".)

- [ ] **Step 5: Create `prompts/judge/v1.md`**

Copy the current `SYSTEM_PROMPT` constant from `src/adapters/judge/claudeJudge.ts` verbatim.

- [ ] **Step 6: Update `ClaudeFeedbackGate` to accept optional `systemPrompt`**

In `src/adapters/gate/claudeFeedbackGate.ts`:

```typescript
export class ClaudeFeedbackGate implements FeedbackGate {
  private client: Anthropic;
  private systemPrompt: string;

  constructor(apiKey: string, systemPrompt?: string, private model = "claude-haiku-4-5-20251001") {
    this.client = new Anthropic({ apiKey });
    this.systemPrompt = systemPrompt ?? SYSTEM_PROMPT;
  }
  // ... use this.systemPrompt instead of SYSTEM_PROMPT in the messages.create call
```

- [ ] **Step 7: Update `ClaudeEnricher` to accept optional `systemPrompt`**

The `ClaudeEnricher` constructor already has `styleGuide?: string`. Add `systemPrompt?: string` as the first optional:

```typescript
constructor(apiKey: string, systemPrompt?: string, styleGuide?: string, private model = "claude-haiku-4-5-20251001") {
  this.client = new Anthropic({ apiKey });
  this.systemPrompt = appendGuidance(systemPrompt ?? SYSTEM_PROMPT, styleGuide);
}
```

- [ ] **Step 8: Update `ClaudeJudge` to accept optional `systemPrompt`**

```typescript
constructor(apiKey: string, systemPrompt?: string, private model = "claude-haiku-4-5-20251001") {
  this.client = new Anthropic({ apiKey });
  this.systemPrompt = systemPrompt ?? SYSTEM_PROMPT;
}
// ... use this.systemPrompt in the messages.create call
```

- [ ] **Step 9: Update `src/index.ts` to load and inject prompts**

Add the import at the top:

```typescript
import { loadPrompt } from "./util/loadPrompt.js";
```

Then, in `main()`, before constructing the adapters, load prompts:

```typescript
const gatePrompt = loadPrompt("gate", /* pass the SYSTEM_PROMPT default via import */);
const enricherPrompt = loadPrompt("enricher", /* pass the SYSTEM_PROMPT default via import */);
const judgePrompt = loadPrompt("judge", /* pass the SYSTEM_PROMPT default via import */);
```

Wait — to pass the fallback, you'd need to import `SYSTEM_PROMPT` from each adapter. Since these are private constants, the cleanest approach is to export them (rename to `GATE_SYSTEM_PROMPT`, `ENRICHER_SYSTEM_PROMPT`, `JUDGE_SYSTEM_PROMPT`) or let `loadPrompt` always fall back internally (pass `""` as fallback when the file is present). 

**Simpler approach:** make `loadPrompt` return `undefined` when file missing, and keep the hardcoded default as the in-constructor fallback:

```typescript
export function loadPrompt(key: PromptKey): string | undefined {
  try {
    const config = readConfig();
    const version = config[key];
    if (!version) return undefined;
    const promptPath = `./prompts/${key}/${version}.md`;
    if (!existsSync(promptPath)) return undefined;
    const content = readFileSync(promptPath, "utf8").trim();
    return content || undefined;
  } catch {
    return undefined;
  }
}
```

Then each constructor receives `systemPrompt?: string` and uses `systemPrompt ?? SYSTEM_PROMPT` (SYSTEM_PROMPT stays as the in-file fallback constant).

In `src/index.ts`:

```typescript
const enricher: Enricher = config.anthropicApiKey
  ? new ClaudeEnricher(config.anthropicApiKey, loadPrompt("enricher"), enrichmentStyleGuide)
  : new NullEnricher();

const judge: Judge = config.anthropicApiKey
  ? new ClaudeJudge(config.anthropicApiKey, loadPrompt("judge"))
  : new NullJudge();
```

For the gate, it is used in backfill scripts, not in `index.ts`. Add `loadPrompt` to `scripts/backfillScan.ts` when constructing `ClaudeFeedbackGate`:

```typescript
const gate = new ClaudeFeedbackGate(config.anthropicApiKey!, loadPrompt("gate"));
```

- [ ] **Step 10: Run typecheck + tests**

```bash
npx tsc --noEmit && npm test
```

Expected: zero errors, all tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/util/loadPrompt.ts prompts/ src/adapters/gate/claudeFeedbackGate.ts src/adapters/enricher/claudeEnricher.ts src/adapters/judge/claudeJudge.ts src/index.ts scripts/backfillScan.ts
git commit -m "feat(prompts): versioned prompt system — loadPrompt + prompts/config.yaml + v1 files"
```

---

## Task 10: Eval Infrastructure + Baseline

**Files:**
- Create: `scripts/runEval.ts`
- Create: `data/eval-results/` (gitignored — verify in `.gitignore`)
- Modify: `.gitignore` — add `data/eval-results/`

**Interfaces:**
- Consumes: `data/gold-set.csv`, adapter constructors (gate, enricher)
- Produces: `data/eval-results/YYYY-MM-DDTHH-mm-gate-vN.json` and `data/eval-results/YYYY-MM-DDTHH-mm-enricher-vN.json`

- [ ] **Step 1: Verify `data/eval-results/` is gitignored**

Add to `.gitignore` if not present:

```
data/eval-results/
```

**Gold set encoding — read this before writing the script:**

The structured `corrected_category` column is nearly empty. Use this logic to derive the gold category label for each feedback row:
- `corrected_category` non-empty → that IS the gold label (explicit correction)
- `corrected_category` empty + `classification_ok=true` + `is_feedback=true` → `proposed_category` IS the gold label (Eddie affirmed it correct)
- `corrected_category` empty + `classification_ok` not true → skip this row for enricher eval (ambiguous — no reliable ground truth)
- `is_feedback=false` → skip for enricher eval (gate false positive, no category ground truth)

The `gate_confidence` column in the CSV is the gate's confidence from the original backfill scan (already computed — no new API calls needed to read it).

- [ ] **Step 2: Write `scripts/runEval.ts`**

```typescript
// scripts/runEval.ts
// Usage:
//   npx tsx scripts/runEval.ts gate      — gate precision/recall/F1 + breakdown by confidence bucket
//   npx tsx scripts/runEval.ts enricher  — category accuracy overall + per-category table
//   npx tsx scripts/runEval.ts judge     — judge calibration (runs enricher + judge; expensive)
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { ClaudeFeedbackGate } from "../src/adapters/gate/claudeFeedbackGate.js";
import { ClaudeEnricher } from "../src/adapters/enricher/claudeEnricher.js";
import { ClaudeJudge } from "../src/adapters/judge/claudeJudge.js";
import { loadPrompt } from "../src/util/loadPrompt.js";
import { loadGuideFile } from "../src/util/loadGuideFile.js";
import { CATEGORIES } from "../src/core/taxonomy.js";
import type { FeedbackCategory, ConfidenceLevel } from "../src/core/ports.js";

// Minimal RFC4180 CSV parser (identical to distillation script)
function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n?/g, "\n").trim().split("\n");
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const cells = parseCSVLine(l);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
  return { headers, rows };
}

function parseCSVLine(line: string): string[] {
  const cells: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let cell = "";
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { cell += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { cell += line[i++]; }
      }
      cells.push(cell);
      if (line[i] === ",") i++;
    } else {
      const end = line.indexOf(",", i);
      cells.push(end === -1 ? line.slice(i) : line.slice(i, end));
      i = end === -1 ? line.length : end + 1;
    }
  }
  return cells;
}

function readPromptVersion(key: string): string {
  try {
    return readFileSync("./prompts/config.yaml", "utf8").match(new RegExp(`${key}:\\s*(\\S+)`))?.[1] ?? "unknown";
  } catch { return "unknown"; }
}

function f1Score(tp: number, fp: number, fn: number): number {
  const p = tp / (tp + fp) || 0;
  const r = tp / (tp + fn) || 0;
  return p + r > 0 ? 2 * p * r / (p + r) : 0;
}

// ─── Gate Eval ───────────────────────────────────────────────────────────────

async function evalGate(config: ReturnType<typeof loadConfig>) {
  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY required.");
  const { rows } = parseCSV(readFileSync("./data/gold-set.csv", "utf8"));
  const gate = new ClaudeFeedbackGate(config.anthropicApiKey, loadPrompt("gate"));
  const promptVersion = readPromptVersion("gate");

  const results: any[] = [];
  let tp = 0, tn = 0, fp = 0, fn = 0;

  // Confidence-bucket tracking — uses the gate's OWN confidence on THIS run (not the backfill's)
  const buckets: Record<string, { tp: number; tn: number; fp: number; fn: number }> = {
    High: { tp: 0, tn: 0, fp: 0, fn: 0 },
    Medium: { tp: 0, tn: 0, fp: 0, fn: 0 },
    Low: { tp: 0, tn: 0, fp: 0, fn: 0 },
  };

  for (const row of rows) {
    const humanLabel = row["is_feedback"] === "true";
    const result = await gate.classify(row["message"], "eval");
    const predicted = result?.isLikelyFeedback ?? false;
    const conf = result?.confidence ?? "Low";

    if (humanLabel && predicted) { tp++; buckets[conf].tp++; }
    else if (!humanLabel && !predicted) { tn++; buckets[conf].tn++; }
    else if (!humanLabel && predicted) { fp++; buckets[conf].fp++; }
    else { fn++; buckets[conf].fn++; }

    results.push({
      pageId: row["pageId"],
      humanLabel,
      predicted,
      confidence: conf,
      rationale: result?.rationale,
      originalGateConfidence: row["gate_confidence"], // from backfill scan — for cross-reference
    });
  }

  const precision = tp / (tp + fp) || 0;
  const recall = tp / (tp + fn) || 0;
  const overallF1 = f1Score(tp, fp, fn);

  const confidenceBreakdown = Object.fromEntries(
    Object.entries(buckets).map(([conf, b]) => [
      conf,
      {
        count: b.tp + b.tn + b.fp + b.fn,
        f1: f1Score(b.tp, b.fp, b.fn),
        precision: b.tp / (b.tp + b.fp) || 0,
        recall: b.tp / (b.tp + b.fn) || 0,
      },
    ])
  );

  console.log("\n=== Gate Eval ===");
  console.log(`Prompt version: ${promptVersion}`);
  console.log(`Overall  — Precision: ${(precision * 100).toFixed(1)}%  Recall: ${(recall * 100).toFixed(1)}%  F1: ${(overallF1 * 100).toFixed(1)}%  (TP=${tp} TN=${tn} FP=${fp} FN=${fn})`);
  console.log("\nBy gate confidence (this run):");
  for (const [conf, b] of Object.entries(confidenceBreakdown)) {
    console.log(`  ${conf.padEnd(6)} n=${b.count}  F1=${(b.f1 * 100).toFixed(1)}%  Prec=${(b.precision * 100).toFixed(1)}%  Rec=${(b.recall * 100).toFixed(1)}%`);
  }

  const summary = { promptVersion, tp, tn, fp, fn, precision, recall, f1: overallF1, total: rows.length, confidenceBreakdown };
  return { summary, rows: results };
}

// ─── Enricher Eval ───────────────────────────────────────────────────────────

/**
 * Gold label derivation:
 * - corrected_category non-empty → explicit correction → use it
 * - corrected_category empty + classification_ok=true → proposed_category was affirmed correct → use it
 * - else → skip (ambiguous, no reliable ground truth)
 */
function goldLabel(row: Record<string, string>): FeedbackCategory | null {
  if (row["is_feedback"] !== "true") return null;
  if (row["corrected_category"]) return row["corrected_category"] as FeedbackCategory;
  if (row["classification_ok"] === "true" && row["proposed_category"]) return row["proposed_category"] as FeedbackCategory;
  return null;
}

async function evalEnricher(config: ReturnType<typeof loadConfig>) {
  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY required.");
  const { rows } = parseCSV(readFileSync("./data/gold-set.csv", "utf8"));
  const styleGuide = loadGuideFile(config.enrichmentStyleGuidePath);
  const enricher = new ClaudeEnricher(config.anthropicApiKey, loadPrompt("enricher"), styleGuide);
  const promptVersion = readPromptVersion("enricher");

  const evalRows = rows.map((r) => ({ row: r, gold: goldLabel(r) })).filter((x) => x.gold !== null);
  console.log(`\nEnricher eval: ${evalRows.length} rows with reliable gold labels (${rows.length - evalRows.length} skipped — ambiguous or non-feedback)`);

  const results: any[] = [];
  let categoryMatches = 0;

  // Per-category tracking
  const perCat: Record<string, { correct: number; total: number }> = {};
  for (const cat of CATEGORIES) perCat[cat] = { correct: 0, total: 0 };

  for (const { row, gold } of evalRows) {
    const result = await enricher.enrich(row["message"], "eval");
    const primaryPredicted = result?.categories[0] ?? null;
    const match = primaryPredicted === gold;
    if (match) categoryMatches++;
    perCat[gold!].total++;
    if (match) perCat[gold!].correct++;

    results.push({
      pageId: row["pageId"],
      gold,
      predictedCategories: result?.categories,
      summaryProduced: result?.summary,
      primaryMatch: match,
    });
  }

  const accuracy = categoryMatches / evalRows.length;

  console.log("\n=== Enricher Eval ===");
  console.log(`Prompt version: ${promptVersion}`);
  console.log(`Overall primary category accuracy: ${(accuracy * 100).toFixed(1)}% (${categoryMatches}/${evalRows.length})`);
  console.log("\nPer-category accuracy (gold rows only):");
  const sorted = Object.entries(perCat)
    .filter(([, v]) => v.total > 0)
    .sort(([, a], [, b]) => (a.correct / a.total) - (b.correct / b.total));
  for (const [cat, v] of sorted) {
    const pct = (v.correct / v.total * 100).toFixed(0);
    console.log(`  ${String(pct + "%").padStart(4)}  (${v.correct}/${v.total})  ${cat}`);
  }

  const summary = {
    promptVersion, categoryMatches, total: evalRows.length, primaryCategoryAccuracy: accuracy,
    perCategory: Object.fromEntries(Object.entries(perCat).filter(([, v]) => v.total > 0)),
  };
  return { summary, rows: results };
}

// ─── Judge Calibration Eval ───────────────────────────────────────────────────
//
// Runs enricher + judge on each feedback row. Answers: "When judge says High confidence,
// is the enricher's primary category actually correct?" If High confidence ≠ high accuracy,
// the judge is miscalibrated and its confidence routing in W4 (live gate) is unreliable.
//
// This is the most expensive eval (2× API calls per row). Run after W3 prompt tuning.

async function evalJudge(config: ReturnType<typeof loadConfig>) {
  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY required.");
  const { rows } = parseCSV(readFileSync("./data/gold-set.csv", "utf8"));
  const styleGuide = loadGuideFile(config.enrichmentStyleGuidePath);
  const enricher = new ClaudeEnricher(config.anthropicApiKey, loadPrompt("enricher"), styleGuide);
  const judge = new ClaudeJudge(config.anthropicApiKey, loadPrompt("judge"));
  const enricherVersion = readPromptVersion("enricher");
  const judgeVersion = readPromptVersion("judge");

  const evalRows = rows.map((r) => ({ row: r, gold: goldLabel(r) })).filter((x) => x.gold !== null);
  console.log(`\nJudge calibration eval: ${evalRows.length} rows`);

  const results: any[] = [];
  const buckets: Record<ConfidenceLevel, { correct: number; total: number }> = {
    High: { correct: 0, total: 0 },
    Medium: { correct: 0, total: 0 },
    Low: { correct: 0, total: 0 },
  };

  for (const { row, gold } of evalRows) {
    const enrichment = await enricher.enrich(row["message"], "eval");
    if (!enrichment) {
      results.push({ pageId: row["pageId"], gold, enrichmentNull: true });
      continue;
    }
    const verdict = await judge.review(row["message"], "eval", enrichment.summary, enrichment.categories);
    const conf = (verdict?.confidence ?? "Low") as ConfidenceLevel;
    const match = enrichment.categories[0] === gold;

    buckets[conf].total++;
    if (match) buckets[conf].correct++;

    results.push({
      pageId: row["pageId"],
      gold,
      predictedCategories: enrichment.categories,
      primaryMatch: match,
      judgeConfidence: conf,
      judgeRationale: verdict?.rationale,
    });
  }

  console.log("\n=== Judge Calibration ===");
  console.log(`Enricher version: ${enricherVersion}  Judge version: ${judgeVersion}`);
  console.log("Judge confidence → primary category accuracy:");
  for (const conf of ["High", "Medium", "Low"] as ConfidenceLevel[]) {
    const b = buckets[conf];
    if (b.total === 0) { console.log(`  ${conf.padEnd(6)} n=0  (no samples)`); continue; }
    const acc = (b.correct / b.total * 100).toFixed(1);
    console.log(`  ${conf.padEnd(6)} n=${b.total}  accuracy=${acc}%  (${b.correct}/${b.total} correct)`);
  }
  console.log("Well-calibrated: High > Medium > Low accuracy. If not, judge confidence is not meaningful.");

  const summary = { enricherVersion, judgeVersion, buckets, total: evalRows.length };
  return { summary, rows: results };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const adapterArg = process.argv.find((a) => a === "gate" || a === "enricher" || a === "judge");
  if (!adapterArg) {
    console.error("Usage: npx tsx scripts/runEval.ts gate|enricher|judge");
    process.exit(1);
  }

  if (!existsSync("./data/gold-set.csv")) throw new Error("./data/gold-set.csv not found. Run backfillExportGoldSet first.");

  const config = loadConfig();
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  mkdirSync("./data/eval-results", { recursive: true });

  let result: { summary: any; rows: any[] };
  if (adapterArg === "gate") result = await evalGate(config);
  else if (adapterArg === "enricher") result = await evalEnricher(config);
  else result = await evalJudge(config);

  const version = result.summary.promptVersion ?? result.summary.judgeVersion ?? "unknown";
  const outPath = `./data/eval-results/${ts}-${adapterArg}-${version}.json`;
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`\nResults saved to ${outPath}`);
}

main().catch((err) => { console.error("Eval failed:", err); process.exit(1); });
```

- [ ] **Step 3: Add eval commands to `package.json`**

```json
"eval:gate": "tsx scripts/runEval.ts gate",
"eval:enricher": "tsx scripts/runEval.ts enricher",
"eval:judge": "tsx scripts/runEval.ts judge"
```

- [ ] **Step 4: Run baseline eval for gate**

```
npx tsx scripts/runEval.ts gate
```

Expected: console prints overall precision/recall/F1 + a breakdown table showing F1 per confidence bucket (High/Medium/Low). Results saved to `data/eval-results/`. Record the baseline F1 — W2 will improve it.

- [ ] **Step 5: Run baseline eval for enricher**

```
npx tsx scripts/runEval.ts enricher
```

Expected: overall primary category accuracy + per-category accuracy table sorted worst-first. Record both numbers — W3 targets the worst-performing categories specifically.

- [ ] **Step 6: Note which categories are worst (from enricher eval output)**

The per-category table tells W3 exactly where to focus the prompt tuning. If "Other" is the most-confused or "Compliance / Legal / Governance" has zero correct (likely on first run as it's new), W3 must explicitly target those in the v2 prompt.

- [ ] **Step 7: Commit**

```bash
git add scripts/runEval.ts package.json .gitignore
git commit -m "feat(eval): eval infra — gate F1 by confidence bucket, enricher per-category breakdown, judge calibration"
```

---

## Task 11: Final W1 Typecheck + Test

- [ ] **Run full suite**

```bash
npx tsc --noEmit && npm test
```

Expected: zero typecheck errors, all tests pass. If any test fails, fix it before marking W1 complete.

- [ ] **Verify `data/gold-set.csv` exists and has `enriched_rationale` filled in**

```bash
head -2 data/gold-set.csv
```

Expected: header row + first data row with `enriched_rationale` non-empty.

- [ ] **Signal to PM:** W1 complete. W2 and W3 may start.
