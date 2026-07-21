# Feedback Pipeline — PM Action Plan

> Working document for Eddie. Tracks every open decision, who owns it, and what needs collecting before it can be closed. Update this as things get resolved.

Last updated: 21 July 2026

---

## Status snapshot

| Slice | Name | Status |
|-------|------|--------|
| 1 | Slack Capture | ✅ Done |
| 2 | Synthesise & Surface (weekly digest) | 🔨 In progress — waiting on Indigo channel ID + web app connection (tomorrow) |
| 3 | Broaden Ingestion | ⬜ Not started — needs API access |
| 4 | Tag, Theme & Aggregate | ⬜ Not started |
| 5 | Prioritise & Close the Loop | ⬜ Not started |

---

## Open decisions

### D1 — Which Slack channel gets the weekly digest? (DS-68)

**Status:** ✅ Confirmed — Indigo crew channel only

- **Still needed:** The channel ID (C-prefixed). Open the Indigo channel in Slack → click the channel name at the top → scroll to bottom of the About panel → copy the ID.
- Once you paste it, I wire it into Heroku and push immediately.

---

## Resolved decisions

### D2 — Notion API token ✅ Closed

- **Resolution:** Web app is replacing Notion as the data store. Digest will read from the web app, not Notion, once it's connected (planned: 22 July 2026). No token fix needed.
- **Impact on Slice 2:** Digest is blocked until the web app is connected. That's the new blocker, not the token.

### D3 — Taxonomy: keep flat or add dimensions? ✅ Closed (DS-76 Done, DS-77 Done)

- **Resolution:** Option A — keep the 11 flat categories as-is. DS-76 confirmed Done. DS-77 was a no-op.
- **Next:** Extra dimensions (audience, product area, severity) are deferred to Slice 4, once Typeform + Jira CS data is live for calibration.

### D4 — Trend-emergence threshold ✅ Closed (DS-70 Done)

- **Resolution:** Trending 🔥 = 3+ total mentions (2+ linked items). Hot 🚨 = 6+ mentions.
- **Status:** Implemented in digest logic.

---

## People to contact

### Rachel / Indigo crew (capability & crew fields)

- **What to ask:** Capability and Crew field values for the feedback board.
- **Rachel's confirmed areas:** AI Shortlist (primary — JD criteria suggestion, CV upload/processing, scoring, evidence view) + Users & access, Results extracts, Reporting/KPI. This feeds crew tagging.
- **Ticket:** DS-66/68/69
- **Status:** Rachel has provided Indigo's areas. **Still need** confirmation of the complete Capability/Crew value list across all crews.

### Spotted Zebra AI person — channel rollout clearance

- **Status:** ✅ Clearance confirmed (21 July 2026). DS-64 unblocked and moved to To Do.
- **Next step:** Compile the channel IDs to add (format: comma-separated C-IDs), invite the bot, add to `AUTO_CAPTURE_CHANNEL_IDS` in Heroku.
- **Channels to propose:** See DS-64 for the candidate list.
- **Ticket:** DS-64

### Node team / whoever controls Granola MCP

- **What to ask:** Can they expose Granola via MCP from Node.js? The pipeline has a `StubGranolaClient` ready — just needs the real MCP endpoint wired up.
- **Ticket:** DS-73 (In Review)
- **Status:** Adapter built, waiting on their side.

### Typeform owner (Slice 3)

- **What to ask:**
  1. Which Typeform surveys contain feedback to ingest?
  2. API access (API key + form IDs)
  3. How often do responses come in? (to decide pull interval)
- **Ticket:** DS-71 (To Do)

### Jira CS / Support owner (Slice 3)

- **What to ask:**
  1. Which Jira project(s) contain CS support requests and product bugs?
  2. Which issue types should be included?
  3. API access (Jira API token or confirm existing Atlassian credentials work)
- **Ticket:** DS-72 (To Do)

### Whoever runs QBRs / roadmap planning (Slice 2)

- **What to ask:** What format would make the weekly digest most useful in QBR prep? Should it be a Notion page, a Slack post, a CSV export, or all three?
- **Ticket:** DS-86 (To Do)

### Named source owners (DS-87)

- **What to decide:** For each feedback source, who is responsible for reviewing and acting on it?
  - Slack `#client-feedback` → ?
  - Granola call notes → ?
  - Typeform surveys → ?
  - Jira CS tickets → ?
- **Impact:** Affects digest routing (who gets cc'd or alerted per source)

---

## Information to collect

### Indigo channel ID — for digest (DS-68)

The digest is ready. The only thing blocking it is the `DIGEST_SLACK_CHANNEL_ID` Heroku config var. Find the channel ID by clicking the Indigo channel name in Slack → About panel → bottom of the page (starts with C).

### Real Slack message examples for enricher prompt

Three categories in the AI enricher currently use synthetic examples. Real examples make classification noticeably more accurate.

| Category | What to look for |
|----------|-----------------|
| **Reporting / Data** | A message about a report being wrong, missing data, or pipeline data issues |
| **Pricing / Commercial** | A message about pricing being too high, contract terms, or commercial concerns |
| **Other** | A genuine catch-all message that doesn't fit any specific category |

Once you have these, paste them here and I'll update the prompt.

### Channel IDs for Slack expansion (DS-64)

Clearance confirmed. Now compile the list of channel IDs to add to `AUTO_CAPTURE_CHANNEL_IDS`. Format: comma-separated C-IDs. You can find channel IDs the same way as the digest channel (About panel in Slack).

**Proposed channels:** #pde-and-commercial, #ai-interview, #candidate-feedback, #product-customer-success (from DS-64 description). Confirm which of these are in scope before inviting the bot.

---

## Slice-by-slice action plan

### Slice 2 — Synthesise & Surface (immediate)

**What's done:** Digest builder, scheduler, Slack posting, trend threshold (3+/6+) — all coded.

**What's left before it's live:**
1. [ ] You: Connect the web app (planned tomorrow 22 July)
2. [ ] You: Send me the Indigo channel ID
3. [ ] Me: Add `DIGEST_SLACK_CHANNEL_ID` to Heroku and push
4. [ ] Me: Update digest reader to read from web app instead of Notion (once web app is live)
5. [ ] Me: Test with `npm run digest` against live data
6. [ ] Me: Close DS-68 and DS-69 in Jira once live

**Dependent tickets:** DS-83 (close-the-loop section), DS-86 (QBR format), DS-87 (named owners) — these follow once the basic digest is running.

---

### Slice 3 — Broaden Ingestion (needs API access first)

**Blocked until:**
- Typeform API key + form IDs (from Typeform owner)
- Jira CS project access (from CS/support owner)
- Granola MCP endpoint (from Node team)
- DS-64 channel list compiled and bot invited

**Order of attack once unblocked:** Granola (adapter exists, just needs MCP) → Typeform → Jira CS

---

### Slice 4 — Tag, Theme & Aggregate (after Slice 3)

**Blocked until:**
- At least 2 ingestion sources live (need cross-source data to calibrate dedup)
- Taxonomy extension: audience + product area + severity — build in Slice 4

**Then:** DS-78 (cross-source dedup) → DS-79 (learning loop) → DS-80 (taxonomy accuracy report)

---

### Slice 5 — Prioritise & Close the Loop (after Slice 4)

**Blocked until:** Slice 4 is stable (need reliable data before routing to Jira)

**DS-85 (route to Jira):** Needs a decision on which Jira project actionable feedback routes to, and who confirms/rejects the AI suggestion before a ticket is created.

**DS-84 (Slack reply on status change):** Needs a decision on what "status change" means in the new web board and who the bot notifies.

---

## Recommended next actions (in order)

1. **Tomorrow:** Connect the web app as the new data source (Slice 2 unblocked)
2. **Today or tomorrow:** Send me the Indigo Slack channel ID → digest goes live
3. **This week:** Compile channel IDs for DS-64 expansion (clearance already confirmed)
4. **This week:** Chase Rachel to confirm the complete Capability/Crew value list
5. **This week:** Chase Node team on Granola MCP status (DS-73)
6. **Soon:** Set up calls with Typeform owner + Jira CS owner to get API access for Slice 3
7. **When you have a moment:** Find the 3 real Slack examples for the enricher prompt
