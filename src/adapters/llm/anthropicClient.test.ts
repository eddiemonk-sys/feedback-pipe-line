import { test } from "node:test";
import assert from "node:assert/strict";
import { AnthropicLLMClient } from "./anthropicClient.js";
import type { LLMToolCall, ImageAttachment } from "../../core/ports.js";

test("AnthropicLLMClient implements LLMToolCall", () => {
  const client: LLMToolCall = new AnthropicLLMClient("test-key", "claude-sonnet-4-6");
  assert.ok(typeof client.complete === "function");
});

test("AnthropicLLMClient.complete returns null on missing API key (no real call)", async () => {
  const client = new AnthropicLLMClient("invalid-key-that-will-fail", "claude-sonnet-4-6");
  const result = await client.complete({
    system: "test",
    userMessage: "test",
    tool: { name: "t", description: "d", inputSchema: { type: "object", properties: {}, required: [] } },
    maxTokens: 10,
  });
  // Fails open: returns null instead of throwing
  assert.strictEqual(result, null);
});

test("AnthropicLLMClient.complete accepts images param without throwing (fails open with invalid key)", async () => {
  const client = new AnthropicLLMClient("invalid-key", "claude-sonnet-4-6");
  const image: ImageAttachment = { data: "ZmFrZQ==", mimeType: "image/png" };
  const result = await client.complete({
    system: "test",
    userMessage: "describe this",
    tool: { name: "t", description: "d", inputSchema: { type: "object", properties: {}, required: [] } },
    maxTokens: 10,
    images: [image],
  });
  assert.strictEqual(result, null); // fails open on bad API key
});
