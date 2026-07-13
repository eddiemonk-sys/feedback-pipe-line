import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const CSV_PATH = "./data/gold-set.csv";
const MODEL = "claude-haiku-4-5-20251001";

// Minimal RFC4180 CSV parser. Handles quoted fields (double-quote escaping).
function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n?/g, "\n").trim().split("\n");
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const cells = parseCSVLine(l);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
  return { headers, rows };
}

function parseCSVLine(line: string): string[] {
  const cells: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let cell = "";
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { cell += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { cell += line[i++]; }
      }
      cells.push(cell);
      if (line[i] === ",") i++;
    } else {
      const end = line.indexOf(",", i);
      cells.push(end === -1 ? line.slice(i) : line.slice(i, end));
      i = end === -1 ? line.length : end + 1;
    }
  }
  return cells;
}

function csvCell(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function serializeCSV(headers: string[], rows: Record<string, string>[]): string {
  const headerLine = headers.map(csvCell).join(",");
  const dataLines = rows.map((r) => headers.map((h) => csvCell(r[h] ?? "")).join(","));
  return [headerLine, ...dataLines].join("\n") + "\n";
}

const SYSTEM_PROMPT = `You are a reasoning distillation agent for a feedback pipeline.

You will be given a Slack message and a human reviewer's verdict. Your job is to write a clear, full principle explaining WHY the reviewer made their decision — one that a future AI can use as a rule.

## Gold set encoding — understand this first:

The CORRECTION_NOTES field is the primary signal. It contains free-text reasoning, category corrections, summary tweaks, and nuances. The structured corrected_category and corrected_summary fields are nearly empty (most corrections are in the notes). Read correction_notes FIRST.

- is_feedback=true + classification_ok=true + corrected_category empty → proposed category was correct; check correction_notes for any summary nuances.
- is_feedback=true + corrected_category filled OR classification_ok=false → the category was wrong; correction_notes explains the correct reasoning.
- is_feedback=false → gate false positive; correction_notes explains what signals made it look like feedback but wasn't.

## Rules for your rationale:
- Eddie's verdict is FINAL. Articulate the reasoning behind it, never question it.
- For false positives (is_feedback=false): explain exactly what signals identify this as NOT customer feedback. Be specific to THIS message.
- For true positives (is_feedback=true): confirm why it IS feedback and what the correct category is.
- Incorporate everything in correction_notes — that's the authoritative source.
- 2-4 sentences max. Specific to this message, not generic.
- Do not invent signals not present in the message or notes.

Set needs_annotation=true ONLY for feedback rows (is_feedback=true) where correction_notes is completely empty or contains only "yes"/"no" — meaning there is genuinely no reasoning to distill. Non-feedback rows with empty notes are fine (the message itself explains why it's not feedback).`;

async function distillRow(
  client: Anthropic,
  row: Record<string, string>,
): Promise<{ rationale: string; needsAnnotation: boolean }> {
  const isFeedback = row["is_feedback"] === "true";
  const classificationOk = row["classification_ok"] === "true";
  const correctionNotes = row["correction_notes"]?.trim() || "";

  const prompt = `Message: ${row["message"] || "(none)"}
is_feedback: ${row["is_feedback"]}
classification_ok: ${row["classification_ok"] || "(not set — not applicable for non-feedback rows)"}
proposed_category: ${row["proposed_category"] || "(none)"}
corrected_category: ${row["corrected_category"] || "(empty — see correction_notes or classification_ok)"}
corrected_summary: ${row["corrected_summary"] || "(empty)"}
correction_notes: ${correctionNotes || "(empty)"}`;

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 384,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
      tools: [
        {
          name: "submit_rationale",
          input_schema: {
            type: "object" as const,
            properties: {
              rationale: { type: "string" },
              needs_annotation: { type: "boolean" },
            },
            required: ["rationale", "needs_annotation"],
          },
          description: "Submit the distilled rationale",
        },
      ],
      tool_choice: { type: "tool", name: "submit_rationale" },
    });
    const toolUse = res.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return { rationale: "", needsAnnotation: true };
    const input = toolUse.input as { rationale: string; needs_annotation: boolean };
    return { rationale: input.rationale ?? "", needsAnnotation: !!input.needs_annotation };
  } catch {
    return { rationale: "", needsAnnotation: true };
  }
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY required.");

  const client = new Anthropic({ apiKey });
  const text = readFileSync(CSV_PATH, "utf8");
  const { headers, rows } = parseCSV(text);

  if (!headers.includes("enriched_rationale")) throw new Error("CSV missing enriched_rationale column. Run backfillExportGoldSet first.");

  // Only process rows that don't already have a rationale
  const toProcess = rows.filter((r) => !r["enriched_rationale"]?.trim());
  console.log(`Processing ${toProcess.length} rows (${rows.length - toProcess.length} already done)...`);

  const flaggedPageIds: string[] = [];
  let done = 0;

  for (const row of toProcess) {
    const { rationale, needsAnnotation } = await distillRow(client, row);
    // Only flag feedback rows — non-feedback rows with empty notes are fine (message speaks for itself)
    const shouldFlag = needsAnnotation && row["is_feedback"] === "true";
    if (shouldFlag) {
      flaggedPageIds.push(row["pageId"]);
      row["enriched_rationale"] = ""; // leave blank — needs Eddie's annotation
    } else {
      row["enriched_rationale"] = rationale;
    }
    done++;
    if (done % 10 === 0) console.log(`  ${done}/${toProcess.length}`);
  }

  writeFileSync(CSV_PATH, serializeCSV(headers, rows));
  console.log(`\nDone. enriched_rationale written for ${done - flaggedPageIds.length} rows.`);

  if (flaggedPageIds.length > 0) {
    console.log(`\n⚠️  ${flaggedPageIds.length} feedback rows need Eddie's annotation (correction_notes too sparse to distill):`);
    for (const id of flaggedPageIds) console.log(`  pageId: ${id}`);
    console.log("\nFor each flagged pageId, open the Backfill Review DB in Notion and add a brief Correction Notes entry explaining the category/summary decision, then re-run this script.");
  }
}

main().catch((err) => { console.error("Distillation failed:", err); process.exit(1); });
