# Customer Feedback Board — Design Brief

> **Version:** 2.0 (full research cross-check complete)  
> **Author:** Eddie Monk, Product  
> **Date:** 21 July 2026  
> **Data source:** New DB (Notion replaced, Option C)  
> **Audience:** Internal PMs at Spotted Zebra

---

## How to use this document

This is the single source of truth for designing the web board that replaces Notion as the feedback viewing layer at Spotted Zebra. **Read every section before starting.** After reading, summarise the 23-item checklist in Section 14 back to confirm you've absorbed the requirements.

---

## Contents

1. What we're building and why
2. What's wrong with the current Notion view
3. Every field and how to display it
4. Board structure and layout
5. The three relationship types
6. Interactions and row states
7. Triage inbox
8. Verification states (AI vs human)
9. Crew subsections
10. Filters, search, and sort
11. What the research taught us
12. Out of scope — do not design these
13. Open questions
14. Design completion checklist

---

## 1. What we're building and why

We have a live pipeline that captures customer feedback from Slack and Granola meeting notes, runs it through an AI enrichment layer, and stores structured records in a database. The viewing layer is currently a raw Notion table — always a placeholder. We are building a **purpose-designed internal web application** to replace it.

This is a tool for **product managers at Spotted Zebra**. It is not customer-facing. Its job: make it fast and effortless for a PM to understand what customers are asking for, spot patterns across many requests, and action or dismiss items without friction.

**The single design test:** A PM opens the board. Within 10 seconds they should be able to answer: *What are customers asking for most? Who said it? How many times has it come up?* If any of those three questions takes longer than 10 seconds, the design has failed.

**Data source:** The pipeline writes directly to a new structured database. Notion is retired. The web board reads from that database — you are designing the read interface only, not the pipeline.

---

## 2. What's wrong with the current Notion view

- Every pipeline field is a visible column — PMs see Judge Rationale, Gate Verdict, Enrichment Confidence on every row. These are quality-control fields for the pipeline team, not PMs.
- A batch-split message (one Slack message → 3 separate rows) looks identical to 3 unrelated items. No visual grouping.
- Related feedback (same request, different customers, months apart) has no visual grouping. The master/child relationship is completely invisible.
- Thread replies are plain text. No indication a Slack conversation happened after capture.
- No triage inbox. "Needs Review" items are mixed into the same undifferentiated table.
- No sort by demand. No way to see "this has been asked 8 times" at a glance.
- All feedback from all crews in one pile. No per-crew views.
- No text search. No sort controls. No saved filter states.

---

## 3. Every field and how to display it

**Visibility tiers:**
- `PRIMARY` — always visible on the card
- `SECONDARY` — visible on hover or row expand
- `PIPELINE INTERNAL` — collapsed in a ⚙ drawer
- `COMING SOON` — placeholder column, no live data yet

| Field | Visibility | Display notes |
|---|---|---|
| Title | PRIMARY | AI-generated. Bold, visually dominant. The headline of each feedback item. |
| Summary | PRIMARY | AI-generated bullet points. Display in full beneath the title. Each bullet is a discrete, evidence-backed claim. |
| Categories | PRIMARY | Multi-select pills: Bug/Broken (red), Feature Request (blue), UX/Usability (purple), Reporting/Data (green), Pricing/Commercial (yellow), Onboarding/Setup (orange), Candidate Experience (brown), Assessment Accuracy/Validity (grey), Compliance/Legal (blue), Praise (pink), Other (grey). |
| Status | PRIMARY | Four states: New / Needs Review / Reviewed / Actioned. Show as a status pill. "Needs Review" rows must have a distinct left border stripe (orange) even outside the triage view. |
| Source | PRIMARY | "Slack" or "Granola". Small badge. Clicking Slack badge opens the original thread in a new tab. Granola items show meeting title, no thread link. |
| Client Company | PRIMARY | One of the most important fields. Show clearly on every row. |
| Audience | PRIMARY | Recruiter / Talent Leader / Candidate / Worker / Admin / Unknown. Small pill beside Client Company. |
| Date | PRIMARY | Relative: "3 days ago", "2 months ago". Full ISO date on hover tooltip. |
| Capability / Crew | COMING SOON | Not in DB yet. Design the column now with placeholder text ("Indigo crew / Candidate portal"). Sits between Categories and Message. |
| Related Feedback (count) | PRIMARY (masters only) | Demand count badge: "Raised 4×". Only show on master rows. |
| Threads (count) | PRIMARY (if present) | Thread reply badge: "💬 2 replies". Only show when replies exist. |
| Message | SECONDARY | Raw original Slack or Granola text. Truncated to 2 lines with "Show original" toggle. |
| Channel | SECONDARY | Small metadata beneath title. Format: #channel-name. Slack items only. |
| Flagged By | SECONDARY | Who triggered capture: person's name, "Granola (auto)", or "Live gate (auto)". |
| Message URL | SECONDARY | External link icon — always show. Opens Slack thread in new tab. |
| Image | SECONDARY | Small inline thumbnail if present. Click to expand. |
| Enrichment Confidence | PIPELINE INTERNAL | High / Medium / Low. Collapsed in drawer by default. **Exception: Medium and Low show a small indicator on the card itself** (see Section 8). |
| Judge Rationale | PIPELINE INTERNAL | AI reasoning about enrichment quality. |
| Gate Verdict | PIPELINE INTERNAL | Confirmed / Not Feedback. |
| Summary Verdict | PIPELINE INTERNAL | Human review outcome on summary quality. |
| Related Feedback Rationale | PIPELINE INTERNAL | AI explanation of why two items were linked. |
| Related Feedback Verdict | PIPELINE INTERNAL | Human review of whether the AI-suggested link was correct. |

---

## 4. Board structure and layout

### Macro layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Spotted Zebra · Customer Feedback                   [Needs Review  12] │
├──────────────────┬───────────────────────────────────────────────────────┤
│  LEFT NAV        │  MAIN CONTENT AREA                                    │
│                  │                                                       │
│  ▸ All Feedback  │  All Feedback   342 items                            │
│  ▸ Needs Review 12│  Sort: [Newest ▾]  [+ Add filter]  [🔍 Search...]  │
│                  │  ──────────────────────────────────────────────────  │
│  CREWS           │  [Active filter chips shown here]                    │
│  ▸ Indigo   (84) │                                                      │
│  ▸ [Crew B] (62) │  [Feedback rows...]                                  │
│  ▸ [Crew C] (51) │                                                      │
│                  │                                                       │
│  FILTERS         │                                                       │
│  Source          │                                                       │
│  Status          │                                                       │
│  Category        │                                                       │
│  Audience        │                                                       │
│  Date range      │                                                       │
│  Client company  │                                                       │
│  Text search     │                                                       │
└──────────────────┴───────────────────────────────────────────────────────┘
```

### Single row — default collapsed state

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ● New   Candidate can't re-open assessment after early submission  [↗]  │
│         Acme Corp · Candidate · #product-feedback · 3 days ago · Slack  │
├──────────────────────────────────────────────────────────────────────────┤
│  · A candidate submitting before completing all sections cannot return   │
│    to edit remaining answers.                                            │
│  · The submit button appears before the candidate signals they're done. │
│  · No warning shown about unanswered questions before final submission.  │
│                                                                          │
│  [Bug / Broken]  [UX / Usability]      Indigo crew / Candidate portal   │
│                                                                          │
│  💬 2 replies ▾        ▼ Show original message    ⚙ Pipeline internals  │
└──────────────────────────────────────────────────────────────────────────┘
```

### Pipeline internals drawer — expanded

```
│  ⚙ Pipeline internals                                  [Send feedback ↗] │
│  ─────────────────────────────────────────────────────────────────────── │
│  Enrichment confidence:     ● High                                        │
│  Gate verdict:              Confirmed                                     │
│  Summary verdict:           Confirmed Faithful                            │
│  Judge rationale:           Summary accurately captures the core UX bug.  │
│  Related feedback link:     AI-suggested · Confirmed correct              │
│  AI rationale:              Both items describe the same submit-lock bug. │
│                                                                           │
│  Actions: [✓ Confirm summary]  [✗ Flag summary wrong]  [Unlink related]  │
```

---

## 5. The three relationship types

There are three distinct ways feedback items relate to each other. Each needs a **different visual treatment**. Never conflate them.

| Type | What it means | Visual treatment |
|---|---|---|
| 💬 Thread replies | A Slack reply posted in the original thread after capture. The AI routed it to the most relevant row. | Nested under the parent row. |
| 🔗 Master / child | The same request raised by different customers across months. One row is the "best" version (master). Others are children. | Master shows demand count badge ("Raised 4×"). Children collapse beneath master. |
| ✂️ Batch splits | One Slack message contained multiple distinct pieces of feedback. Pipeline split it into N separate rows. | Grouped under a collapsible header showing the original message. |

### Type 1 — Thread replies

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ● Reviewed  Candidate can't re-open assessment after early submission    │
│             Acme Corp · Candidate · 3 days ago   💬 2 replies ▼         │
│             · Submit button appears before candidate is done.            │
│             [Bug / Broken]  [UX / Usability]                            │
│─────────────────────────────────────────────────────────────────────────│
│   └─ Carol · 2 days ago                                                  │
│      "Affecting all assessments sent this week — can we prioritise?"     │
│                                                                          │
│   └─ Mike · 1 day ago                                                    │
│      "Confirmed fixed in v2.3.1 — no further reports from clients."     │
└──────────────────────────────────────────────────────────────────────────┘
```

### Type 2 — Master / child (demand aggregation)

The most powerful PM signal: how many times has this been requested?

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ● Reviewed  Bulk candidate shortlisting not available    🔗 Raised 4× ▼ │
│             Acme Corp · Recruiter · 2 months ago                        │
│             · Recruiters managing 100+ applications have no way to...   │
│             [Feature Request]  · Indigo crew                            │
│─────────────────────────────────────────────────────────────────────────│
│   └─ 🔗 FutureHire Ltd · 3 weeks ago                                    │
│      "We need to be able to shortlist in bulk before the review stage."  │
│                                                                          │
│   └─ 🔗 TalentCo · 1 month ago                                          │
│      "Our team is manually doing this in a spreadsheet — please fix."   │
│                                                                          │
│   └─ 🔗 Greenfield Inc · 6 weeks ago                                    │
│      "Same as last quarter's request — still needed."                   │
└──────────────────────────────────────────────────────────────────────────┘

Child row in isolation — must show a back-link to its master:
┌──────────────────────────────────────────────────────────────────────────┐
│ ● Reviewed  Bulk candidate shortlisting not available   [→ See master]  │
│             FutureHire Ltd · Recruiter · 3 weeks ago                    │
│             [Feature Request]                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

### Type 3 — Batch splits (siblings)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ✂ Split from: "We've been having a few issues — the export is broken   │
│  and we need bulk actions. Also GDPR deletion is overdue."              │
│  Carol · Acme Corp · #product-feedback · 5 days ago  [↗ Slack]   ▼    │
│─────────────────────────────────────────────────────────────────────────│
│  ├─ ● New  Export button throws an error on Safari                      │
│  │         [Bug / Broken]  · Acme Corp · Candidate                     │
│  │         · Users on Safari 17+ cannot complete PDF exports.           │
│  │                                                                      │
│  ├─ ● New  Bulk candidate assignment missing                            │
│  │         [Feature Request]  · Acme Corp · Recruiter                  │
│  │         · No way to assign 50+ candidates to a pipeline stage.       │
│  │                                                                      │
│  └─ ● New  GDPR data deletion workflow needed                           │
│            [Compliance / Legal]  · Acme Corp · Admin                   │
│            · No self-serve deletion path for candidate data.            │
└──────────────────────────────────────────────────────────────────────────┘
```

**Design rule:** Maximum 2 levels of nesting. A child that is also a master shows its demand count badge at that level — do not add a third level.

---

## 6. Interactions and row states

### Row states

- **Default** — Title, summary bullets, category pills, metadata line (company, audience, date, source), relationship badges
- **Hover** — Subtle background highlight; quick-action icons appear (approve, link to Slack, flag for review, manual link/unlink)
- **Expanded** — Original message visible, pipeline internals drawer accessible, thread replies visible
- **Needs Review** — Orange left border stripe, triage action bar always visible at row bottom

### Manual link and unlink (required)

The AI will sometimes make wrong related-feedback connections, and will sometimes miss real ones. PMs must be able to correct this.

Provide at minimum:
- **Link** — "Link to related feedback" in the hover state of any row; opens a search-and-select modal to find the target
- **Unlink** — removes the related-feedback connection
- **Move** — unlink from current master, re-link to a different one

```
│   └─ 🔗 FutureHire Ltd · 3 weeks ago               [Move] [Unlink]  │
│      "We need to be able to shortlist in bulk..."                     │
```

*Source: Productboard gives PMs Move / Link to another / Unlink on every linked insight.*

### Triage keyboard shortcuts (required)

Every item in the Needs Review queue must be actionable without a mouse.

| Key | Action |
|---|---|
| A | Approve — mark as Reviewed, move to main board |
| D | Dismiss — mark as invalid, remove from board |
| S | Snooze — hide for 7 days, return automatically |
| E | Edit — open summary edit mode |
| J / K | Navigate to next / previous item |
| ↑ / ↓ | Navigate to next / previous item |
| ? | Show keyboard shortcut help modal |

*Source: Linear triage uses 1/2/3/H for Accept/Duplicate/Decline/Snooze. Same model.*

### Snooze

A triage item can be snoozed — temporarily removed from the Needs Review queue and returned automatically after 7 days. Snoozed items appear in a "Snoozed" sub-section of the nav.

---

## 7. Triage inbox — Needs Review

A dedicated view showing **only Status = "Needs Review" items**. It is the first thing a PM should check. The count badge in the nav must always be live.

Items enter Needs Review when: the pipeline auto-captured from a Slack channel (live gate), enrichment confidence was Medium or Low, or a PM manually flags an item.

**Key design principle (from Cycle):** Treat unprocessed feedback as a queue to be cleared, not a database to be browsed. The inbox metaphor — work down the list, clear to zero — is the right mental model. The count badge is the motivating signal.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Needs Review  12 items     [Keyboard shortcuts: ?]                     │
│─────────────────────────────────────────────────────────────────────────│
│                                                                          │
│ ▶ Export button throws error on Safari           ● Medium confidence    │
│   Acme Corp · Bug/Broken · #product-feedback · 2h ago                  │
│   · Users on Safari 17+ cannot complete PDF exports.                    │
│   · Error message is generic with no actionable guidance.               │
│                                                                          │
│   Pipeline:  Judge: "Clear bug report. Low ambiguity."                  │
│                                                                          │
│   [A Approve]  [E Edit summary]  [D Dismiss]  [S Snooze]               │
│──────────────────────────────────────────────────────────────────────── │
│ ▶ Candidate portal login is intermittent         ● Low confidence       │
│   ...                                                                    │
└──────────────────────────────────────────────────────────────────────────┘
```

In the triage inbox, pipeline internals are **always expanded** (not collapsed) — this is the one context where PMs need confidence scores and rationale to decide whether to approve or correct the AI output.

---

## 8. Verification states — AI-suggested vs confirmed

Not all data on the board has equal confidence. This distinction must be visible on the card — not buried in a drawer.

*Source: Productboard shows three states on every linked insight: Manual link / AI to verify / AI verified.*

| What | States | Where to show it |
|---|---|---|
| Enrichment confidence | High / Medium / Low | Collapsed in pipeline drawer by default. **Exception: Medium and Low show a small indicator pill on the card itself** — so PMs spot uncertain items without opening every row. |
| Related feedback links | AI-suggested / Human-confirmed / Manual | Small label beside the 🔗 badge: "AI · unverified" or "AI · confirmed" or "Manual". |
| Triage items | Pending / Snoozed / Approved / Dismissed | Status pill. Drives triage inbox membership. |

```
Normal row (high confidence — no indicator on card):
│ ● New  Bulk shortlisting not available     🔗 Raised 4× · AI confirmed  │

Row with medium confidence (indicator visible on card):
│ ● Needs Review  Export error on Safari     ◐ Medium confidence          │

Row with AI-suggested but unverified link:
│ ● Reviewed  Candidate portal login issue   🔗 Raised 2× · AI · unverified │
```

---

## 9. Crew subsections

Once crew and capability data is available, each crew gets a subsection showing only feedback that maps to their capabilities. The structure is identical to the main board — just filtered.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Crew: Indigo                84 items  ·  4 needs review                │
│  Capabilities: [Candidate portal]  [Assessment delivery]  [Scoring]     │
│─────────────────────────────────────────────────────────────────────────│
│  [Feedback rows for Indigo capabilities only...]                        │
└──────────────────────────────────────────────────────────────────────────┘
```

Design with **Indigo** as the placeholder crew. Use "Candidate portal", "Assessment delivery", "Scoring engine" as placeholder capability names. When real data arrives, only the labels change — the structure stays identical.

---

## 10. Filters, search, and sort

### Required filter types

| Filter | Type | Behaviour |
|---|---|---|
| **Text search** | Free text | Full-text search across Title, Summary, and Message. Must support "contains" logic. Highlight matching text in results. |
| **Status** | Multi-select | New / Needs Review / Reviewed / Actioned |
| **Source** | Multi-select | Slack / Granola |
| **Category** | Multi-select | All 11 category options |
| **Audience** | Multi-select | Recruiter / Talent Leader / Candidate / Worker / Admin / Unknown |
| **Client Company** | Free text / select | Search by company name. PMs frequently filter to one customer. |
| **Date range** | Date picker | From / To. Presets: Last 7 days, Last 30 days, Last 90 days, This quarter. |
| **Crew** | Multi-select | Placeholder: Indigo. Coming once capability data is ready. |
| **Confidence** | Multi-select | High / Medium / Low. Lets PMs filter to uncertain items only. |

### Active filter display

When filters are active, show them as dismissible chips: `Category: Bug/Broken ×  Status: Needs Review ×  [Clear all]`

Result count updates live: "Showing 14 of 342 items"

### Sort options (required)

- **Newest first** (default) — by Date descending
- **Oldest first** — by Date ascending
- **Most raised** — by demand count descending. Surfaces the most-requested features at the top. *(Source: Canny)*
- **Needs Review first** — Status = Needs Review sorted to top

### Saved views — reserve space, don't build

Include a visible "Save this view" affordance beside the filter controls — grayed out or marked "Coming soon". Don't design the save/manage/share flow.

---

## 11. What the research taught us

We researched Productboard, Cycle, Canny, Dovetail, Pendo Listen, Sprig, and Linear. Every pattern below was directly adopted.

**Productboard — insight card structure and link verification**
Every Productboard insight card has: theme name, one-line intent, count of supporting data points, link to source, and a link verification state (Manual / AI to verify / AI verified). Our design mirrors this: Title + Summary + demand count + source link + confidence indicator + verification state on related feedback links. Productboard also gives PMs Move/Link/Unlink to manage AI errors — we implement Link and Unlink in the hover state of every row.

**Canny — demand aggregation and sort by count**
Canny's strongest signal: when you see a feature request, you see immediately how many customers asked for it, and you can sort the board by that count. We implement both: the demand count badge ("Raised 4×") on master rows, and "Most raised" as a sort option.

**Cycle — triage inbox as queue to clear**
Cycle's keyboard-first inbox-zero experience is the model for our triage inbox. The count badge motivates the PM; the keyboard shortcuts remove friction; the action bar gives one-click resolution.

**Linear — triage keyboard shortcuts and snooze**
Linear's triage uses 1/2/3/H for Accept/Duplicate/Decline/Snooze. We adopt the same model: A/D/S/E/J/K shortcuts in the triage inbox. Snooze is critical — it lets PMs defer without dismissing.

**Dovetail — sentence-level evidence in summaries**
Dovetail extracts key moments at the sentence level. A single ticket can contain both a complaint and a compliment — both are surfaced. Our AI summaries do the equivalent: each bullet point is a discrete, evidence-backed claim. Each bullet must stand alone as proof of a specific point.

**Sprig — Opportunities vs Strengths**
Sprig classifies insights as Opportunities (problems to fix) or Strengths (things working well). Our "Praise" category maps to Strengths. Praise items should be visually distinct — softer, lighter — so they don't read as urgency-requiring alongside bugs and feature requests.

---

## 12. Out of scope — do not design these

> **Hard stop.** If you find yourself designing any of the following, stop and re-read this brief.

- **Bidirectional sync with Linear or Jira** — pipeline is write-only to our DB. Not for this phase.
- **Importance weight per link** — Productboard sets Nice-to-have/Important/Critical per link. We have not decided whether to implement this. Do not design it.
- **ARR/MRR weighting** — no client tier data yet. A placeholder for high-importance client alerting is acceptable; designing the weighting system is not.
- **Saved views (full implementation)** — reserve space only (grayed-out affordance). Don't design the save/manage/share flow.
- **Mobile layout** — desktop only (1200px minimum). Responsive is nice-to-have, not required.
- **Public-facing feedback portal** — internal PM tool only. No customer-facing routes.
- **AI-generated VoC reports or digests** — not planned for this phase.
- **Trending charts over time** — Pendo's cumulative line chart and Dovetail's directional trend indicators are not in scope. The demand count badge is our trending signal.

---

## 13. Open questions — not yours to resolve

Design around these as described. Do not block on them.

- **Crew list and capabilities** — gathering from team (message sent). Design with Indigo + placeholder capabilities. Structure does not change when real data arrives.
- **Client tier / importance flag** — not captured yet. Reserve a visual placeholder on each row — a subtle signal that says "importance will live here" when it exists.
- **DS-66, DS-68, DS-69** — Jira tickets for capability + crew fields. Need to pull before building.
- **Granola MCP client** — Granola is a real source but live integration is not wired yet. Design for it fully — "Granola" source badge, meeting title in metadata, no Slack thread link — but it may not be testable with real data immediately.

---

## 14. Design completion checklist

Before marking this design as done, confirm every item below is addressed. Read each one carefully — these were derived from a full cross-check of all research documents against the brief.

- [ ] **Main board layout** — left nav with crew sections + filter panel, content area with sort and search controls
- [ ] **Column order** — Status | Title | Summary | Categories | Capability/Crew | metadata | Message (in that order)
- [ ] **Pipeline internals collapsed** — ⚙ toggle, drawer contents as specified in sections 3 and 4
- [ ] **Thread replies** — nested under parent, collapsible with count badge, reply author and text visible
- [ ] **Master/child demand aggregation** — demand count badge ("Raised N×"), children collapsed under master, back-link on child rows
- [ ] **Batch splits** — original message as collapsible header, N sibling rows beneath, max 2 levels nesting
- [ ] **Triage inbox** — dedicated Needs Review view, action bar (Approve/Edit/Dismiss/Snooze), pipeline internals always expanded in this view
- [ ] **Triage keyboard shortcuts** — A/D/S/E/J/K as specified, ? shortcut for help modal
- [ ] **Snooze** — snooze action exists, snoozed items appear in nav sub-section, return automatically after 7 days
- [ ] **Verification states** — Medium/Low confidence indicator visible on card (not just in drawer), related feedback links show AI/confirmed/manual state
- [ ] **Manual link / unlink** — Link and Unlink actions in row hover state, search-and-select modal for linking two rows as related feedback
- [ ] **Text search** — full-text search across Title + Summary + Message, results highlight matching text
- [ ] **Sort options** — Newest / Oldest / Most raised / Needs Review first
- [ ] **All 9 filter types** — text search, status, source, category, audience, client company, date range, crew, confidence
- [ ] **Active filter chips** — dismissible, with live result count ("Showing 14 of 342")
- [ ] **Saved views placeholder** — grayed-out "Save this view" affordance, not functional
- [ ] **Crew subsections** — per-crew nav item, subsection header with capability chips, filtered content
- [ ] **Source badges** — Slack badge opens thread; Granola badge shows meeting title; both always visible on cards
- [ ] **Needs Review left border stripe** — orange stripe visible on Needs Review rows even outside triage view
- [ ] **Praise items visually distinct** — softer/lighter visual treatment vs bugs and feature requests
- [ ] **Capability/crew placeholder column** — visible in column order, shows placeholder text, ready for real data
- [ ] **Client tier placeholder** — a reserved visual space for high-importance client indicator (empty, but present)
- [ ] **Nothing out of scope was designed** — no bidirectional sync, no importance weights, no ARR chart, no mobile, no VoC reports
