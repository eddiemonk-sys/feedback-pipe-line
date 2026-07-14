import { test } from "node:test";
import assert from "node:assert/strict";
import { Enricher } from "./claudeEnricher.js";
import { CATEGORIES } from "../../core/taxonomy.js";
import type { FeedbackCategory, LLMToolCall } from "../../core/ports.js";

function makeMockLLMClient(response: Record<string, unknown> | null): LLMToolCall {
  return {
    async complete() {
      return response;
    },
  };
}

test("Enricher — implements Enricher port (type-level)", () => {
  const client = makeMockLLMClient(null);
  const enricher = new Enricher(client);
  assert.ok(typeof enricher.enrich === "function");
});

test("Enricher — returns null when LLMToolCall returns null", async () => {
  const enricher = new Enricher(makeMockLLMClient(null));
  const result = await enricher.enrich("test message", "#general");
  assert.strictEqual(result, null);
});

test("Enricher — returns EnrichmentResult on valid tool output", async () => {
  const enricher = new Enricher(
    makeMockLLMClient({
      reasoning: "Clear feature request signal.",
      summary: "User wants SSO integration.",
      categories: ["Feature Request"],
    }),
  );
  const result = await enricher.enrich("Please add SSO support", "#general");
  assert.ok(result !== null);
  assert.strictEqual(result.summary, "User wants SSO integration.");
  assert.deepStrictEqual(result.categories, ["Feature Request"]);
});

test("Enricher — returns null when categories are invalid", async () => {
  const enricher = new Enricher(
    makeMockLLMClient({
      reasoning: "...",
      summary: "Test.",
      categories: ["NotARealCategory"],
    }),
  );
  const result = await enricher.enrich("test", "#general");
  assert.strictEqual(result, null);
});

test("CATEGORIES includes all 11 taxonomy entries", () => {
  assert.ok(CATEGORIES.includes("Compliance / Legal / Governance" as FeedbackCategory));
  assert.ok(CATEGORIES.includes("Candidate Experience" as FeedbackCategory));
  assert.strictEqual(CATEGORIES.length, 11);
});
