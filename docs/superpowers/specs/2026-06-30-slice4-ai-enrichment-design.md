# Slice 4 Design: AI Enrichment of Captured Feedback

**Date:** 2026-06-30
**Status:** Approved

---

## Goal

After a Slack message is captured (via `:mega:` reaction or `@mention`), automatically enrich it with a short AI-generated summary and a category tag before writing to Notion. The result is a Notion row that's immediately scannable without needing to read the raw Slack message.

---

## What the AI produces

| Field | Description |
|---|---|
| **Summary** | 1–2 sentence plain-English rewrite of the raw message, stripped of Slack noise |
| **Category** | One of 8 fixed options (select field in Notion) |

**Fixed category list:**
- Bug / Broken
- Feature Request
- Pricing / Commercial
- Onboarding / Setup
- UX / Usability
- Reporting / Data
- Praise
- Other

---

## Architecture

Follows the existing ports & adapters pattern. Enrichment is a new port in `core/ports.ts`, called inside `handleCapture`, between message fetch and Notion write.

```
reaction / @mention
      ↓
  transport (socketMode.ts)
      ↓ CaptureRequest
  handleCapture (core)
      ↓ getMessage, resolveNames, getPermalink
      ↓ enrich(text, channelName)       ← NEW (degrades gracefully on null)
      ↓ createFeedback(FeedbackRecord)  ← summary + category included if available
  DedupStore.record(key, pageId)
```

---

## Port definitions (`core/ports.ts`)

```typescript
export type FeedbackCategory =
  | "Bug / Broken"
  | "Feature Request"
  | "Pricing / Commercial"
  | "Onboarding / Setup"
  | "UX / Usability"
  | "Reporting / Data"
  | "Praise"
  | "Other";

export interface EnrichmentResult {
  summary: string;
  category: FeedbackCategory;
}

export interface Enricher {
  enrich(text: string, channelName: string): Promise<EnrichmentResult | null>;
}
```

`FeedbackRecord` additions:
```typescript
summary?: string;
category?: FeedbackCategory;
```

`CaptureDeps` addition:
```typescript
enricher: Enricher;
```

---

## Core handler changes (`handleCapture.ts`)

Enrichment runs after names/permalink are resolved, before `notion.createFeedback`:

```typescript
const enrichment = await deps.enricher.enrich(text, channelName).catch(() => null);
// enrichment is null → fields absent from FeedbackRecord → blank in Notion
```

- Returns `null` on any error; capture still succeeds, ack is still ✅
- Logs a warning when enrichment fails so API issues are visible
- No retry logic — a transient failure means one row with blank fields; the user can manually fill them

---

## Adapters

### `ClaudeEnricher` (`src/adapters/enricher/claudeEnricher.ts`)

- Model: `claude-haiku-4-5-20251001` (fast, cheap, sufficient for this task)
- Uses Claude `tool_use` structured output — schema enforces `summary: string` and `category: FeedbackCategory`, eliminating JSON parsing and malformed responses
- System prompt includes one labelled example per category (8 total) for consistent edge-case classification
- Constructor: `new ClaudeEnricher(apiKey: string, model?: string)`
- On any error → returns `null`

### `NullEnricher` (`src/adapters/enricher/nullEnricher.ts`)

- `enrich()` always returns `null` immediately
- Wired in when `ANTHROPIC_API_KEY` is not set in the environment
- Allows the full pipeline (including file-sink dev mode) to run without AI credentials

---

## Configuration

**`config.ts`:** Add `anthropicApiKey?: string` (optional).

**`.env.example`:** Add:
```
# --- AI Enrichment (optional) ---
# When set, captured feedback is auto-summarised and categorised before writing to Notion.
# Uses claude-haiku-4-5-20251001. Leave blank to disable enrichment.
ANTHROPIC_API_KEY=sk-ant-...
```

**Wiring (`index.ts`):**
```typescript
const enricher: Enricher = config.anthropicApiKey
  ? new ClaudeEnricher(config.anthropicApiKey)
  : new NullEnricher();
```

---

## Notion schema changes (manual, before go-live)

Add two new properties to the "Customer Feedback" database:

| Property name | Type | Notes |
|---|---|---|
| `Summary` | Text | AI-generated 1–2 sentence rewrite |
| `Category` | Select | The 8 fixed options listed above |

Both are written only when enrichment succeeds; left blank otherwise.

---

## Error handling

| Scenario | Behaviour |
|---|---|
| `ANTHROPIC_API_KEY` not set | `NullEnricher` wired; enrichment silently skipped (works for both file and Notion sinks) |
| Claude API down or times out | `enrich()` returns `null`; capture written without enrichment; warning logged |
| Unexpected response shape | Caught by structured output schema; treated as error → `null` |
| Notion lacks `Summary`/`Category` fields | Notion API returns an error on `createFeedback` → existing ⚠️ ack path; add the fields to fix |

---

## Testing

- **Unit tests** (`handleCapture.test.ts`): add a fake `Enricher` to `makeDeps()`; add tests for enriched capture (fields present) and enrichment failure (fields absent, status still `"captured"`)
- **`ClaudeEnricher`**: not unit-tested (hits live API); validated manually during pilot
- **`NullEnricher`**: trivially correct, no test needed

---

## Out of scope

- Retry logic for enrichment failures
- AI-extracted customer/account name (future slice)
- Enrichment of historical rows already in Notion
- Changing the enrichment model or provider without a code change
- Sentiment scoring or priority ranking
