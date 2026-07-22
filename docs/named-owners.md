# Named Owners — Feedback Pipeline Sources & Synthesis Cadence

**DS-87 — for Eddie to confirm and fill in names.**

Research and industry experience are clear: feedback systems without named
owners degrade within 6 months. This doc assigns ownership so the pipeline
stays alive.

---

## Source owners

A source owner is responsible for:
- Ensuring the bot/integration stays active for that source
- Doing a 5-minute spot-check on new captures once a week
- Flagging any quality issues (wrong crew, bad summary, missed captures)

| Source | Channel / Location | Suggested Owner | Confirmed Owner |
|--------|-------------------|-----------------|-----------------|
| Slack — #client-feedback | Live | Eddie Monk | |
| Slack — #pde-and-commercial | Live (DS-64) | Eddie Monk | |
| Slack — #ai-interview | Live (DS-64) | Eddie Monk | |
| Slack — #candidate-feedback | Live (DS-64) | TBC — PDE lead? | |
| Slack — #product-customer-success | Live (DS-64) | TBC — CS lead? | |
| Granola meeting notes | Polling (stub — DS-73 blocked) | Eddie Monk | |
| Typeform surveys | Not yet built (DS-57 blocked) | TBC | |
| Jira CS tickets | Not yet built (DS-57 blocked) | TBC | |

**Action for Eddie:** Fill in the "Confirmed Owner" column and share with each
person so they know what they own.

---

## Synthesis cadence owner

The synthesis owner is responsible for:
- Confirming the Monday digest ran each week (check the Indigo Slack channel)
- Presenting the digest at QBR prep (see `qbr-digest-integration-brief.md`)
- Escalating any week where the digest is blank or clearly wrong

| Cadence | Frequency | Suggested Owner | Confirmed Owner |
|---------|-----------|-----------------|-----------------|
| Weekly Slack digest | Every Monday 09:00 UTC | Eddie Monk | |
| QBR feedback input | Each QBR cycle | Eddie Monk | |

---

## Escalation path

If a source goes silent (no captures for 2+ weeks when there should be traffic):
1. Source owner checks the Heroku logs (`heroku logs --tail --app sz-feedback-catcher`)
2. Source owner pings Eddie
3. Eddie raises in the next sprint

If the digest fails to post:
1. Check #sz-feedback-catcher Heroku alerts (if configured)
2. Run `npm run digest` locally to test
3. Check Heroku Config Vars are still set correctly

---

## Review cadence

Review this document at each QBR to confirm owners are still correct as the
team changes.

*Last updated: 2026-07-22*
