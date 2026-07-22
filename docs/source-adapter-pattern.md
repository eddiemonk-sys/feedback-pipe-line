# Adding a New Feedback Source — Adapter Pattern

This document is the answer to "how do we add a new source?" (DS-75).
Follow these steps and a new source is a small, repeatable piece of work.

---

## How the pipeline works

The pipeline uses a **ports-and-adapters** (hexagonal) architecture.
The core logic lives in `src/core/` and knows nothing about Slack, Typeform,
or any other source. Sources talk to the core through a single normalised
event type — `CaptureRequest` — and the core produces a `CaptureResult`.

```
Source  →  [your new adapter]  →  CaptureRequest  →  handleCapture  →  Notion
```

Everything in `src/adapters/` is a concrete implementation of a core port.
Adding a source means adding one adapter file (or a small folder) and one
wiring call in `src/index.ts`. Nothing in `src/core/` changes.

---

## Step-by-step: adding a new source

### 1. Define how the source delivers events

Sources come in two shapes:

| Shape | Example | Pattern |
|-------|---------|---------|
| **Push** — source calls you | Slack webhooks, Typeform webhooks | HTTP endpoint wired in `src/adapters/transport/httpMode.ts` |
| **Poll** — you call the source | Granola meeting notes, Jira CS tickets | Poller started in `src/index.ts` like `startGranolaPoller` |

### 2. Create the adapter file

Create `src/adapters/<source>/<source>Adapter.ts`.

The adapter's job is to:
1. Receive or fetch raw events from the source
2. Normalise them into a `CaptureRequest`
3. Call `onCapture(req)` (the function wired in from `index.ts`)

**Minimal example (poll-based):**

```typescript
// src/adapters/typeform/typeformAdapter.ts
import type { CaptureRequest } from "../../core/events.js";

export interface TypeformAdapterDeps {
  onCapture: (req: CaptureRequest) => Promise<void>;
  // add your API client here
}

export function startTypeformPoller(
  deps: TypeformAdapterDeps,
  pollIntervalMs = 300_000,
): void {
  const poll = async () => {
    // fetch from Typeform API, map to CaptureRequest[], call onCapture for each
  };
  poll();
  setInterval(poll, pollIntervalMs);
}
```

**The `CaptureRequest` type** (`src/core/events.ts`):

```typescript
export interface CaptureRequest {
  triggerType: "reaction" | "mention" | "live_gate" | "backfill" | "granola";
  channelId: string;   // source identifier — use a stable ID, not a display name
  messageTs: string;   // unique message/item ID within the source
  triggeredBy: string; // user ID or system identifier
  text?: string;       // raw text to capture (if available at request time)
  imageUrls?: string[];
  initialStatus?: string; // "New" (default) or "Needs Review"
}
```

For non-Slack sources, use the source name as `channelId` (e.g. `"typeform"`,
`"jira-cs"`) and the item's native ID as `messageTs`.

### 3. Enrich the `Source` field in Notion

The `source` field on each capture tells you where it came from. It flows through
`handleCapture` → `NotionFeedbackWriter`.

Currently valid source strings (the `Source` rich-text field in Notion):
- `"Slack"` — emoji/mention/live-gate triggers
- `"Granola"` — meeting-notes poller
- `"Backfill"` — historical import

Add your source string to this list when you wire it in.

### 4. Wire it into `src/index.ts`

Near the bottom of `main()`, after the Granola poller block, add:

```typescript
// YourSource adapter (DS-XX)
if (config.yourSourceApiKey) {
  startYourSourcePoller({
    onCapture,
    // pass any other deps
  });
  logger.info("YourSource poller started");
} else {
  logger.info("YourSource disabled — set YOUR_SOURCE_API_KEY to enable");
}
```

Follow the **fail-open** convention: if the env var is absent, log and skip —
never throw at startup.

### 5. Add env vars to `src/config.ts` and `.env.example`

Add any new env vars as `optional(...)` fields in `loadConfig()`. Mark them
optional even if the source won't work without them — the startup guard lives
in the adapter, not in config validation.

### 6. Test it

```bash
# Confirm the adapter produces valid CaptureRequests without hitting production:
CAPTURE_SINK=file npm run dev

# Check ./data/captures.jsonl for the output
```

The `CAPTURE_SINK=file` mode writes to a local JSONL file instead of Notion,
so you can iterate without touching the live database.

---

## Existing adapters to use as reference

| Adapter | Location | Shape |
|---------|----------|-------|
| Slack (HTTP) | `src/adapters/transport/httpMode.ts` | Push — Bolt ExpressReceiver |
| Granola | `src/adapters/granola/granolaAdapter.ts` | Poll — `setInterval` |
| Backfill | `scripts/backfillScan.ts` | One-shot scan |

The Granola adapter is the cleanest poll-based example to copy.

---

## Checklist for a new source

- [ ] `src/adapters/<source>/<source>Adapter.ts` created
- [ ] Normalises to `CaptureRequest` with correct `triggerType` and `channelId`
- [ ] Uses `CAPTURE_SINK=file` for local testing
- [ ] `src/index.ts` wired with fail-open guard
- [ ] `src/config.ts` updated (optional fields only)
- [ ] `.env.example` updated with the new vars and instructions
- [ ] Pushed to both remotes (`origin` + `company`)
