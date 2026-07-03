import type { FeedbackCategory, ConfidenceLevel } from "./ports.js";
import { CATEGORIES } from "./taxonomy.js";

export type SummaryVerdict = "Confirmed Faithful" | "Confirmed Not Faithful" | null;

/** One Customer Feedback row, reduced to what's needed to compute accuracy stats. */
export interface ReviewedRow {
  category: FeedbackCategory;
  aiSuggestedCategory: FeedbackCategory;
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
}

/**
 * Pure aggregation over reviewed rows — no Notion/network access here, so it's cheap to
 * test exhaustively. The denominator for every rate is "rows actually reviewed," never
 * "all rows ever captured" — an unreviewed row must never silently count as agreement.
 */
export function computeAccuracyReport(rows: ReviewedRow[]): AccuracyReport {
  const categoryReviewed = rows.filter((r) => r.categoryReviewed);
  const categoryAgreements = categoryReviewed.filter((r) => r.category === r.aiSuggestedCategory);

  const confusionCounts = new Map<string, CategoryConfusion>();
  for (const r of categoryReviewed) {
    if (r.category === r.aiSuggestedCategory) continue;
    const key = `${r.aiSuggestedCategory} -> ${r.category}`;
    const existing = confusionCounts.get(key);
    if (existing) existing.count += 1;
    else confusionCounts.set(key, { from: r.aiSuggestedCategory, to: r.category, count: 1 });
  }
  const categoryConfusions = [...confusionCounts.values()].sort((a, b) => b.count - a.count);

  const summaryReviewed = rows.filter((r) => r.summaryVerdict !== null);
  const summaryFaithful = summaryReviewed.filter((r) => r.summaryVerdict === "Confirmed Faithful");

  const confidenceLevels: ConfidenceLevel[] = ["High", "Medium", "Low"];
  const confidenceCalibration: ConfidenceCalibration[] = confidenceLevels
    .map((level): ConfidenceCalibration | null => {
      const bucket = categoryReviewed.filter((r) => r.confidence === level);
      if (bucket.length === 0) return null;
      const agree = bucket.filter((r) => r.category === r.aiSuggestedCategory);
      return { confidence: level, reviewedCount: bucket.length, agreementRate: agree.length / bucket.length };
    })
    .filter((c): c is ConfidenceCalibration => c !== null);

  const categoryCoverage: CategoryCoverage[] = CATEGORIES.map((category) => {
    const captured = rows.filter((r) => r.category === category);
    const reviewed = captured.filter((r) => r.categoryReviewed);
    return { category, totalCaptured: captured.length, reviewedCount: reviewed.length };
  }).sort((a, b) => a.reviewedCount - b.reviewedCount);

  return {
    totalRows: rows.length,
    categoryReviewedCount: categoryReviewed.length,
    categoryAgreementRate: categoryReviewed.length ? categoryAgreements.length / categoryReviewed.length : null,
    categoryConfusions,
    summaryReviewedCount: summaryReviewed.length,
    summaryFaithfulRate: summaryReviewed.length ? summaryFaithful.length / summaryReviewed.length : null,
    confidenceCalibration,
    categoryCoverage,
  };
}
