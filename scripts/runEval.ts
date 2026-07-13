// scripts/runEval.ts
// Usage:
//   npx tsx scripts/runEval.ts gate      — gate precision/recall/F1 + breakdown by confidence bucket
//   npx tsx scripts/runEval.ts enricher  — category accuracy overall + per-category table
//   npx tsx scripts/runEval.ts judge     — judge calibration (runs enricher + judge; expensive)
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { ClaudeFeedbackGate } from "../src/adapters/gate/claudeFeedbackGate.js";
import { ClaudeEnricher } from "../src/adapters/enricher/claudeEnricher.js";
import { ClaudeJudge } from "../src/adapters/judge/claudeJudge.js";
import { loadPrompt } from "../src/util/loadPrompt.js";
import { loadGuideFile } from "../src/util/loadGuideFile.js";
import { CATEGORIES } from "../src/core/taxonomy.js";
import type { FeedbackCategory, ConfidenceLevel } from "../src/core/ports.js";

// Eval-only config: only the fields this script actually needs.
// Avoids calling loadConfig() which requires SLACK_BOT_TOKEN / SLACK_APP_TOKEN.
interface EvalConfig {
  anthropicApiKey?: string;
  enrichmentStyleGuidePath: string;
}

function loadEvalConfig(): EvalConfig {
  return {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
    enrichmentStyleGuidePath:
      (process.env.ENRICHMENT_STYLE_GUIDE_PATH?.trim()) ||
      "./docs/enrichment-style-guide.md",
  };
}

// RFC4180-compliant CSV parser — handles quoted multi-line fields correctly.
// Does NOT pre-split on newlines; newlines inside quoted fields are preserved.
function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const allRows = parseCSVRows(text.replace(/\r\n?/g, "\n"));
  if (allRows.length === 0) return { headers: [], rows: [] };
  const headers = allRows[0];
  const rows = allRows.slice(1).map((cells) =>
    Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]))
  );
  return { headers, rows };
}

function parseCSVRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      i++;
      while (i < text.length) {
        if (text[i] === '"' && text[i + 1] === '"') { cell += '"'; i += 2; }
        else if (text[i] === '"') { i++; break; }
        else { cell += text[i++]; }
      }
    } else if (text[i] === ',') {
      row.push(cell); cell = ""; i++;
    } else if (text[i] === '\n') {
      row.push(cell); cell = "";
      rows.push(row); row = []; i++;
    } else {
      cell += text[i++];
    }
  }
  if (cell || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

function readPromptVersion(key: string): string {
  try {
    return readFileSync("./prompts/config.yaml", "utf8").match(new RegExp(`${key}:\\s*(\\S+)`))?.[1] ?? "unknown";
  } catch { return "unknown"; }
}

function f1Score(tp: number, fp: number, fn: number): number {
  const p = tp / (tp + fp) || 0;
  const r = tp / (tp + fn) || 0;
  return p + r > 0 ? 2 * p * r / (p + r) : 0;
}

// ─── Gate Eval ───────────────────────────────────────────────────────────────

async function evalGate(config: EvalConfig) {
  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY required.");
  const { rows } = parseCSV(readFileSync("./data/gold-set.csv", "utf8"));
  const gate = new ClaudeFeedbackGate(config.anthropicApiKey, loadPrompt("gate"));
  const promptVersion = readPromptVersion("gate");

  const results: unknown[] = [];
  let tp = 0, tn = 0, fp = 0, fn = 0;

  // Confidence-bucket tracking — uses the gate's OWN confidence on THIS run (not the backfill's)
  const buckets: Record<string, { tp: number; tn: number; fp: number; fn: number }> = {
    High: { tp: 0, tn: 0, fp: 0, fn: 0 },
    Medium: { tp: 0, tn: 0, fp: 0, fn: 0 },
    Low: { tp: 0, tn: 0, fp: 0, fn: 0 },
  };

  for (const row of rows) {
    const humanLabel = row["is_feedback"] === "true";
    const result = await gate.classify(row["message"], "eval");
    const predicted = result?.isLikelyFeedback ?? false;
    const conf = result?.confidence ?? "Low";

    if (humanLabel && predicted) { tp++; buckets[conf].tp++; }
    else if (!humanLabel && !predicted) { tn++; buckets[conf].tn++; }
    else if (!humanLabel && predicted) { fp++; buckets[conf].fp++; }
    else { fn++; buckets[conf].fn++; }

    results.push({
      pageId: row["pageId"],
      humanLabel,
      predicted,
      confidence: conf,
      rationale: result?.rationale,
      originalGateConfidence: row["gate_confidence"], // from backfill scan — for cross-reference
    });
  }

  const precision = tp / (tp + fp) || 0;
  const recall = tp / (tp + fn) || 0;
  const overallF1 = f1Score(tp, fp, fn);

  const confidenceBreakdown = Object.fromEntries(
    Object.entries(buckets).map(([conf, b]) => [
      conf,
      {
        count: b.tp + b.tn + b.fp + b.fn,
        f1: f1Score(b.tp, b.fp, b.fn),
        precision: b.tp / (b.tp + b.fp) || 0,
        recall: b.tp / (b.tp + b.fn) || 0,
      },
    ])
  );

  console.log("\n=== Gate Eval ===");
  console.log(`Prompt version: ${promptVersion}`);
  console.log(`Overall  — Precision: ${(precision * 100).toFixed(1)}%  Recall: ${(recall * 100).toFixed(1)}%  F1: ${(overallF1 * 100).toFixed(1)}%  (TP=${tp} TN=${tn} FP=${fp} FN=${fn})`);
  console.log("\nBy gate confidence (this run):");
  for (const [conf, b] of Object.entries(confidenceBreakdown)) {
    console.log(`  ${conf.padEnd(6)} n=${b.count}  F1=${(b.f1 * 100).toFixed(1)}%  Prec=${(b.precision * 100).toFixed(1)}%  Rec=${(b.recall * 100).toFixed(1)}%`);
  }

  const summary = { promptVersion, tp, tn, fp, fn, precision, recall, f1: overallF1, total: rows.length, confidenceBreakdown };
  return { summary, rows: results };
}

// ─── Enricher Eval ───────────────────────────────────────────────────────────

/**
 * Gold label derivation (returns ALL correct categories for multi-category gold):
 * - corrected_category non-empty → explicit correction (pipe-separated if >1) → use it
 * - corrected_category empty + classification_ok=true → proposed_category was affirmed correct → use it
 * - else → skip (ambiguous, no reliable ground truth)
 */
function goldLabel(row: Record<string, string>): FeedbackCategory[] | null {
  if (row["is_feedback"] !== "true") return null;
  if (row["corrected_category"]) return row["corrected_category"].split("|") as FeedbackCategory[];
  if (row["classification_ok"] === "true" && row["proposed_category"]) return [row["proposed_category"] as FeedbackCategory];
  return null;
}

async function evalEnricher(config: EvalConfig) {
  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY required.");
  const { rows } = parseCSV(readFileSync("./data/gold-set.csv", "utf8"));
  const styleGuide = loadGuideFile(config.enrichmentStyleGuidePath);
  const enricher = new ClaudeEnricher(config.anthropicApiKey, loadPrompt("enricher"), styleGuide);
  const promptVersion = readPromptVersion("enricher");

  const evalRows = rows.map((r) => ({ row: r, gold: goldLabel(r) })).filter((x) => x.gold !== null);
  console.log(`\nEnricher eval: ${evalRows.length} rows with reliable gold labels (${rows.length - evalRows.length} skipped — ambiguous or non-feedback)`);

  const results: unknown[] = [];
  let categoryMatches = 0;

  // Per-category tracking
  const perCat: Record<string, { correct: number; total: number }> = {};
  for (const cat of CATEGORIES) perCat[cat] = { correct: 0, total: 0 };

  for (const { row, gold } of evalRows) {
    const result = await enricher.enrich(row["message"], "eval");
    const primaryPredicted = result?.categories[0] ?? null;
    const primaryGold = gold![0];
    const match = primaryPredicted !== null && gold!.includes(primaryPredicted);
    if (!perCat[primaryGold]) {
      console.warn(`  ⚠️  Unknown gold category "${primaryGold}" (pageId: ${row["pageId"]}) — skipping`);
      continue;
    }
    if (match) categoryMatches++;
    perCat[primaryGold].total++;
    if (match) perCat[primaryGold].correct++;

    results.push({
      pageId: row["pageId"],
      gold: gold!,
      predictedCategories: result?.categories,
      summaryProduced: result?.summary,
      primaryMatch: match,
    });
  }

  const accuracy = categoryMatches / evalRows.length;

  console.log("\n=== Enricher Eval ===");
  console.log(`Prompt version: ${promptVersion}`);
  console.log(`Overall primary category accuracy: ${(accuracy * 100).toFixed(1)}% (${categoryMatches}/${evalRows.length})`);
  console.log("\nPer-category accuracy (gold rows only):");
  const sorted = Object.entries(perCat)
    .filter(([, v]) => v.total > 0)
    .sort(([, a], [, b]) => (a.correct / a.total) - (b.correct / b.total));
  for (const [cat, v] of sorted) {
    const pct = (v.correct / v.total * 100).toFixed(0);
    console.log(`  ${String(pct + "%").padStart(4)}  (${v.correct}/${v.total})  ${cat}`);
  }

  const summary = {
    promptVersion, categoryMatches, total: evalRows.length, primaryCategoryAccuracy: accuracy,
    perCategory: Object.fromEntries(Object.entries(perCat).filter(([, v]) => v.total > 0)),
  };
  return { summary, rows: results };
}

// ─── Judge Calibration Eval ───────────────────────────────────────────────────
//
// Runs enricher + judge on each feedback row. Answers: "When judge says High confidence,
// is the enricher's primary category actually correct?" If High confidence ≠ high accuracy,
// the judge is miscalibrated and its confidence routing in W4 (live gate) is unreliable.
//
// This is the most expensive eval (2× API calls per row). Run after W3 prompt tuning.

async function evalJudge(config: EvalConfig) {
  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY required.");
  const { rows } = parseCSV(readFileSync("./data/gold-set.csv", "utf8"));
  const styleGuide = loadGuideFile(config.enrichmentStyleGuidePath);
  const enricher = new ClaudeEnricher(config.anthropicApiKey, loadPrompt("enricher"), styleGuide);
  const judge = new ClaudeJudge(config.anthropicApiKey, loadPrompt("judge"));
  const enricherVersion = readPromptVersion("enricher");
  const judgeVersion = readPromptVersion("judge");

  const evalRows = rows.map((r) => ({ row: r, gold: goldLabel(r) })).filter((x) => x.gold !== null);
  console.log(`\nJudge calibration eval: ${evalRows.length} rows`);

  const results: unknown[] = [];
  const buckets: Record<ConfidenceLevel, { correct: number; total: number }> = {
    High: { correct: 0, total: 0 },
    Medium: { correct: 0, total: 0 },
    Low: { correct: 0, total: 0 },
  };

  for (const { row, gold } of evalRows) {
    const enrichment = await enricher.enrich(row["message"], "eval");
    if (!enrichment) {
      results.push({ pageId: row["pageId"], gold, enrichmentNull: true });
      continue;
    }
    const verdict = await judge.review(row["message"], "eval", enrichment.summary, enrichment.categories);
    const conf = (verdict?.confidence ?? "Low") as ConfidenceLevel;
    const match = gold!.some((g) => enrichment.categories.includes(g));

    buckets[conf].total++;
    if (match) buckets[conf].correct++;

    results.push({
      pageId: row["pageId"],
      gold: gold!,
      predictedCategories: enrichment.categories,
      primaryMatch: match,
      judgeConfidence: conf,
      judgeRationale: verdict?.rationale,
    });
  }

  console.log("\n=== Judge Calibration ===");
  console.log(`Enricher version: ${enricherVersion}  Judge version: ${judgeVersion}`);
  console.log("Judge confidence → primary category accuracy:");
  for (const conf of ["High", "Medium", "Low"] as ConfidenceLevel[]) {
    const b = buckets[conf];
    if (b.total === 0) { console.log(`  ${conf.padEnd(6)} n=0  (no samples)`); continue; }
    const acc = (b.correct / b.total * 100).toFixed(1);
    console.log(`  ${conf.padEnd(6)} n=${b.total}  accuracy=${acc}%  (${b.correct}/${b.total} correct)`);
  }
  console.log("Well-calibrated: High > Medium > Low accuracy. If not, judge confidence is not meaningful.");

  const summary = { enricherVersion, judgeVersion, buckets, total: evalRows.length };
  return { summary, rows: results };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const adapterArg = process.argv.find((a) => a === "gate" || a === "enricher" || a === "judge");
  if (!adapterArg) {
    console.error("Usage: npx tsx scripts/runEval.ts gate|enricher|judge");
    process.exit(1);
  }

  if (!existsSync("./data/gold-set.csv")) throw new Error("./data/gold-set.csv not found. Run backfillExportGoldSet first.");

  const config = loadEvalConfig();
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  mkdirSync("./data/eval-results", { recursive: true });

  let result: { summary: unknown; rows: unknown[] };
  if (adapterArg === "gate") result = await evalGate(config);
  else if (adapterArg === "enricher") result = await evalEnricher(config);
  else result = await evalJudge(config);

  const summary = result.summary as Record<string, unknown>;
  const version = (summary["promptVersion"] ?? summary["judgeVersion"] ?? "unknown") as string;
  const outPath = `./data/eval-results/${ts}-${adapterArg}-${version}.json`;
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`\nResults saved to ${outPath}`);
}

main().catch((err) => { console.error("Eval failed:", err); process.exit(1); });
