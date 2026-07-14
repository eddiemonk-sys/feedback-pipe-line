import { test } from "node:test";
import assert from "node:assert/strict";
import { FeedbackGate } from "./claudeFeedbackGate.js";
import type { LLMToolCall } from "../../core/ports.js";

function makeMockLLMClient(response: Record<string, unknown> | null): LLMToolCall {
  return { async complete() { return response; } };
}

test("FeedbackGate — implements FeedbackGate port (type-level)", () => {
  const gate = new FeedbackGate(makeMockLLMClient(null));
  assert.ok(typeof gate.classify === "function");
});

test("FeedbackGate — returns null when LLMToolCall returns null", async () => {
  const gate = new FeedbackGate(makeMockLLMClient(null));
  const result = await gate.classify("test message", "#general");
  assert.strictEqual(result, null);
});

test("FeedbackGate — returns FeedbackGateResult on valid tool output", async () => {
  const gate = new FeedbackGate(
    makeMockLLMClient({ is_likely_feedback: true, confidence: "High", rationale: "Clear bug report." }),
  );
  const result = await gate.classify("The export is broken", "#general");
  assert.ok(result !== null);
  assert.strictEqual(result.isLikelyFeedback, true);
  assert.strictEqual(result.confidence, "High");
});

test("FeedbackGate — returns null when confidence is not a valid ConfidenceLevel", async () => {
  const gate = new FeedbackGate(
    makeMockLLMClient({ is_likely_feedback: true, confidence: "Unknown", rationale: "x" }),
  );
  const result = await gate.classify("msg", "#ch");
  assert.strictEqual(result, null);
});
