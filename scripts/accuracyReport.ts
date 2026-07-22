import "dotenv/config";
import { Client } from "@notionhq/client";
import { computeAccuracyReport, type ReviewedRow, type CategoryTaxonomyQuality } from "../src/core/accuracyReport.js";
import type { FeedbackCategory, ConfidenceLevel } from "../src/core/ports.js";

/**
 * On-demand accuracy report: pulls every row from the Customer Feedback database, computes
 * agreement/confusion/calibration stats from whichever rows a human has actually reviewed
 * (Category Reviewed ticked, or Summary Verdict set), and writes the result to a Notion page.
 *
 * Read-only against the capture pipeline — this never touches Slack or the live bot, and never
 * changes how the bot classifies anything. Run it whenever you want to check in: `npm run report`.
 */

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const FEEDBACK_ANALYTICS_PAGE_ID = "59c89b9adf5f4283a122a1bc65c2112c";

if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
  throw new Error("NOTION_API_KEY and NOTION_DATABASE_ID are required. See .env.example.");
}

const client = new Client({ auth: NOTION_API_KEY, notionVersion: "2022-06-28" });

function pctOrDash(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function reportBlocks(report: ReturnType<typeof computeAccuracyReport>) {
  const lines: string[] = [
    `Total captures: ${report.totalRows}`,
    `Category reviews: ${report.categoryReviewedCount} (agreement: ${pctOrDash(report.categoryAgreementRate)})`,
    `Summary reviews: ${report.summaryReviewedCount} (faithful: ${pctOrDash(report.summaryFaithfulRate)})`,
  ];

  const confusionLines = report.categoryConfusions.length
    ? report.categoryConfusions.map((c) => `${c.from} → ${c.to}  (${c.count}×)`)
    : ["No corrections recorded yet."];

  const calibrationLines = report.confidenceCalibration.length
    ? report.confidenceCalibration.map(
        (c) => `${c.confidence}: ${c.reviewedCount} reviewed, ${pctOrDash(c.agreementRate)} agreement`,
      )
    : ["No confidence-labeled reviews yet."];

  // Least-reviewed categories first (already sorted that way) — the gaps are the point.
  const coverageLines = report.categoryCoverage.map(
    (c) => `${c.category}: ${c.totalCaptured} captured, ${c.reviewedCount} reviewed`,
  );

  return [
    heading("Feedback AI — accuracy report"),
    paragraph(`Last updated: ${new Date().toISOString()}`),
    heading2("Summary"),
    ...lines.map(paragraph),
    heading2("Category coverage (least-reviewed first)"),
    ...coverageLines.map(paragraph),
    heading2("Most common category corrections"),
    ...confusionLines.map(paragraph),
    heading2("Confidence calibration"),
    ...calibrationLines.map(paragraph),
  ];
}

function heading(text: string) {
  return { object: "block" as const, type: "heading_1" as const, heading_1: { rich_text: [{ text: { content: text } }] } };
}
function heading2(text: string) {
  return { object: "block" as const, type: "heading_2" as const, heading_2: { rich_text: [{ text: { content: text } }] } };
}
function paragraph(text: string) {
  return { object: "block" as const, type: "paragraph" as const, paragraph: { rich_text: [{ text: { content: text } }] } };
}

function reviewQueueBlocks(rows: NeedsReviewRow[]): ReturnType<typeof heading2>[] {
  const lines = rows.length
    ? rows.map((r) => `${r.dateIso} | ${r.channelName} | ${r.proposedCategory} | ${r.confidence} | ${r.rationale.slice(0, 80)}`)
    : ["Queue is empty — nothing awaiting review."];
  return [
    heading2(`Review Queue (${rows.length} awaiting)`),
    ...lines.map(paragraph),
  ];
}

function correctionsBlocks(rows: CorrectionRow[]): ReturnType<typeof heading2>[] {
  const lines = rows.length
    ? rows.map((r) => `${r.dateIso} | ${r.messageExcerpt} | ${r.aiCategory} → ${r.humanCategory}`)
    : ["No corrections recorded yet."];
  return [heading2("Recent Corrections (last 20)"), ...lines.map(paragraph)];
}

function activityBlocks(rows: ActivityRow[]): ReturnType<typeof heading2>[] {
  const lines = rows.length
    ? rows.map((r) => `${r.dateIso} | ${r.channelName} | ${r.category} | ${r.confidence}`)
    : ["No recent activity."];
  return [heading2("Recent Activity (last 20)"), ...lines.map(paragraph)];
}

function taxonomyQualityBlocks(quality: CategoryTaxonomyQuality[]): ReturnType<typeof heading2 | typeof paragraph>[] {
  const pct = (n: number | null) => n === null ? "—" : `${Math.round(n * 100)}%`;
  const withErrors = quality.filter((q) => q.reviewedCount > 0);
  const lines = withErrors.length
    ? withErrors.map((q) => {
        const errors = q.fpCount + q.fnCount;
        const errStr = errors > 0 ? ` ⚠ FP:${q.fpCount} FN:${q.fnCount}` : "";
        return `${q.category}: prec ${pct(q.precision)}  rec ${pct(q.recall)}${errStr}  (${q.reviewedCount} reviewed)`;
      })
    : ["No reviewed rows yet — run some reviews and re-generate."];
  return [
    heading2("Taxonomy quality per category"),
    paragraph("Sorted by error count (FP = AI over-tagged, FN = AI under-tagged). Only categories with ≥1 reviewed row shown."),
    ...lines.map(paragraph),
  ];
}

async function fetchReviewedRows(): Promise<ReviewedRow[]> {
  const rows: ReviewedRow[] = [];
  let cursor: string | undefined;

  do {
    const res: any = await client.databases.query({
      database_id: NOTION_DATABASE_ID!,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of res.results) {
      const props = page.properties;
      const categories = (props["Categories"]?.multi_select ?? []).map((o: any) => o.name as FeedbackCategory);
      const aiSuggestedCategories = (props["AI Suggested Categories"]?.multi_select ?? []).map((o: any) => o.name as FeedbackCategory);
      if (categories.length === 0 || aiSuggestedCategories.length === 0) continue; // can't compute agreement without both

      rows.push({
        categories,
        aiSuggestedCategories,
        categoryReviewed: !!props["Category Reviewed"]?.checkbox,
        summaryVerdict: (props["Summary Verdict"]?.select?.name as ReviewedRow["summaryVerdict"]) ?? null,
        confidence: (props["Enrichment Confidence"]?.select?.name as ConfidenceLevel | undefined) ?? null,
      });
    }

    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  return rows;
}

interface NeedsReviewRow {
  dateIso: string;
  channelName: string;
  proposedCategory: string;
  confidence: string;
  rationale: string;
}

async function fetchNeedsReviewRows(): Promise<NeedsReviewRow[]> {
  const rows: NeedsReviewRow[] = [];
  let cursor: string | undefined;
  do {
    const res: any = await client.databases.query({
      database_id: NOTION_DATABASE_ID!,
      filter: {
        and: [
          { property: "Status", select: { equals: "Needs Review" } },
          { property: "Category Reviewed", checkbox: { equals: false } },
        ],
      },
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of res.results) {
      const props = page.properties;
      const categories = (props["Categories"]?.multi_select ?? []).map((o: any) => o.name as string);
      rows.push({
        dateIso: props["Date"]?.date?.start ?? "—",
        channelName: props["Channel"]?.rich_text?.[0]?.plain_text ?? "—",
        proposedCategory: categories.join(", ") || "—",
        confidence: props["Enrichment Confidence"]?.select?.name ?? "—",
        rationale: props["Judge Rationale"]?.rich_text?.[0]?.plain_text ?? "—",
      });
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return rows;
}

interface CorrectionRow {
  dateIso: string;
  messageExcerpt: string;
  aiCategory: string;
  humanCategory: string;
}

async function fetchRecentCorrections(limit = 20): Promise<CorrectionRow[]> {
  const rows: CorrectionRow[] = [];
  let cursor: string | undefined;
  do {
    const res: any = await client.databases.query({
      database_id: NOTION_DATABASE_ID!,
      filter: { property: "Category Reviewed", checkbox: { equals: true } },
      sorts: [{ property: "Date", direction: "descending" }],
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of res.results) {
      if (rows.length >= limit) break;
      const props = page.properties;
      const categories = (props["Categories"]?.multi_select ?? []).map((o: any) => o.name as string);
      const aiCategories = (props["AI Suggested Categories"]?.multi_select ?? []).map((o: any) => o.name as string);
      const sameCategories =
        categories.length === aiCategories.length && categories.every((c: string, i: number) => c === aiCategories[i]);
      if (sameCategories) continue; // no correction, skip
      const message: string = props["Message"]?.title?.[0]?.plain_text ?? "";
      rows.push({
        dateIso: props["Date"]?.date?.start ?? "—",
        messageExcerpt: message.slice(0, 80) + (message.length > 80 ? "…" : ""),
        aiCategory: aiCategories.join(", ") || "—",
        humanCategory: categories.join(", ") || "—",
      });
    }
    cursor = res.has_more && rows.length < limit ? res.next_cursor : undefined;
  } while (cursor);
  return rows;
}

interface ActivityRow {
  dateIso: string;
  channelName: string;
  category: string;
  confidence: string;
}

async function fetchRecentActivity(limit = 20): Promise<ActivityRow[]> {
  const rows: ActivityRow[] = [];
  let cursor: string | undefined;
  do {
    const res: any = await client.databases.query({
      database_id: NOTION_DATABASE_ID!,
      sorts: [{ property: "Date", direction: "descending" }],
      start_cursor: cursor,
      page_size: limit,
    });
    for (const page of res.results) {
      if (rows.length >= limit) break;
      const props = page.properties;
      const categories = (props["Categories"]?.multi_select ?? []).map((o: any) => o.name as string);
      rows.push({
        dateIso: props["Date"]?.date?.start ?? "—",
        channelName: props["Channel"]?.rich_text?.[0]?.plain_text ?? "—",
        category: categories.join(", ") || "—",
        confidence: props["Enrichment Confidence"]?.select?.name ?? "—",
      });
    }
    cursor = undefined; // single page sufficient for activity
  } while (cursor);
  return rows;
}

async function writeReportPage(blocks: ReturnType<typeof reportBlocks>): Promise<void> {
  const reportPageId = process.env.NOTION_REPORT_PAGE_ID;

  if (reportPageId) {
    const existing: any = await client.blocks.children.list({ block_id: reportPageId, page_size: 100 });
    for (const block of existing.results) {
      await client.blocks.delete({ block_id: block.id });
    }
    await client.blocks.children.append({ block_id: reportPageId, children: blocks });
    console.log(`Updated existing report page: ${reportPageId}`);
    return;
  }

  const page: any = await client.pages.create({
    parent: { page_id: FEEDBACK_ANALYTICS_PAGE_ID },
    properties: { title: { title: [{ text: { content: "Feedback AI — accuracy report" } }] } },
    children: blocks,
  });
  console.log(`Created new report page: ${page.id}`);
  console.log(`Save this as NOTION_REPORT_PAGE_ID in .env so future runs update it in place, instead of creating a new page each time.`);
}

async function main(): Promise<void> {
  const [reviewedRows, needsReviewRows, corrections, activity] = await Promise.all([
    fetchReviewedRows(),
    fetchNeedsReviewRows(),
    fetchRecentCorrections(),
    fetchRecentActivity(),
  ]);

  const report = computeAccuracyReport(reviewedRows);
  console.log(JSON.stringify(report, null, 2));

  const blocks = [
    ...reportBlocks(report),
    ...taxonomyQualityBlocks(report.taxonomyQuality),
    ...reviewQueueBlocks(needsReviewRows),
    ...correctionsBlocks(corrections),
    ...activityBlocks(activity),
  ];
  await writeReportPage(blocks);
}

main().catch((err) => {
  console.error("Accuracy report failed:", err);
  process.exit(1);
});
