# Feedback Digest → QBR / Roadmap Planning — Integration Brief

**For:** Eddie Monk to present at the next QBR prep / roadmap planning session.
**Purpose:** Make the weekly feedback digest a standing planning input, so it
shapes roadmap decisions rather than sitting in a Notion page no one visits.

---

## What we now have

Every Monday at 09:00 UTC, the pipeline:
1. Reads the last 7 days of captured feedback from Notion
2. Builds a themed, frequency-ranked digest using Claude (Haiku)
3. Posts the digest to the Indigo Slack channel
4. Writes the full digest to a Notion page under Feedback Analytics

The digest groups feedback into named themes, surfaces trending items
(Mentions ≥ 3), and shows a close-the-loop section for any items that have
been actioned (status = Done / Backlog / Won't Fix).

---

## The ask: make it a standing QBR input

The digest becomes a planning input in three lightweight steps:

### Step 1 — Designate a digest reviewer (Owner: Eddie)

One person reads the Monday digest every week and flags anything that should
influence the upcoming sprint or roadmap. This is a 5-minute task.
Recommended owner: the PM most responsible for the Indigo crew roadmap.

### Step 2 — Add "Feedback signals" as a standing QBR agenda item (Owner: Eddie)

At every QBR prep meeting, the digest reviewer presents:
- The top 2–3 trending themes from the past month
- Any feedback items where the close-the-loop status has not moved in 4+ weeks
- Any customer accounts mentioned 3+ times in the window

This takes 5–10 minutes per QBR. The Notion page (updated weekly) is the
source of truth — no deck preparation needed.

### Step 3 — Link roadmap decisions back to feedback (Owner: PM who picks up items)

When a roadmap item is directly motivated by feedback, add a comment to the
relevant Notion feedback row(s) linking to the Jira epic. This closes the loop
visibly and validates the pipeline's value over time.

---

## Why this matters

Without a named step in planning, feedback systems die. Customers stop feeling
heard, PMs stop trusting the signal, and the pipeline degrades into a log that
nobody reads. The Monday digest is already built and running — this brief is
asking for 15 minutes per week of human attention to make it count.

---

## Immediate next steps (for Eddie)

| Action | Owner | When |
|--------|-------|------|
| Nominate digest reviewer | Eddie | This week |
| Add "Feedback signals" to next QBR prep agenda | Eddie | Before next QBR |
| Confirm named owners per source (see DS-87) | Eddie | This week |
| Set `NOTION_DIGEST_PAGE_ID` in Heroku config vars (DS-66 — prints on first digest run) | Eddie | After first Monday digest |
