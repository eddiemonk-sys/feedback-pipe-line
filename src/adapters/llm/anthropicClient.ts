import Anthropic from "@anthropic-ai/sdk";
import type { LLMToolCall, ImageAttachment } from "../../core/ports.js";

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
    images?: ImageAttachment[];
  }): Promise<Record<string, unknown> | null> {
    try {
      // When images are present, build a multi-part content array (images first, then text).
      // Anthropic performs best with image-before-text ordering in the content array.
      const userContent: Anthropic.MessageParam["content"] = params.images?.length
        ? [
            ...params.images.map(
              (img): Anthropic.ImageBlockParam => ({
                type: "image",
                source: {
                  type: "base64",
                  media_type: img.mimeType as Anthropic.Base64ImageSource["media_type"],
                  data: img.data,
                },
              }),
            ),
            { type: "text", text: params.userMessage },
          ]
        : params.userMessage;

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: params.maxTokens,
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        system: params.system,
        messages: [{ role: "user", content: userContent }],
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
