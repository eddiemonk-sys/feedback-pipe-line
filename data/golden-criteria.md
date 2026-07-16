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

**TR-4 Thread log appended**
After routing, a quote block with the reply text and timestamp appears in the page body
of each matched row. The block uses the format: `[YYYY-MM-DD HH:MM UTC] Author: reply text`.

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
