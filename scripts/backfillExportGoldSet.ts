// scripts/backfillExportGoldSet.ts
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { BackfillReviewDb } from "../src/backfill/reviewDb.js";

const STATE_PATH = "./data/backfill-review.json";
const OUT_PATH = "./data/gold-set.jsonl";

async function main() {
  const config = loadConfig();
  if (!config.notionApiKey) throw new Error("NOTION_API_KEY required.");
  const { reviewDatabaseId } = JSON.parse(readFileSync(STATE_PATH, "utf8")) as { reviewDatabaseId: string };

  const rows = await new BackfillReviewDb(config.notionApiKey).readAllRows(reviewDatabaseId);
  writeFileSync(OUT_PATH, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const labelled = rows.filter((r) => r.isFeedback || r.classificationOk !== undefined).length;
  const gateFalsePositives = rows.filter((r) => !r.isFeedback).length;
  console.log(`✅ Exported ${rows.length} reviewed rows to ${OUT_PATH}`);
  console.log(`   ${labelled} human-labelled; ${gateFalsePositives} gate false-positive(s) (highest-value signal for tuning the gate prompt).`);
}

main().catch((err) => { console.error("Export failed:", err?.body ?? err); process.exit(1); });
