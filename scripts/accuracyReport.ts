import "dotenv/config";
import { Client } from "@notionhq/client";
import { computeAccuracyReport, type ReviewedRow } from "../src/core/accuracyReport.js";
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
      const category = props["Category"]?.select?.name as FeedbackCategory | undefined;
      const aiSuggestedCategory = props["AI Suggested Category"]?.select?.name as FeedbackCategory | undefined;
      if (!category || !aiSuggestedCategory) continue; // can't compute agreement without both

      rows.push({
        category,
        aiSuggestedCategory,
        categoryReviewed: !!props["Category Reviewed"]?.checkbox,
        summaryVerdict: (props["Summary Verdict"]?.select?.name as ReviewedRow["summaryVerdict"]) ?? null,
        confidence: (props["Enrichment Confidence"]?.select?.name as ConfidenceLevel | undefined) ?? null,
      });
    }

    cursor = res.has_more ? res.next_cursor : undefined;
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
  const rows = await fetchReviewedRows();
  const report = computeAccuracyReport(rows);
  console.log(JSON.stringify(report, null, 2));
  await writeReportPage(reportBlocks(report));
}

main().catch((err) => {
  console.error("Accuracy report failed:", err);
  process.exit(1);
});
