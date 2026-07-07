# Distilled Rules — Correction Learning Loop (PRD)

**Branch:** `feat/related-feedback` (isolated worktree)
**Source:** `grilling` + `domain-modeling` session, 2026-07-06
**Status:** design locked, ready to build via TDD.
**Consolidates:** the backfill agent's independently-designed "enrichment style guide" plan — see
§9. Same idea, reached twice; merged here so there is one enricher, one guide, one loader.

---

## 1. What this is

Humans already correct the AI in Notion — `Category Reviewed`, `Summary Verdict`, and (new, this
doc) `Related Feedback Verdict`. Today those corrections only feed `npm run report`'s stats; a
mistake that repeats five times teaches the system nothing. This closes that loop, while staying
strictly inside the principle already locked in `ENRICHMENT-DESIGN-DECISIONS.md`: **corrections
are distilled into rules by a human, never fed in raw or automatically.** Auto-injecting raw
corrections into the live prompt was already considered and declined once for this project — this
is a different, narrower mechanism: a human (with help spotting patterns) turns *repeated*
mistakes into a handful of short, general, hand-approved principles, which get loaded once at
startup and prepended to a classifier's system prompt.

```
corrections (Notion) ──script──► Correction Log (raw examples) ──human, distilled──► Rules file ──► loaded at startup ──► every future call
```

See `CONTEXT.md` for the **Correction Log** / **Distilled Rule** terms this doc uses throughout.

## 2. Locked decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | File split | Correction Log (raw before/after examples) and the rules file are always separate files | The log is disposable working material; the rules file is the only thing ever read by the live bot |
| 2 | Scope | Enricher and SimilarityDetector each get their own Correction Log + rules file pair. Judge gets neither | The Judge grades the Enricher's output — fixing the Enricher's rules fixes what the Judge checks against |
| 3 | Prompt layering | Two independent layers: a **stable** layer hand-edited directly into the adapter's hardcoded system prompt (rare, via normal code review), and a **flexible** layer — the rules file, loaded once at process startup, edited without any code change | Matches how "before code is written" (baked into source) vs. "during" (loaded at runtime) map onto this codebase's existing structure |
| 4 | Correction Log generation | On-demand script, `npm run correction-log` — same shape as `npm run report`. Queries Notion directly, no schedule, no automatic writes | Consistent with this project's established "on-demand, human-reviewed only" pattern |
| 5 | What counts as an entry | Only actual mismatches (AI output ≠ human-corrected value) — never agreements | A row where the AI was already right teaches nothing new |
| 6 | Cap | 10 entries per category, mixing both entry types (category + summary mismatches) | Keeps the file small enough to read in one sitting |
| 7 | Watermark | Real mechanism, not cosmetic. Script-written entries carry a `_Logged automatically_` marker; the script never rewrites or deletes an existing entry; eviction past the cap only removes the oldest *still-watermarked* entry — anything hand-edited is exempt | Makes it safe to hand-edit the log without a later script run clobbering the edit |
| 8 | Promotion into the rules file | Collaborative, in a session — not solo, not automated. Claude helps spot repeating patterns and proposes candidate phrasing; the human makes the final call on what's written | Keeps the "human decides" property intact while sharing the reading/drafting labor |
| 9 | Missed duplicates (SimilarityDetector false negatives) | Deferred — see §3 | Needs new infra (marking a link's origin as AI vs. human-added) not justified without real usage data yet |
| 10 | `AI Suggested Summary` (new field) | Add it, mirroring the existing `AI Suggested Category` pattern | Unlike category, there's only one `Summary` field — correcting it in place destroys the AI's original text, so a summary mismatch would have no "before" to log without a frozen copy |
| 11 | Correction Log file sensitivity | Gitignored, like `data/` | It contains verbatim customer message excerpts — same sensitivity class as the raw capture files, which are already kept out of git |
| 12 | Rules file sensitivity | Committed normally | By the time something reaches the rules file it's been generalized by a human — no verbatim customer text should remain in it |
| 13 | Scope of the enricher guide | One `enrichment-style-guide.md`, read by the **one** `ClaudeEnricher` class that both the live bot AND the backfill agent's re-enrichment call | From the backfill plan. Two classifiers reading two guides would be pointless — there is one enricher, so there is one guide. Reusing the class (not copying it) is what makes this true, and avoids a merge conflict on `claudeEnricher.ts` |
| 14 | Ad hoc intake | A correction noticed in conversation (any session) can be written straight into the Correction Log without the `_Logged automatically_` marker — human-noticed, so exempt from eviction from the start | From the backfill plan's immediacy. It still enters via the *log*, not straight into the guide, so the "wait for a repeat, distill in a session" safeguard (decisions 5–8) is never bypassed |

## 3. Explicitly deferred

- **Missed duplicates.** The `Related Feedback Verdict` field only catches false positives
  (wrongly linked). A missed duplicate — two rows that are the same issue but were never linked —
  has nothing for a human to correct today, and even a manual fix wouldn't be distinguishable from
  an AI-made link without a new "link origin" marker. Same reasoning already used to defer
  unlink-detection in `RELATED-FEEDBACK-DESIGN.md` §8 — real machinery, not justified yet.
- **Category-scoped rule injection.** Right now every rule gets prepended regardless of the
  message's category. Fine while the list is short; revisit only if a rules file grows large
  enough to visibly bloat the prompt.
- **Hot-reload.** Rules load once per process start. Editing the file mid-run does nothing until
  the bot restarts — see §4.

## 4. Architectural implication — read this before writing code

Both `ClaudeEnricher` and `ClaudeSimilarityDetector` need to read a file once, at construction, and
log how many rules they loaded (e.g. `"Loaded 3 distilled rules from enrichment-style-guide.md"`).
This is the only way a restart's effect is actually visible — without it, "I added a rule and it
didn't seem to work" is indistinguishable from "the bot was never restarted."

## 5. Technical design

### 5a. New Notion properties

- **`AI Suggested Summary`** (Text) — frozen copy of the Enricher's original summary, written once
  at capture time, never touched afterward. Exactly mirrors `AI Suggested Category` alongside the
  human-editable `Summary`.
- **`Related Feedback Verdict`** (Select: blank / `Confirmed Correct` / `Confirmed Incorrect`) —
  human-set only, mirrors `Summary Verdict`. Mark the verdict rather than immediately deleting the
  `Related Feedback` relation — the correction-log script needs the matched page and rationale to
  still be there when it runs. (Unlinking afterward is fine; it just isn't required.)

### 5b. New files (repo root, alongside the other design docs)

- `enrichment-correction-log.md` / `enrichment-style-guide.md`
- `similarity-correction-log.md` / `similarity-rules.md`

### 5c. Correction Log entry format

```markdown
# Enricher Correction Log

Raw examples of AI mistakes, pulled from Notion by `npm run correction-log`. Read through these,
look for repeating patterns, and hand-write anything that generalizes into
`enrichment-style-guide.md`. To mark an entry as reviewed (and exempt it from the eviction cap),
edit it — delete the "Logged automatically" line.

## Bug / Broken

### Category mismatch — 2026-07-10
- **Message:** "the export button doesn't work and also you should add a date range filter"
- **AI suggested:** Feature Request
- **Corrected to:** Bug / Broken
<!-- page:2a1b3c4d -->
_Logged automatically — 2026-07-10_

### Summary mismatch — 2026-07-11
- **Message:** "the export button doesn't work and also you should add a date range filter"
- **AI summary:** "User reports export issues"
- **Corrected summary:** "User reports the export button is broken; also requests a date-range filter"
<!-- page:9f8e7d6c -->
_Logged automatically — 2026-07-11_
```

The HTML comment carries the Notion page ID — invisible when rendered, greppable by the script so
a re-run never logs the same correction twice. If you delete an entry entirely, its page ID is
forgotten; the same correction could resurface on a later run. That's an acceptable tradeoff at
this scale, not a bug.

The SimilarityDetector's log follows the same shape, grouped by the category the two linked rows
shared:

```markdown
## Search & Performance

### Wrong link — 2026-07-12
- **New message:** "search is really slow today"
- **Wrongly matched to:** "the search bar freezes when I type fast"
- **AI's rationale:** "Both describe search performance issues"
<!-- page:1a2b3c4d -->
_Logged automatically — 2026-07-12_
```

### 5d. `npm run correction-log` — generation logic

Direct `client.databases.query` against the Customer Feedback DB, paginated (same pattern as
`scripts/accuracyReport.ts` — this project's reporting scripts talk to Notion directly, bypassing
the `NotionWriter` port, since they're not part of the live capture path). Build a `pageId →
summary` map from the full fetched set first, so resolving a `Related Feedback` relation's matched
summary needs no extra per-row API call.

An Enricher row produces an entry when either is true:
- **Category mismatch:** `Category Reviewed` is checked and `Category !== AI Suggested Category`
- **Summary mismatch:** `Summary Verdict === "Confirmed Not Faithful"`

(A single row can produce both — a category mismatch and a summary mismatch are different lessons,
even from the same message.)

A row produces a SimilarityDetector entry when: `Related Feedback Verdict === "Confirmed
Incorrect"`.

Both cases: skip any row whose page ID is already logged (found via the HTML comment). Group new
entries by category (iterating `CATEGORIES` from `taxonomy.ts`, so every category is considered,
not just ones that already have entries). Within a category, if adding a new entry would exceed
10, evict the oldest entry that still carries the `_Logged automatically_` marker. If every entry
in that category has been hand-edited, the cap is exceeded rather than silently dropping a human's
edit — log that to the console when it happens, don't hide it.

### 5e. Rules file format

Deliberately unstructured — plain markdown, read verbatim, no parser. `P1`, `P2`... are just your
own numbering convention, not a format the code enforces. Whatever text is in the file gets
prepended to the adapter's system prompt as-is.

### 5f. Adapter changes

`ClaudeEnricher` and `ClaudeSimilarityDetector` each read their rules file once in the constructor
(`readFileSync`, treating a missing file as empty — no rules is the default, working state, not an
error). The file's content, if non-empty, is appended to the existing hardcoded system prompt under
a literal header so it reads clearly in a prompt dump:

```
## Additional guidance (learned from human review)
<contents of enrichment-style-guide.md, verbatim>
```

Each adapter logs the loaded rule count at startup (§4). The `Enricher` / `SimilarityDetector` port
signatures do **not** change — the guide is entirely internal to the adapter constructor, so the
backfill agent gets the guide simply by reusing `ClaudeEnricher`, with no API change on its side.

## 6. Running a distillation session (repeatable checklist)

1. Run `npm run correction-log`. This refreshes `enrichment-correction-log.md` and
   `similarity-correction-log.md` with anything corrected since the last run.
2. Open both files. For each category with new entries, read them together — look for a pattern
   that shows up **more than once**, not a one-off mistake on a single ambiguous message.
3. For a pattern that generalizes, draft a rule as a short, general instruction — describe the
   *behavior* to change, not the specific message it came from. ("If a message raises more than one
   distinct issue, summarize each separately" — not "the export/date-range message should have
   been split.")
4. A rule that's really just restating one specific example isn't ready yet — leave the entry
   watermarked and wait for another instance before writing anything.
5. Add the agreed rule to the relevant `*-summary-style.md` / `similarity-rules.md`, numbered
   after the existing ones.
6. Edit (or clear) the Correction Log entries the rule was drawn from, so they're exempted from
   the next eviction pass — you've already extracted the lesson.
7. Restart the bot (`npm start`) and confirm the startup log shows the new, higher rule count.
8. Over the following days, watch `npm run report`'s summary-faithfulness / category-agreement
   rates and the next `correction-log` run — a working rule should mean fewer repeats of the same
   mistake shape, not just fewer entries in one file.

## 7. Build steps (TDD, matching project convention)

1. `AI Suggested Summary`: extend `FeedbackRecord`, write the frozen copy in `handleCapture.ts`
   alongside `aiSuggestedCategory`, persist it in `notionWriter.ts` + `localWriter.ts`. Mechanical —
   mirrors an existing pattern exactly.
2. `src/core/correctionLog.ts`: pure functions for mismatch detection + per-category cap/eviction
   (skipping hand-edited entries) for both the Enricher and SimilarityDetector shapes. Tested with
   fake row data, no live Notion — same pattern as `accuracyReport.test.ts`.
3. Small pure helpers to parse an existing Correction Log file (extract already-logged page IDs
   from the HTML comments; detect which entries are still watermarked vs. hand-edited) and to
   render new entries into the existing markdown.
4. `scripts/correctionLog.ts`: paginated `databases.query`, build the `pageId → summary` map, call
   the pure functions, write both Correction Log files. Add `"correction-log"` to `package.json`
   scripts.
5. `ClaudeSimilarityDetector` reads `similarity-rules.md` once at construction, appends to its
   system prompt, logs the loaded count. This file exists only on this branch — zero conflict risk.
6. Add the two Correction Log filenames to `.gitignore`; leave the two rules-file names out of it
   (committed normally).
7. **Last (shared-file edit — see §9):** `ClaudeEnricher` reads `enrichment-style-guide.md` once at
   construction, appends under the §5f header, logs the loaded count. Build this only after the
   backfill coordination note has been sent. Trivial file-read + string concat — no dedicated unit
   test (same precedent as other external-API adapters), verified manually (start the bot, confirm
   the log line, edit the guide, restart, confirm the count changed).
8. Full `npm test` + `npm run typecheck` before calling this done.

## 8. Pre-go-live checklist

- [ ] `AI Suggested Summary` (Text) added to Notion
- [ ] `Related Feedback Verdict` (Select: blank / Confirmed Correct / Confirmed Incorrect) added to Notion
- [ ] The three Related Feedback properties from the earlier coworker message still pending (`Related Feedback`, `Related Count`, `Related Feedback Rationale`) — this doc's `Related Feedback Verdict` is a fourth, additional property, not a replacement
- [ ] Run `npm run correction-log` once against current live data as a smoke test — expect small or empty output until more rows carry `Category Reviewed`/`Summary Verdict`/`Related Feedback Verdict`
- [ ] Confirm the bot's startup log prints a loaded-rule count for both classifiers (0 is correct and expected on first run — both rules files start empty)

## 9. Cross-session coordination (backfill agent)

The backfill agent, on `feat/backfill-triage`, independently designed the same enricher-guide idea
(its plan named the file `docs/enrichment-style-guide.md` and had its own file-loading logic). That
is a duplicate of §5f — and since both would edit the *same* `claudeEnricher.ts`, building both
means a guaranteed merge conflict on that file. Verified 2026-07-06: the backfill branch has **not**
built it yet (its enricher is still the plain hardcoded prompt), so the clean split is still open.

**The split:**
- **This branch (`feat/related-feedback`) owns the enricher guide loader.** It builds the
  `claudeEnricher.ts` change, the guide file at repo root, and the Correction Log tooling.
- **The backfill agent does NOT build its own loader.** It reuses `ClaudeEnricher` for re-enrichment
  (which gives it the guide automatically) and does not create `docs/enrichment-style-guide.md`.
- **One shared path:** the guide is `enrichment-style-guide.md` at **repo root** — not `docs/`.
  Both the log and the guide sit at root so a human editing them in a distillation session finds
  the pair together.

**Build ordering (deliberate, to keep the merge clean):** everything in §7 except the
`claudeEnricher.ts` edit is new files or a purely additive field — zero conflict risk, built first.
The single shared-file edit (the enricher loader) is built **last**, after the coordination note
above has been sent, so the two sessions can't both write it.
