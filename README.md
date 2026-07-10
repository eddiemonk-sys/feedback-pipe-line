# Feedback Pipeline

A Slack → Notion **customer-feedback capture and enrichment bot** for Spotted Zebra, with AI
summarisation, categorisation, a self-checking "judge" layer, screenshot understanding, duplicate
detection, and a human-curated learning loop.

React **`:mega:`** to any message (or **`@mention`** the bot) in a channel it's invited to, and it
captures that message into the **"Customer Feedback"** Notion database — enriched with an AI
summary, a category, a confidence check on that enrichment, a description of any attached
screenshot, and a link to any earlier feedback it looks like a duplicate of. It acks with ✅
(or ⚠️ on failure).

> **The program lives here; the data does not.** Feedback rows live in Notion. Secrets live in a
> local `.env` (git-ignored). This repo is just the code.

Built incrementally, slice by slice, on a ports & adapters architecture so each capability is a
swappable adapter behind a stable interface.

## What it does today

1. **Capture** — `:mega:` reaction or `@mention` (context-aware: a threaded @mention captures the
   *parent* message) in any channel the bot is invited to.
2. **Dedup** — per-message, first-reactor-wins. A second flag adds a co-flagger to the existing row
   instead of creating a duplicate.
3. **See** — if a screenshot is attached (in a vision-enabled channel), Claude vision describes it,
   the description is folded into the summary, and the image file itself is attached to the Notion
   row.
4. **Enrich** — a 1–2 sentence AI summary + one of 10 categories (Bug/Broken, Feature Request,
   Pricing/Commercial, Onboarding/Setup, UX/Usability, Reporting/Data, Praise, Candidate Experience,
   Assessment Accuracy/Validity, Other).
5. **Judge** — a second AI pass checks the summary + category against the *original* message and
   records `High`/`Medium`/`Low` confidence + a short rationale. Nothing is discarded on low
   confidence — just flagged.
6. **Link related** — checks recent same-category rows for a likely duplicate and links them, with a
   rationale.
7. **Write + ack** — one enriched row into Notion; ✅/⚠️ reaction, plus a threaded reply for
   `@mention` captures.

Every AI/network step is **fail-open**: if vision, enrichment, judging, or the similarity check
fails, the capture still succeeds with whatever worked. A capture is never lost to a flaky API.

## Beyond live capture

- **Backfill toolkit** (`scripts/backfillScan.ts` → `backfillCapture.ts`): scan weeks of channel
  history, stage likely-feedback in a disposable Notion "Backfill Review" DB for a human to tick,
  then capture the confirmed ones. Uses a high-recall **feedback gate** (`adapters/gate/`) that only
  runs for backfill, not the live pipeline.
- **Distilled-rules learning loop**: human review corrections become curated rules the AI follows
  (see below).
- **Accuracy report** (`npm run report`): AI-vs-human agreement rates to a Notion page.

## Architecture — ports & adapters (hexagonal)

Everything in `src/core/` depends only on the interfaces in `ports.ts` and consumes a normalized
`CaptureRequest` — it has **zero knowledge** of how the event arrived, which sink it writes to, or
which AI does the work. Each capability is a port with a real adapter and a `null` no-op (used when
its API key isn't configured). Swapping one is a one-file change; `core/` never moves.

```
src/
  config.ts                          env loading + validation
  index.ts                           composition root: builds adapters, wires the handler, acks
  core/
    events.ts                        CaptureRequest — the transport-agnostic seam
    ports.ts                         every interface (SlackGateway, NotionWriter, Enricher, Judge,
                                      VisionReader, SimilarityDetector, DedupStore, FeedbackGate…)
    handleCapture.ts                 the flow: dedup → fetch → vision → enrich → judge → similar → write
    taxonomy.ts                      the shared category list (enricher + judge read the same source)
    promptGuidance.ts                injects the distilled-rules guides into system prompts
    accuracyReport.ts / correctionLog.ts   analysis of human-reviewed rows
    *.test.ts                        unit tests with fake ports (TDD throughout)
  adapters/
    slack/         SlackGateway — @slack/bolt + web-api (incl. authenticated image download)
    notion/        NotionWriter — real Notion API (+ a local JSONL writer for CAPTURE_SINK=file)
    enricher/      Enricher — Claude Haiku, structured output   (real + null)
    judge/         Judge — reference-grounded against the original message   (real + null)
    vision/        VisionReader — Claude vision   (real + null)
    similarity/    SimilarityDetector — duplicate detection   (real + null)
    gate/          FeedbackGate — backfill-only "is this feedback?" check   (real + null)
    dedup/         DedupStore — dependency-free JSON file (key → Notion page ID)
  backfill/        history scan, review DB, image upload, decisions
  util/            logger, guide-file loader
docs/              the human-curated distilled-rules guides (loaded at startup)
scripts/           operational tools (backfill, correction-log, accuracy report, test-db)
```

## Setup

Requires **Node ≥ 24**.

```bash
npm install
cp .env.example .env      # fill in values — see below
npm run typecheck
npm test
```

### Slack app

- **Socket Mode** on, with an App-Level Token (`connections:write`) → `SLACK_APP_TOKEN`.
- **Bot scopes:** `reactions:read`, `reactions:write`, `channels:history`, `channels:read`,
  `groups:history`, `groups:read`, `users:read`, `app_mentions:read`, `chat:write`, `files:read`.
- **Event subscriptions:** `reaction_added`, `app_mention`.
- Bot User OAuth Token (`xoxb-…`) → `SLACK_BOT_TOKEN`. **Invite the bot** to every channel it should
  capture from — scope is membership-based, no allow-list.

### Notion "Customer Feedback" database

Already exists — **do not recreate it.** Share it with your integration (••• → Connections) and use
the integration secret as `NOTION_API_KEY`. Properties the bot reads/writes:

| Property | Type | Notes |
|---|---|---|
| `Message` | Title | |
| `Channel`, `Author`, `Flagged By`, `Source` | Text | |
| `Date` | Date | |
| `Message URL` | URL | |
| `Customer/Account` | Text | currently blank — awaiting CRM linkage |
| `Status` | Select | `New` on write; human-owned thereafter |
| `Category` / `Summary` | Select / Text | the human-editable classification |
| `AI Suggested Category` / `AI Suggested Summary` | Select / Text | **frozen** copy of the AI's original call — the yardstick corrections diff against; never hand-edit |
| `Enrichment Confidence` / `Judge Rationale` | Select / Text | the judge's output |
| `Visual Description` | Text | vision's description of a screenshot |
| `Image` | Files & media | the screenshot file itself (see Gotchas) |
| `Related Feedback` / `Related Count` / `Related Feedback Rationale` | Relation / Rollup / Text | duplicate linking |
| `Category Reviewed` / `Summary Verdict` / `Related Feedback Verdict` | Checkbox / Select / Select | human-review signals the learning loop reads |

### Environment variables

`.env.example` is the canonical, commented list. Essentials: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`,
`ANTHROPIC_API_KEY`, `NOTION_API_KEY`, `NOTION_DATABASE_ID`. Optional: `CAPTURE_SINK` (`notion`|`file`),
`TRIGGER_EMOJI`, `DEDUP_STORE_PATH`, `VISION_ENABLED_CHANNEL_IDS`, `SIMILARITY_WINDOW_DAYS`, the
`BACKFILL_*` settings, and the distilled-guide paths. **Never commit real secret values** — `.env`
is git-ignored; configure secrets separately in any new environment.

**Hosting note:** if hosted, `DEDUP_STORE_PATH` must point at storage that survives a
restart/redeploy — a wiped dedup file means the bot forgets what it captured and can create
duplicate rows on re-reaction.

## Running

```bash
npm run dev     # start with hot-reload (tsx watch)
npm start       # start once
```

## Operational scripts

| Command | What it does |
|---|---|
| `npm run correction-log` | Extracts where a human corrected the AI (from Notion) into `enrichment-correction-log.md` / `similarity-correction-log.md` (git-ignored — raw customer text). |
| `npm run report` | Writes an AI-vs-human agreement-rate summary to a Notion page. Read-only. |
| `npm run setup:test-db` | Creates a throwaway Notion test database. |
| `npx tsx scripts/backfillScan.ts` | Scans `BACKFILL_CHANNEL_IDS` over `BACKFILL_WEEKS_BACK` weeks → stages candidates in a disposable "Backfill Review" DB. |
| `npx tsx scripts/backfillCapture.ts` | Captures the ticked review rows into Customer Feedback (re-enriched, corrections applied, marked reviewed, :mega: added). |

## The distilled-rules learning loop

Corrections are **curated by a human into rules — never auto-injected.**

1. A human reviews rows in Notion (correcting category/summary, flagging bad links).
2. `npm run correction-log` extracts those corrections into the local log files.
3. A human distils recurring patterns into `docs/enrichment-style-guide.md` /
   `docs/similarity-rules.md`.
4. On startup the enricher + similarity detector load those guides into their prompts (startup logs
   the loaded rule count). Future calls follow the learned preferences.

The frozen `AI Suggested *` fields are the yardstick this loop diffs against — **never hand-edit
them.**

## Status & roadmap

Tracked on the Jira DS board as five slices (one epic each):

1. **Slice 1 — Slack Capture** *(largely built & live in #client-feedback)*: capture, enrichment,
   judging, dedup, related-feedback linking, vision, backfill, and the learning loop.
2. **Slice 2 — Synthesise & Surface**: a weekly themed + frequency digest (Notion → Slack).
3. **Slice 3 — Broaden Ingestion**: Typeform / Jira CS / Granola sources; reliably telling feedback
   from ordinary chat (the live "is this feedback?" gate).
4. **Slice 4 — Tag, Theme & Aggregate Without Noise**: shared taxonomy, cross-source dedup,
   ARR-weighting.
5. **Slice 5 — Prioritise & Close the Loop**: status digests, Slack replies to submitters, routing
   to Jira.

## Gotchas

- **Screenshot attachment needs the `Image` column.** For a captured row to carry its screenshot,
  the Customer Feedback DB must have an `Image` (Files & media) property. Without it, *image-bearing*
  captures error and are skipped; text-only captures are unaffected, and the visual *description* is
  stored either way.
- **Vision is opt-in per channel** via `VISION_ENABLED_CHANNEL_IDS` (fails closed — blank = nowhere).
  Sending screenshots to Claude for the real feedback channels was cleared in the 2026-07-06 AI/data
  review.
- **`docs/*.md` guides load at startup** — editing them changes AI behaviour on the next restart,
  not live.
- **The bot runs only while its process is up** — always-on hosting isn't set up yet.
