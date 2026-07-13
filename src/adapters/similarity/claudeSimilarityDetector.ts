import Anthropic from "@anthropic-ai/sdk";
import type { SimilarityDetector, SimilarMatch, FeedbackCategory } from "../../core/ports.js";
import { appendGuidance } from "../../core/promptGuidance.js";

const NONE = "none";

const SYSTEM_PROMPT = `You check whether a new piece of feedback describes the SAME underlying issue as one already reported, for a B2B SaaS company providing HR / talent-assessment software.

You will be given a new feedback summary and a short list of recent candidate summaries, each with an ID. Only match if a candidate genuinely describes the same underlying issue — not just the same general topic or category. Different people can describe the same bug in very different words; that counts as a match. Two different complaints that happen to share a category do not.

If unsure, prefer "none" — a missed connection costs nothing, a wrong one creates a misleading link between two unrelated reports.

Respond with:
- matchedId: the ID of the matching candidate, or "none" if none genuinely match.
- rationale: one short sentence. If matched, say what the shared issue is. If none, a brief confirmation is enough.`;

/**
 * Reference-grounded against the actual candidate summaries, not a vague sense of the category —
 * same mitigation shape as ClaudeJudge. Fails open (null) on any error.
 */
export class ClaudeSimilarityDetector implements SimilarityDetector {
  private client: Anthropic;
  private systemPrompt: string;

  constructor(apiKey: string, rulesGuide?: string, private model = "claude-haiku-4-5-20251001") {
    this.client = new Anthropic({ apiKey });
    this.systemPrompt = appendGuidance(SYSTEM_PROMPT, rulesGuide);
  }

  async findSimilar(
    summary: string,
    categories: FeedbackCategory[],
    candidates: Array<{ pageId: string; summary: string }>,
  ): Promise<SimilarMatch | null> {
    if (candidates.length === 0) return null;

    try {
      const candidateList = candidates
        .map((c, i) => `${i + 1}. [id: ${c.pageId}] ${c.summary}`)
        .join("\n");
      const validIds = [...candidates.map((c) => c.pageId), NONE];

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 256,
        system: this.systemPrompt,
        messages: [
          {
            role: "user",
            content: `New feedback (categories: ${categories.join(", ")}): ${summary}\n\nRecent candidates:\n${candidateList}`,
          },
        ],
        tools: [
          {
            name: "submit_match",
            description: "Submit whether the new feedback matches an existing candidate.",
            input_schema: {
              type: "object" as const,
              properties: {
                matchedId: {
                  type: "string",
                  enum: validIds,
                  description: "The matching candidate's ID, or \"none\"",
                },
                rationale: {
                  type: "string",
                  description: "One short sentence explaining the decision",
                },
              },
              required: ["matchedId", "rationale"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "submit_match" },
      });

      const toolUse = response.content.find((b) => b.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") return null;

      const input = toolUse.input as { matchedId: string; rationale: string };
      if (!input.rationale || input.matchedId === NONE || !validIds.includes(input.matchedId)) return null;

      return { matchedPageId: input.matchedId, rationale: input.rationale };
    } catch {
      return null;
    }
  }
}
