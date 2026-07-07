import Anthropic from "@anthropic-ai/sdk";
import type { FeedbackGate, FeedbackGateResult, ConfidenceLevel } from "../../core/ports.js";

const CONFIDENCE_LEVELS: ConfidenceLevel[] = ["High", "Medium", "Low"];

const SYSTEM_PROMPT = `You are triaging historical Slack messages at a B2B SaaS company providing HR / talent-assessment software, to find CUSTOMER FEEDBACK that was never formally logged.

Customer feedback includes: bug reports, feature requests, complaints, praise, usability friction, pricing/commercial reactions, onboarding pain, reporting/data gaps, candidate-experience remarks, and assessment accuracy/validity concerns — whether stated directly by a customer or relayed by a colleague ("client said X", "a candidate complained that Y").

NOT feedback: internal logistics, scheduling, greetings, standups, deploy notices, jokes, and generic chit-chat with no product signal.

Bias toward RECALL: a human reviews every message you flag, so when a message plausibly carries any customer signal, flag it. Only withhold messages with clearly no product/customer signal.`;

/** High-recall "is this likely customer feedback?" gate. Fails open (returns null) on error. */
export class ClaudeFeedbackGate implements FeedbackGate {
  private client: Anthropic;

  constructor(apiKey: string, private model = "claude-haiku-4-5-20251001") {
    this.client = new Anthropic({ apiKey });
  }

  async classify(text: string, channelName: string): Promise<FeedbackGateResult | null> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Channel: ${channelName}\nMessage: ${text}` }],
        tools: [
          {
            name: "submit_triage",
            description: "Submit whether this message is likely customer feedback.",
            input_schema: {
              type: "object" as const,
              properties: {
                is_likely_feedback: { type: "boolean", description: "True if plausibly customer feedback (recall-biased)" },
                confidence: { type: "string", enum: CONFIDENCE_LEVELS, description: "Confidence in the decision" },
                rationale: { type: "string", description: "One short sentence of reasoning" },
              },
              required: ["is_likely_feedback", "confidence", "rationale"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "submit_triage" },
      });

      const toolUse = response.content.find((b) => b.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") return null;
      const input = toolUse.input as { is_likely_feedback: boolean; confidence: string; rationale: string };
      if (!CONFIDENCE_LEVELS.includes(input.confidence as ConfidenceLevel) || typeof input.is_likely_feedback !== "boolean") return null;

      return {
        isLikelyFeedback: input.is_likely_feedback,
        confidence: input.confidence as ConfidenceLevel,
        rationale: input.rationale ?? "",
      };
    } catch {
      return null;
    }
  }
}
