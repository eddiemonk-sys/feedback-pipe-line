# Enrichment Upgrade — Locked Design Decisions

**Date:** 2026-07-02 · **Source:** `grill-me` session, grounded in `ENRICHMENT-RESEARCH-BRIEF.md`
**Status: DESIGN LOCKED. BUILD BLOCKED — see §6.**

---

## 1. Taxonomy

- **Extend the current 8 categories, stay single-label, stay flat.** Do not redesign or go hierarchical (matches research: flat wins at this volume; also avoids relabeling every already-tagged live Notion row).
- **Add two new categories:** `Candidate Experience` and `Assessment Accuracy/Validity`. Final set (10): Bug/Broken, Feature Request, Pricing/Commercial, Onboarding/Setup, UX/Usability, Reporting/Data, Praise, Other, **Candidate Experience**, **Assessment Accuracy/Validity**.
- Requires a live edit to the Notion `Category` select field (add 2 options) — not just a code change.

## 2. Judge scope & phasing

- **Phase 1 (this build):** judge validates (a) category-correctness and (b) summary-faithfulness only.
- **Phase 2 (later, not this build):** the "is this even feedback?" gate. Deferred deliberately — it's new behavior with a new failure mode (can silently exclude real feedback), so it ships only after the judge's reliability is proven on Phase 1 jobs via the gold set.
- Judge design (from research, unchanged): one Claude judge, pointwise, explicit rubric, reasoning-before-verdict with a **short** stored rationale (not verbose CoT), reference-grounded against the original message text — not self-comparison.

## 3. Confidence

- **Categorical `High` / `Medium` / `Low`** via structured output — not a numeric score (avoids false precision; verbalized numeric confidence is documented as poorly calibrated anyway).
- **Routing rule (never silently drop):**
  - `High` → auto-file silently.
  - `Medium` → auto-file, flagged via the new Enrichment Confidence field.
  - `Low` → auto-file, flagged prominently. Worst case is a human re-checks something that was fine — not a lost item.

## 4. Notion schema changes

- New field: **`Enrichment Confidence`** (select: High / Medium / Low).
- New field: **`Judge Rationale`** (text, short).
- **Existing `Status` field (New/Reviewed/Actioned) stays untouched** — it's human-owned workflow state; confidence is a separate AI signal, not folded into it. A Notion view can filter on both together.
- Category select field gets the 2 new options from §1.
- **All schema edits must happen before any code writes to them** — this project has hit "wrote to a field that doesn't exist" twice already; don't make it a third time.

## 5. Vision / screenshots

- **Separate slice, built AFTER the judge+confidence upgrade is shipped and validated on real data.** Not bundled into this build phase — it's independent scope (new `files:read` Slack scope, new `SlackGateway` method, different failure mode from judge bias: image hallucination on low-quality screenshots).

## 6. ⚠️ GDPR / PII — BUILD BLOCKER (read this before starting any of the above)

- **All NEW work from this decision record — judge+confidence upgrade, vision, AND the 4-month backfill triage agent — is paused pending a GDPR/data-retention review.**
- **Scope of the pause:** the review blocks new work only. The currently-live `ClaudeEnricher` (summary + single category, already in production) is NOT paused — it's existing status quo, not a new decision, and keeps running as-is.
- **The backfill agent is explicitly included in the pause**, despite having a human-in-the-loop (you review/select before storage) — bulk processing of 4 months of historical messages through a third-party LLM was judged higher-exposure than the incremental live bot, not lower.
- **Review owner: the user (Eddie), self-directed.** Not delegated to IT/Mark or anyone else at this stage.
- **What "the review" concretely means:** checking Anthropic's API data-retention / DPA terms (the research surfaced `platform.claude.com/docs/en/manage-claude/api-and-data-retention` as the primary anchor source) against what Spotted Zebra needs for candidate/customer personal data before scaling up LLM processing of feedback text.
- **Nothing in §1–5 is wrong or needs to be redone** — the design is fully locked and ready. This is a go/no-go gate on *building*, not a reason to re-open any design decision above.

### ⚠️ STATUS UPDATE (2026-07-02): Eddie knowingly overrode this pause for the judge+confidence upgrade

- **The review has NOT been completed.** This is not a correction to the blocker — it's an honest record of what actually happened, so this doesn't get misread later as "the review was done."
- When explicitly asked to confirm the review was complete before building, Eddie chose **"No, not yet — but I want to proceed anyway,"** consciously accepting the risk rather than by default.
- **The judge + confidence upgrade (Phase 1: category-correctness + summary-faithfulness) is now BUILT** — see the codebase (`src/core/ports.ts`, `src/adapters/judge/`, `src/core/handleCapture.ts`, `src/adapters/notion/notionWriter.ts`, `src/index.ts`) and `src/core/handleCapture.test.ts` (14/14 tests passing, TDD).
- **The pause STILL APPLIES to vision/screenshots and the backfill agent** — this override was scoped to the judge+confidence work only, in the same conversation turn. Do not assume it extends to those.
- **If a future session is asked to build vision or the backfill agent, check with Eddie first** rather than assuming the same override applies — each of these was a separate, explicit decision, not a blanket lifting of the pause.

### ⚠️ STATUS UPDATE (2026-07-02, later same day): vision + backfill agent proceeding, but scoped to the test channel only

- Eddie had an internal meeting about Spotted Zebra's own data regulations (separate from the Anthropic-side research already gathered). **The review is still not fully complete** — there is a specific "AI person" at Spotted Zebra who is on holiday; Eddie plans to check with him on return before treating this as fully resolved.
- **Interim decision:** vision and the backfill agent may now be BUILT and RUN, but only in the test channel (`#test-bot-to-capture-feedback`, `C0BDD5KE91V`) — not in `#client-feedback` or any other real/live channel.
- **Important nuance, don't miss this:** the scope is NOT "public channels" — it was nearly set that way, but `#client-feedback` is technically a public Slack channel while its own stated purpose is to name real clients ("please include the client and use case it impacts"). Public ≠ non-sensitive. The actual rule is: **test channel only**, full stop, until the AI person confirms.
- This does NOT change anything about the already-live judge+confidence work in `#client-feedback` — that was a separate, already-made decision (see above). This new restriction applies only to the NEW vision/backfill work going forward.
- **If a future session is asked to expand vision or the backfill agent beyond the test channel, check that the AI person has actually confirmed** — do not assume "he must be back by now" or that time passing resolves this on its own.

### Re-confirmed (2026-07-02, later still): status unchanged, proceeding on the same test-channel-only scope

- Eddie asked to "go full steam ahead" citing the GDPR review as resolved ("we decided this is fine"). When checked, nothing had actually changed — the AI person is still on holiday, no new confirmation received. Eddie confirmed explicitly: **nothing new, proceed under the exact same test-channel-only scope as above.**
- This is a re-confirmation of the existing restriction, not a new decision. If asked again in a future session whether this has cleared, check for an actual answer from the AI person — don't infer it from enthusiasm or elapsed time, a second time.

### 🐛 BUG FOUND AND FIXED (2026-07-02): vision output wasn't reaching enrichment/judge

- **Symptom (Eddie's live test):** a screenshot-only message (no real text) got `Visual Description` populated correctly ("A modal error dialog displaying 'Export failed'...") but `Summary` came back as *"User submitted feedback as a picture; unable to read or classify without text content"* and `Category` was wrongly `Other`.
- **Root cause, confirmed by reading the code:** in `handleCapture.ts`, vision ran *after* enrichment and judging, and its output only ever went into its own standalone `visualDescription` field. The enricher and judge always saw only the raw Slack text — for an image-only message that's just the "(no text — attachment or file)" placeholder — so they were correctly reporting they had nothing to work with, while a perfectly good image description sat unused right next to their output.
- **Fix:** vision now runs first; its description (when present) is folded into the text handed to both the enricher and the judge, via a new `enrichmentInput` (the raw `message`/title field written to Notion is untouched — still the literal Slack text). Fixed via TDD, 22/22 tests passing (4 new tests specifically covering this).
- **Not touched:** the already-written bad row from Eddie's test ("picture of feedback") still has the wrong Summary/Category in Notion — this fix only affects captures going forward. Reprocessing that row would need a deliberate one-off action, not something done automatically.
- **Also confirmed, not a bug:** Emma Sibley's 2026-05-18 message in `#client-feedback` correctly has no `Visual Description` — that channel isn't in `visionEnabledChannelIds` (still test-channel-only, per the open GDPR review above). Expected behavior, not related to this fix.

### 🚧 PHASE A — CODE HALF DONE (2026-07-03): the frozen-category piece is built, Notion fields are NOT

Eddie confirmed: build Phase A now, backfill agent (B) in its own separate session.

- **Code done:** `handleCapture.ts` now writes a frozen copy of the AI's category into a new
  `aiSuggestedCategory` field on every capture (`FeedbackRecord.aiSuggestedCategory`), alongside
  the existing human-editable `category`. `NotionFeedbackWriter` writes it to a Notion property
  named `AI Suggested Category`. TDD, 24/24 tests passing, typecheck clean.
- **⚠️ NOT done — checked directly against live Notion, do not assume otherwise:** the three new
  properties from the coworker instructions (`AI Suggested Category`, `Category Reviewed`,
  `Summary Verdict`) do **not exist yet** on the live Customer Feedback database. Only `Visual
  Description` has been added so far (from the earlier vision fix).
- **DO NOT restart the live bot assuming this is ready.** Writing to `AI Suggested Category`
  before the property exists will fail exactly like the last two "field doesn't exist" incidents
  (Visual Description, Enrichment Confidence/Judge Rationale) — check the schema first, the same
  way this session has checked every time before touching Notion.
- **`Category Reviewed` and `Summary Verdict` need no code at all** — they're filled in by humans
  directly in Notion, never written by the bot. Once all three properties exist, Phase A is
  functionally complete: no further build step remains.

### ✅ BUILD COMPLETE (2026-07-03): accuracy report (the "pull" side of Phase A)

Eddie initially asked for Phase A to "automatically learn" — clarified this explicitly means
**automated stats/pattern-surfacing, not automated retraining**: the bot's classification
behavior never changes on its own; a human still decides whether a pattern is worth a prompt
edit. Auto-injecting corrections into the live prompt was considered and explicitly declined —
logged here so a future session doesn't assume it was silently adopted.

- New pure function `computeAccuracyReport` (`src/core/accuracyReport.ts`) — category
  agreement rate, most-common confusion pairs (AI-suggested → human-corrected), summary
  faithfulness rate, and confidence calibration (does "High" actually mean more often
  correct than "Low"?). Every rate's denominator is *reviewed* rows only, never all rows —
  an unreviewed row must never silently count as agreement. TDD, 6 tests, all passing.
- `scripts/accuracyReport.ts` — on-demand only (`npm run report`), per Eddie's choice given how
  little reviewed data exists yet. Queries the Customer Feedback database directly (read-only,
  never touches the live bot or Slack), and writes the result to a Notion page under Feedback &
  Analytics (creates it on first run, updates in place on later runs via `NOTION_REPORT_PAGE_ID`
  in `.env`).
- **Depends on the Phase A Notion fields existing** (see above — confirmed still not created as
  of this writing). Running the report now would show `0` reviewed rows for everything, correctly
  — not a bug, just no data yet.
- 30/30 tests passing project-wide, typecheck clean.
- **Extended 2026-07-03:** added `categoryCoverage` — every taxonomy category (all 10, always,
  including zero-capture ones) with total-captured and reviewed counts, sorted least-reviewed
  first. Directly answers "do we have enough reviewed data per category yet, and which ones are
  furthest behind" — the concrete gate condition for the fine-tuning milestone plan (see below).
  Rendered in the Notion report page under "Category coverage." 32/32 tests passing.

### ✅ BUILD COMPLETE (2026-07-02): vision/screenshot reading

- Built via TDD: new `VisionReader` port + `ClaudeVisionReader`/`NullVisionReader` adapters, `SlackGateway.downloadImage` (authenticated fetch of Slack's private file URL), `handleCapture.ts` wired to describe the first image attachment only when `req.channelId` is in `visionEnabledChannelIds` (fails closed — empty by default, must be explicitly configured per channel). 19/19 tests passing, typecheck clean.
- **Storage decision:** stores a `Visual Description` text field (Claude's description of the screenshot) in Notion. **Does NOT store the actual image file in Notion** — Notion's direct file-upload API is newer/more complex than the pinned API version this project uses, and wasn't verified in the time available. The existing "Message URL" field still links back to the original Slack message where the real screenshot is viewable. Native image storage is a deliberate fast-follow, not an oversight — flag to Eddie before assuming it should be added without checking priority.
- **Config:** `VISION_ENABLED_CHANNEL_IDS` (comma-separated, `.env`) — currently set to the test channel only (`C0BDD5KE91V`), per the scoping decision above. Fails closed: blank/missing = vision disabled everywhere.
- **Pre-go-live requirements (not yet done as of this writing):** add `files:read` Slack scope + reinstall; add "Visual Description" (text) property to the Notion DB.

### Research input for the review (gathered 2026-07-02, NOT a resolution of the blocker)

From `platform.claude.com/docs/en/manage-claude/api-and-data-retention`:
- Default (no special contract): conversation content is **not retained by default**, and **never used for training without express permission**. The Messages API + structured outputs (what this bot uses) are ZDR-eligible/qualified.
- The model in use, `claude-haiku-4-5-20251001`, is NOT a "Covered Model" (only Claude Fable 5 / Claude Mythos 5 have mandatory 30-day retention) — so it sits under the standard not-retained-by-default policy.
- Exception: data tied to a flagged Usage Policy violation may be retained up to 2 years.

**Still unresolved — these are the actual open items, not answered by the docs page above:**
1. Whether a formal Data Processing Agreement is in place / needed — ZDR is described as an "arrangement" requested via Anthropic sales/account rep, not stated as automatic on a self-serve API key (which is what this project uses).
2. International transfer mechanism (UK↔US) — not addressed on this page at all.
3. Whether Spotted Zebra's own candidate/customer privacy notices already cover third-party AI processing of feedback — an internal legal question, not an Anthropic-docs question.

## What this means for next steps

- ✅ Ready to hand to Cowork as a locked design, with the blocker stated explicitly so the action plan sequences correctly (review → then build, not build-in-parallel).
- ❌ Not ready to start writing code for judge/confidence, vision, or the backfill agent until the review clears.
- The live bot keeps running unchanged in the meantime — no regression, no urgency to touch it.
