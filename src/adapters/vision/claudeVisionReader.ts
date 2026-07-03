import Anthropic from "@anthropic-ai/sdk";
import type { VisionReader, VisionResult, ImageAttachment } from "../../core/ports.js";

const SYSTEM_PROMPT = `You describe screenshots attached to customer feedback for a B2B SaaS company providing HR / talent-assessment software. Describe what's shown factually and concisely in 1-2 sentences — error messages, UI state, anything that looks broken or notable. Do not speculate beyond what's visible in the image.`;

/**
 * Vision reader using Claude's image understanding. Image content comes before the text
 * instruction in the message (Claude performs best with image-then-text ordering).
 */
export class ClaudeVisionReader implements VisionReader {
  private client: Anthropic;

  constructor(apiKey: string, private model = "claude-haiku-4-5-20251001") {
    this.client = new Anthropic({ apiKey });
  }

  async describe(image: ImageAttachment, channelName: string): Promise<VisionResult | null> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: image.mimeType as any, data: image.data },
              },
              { type: "text", text: `Channel: ${channelName}\nDescribe this screenshot.` },
            ],
          },
        ],
        tools: [
          {
            name: "submit_description",
            description: "Submit the description of this screenshot.",
            input_schema: {
              type: "object" as const,
              properties: {
                description: {
                  type: "string",
                  description: "1-2 sentence factual description of what's shown in the screenshot",
                },
              },
              required: ["description"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "submit_description" },
      });

      const toolUse = response.content.find((b) => b.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") return null;

      const input = toolUse.input as { description: string };
      if (!input.description) return null;

      return { description: input.description };
    } catch {
      return null;
    }
  }
}
