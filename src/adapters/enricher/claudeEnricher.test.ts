import { test } from "node:test";
import assert from "node:assert/strict";
import { Enricher } from "./claudeEnricher.js";
import { CATEGORIES } from "../../core/taxonomy.js";
import type { FeedbackCategory, LLMToolCall, ImageAttachment } from "../../core/ports.js";

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

test("Enricher — returns array with one result on valid tool output (non-split)", async () => {
  const enricher = new Enricher(
    makeMockLLMClient({
      results: [{
        reasoning: "Clear feature request signal.",
        summary: "User wants SSO integration.",
        categories: ["Feature Request"],
      }],
    }),
  );
  const result = await enricher.enrich("Please add SSO support", "#general");
  assert.ok(Array.isArray(result));
  assert.strictEqual(result!.length, 1);
  assert.strictEqual(result![0].summary, "User wants SSO integration.");
  assert.deepStrictEqual(result![0].categories, ["Feature Request"]);
});

test("Enricher — returns multiple results on batch split", async () => {
  const enricher = new Enricher(
    makeMockLLMClient({
      results: [
        {
          reasoning: "First distinct item.",
          summary: "Bug with export.",
          categories: ["Bug / Broken"],
          preambleContext: "Notes from DTG call:",
          clientName: "DTG",
        },
        {
          reasoning: "Second distinct item.",
          summary: "Feature request for SSO.",
          categories: ["Feature Request"],
          preambleContext: "Notes from DTG call:",
          clientName: "DTG",
        },
      ],
    }),
  );
  const result = await enricher.enrich("Notes from DTG call:\n• Bug...\n• SSO...", "#general");
  assert.ok(Array.isArray(result));
  assert.strictEqual(result!.length, 2);
  assert.strictEqual(result![0].clientName, "DTG");
  assert.strictEqual(result![1].clientName, "DTG");
});

test("Enricher — returns null when categories are invalid", async () => {
  const enricher = new Enricher(
    makeMockLLMClient({
      results: [{ reasoning: "...", summary: "Test.", categories: ["NotARealCategory"] }],
    }),
  );
  const result = await enricher.enrich("test", "#general");
  assert.strictEqual(result, null);
});

test("Enricher — returns null when results array is missing or empty", async () => {
  const enricher = new Enricher(makeMockLLMClient({ results: [] }));
  const result = await enricher.enrich("test", "#general");
  assert.strictEqual(result, null);
});

test("CATEGORIES includes all 11 taxonomy entries", () => {
  assert.ok(CATEGORIES.includes("Compliance / Legal / Governance" as FeedbackCategory));
  assert.ok(CATEGORIES.includes("Candidate Experience" as FeedbackCategory));
  assert.strictEqual(CATEGORIES.length, 11);
});

test("Enricher — passes images to LLMToolCall when provided", async () => {
  const capturedParams: any[] = [];
  const client: LLMToolCall = {
    async complete(params) {
      capturedParams.push(params);
      return {
        results: [{
          reasoning: "Feature request signal.",
          summary: "User wants SSO integration.",
          categories: ["Feature Request"],
        }],
      };
    },
  };
  const enricher = new Enricher(client);
  const image: ImageAttachment = { data: "ZmFrZQ==", mimeType: "image/png" };
  await enricher.enrich("Please add SSO", "#general", [image]);
  assert.strictEqual(capturedParams.length, 1);
  assert.deepStrictEqual(capturedParams[0].images, [image]);
});

test("Enricher — omits images from LLMToolCall when not provided", async () => {
  const capturedParams: any[] = [];
  const client: LLMToolCall = {
    async complete(params) {
      capturedParams.push(params);
      return {
        results: [{
          reasoning: "Feature request signal.",
          summary: "User wants SSO integration.",
          categories: ["Feature Request"],
        }],
      };
    },
  };
  const enricher = new Enricher(client);
  await enricher.enrich("Please add SSO", "#general");
  assert.strictEqual(capturedParams[0].images, undefined);
});
