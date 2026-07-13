import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAccuracyReport, type ReviewedRow } from "./accuracyReport.js";

function row(overrides: Partial<ReviewedRow> = {}): ReviewedRow {
  return {
    category: "Feature Request",
    aiSuggestedCategory: "Feature Request",
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
    row({ categoryReviewed: false, category: "Bug / Broken", aiSuggestedCategory: "Praise" }),
  ]);
  assert.equal(report.categoryReviewedCount, 0);
  assert.equal(report.categoryAgreementRate, null);
});

test("computes 100% agreement when every reviewed category matches", () => {
  const report = computeAccuracyReport([
    row({ categoryReviewed: true, category: "Feature Request", aiSuggestedCategory: "Feature Request" }),
    row({ categoryReviewed: true, category: "Praise", aiSuggestedCategory: "Praise" }),
  ]);
  assert.equal(report.categoryReviewedCount, 2);
  assert.equal(report.categoryAgreementRate, 1);
  assert.deepEqual(report.categoryConfusions, []);
});

test("computes a partial agreement rate and lists confusions, most common first", () => {
  const report = computeAccuracyReport([
    row({ categoryReviewed: true, category: "Candidate Experience", aiSuggestedCategory: "UX / Usability" }),
    row({ categoryReviewed: true, category: "Candidate Experience", aiSuggestedCategory: "UX / Usability" }),
    row({ categoryReviewed: true, category: "Bug / Broken", aiSuggestedCategory: "Other" }),
    row({ categoryReviewed: true, category: "Praise", aiSuggestedCategory: "Praise" }), // agrees
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
    row({ categoryReviewed: true, confidence: "High", category: "Praise", aiSuggestedCategory: "Praise" }),
    row({ categoryReviewed: true, confidence: "High", category: "Praise", aiSuggestedCategory: "Praise" }),
    row({ categoryReviewed: true, confidence: "Low", category: "Bug / Broken", aiSuggestedCategory: "Other" }),
    row({ categoryReviewed: false, confidence: "High", category: "Other", aiSuggestedCategory: "Bug / Broken" }), // excluded, not reviewed
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
    row({ category: "Feature Request", categoryReviewed: true }),
    row({ category: "Feature Request", categoryReviewed: false }),
    row({ category: "Praise", categoryReviewed: true }),
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
    row({ category: "Feature Request", categoryReviewed: true }),
    row({ category: "Feature Request", categoryReviewed: true }),
    row({ category: "Praise", categoryReviewed: true }),
  ]);
  const reviewedCounts = report.categoryCoverage.map((c) => c.reviewedCount);
  assert.deepEqual(reviewedCounts, [...reviewedCounts].sort((a, b) => a - b));
  assert.equal(report.categoryCoverage[report.categoryCoverage.length - 1].category, "Feature Request");
});
