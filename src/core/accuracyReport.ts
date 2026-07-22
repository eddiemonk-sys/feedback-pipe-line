import type { FeedbackCategory, ConfidenceLevel } from "./ports.js";
import { CATEGORIES } from "./taxonomy.js";

export type SummaryVerdict = "Confirmed Faithful" | "Confirmed Not Faithful" | null;

/** One Customer Feedback row, reduced to what's needed to compute accuracy stats. */
export interface ReviewedRow {
  /** Human-confirmed categories (may differ from AI suggestion). */
  categories: FeedbackCategory[];
  /** AI's original suggestion — frozen at write time. */
  aiSuggestedCategories: FeedbackCategory[];
  categoryReviewed: boolean;
  summaryVerdict: SummaryVerdict;
  confidence: ConfidenceLevel | null;
}

export interface CategoryConfusion {
  from: FeedbackCategory; // what the AI suggested
  to: FeedbackCategory; // what a human corrected it to
  count: number;
}

export interface ConfidenceCalibration {
  confidence: ConfidenceLevel;
  reviewedCount: number;
  agreementRate: number | null;
}

export interface CategoryCoverage {
  category: FeedbackCategory;
  totalCaptured: number; // every row currently tagged with this category, reviewed or not
  reviewedCount: number; // of those, how many have actually been reviewed
}

export interface CategoryTaxonomyQuality {
  category: FeedbackCategory;
  /** Rows where AI or human (or both) tagged this category, among reviewed rows only. */
  reviewedCount: number;
  /** tp / (tp + fp) — null when AI never predicted this category on reviewed rows. */
  precision: number | null;
  /** tp / (tp + fn) — null when human never tagged this category on reviewed rows. */
  recall: number | null;
  /** AI said yes, human said no. */
  fpCount: number;
  /** Human said yes, AI said no. */
  fnCount: number;
}

export interface AccuracyReport {
  totalRows: number;
  categoryReviewedCount: number;
  categoryAgreementRate: number | null;
  categoryConfusions: CategoryConfusion[]; // sorted most common first
  summaryReviewedCount: number;
  summaryFaithfulRate: number | null;
  confidenceCalibration: ConfidenceCalibration[];
  /** Every taxonomy category, always — including ones with zero captures, so gaps are visible. */
  categoryCoverage: CategoryCoverage[]; // sorted reviewedCount ascending, least-covered first
  /** Per-category precision/recall over reviewed rows — sorted by total errors (fp+fn) descending. */
  taxonomyQuality: CategoryTaxonomyQuality[];
}

function categoriesMatch(a: FeedbackCategory[], b: FeedbackCategory[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((c) => setA.has(c));
}

/**
 * Pure aggregation over reviewed rows — no Notion/network access here, so it's cheap to
 * test exhaustively. The denominator for every rate is "rows actually reviewed," never
 * "all rows ever captured" — an unreviewed row must never silently count as agreement.
 */
export function computeAccuracyReport(rows: ReviewedRow[]): AccuracyReport {
  const categoryReviewed = rows.filter((r) => r.categoryReviewed);
  const categoryAgreements = categoryReviewed.filter((r) => categoriesMatch(r.categories, r.aiSuggestedCategories));

  const confusionCounts = new Map<string, CategoryConfusion>();
  for (const r of categoryReviewed) {
    if (categoriesMatch(r.categories, r.aiSuggestedCategories)) continue;
    const primaryHuman = r.categories[0];
    const primaryAI = r.aiSuggestedCategories[0];
    if (primaryHuman && primaryAI) {
      const key = `${primaryAI} -> ${primaryHuman}`;
      const existing = confusionCounts.get(key);
      if (existing) existing.count += 1;
      else confusionCounts.set(key, { from: primaryAI, to: primaryHuman, count: 1 });
    }
  }
  const categoryConfusions = [...confusionCounts.values()].sort((a, b) => b.count - a.count);

  const summaryReviewed = rows.filter((r) => r.summaryVerdict !== null);
  const summaryFaithful = summaryReviewed.filter((r) => r.summaryVerdict === "Confirmed Faithful");

  const confidenceLevels: ConfidenceLevel[] = ["High", "Medium", "Low"];
  const confidenceCalibration: ConfidenceCalibration[] = confidenceLevels
    .map((level): ConfidenceCalibration | null => {
      const bucket = categoryReviewed.filter((r) => r.confidence === level);
      if (bucket.length === 0) return null;
      const agree = bucket.filter((r) => categoriesMatch(r.categories, r.aiSuggestedCategories));
      return { confidence: level, reviewedCount: bucket.length, agreementRate: agree.length / bucket.length };
    })
    .filter((c): c is ConfidenceCalibration => c !== null);

  const categoryCoverage: CategoryCoverage[] = CATEGORIES.map((category) => {
    const captured = rows.filter((r) => r.categories[0] === category);
    const reviewed = captured.filter((r) => r.categoryReviewed);
    return { category, totalCaptured: captured.length, reviewedCount: reviewed.length };
  }).sort((a, b) => a.reviewedCount - b.reviewedCount);

  const taxonomyQuality: CategoryTaxonomyQuality[] = CATEGORIES.map((category) => {
    let tp = 0, fp = 0, fn = 0;
    for (const r of categoryReviewed) {
      const aiHas = r.aiSuggestedCategories.includes(category);
      const humanHas = r.categories.includes(category);
      if (aiHas && humanHas) tp++;
      else if (aiHas && !humanHas) fp++;
      else if (!aiHas && humanHas) fn++;
    }
    return {
      category,
      reviewedCount: tp + fp + fn,
      precision: (tp + fp) > 0 ? tp / (tp + fp) : null,
      recall: (tp + fn) > 0 ? tp / (tp + fn) : null,
      fpCount: fp,
      fnCount: fn,
    };
  }).sort((a, b) => (b.fpCount + b.fnCount) - (a.fpCount + a.fnCount));

  return {
    totalRows: rows.length,
    categoryReviewedCount: categoryReviewed.length,
    categoryAgreementRate: categoryReviewed.length ? categoryAgreements.length / categoryReviewed.length : null,
    categoryConfusions,
    summaryReviewedCount: summaryReviewed.length,
    summaryFaithfulRate: summaryReviewed.length ? summaryFaithful.length / summaryReviewed.length : null,
    confidenceCalibration,
    categoryCoverage,
    taxonomyQuality,
  };
}
