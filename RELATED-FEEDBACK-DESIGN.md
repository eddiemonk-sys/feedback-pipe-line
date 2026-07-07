# Related Feedback Detection — Design & Build Plan

**Branch:** `feat/related-feedback` (isolated worktree — the shared `feedback-pipeline` folder
stays untouched on `feat/backfill-triage` while this is built)
**Status:** design locked, ready to build via TDD.

---

## 1. What this is

Right now, two *different* Slack messages describing the same underlying issue become two
completely unrelated Notion rows — nobody sees that it's been raised twice. This feature detects
that and links the rows together, **without losing either message's own content, author, or
context.**

This isn't a fresh problem — `ENRICHMENT-RESEARCH-BRIEF.md` already flagged it as "theme
clustering," one of the areas the original research came back with **no verified source** on.
This design fills that gap with a scoped, lightweight approach appropriate to current volume —
not the embeddings/vector-search approach the research described as "the standard shape,"
which would be over-built for where this project actually is right now.

## 2. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Detection method | Claude compares the new capture's summary against recent ones | Same pattern as the judge/enricher already use. No new infrastructure. Embeddings stay an option later if volume ever outgrows this — not built now. |
| Comparison basis | AI-generated **summary**, not raw message text | Shorter, already-condensed, more focused comparison — consistent with how the judge already grades against structured output rather than noisy raw text. |
| Pre-filter | Only compare against captures with the **same category** | Cheap, sensible narrowing — a Feature Request shouldn't get compared against Praise. Reduces both cost and false-positive risk. |
| Comparison window | Recent captures only, ~30–60 days | Cheaper than all-time; most repeated feedback shows up close together anyway. |
| Where it surfaces | **Notion only** — a link between the two rows | Matches the established finding that review happens in Notion, not Slack. No Slack acknowledgment for this. |
| Linking behavior | **Automatic**, human can unlink if wrong | Low-risk — a suggested connection, not an authoritative field like Category. A wrong link is easy to notice and remove, and doesn't corrupt any stats on its own. |

## 3. Explicitly deferred — captured, not built here

Eddie raised a bigger, related idea: correlating feedback spikes with *system changes*
(something gets edited/deployed, then related complaints start coming in → suggest that as a
likely cause). This is a genuinely valuable, separate feature — but it needs a source of "what
changed and when" (a changelog, deployment log, something) that doesn't exist anywhere in this
project yet. Explicitly **not part of this build** — noted here so it isn't lost, same treatment
as customer-tier weighting was given earlier in the research brief.

## 4. The architectural implication — read this before writing code

This is the **first time the live capture pipeline reads from Notion before it writes.**
Everything built so far (enrichment, judge, vision) only ever writes. This feature needs to query
recent rows *before* creating the new one, which means:

- A real network round-trip added to every single live capture, not just an occasional script run.
- Real exposure to Notion's rate limit (already hit once this session, during a completely
  unrelated query).
- This is a deliberate, known tradeoff — not an oversight. If this ever becomes a problem in
  practice, revisit whether the check should be async/deferred rather than blocking the capture.

## 5. Technical design

### New port: `SimilarityDetector`

```typescript
export interface SimilarMatch {
  matchedPageId: string;
  rationale: string;
}

export interface SimilarityDetector {
  findSimilar(
    summary: string,
    category: FeedbackCategory,
    candidates: Array<{ pageId: string; summary: string }>,
  ): Promise<SimilarMatch | null>;
}
```

- `ClaudeSimilarityDetector` adapter — same structured-output pattern as `ClaudeJudge`: forced
  tool call, the candidate list becomes an enum of valid page IDs (or "none"), one short
  rationale. Fails open (`null`) on any error — a failed similarity check must never block a
  capture, exactly like judge/vision failures today.
- `NullSimilarityDetector` — always returns `null`, wired when no Anthropic key.

### New read capability

Nothing in `NotionWriter` today can read. Add one narrow method — resist the urge to build a
general-purpose query API:

```typescript
findRecentByCategory(category: FeedbackCategory, sinceDateIso: string): Promise<Array<{ pageId: string; summary: string }>>;
```

### New Notion properties (must exist before code writes to them — same rule as every other field)

- **`Related Feedback`** — Relation property, self-referencing (links rows within Customer
  Feedback to each other).
- **`Related Count`** — Rollup property counting `Related Feedback`. Notion computes this natively
  — no code needed for the count itself once the Relation is populated correctly.
- **`Related Feedback Rationale`** — Text. Stores the AI's own explanation for *why* it linked
  these rows (`SimilarMatch.rationale`), same treatment as `Judge Rationale` — without this, the
  reasoning is generated and then thrown away, and a human reviewing a wrong link later has no
  way to tell why the system thought it was right.

### Where it plugs into `handleCapture.ts`

After enrichment succeeds (there's no summary to compare without it) — skip entirely if
enrichment failed or returned null, same fail-open shape as the judge and vision integration.

## 6. Build steps (TDD, matching project convention throughout)

1. Add `SimilarityDetector`/`SimilarMatch` to `ports.ts`, `findRecentByCategory` to `NotionWriter`.
2. Extend `CaptureDeps` with the new port + a config value for the comparison window (days).
3. RED: extend `handleCapture.test.ts` — the fake `NotionWriter` needs `findRecentByCategory`
   returning candidates; assert a match calls `createFeedback` (or a follow-up relation-set call)
   with the right link; assert no match / disabled / error all fail open cleanly.
4. GREEN: wire the check into `handleCapture.ts`.
5. Build `ClaudeSimilarityDetector` + `NullSimilarityDetector` (no dedicated unit test — same
   precedent as `ClaudeJudge`/`ClaudeEnricher`, external-API adapters are verified live, not
   unit-tested).
6. Update `NotionFeedbackWriter` — implement `findRecentByCategory` (query) and however the
   `Related Feedback` relation actually gets set (likely a `pages.update` after `createFeedback`,
   since the relation needs the new page's own ID to link both directions).
7. Wire into `index.ts` composition root, same `ANTHROPIC_API_KEY` gate as judge/enricher/vision.
8. Full `npm test` + `npm run typecheck` before calling this done.

## 7. Pre-go-live checklist

- [ ] `Related Feedback` (Relation, self-referencing) added to Notion
- [ ] `Related Count` (Rollup, counting Related Feedback) added to Notion
- [ ] `Related Feedback Rationale` (Text) added to Notion
- [ ] Confirm comparison window default (30 vs 60 days) before shipping
- [ ] Live test: two differently-worded messages about the same issue, confirm they link
- [ ] Live test: two genuinely unrelated messages in the same category, confirm they do NOT link

## 8. Deferred — the actual "does this get better over time" mechanism

Not built in this pass — the base feature needs to exist and produce real links before this is
worth building. Noted here so it's a deliberate next phase, not a forgotten idea:

- Detect when a human **removes** an auto-created link (requires periodically diffing current
  Notion state against what was linked before — real machinery, not justified until there's
  actual link history to check against).
- A removed link is a confirmed false positive; that becomes the same kind of denominator-based
  signal Phase A already established for category/summary accuracy.
- Once that exists, extend `npm run report` (don't build a second, separate report) to show link
  precision alongside the existing category/summary/confidence numbers — one place to check
  everything, not several that can drift apart.
