import type { Judge as JudgePort, LLMToolCall, JudgeVerdict, FeedbackCategory, ConfidenceLevel } from "../../core/ports.js";
import { CATEGORIES } from "../../core/taxonomy.js";

const CONFIDENCE_LEVELS: ConfidenceLevel[] = ["High", "Medium", "Low"];

const DEFAULT_SYSTEM_PROMPT = `You are a quality-control judge for an AI feedback classifier at a B2B SaaS company providing HR / talent-assessment software.

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
export class Judge implements JudgePort {
  private systemPrompt: string;

  constructor(private llmClient: LLMToolCall, systemPrompt?: string) {
    this.systemPrompt = systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  }

  async review(
    originalMessage: string,
    channelName: string,
    summary: string,
    categories: FeedbackCategory[],
  ): Promise<JudgeVerdict | null> {
    const input = await this.llmClient.complete({
      system: this.systemPrompt,
      userMessage: `Channel: ${channelName}\nOriginal message: ${originalMessage}\n\nProposed summary: ${summary}\nProposed categories: ${categories.join(", ")}`,
      tool: {
        name: "submit_verdict",
        description: "Fill reasoning first, then confidence and rationale.",
        inputSchema: {
          type: "object",
          properties: {
            reasoning: {
              type: "string",
              description: "1-2 sentences: which signals support or contradict the proposed category and summary.",
            },
            confidence: {
              type: "string",
              enum: CONFIDENCE_LEVELS,
              description: "How much a human should trust these categories + summary",
            },
            rationale: {
              type: "string",
              description: "One short sentence explaining the confidence level",
            },
          },
          required: ["reasoning", "confidence", "rationale"],
        },
      },
      temperature: 0,
      maxTokens: 512,
    });

    if (!input) return null;

    const { confidence, rationale } = input as { reasoning: string; confidence: string; rationale: string };
    if (!CONFIDENCE_LEVELS.includes(confidence as ConfidenceLevel) || !rationale) return null;

    return { confidence: confidence as ConfidenceLevel, rationale };
  }
}
