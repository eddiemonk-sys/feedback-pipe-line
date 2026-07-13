import type { FeedbackCategory } from "./ports.js";
import type { SummaryVerdict } from "./accuracyReport.js";

export type RelatedVerdict = "Confirmed Correct" | "Confirmed Incorrect" | null;

/** One Customer Feedback row, reduced to what correction detection needs. */
export interface CorrectionRow {
  pageId: string;
  message: string;
  categories: FeedbackCategory[] | null;
  aiSuggestedCategories: FeedbackCategory[] | null;
  categoryReviewed: boolean;
  summary: string | null;
  aiSuggestedSummary: string | null;
  summaryVerdict: SummaryVerdict;
  relatedVerdict: RelatedVerdict;
  relatedMatchedSummary: string | null; // summary of the row the AI wrongly linked to
  relatedRationale: string | null; // the AI's (wrong) reason for linking
}

/** A human correction of the enricher's output, worth distilling into a rule. */
export interface EnricherCorrection {
  pageId: string;
  kind: "category" | "summary";
  /** Feedback category to group the entry under (the human-confirmed one). */
  category: FeedbackCategory;
  message: string;
  before: string; // what the AI originally produced
  after: string; // what the human corrected it to
}

/**
 * Finds enricher corrections in reviewed rows:
 *  - a **category** mismatch — a reviewed row whose category differs from the AI's frozen original;
 *  - a **summary** mismatch — verdict "Confirmed Not Faithful".
 *
 * Both require the AI's frozen original (aiSuggestedCategory / aiSuggestedSummary) to be present —
 * without it there is nothing to diff, so the row is skipped, exactly as the accuracy report skips
 * rows missing aiSuggestedCategory. A single row can produce both kinds (different lessons).
 */
export function detectEnricherCorrections(rows: CorrectionRow[]): EnricherCorrection[] {
  const out: EnricherCorrection[] = [];
  for (const r of rows) {
    // Category correction: primary category changed
    const primaryHuman = r.categories?.[0];
    const primaryAI = r.aiSuggestedCategories?.[0];
    if (r.categoryReviewed && primaryAI && primaryHuman && primaryHuman !== primaryAI) {
      out.push({
        pageId: r.pageId,
        kind: "category",
        category: primaryHuman,
        message: r.message,
        before: primaryAI,
        after: primaryHuman,
      });
    }
    if (
      r.summaryVerdict === "Confirmed Not Faithful" &&
      r.aiSuggestedSummary &&
      r.summary &&
      primaryHuman &&
      r.summary.trim() !== r.aiSuggestedSummary.trim() // a Not-Faithful flag with no actual edit isn't a correction
    ) {
      out.push({
        pageId: r.pageId,
        kind: "summary",
        category: primaryHuman,
        message: r.message,
        before: r.aiSuggestedSummary,
        after: r.summary,
      });
    }
  }
  return out;
}

/** A human-rejected AI link (false positive), worth distilling into a "don't link these" rule. */
export interface SimilarityCorrection {
  pageId: string;
  category: FeedbackCategory;
  newSummary: string; // this row's summary — the new capture that got wrongly linked
  matchedSummary: string; // the summary of the row it was wrongly linked to
  rationale: string; // the AI's (wrong) reason for linking them
}

/**
 * Finds similarity corrections: rows a human marked `Related Feedback Verdict = Confirmed
 * Incorrect` (a false-positive link). This is the only similarity signal the loop learns from —
 * missed links (false negatives) are a deliberately deferred gap (RELATED-FEEDBACK-DESIGN.md §8),
 * since nothing records whether a link was AI-made or human-added.
 */
export function detectSimilarityCorrections(rows: CorrectionRow[]): SimilarityCorrection[] {
  const out: SimilarityCorrection[] = [];
  for (const r of rows) {
    const primaryHuman = r.categories?.[0];
    if (r.relatedVerdict === "Confirmed Incorrect" && r.summary && primaryHuman) {
      out.push({
        pageId: r.pageId,
        category: primaryHuman,
        newSummary: r.summary,
        matchedSummary: r.relatedMatchedSummary ?? "(linked row's summary unavailable)",
        rationale: r.relatedRationale ?? "(no rationale recorded)",
      });
    }
  }
  return out;
}

/** A single log entry: a stable dedup key, the category to group under, and the markdown body. */
export interface LogEntry {
  key: string;
  category: string;
  body: string;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Maps an enricher correction to a log entry. Key is `${pageId}:${kind}` so one row can log both. */
export function toEnricherLogEntry(c: EnricherCorrection): LogEntry {
  const body =
    c.kind === "category"
      ? `### Category correction\n- **Message:** ${oneLine(c.message)}\n- **AI suggested:** ${c.before}\n- **Corrected to:** ${c.after}`
      : `### Summary correction\n- **Message:** ${oneLine(c.message)}\n- **AI summary:** ${oneLine(c.before)}\n- **Corrected summary:** ${oneLine(c.after)}`;
  return { key: `${c.pageId}:${c.kind}`, category: c.category, body };
}

/** Maps a similarity correction (a human-rejected AI link) to a log entry. */
export function toSimilarityLogEntry(c: SimilarityCorrection): LogEntry {
  const body = `### Wrong link\n- **New feedback:** ${oneLine(c.newSummary)}\n- **Wrongly linked to:** ${oneLine(c.matchedSummary)}\n- **AI's rationale:** ${oneLine(c.rationale)}`;
  return { key: `${c.pageId}:similarity`, category: c.category, body };
}

/** Extracts the dedup keys already present in an existing log's `<!-- key:... -->` markers. */
export function parseLoggedKeys(content: string): Set<string> {
  const keys = new Set<string>();
  const re = /<!--\s*key:(\S+)\s*-->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) keys.add(m[1]);
  return keys;
}

/**
 * Renders new log entries (those whose key isn't already logged) as a markdown block, grouped
 * under `## <category>` headings, each watermarked and carrying its dedup key. Returns "" when
 * nothing is new — so the script only touches the file when there is something to add, and
 * hand-edited entries are never rewritten (append-only; the per-category cap from the PRD is a
 * deliberate later add, not silent truncation — nothing is dropped).
 */
export function renderNewEntries(entries: LogEntry[], alreadyLogged: Set<string>, dateIso: string): string {
  const fresh = entries.filter((e) => !alreadyLogged.has(e.key));
  if (fresh.length === 0) return "";

  const byCategory = new Map<string, LogEntry[]>();
  for (const e of fresh) {
    const list = byCategory.get(e.category) ?? [];
    list.push(e);
    byCategory.set(e.category, list);
  }

  let out = "";
  for (const [category, list] of byCategory) {
    out += `\n## ${category}\n`;
    for (const e of list) {
      out += `\n${e.body}\n<!-- key:${e.key} -->\n_Logged automatically — ${dateIso}_\n`;
    }
  }
  return out;
}
