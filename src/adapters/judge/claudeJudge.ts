import Anthropic from "@anthropic-ai/sdk";
import type { Judge, JudgeVerdict, FeedbackCategory, ConfidenceLevel } from "../../core/ports.js";
import { CATEGORIES } from "../../core/taxonomy.js";

const CONFIDENCE_LEVELS: ConfidenceLevel[] = ["High", "Medium", "Low"];

const SYSTEM_PROMPT = `You are a quality-control judge for an AI feedback classifier at a B2B SaaS company providing HR / talent-assessment software.

You will be given the ORIGINAL Slack message (the source of truth) and an AI-proposed summary + one or two categories. Check the proposal against the original message and decide how much a human should trust it.

Check three things:
1. Category fit: do ALL assigned categories genuinely match the message, per the taxonomy below?
2. Multi-category justification: if two categories are assigned, does the message genuinely span both areas? Or is one redundant?
3. Summary faithfulness: does the summary only state things actually in the original message (no fabricated claims), and does it capture the key point?

Valid categories: ${CATEGORIES.join(", ")}

Respond with:
- confidence: "High" if all checks clearly pass, "Medium" if one is questionable but plausible, "Low" if any check clearly fails or you are unsure.
- rationale: one short sentence. Only explain what's wrong when confidence is not High — for High, a brief confirmation is enough.`;

/**
 * Reference-grounded judge: grades the enricher's output against the ORIGINAL message,
 * never against its own preference — this is what avoids the self-enhancement bias
 * documented for a model informally re-approving its own prior output.
 */
export class ClaudeJudge implements Judge {
  private client: Anthropic;
  private systemPrompt: string;

  constructor(apiKey: string, systemPrompt?: string, private model = "claude-haiku-4-5-20251001") {
    this.client = new Anthropic({ apiKey });
    this.systemPrompt = systemPrompt ?? SYSTEM_PROMPT;
  }

  async review(
    originalMessage: string,
    channelName: string,
    summary: string,
    categories: FeedbackCategory[],
  ): Promise<JudgeVerdict | null> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 256,
        system: this.systemPrompt,
        messages: [
          {
            role: "user",
            content: `Channel: ${channelName}\nOriginal message: ${originalMessage}\n\nProposed summary: ${summary}\nProposed categories: ${categories.join(", ")}`,
          },
        ],
        tools: [
          {
            name: "submit_verdict",
            description: "Submit the confidence and rationale for this enrichment review.",
            input_schema: {
              type: "object" as const,
              properties: {
                confidence: {
                  type: "string",
                  enum: CONFIDENCE_LEVELS,
                  description: "How much a human should trust this category + summary",
                },
                rationale: {
                  type: "string",
                  description: "One short sentence explaining the confidence level",
                },
              },
              required: ["confidence", "rationale"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "submit_verdict" },
      });

      const toolUse = response.content.find((b) => b.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") return null;

      const input = toolUse.input as { confidence: string; rationale: string };
      if (!CONFIDENCE_LEVELS.includes(input.confidence as ConfidenceLevel) || !input.rationale) return null;

      return {
        confidence: input.confidence as ConfidenceLevel,
        rationale: input.rationale,
      };
    } catch {
      return null;
    }
  }
}
