import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAILLMClient } from "./openaiClient.js";
import type { LLMToolCall } from "../../core/ports.js";

test("OpenAILLMClient implements LLMToolCall", () => {
  const client: LLMToolCall = new OpenAILLMClient("test-key", "gpt-4o");
  assert.ok(typeof client.complete === "function");
});

test("OpenAILLMClient.complete returns null on invalid key (fail-open)", async () => {
  const client = new OpenAILLMClient("sk-invalid-test-key", "gpt-4o");
  const result = await client.complete({
    system: "test",
    userMessage: "test",
    tool: { name: "t", description: "d", inputSchema: { type: "object", properties: {}, required: [] } },
    maxTokens: 10,
  });
  assert.strictEqual(result, null);
});
