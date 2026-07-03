# Enrichment Upgrade — Research Brief (decision input for the grill)

**Date:** 2026-07-01 · **Source:** deep-research workflow (23 sources, 107 claims, 25 verified, 24 confirmed / 1 refuted)
**Purpose:** feed the `grill-me` session that locks the "make the feedback bot trustworthy & smart" design.

> **How to read this:** Sections 1, 4, 5, 9 rest on strong, verified primary sources (arXiv papers + Anthropic docs). Sections 2, 3, 6, 7, 8 came back **thin or silent** in the research — recommendations there are engineering judgment, not evidence, and are flagged. Treat all the paper figures as *directional support for design choices*, not performance guarantees for our pipeline (most were measured on pairwise chatbot judging, ours is pointwise classification).

---

## 1. LLM-as-judge design ✅ (well-sourced)

**Verdict: build ONE well-structured judge, not an ensemble.**

- **Pointwise, not pairwise.** Position/order bias is severe and systematic exactly in pairwise "A vs B" judging (verdict flips on order-swap; worst when options are close — our common case) and pairwise judgments even violate transitivity. Our three jobs are naturally pointwise, which sidesteps the worst bias. *(arXiv:2306.05685, 2406.07791, 2410.02736, 2412.05579)*
- **Chain-of-thought before verdict + explicit rubric** (the "G-Eval" pattern): make the judge write its reasoning steps first, then fill in a score against defined criteria. *(arXiv:2303.16634)*
- **Reference-guided grading** is the highest-leverage move for the summary-faithfulness check: grade the summary **against the original message text**, not against the model's own preference. *(arXiv:2306.05685 — reference-guided cut failure rate 70%→15%, though on a tiny math sample; directional)*
- **Do NOT let Claude blindly judge its own Claude-written output.** Self-enhancement + same-family bias are documented for frontier Claude/GPT (Claude 3.5 ~7.5% self-bias error rate). Mitigate by grounding on the source message (rubric/reference), not self-comparison. *(arXiv:2410.02736, 2508.06709)*
- **Ensemble of multiple model families was REFUTED as "the" fix** (1-2 vote). It's an option, not a requirement. At our volume, one judge is right. *(refuted: arXiv:2508.06709)*
- **Fact-like calls are more reliable than subjective ones.** The "is this feedback?" gate and clear category calls will be more trustworthy than fine-grained severity/quality scoring — so spend human-review budget on the subjective calls. *(arXiv:2410.02736)*

**Recommended judge:** one Claude judge · pointwise · CoT-before-verdict · rubric + reference-grounded (against the source message) · confidence-gated escalation to a human when unsure · reserve any ensemble for occasional eval-set audits, not every message.

## 3. Confidence + fallback routing ⚠️ (pattern sourced, numbers NOT)

- The **abstain/escalate pattern is validated**: estimate the judge's confidence, auto-trust only when high, otherwise route to a human — a cheap-first / escalate-to-stronger cascade can hold human-agreement high while keeping coverage. *(arXiv:2407.18370 — but proven for pairwise; for us it's an extrapolation, so adopt the pattern, don't promise the guarantee.)*
- **The research did NOT settle** *how* to get calibrated confidence (logprobs vs verbalized confidence vs self-consistency) or the exact numeric threshold bands. **→ Grill decision, on engineering judgment.**

## 4. Vision / screenshots ✅ (well-sourced, first-party)

- **Image-then-text** prompt ordering (Claude works best with the image before the text). *(Anthropic vision docs)*
- **Cost is deterministic and trivial at our volume:** ⌈w/28⌉×⌈h/28⌉ visual tokens (~$1.30 per 1,000 1000×1000 images on Haiku). The constraint is **reliability, not price.** *(Anthropic vision docs)*
- **Keep a human in the loop.** Claude can hallucinate on low-quality / rotated / <200px images and gives only approximate coordinates/counts. Extract structured fields but don't trust blindly. *(Anthropic vision docs)*

**Recommended:** enable Claude vision for attached screenshots, image-then-text, extract into structured fields, store the image + extracted fields, flag low-confidence extractions for human review.

## 5. Prompt-injection defense ✅ (structural)

- **Structured outputs (constrained decoding) is both the reliability backbone AND the primary injection defense** — the model can only emit into your fixed schema (category + confidence + tags), so injected instructions can't change the action space. Available on Haiku 4.5 (GA). *(Anthropic structured-outputs docs)*
- **Treat all feedback text and image-embedded text as untrusted data to grade/summarize, never as instructions.** Delimit/quote the untrusted input. (Standard practice; not independently verified in this corpus but low-cost and sensible.)
- Lower-risk than agentic tool-use (we don't act with side effects) but still matters — a crafted message could flip a category or poison a summary.

## 9. Eval / gold-set ✅ (method sourced)

- **Measure the judge against your own small human-labeled gold set** — don't trust the paper agreement figures for our data. Track per-category precision/recall/F1, a confusion matrix, and human-agreement (kappa) for the judge. *(arXiv:2306.05685, 2407.18370)*
- **The 4-month human-reviewed backfill (Feature C) IS this gold set** — it does double duty: bootstrap data + eval anchor + confidence-gate calibration set.

---

## Areas the research could NOT ground (→ decide in the grill on judgment)

| # | Area | Status | What the (weak) practitioner sources hinted |
|---|---|---|---|
| 2 | **Taxonomy design** | ⚠️ blog-only | Low volume → **flat** category list (not hierarchical); hierarchical only pays off at thousands/month. Start flat, ≥2 levels only when volume demands. Single vs multi-label + the HR-specific taxonomy = **open grill decision.** |
| 3 | **Confidence calibration mechanics** | ⚠️ pattern only | Verbalized-confidence is poorly calibrated (ECE 0.11–0.43 in one blog study). Method + threshold bands = **open.** |
| 6 | **Theme clustering** | ❌ no verified source | Embedding + online clustering (e.g. BERTopic online) is the standard shape; unverified here. |
| 7 | **Velocity alerting (sparse counts)** | ❌ no verified source | Poisson-style low-count anomaly detection exists (Amazon Science paper surfaced) but wasn't verified. |
| 8 | **PII / GDPR** | ⚠️ provider doc only | Anthropic API data-retention terms are the anchor; a redaction-before-send + DPA + retention baseline needs separate grounding before any commitment. |

## Deferred (confirmed out of scope)
- **Customer-tier / revenue weighting** — depends on CRM/account linkage that doesn't exist yet. Downstream dependency, don't design now.

## Key caveats
- Most strong sources measured **pairwise** chatbot judging; ours is **pointwise** classification. Transfer is *favourable* (pointwise is less bias-prone) but don't quote the 85%-agreement / "provable guarantee" figures as if measured on our task.
- Bias figures (GPT-4 65% / Claude-v1 24% order consistency) are 2023 models; current Claude differs.
