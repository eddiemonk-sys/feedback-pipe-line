# Feedback Pipeline

Real-time Slack → Notion feedback capture for Spotted Zebra, with AI summarisation,
categorisation, a self-checking "judge" layer, and screenshot understanding.

React **`:mega:`** to any message (or **`@mention`** the bot) in a channel it's invited to, and it
captures the message into the **"Customer Feedback"** Notion database — enriched with an AI
summary, a category, a confidence check on that enrichment, and (in the test channel only, for
now) a description of any attached screenshot. It acks with ✅ (or ⚠️ on failure).

Built incrementally, slice by slice, on a ports & adapters architecture so each capability is a
swappable adapter behind a stable interface — not a rewrite.

## What it actually does today

1. **Capture** — `:mega:` reaction or `@mention` (context-aware: a threaded @mention captures the
   *parent* message; a standalone one captures itself) in any channel the bot is invited to.
2. **Dedup** — per-message, first-reactor-wins. A second flag adds a co-flagger to the existing row
   instead of creating a duplicate.
3. **Enrich** — a 1–2 sentence AI summary and one of 10 categories (Bug/Broken, Feature Request,
   Pricing/Commercial, Onboarding/Setup, UX/Usability, Reporting/Data, Praise, Other, Candidate
   Experience, Assessment Accuracy/Validity).
4. **Judge** — a second AI pass checks the summary and category against the *original* message
   (not against its own preference) and records a `High`/`Medium`/`Low` confidence + a short
   rationale, so nothing is silently trusted without a spot-check trail. Never silently drops
   anything — low confidence just gets flagged more visibly, not discarded.
5. **See** — if a screenshot is attached, Claude vision describes what's shown (error dialogs,
   broken UI, etc.) and stores that description. **Currently restricted to the test channel only**
   pending an internal data-handling review — see `ENRICHMENT-DESIGN-DECISIONS.md` before changing
   `VISION_ENABLED_CHANNEL_IDS`.
6. **Ack** — ✅/⚠️ reaction, plus a threaded reply for `@mention` captures.

## How it's built (and why)

**Ports & adapters.** Everything in `src/core/` depends only on interfaces and consumes a
normalized `CaptureRequest` — it has **zero knowledge** of how the event arrived, which sink it's
writing to, or which AI is doing the enrichment/judging/vision. Every capability above is a
separate port with a real adapter (calls a live service) and a null adapter (safe no-op, used when
its API key isn't configured). Swapping any one of them is a one-file change; `core/` never moves.

```
src/
  config.ts                          env loading + validation
  index.ts                           composition root: builds every adapter, wires the handler, acks
  core/                              pure business logic — no vendor SDK imports
    events.ts                       CaptureRequest — the transport-agnostic seam
    ports.ts                        every interface: SlackGateway, NotionWriter, DedupStore,
                                     Enricher, Judge, VisionReader
    taxonomy.ts                     the shared category list (enricher + judge both read this,
                                     so they can never drift apart)
    handleCapture.ts                the actual logic: dedup → fetch → enrich → judge → vision → write
    handleCapture.test.ts           unit tests with fake ports (no live services), TDD throughout
  adapters/
    transport/socketMode.ts         receives reaction_added / app_mention, normalizes to CaptureRequest
    slack/boltGateway.ts            SlackGateway — @slack/web-api, incl. authenticated image download
    notion/notionWriter.ts          NotionWriter — the real Notion API
    notion/localWriter.ts           NotionWriter — local JSONL file (CAPTURE_SINK=file, for testing)
    dedup/fileStore.ts              DedupStore — dependency-free JSON file (key → Notion page ID)
    enricher/claudeEnricher.ts      Enricher — Claude Haiku, structured output
    enricher/nullEnricher.ts        Enricher — no-op (used when ANTHROPIC_API_KEY unset)
    judge/claudeJudge.ts            Judge — reference-grounded against the original message
    judge/nullJudge.ts              Judge — no-op
    vision/claudeVisionReader.ts    VisionReader — Claude vision, image-then-text ordering
    vision/nullVisionReader.ts      VisionReader — no-op
  util/logger.ts
```

---

## Prerequisites

### 1. Slack app setup

1. https://api.slack.com/apps → your app → **Socket Mode** enabled, with an App-Level Token
   (`connections:write` scope) → this is `SLACK_APP_TOKEN`.
2. **Bot Token Scopes** (OAuth & Permissions):
   - `reactions:read`, `reactions:write` — receive/ack `:mega:` reactions
   - `channels:history`, `channels:read` — read/resolve public channels
   - `groups:history`, `groups:read` — same, for private channels
   - `users:read` — resolve display names
   - `app_mentions:read`, `chat:write` — `@mention` trigger + threaded reply acks
   - `files:read` — download attached screenshots for vision
3. **Event Subscriptions** → subscribe to bot events: `reaction_added`, `app_mention`.
4. **Install/reinstall** the app → copy the Bot User OAuth Token (`xoxb-…`) → this is
   `SLACK_BOT_TOKEN`.
5. **Invite the bot** to every channel it should capture from — channel scope is
   membership-based, there's no allow-list. `/invite @YourBotName`.

### 2. Notion database schema

The "Customer Feedback" database needs these properties (create any that don't already exist —
**do this before running with a new field enabled**, or writes to it will fail):

| Property | Type | Notes |
|---|---|---|
| `Message` | Title | |
| `Channel`, `Author`, `Flagged By`, `Source` | Text | |
| `Date` | Date | |
| `Message URL` | URL | |
| `Customer/Account` | Text | currently always blank — awaiting CRM linkage |
| `Status` | Select | `New` / `Reviewed` / `Actioned` — human-owned, the bot never writes to it beyond the initial `New` |
| `Category` | Select | the 10 values listed above |
| `Summary` | Text | |
| `Enrichment Confidence` | Select | `High` / `Medium` / `Low` |
| `Judge Rationale` | Text | |
| `Visual Description` | Text | |

Share the database with your Notion integration (••• menu → Connections → Connect to) and copy
the internal integration secret → `NOTION_API_KEY`.

---

## Run it

```powershell
copy .env.example .env          # fill in the tokens/keys — see table below
npm install
npm run typecheck               # optional — confirms it compiles
npm test                        # optional — runs the core unit tests
npm start
```

You should see startup lines confirming what's enabled:
```
Capture sink: notion
Enrichment enabled (Claude Haiku)
Judging enabled (category + summary checks)
Vision enabled for 1 channel(s)
⚡ Socket Mode connected
```

---

## Configuration (`.env`)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `SLACK_BOT_TOKEN` | yes | — | `xoxb-…` |
| `SLACK_APP_TOKEN` | yes | — | `xapp-…` (Socket Mode) |
| `CAPTURE_SINK` | no | `notion` | `notion` or `file` (writes JSONL locally, no Notion needed) |
| `NOTION_API_KEY` / `NOTION_DATABASE_ID` | yes if `CAPTURE_SINK=notion` | — | Notion integration secret / DB ID |
| `TRIGGER_EMOJI` | no | `mega` | Emoji name, no colons |
| `DEDUP_STORE_PATH` | no | `./data/dedup.json` | Must be on persistent storage if hosted — see note below |
| `ANTHROPIC_API_KEY` | no | — | Enables enrichment + judge + vision together. Unset = all three are safe no-ops |
| `VISION_ENABLED_CHANNEL_IDS` | no | *(blank)* | Comma-separated channel IDs. **Fails closed** — blank means vision runs nowhere, even with a key set |

**Hosting note:** if this ever runs somewhere other than a local machine, `DEDUP_STORE_PATH` must
point at storage that survives a restart/redeploy. A wiped dedup file means the bot forgets what
it already captured and can create duplicate Notion rows on re-reaction.

---

## Testing the end-to-end flow

1. React `:mega:` (or `@mention`) to a message in a channel the bot's in → a new Notion row
   appears within a couple seconds, tagged with a summary, category, and confidence, and the
   message gets a ✅.
2. React again on the same message → no duplicate row; the new reactor is added to "Flagged By".
3. In the test channel only, attach a screenshot to a message and capture it → check "Visual
   Description" populated on the Notion row.

---

## Current status & what's next

- **Live and built:** everything in "What it actually does today" above.
- **Not built yet:** an "is this even feedback?" gate (deliberately deferred — see
  `ENRICHMENT-DESIGN-DECISIONS.md` §2), a 4-month Slack-history backfill/triage agent, always-on
  hosting (the bot currently only runs while its terminal stays open), and storing the actual
  screenshot file in Notion (currently just a text description — see §"BUILD COMPLETE: vision" in
  the decisions doc for why).
- **Read before expanding scope:** `ENRICHMENT-DESIGN-DECISIONS.md` — locked design decisions plus
  an honest log of what's been explicitly overridden vs. genuinely cleared regarding an ongoing
  internal data-handling review. Don't assume time passing has resolved anything there.
- **Related, separate project:** a sibling "Competitor Insights" bot for a different Slack channel
  — see `competitor-insights-capture-BRIEF.md` (in the parent directory), not part of this repo's
  scope.
