# Feedback Pipeline

A Slack → Notion customer-feedback capture bot. Messages are captured, AI-enriched (category +
summary), judged, and optionally linked to related past feedback — all reviewed periodically by
a human, never auto-retrained.

## Language

**Correction Log**:
A staging record of raw (original message → AI's initial output → human-corrected final output)
examples, grouped by category, kept so a human can review them for generalizable patterns before
any rule is drawn from them. Never read by the live bot.
_Avoid_: general rules, notes

**Distilled Rule**:
A short, general, human-written principle drawn from patterns noticed in a Correction Log, stored
in a curated rules file and prepended to an AI classifier's system prompt at process startup.
Written by a human, not generated automatically from raw corrections.
_Avoid_: general rules, learned rule

### Operating model & delivery

**Operating model**:
The end-to-end feedback flow the whole project is organised around: Capture → Aggregate →
Tag & Theme → Synthesise → Prioritise → Close the loop. Principle: "one home, shared taxonomy,
frequency-led, closed loop." (Source: PDE "Data, Analytics & Insights" H2 2026 Miro board.)

**Source**:
A place feedback already lives and is captured *from* — e.g. a Slack channel, Granola call notes,
Jira, Typeform, a meeting. Capture happens where feedback already is; sources flow into one home.
_Avoid_: channel (too Slack-specific)

**Slice**:
One vertical increment of the operating model, delivered as a single Jira **Epic** with Stories /
Tasks / Bugs beneath it. "Slice" and "Epic" are the same thing here. Not a horizontal layer —
each slice should move the whole pipeline forward, not just one stage in isolation.
_Avoid_: phase (reserved for the board's broader Phase 1A / 1B / Synthesise & Action grouping)
