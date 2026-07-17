# DS-73: Granola Ingestion — Implementation Plan

**Date:** 2026-07-17  
**Branch:** work-area3  
**Jira:** DS-73

## Summary

Build a Granola ingestion adapter that polls a specific Granola folder for meeting notes, gates each note (skip internal/no-feedback, capture client feedback), splits each note into individual feedback items, enriches each item, and writes to Notion. Reuses existing pipeline components.

## Files to create

| File | Purpose |
|------|---------|
| `src/adapters/granola/granolaAdapter.ts` | Polls MCP folder, drives pipeline |
| `src/adapters/granola/granolaGate.ts` | Claude-backed gate for Granola notes |
| `src/adapters/granola/nullGranolaGate.ts` | No-op gate (always capture) for tests |
| `src/adapters/granola/granolaAdapter.test.ts` | Unit tests |
| `prompts/granolaGate/v1.md` | Gate system prompt |

## Files to modify

| File | Change |
|------|--------|
| `src/core/ports.ts` | Add `GranolaGate` port, `clientCompany?` and `audience?` to `FeedbackRecord` |
| `src/adapters/notion/notionWriter.ts` | Write `clientCompany` and `audience` to Notion if present |
| `src/adapters/notion/localWriter.ts` | Log new fields (no-op — `createFeedback` already serializes all record fields via JSON.stringify) |
| `src/index.ts` | Start Granola poller alongside HTTP transport |
| `src/config.ts` | Add `GRANOLA_POLL_INTERVAL_MS` and `GRANOLA_FOLDER_ID` |
| `prompts/config.yaml` | Add `granolaGate: v1`, bump `enricher: v17 → v18` |
| `scripts/runEval.ts` | Add `--mode granolaGate` eval |

## Task list

### Task 1: Add new ports and fields to `src/core/ports.ts`

Add to `FeedbackRecord`:
```ts
clientCompany?: string;   // derived from meeting participants / title
audience?: string;        // "Recruiter" | "Talent Leader" | "Candidate" | "Worker" | "Admin" | "Unknown"
```

Add `GranolaClient` port:
```ts
export interface GranolaNote {
  id: string;
  title: string;
  createdAt: string;  // ISO
}

export interface GranolaClient {
  listNotes(folderId: string): Promise<GranolaNote[]>;
  getNoteContent(noteId: string): Promise<string>;  // returns markdown content
}
```

Add `GranolaGate` port:
```ts
export interface GranolaGateResult {
  shouldCapture: boolean;
  reason: string;
}

export interface GranolaGate {
  classify(title: string, markdownContent: string, participants: string[]): Promise<GranolaGateResult | null>;
}
```

### Task 2: Write `prompts/granolaGate/v1.md`

Gate prompt for Granola meeting notes. Must:
- Skip purely internal Spotted Zebra meetings (no external attendees and no client feedback)
- Capture any meeting with an external (non-@spottedzebra.co.uk) attendee
- Capture any meeting note containing client feedback, requests, or product signals
- Return `{ shouldCapture: boolean, reason: string }`

### Task 3: Write `prompts/enricher/v18.md`

Identical to v17 but with one change: replace the opening line "Given a Slack message and its channel" with "Given a meeting note excerpt from a client-facing meeting and its channel/source". Same 11 categories, same lead-sentence+bullets format, same tool schema.

### Task 4: Update `prompts/config.yaml`

```yaml
gate: v7
enricher: v18
judge: v4
threadRouter: v1
granolaGate: v1
```

### Task 5: Implement `src/adapters/granola/granolaGate.ts`

Claude-backed gate for Granola notes. Wraps same LLM call pattern as `claudeFeedbackGate.ts`.

Tool: `submit_granola_gate` with `{ should_capture: boolean, reason: string }`.

Fail-open: returns null on any error.

### Task 6: Implement `src/adapters/granola/nullGranolaGate.ts`

Always returns `{ shouldCapture: true, reason: "null gate — always capture" }`.

### Task 7: Implement `src/adapters/granola/granolaAdapter.ts`

`startGranolaPoller(options, deps, logger)` called from `main()`. Uses `setInterval` (non-blocking).

Options:
```ts
interface GranolaPollerOptions {
  folderId: string;
  pollIntervalMs: number;
}
```

Deps:
```ts
interface GranolaPollerDeps {
  granolaClient: GranolaClient;
  gate: GranolaGate;
  enricher: Enricher;
  judge: Judge;
  notion: NotionWriter;
  dedup: DedupStore;
  similarityDetector: SimilarityDetector;
  similarityWindowDays: number;
  source: string;
}
```

Per-tick logic:
1. `granolaClient.listNotes(folderId)` → notes
2. Filter out notes with `dedup.has("granola:" + note.id)`
3. For each new note:
   a. `granolaClient.getNoteContent(noteId)` → markdown
   b. `gate.classify(title, content, participants)` → skip if `!shouldCapture`
   c. Extract participants from content (lines with `- ` before `### ` heading changes)
   d. `enricher.enrich(content, "Granola")` → enrichments (null → skip)
   e. For each enrichment: `judge.review(...)`, then `notion.createFeedback(...)` with:
      - `source: "Granola"`
      - `authorName: participantNames.join(", ")`
      - `flaggedByName: "Granola (auto)"`
      - `messageUrl: ""` (no Slack URL)
      - `clientCompany`: domain of first external participant email, or title-derived
      - `audience`: "Unknown" (enricher may set it in future)
      - `sourceMessageKey: "granola:" + note.id`
   f. After all enrichments: `dedup.recordMultiple("granola:" + note.id, pageIds)`
   g. Sibling links (pass 2) if multiple rows

### Task 8: Write `src/adapters/granola/granolaAdapter.test.ts`

Tests using stub `GranolaClient` and `nullGranolaGate`:
- Skip note already in dedup store
- Gate returns `shouldCapture=false` → note skipped, not written to notion
- Single-item enrichment → 1 row written, dedup recorded
- Multi-item enrichment → N rows written with sibling links, dedup recorded
- Enricher returns null → note skipped (fail-open)
- Null gate always captures

### Task 9: Update `src/config.ts`

Add:
```ts
granolaPollIntervalMs: number;  // default 300_000 (5 min)
granolaFolderId: string;        // default "0ddcb9b2-4d60-4774-842f-1d7bcd7897ea"
```

### Task 10: Update `src/index.ts`

After `await startHttpMode(...)`, call `startGranolaPoller(...)` if `config.anthropicApiKey` is set.

Wire up a real `GranolaClient` that calls the Granola MCP tools via the MCP connector. For now, create a `McpGranolaClient` stub that logs "Granola MCP not connected — skipping poll" (since we can't call MCP from the Node process directly). Document that Eddie will wire this up once MCP access is confirmed.

Actually, since MCP tools are available in the Claude context but not directly callable from Node, implement a `StubGranolaClient` that returns an empty list (safe no-op). The real MCP integration will come separately. Mark with a `TODO(DS-73-mcp)` comment.

### Task 11: Update `src/adapters/notion/notionWriter.ts`

In `createFeedback`, add to the properties object:
```ts
...(r.clientCompany
  ? { "Client Company": { rich_text: [{ text: { content: r.clientCompany.slice(0, MAX_TEXT) } }] } }
  : {}),
...(r.audience
  ? { "Audience": { select: { name: r.audience } } }
  : {}),
```

### Task 12: Add `--mode granolaGate` to `scripts/runEval.ts`

Reads `data/granola-fixtures/manifest.json`, loads each `.md` file, calls `granolaGate.classify(title, content, [])`, compares `shouldCapture` vs `should_skip` (inverted). Reports precision/recall/F1.

### Task 13: Update `src/util/loadPrompt.ts`

Add `"granolaGate"` to the `PromptKey` type.

## Test commands

```bash
# Run unit tests
node --import tsx --test src/core/*.test.ts src/backfill/*.test.ts "src/adapters/**/*.test.ts"

# Run granola gate eval (requires ANTHROPIC_API_KEY)
npx tsx scripts/runEval.ts --mode granolaGate
```

## Notion DB properties Eddie must add manually

After implementation, Eddie must add these two properties to the "Customer Feedback" Notion database:
1. **Client Company** — Type: `Rich text`
2. **Audience** — Type: `Select` with options: `Recruiter`, `Talent Leader`, `Candidate`, `Worker`, `Admin`, `Unknown`
