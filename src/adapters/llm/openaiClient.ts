import OpenAI from "openai";
import type { LLMToolCall, ImageAttachment } from "../../core/ports.js";

export class OpenAILLMClient implements LLMToolCall {
  private client: OpenAI;

  constructor(apiKey: string, private model: string) {
    this.client = new OpenAI({ apiKey });
  }

  async complete(params: {
    system: string;
    userMessage: string;
    tool: { name: string; description: string; inputSchema: Record<string, unknown> };
    temperature?: number;
    maxTokens: number;
    images?: ImageAttachment[];
  }): Promise<Record<string, unknown> | null> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: params.maxTokens,
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        messages: [
          { role: "system", content: params.system },
          { role: "user", content: params.userMessage },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: params.tool.name,
              description: params.tool.description,
              parameters: params.tool.inputSchema,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: params.tool.name } },
      });

      const toolCall = response.choices[0]?.message?.tool_calls?.[0];
      if (!toolCall || toolCall.type !== "function") return null;
      return JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
