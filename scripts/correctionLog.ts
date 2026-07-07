import "dotenv/config";
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { Client } from "@notionhq/client";
import {
  detectEnricherCorrections,
  detectSimilarityCorrections,
  toEnricherLogEntry,
  toSimilarityLogEntry,
  renderNewEntries,
  parseLoggedKeys,
  type CorrectionRow,
  type LogEntry,
} from "../src/core/correctionLog.js";
import type { FeedbackCategory } from "../src/core/ports.js";

/**
 * On-demand: pulls human corrections out of the Customer Feedback DB (category mismatches,
 * "Not Faithful" summaries, "Confirmed Incorrect" links) and appends any NEW ones to two staging
 * logs. Read-only against the pipeline. You then read the logs and hand-distil recurring patterns
 * into docs/enrichment-style-guide.md / docs/similarity-rules.md. Run: `npm run correction-log`.
 *
 * Idempotent: each entry carries a dedup key, so re-running only adds genuinely new corrections
 * and never rewrites what's already there (including anything you've hand-edited).
 */

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const ENRICHMENT_LOG = process.env.ENRICHMENT_CORRECTION_LOG_PATH ?? "./enrichment-correction-log.md";
const SIMILARITY_LOG = process.env.SIMILARITY_CORRECTION_LOG_PATH ?? "./similarity-correction-log.md";

if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
  throw new Error("NOTION_API_KEY and NOTION_DATABASE_ID are required. See .env.example.");
}

const client = new Client({ auth: NOTION_API_KEY, notionVersion: "2022-06-28" });

const text = (p: any): string | null => p?.rich_text?.[0]?.plain_text ?? null;
const title = (p: any): string => p?.title?.[0]?.plain_text ?? "";
const selectName = (p: any): string | null => p?.select?.name ?? null;

async function fetchRows(): Promise<CorrectionRow[]> {
  const pages: any[] = [];
  let cursor: string | undefined;
  do {
    const res: any = await client.databases.query({
      database_id: NOTION_DATABASE_ID!,
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  // pageId -> summary first, so a wrongly-linked row's summary can be resolved for the log.
  const summaryById = new Map<string, string>();
  for (const p of pages) summaryById.set(p.id, text(p.properties?.["Summary"]) ?? "");

  return pages.map((p): CorrectionRow => {
    const props = p.properties ?? {};
    const relatedId: string | undefined = props["Related Feedback"]?.relation?.[0]?.id;
    return {
      pageId: p.id,
      message: title(props["Message"]),
      category: selectName(props["Category"]) as FeedbackCategory | null,
      aiSuggestedCategory: selectName(props["AI Suggested Category"]) as FeedbackCategory | null,
      categoryReviewed: !!props["Category Reviewed"]?.checkbox,
      summary: text(props["Summary"]),
      aiSuggestedSummary: text(props["AI Suggested Summary"]),
      summaryVerdict: selectName(props["Summary Verdict"]) as CorrectionRow["summaryVerdict"],
      relatedVerdict: selectName(props["Related Feedback Verdict"]) as CorrectionRow["relatedVerdict"],
      relatedMatchedSummary: relatedId ? summaryById.get(relatedId) ?? null : null,
      relatedRationale: text(props["Related Feedback Rationale"]),
    };
  });
}

/** Appends new entries to a log file (creating it with a header if absent). Returns the new count. */
function updateLog(path: string, entries: LogEntry[], dateIso: string, header: string): number {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const alreadyLogged = parseLoggedKeys(existing);
  const newCount = entries.filter((e) => !alreadyLogged.has(e.key)).length;
  if (newCount === 0) return 0;
  const block = renderNewEntries(entries, alreadyLogged, dateIso);
  if (existing) appendFileSync(path, block, "utf8");
  else writeFileSync(path, header + "\n" + block, "utf8");
  return newCount;
}

const ENRICHMENT_HEADER = `# Enrichment Correction Log

Raw AI-vs-human corrections pulled from Notion by \`npm run correction-log\`. Read these, look for
patterns that repeat, and hand-write anything that generalises into \`docs/enrichment-style-guide.md\`
(see DISTILLED-RULES-PRD.md). Gitignored — contains verbatim customer text.`;

const SIMILARITY_HEADER = `# Similarity Correction Log

Links a human marked "Confirmed Incorrect" (false positives), pulled by \`npm run correction-log\`.
Distil recurring patterns into \`docs/similarity-rules.md\` (see DISTILLED-RULES-PRD.md). Gitignored
— contains verbatim customer text.`;

async function main(): Promise<void> {
  const rows = await fetchRows();
  const dateIso = new Date().toISOString().slice(0, 10);

  const enricherEntries = detectEnricherCorrections(rows).map(toEnricherLogEntry);
  const similarityEntries = detectSimilarityCorrections(rows).map(toSimilarityLogEntry);

  const eAdded = updateLog(ENRICHMENT_LOG, enricherEntries, dateIso, ENRICHMENT_HEADER);
  const sAdded = updateLog(SIMILARITY_LOG, similarityEntries, dateIso, SIMILARITY_HEADER);

  console.log(`Scanned ${rows.length} feedback row(s).`);
  console.log(`Enrichment corrections: ${enricherEntries.length} found, ${eAdded} new → ${ENRICHMENT_LOG}`);
  console.log(`Similarity corrections: ${similarityEntries.length} found, ${sAdded} new → ${SIMILARITY_LOG}`);
  if (eAdded + sAdded === 0) {
    console.log(
      "Nothing new to log. Review more rows in Notion (tick Category Reviewed, set Summary Verdict / Related Feedback Verdict) — and note only rows with a frozen AI Suggested Category/Summary can be diffed.",
    );
  } else {
    console.log("Read the logs above, then distil recurring patterns into the guides in docs/.");
  }
}

main().catch((err) => {
  console.error("correction-log failed:", err?.body ?? err);
  process.exit(1);
});
