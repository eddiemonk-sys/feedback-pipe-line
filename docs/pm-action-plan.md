# Feedback Pipeline — PM Action Plan

> Working document for Eddie. Tracks every open decision, who owns it, and what needs collecting before it can be closed. Update this as things get resolved.

Last updated: 21 July 2026

---

## Status snapshot

| Slice | Name | Status |
|-------|------|--------|
| 1 | Slack Capture | ✅ Done |
| 2 | Synthesise & Surface (weekly digest) | 🔨 In progress — blocked on channel ID + Notion token |
| 3 | Broaden Ingestion | ⬜ Not started — needs API access |
| 4 | Tag, Theme & Aggregate | ⬜ Not started — blocked on taxonomy decision |
| 5 | Prioritise & Close the Loop | ⬜ Not started |

---

## Open decisions

### D1 — Which Slack channel gets the weekly digest? (DS-68)
- **What's needed:** The channel ID (e.g. `C0123ABC`) for the channel you want the digest posted to every Monday
- **Who decides:** You
- **Impact:** Digest is built and ready — this is the only thing blocking it going live
- **How to find the channel ID:** Open the channel in Slack → click the channel name at the top → scroll to the bottom of the "About" panel

### D2 — Taxonomy: keep flat or add dimensions? (DS-76/DS-77)
- **Current:** 11 flat categories (Bug/Broken, Feature Request, UX/Usability, etc.)
- **Option A (recommended):** Keep the 11 categories as-is. Mark DS-76 Done, DS-77 is a no-op. Add extra dimensions (audience, product area, severity) later in Slice 4 once more sources are live.
- **Option B:** Add audience + product area + severity to the enricher now. ~2–3 days of work; risks being premature with only Slack data.
- **Who decides:** You
- **Recommendation:** Option A — the categories are working well. Build the extra dimensions in Slice 4 when you have Typeform and Jira CS data to calibrate against.

### D3 — Trend-emergence threshold (DS-70)
- **Proposed:** Trending 🔥 = 3+ total mentions (2+ linked items). Hot 🚨 = 6+ mentions.
- **Who decides:** You
- **Impact:** Affects how items are flagged in the weekly digest and eventually on the web board
- **Action:** Confirm or adjust the numbers — then I implement immediately

### D4 — Fix the Notion API token
- **Current:** Token is invalid since you added the public Notion connector. Captures are failing to write.
- **How to fix:** Go to notion.so/my-integrations → open the Spotted Zebra integration → copy the Internal Integration Secret → paste into Heroku Config Vars as `NOTION_API_KEY`
- **Who does it:** You (5-minute fix)
- **Priority:** High — digest and accuracy report both need a working Notion token to read data

---

## People to contact

### Rachel (capability/crew fields)
- **What to ask:** Confirmation on the Capability and Crew fields for the feedback board — which values are valid, and who owns maintaining them?
- **Ticket:** Referenced in DS-66/68/69 context
- **Status:** Waiting on response

### Spotted Zebra's AI person
- **What to ask:** Clearance to roll out the capture bot to remaining feedback Slack channels beyond `#client-feedback`
- **Ticket:** DS-64 (Blocked)
- **Channels to propose:** Identify which Slack channels contain feedback before the conversation (pull a list from Slack and decide together which ones are appropriate)
- **Note:** Do NOT widen channel scope without this explicit clearance

### Node team / whoever controls Granola MCP
- **What to ask:** Can they expose Granola via MCP from Node.js? The pipeline has a `StubGranolaClient` ready — it just needs the real MCP endpoint wired up.
- **Ticket:** DS-73 (In Review)
- **Status:** Adapter built, waiting on their side

### Typeform owner (Slice 3)
- **What to ask:**
  1. Which Typeform surveys contain feedback that should be ingested?
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

### Real Slack message examples for enricher prompt (DS-76)
Three categories in the AI enricher currently use synthetic (made-up) examples. The AI extrapolates — it works, but real examples make it significantly more accurate.

Find a real Slack message from `#client-feedback` (or another feedback channel) for each:

| Category | What to look for | Placeholder in prompt |
|----------|-----------------|----------------------|
| **Reporting / Data** | A message about a report being wrong, missing data, or pipeline data issues | "The pipeline report doesn't include withdrawn candidates" |
| **Pricing / Commercial** | A message about pricing being too high, contract terms, or commercial concerns | "The per-seat pricing is too high for us" |
| **Other** | A genuine catch-all message that genuinely doesn't fit any specific category | "Quick question about your roadmap" |

Once you have these, paste them into a Slack thread and I'll update the prompt.

### Channel IDs for Slack expansion (DS-64)
Once you have clearance from the AI person, compile the list of channel IDs to add to `AUTO_CAPTURE_CHANNEL_IDS` or the backfill list. Format: comma-separated, e.g. `C0123ABC,C0456DEF`.

---

## Slice-by-slice action plan

### Slice 2 — Synthesise & Surface (immediate)
**What's done:** Digest builder, scheduler, Slack posting — all coded and typechecked.

**What's left before it's live:**
1. [ ] You: Fix Notion API token in Heroku (see D4 above)
2. [ ] You: Provide the digest Slack channel ID (see D1 above)
3. [ ] Me: Add `DIGEST_SLACK_CHANNEL_ID` to Heroku config vars and push to `sz-feedback-catcher`
4. [ ] Me: Test with `npm run digest` against live data, check output quality
5. [ ] Me: Close DS-68 and DS-69 in Jira once live

**Dependent tickets:** DS-83 (close-the-loop section in digest), DS-86 (QBR format), DS-87 (named owners) — these follow once the basic digest is running.

---

### Slice 3 — Broaden Ingestion (needs API access first)
**Blocked until:**
- Typeform API key + form IDs (from Typeform owner)
- Jira CS project access (from CS/support owner)
- Granola MCP endpoint (from Node team)
- DS-64 channel clearance (from AI person)

**What I can build ahead of time:** The adapter pattern (DS-75) — a repeatable template for adding new sources. I'll build that while you're collecting the API access.

**Order of attack once unblocked:** Granola (adapter exists, just needs MCP) → Typeform → Jira CS

---

### Slice 4 — Tag, Theme & Aggregate (after Slice 3)
**Blocked until:**
- DS-76 taxonomy decision (D2 above) — recommend Option A (keep flat)
- At least 2 ingestion sources live (need cross-source data to calibrate dedup)

**Then:** DS-77 (apply taxonomy) → DS-78 (cross-source dedup) → DS-79 (learning loop across sources) → DS-80 (taxonomy accuracy report)

---

### Slice 5 — Prioritise & Close the Loop (after Slice 4)
**Blocked until:** Slice 4 is stable (need reliable data before routing to Jira)

**DS-85 (route to Jira):** Needs a decision on which Jira project actionable feedback routes to, and who confirms/rejects the AI suggestion before a ticket is created.

**DS-84 (Slack reply on status change):** Needs a decision on what "status change" means in the new web board and who the bot notifies.

---

## Recommended next actions (in order)

1. **Today:** Fix Notion token in Heroku (5 min) + send me the digest channel ID
2. **This week:** Confirm D2 (taxonomy), D3 (threshold) — both just need a quick reply
3. **This week:** Message the AI person about DS-64 channel clearance
4. **This week:** Message Rachel about capability/crew fields
5. **Soon:** Set up calls with Typeform owner + Jira CS owner to get API access for Slice 3
6. **Soon:** Chase Node team on Granola MCP status
7. **When you have a moment:** Find the 3 real Slack examples for the enricher prompt categories
