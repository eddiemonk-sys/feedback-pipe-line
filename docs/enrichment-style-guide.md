# Enrichment Style Guide

Human-curated principles the enricher applies on **every** call — this file is appended to its
system prompt at startup (see `src/core/promptGuidance.ts`). These are distilled *by a human* from
review corrections; they are never auto-appended. Keep it short: distill the **rule**, consolidate
overlaps, don't let it sprawl. Full rationale: `DISTILLED-RULES-PRD.md`.

## Summary style

- **P1 — Separate distinct points.** When a message makes several distinct requests or points
  (often as bullets), enumerate them separately in the summary; don't blend them into one run-on
  sentence.
- **P2 — Capture the clarification/resolution.** If the message explains how something actually
  works, or how a confusion was resolved, include it — structure as problem → clarification →
  suggested fix, not just the problem.
- **P3 — Always include dates, deadlines and timelines.** When a message mentions specific dates or
  a timeline (e.g. "ready by end of July", "testing Aug–Sep", "'real' use from Oct"), carry them
  into the summary — don't drop the *when*.

## Category assignment

- **P4 — Compliance / Legal / Governance over Other for legal/regulatory signals.** When a message
  contains a reference to a legal requirement, GDPR, privacy notice, data retention deadline, ADM
  (Automated Decision Making), reasonable adjustments, or a regulatory obligation — use
  Compliance / Legal / Governance, not Other. These arrive as customer requests or CS call notes,
  not formal complaints; the legal driver is what matters.

- **P5 — Onboarding / Setup for any customer go-live or setup discussion.** When a CS or Sales
  message is about setting up a customer on a feature, preparing a go-live, running a socialisation
  call, or working through configuration questions — use Onboarding / Setup, not Other. The scope
  is broader than initial IT setup: any "getting the customer running with a capability" counts.
