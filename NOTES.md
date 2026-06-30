# NOTES.md — Feedback Pipeline, Slice 2 (Slack :mega: → Notion)   (updated: 2026-06-29)

## GOAL
A locally-run Node/TypeScript Slack bot that, in real time via Socket Mode, captures any message
reacted to with :mega: in #test-bot-to-capture-feedback and writes it as a row in the existing
Notion "Customer Feedback" database — with dedup and a ✅/⚠️ acknowledgment reaction.

## HARD CONSTRAINTS
- Socket Mode (no public URL / webhook server). App-level token (xapp-) required.
- Transport STRICTLY decoupled from business logic (ports & adapters). Core consumes a normalized
  CaptureRequest and has ZERO knowledge of how the event arrived.
- Seam = CaptureRequest { triggerType: "mega_reaction" | "mention", channelId, messageTs, triggeredBy }
  so Slice 3's @mention slots in with no core rename.
- Dedup non-negotiable: per-message (first reactor wins), key = `${channelId}:${messageTs}`.
  Record ONLY after a successful Notion write.
- Do NOT recreate the Notion DB. Write to existing data source 329cad40-3b7b-42ba-b4dc-e79e55082c6f.
- Runtime uses official Slack app + Notion REST API — NOT the MCP connectors (MCP can't listen for
  events; that's the Slice 1 limitation). MCP is build-time verification only.
- Test channel only: C0BDD5KE91V. Do NOT touch live channels.
- Secrets in gitignored .env; commit .env.example only.
- Node/TypeScript. Modular files; each adapter thin.

## SUCCESS CRITERIA
- Reacting :mega: to a message in the test channel creates exactly one Notion row with:
  Message, Channel, Author, Date, Flagged By, Status=New, Source=Slack, Message URL.
- A second :mega: on the same message creates no new row (dedup).
- Bot adds ✅ on success, ⚠️ on failure.
- Code typechecks; core handler unit-tested with fake ports (no live services).
- README runbook lets the user create the Slack app, share the Notion DB, fill .env, run with
  `npm install && npm start`.

## SLICE 3 — READY TO BUILD (decisions resolved 2026-06-30)
Goal: @mention trigger + membership-based channel scope + multi-flagger support + Customer/Account field.

### Decisions
- **Channel scope:** membership-based — any channel bot is invited to. Remove `TARGET_CHANNEL_IDS` filter.
- **@mention behaviour:** context-aware — thread reply captures parent message (`thread_ts`); standalone mention captures itself (`ts`). Strip `<@BOTID>` from captured text.
- **@mention ack:** threaded reply (`chat.postMessage`) + ✅ reaction on the captured message (which may be the parent).
- **Dedup change:** Don't reject subsequent flaggers — update the existing Notion row's "Flagged By" field to append the new name. Status = "flagger_added". If no pageId stored (legacy entry), fall back to "duplicate".
- **"Flagged By" → list:** stored as comma-separated names in the existing rich_text field.
- **"Customer/Account":** new rich_text field on FeedbackRecord (always ""), must be added to Notion DB manually before go-live.
- **Scope:** build + pilot (local file sink, local run). Invite bot to 1–2 real channels once built.

### What to build (code changes)
1. `app_mention` handler in socketMode transport → CaptureRequest (thread reply → `thread_ts` as `messageTs`; standalone → `ts`).
2. `postReply(channelId, threadTs, text)` on `SlackGateway` port + `BoltSlackGateway` + `LocalFeedbackWriter`.
3. `getBotUserId()` concrete method on `BoltSlackGateway`; inject `botUserId` into `CaptureDeps`; strip `<@botUserId>` from text in `handleCapture` for mention triggers.
4. Ack branches in `index.ts`: `triggerType === "mention"` → `postReply` + ✅; `mega_reaction` → ✅/⚠️ as-is. `flagger_added` → same ack as captured.
5. Remove `TARGET_CHANNEL_IDS` from `config.ts`, `socketMode.ts`, `.env.example`.
6. `DedupStore` port: `record(key, pageId)` + `getPageId(key): string | null`. `FileDedupStore` stores object `{key→pageId}` (backward compat with old array format).
7. `NotionWriter` port: `createFeedback` returns `Promise<string>` (pageId); `appendFlagger(pageId, newFlaggerName)`. `LocalFeedbackWriter` returns synthetic ID; appends a flagger_added line.
8. `handleCapture`: "flagger_added" path when `dedup.has(key)` + pageId exists; "duplicate" if no pageId (legacy). Pass `customerAccount: ""`. Strip bot mention from text.
9. `FeedbackRecord` adds `customerAccount: string`. `notionWriter.createFeedback` writes `"Customer/Account"` property.
10. Update unit tests for new port shapes + "flagger_added" behaviour.

### Slack app changes (requires reinstall)
- Add scopes: `app_mentions:read`, `chat:write`
- Subscribe to event: `app_mention`
- After reinstall: `/invite @Feedback Capture` in target channels

### Pre-go-live manual step
- Add `Customer/Account` (type: Text) property to the "Customer Feedback" Notion DB via UI or MCP before enabling the Notion sink.

## OUT OF SCOPE UNTIL SLICE 4+
- AI summarisation, classification, cross-channel dedup, multi-agent, other platforms, cloud hosting.

## DECISIONS LOG
- Socket Mode over HTTP webhook — delivers "no infra overhead"; swap later via transport adapter only.
- Node/TS with @slack/bolt, @slack/web-api, @notionhq/client, better-sqlite3, dotenv; run via tsx (no build step).
- Acks live in the composition root (index.ts) via the SlackGateway port — shared across future
  transports, keeps both core and transport clean.
- Resolve user IDs → display names (users.info, prefer display_name) and channel id → name
  (conversations.info). Adds users:read + channels:read to scopes (brief's list was incomplete).
- Message URL via chat.getPermalink (robust for threads); dedup key is channelId:messageTs (separate from URL).
- DedupStore behind a port; SQLite (better-sqlite3) default.
- NOTION SCHEMA VERIFIED LIVE via MCP: props Message(title), Channel/Author/Flagged By/Source(text),
  Date(date), Message URL(url), Status(select: New/Reviewed/Actioned). Single data source ->
  write via parent {database_id} on API version 2022-06-28 (most stable; no data-source API needed).
- Pinned @slack/bolt ^3.21 + @slack/web-api ^6.12 (matching) to avoid dual web-api versions;
  default-import App from bolt for CJS interop. Run via tsx, no build step.

## DEAD ENDS
- better-sqlite3 (^11.10) on Node 24.18: no prebuilt binary, and node-gyp compile fails (no
  Python / VS build tools on host). RULED OUT for Slice 2. Swapped DedupStore -> dependency-free
  JSON FileDedupStore (port made it a one-file change). SQLite remains a future drop-in adapter.

## OPEN QUESTIONS
- (resolved) Notion schema + parent — verified live.
- (resolved) Node installed (v24.18 via winget). npm install OK (no native deps after sqlite swap).
- (resolved) tsc --noEmit -> exit 0. npm test -> 5/5 pass.
- Only remaining: end-to-end live run needs the user's Slack app + Notion integration tokens in .env.

## STATE / SCRATCH
- ✅ SLICE 2 WORKING END-TO-END on live Slack (private channel C0BDD5KE91V). Bot captures :mega:
  reactions in real time, writes to local sink (data/captures.jsonl), acks ✅. 2 captures confirmed.
- KEY FIX: channel is PRIVATE -> needed groups:read + groups:history (not just channels:*). Diagnosed
  via scripts/diagnose.ts (prints needed/provided scopes). After adding + reinstall, all green.
- GO LIVE TO NOTION: set NOTION_API_KEY=<ntn_>, CAPTURE_SINK=notion in .env, restart. (DB id already correct.)
- Real Slack domain = spottedzebraworkspace.slack.com (bot's chat.getPermalink is authoritative).

- ✅ SLICE 3 CODE COMPLETE (2026-06-30). tsc clean. 7/7 unit tests pass.
  Built: app_mention handler (thread + standalone), postReply port, botUserId stripping,
  multi-flagger dedup (appendFlagger), Customer/Account field, TARGET_CHANNEL_IDS removed.
  FileDedupStore migrates old array format → object format on first load.

- NEXT STEPS TO GO LIVE WITH SLICE 3:
  1. Slack app reinstall: add scopes app_mentions:read + chat:write, subscribe to app_mention event.
  2. Restart bot: npm start.
  3. Add "Customer/Account" Text property to the Notion "Customer Feedback" DB (UI or MCP).
  4. /invite @Feedback Capture in 1–2 real channels (e.g. #client-feedback).
  5. Test: @mention the bot in one of those channels; confirm threaded reply + ✅ + Notion row.
  6. Test: @mention again with a different user; confirm "Flagged By" field updated (no new row).
