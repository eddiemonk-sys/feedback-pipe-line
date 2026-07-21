# Crew classification — Indigo

> Golden criteria and examples for answering: "Does this feedback belong to the Indigo crew?"
> Binary output: **Indigo** or **not Indigo**. If not Indigo, crew is unknown (to be assigned later).

---

## What Indigo owns

### Primary — AI Shortlist

| Sub-area | What it covers |
|----------|---------------|
| Criteria suggestion | AI suggests shortlisting criteria from a job description |
| CV upload & processing | Manual upload or ATS import of candidate CVs (note: pure ATS connection/sync issues may belong to Emerald — see ambiguous signals below) |
| Candidate scoring | AI scores candidates against the recruiter's defined criteria |
| Evidence view | Viewing per-criteria evidence for each candidate in the shortlist |

### Secondary

| Sub-area | What it covers |
|----------|---------------|
| Users & access | User accounts, permissions, roles, access control |
| Results extracts | Exporting or extracting shortlist results (e.g. to spreadsheet, for hiring manager) |
| Reporting / KPI / usage | Usage analytics, KPI dashboards, reporting on shortlisting activity |

---

## Problem context

Recruiters have to screen more applications than they can handle, faster than they can do well, against criteria that don't reliably predict who will succeed. AI Shortlist lets a recruiter define the criteria that matter, then uses AI to synthesise each candidate's application against those criteria — providing an evidence level per criterion and surfacing evidence to back it up. The recruiter gets a clear, criteria-backed view of each candidate: faster, better shortlisting decisions.

This context matters for classification: feedback is Indigo if it touches **any part of this workflow** — defining criteria, processing CVs, scoring candidates, reviewing evidence, or extracting/reporting on the results.

---

## Golden criteria

### Classify as Indigo if the feedback mentions ANY of:

1. **"AI Shortlist"** — explicit product name; strongest signal regardless of topic
2. **Shortlisting, screening, shortlist, or criteria** — any reference to the shortlisting workflow or the criteria used to screen candidates
3. **CV upload, CV parsing, application import, or candidate processing** — getting candidate data into the system
4. **Candidate scoring, scores, or ranking** — the AI's assessment of candidates
5. **Evidence, evidence view, or criteria evidence** — what backs up a candidate's score
6. **Users, access, permissions, or roles** — user management within the product
7. **Shortlist export, results extract, or download** — getting shortlist data out
8. **KPI report, usage report, or usage analytics** — reporting on shortlisting activity

### Ambiguous signals — flag for review, do not auto-assign:

- **ATS integration / ATS sync** — if the issue is about CV/candidate data not arriving correctly, it's probably Indigo (CV processing). If it's about the ATS connection itself failing, it may be Emerald. When unclear, flag as `crew: indigo?` for human review.

### Not Indigo — classify as unknown if feedback is clearly about:

- Interview scheduling, video interviews, or interview links
- Job posting, job boards, or sourcing candidates
- Offer management or contracts
- Onboarding post-hire
- Billing or commercial terms
- General platform / login issues unrelated to AI Shortlist or the sub-areas above

---

## Golden examples

### Indigo ✅

| # | Message | Sub-area |
|---|---------|----------|
| 1 | "The AI Shortlist criteria suggestions aren't relevant — it keeps suggesting 'leadership experience' even for individual contributor roles." | Criteria suggestion |
| 2 | "Bulk CV upload failed when we had more than 100 applicants — it just timed out." | CV upload & processing |
| 3 | "Two candidates with almost identical CVs got very different scores. Not sure the scoring is calibrated right." | Candidate scoring |
| 4 | "I can see the score but I can't find the evidence behind it — where does it show the reasoning?" | Evidence view |
| 5 | "We need to extract the shortlist results into a spreadsheet to share with the hiring manager." | Results extracts |
| 6 | "Can we get a KPI report showing how many candidates are screened per role per week?" | Reporting / KPI |
| 7 | "One of our recruiters can't access the AI Shortlist — their permissions seem wrong." | Users & access |
| 8 | "The score for this candidate looks completely wrong — she has exactly the experience we asked for and scored low." | Candidate scoring |
| 9 | "Would love the criteria to auto-populate from the JD so we don't have to type them in each time." | Criteria suggestion |

### Ambiguous ⚠️ — flag for review

| # | Message | Why ambiguous |
|---|---------|---------------|
| 10 | "Our ATS isn't syncing candidates across properly — they're not showing up in AI Shortlist." | Could be Emerald (ATS connection) or Indigo (CV processing pipeline). Flag as `crew: indigo?`. |
| 11 | "The Workable integration is dropping some candidates." | Same as above — ATS sync vs. CV import boundary unclear. |

### Not Indigo ❌

| # | Message | Likely area |
|---|---------|-------------|
| 12 | "The interview scheduling link isn't working for candidates." | Interview module (not Indigo) |
| 13 | "We can't post our job to LinkedIn from the platform." | Sourcing / job boards |
| 14 | "The offer letter template is showing the wrong company name." | Offer management |
| 15 | "We're being charged for users who have left." | Billing / commercial |
