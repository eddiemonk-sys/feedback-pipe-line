# Feedback Pipeline — Slice 2

Real-time Slack → Notion feedback capture. React to any message with **`:mega:`** in the test
channel and the bot captures it to the existing **"Customer Feedback"** Notion database, then adds
a ✅ reaction (or ⚠️ if the write failed).

This is **Slice 2** of a larger roadmap. It deliberately does *only* this — single channel, single
trigger, no summarisation. See the "Growing it" section for how later slices slot in.

## How it's built (and why)

**Ports & adapters.** The business logic in `src/core/` depends only on interfaces (ports) and
consumes a normalized `CaptureRequest`. It has **zero knowledge** of how the event arrived. The
Socket Mode connection is just one adapter. Switching to HTTP webhooks later means adding one
transport file and changing one line in `index.ts` — `core/` is never touched.

```
src/
  config.ts                     env loading + validation
  index.ts                      composition root: builds adapters, wires the handler, acks
  core/                         pure business logic — no SDK imports
    events.ts                   CaptureRequest (the transport-agnostic seam)
    ports.ts                    SlackGateway / NotionWriter / DedupStore interfaces
    handleCapture.ts            fetch → dedup → write → record (the actual logic)
    handleCapture.test.ts       unit tests with fake ports (no live services)
  adapters/
    transport/socketMode.ts     receives reaction_added, normalizes to CaptureRequest
    slack/boltGateway.ts        SlackGateway via @slack/web-api
    notion/notionWriter.ts      NotionWriter via the official Notion API
    dedup/fileStore.ts          DedupStore via a dependency-free JSON file
  util/logger.ts
```

---

## Prerequisites

### 0. Install Node.js  ← not currently installed on this machine

```powershell
winget install OpenJS.NodeJS.LTS
```
Then **restart your terminal** and confirm (need v20 or newer):
```powershell
node --version
```
(Alternatively download the LTS installer from https://nodejs.org.)

### 1. Create the Slack app

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch** → select the
   **spottedzebra** workspace.
2. **Enable Socket Mode:** *Settings → Socket Mode → Enable*. When prompted, generate an
   **App-Level Token** with the **`connections:write`** scope → copy it (`xapp-…`) →
   this is `SLACK_APP_TOKEN`.
3. **Add bot scopes:** *Features → OAuth & Permissions → Bot Token Scopes*, add:
   - `reactions:read`  (receive the reaction event)
   - `reactions:write` (add the ✅ / ⚠️ ack)
   - `channels:history` (read the flagged message)
   - `channels:read`   (resolve the channel name)
   - `users:read`      (resolve author / reactor display names)
   - *(for private channels also `groups:history`, `groups:read`)*
4. **Subscribe to the event:** *Features → Event Subscriptions → Enable*. Under
   **Subscribe to bot events** add **`reaction_added`**. (Socket Mode means **no Request URL** is
   needed.) Save.
5. **Install:** *Settings → Install App → Install to Workspace* → copy the
   **Bot User OAuth Token** (`xoxb-…`) → this is `SLACK_BOT_TOKEN`.
6. **Invite the bot to the channel.** In Slack, in `#test-bot-to-capture-feedback`, type
   `/invite @YourBotName`. **Required** — it can't read history or receive events otherwise.

### 2. Notion integration

1. Go to https://www.notion.so/my-integrations → open (or create) your internal integration →
   copy the **Internal Integration Secret** → this is `NOTION_API_KEY`.
2. **Share the database with the integration** (the #1 gotcha — a valid key still 404s without
   this): open the **Customer Feedback** database in Notion → **•••** menu → **Connections** →
   **Connect to** → pick your integration.

---

## Run it

```powershell
# from C:\Users\eddie\feedback-pipeline
copy .env.example .env          # then open .env and fill in the four tokens
npm install
npm run typecheck               # optional — confirms it compiles
npm test                        # optional — runs the core unit tests
npm start
```

You should see: `⚡ Socket Mode connected — listening for :mega: reactions`.

### Test the end-to-end flow
1. In `#test-bot-to-capture-feedback`, react to any message with **`:mega:`**.
2. Within ~1s a new row appears in the **Customer Feedback** database, and the message gets a ✅.
3. React `:mega:` again on the same message → **no** duplicate row (dedup).
4. Stop the bot with **Ctrl+C**.

---

## Configuration (`.env`)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `SLACK_BOT_TOKEN` | yes | — | `xoxb-…` bot token |
| `SLACK_APP_TOKEN` | yes | — | `xapp-…` app-level token (Socket Mode) |
| `NOTION_API_KEY` | yes | — | Notion internal integration secret |
| `NOTION_DATABASE_ID` | yes | `30f9ce0b…f33cee` | Customer Feedback DB (already exists) |
| `TRIGGER_EMOJI` | no | `mega` | Emoji name without colons |
| `TARGET_CHANNEL_IDS` | no | `C0BDD5KE91V` | Comma-separated; blank = all channels the bot is in |
| `DEDUP_STORE_PATH` | no | `./data/dedup.json` | JSON dedup log |

---

## Growing it (later slices — not built yet)

- **Slice 3 — HTTP webhook + `@mention`:** add `src/adapters/transport/httpEvents.ts` exposing the
  same `(options, onCapture)` contract and flip the call in `index.ts`. For `@mention`, emit a
  `CaptureRequest` with `triggerType: "mention"`. **`core/` does not change.**
- **Slice 4 — summarisation:** add a `Summariser` port and one step in `handleCapture`.
- **Slice 5 — classification / cross-channel dedup:** new ports; the SQLite store stays or is swapped.

All of these are additive because the seams are already in place.
