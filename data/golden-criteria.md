# Golden Criteria for Feedback Enrichment

These criteria define what a high-quality enrichment looks like across all pipeline dimensions.
They are the authoritative rubric for eval scoring and the primary reference for prompt improvement.

Each criterion set is scored independently. A row passing all criteria in its set scores 1.0;
failing any criterion scores 0.0 for that set. Overall pipeline pass = all sets pass.

---

## SQ — Summary Quality

A high-quality summary:

**SQ-1 Lead sentence first**
The first sentence states the single most important point. It is a complete sentence naming
the feature/pain/request and its business context. It does NOT start with a filler
("The user said…", "This is a feedback about…").

**SQ-2 Bullets for detail**
Supporting points follow as 2–4 tight bullet points. Each bullet adds distinct information —
no bullet repeats the lead or another bullet.

**SQ-3 Dates and deadlines preserved**
Any date or deadline mentioned in the original message appears verbatim in the summary
(e.g. "Q3", "by end of July", "before the October release"). A summary that drops a date
mentioned in the source is a hard fail on this criterion.

**SQ-4 No invented detail**
The summary contains only information present in the source message or derivable from
common B2B SaaS knowledge (e.g. interpreting an acronym). It does not add detail the
source did not contain.

**SQ-5 Screenshot content integrated**
When a screenshot is attached, the summary references what the screenshot shows
if it adds material context. It does not describe the screenshot for its own sake —
only if the image changes the interpretation of the text.

---

## BS — Batch Splitting

A correct batch split:

**BS-1 Correct item count**
The number of output rows matches the number of distinct, independently actionable feedback
items in the source message. A preamble ("We had a great session with DTG") does not count
as an item. A follow-up that modifies a prior item (e.g. "…and that applies to the search
filter issue too") is part of that item, not a separate row.

**BS-2 Preamble captured**
If the message opens with a framing or context sentence that applies to all items,
it is captured in `preambleContext` of each row — not as a standalone row.

**BS-3 Per-item attribution**
Each row's summary is specific to its item. A summary that could apply to any item
in the batch ("User provided feedback on several areas") fails this criterion.

**BS-4 Sibling links correct**
After two-pass write, each row's `siblingPageIds` contains the page IDs of all other
rows from the same source message, and does not contain its own page ID.

---

## IA — Image Awareness

A correct image-aware enrichment:

**IA-1 Image content reflected**
If an image shows a UI state (error, empty state, specific screen), the summary reflects that
state. A summary that could have been written from the text alone, ignoring a material image,
fails this criterion.

**IA-2 No hallucinated detail**
The summary does not describe image content that is not visible in the provided image.

**IA-3 Image stored in Notion**
The Notion row has the screenshot attached as an inline image block in the page body.
The old `Visual Description` text property is absent.

---

## TR — Thread Routing

A correct thread routing:

**TR-1 Correct primary row**
The `primary` route points to the row the reply most directly addresses.
For a batch-split parent, this is the specific row the reply is about — not all rows.

**TR-2 Secondary rows reasonable**
Any `secondary` routes are rows the reply tangentially mentions or that benefit from
the context. A general acknowledgement reply ("Thanks for capturing!") should route
all rows as `secondary`, not pick one as `primary`.

**TR-3 No phantom routes**
The route list contains only page IDs from the candidates list. No invented IDs.

**TR-4 Thread log written to Thread Replies column**
After routing, the reply text and timestamp are appended to the "Thread Replies" property
of each matched row. The format is: `[YYYY-MM-DD HH:MM UTC] Author: reply text`. Each new
reply is appended on a new line within the property. Reply images appear as inline page blocks.

---

## CN — Confidence Scoring

A correct confidence score:

**CN-1 High confidence is earned**
A score ≥0.85 is only assigned when: the feedback type is unambiguous, the categories are
clearly matched, there is no missing context that a different reader might interpret differently.

**CN-2 Low confidence is flagged**
A score <0.50 triggers a retry with judge feedback directed at the enricher (existing behavior).
The second enrichment attempt incorporates the judge's rationale.

**CN-3 Score reflects actual ambiguity**
The score is correlated with the actual difficulty of the enrichment, not a default or
a reflexively high value. A trivially clear bug report scores ≥0.85; a vague
"we had some concerns" message scores ≤0.60.

---

## Evaluation Thresholds

| Mode | Pass threshold | Sample size |
|------|---------------|-------------|
| Single capture | ≥93.3% (14/15) | 15 examples |
| Batch splitting | ≥80.0% (4/5) | 5 batch fixtures |
| Thread routing | ≥80.0% (4/5) | 5 thread fixtures |

Batch and thread thresholds are lower because the example sets are smaller and
the tasks are harder to get right in edge cases. Raise thresholds as more examples accrue.

---

## Granola Source Criteria

The following criteria apply when the source is a Granola meeting note rather than a Slack message.
The existing SQ/BS/IA/TR/CN criteria still apply to enrichment output — these criteria govern the
Granola-specific gate and extraction stages that precede enrichment.

### Taxonomy for Granola (locked)

Granola enrichment reuses the exact same Type and ProductArea values as the Slack enricher — no new
categories. The `categories` field is kept unchanged for backward compatibility; new Granola-specific
fields (ClientCompany, CallType, Audience, Severity) are additive.

**Audience values:** Recruiter | Talent Leader | Candidate | Worker | Admin | Unknown

"Worker" covers people being assessed in their own Slack/meeting context (e.g. internal team members
going through an AI interview process). Use "Unknown" when the participant role cannot be determined.

**Type values:** reuse exactly — Bug / Broken | Feature Request | Pricing / Commercial |
Onboarding / Setup | UX / Usability | Reporting / Data | Praise | Other | Candidate Experience |
Assessment Accuracy/Validity | Compliance / Legal / Governance

**Severity:** Critical | High | Medium | Low (auto-elevated by urgency language — see GF-4)

---

### GS — Granola Skip Detection

A Granola note should be **skipped** (not sent to enrichment) when:

**GS-1 No product feedback present**
The note contains only logistics, admin, internal process discussion, or commercial pipeline
updates with no customer-reported pain points, bugs, or feature requests. Internal retrospectives,
sprint planning notes, conference logistics, and pure action-item lists are skipped.

**GS-2 All participants are internal — specific detection signals**
When every participant has a `@spottedzebra.co.uk` email address AND the content is operational
(status updates, process discussion, sales prep, team coordination), the note is skipped.
Specific internal signals: sprint planning, stand-up format, retrospective headings ("What Went
Well", "What Didn't"), pipeline review with no client present, internal prep meeting.
Exception: an internal meeting that explicitly recounts what a named client said still qualifies
for capture.

**GS-3 At least one product signal present → capture**
A note is captured if it contains at least one: (a) customer pain point with the platform,
(b) feature request from a client or prospect, (c) bug or reliability issue reported by/to a
customer, (d) candidate/worker experience problem, or (e) a product-gap action item (see GF-5).
Severity does not affect the capture decision — even low-severity signals are captured.

**GS-4 Client name in title or participant list → lean capture**
When the meeting title contains a recognisable client name (e.g. "Eddie / Priya Sharma - QBR")
or a participant is from a non-Spotted Zebra domain, treat the note as a client-facing meeting
and lean toward capture unless GS-1 clearly applies.

---

### GF — Granola Feedback Extraction

**GF-1 Narrative context preserved**
Granola notes contain meeting narrative; Slack messages do not. Every extracted summary must
include: who raised it, at which account/company, and in what situation (QBR, onboarding call,
support call). A summary that strips context to "user wants X" fails this criterion.

**GF-2 Attribution chain respected**
When feedback is attributed to a third party ("Marcus mentioned that a hiring manager said…"),
the capture reflects the chain. Do not promote the third party to direct reporter.

**GF-3 Parse bullet-by-bullet — each bullet is a candidate item**
Granola notes use bullet points to separate distinct observations. Treat each bullet as a
candidate feedback item. If two bullets describe the same underlying pain point they become one
row; if they describe different pain points they become separate rows. Do NOT merge an entire
section into one summary blob. A note with four distinct feedback bullets should produce four
candidate rows for the enricher to evaluate, not one merged row.

**GF-4 Urgency language auto-elevates severity**
Blocking or deadline language triggers severity escalation regardless of the default assessment:
- "can't go live without X", "blocking their rollout", "promised for Q3" → Severity: Critical
- "renewal at risk", "deal at risk", "client threatened to leave" → Severity: Critical
- "raised multiple times", "still not fixed" → Severity: High
- General urgency without a hard blocker → Severity: High
The summary must also reflect the urgency in plain language — do not neutralise it.

**GF-5 Action items: distinguish operational from product-gap**
Operational action items are NOT feedback (e.g. "Eddie to send ROI deck by Thursday", "Tom to
book a call"). Do not capture them.
Product-gap action items ARE feedback and must be captured as a row. Signals: the action item
involves checking with PM/engineering, requesting a feature be built, following up on a bug, or
contains "client needs X", "check if we can do X", "raise with product team". Examples:
- "Eddie to raise job family cloning with product team" → Feature Request, capture it
- "Eddie to open a Greenhouse integration bug ticket" → Bug / Broken, capture it
- "Eddie to send ROI deck by Thursday" → operational, skip it

**GF-6 Client company tagged on every capture**
Every Granola-sourced capture row must include the client company name. Derive it from: the
meeting title (e.g. "Eddie / Priya Sharma - QBR" → look up Priya's employer from participants),
the participant list (non-SZ email domain is usually the client), or explicit mention in the
note. A capture with no ClientCompany is incomplete. If genuinely unknown, set "Unknown".

---

### GC — Granola Context Fields

**GC-1 Call type classified**
Every Granola note is classified into one of five call types at ingestion:
- **Demo** — prospect seeing the product for the first time
- **Onboarding** — getting a new client set up, first calls after contract
- **QBR** — quarterly business review with an existing client
- **Check-in** — regular sync with an existing client, no formal agenda
- **Support** — troubleshooting a problem or incident

Use the meeting title and content to classify. "Mid-week catch-up", "weekly sync" → Check-in.
"QBR", "business review" → QBR. "Discovery", "demo", "intro call" → Demo. "Platform outage",
"emergency call" → Support. When unclear, default to Check-in.

Feedback from a QBR (strategic, deliberate) is weighted differently from a first Demo
(exploratory, early). CallType is stored alongside the row for downstream filtering.

**GC-2 Call type informs summary framing**
A Feature Request raised in a QBR by a long-standing client should be framed as a strategic
ask. The same request raised in a Demo by a prospect should be framed as an evaluation criterion.
The summary must reflect the call context.

---

### SA — Speaker Attribution

**SA-1 Client voice vs Spotted Zebra voice**
In call notes, distinguish between what the client said and what the Spotted Zebra person
summarised, concluded, or intends to do. Client statements are high-confidence signal. SZ team
observations ("I think we should…", "we could address this by…") are lower-confidence signal
and should not be captured as customer feedback unless they are clearly recounting a client view.

**SA-2 Explicit client quotes are the strongest signal**
Phrases like "they said…", "the client mentioned…", "Priya flagged that…", "Yemi told us…"
indicate direct client voice. These produce the highest-confidence captures and should preserve
the client's language (see GQ-1).

**SA-3 SZ internal views are not captured as customer feedback**
If the Spotted Zebra person is expressing their own product opinion in the notes ("I feel the
report layout needs work"), that is internal signal and should not be captured as a customer
feedback item. It may be noted as context in a capture triggered by a client statement.

---

### GQ — Granola Quote Fidelity

**GQ-1 Key phrases verbatim**
Where the note quotes a customer directly or uses specific product terminology, those phrases
appear in the summary (e.g. "digital adaptability", "norm group percentile", "HRBP observer
role"). Paraphrasing away specific terminology loses signal.

**GQ-2 Numbers and specifics retained**
Quantitative details (completion rates, candidate counts, timeframes, contract values) relevant
to the feedback are preserved.

**GQ-3 No editorial softening**
If a client said the integration is "broken" or "unacceptable", the summary reflects that — not
"the client noted some integration challenges".

---

## Evaluation Thresholds (updated)

| Mode | Pass threshold | Sample size | Notes |
|------|---------------|-------------|-------|
| Single capture (Slack) | ≥93.3% (14/15) | 15 examples | |
| Batch splitting | ≥80.0% (4/5) | 5 batch fixtures | |
| Thread routing | ≥80.0% (4/5) | 5 thread fixtures | |
| Granola gate (skip/capture) | ≥87.5% (21/24) | 24 granola fixtures | manifest.json drives this |
| Granola enrichment quality | ≥80.0% (4/5) | 5 granola fixtures | detailed labeled examples |

Granola gate eval uses all 24 fixture files via `data/granola-fixtures/manifest.json` — checking
`shouldSkip` and `expectedFeedbackCount`. Enrichment quality eval uses the 5 detailed examples in
`data/golden-examples/granola/`. Raise both thresholds as the example sets grow.
