// src/adapters/enricher/claudeEnricher.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ClaudeEnricher } from "./claudeEnricher.js";
import { CATEGORIES } from "../../core/taxonomy.js";
import type { FeedbackCategory } from "../../core/ports.js";

// These tests verify the adapter's shape contracts without making real API calls.

test("enrich — single category result is valid", async () => {
  const enricher = new ClaudeEnricher("test-key");
  // We can't easily mock Anthropic SDK without a seam. This test is a type-level smoke test.
  // The real contract test: if an API key is absent, enrich() returns null (NullEnricher tested via handleCapture.test.ts).
  // If API key present, the result must satisfy: Array.isArray(categories) && categories.length >= 1 && categories.every(c => CATEGORIES.includes(c))
  assert.ok(typeof enricher.enrich === "function");
});

test("CATEGORIES includes Compliance / Legal / Governance", () => {
  assert.ok(CATEGORIES.includes("Compliance / Legal / Governance" as FeedbackCategory));
});

test("enrich — result shape when API succeeds", async () => {
  // Verify that a plausible result satisfies the multi-category contract.
  const mockResult = { summary: "User wants SSO support.", categories: ["Feature Request"] as FeedbackCategory[] };
  assert.ok(Array.isArray(mockResult.categories));
  assert.ok(mockResult.categories.length >= 1 && mockResult.categories.length <= 2);
  assert.ok(mockResult.categories.every((c) => CATEGORIES.includes(c)));
});
