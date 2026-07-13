# Backfill Review dataset — how it was labelled and how to use it

The ground-truth set for evaluating and improving feedback **detection** and **enrichment**. Read
this before building any eval or metric against the data.

## What it is

95 Slack messages from the 8-week backfill (#client-feedback, #merlin, #ba). Each was flagged by the
**feedback gate** as *likely* feedback, then reviewed **by hand** (Eddie) — so every row carries a
human judgement, not just the AI's.

## Where it lives

Notion database `396a5bba-35bc-81e9-9dba-d9486f2267a5` ("Backfill Review"). **It is NOT in this
repo** — read it via the Notion API (`NOTION_API_KEY`) or a CSV export. The repo has the *code* that
reads it (`src/backfill/reviewDb.ts`), not the data.

## How it was filled out (the human workflow)

For each of the 95 gate-flagged rows:

1. **`Is Feedback?`** ticked if it's genuinely customer feedback; left unticked = noise / not feedback.
2. For feedback rows, **`Classification OK?`** ticked when the AI's proposed category **and** summary
   were both correct.
3. When the AI was wrong, **`Corrected Category`** / **`Corrected Summary`** were filled with the right
   value (plus optional **`Correction Notes`**).

In practice the review was overwhelmingly *detection + confirmation*, with almost no corrections.

## Columns

| Column | Type | Filled by | Meaning |
|---|---|---|---|
| `Message` | Title | machine | the raw Slack message text |
| `Author`, `Date`, `Slack Link` | Text/Date/URL | machine | provenance |
| `Image` | Files | machine (vision) | the attached screenshot, if any |
| `Proposed Category` | Select | **AI** | enricher's category |
| `Proposed Summary` | Text | **AI** | enricher's summary |
| `Visual Description` | Text | **AI** | vision's read of the screenshot |
| `Gate Confidence` / `Gate Rationale` | Select/Text | **AI** | the feedback gate's call + why |
| `Is Feedback?` | Checkbox | **human** | ground truth: is this real feedback? |
| `Classification OK?` | Checkbox | **human** | AI's category **+** summary affirmed correct |
| `Corrected Category` | Select | **human** | the right category, when the AI's was wrong |
| `Corrected Summary` | Text | **human** | a faithful summary, when the AI's wasn't |
| `Correction Notes` | Text | **human** | free-text rationale |
| `Channel ID`, `Message TS` | Text | machine | keys to join back to Slack |

## Actual label distribution (as of 2026-07-08)

```
95 total
├─ 48  Is Feedback? = true     (real feedback)
├─ 47  Is Feedback? = false    (noise / not feedback)
└─ within the 48 feedback rows:
     28  Classification OK? = true    (AI category + summary affirmed correct)
      2  Corrected Summary filled     (AI summary judged not faithful + rewritten)
      0  Corrected Category filled    (no category was ever corrected)
      6  have an image
     18  neither affirmed-OK nor corrected  → UNLABELLED on classification quality
```

## How to use it

### 1. Feedback vs noise — the strongest signal (use this for the gate)
- Ground truth = `Is Feedback?`. 48 positive / 47 negative — a near-balanced set.
- **Every row here was *kept* by the gate**, so `Is Feedback? = false` (47) are the gate's
  **false positives** → the precision signal.
- **Recall / false-negatives are NOT in this set** — messages the gate rejected were never staged.
  You cannot measure recall from this data; only precision and the decision boundary.

### 2. Category correctness
- Ground-truth category = `Corrected Category` if set, else `Proposed Category`.
- 28 affirmed correct, **0 corrected** → category accuracy looks high, but only 28 are positively
  labelled; the 18 ambiguous rows are unlabelled — don't score them.

### 3. Summary faithfulness
- **Positives (faithful):** `Classification OK? = true` with empty `Corrected Summary` → 28 rows.
- **Negatives (not faithful):** `Corrected Summary` filled → 2 rows; the corrected text is the
  ground-truth faithful summary.
- **Caveat:** `Classification OK?` bundles category + summary, so the 18 rows that are neither
  ticked-OK nor corrected are **unlabelled on summary quality** — do not score them right or wrong.
- There is **no fully-automatic faithfulness signal** for new/unreviewed rows; it needs a human
  verdict or an LLM-judge. The pipeline's **Judge** produces a faithfulness assessment, but that is a
  *system output to be evaluated*, not ground truth.

### Key point for eval design
**Corrections are near-zero (2 summaries, 0 categories).** The value of this dataset is the
**labels**, not the corrections: feedback-vs-noise (48/47) and affirmed-correct classifications (28).
Build the eval around those. An eval that keys off the `Corrected *` columns as its main signal has
almost nothing to work with.

## Joining back to Slack

`Channel ID` + `Message TS` reconstruct the source message and its permalink.

## Once captured into Customer Feedback

If these rows are pushed into the live **Customer Feedback** DB (via `scripts/backfillCapture.ts`),
the schema becomes finer-grained: `Category` vs frozen `AI Suggested Category`, and a dedicated
`Summary Verdict` (Confirmed Faithful / Confirmed Not Faithful) *separate* from category — removing
the `Classification OK?` bundling ambiguity. `npm run correction-log` reads that Customer Feedback
schema, not this one.
