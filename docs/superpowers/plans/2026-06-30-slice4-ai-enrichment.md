# Slice 4: AI Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically enrich each captured Slack feedback message with a 1–2 sentence AI summary and a fixed-list category tag before writing to Notion.

**Architecture:** New `Enricher` port in `core/ports.ts`; called inside `handleCapture` between message resolution and Notion write. `ClaudeEnricher` (Haiku, structured output via `tool_use`) is wired when `ANTHROPIC_API_KEY` is set; `NullEnricher` otherwise. Enrichment failure is silent — capture still succeeds with blank fields.

**Tech Stack:** `@anthropic-ai/sdk` (new), existing Node/TypeScript + tsx.

## Global Constraints

- TypeScript strict mode; every file must pass `npm run typecheck` after its task.
- Run via `tsx` — no build step. All imports use `.js` extension even for `.ts` source files.
- Ports & adapters: core never imports from vendor SDKs. All Anthropic SDK usage stays in `src/adapters/enricher/`.
- Enrichment failure must NEVER block a capture. `enrich()` always returns `EnrichmentResult | null`; callers treat `null` as "skip enrichment".
- Model: `claude-haiku-4-5-20251001`. Do not change without updating the constant in `claudeEnricher.ts`.
- Test runner: `npm test` (runs `node --import tsx --test src/core/handleCapture.test.ts`).
- All new Notion property writes use conditional spread — only write `Summary`/`Category` when the enrichment result is non-null, so captures work even if those Notion fields haven't been added yet.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/core/ports.ts` | Add `FeedbackCategory`, `EnrichmentResult`, `Enricher`; add `summary?`/`category?` to `FeedbackRecord` |
| Create | `src/adapters/enricher/nullEnricher.ts` | `Enricher` impl that always returns `null` |
| Create | `src/adapters/enricher/claudeEnricher.ts` | `Enricher` impl backed by Claude Haiku via `tool_use` |
| Modify | `src/core/handleCapture.ts` | Add `enricher: Enricher` to `CaptureDeps`; call enricher before `createFeedback` |
| Modify | `src/core/handleCapture.test.ts` | Add fake enricher to `makeDeps()`; add 2 new tests |
| Modify | `src/adapters/notion/notionWriter.ts` | Write `Summary` (rich_text) and `Category` (select) conditionally |
| Modify | `src/config.ts` | Add `anthropicApiKey?: string` |
| Modify | `src/index.ts` | Wire `ClaudeEnricher` or `NullEnricher` based on config |
| Modify | `.env.example` | Add `ANTHROPIC_API_KEY` with comment |

`src/adapters/notion/localWriter.ts` — **no change needed**: its `createFeedback` already spreads the full `FeedbackRecord`, so `summary` and `category` appear in the JSONL automatically when present.

---

## Task 1: Add `Enricher` port and extend `FeedbackRecord`

**Files:**
- Modify: `src/core/ports.ts`

**Interfaces produced:**
```typescript
export type FeedbackCategory =
  | "Bug / Broken" | "Feature Request" | "Pricing / Commercial"
  | "Onboarding / Setup" | "UX / Usability" | "Reporting / Data"
  | "Praise" | "Other";

export interface EnrichmentResult {
  summary: string;
  category: FeedbackCategory;
}

export interface Enricher {
  enrich(text: string, channelName: string): Promise<EnrichmentResult | null>;
}
```

`FeedbackRecord` gains two optional fields: `summary?: string` and `category?: FeedbackCategory`.

- [ ] **Step 1: Add types to `src/core/ports.ts`**

  Insert after the closing brace of `DedupStore` (end of file):

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

  Add two optional fields to `FeedbackRecord`:

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
    summary?: string;        // AI-generated; absent when enrichment is disabled or failed
    category?: FeedbackCategory; // AI-assigned; absent when enrichment is disabled or failed
  }
  ```

- [ ] **Step 2: Verify typecheck passes**

  ```
  npm run typecheck
  ```

  Expected: no errors. The new fields are additive and optional; nothing downstream breaks.

- [ ] **Step 3: Commit**

  ```
  git add src/core/ports.ts
  git commit -m "feat(slice4): add Enricher port and summary/category to FeedbackRecord"
  ```

---

## Task 2: Install SDK + create `NullEnricher`

**Files:**
- Create: `src/adapters/enricher/nullEnricher.ts`

**Interfaces consumed:** `Enricher` from `../../core/ports.js`

- [ ] **Step 1: Install `@anthropic-ai/sdk`**

  ```
  npm install @anthropic-ai/sdk
  ```

  Expected: package added to `dependencies` in `package.json`.

- [ ] **Step 2: Create `src/adapters/enricher/nullEnricher.ts`**

  ```typescript
  import type { Enricher } from "../../core/ports.js";

  /** Enricher that always returns null. Wired when ANTHROPIC_API_KEY is not set. */
  export class NullEnricher implements Enricher {
    async enrich(): Promise<null> {
      return null;
    }
  }
  ```

- [ ] **Step 3: Verify typecheck passes**

  ```
  npm run typecheck
  ```

  Expected: no errors.

- [ ] **Step 4: Commit**

  ```
  git add package.json package-lock.json src/adapters/enricher/nullEnricher.ts
  git commit -m "feat(slice4): install @anthropic-ai/sdk and add NullEnricher"
  ```

---

## Task 3: Create `ClaudeEnricher`

**Files:**
- Create: `src/adapters/enricher/claudeEnricher.ts`

**Interfaces consumed:** `Enricher`, `EnrichmentResult`, `FeedbackCategory` from `../../core/ports.js`

**Interfaces produced:** `ClaudeEnricher` class with constructor `(apiKey: string, model?: string)`

- [ ] **Step 1: Create `src/adapters/enricher/claudeEnricher.ts`**

  ```typescript
  import Anthropic from "@anthropic-ai/sdk";
  import type { Enricher, EnrichmentResult, FeedbackCategory } from "../../core/ports.js";

  const CATEGORIES: FeedbackCategory[] = [
    "Bug / Broken",
    "Feature Request",
    "Pricing / Commercial",
    "Onboarding / Setup",
    "UX / Usability",
    "Reporting / Data",
    "Praise",
    "Other",
  ];

  const SYSTEM_PROMPT = `You are a feedback classifier for a B2B SaaS company. Given a Slack message and its channel, produce a 1-2 sentence plain-English summary and classify it into exactly one category.

  Categories and examples:
  - Bug / Broken: "The export button throws an error" → "Export feature is broken and throws an error when clicked."
  - Feature Request: "It would be great if we could bulk-assign candidates" → "User wants bulk candidate assignment functionality."
  - Pricing / Commercial: "The per-seat pricing is too high for us" → "User finds per-seat pricing too expensive for their team size."
  - Onboarding / Setup: "We couldn't figure out how to connect our ATS" → "User struggled to connect their ATS during onboarding."
  - UX / Usability: "The navigation is confusing, I can never find reports" → "User finds navigation confusing and has trouble locating reports."
  - Reporting / Data: "The pipeline report doesn't include withdrawn candidates" → "Pipeline report is missing withdrawn candidates from the data."
  - Praise: "The new search is so much faster, our team loves it!" → "User is very happy with the improved search speed."
  - Other: "Quick question about your roadmap" → "User has a general roadmap inquiry."

  Remove Slack noise (raw @mentions, filler phrases). Keep the summary factual and concise.`;

  export class ClaudeEnricher implements Enricher {
    private client: Anthropic;

    constructor(apiKey: string, private model = "claude-haiku-4-5-20251001") {
      this.client = new Anthropic({ apiKey });
    }

    async enrich(text: string, channelName: string): Promise<EnrichmentResult | null> {
      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 256,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Channel: ${channelName}\nMessage: ${text}`,
            },
          ],
          tools: [
            {
              name: "submit_enrichment",
              description: "Submit the summary and category for this feedback message.",
              input_schema: {
                type: "object" as const,
                properties: {
                  summary: {
                    type: "string",
                    description: "1-2 sentence plain-English summary of the feedback",
                  },
                  category: {
                    type: "string",
                    enum: CATEGORIES,
                    description: "The category that best fits this feedback",
                  },
                },
                required: ["summary", "category"],
              },
            },
          ],
          tool_choice: { type: "tool", name: "submit_enrichment" },
        });

        const toolUse = response.content.find((b) => b.type === "tool_use");
        if (!toolUse || toolUse.type !== "tool_use") return null;

        const input = toolUse.input as { summary: string; category: string };
        if (!input.summary || !CATEGORIES.includes(input.category as FeedbackCategory)) return null;

        return {
          summary: input.summary,
          category: input.category as FeedbackCategory,
        };
      } catch {
        return null;
      }
    }
  }
  ```

- [ ] **Step 2: Verify typecheck passes**

  ```
  npm run typecheck
  ```

  Expected: no errors. (`ClaudeEnricher` is defined but not wired yet — that's fine.)

- [ ] **Step 3: Commit**

  ```
  git add src/adapters/enricher/claudeEnricher.ts
  git commit -m "feat(slice4): add ClaudeEnricher with tool_use structured output"
  ```

---

## Task 4: Update `handleCapture` + tests

**Files:**
- Modify: `src/core/handleCapture.ts`
- Modify: `src/core/handleCapture.test.ts`

**Interfaces consumed:** `Enricher`, `FeedbackCategory` from `./ports.js`

This task adds `enricher` to `CaptureDeps` (a breaking change for the test file, fixed in the same task), calls enrichment after message resolution, and adds two new tests.

- [ ] **Step 1: Add `enricher` to `CaptureDeps` in `handleCapture.ts`**

  Replace the `CaptureDeps` interface:

  ```typescript
  export interface CaptureDeps {
    slack: SlackGateway;
    notion: NotionWriter;
    dedup: DedupStore;
    logger: Logger;
    source: string;
    botUserId?: string;
    enricher: Enricher;
  }
  ```

  Add the import at the top of the file (update the existing ports import):

  ```typescript
  import type { SlackGateway, NotionWriter, DedupStore, Enricher } from "./ports.js";
  ```

- [ ] **Step 2: Call enricher in `handleCapture` before `createFeedback`**

  After the `text` and `dateIso` lines, and before `notion.createFeedback`, insert:

  ```typescript
  const enrichment = await deps.enricher.enrich(text, channelName).catch(() => null);
  ```

  Then pass enrichment fields into `createFeedback`:

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
    category: enrichment?.category,
  });
  ```

- [ ] **Step 3: Write the two new failing tests in `handleCapture.test.ts`**

  First update the import at the top to bring in `FeedbackCategory`:

  ```typescript
  import type { FeedbackRecord, FeedbackCategory } from "./ports.js";
  ```

  Update `makeDeps()` to include a fake enricher that returns a canned result by default:

  ```typescript
  function makeDeps() {
    const writes: FeedbackRecord[] = [];
    const appendedFlaggers: Array<{ pageId: string; name: string }> = [];
    const store = new Map<string, string>();

    const deps: CaptureDeps = {
      logger: silentLogger,
      source: "Slack",
      dedup: {
        has: (k) => store.has(k),
        record: (k, pageId) => { store.set(k, pageId); },
        getPageId: (k) => store.get(k) ?? null,
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
      },
      slack: {
        getMessage: async () => ({ text: "Customers keep asking for SSO", authorUserId: "Uauthor" }),
        resolveUserName: async (id) => (id === "Uauthor" ? "Alice" : "Bob"),
        resolveChannelName: async () => "#general",
        getPermalink: async () => "https://spottedzebra.slack.com/archives/C123/p1719600000000100",
        addReaction: async () => {},
        postReply: async () => {},
      },
      enricher: {
        enrich: async () => ({
          summary: "Customer wants SSO integration.",
          category: "Feature Request" as FeedbackCategory,
        }),
      },
    };
    return { deps, writes, appendedFlaggers, store };
  }
  ```

  Add these two tests at the end of the file:

  ```typescript
  test("includes enriched summary and category in the feedback record", async () => {
    const { deps, writes } = makeDeps();
    await handleCapture(req, deps);
    assert.equal(writes[0].summary, "Customer wants SSO integration.");
    assert.equal(writes[0].category, "Feature Request");
  });

  test("writes feedback without enrichment when enricher returns null", async () => {
    const { deps, writes } = makeDeps();
    deps.enricher.enrich = async () => null;
    const res = await handleCapture(req, deps);
    assert.equal(res.status, "captured");
    assert.equal(writes[0].summary, undefined);
    assert.equal(writes[0].category, undefined);
  });
  ```

- [ ] **Step 4: Run tests — expect 9 pass**

  ```
  npm test
  ```

  Expected output:
  ```
  ✔ captures a new message and records the dedup key with page ID
  ✔ appends flagger when the same message is flagged again (flagger_added)
  ✔ returns duplicate when dedup key exists but no page ID stored (legacy)
  ✔ empty message text falls back to a placeholder title
  ✔ strips bot mention from text on @mention trigger
  ✔ does not record the dedup key when the Notion write fails
  ✔ returns no_message when the message can't be fetched
  ✔ includes enriched summary and category in the feedback record
  ✔ writes feedback without enrichment when enricher returns null
  ℹ tests 9
  ℹ pass 9
  ℹ fail 0
  ```

- [ ] **Step 5: Commit**

  ```
  git add src/core/handleCapture.ts src/core/handleCapture.test.ts
  git commit -m "feat(slice4): call enricher in handleCapture; 9/9 tests pass"
  ```

---

## Task 5: Update `NotionFeedbackWriter` for new fields

**Files:**
- Modify: `src/adapters/notion/notionWriter.ts`

**Interfaces consumed:** `FeedbackRecord` (with `summary?` and `category?`) from `../../core/ports.js`

Write `Summary` and `Category` only when the enrichment result is present, using conditional spread. This means captures work even before the Notion fields are added to the database.

- [ ] **Step 1: Update `createFeedback` in `notionWriter.ts`**

  Replace the `properties` object inside `this.client.pages.create(...)`:

  ```typescript
  properties: {
    Message: { title: [{ text: { content: r.message.slice(0, MAX_TEXT) } }] },
    Channel: { rich_text: [{ text: { content: r.channelName.slice(0, MAX_TEXT) } }] },
    Author: { rich_text: [{ text: { content: r.authorName.slice(0, MAX_TEXT) } }] },
    Date: { date: { start: r.dateIso } },
    "Flagged By": { rich_text: [{ text: { content: r.flaggedByName.slice(0, MAX_TEXT) } }] },
    Status: { select: { name: "New" } },
    Source: { rich_text: [{ text: { content: r.source.slice(0, MAX_TEXT) } }] },
    "Message URL": { url: r.messageUrl || null },
    "Customer/Account": {
      rich_text: r.customerAccount
        ? [{ text: { content: r.customerAccount.slice(0, MAX_TEXT) } }]
        : [],
    },
    ...(r.summary
      ? { Summary: { rich_text: [{ text: { content: r.summary.slice(0, MAX_TEXT) } }] } }
      : {}),
    ...(r.category ? { Category: { select: { name: r.category } } } : {}),
  },
  ```

- [ ] **Step 2: Verify typecheck passes**

  ```
  npm run typecheck
  ```

  Expected: no errors.

- [ ] **Step 3: Run tests to confirm nothing regressed**

  ```
  npm test
  ```

  Expected: 9/9 pass.

- [ ] **Step 4: Commit**

  ```
  git add src/adapters/notion/notionWriter.ts
  git commit -m "feat(slice4): write Summary and Category to Notion when enrichment present"
  ```

---

## Task 6: Config + wiring + `.env.example`

**Files:**
- Modify: `src/config.ts`
- Modify: `src/index.ts`
- Modify: `.env.example`

Wire `ClaudeEnricher` when `ANTHROPIC_API_KEY` is set; `NullEnricher` otherwise.

- [ ] **Step 1: Add `anthropicApiKey` to `config.ts`**

  Add `anthropicApiKey?: string` to the `Config` interface:

  ```typescript
  export interface Config {
    slackBotToken: string;
    slackAppToken: string;
    captureSink: CaptureSink;
    notionApiKey?: string;
    notionDatabaseId?: string;
    capturesFilePath: string;
    triggerEmoji: string;
    dedupStorePath: string;
    anthropicApiKey?: string;
  }
  ```

  Add to `loadConfig()` (inside the returned config object):

  ```typescript
  anthropicApiKey: optional("ANTHROPIC_API_KEY"),
  ```

- [ ] **Step 2: Wire enricher in `index.ts`**

  Add imports at the top of `src/index.ts`:

  ```typescript
  import { ClaudeEnricher } from "./adapters/enricher/claudeEnricher.js";
  import { NullEnricher } from "./adapters/enricher/nullEnricher.js";
  import type { Enricher } from "./core/ports.js";
  ```

  In `main()`, after `logger.info(`Capture sink: ${config.captureSink}`)`, add:

  ```typescript
  const enricher: Enricher = config.anthropicApiKey
    ? new ClaudeEnricher(config.anthropicApiKey)
    : new NullEnricher();
  logger.info(
    config.anthropicApiKey ? "Enrichment enabled (Claude Haiku)" : "Enrichment disabled — set ANTHROPIC_API_KEY to enable",
  );
  ```

  Add `enricher` to the `deps` object:

  ```typescript
  const deps: CaptureDeps = {
    slack,
    notion: feedbackWriter,
    dedup,
    logger,
    source: "Slack",
    botUserId,
    enricher,
  };
  ```

- [ ] **Step 3: Update `.env.example`**

  Add after the `NOTION_DATABASE_ID` block:

  ```
  # --- AI Enrichment (optional) ---
  # When set, each captured message is auto-summarised and categorised before writing to Notion.
  # Uses claude-haiku-4-5-20251001. Leave blank to disable enrichment.
  ANTHROPIC_API_KEY=sk-ant-...
  ```

- [ ] **Step 4: Verify typecheck + tests pass**

  ```
  npm run typecheck && npm test
  ```

  Expected: typecheck clean, 9/9 tests pass.

- [ ] **Step 5: Commit**

  ```
  git add src/config.ts src/index.ts .env.example
  git commit -m "feat(slice4): wire ClaudeEnricher/NullEnricher from ANTHROPIC_API_KEY config"
  ```

---

## Pre-go-live manual steps (not code)

Before testing with `CAPTURE_SINK=notion`:

1. Add `Summary` (type: **Text**) property to the "Customer Feedback" Notion database.
2. Add `Category` (type: **Select**) property with these exact options:
   - Bug / Broken
   - Feature Request
   - Pricing / Commercial
   - Onboarding / Setup
   - UX / Usability
   - Reporting / Data
   - Praise
   - Other
3. Set `ANTHROPIC_API_KEY=sk-ant-...` in `.env`.
4. Restart bot: `npm start`.
5. Smoke test: react `:mega:` to a message → verify Notion row has Summary and Category populated.
