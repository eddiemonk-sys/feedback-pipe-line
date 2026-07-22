import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAccuracyReport, type ReviewedRow } from "./accuracyReport.js";

function row(overrides: Partial<ReviewedRow> = {}): ReviewedRow {
  return {
    categories: ["Feature Request"],
    aiSuggestedCategories: ["Feature Request"],
    categoryReviewed: false,
    summaryVerdict: null,
    confidence: null,
    ...overrides,
  };
}

test("returns null rates and zero counts on no rows", () => {
  const report = computeAccuracyReport([]);
  assert.equal(report.totalRows, 0);
  assert.equal(report.categoryReviewedCount, 0);
  assert.equal(report.categoryAgreementRate, null);
  assert.deepEqual(report.categoryConfusions, []);
  assert.equal(report.summaryReviewedCount, 0);
  assert.equal(report.summaryFaithfulRate, null);
  assert.deepEqual(report.confidenceCalibration, []);
});

test("ignores rows where categoryReviewed is false for category stats", () => {
  const report = computeAccuracyReport([
    row({ categoryReviewed: false, categories: ["Bug / Broken"], aiSuggestedCategories: ["Praise"] }),
  ]);
  assert.equal(report.categoryReviewedCount, 0);
  assert.equal(report.categoryAgreementRate, null);
});

test("computes 100% agreement when every reviewed category matches", () => {
  const report = computeAccuracyReport([
    row({ categoryReviewed: true, categories: ["Feature Request"], aiSuggestedCategories: ["Feature Request"] }),
    row({ categoryReviewed: true, categories: ["Praise"], aiSuggestedCategories: ["Praise"] }),
  ]);
  assert.equal(report.categoryReviewedCount, 2);
  assert.equal(report.categoryAgreementRate, 1);
  assert.deepEqual(report.categoryConfusions, []);
});

test("computes a partial agreement rate and lists confusions, most common first", () => {
  const report = computeAccuracyReport([
    row({ categoryReviewed: true, categories: ["Candidate Experience"], aiSuggestedCategories: ["UX / Usability"] }),
    row({ categoryReviewed: true, categories: ["Candidate Experience"], aiSuggestedCategories: ["UX / Usability"] }),
    row({ categoryReviewed: true, categories: ["Bug / Broken"], aiSuggestedCategories: ["Other"] }),
    row({ categoryReviewed: true, categories: ["Praise"], aiSuggestedCategories: ["Praise"] }), // agrees
  ]);
  assert.equal(report.categoryReviewedCount, 4);
  assert.equal(report.categoryAgreementRate, 0.25);
  assert.deepEqual(report.categoryConfusions, [
    { from: "UX / Usability", to: "Candidate Experience", count: 2 },
    { from: "Other", to: "Bug / Broken", count: 1 },
  ]);
});

test("computes summary faithfulness rate independently of category review status", () => {
  const report = computeAccuracyReport([
    row({ summaryVerdict: "Confirmed Faithful", categoryReviewed: false }),
    row({ summaryVerdict: "Confirmed Faithful", categoryReviewed: false }),
    row({ summaryVerdict: "Confirmed Not Faithful", categoryReviewed: false }),
    row({ summaryVerdict: null }), // not reviewed, excluded
  ]);
  assert.equal(report.summaryReviewedCount, 3);
  assert.equal(report.summaryFaithfulRate, 2 / 3);
});

test("breaks confidence calibration down per confidence level, reviewed rows only", () => {
  const report = computeAccuracyReport([
    row({ categoryReviewed: true, confidence: "High", categories: ["Praise"], aiSuggestedCategories: ["Praise"] }),
    row({ categoryReviewed: true, confidence: "High", categories: ["Praise"], aiSuggestedCategories: ["Praise"] }),
    row({ categoryReviewed: true, confidence: "Low", categories: ["Bug / Broken"], aiSuggestedCategories: ["Other"] }),
    row({ categoryReviewed: false, confidence: "High", categories: ["Other"], aiSuggestedCategories: ["Bug / Broken"] }), // excluded, not reviewed
  ]);
  const high = report.confidenceCalibration.find((c) => c.confidence === "High");
  const low = report.confidenceCalibration.find((c) => c.confidence === "Low");
  assert.equal(high?.reviewedCount, 2);
  assert.equal(high?.agreementRate, 1);
  assert.equal(low?.reviewedCount, 1);
  assert.equal(low?.agreementRate, 0);
});

test("lists every category's coverage, including ones with zero captures", () => {
  const report = computeAccuracyReport([
    row({ categories: ["Feature Request"], categoryReviewed: true }),
    row({ categories: ["Feature Request"], categoryReviewed: false }),
    row({ categories: ["Praise"], categoryReviewed: true }),
  ]);
  assert.equal(report.categoryCoverage.length, 11); // every category in the taxonomy, always
  const featureRequest = report.categoryCoverage.find((c) => c.category === "Feature Request");
  const praise = report.categoryCoverage.find((c) => c.category === "Praise");
  const neverSeen = report.categoryCoverage.find((c) => c.category === "Assessment Accuracy/Validity");
  assert.deepEqual(featureRequest, { category: "Feature Request", totalCaptured: 2, reviewedCount: 1 });
  assert.deepEqual(praise, { category: "Praise", totalCaptured: 1, reviewedCount: 1 });
  assert.deepEqual(neverSeen, { category: "Assessment Accuracy/Validity", totalCaptured: 0, reviewedCount: 0 });
});

test("sorts category coverage by reviewedCount ascending, so the least-reviewed categories surface first", () => {
  const report = computeAccuracyReport([
    row({ categories: ["Feature Request"], categoryReviewed: true }),
    row({ categories: ["Feature Request"], categoryReviewed: true }),
    row({ categories: ["Praise"], categoryReviewed: true }),
  ]);
  const reviewedCounts = report.categoryCoverage.map((c) => c.reviewedCount);
  assert.deepEqual(reviewedCounts, [...reviewedCounts].sort((a, b) => a - b));
  assert.equal(report.categoryCoverage[report.categoryCoverage.length - 1].category, "Feature Request");
});

// ─── taxonomyQuality tests ────────────────────────────────────────────────────

test("taxonomyQuality: perfect agreement yields precision=1, recall=1, no FP/FN", () => {
  const report = computeAccuracyReport([
    row({ categoryReviewed: true, categories: ["Feature Request"], aiSuggestedCategories: ["Feature Request"] }),
    row({ categoryReviewed: true, categories: ["Feature Request"], aiSuggestedCategories: ["Feature Request"] }),
  ]);
  const fr = report.taxonomyQuality.find((q) => q.category === "Feature Request");
  assert.equal(fr?.precision, 1);
  assert.equal(fr?.recall, 1);
  assert.equal(fr?.fpCount, 0);
  assert.equal(fr?.fnCount, 0);
  assert.equal(fr?.reviewedCount, 2);
});

test("taxonomyQuality: AI over-tags a category (false positive)", () => {
  // AI says Bug / Broken, human says Feature Request — FP for Bug / Broken, FN for Feature Request
  const report = computeAccuracyReport([
    row({ categoryReviewed: true, categories: ["Feature Request"], aiSuggestedCategories: ["Bug / Broken"] }),
  ]);
  const bug = report.taxonomyQuality.find((q) => q.category === "Bug / Broken");
  const fr = report.taxonomyQuality.find((q) => q.category === "Feature Request");
  assert.equal(bug?.fpCount, 1);
  assert.equal(bug?.fnCount, 0);
  assert.equal(bug?.precision, 0); // tp=0, tp+fp=1 → 0%
  assert.equal(bug?.recall, null); // human never tagged Bug / Broken
  assert.equal(fr?.fnCount, 1);
  assert.equal(fr?.fpCount, 0);
  assert.equal(fr?.recall, 0); // tp=0, tp+fn=1 → 0%
  assert.equal(fr?.precision, null); // AI never predicted Feature Request
});

test("taxonomyQuality: sorted by total errors descending", () => {
  // 2 errors for Bug / Broken (2 FPs), 1 error for Praise (1 FN)
  const report = computeAccuracyReport([
    row({ categoryReviewed: true, categories: ["Feature Request"], aiSuggestedCategories: ["Bug / Broken"] }),
    row({ categoryReviewed: true, categories: ["Feature Request"], aiSuggestedCategories: ["Bug / Broken"] }),
    row({ categoryReviewed: true, categories: ["Praise"], aiSuggestedCategories: ["Feature Request"] }),
  ]);
  const errorCounts = report.taxonomyQuality
    .filter((q) => q.fpCount + q.fnCount > 0)
    .map((q) => q.fpCount + q.fnCount);
  assert.deepEqual(errorCounts, [...errorCounts].sort((a, b) => b - a));
});

test("taxonomyQuality: unreviewed rows do not count", () => {
  const report = computeAccuracyReport([
    row({ categoryReviewed: false, categories: ["Bug / Broken"], aiSuggestedCategories: ["Praise"] }),
  ]);
  const bug = report.taxonomyQuality.find((q) => q.category === "Bug / Broken");
  assert.equal(bug?.reviewedCount, 0);
  assert.equal(bug?.fpCount, 0);
  assert.equal(bug?.fnCount, 0);
});
