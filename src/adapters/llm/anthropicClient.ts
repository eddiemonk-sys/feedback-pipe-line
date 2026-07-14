import Anthropic from "@anthropic-ai/sdk";
import type { LLMToolCall } from "../../core/ports.js";

export class AnthropicLLMClient implements LLMToolCall {
  private client: Anthropic;

  constructor(apiKey: string, private model: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(params: {
    system: string;
    userMessage: string;
    tool: { name: string; description: string; inputSchema: Record<string, unknown> };
    temperature?: number;
    maxTokens: number;
  }): Promise<Record<string, unknown> | null> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: params.maxTokens,
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        system: params.system,
        messages: [{ role: "user", content: params.userMessage }],
        tools: [
          {
            name: params.tool.name,
            description: params.tool.description,
            input_schema: params.tool.inputSchema as Anthropic.Tool["input_schema"],
          },
        ],
        tool_choice: { type: "tool", name: params.tool.name },
      });

      const toolUse = response.content.find((b) => b.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") return null;
      return toolUse.input as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
