# Distilled rules over raw correction injection

**Status:** accepted

Human corrections in Notion (`Category Reviewed`, `Summary Verdict`, `Related Feedback Verdict`)
are never fed directly into a classifier's prompt. Instead, `npm run correction-log` surfaces
*repeated* mistakes into a Correction Log; a human — with Claude's help spotting patterns —
distills anything that generalizes into a short rule; only that hand-written rule is loaded into
the system prompt, once, at process startup. Auto-injecting raw corrections directly was considered
and declined for this exact reason during the original judge+confidence design (see "✅ BUILD
COMPLETE (2026-07-03): accuracy report" in `ENRICHMENT-DESIGN-DECISIONS.md`). This mechanism
(`DISTILLED-RULES-PRD.md`) closes the loop from repeated mistake to improved behavior while
preserving that decision — a human judges every word that reaches the prompt, nothing is ever
auto-written.
