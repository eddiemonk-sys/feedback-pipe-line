// scripts/backfillExportGoldSet.ts
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { BackfillReviewDb } from "../src/backfill/reviewDb.js";

const STATE_PATH = "./data/backfill-review.json";
const OUT_PATH = "./data/gold-set.csv";

function csvCell(v: string | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cells: (string | boolean | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}

async function main() {
  const notionApiKey = process.env.NOTION_API_KEY;
  if (!notionApiKey) throw new Error("NOTION_API_KEY required.");
  const { reviewDatabaseId } = JSON.parse(readFileSync(STATE_PATH, "utf8")) as { reviewDatabaseId: string };

  const rows = await new BackfillReviewDb(notionApiKey).readAllRows(reviewDatabaseId);

  const header = csvRow([
    "pageId", "message", "is_feedback", "gate_confidence",
    "proposed_category", "proposed_summary", "corrected_category",
    "corrected_summary", "classification_ok", "eddie_notes", "enriched_rationale",
  ]);

  const lines = rows.map((r) =>
    csvRow([
      r.pageId,
      r.message,
      r.isFeedback ?? null,
      r.gateConfidence ?? null,
      r.proposedCategory ?? null,
      r.proposedSummary ?? null,
      r.correctedCategory ?? null,
      r.correctedSummary ?? null,
      r.classificationOk ?? null,
      r.correctionNotes ?? null,
      "", // enriched_rationale — filled by distillation script
    ])
  );

  writeFileSync(OUT_PATH, [header, ...lines].join("\n") + "\n");

  const labelled = rows.filter((r) => r.isFeedback !== undefined).length;
  const gateFP = rows.filter((r) => r.isFeedback === false).length;
  console.log(`Exported ${rows.length} rows to ${OUT_PATH}`);
  console.log(`  ${labelled} human-labelled, ${gateFP} gate false-positives`);
}

main().catch((err) => { console.error("Export failed:", err?.body ?? err); process.exit(1); });
