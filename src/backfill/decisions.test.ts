// src/backfill/decisions.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { toCaptureRequest, correctionFor, type ReviewDecision } from "./decisions.js";

const confirmed: ReviewDecision = {
  channelId: "C0BDD5KE91V",
  messageTs: "1712000000.000100",
  isFeedback: true,
  classificationOk: true,
};

test("builds a mega_reaction CaptureRequest attributed to the given user", () => {
  const req = toCaptureRequest(confirmed, "Ueddie");
  assert.equal(req.triggerType, "mega_reaction");
  assert.equal(req.channelId, "C0BDD5KE91V");
  assert.equal(req.messageTs, "1712000000.000100");
  assert.equal(req.triggeredBy, "Ueddie");
});

test("no correction when classification was marked OK", () => {
  assert.equal(correctionFor(confirmed), null);
});

test("correction carries the corrected category when set", () => {
  const d: ReviewDecision = { ...confirmed, classificationOk: false, correctedCategory: "Pricing / Commercial" };
  assert.deepEqual(correctionFor(d), { category: "Pricing / Commercial" });
});

test("correction carries the corrected summary when set", () => {
  const d: ReviewDecision = { ...confirmed, classificationOk: false, correctedSummary: "Customer wants annual billing." };
  assert.deepEqual(correctionFor(d), { summary: "Customer wants annual billing." });
});

test("correction carries both fields when both set", () => {
  const d: ReviewDecision = {
    ...confirmed, classificationOk: false,
    correctedCategory: "Feature Request", correctedSummary: "Wants SSO.",
  };
  assert.deepEqual(correctionFor(d), { category: "Feature Request", summary: "Wants SSO." });
});

test("classification not OK but no corrections provided => null (nothing to patch)", () => {
  const d: ReviewDecision = { ...confirmed, classificationOk: false };
  assert.equal(correctionFor(d), null);
});
