/* Spotted Zebra — Customer Feedback board seed data.
   Grounded in real captured rows (NIQ trial, Domino's, case-study evaluation,
   skills-evaluation mis-attribution, panel question assignees, AI interview deadline).
   Shared by all three prototype directions. Loaded as a plain script in <helmet>;
   exposes window.SZ_FEEDBACK (rows) + window.SZ_CATEGORY_META. */
(function () {
  // Category → soft tint (bg) + readable ink (fg). Hues per brief, tuned low-saturation
  // to stay on the white-led Spotted Zebra brand.
  var CAT = {
    "Bug / Broken":                 { bg: "#fdECEC", fg: "#b23636", dot: "#d23b3b" },
    "Feature Request":              { bg: "#e6f0ff", fg: "#0052cc", dot: "#006aff" },
    "UX / Usability":               { bg: "#f0ebfb", fg: "#6b46c1", dot: "#7c5cd6" },
    "Reporting / Data":             { bg: "#e7f4ee", fg: "#1f7a52", dot: "#1f8a5b" },
    "Pricing / Commercial":         { bg: "#fff7d6", fg: "#7a5e00", dot: "#e6b800" },
    "Onboarding / Setup":           { bg: "#fdefe2", fg: "#ב25a12", dot: "#e07a2f" },
    "Candidate Experience":         { bg: "#f2ece7", fg: "#7a5230", dot: "#a06a3c" },
    "Assessment Accuracy/Validity": { bg: "#eceef2", fg: "#4a4d57", dot: "#767a85" },
    "Compliance / Legal / Governance": { bg: "#e7ecf6", fg: "#003886", dot: "#003886" },
    "Praise":                       { bg: "#fdecf3", fg: "#b03a70", dot: "#d46396" },
    "Other":                        { bg: "#f1f3f6", fg: "#4a4d57", dot: "#9aa0ab" }
  };
  // Fix a stray character (defensive) — rebuild cleanly.
  CAT["Onboarding / Setup"] = { bg: "#fdefe2", fg: "#a2530f", dot: "#e07a2f" };

  var AUD = {
    "Recruiter":     "#0052cc",
    "Talent Leader": "#6b46c1",
    "Candidate":     "#1f8a5b",
    "Worker":        "#e07a2f",
    "Admin":         "#b23636",
    "Unknown":       "#767a85"
  };

  var rows = [
    {
      id: "f-neq-batch",
      kind: "batch",             // batch-split parent: one Slack message → N siblings
      status: "New",
      source: "Granola",
      meetingTitle: "NIQ Trial — Feedback session",
      channel: "#client-feedback",
      author: "Charlie",
      flaggedBy: "Granola (auto)",
      client: "NIQ",
      audience: "Talent Leader",
      date: "2026-07-16", rel: "5 days ago",
      confidence: "High",
      crew: "Indigo", capability: "Scheduling",
      messageUrl: "https://notes.granola.ai/t/9208942f",
      original: "NIQ Feedback from Trial — Scheduling. Separate calendar invites needed to hide interviewer emails; case-study interviews want staggered panellist joining; want Spot invited automatically via email when scheduling in the ATS.",
      siblings: [
        {
          title: "Separate calendar invites for candidates and interviewers",
          categories: ["Feature Request"], audience: "Talent Leader",
          summary: ["NIQ needs separate invites so interviewer emails stay hidden from candidates.", "Teams currently creates a visible shared chat for internal candidates."],
          status: "New",
          threads: [
            { author: "YL", rel: "2 days ago", text: "Confirmed this also affects bp — we have a partial fix but it needs more investigation.", media: { type: "image", label: "Teams invite chat" } },
            { author: "Charlie", rel: "1 day ago", text: "NIQ will retest once the separate-invite toggle is live." }
          ]
        },
        {
          title: "Staggered panellist joining for case-study interviews",
          categories: ["Feature Request"], audience: "Talent Leader",
          summary: ["Wants panellists to join at a set point in a 90-minute block (intro → prep → panel).", "Spot should stay present across the whole flow or combine the meetings."],
          status: "New"
        },
        {
          title: "Auto-invite Spot via email when scheduling in the ATS",
          categories: ["Feature Request", "Onboarding / Setup"], audience: "Admin",
          summary: ["NIQ want Spot invited automatically via email at schedule time.", "They are testing a BCC workaround in SmartRecruiters this week."],
          status: "New"
        }
      ]
    },
    {
      id: "f-casestudy-eval",
      kind: "master",           // master/child: same request across customers
      status: "Reviewed",
      source: "Slack",
      channel: "#client-feedback",
      author: "Emma Sibley",
      flaggedBy: "Emma Sibley",
      client: "NIQ",
      audience: "Talent Leader",
      date: "2026-06-30", rel: "3 weeks ago",
      confidence: "High",
      crew: "Indigo", capability: "Assessment delivery",
      demand: 4,
      linkVerification: "ai-confirmed",
      title: "Case-study evaluation needs its own tab, separate from panel interview",
      categories: ["UX / Usability", "Feature Request"],
      summary: [
        "Hiring managers can't reach the panel-interview summary when viewing the case-study evaluation.",
        "Clients want either two dedicated tabs (panel + case study) or a single consolidated view."
      ],
      messageUrl: "https://spottedzebra.slack.com/archives/C01/p123",
      original: "NIQ feedback about the Case Study interview evaluations. If the Evaluation tab displays the panel interview skills evaluation, hiring managers only see the case study summary in the Summary tab. Where should they go to review the panel interview summary? It might be beneficial to have two separate tabs, or a consolidated view.",
      relatedRationale: "All four describe hiring managers unable to separate case-study from panel evaluation in the same view.",
      relatedVerdict: "Confirmed Correct",
      jira: [{ key: "SZ-142", title: "Split panel & case-study evaluation into separate tabs", status: "In Progress", type: "Story", assignee: "D. Okafor", board: "Indigo" }],
      summaryVerdict: "Confirmed Faithful",
      judge: "Summary faithfully captures the split-view UX gap. Low ambiguity.",
      children: [
        { client: "bp", audience: "Talent Leader", rel: "1 month ago", quote: "We also lose the panel summary once the case-study evaluation loads — needs splitting out." },
        { client: "Domino's", audience: "Recruiter", rel: "6 weeks ago", quote: "Hiring managers keep asking where the panel interview write-up went." },
        { client: "FutureHire Ltd", audience: "Talent Leader", rel: "2 months ago", quote: "A dedicated case-study tab would solve this for our panels." }
      ]
    },
    {
      id: "f-skills-eval-bug",
      kind: "thread",           // has thread replies
      status: "Needs Review",
      source: "Slack",
      channel: "#client-feedback",
      author: "Nicola Griffiths",
      flaggedBy: "Live gate (auto)",
      client: "Acme Corp",
      audience: "Recruiter",
      date: "2026-07-18", rel: "3 days ago",
      confidence: "Medium",
      crew: "Indigo", capability: "Scoring engine",
      title: "Skills Evaluation attributes interviewer speech as candidate evidence",
      categories: ["Bug / Broken", "Assessment Accuracy/Validity"],
      summary: [
        "Evidence is being pulled from the interviewer instead of the candidate.",
        "Speaker 1 / Speaker 2 are labelled correctly, so attribution logic is the likely cause."
      ],
      messageUrl: "https://spottedzebra.slack.com/archives/C01/p456",
      original: "I've been reviewing Skills Evaluation on an interview last week and there are examples of evidence being pulled from something I said, rather than the candidate. It has tagged Speaker 1 and Speaker 2 correctly, so not sure why it's done that. Any ideas?",
      jira: [{ key: "SZ-207", title: "Speaker attribution pulls interviewer speech as candidate evidence", status: "In Review", type: "Bug", assignee: "M. Chen", board: "Indigo" }],
      judge: "Clear defect report but scope (one interview vs systemic) is uncertain — flagged Medium.",
      summaryVerdict: null,
      threads: [
        { author: "Carol", rel: "2 days ago", text: "Seeing this across all assessments sent this week — can we prioritise?" },
        { author: "Mike", rel: "1 day ago", text: "Reproduced on two more transcripts. Speaker mapping is right, attribution step is wrong." }
      ]
    },
    {
      id: "f-ai-deadline",
      kind: "normal",
      status: "New",
      source: "Slack",
      channel: "#client-feedback",
      author: "Mark Chalmers",
      flaggedBy: "Mark Chalmers",
      client: "Greenfield Inc",
      audience: "Recruiter",
      date: "2026-07-19", rel: "2 days ago",
      confidence: "High",
      crew: "Indigo", capability: "Candidate portal",
      title: "Set a deadline / link expiry for AI interview completion",
      categories: ["Feature Request"],
      summary: [
        "A candidate asked whether there is a deadline for completing the AI interview.",
        "Options range from a client-set custom deadline to a hardcoded expiry after a fixed period."
      ],
      messageUrl: "https://spottedzebra.slack.com/archives/C01/p789",
      original: "Product feature request: we've had a candidate ask if there is a deadline for the AI interview completion. Solutions (IMO): allow the client to set a customised deadline, set a hardcoded 2-week deadline, or say the link expires in 4 weeks.",
      judge: "Well-formed feature request with clear options.",
      summaryVerdict: "Confirmed Faithful"
    },
    {
      id: "f-intake-share",
      kind: "normal",
      status: "Reviewed",
      source: "Slack",
      channel: "#client-feedback",
      author: "Joe Wilde",
      flaggedBy: "Joe Wilde",
      client: "Domino's",
      audience: "Recruiter",
      date: "2026-07-07", rel: "2 weeks ago",
      confidence: "High",
      crew: "Indigo", capability: "Interview intelligence",
      demand: 2,
      kind2: "master",
      title: "Share and add teammates to intake call transcripts",
      categories: ["Feature Request"],
      summary: [
        "Domino's want to share / add each other to intake call transcripts, not just interviews.",
        "A small team collaborating across roles would move faster with quick transcript sharing."
      ],
      demand: 2,
      linkVerification: "ai-unverified",
      messageUrl: "https://spottedzebra.slack.com/archives/C01/p321",
      original: "Some feedback from Domino's that it would be helpful if they could share / add each other to intake call transcripts, not just interviews. They're a small team that collaborate across roles often.",
      judge: "Clear feature request; second occurrence recently.",
      relatedRationale: "Both mention sharing intake-call transcripts across a small collaborating team.",
      relatedVerdict: null,
      children: [
        { client: "TalentCo", audience: "Recruiter", rel: "1 week ago", quote: "We manually forward transcript PDFs — native sharing would help." }
      ]
    },
    {
      id: "f-dashboard",
      kind: "normal",
      status: "New",
      source: "Slack",
      channel: "#client-feedback",
      author: "Joe Wilde",
      flaggedBy: "Joe Wilde",
      client: "Domino's",
      audience: "Talent Leader",
      date: "2026-07-15", rel: "6 days ago",
      confidence: "High",
      crew: "Indigo", capability: "Reporting",
      title: "Dashboard overview view for hiring activity",
      media: { type: "image", label: "Dashboard clickthrough" },
      categories: ["Feature Request", "Reporting / Data"],
      summary: [
        "Elaine at Domino's requested a dashboard-style overview, like the clickthrough shown.",
        "The candidate draw decision kit is planned, but the overview is wanted alongside it."
      ],
      messageUrl: "https://spottedzebra.slack.com/archives/C01/p654",
      original: "Sharing this request from Elaine at Domino's for a dashboard overview type view, like the one in the clickthrough! Have told her the candidate draw decision kit is coming in the meantime.",
      jira: [{ key: "SZ-88", title: "Hiring activity dashboard (overview view)", status: "Backlog", type: "Epic", assignee: "Unassigned", board: "Indigo" }],
      judge: "Clear request; overlaps roadmap item.",
      summaryVerdict: null,
      image: true
    },
    {
      id: "f-coderbyte-vis",
      kind: "normal",
      status: "New",
      source: "Slack",
      channel: "#client-feedback",
      author: "Emma Sibley",
      flaggedBy: "Emma Sibley",
      client: "",
      audience: "Recruiter",
      date: "2026-07-14", rel: "1 week ago",
      confidence: "High",
      crew: "Indigo", capability: "Candidate portal",
      title: "Show which assessments and DEI forms are attached to a role",
      categories: ["Feature Request", "UX / Usability"],
      summary: [
        "Requests visibility in the company app for when a Coderbyte assessment or DEI form is added to a role.",
        "Customers can't currently see what candidates must complete without checking Admin."
      ],
      messageUrl: "https://spottedzebra.slack.com/archives/C01/p987",
      original: "Feedback from me, not a client, and minor: it would be great to see in the company app when a Coderbyte assessment is added to a role, and that a DEI form is added and to which stage.",
      judge: "Internal feedback; clear, low priority.",
      summaryVerdict: "Confirmed Faithful"
    },
    {
      id: "f-hm-praise",
      kind: "normal",
      status: "Reviewed",
      source: "Slack",
      channel: "#client-feedback",
      author: "Nicola Griffiths",
      flaggedBy: "Nicola Griffiths",
      client: "Acme Corp",
      audience: "Talent Leader",
      date: "2026-07-10", rel: "11 days ago",
      confidence: "High",
      crew: "Indigo", capability: "Interview intelligence",
      title: "Progressing candidates through stages felt intuitive and easy",
      categories: ["Praise"],
      summary: [
        "A hiring manager found stage progression super easy and intuitive.",
        "They loved using the product overall — shared alongside minor improvement notes."
      ],
      messageUrl: "https://spottedzebra.slack.com/archives/C01/p111",
      original: "I just wanted to share some thoughts on my recent experience as a Hiring Manager! Firstly, progressing a candidate through the stages was super easy, very intuitive etc. I loved using the product and it was a great help.",
      judge: "Positive sentiment, clearly praise.",
      summaryVerdict: "Confirmed Faithful"
    },
    {
      id: "f-panel-assignees",
      kind: "normal",
      status: "Needs Review",
      source: "Granola",
      meetingTitle: "NIQ — Interviews review",
      channel: "#client-feedback",
      author: "Charlie",
      flaggedBy: "Granola (auto)",
      client: "NIQ",
      audience: "Talent Leader",
      date: "2026-07-17", rel: "4 days ago",
      confidence: "Low",
      crew: "Indigo", capability: "Interview intelligence",
      title: "Assign individual interview-guide questions to specific panellists",
      media: { type: "video", label: "Granola clip · 0:42" },
      categories: ["Feature Request"],
      summary: [
        "In panel interviews each interviewer needs their own assigned questions.",
        "Clients want to assign at scale via a template (e.g. Q1 → Joe, Q2 → Emma)."
      ],
      messageUrl: "https://notes.granola.ai/t/9208942f",
      original: "Interview guide question assignees: in panel interviews each interviewer needs their own assigned questions. Currently shows the same guide to everyone, causing confusion about who asks what. They want to assign questions themselves at scale.",
      judge: "Feature request but conflates template vs per-role config — flagged Low for a human to disambiguate.",
      summaryVerdict: null
    },
    {
      id: "f-safari-export",
      kind: "normal",
      status: "Needs Review",
      source: "Slack",
      channel: "#product-feedback",
      author: "Live gate",
      flaggedBy: "Live gate (auto)",
      client: "Acme Corp",
      audience: "Candidate",
      date: "2026-07-21", rel: "2 hours ago",
      confidence: "Medium",
      crew: "Indigo", capability: "Candidate portal",
      title: "Export button throws an error on Safari",
      media: { type: "image", label: "Safari export error" },
      categories: ["Bug / Broken"],
      summary: [
        "Users on Safari 17+ cannot complete PDF exports.",
        "The error message is generic with no actionable guidance."
      ],
      messageUrl: "https://spottedzebra.slack.com/archives/C02/p222",
      original: "Export is broken on Safari — clicking export just throws a generic error and nothing downloads. Chrome is fine.",
      judge: "Clear bug report. Low ambiguity — Medium only because browser/version coverage is unconfirmed.",
      summaryVerdict: null
    },
    {
      id: "f-login-intermittent",
      kind: "thread",
      status: "Needs Review",
      source: "Slack",
      channel: "#product-feedback",
      author: "Sam Patel",
      flaggedBy: "Live gate (auto)",
      client: "FutureHire Ltd",
      audience: "Candidate",
      date: "2026-07-20", rel: "1 day ago",
      confidence: "Low",
      crew: "Indigo", capability: "Candidate portal",
      demand: 2,
      linkVerification: "ai-unverified",
      title: "Candidate portal login is intermittent",
      categories: ["Bug / Broken"],
      summary: [
        "Candidates report being logged out or unable to sign in intermittently.",
        "No clear reproduction steps captured yet — needs triage."
      ],
      messageUrl: "https://spottedzebra.slack.com/archives/C02/p333",
      original: "A couple of candidates said the portal logged them out mid-assessment and they couldn't get back in for a few minutes. Intermittent.",
      judge: "Possible bug but no reproduction; low confidence pending detail.",
      summaryVerdict: null,
      relatedRationale: "Both describe intermittent candidate-portal login failures.",
      threads: [
        { author: "Priya", rel: "20 hours ago", text: "One candidate sent a screenshot of a 403 — attaching to the row.", media: { type: "image", label: "403 screenshot" } }
      ]
    },
    {
      id: "f-pricing-tiers",
      kind: "normal",
      status: "New",
      source: "Slack",
      channel: "#client-feedback",
      author: "Lois Hills Williams",
      flaggedBy: "Lois Hills Williams",
      client: "TalentCo",
      audience: "Admin",
      date: "2026-07-12", rel: "9 days ago",
      confidence: "High",
      crew: "Indigo", capability: "Reporting",
      title: "Clearer breakdown of what each plan tier includes",
      categories: ["Pricing / Commercial"],
      summary: [
        "TalentCo asked for a clearer view of which features each plan tier includes.",
        "Comparing tiers currently requires back-and-forth with their account contact."
      ],
      messageUrl: "https://spottedzebra.slack.com/archives/C01/p444",
      original: "Nice suggestion to make the results section clearer, and separately we'd like a clearer breakdown of what's in each plan tier.",
      judge: "Commercial request, clearly stated.",
      summaryVerdict: null
    },
    {
      id: "f-gdpr",
      kind: "normal",
      status: "New",
      source: "Slack",
      channel: "#product-feedback",
      author: "Charlie",
      flaggedBy: "Charlie",
      client: "bp",
      audience: "Admin",
      date: "2026-07-11", rel: "10 days ago",
      confidence: "High",
      crew: "Indigo", capability: "Candidate portal",
      title: "Self-serve GDPR data deletion workflow",
      categories: ["Compliance / Legal / Governance"],
      summary: [
        "No self-serve path exists for deleting candidate data on request.",
        "Admins currently raise a ticket for each deletion — overdue for automation."
      ],
      messageUrl: "https://spottedzebra.slack.com/archives/C02/p555",
      original: "GDPR deletion is overdue — we need a self-serve way to delete candidate data rather than raising a ticket each time.",
      judge: "Compliance request, unambiguous.",
      summaryVerdict: "Confirmed Faithful"
    }
  ];

  // Normalise a couple of accidental dual-kind rows.
  rows.forEach(function (r) {
    if (r.children && r.children.length && r.kind === "normal") r.kind = "master";
    if (r.threads && r.threads.length && r.kind === "normal") r.kind = "thread";
  });

  // Pool of Jira issues for the two-way link picker (Indigo board).
  window.SZ_JIRA_POOL = [
    { key: "SZ-142", title: "Split panel & case-study evaluation into separate tabs", status: "In Progress", type: "Story", assignee: "D. Okafor", board: "Indigo" },
    { key: "SZ-207", title: "Speaker attribution pulls interviewer speech as candidate evidence", status: "In Review", type: "Bug", assignee: "M. Chen", board: "Indigo" },
    { key: "SZ-88", title: "Hiring activity dashboard (overview view)", status: "Backlog", type: "Epic", assignee: "Unassigned", board: "Indigo" },
    { key: "SZ-231", title: "Candidate portal intermittent login failures", status: "To Do", type: "Bug", assignee: "R. Silva", board: "Indigo" },
    { key: "SZ-256", title: "AI interview link expiry / completion deadline", status: "To Do", type: "Story", assignee: "Unassigned", board: "Indigo" },
    { key: "SZ-198", title: "Separate calendar invites for candidates and interviewers", status: "In Progress", type: "Story", assignee: "L. Park", board: "Indigo" },
    { key: "SZ-274", title: "Share intake-call transcripts with teammates", status: "Backlog", type: "Story", assignee: "Unassigned", board: "Indigo" },
    { key: "SZ-260", title: "Self-serve GDPR candidate data deletion", status: "To Do", type: "Task", assignee: "A. Novak", board: "Indigo" },
    { key: "SZ-219", title: "Safari 17+ PDF export failure", status: "In Progress", type: "Bug", assignee: "M. Chen", board: "Indigo" }
  ];

  window.SZ_CATEGORY_META = CAT;
  window.SZ_AUDIENCE_META = AUD;
  window.SZ_FEEDBACK = rows;
})();
