import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectEnricherCorrections,
  detectSimilarityCorrections,
  toEnricherLogEntry,
  toSimilarityLogEntry,
  renderNewEntries,
  parseLoggedKeys,
  type CorrectionRow,
} from "./correctionLog.js";

function row(over: Partial<CorrectionRow> = {}): CorrectionRow {
  return {
    pageId: "p1",
    message: "some feedback",
    categories: ["Bug / Broken"],
    aiSuggestedCategories: ["Bug / Broken"],
    categoryReviewed: false,
    summary: "a summary",
    aiSuggestedSummary: "a summary",
    summaryVerdict: null,
    relatedVerdict: null,
    relatedMatchedSummary: null,
    relatedRationale: null,
    ...over,
  };
}

test("flags a category correction when a reviewed row's category differs from the AI's", () => {
  const out = detectEnricherCorrections([
    row({
      pageId: "p1",
      categoryReviewed: true,
      aiSuggestedCategories: ["Feature Request"],
      categories: ["Bug / Broken"],
      message: "export is broken",
    }),
  ]);
  const cat = out.filter((c) => c.kind === "category");
  assert.equal(cat.length, 1);
  assert.equal(cat[0].before, "Feature Request");
  assert.equal(cat[0].after, "Bug / Broken");
  assert.equal(cat[0].category, "Bug / Broken"); // grouped under the corrected category
  assert.equal(cat[0].pageId, "p1");
});

test("does not flag a category correction when the reviewed category matches the AI", () => {
  const out = detectEnricherCorrections([
    row({ categoryReviewed: true, aiSuggestedCategories: ["Praise"], categories: ["Praise"] }),
  ]);
  assert.equal(out.filter((c) => c.kind === "category").length, 0);
});

test("ignores a category difference on a row that has not been reviewed", () => {
  const out = detectEnricherCorrections([
    row({ categoryReviewed: false, aiSuggestedCategories: ["Feature Request"], categories: ["Bug / Broken"] }),
  ]);
  assert.equal(out.filter((c) => c.kind === "category").length, 0);
});

test("skips a category correction when the AI's original category is missing (nothing to diff)", () => {
  const out = detectEnricherCorrections([
    row({ categoryReviewed: true, aiSuggestedCategories: [], categories: ["Bug / Broken"] }),
  ]);
  assert.equal(out.filter((c) => c.kind === "category").length, 0);
});

test("flags a summary correction when the verdict is Not Faithful, with a before/after", () => {
  const out = detectEnricherCorrections([
    row({
      pageId: "p2",
      summaryVerdict: "Confirmed Not Faithful",
      aiSuggestedSummary: "User reports export issues",
      summary: "Export button is broken; also wants a date-range filter",
      categories: ["Bug / Broken"],
    }),
  ]);
  const summ = out.filter((c) => c.kind === "summary");
  assert.equal(summ.length, 1);
  assert.equal(summ[0].before, "User reports export issues");
  assert.equal(summ[0].after, "Export button is broken; also wants a date-range filter");
});

test("skips a summary correction when the AI's original summary is missing (nothing to diff)", () => {
  const out = detectEnricherCorrections([
    row({ summaryVerdict: "Confirmed Not Faithful", aiSuggestedSummary: null, summary: "corrected" }),
  ]);
  assert.equal(out.filter((c) => c.kind === "summary").length, 0);
});

test("skips a summary 'correction' when the text is unchanged (Not-Faithful flag without an edit)", () => {
  const out = detectEnricherCorrections([
    row({
      summaryVerdict: "Confirmed Not Faithful",
      aiSuggestedSummary: "User wants X.",
      summary: "  User wants X.  ",
      categories: ["Feature Request"],
    }),
  ]);
  assert.equal(out.filter((c) => c.kind === "summary").length, 0);
});

test("a single row can yield both a category and a summary correction", () => {
  const out = detectEnricherCorrections([
    row({
      categoryReviewed: true,
      aiSuggestedCategories: ["Other"],
      categories: ["Bug / Broken"],
      summaryVerdict: "Confirmed Not Faithful",
      aiSuggestedSummary: "vague",
      summary: "specific",
    }),
  ]);
  assert.equal(out.length, 2);
  assert.ok(out.some((c) => c.kind === "category"));
  assert.ok(out.some((c) => c.kind === "summary"));
});

test("flags a similarity correction when the related-feedback verdict is Confirmed Incorrect", () => {
  const out = detectSimilarityCorrections([
    row({
      pageId: "p9",
      relatedVerdict: "Confirmed Incorrect",
      categories: ["UX / Usability"],
      summary: "search is slow today",
      relatedMatchedSummary: "the search bar freezes when typing fast",
      relatedRationale: "both mention search performance",
    }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].pageId, "p9");
  assert.equal(out[0].newSummary, "search is slow today");
  assert.equal(out[0].matchedSummary, "the search bar freezes when typing fast");
  assert.equal(out[0].rationale, "both mention search performance");
});

test("does not flag similarity corrections for Confirmed Correct or unreviewed links", () => {
  const out = detectSimilarityCorrections([
    row({ relatedVerdict: "Confirmed Correct" }),
    row({ relatedVerdict: null }),
  ]);
  assert.equal(out.length, 0);
});

test("falls back gracefully when the wrong link's summary/rationale weren't recorded", () => {
  const out = detectSimilarityCorrections([
    row({
      relatedVerdict: "Confirmed Incorrect",
      summary: "s",
      categories: ["Other"],
      relatedMatchedSummary: null,
      relatedRationale: null,
    }),
  ]);
  assert.equal(out.length, 1);
  assert.ok(out[0].matchedSummary.length > 0);
  assert.ok(out[0].rationale.length > 0);
});

test("renderNewEntries groups by category, watermarks, and embeds a dedup key", () => {
  const entries = [
    toEnricherLogEntry({
      pageId: "p1",
      kind: "category",
      category: "Bug / Broken",
      message: "export is broken",
      before: "Feature Request",
      after: "Bug / Broken",
    }),
  ];
  const md = renderNewEntries(entries, new Set(), "2026-07-07");
  assert.ok(md.includes("## Bug / Broken"), "groups under the category");
  assert.ok(md.includes("Feature Request") && md.includes("export is broken"), "shows before + message");
  assert.ok(md.includes("_Logged automatically — 2026-07-07_"), "watermarked");
  assert.ok(md.includes("<!-- key:p1:category -->"), "carries a dedup key");
});

test("parseLoggedKeys recovers exactly the keys renderNewEntries wrote (re-runs dedup)", () => {
  const entries = [
    toEnricherLogEntry({ pageId: "p1", kind: "category", category: "Bug / Broken", message: "m", before: "A", after: "B" }),
    toEnricherLogEntry({ pageId: "p1", kind: "summary", category: "Bug / Broken", message: "m", before: "x", after: "y" }),
  ];
  const keys = parseLoggedKeys(renderNewEntries(entries, new Set(), "2026-07-07"));
  assert.deepEqual([...keys].sort(), ["p1:category", "p1:summary"]);
});

test("renderNewEntries skips already-logged keys and returns empty when nothing is new", () => {
  const e = toEnricherLogEntry({ pageId: "p1", kind: "category", category: "Bug / Broken", message: "m", before: "A", after: "B" });
  assert.equal(renderNewEntries([e], new Set(["p1:category"]), "2026-07-07"), "");
});

test("similarity entries get a distinct key and render their own shape", () => {
  const e = toSimilarityLogEntry({
    pageId: "p9",
    category: "UX / Usability",
    newSummary: "search is slow",
    matchedSummary: "search bar freezes",
    rationale: "both about search",
  });
  assert.equal(e.key, "p9:similarity");
  const md = renderNewEntries([e], new Set(), "2026-07-07");
  assert.ok(md.includes("## UX / Usability"));
  assert.ok(md.includes("search is slow") && md.includes("search bar freezes"));
});


