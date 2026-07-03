# Backfill Triage Agent — Build Brief

**For:** a fresh session (per Eddie's own preference — build this separately "to not confuse things")
**Status:** ready to hand off. Contains real technical grounding — but genuine open design questions
are flagged explicitly, not silently decided. **Grill those before writing code.**

---

## 1. What this is

Eddie's original ask, verbatim, from earlier in this project: *"Create a separate quick agent that
reads messages for the past 4 months. Checks if they are likely customer feedback. List for the
user and let the user select which ones are customer feedback. And then update them with the
emoji... creating a database which I can access to then build upon to give to the main mega bot."*

In plain terms: scan historical Slack messages, find ones that look like feedback nobody flagged
at the time, let Eddie confirm which ones really are, then get them into the same place live
captures go.

## 2. Hard constraints — do not relitigate these

- **Test channel only: `#test-bot-to-capture-feedback` (`C0BDD5KE91V`).** Not `#client-feedback`,
  not any other channel. This is scanning and sending *bulk historical* text (and possibly images)
  to a third-party LLM, which was judged higher-exposure than the live incremental bot — see
  `ENRICHMENT-DESIGN-DECISIONS.md` §6 in full before touching channel scope. **If you're asked to
  expand this beyond the test channel, check that Eddie has an actual confirmed answer from
  Spotted Zebra's "AI person" (who was on holiday) — don't infer it from time having passed.**
- **~4 months of history**, from that one channel.
- Reuse the existing taxonomy (`src/core/taxonomy.ts`, 10 categories) — do not invent a new one.
- Never paste real tokens in chat; secrets stay in the gitignored `.env`.

## 3. The key architectural insight — read this before designing anything

**Don't build a second write path.** The live pipeline already does everything downstream of
"this message is feedback": dedup, enrichment, judging, Notion write, the new feedback-loop fields
(if Phase A is built by the time you start — check current Notion schema, don't assume). The
transport layer (`src/adapters/transport/socketMode.ts`) listens for `reaction_added` filtered
**only** on emoji name and item type — it does not check *who* added the reaction (confirmed by
reading the file directly).

**This means the backfill agent's own job can be small**: find candidate messages, get Eddie's
confirmation, then **add the `:mega:` reaction to each confirmed message via the Slack API**
(`reactions.add` — the bot already has `reactions:write`). That reaction is exactly what the live
bot already listens for. No new Notion-writing code, no second database — the confirmed messages
flow through the exact same `handleCapture.ts` path a live reaction would, landing in the same
"Customer Feedback" database.

**⚠️ One assumption this whole design rests on, not yet verified: does Slack actually deliver a
`reaction_added` event back to an app for a reaction that app's own bot user added?** This is a
Slack-platform behavior, not something answerable by reading this codebase. **Test this with a
two-minute manual check before building anything else**: with the live bot running, call
`reactions.add` on some message from a throwaway script using the bot token, and confirm the
running bot's own logs show it processing that reaction. If Slack suppresses self-authored events
(some platforms do, to prevent bot feedback loops), the fallback is straightforward: instead of
reacting and waiting for the event round-trip, call the existing `onCapture`/`handleCapture`
function directly, in-process, with a `CaptureRequest` built from the confirmed message. Either
way, the point stands — reuse `handleCapture`, don't rebuild what it does.

## 4. What needs to be built

1. **History scanner** — paginated `conversations.history` (Slack returns pages; handle the
   `cursor`), filtered to the test channel, filtered to messages from the last ~4 months. Include
   each message's `files` array (same shape `BoltSlackGateway.getMessage` already extracts image
   URLs from — reuse that logic rather than re-deriving it).
2. **"Likely feedback?" classifier** — this is genuinely a scoped-down version of the Phase 2
   "is this even feedback?" gate that `ENRICHMENT-DESIGN-DECISIONS.md` §2 deliberately deferred
   for the *live* pipeline. Recommended: a new, small port (e.g. `FeedbackGate`) with a
   `ClaudeFeedbackGate` adapter, following the exact same pattern as `ClaudeJudge`/`ClaudeEnricher`
   — rubric prompt, reasoning before verdict, forced structured output, fail-open on error. Keep
   it separate from the live `Judge` — this is backfill-only tooling, not a change to what ships
   live (that's still deferred, per the existing decision).
3. **Vision reuse for image-only feedback** — a message might only make sense via its screenshot
   (e.g. a bare "look at this" with an attached image). Reuse the existing `VisionReader` port —
   already gated to the test channel via `visionEnabledChannelIds`, so this is already consistent
   with the channel restriction with zero extra work. **Prerequisite to verify:** confirm the
   `files:read` Slack scope was actually added and the app reinstalled (this was flagged as a
   "before go-live" step for vision and may not have been completed) — without it, image
   downloads silently fail-open (no crash, just no description), which could quietly under-count
   image-only feedback during backfill.
4. **Present candidates to Eddie for selection** — see the open question below; don't assume a UI.
5. **For each confirmed message:** add the `:mega:` reaction (or call `handleCapture` directly,
   per §3's fallback) and let the existing pipeline do the rest.
6. **Respect existing dedup automatically** — no new logic needed here. `FileDedupStore` is keyed
   on `channelId:messageTs`; if a historical message was somehow already captured, the existing
   dedup path already handles it correctly (adds a co-flagger, doesn't duplicate).

## 5. Open design questions — grill these, don't assume

- **How does "list for the user, let them select" actually work?** Eddie's own phrasing suggests
  something simple. A plausible default: an interactive terminal script (`tsx`, matching every
  other script in this project) that prints numbered candidates with the classifier's rationale,
  and takes a selection (e.g. "1,3,5" or "all"). Confirm this fits, or find out what Eddie actually
  pictures — don't guess past this point.
- **Should backfilled, human-confirmed items auto-set the Phase A feedback-loop fields** (`Category
  Reviewed`, `Summary Verdict`) rather than needing a second manual review pass? Eddie is *already*
  confirming these are real feedback during backfill — that confirmation is arguably the exact
  signal Phase A wants. Worth deciding explicitly rather than defaulting either way.
- **Pacing** — how many candidates might a 4-month scan of one channel realistically surface, and
  does reacting to all confirmed ones in a tight loop risk Slack rate limits? Check realistic
  volume before assuming this needs throttling logic at all — it may not, for one channel's worth
  of history.
- **Phase A sequencing** — check whether the feedback-loop fields (`AI Suggested Category` etc.)
  actually exist in Notion yet by the time this is built. If not yet built, backfilled items just
  won't have them populated, same as any other capture right now — not a blocker, just don't
  assume they're there without checking.

## 6. Reference material (read before designing, don't re-derive)

- `ENRICHMENT-DESIGN-DECISIONS.md` — locked design decisions + the full, honest status log of the
  GDPR review (still open as of this writing)
- `ENRICHMENT-RESEARCH-BRIEF.md` §9 — the eval/gold-set research this backfill agent feeds
- `AI-DECISION-MAKING-REPORT.md` — exactly how enrichment/judge/vision work today, code-verified
- `src/core/taxonomy.ts`, `src/core/ports.ts` — the real types and category list to build against
- `README.md` — current architecture, Notion schema, Slack scopes

## 7. How to kick this off in the new session

> "I want to build the backfill triage agent for the feedback pipeline at
> `C:\Users\eddie\feedback-pipeline`. Read `BACKFILL-AGENT-BRIEF.md` in that folder for full
> context. Use the `grill-me` skill first to resolve the open questions in section 5 with me,
> then build it via TDD, matching the project's existing conventions."
