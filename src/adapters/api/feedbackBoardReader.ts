import { Client } from "@notionhq/client";

export interface BoardRow {
  id: string;
  kind: "normal" | "master" | "batch" | "thread";
  status: string;
  source: string;
  channel: string;
  author: string;
  flaggedBy: string;
  client: string;
  audience: string;
  date: string;
  rel: string;
  confidence: string;
  crew: string;
  capability: string;
  title: string;
  categories: string[];
  summary: string[];
  messageUrl?: string;
  original: string;
  judge?: string;
  summaryVerdict?: string | null;
  demand?: number;
}

function relativeTime(dateIso: string): string {
  if (!dateIso) return "";
  const diffDays = Math.floor((Date.now() - new Date(dateIso).getTime()) / 86_400_000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return "1 week ago";
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 60) return "1 month ago";
  return `${Math.floor(diffDays / 30)} months ago`;
}

function splitSummary(text: string): string[] {
  if (!text) return [];
  const byNewline = text.split("\n").map(s => s.replace(/^[-•·]\s*/, "").trim()).filter(Boolean);
  if (byNewline.length > 1) return byNewline.slice(0, 4);
  return text.split(/\.\s+/).map(s => s.trim()).filter(Boolean).slice(0, 4)
    .map(s => s.endsWith(".") ? s : s + ".");
}

// Rule-based crew classifier — implements docs/crew-criteria-indigo.md.
// Applied at board-read time so every existing Notion row gets a crew without an AI call.
function classifyCrew(title: string, summary: string[], original: string): "Indigo" | "Unknown" {
  const text = [title, ...summary, original].join(" ").toLowerCase();

  // Positive signals from the Indigo golden criteria
  const indigoSignals = [
    "ai shortlist", "shortlist", "shortlisting",
    "screening criteria", "criteria",
    "cv upload", "cv parsing", "cv process",
    "candidate scor", "scoring",
    "evidence view", "evidence against",
    "results extract",
    "kpi report", "usage report", "usage analytics",
    "candidate portal",
    "panel interview", "case study eval",
    "assessments", "hiring manager",
    "users & access", "user management",
  ];

  // Explicit non-Indigo signals (match → Unknown, even if positive signal also present)
  const nonIndigoSignals = [
    "interview scheduling",
    "job posting", "job board",
    "offer letter", "offer management",
  ];

  const hasPositive = indigoSignals.some(s => text.includes(s));
  if (!hasPositive) return "Unknown";

  const hasNegative = nonIndigoSignals.some(s => text.includes(s));
  if (hasNegative) return "Unknown";

  return "Indigo";
}

function deriveKind(props: Record<string, any>): "normal" | "master" | "batch" | "thread" {
  if ((props["Siblings"]?.relation?.length ?? 0) > 0) return "batch";
  if ((props["Threads"]?.relation?.length ?? 0) > 0) return "thread";
  if ((props["Related Feedback"]?.relation?.length ?? 0) > 0) return "master";
  return "normal";
}

function mapPage(page: Record<string, any>): BoardRow | null {
  const props = page["properties"] as Record<string, any>;
  const source: string = props["Source"]?.rich_text?.[0]?.plain_text ?? "";
  if (source === "Thread Reply") return null;

  const title =
    (props["Title"]?.rich_text?.[0]?.plain_text ?? "").trim() ||
    (props["Message"]?.title?.[0]?.plain_text ?? "").slice(0, 80).trim();
  const summaryRaw: string =
    props["Summary"]?.rich_text?.[0]?.plain_text ??
    props["AI Suggested Summary"]?.rich_text?.[0]?.plain_text ?? "";
  const dateIso: string = props["Date"]?.date?.start ?? "";

  return {
    id: page["id"] as string,
    kind: deriveKind(props),
    status: props["Status"]?.select?.name ?? "New",
    source: source || "Slack",
    channel: props["Channel"]?.rich_text?.[0]?.plain_text ?? "",
    author: props["Author"]?.rich_text?.[0]?.plain_text ?? "",
    flaggedBy: props["Flagged By"]?.rich_text?.[0]?.plain_text ?? "",
    client:
      props["Client Company"]?.rich_text?.[0]?.plain_text ||
      props["Customer/Account"]?.rich_text?.[0]?.plain_text || "",
    audience: props["Audience"]?.select?.name ?? "Unknown",
    date: dateIso,
    rel: relativeTime(dateIso),
    confidence: props["Enrichment Confidence"]?.select?.name ?? "Medium",
    crew: classifyCrew(title, splitSummary(summaryRaw), props["Message"]?.title?.[0]?.plain_text ?? ""),
    capability: "",
    title,
    categories: (props["Categories"]?.multi_select ?? []).map((o: any) => o.name as string),
    summary: splitSummary(summaryRaw),
    messageUrl: props["Message URL"]?.url ?? undefined,
    original: props["Message"]?.title?.[0]?.plain_text ?? "",
    judge: props["Judge Rationale"]?.rich_text?.[0]?.plain_text || undefined,
    summaryVerdict: props["Summary Verdict"]?.select?.name ?? null,
    demand: props["Related Count"]?.rollup?.number || undefined,
  };
}

// Category and audience colour meta — mirrors feedback-data.js so the board renders correctly.
const CATEGORY_META = {
  "Bug / Broken":                    { bg: "#fdECEC", fg: "#b23636", dot: "#d23b3b" },
  "Feature Request":                  { bg: "#e6f0ff", fg: "#0052cc", dot: "#006aff" },
  "UX / Usability":                   { bg: "#f0ebfb", fg: "#6b46c1", dot: "#7c5cd6" },
  "Reporting / Data":                 { bg: "#e7f4ee", fg: "#1f7a52", dot: "#1f8a5b" },
  "Pricing / Commercial":             { bg: "#fff7d6", fg: "#7a5e00", dot: "#e6b800" },
  "Onboarding / Setup":               { bg: "#fdefe2", fg: "#a2530f", dot: "#e07a2f" },
  "Candidate Experience":             { bg: "#f2ece7", fg: "#7a5230", dot: "#a06a3c" },
  "Assessment Accuracy/Validity":     { bg: "#eceef2", fg: "#4a4d57", dot: "#767a85" },
  "Compliance / Legal / Governance":  { bg: "#e7ecf6", fg: "#003886", dot: "#003886" },
  "Praise":                           { bg: "#fdecf3", fg: "#b03a70", dot: "#d46396" },
  "Other":                            { bg: "#f1f3f6", fg: "#4a4d57", dot: "#9aa0ab" },
};

const AUDIENCE_META = {
  "Recruiter":      "#0052cc",
  "Talent Leader":  "#6b46c1",
  "Candidate":      "#1f8a5b",
  "Worker":         "#e07a2f",
  "Admin":          "#b23636",
  "Unknown":        "#767a85",
};

export function generateFeedbackDataJs(rows: BoardRow[]): string {
  return [
    "/* Live Notion data — generated by sz-feedback-catcher */",
    "(function () {",
    `  window.SZ_CATEGORY_META = ${JSON.stringify(CATEGORY_META)};`,
    `  window.SZ_AUDIENCE_META = ${JSON.stringify(AUDIENCE_META)};`,
    `  window.SZ_FEEDBACK      = ${JSON.stringify(rows, null, 2)};`,
    `  window.SZ_JIRA_POOL     = [];`,
    "})();",
  ].join("\n");
}

export class FeedbackBoardReader {
  private client: Client;

  constructor(apiKey: string, private databaseId: string) {
    this.client = new Client({ auth: apiKey, notionVersion: "2022-06-28" });
  }

  async readAllRows(): Promise<BoardRow[]> {
    const rows: BoardRow[] = [];
    let cursor: string | undefined;
    do {
      const res: any = await this.client.databases.query({
        database_id: this.databaseId,
        sorts: [{ property: "Date", direction: "descending" }],
        start_cursor: cursor,
        page_size: 100,
      });
      for (const page of res.results) {
        const row = mapPage(page as Record<string, any>);
        if (row) rows.push(row);
      }
      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);
    return rows;
  }
}
