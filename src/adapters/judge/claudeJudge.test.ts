import { test } from "node:test";
import assert from "node:assert/strict";
import { Judge } from "./claudeJudge.js";
import type { LLMToolCall, FeedbackCategory } from "../../core/ports.js";

function makeMockLLMClient(response: Record<string, unknown> | null): LLMToolCall {
  return { async complete() { return response; } };
}

test("Judge — implements Judge port (type-level)", () => {
  const judge = new Judge(makeMockLLMClient(null));
  assert.ok(typeof judge.review === "function");
});

test("Judge — returns null when LLMToolCall returns null", async () => {
  const judge = new Judge(makeMockLLMClient(null));
  const result = await judge.review("test message", "#general", "test summary", ["Feature Request"]);
  assert.strictEqual(result, null);
});

test("Judge — returns JudgeVerdict with confidence + rationale", async () => {
  const judge = new Judge(
    makeMockLLMClient({
      reasoning: "Category matches — message asks for new functionality.",
      confidence: "High",
      rationale: "Category and summary both match the source message.",
    }),
  );
  const result = await judge.review(
    "Can we add SSO?",
    "#general",
    "User requests SSO support.",
    ["Feature Request" as FeedbackCategory],
  );
  assert.ok(result !== null);
  assert.strictEqual(result.confidence, "High");
  assert.strictEqual(result.rationale, "Category and summary both match the source message.");
});

test("Judge — reasoning field is consumed internally (not returned in JudgeVerdict)", async () => {
  const judge = new Judge(
    makeMockLLMClient({
      reasoning: "Internal chain-of-thought here.",
      confidence: "Medium",
      rationale: "One signal is questionable.",
    }),
  );
  const result = await judge.review("msg", "#ch", "summary", ["Bug / Broken" as FeedbackCategory]);
  assert.ok(result !== null);
  assert.ok(!("reasoning" in result), "JudgeVerdict must not expose the reasoning field");
});

test("Judge — returns null when confidence is not a valid ConfidenceLevel", async () => {
  const judge = new Judge(makeMockLLMClient({ reasoning: "...", confidence: "Unknown", rationale: "x" }));
  const result = await judge.review("msg", "#ch", "summary", ["Feature Request" as FeedbackCategory]);
  assert.strictEqual(result, null);
});
