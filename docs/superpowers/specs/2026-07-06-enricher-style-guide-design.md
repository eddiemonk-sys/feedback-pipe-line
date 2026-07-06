# Enricher Style Guide — Design Spec

**Date:** 2026-07-06
**Scope:** live + backfill

## Goal

Close the feedback loop on enrichment quality: when Eddie corrects a summary or category during review, the *principle* behind that correction is recorded in a curated guide that the enricher reads on every call — so future summaries/categories reflect his preferences, in both the live pipeline and the backfill.

## Non-goals

- No auto-learning / auto-append. Turning a specific fix into a general rule needs judgment, so updates are Claude-assisted, not automatic.
- No changes to the gate, judge, or vision.
- No model retraining — this is prompt augmentation only.

## Approach

Inject the guide as **text appended to the enricher's system prompt**, passed into `ClaudeEnricher` via its constructor (dependency injection) rather than read by the adapter itself. Rejected alternatives: few-shot examples (heavier; the enricher already teaches by inline example) and a separate "guidance" user message (splits instruction from context for no gain). DI keeps file I/O at the edges and makes the injection logic unit-testable.

## Components

1. **`docs/enrichment-style-guide.md`** — the committed guide. Two sections: **Summary style** (seeded with P1, P2 below) and **Category assignment** (empty, filled when a category is first corrected).
2. **`buildEnricherSystemPrompt(base: string, guide?: string): string`** — pure function exported from the enricher module. Appends the guide under a clear header when non-empty; returns `base` unchanged when the guide is empty/whitespace. **This is the TDD target.**
3. **`ClaudeEnricher`** — constructor gains an optional `styleGuide` string; its `system` prompt becomes `buildEnricherSystemPrompt(SYSTEM_PROMPT, styleGuide)`.
4. **`loadStyleGuide(path: string): string`** — fail-open file read (missing / unreadable / empty → `""`). Used only at the composition root.
5. **`config.ts`** — add `enrichmentStyleGuidePath` (default `./docs/enrichment-style-guide.md`, override via `ENRICHMENT_STYLE_GUIDE_PATH`), matching the existing `./data/...` path convention.
6. **Wiring — all three enricher construction sites** load the guide and pass it: `src/index.ts` (live capture), `scripts/backfillScan.ts` (preview enrichment), `scripts/backfillCapture.ts` (re-enrichment on capture). This is what makes the scope **live + backfill**.

## Data flow

Composition root reads the guide file once → passes the text to `ClaudeEnricher` → every `enrich()` call sends `SYSTEM_PROMPT + guide` → the model applies the principles. Fail-open throughout: no file, no API key, or an empty guide → behaves exactly as today.

## The update loop (workflow, not code)

After a review pass, Eddie asks Claude to distill recent corrections (from `gold-set.jsonl`) into new principles; Claude proposes them, Eddie approves, Claude edits and commits the guide. Keep it short — distill the *rule*, consolidate overlaps, don't let it sprawl.

### Seed principles

- **P1 — Separate distinct points.** When a message makes several distinct requests/points (often as bullets), enumerate them separately in the summary; don't blend them into one run-on sentence.
- **P2 — Capture the clarification/resolution.** If the message explains how something actually works or how confusion was resolved, include it — structure as problem → clarification → suggested fix.

## Error handling

All fail-open. `loadStyleGuide` never throws (returns `""` on any error). An empty guide yields the base prompt unchanged. The enricher itself already fails open (returns `null` on API error), unchanged.

## Testing

Unit-test `buildEnricherSystemPrompt`:
- empty / whitespace-only guide → returns `base` unchanged;
- non-empty guide → result contains `base`, the header, and the guide text.

This is the first unit test for the enricher module. Adapters remain un-API-tested per repo convention; the injection logic — the part that matters — is covered.

## Files

- **Create:** `docs/enrichment-style-guide.md`, `src/adapters/enricher/claudeEnricher.test.ts`
- **Modify:** `src/adapters/enricher/claudeEnricher.ts`, `src/config.ts`, `src/index.ts`, `scripts/backfillScan.ts`, `scripts/backfillCapture.ts`
