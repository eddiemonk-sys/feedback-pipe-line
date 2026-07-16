import type { ThreadRouter, ThreadRouterResult, LLMToolCall, ImageAttachment } from "../../core/ports.js";

export class ClaudeThreadRouter implements ThreadRouter {
  constructor(private llmClient: LLMToolCall, private systemPrompt: string) {}

  async route(
    replyText: string,
    replyImages: ImageAttachment[],
    candidates: Array<{ pageId: string; summary: string; preambleContext?: string }>,
  ): Promise<ThreadRouterResult[]> {
    if (candidates.length === 0) return [];
    if (candidates.length === 1) {
      // Single candidate: always route to it without an LLM call.
      return [{ pageId: candidates[0].pageId, relevance: "primary", rationale: "Only one candidate row." }];
    }

    try {
      const candidateList = candidates
        .map((c, i) => `[${i + 1}] pageId: ${c.pageId}\nSummary: ${c.summary}${c.preambleContext ? `\nContext: ${c.preambleContext}` : ""}`)
        .join("\n\n");

      const input = await this.llmClient.complete({
        system: this.systemPrompt,
        userMessage: `Thread reply: ${replyText}\n\nCandidates:\n${candidateList}`,
        tool: {
          name: "submit_routes",
          description: "Submit the routing decision for this thread reply.",
          inputSchema: {
            type: "object",
            properties: {
              routes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    pageId: { type: "string", description: "Page ID from the candidates list (copy verbatim)." },
                    relevance: { type: "string", enum: ["primary", "secondary"] },
                    rationale: { type: "string", description: "One sentence: why this row matches the reply." },
                  },
                  required: ["pageId", "relevance", "rationale"],
                },
                minItems: 1,
                description: "One entry per matched row.",
              },
            },
            required: ["routes"],
          },
        },
        temperature: 0,
        maxTokens: 1024,
        images: replyImages.length ? replyImages : undefined,
      });

      if (!input) return [];

      const { routes } = input as {
        routes: Array<{ pageId: string; relevance: string; rationale: string }>;
      };

      if (!Array.isArray(routes) || routes.length === 0) return [];

      const validPageIds = new Set(candidates.map((c) => c.pageId));
      return routes
        .filter((r) => validPageIds.has(r.pageId) && (r.relevance === "primary" || r.relevance === "secondary") && r.rationale)
        .map((r): ThreadRouterResult => ({
          pageId: r.pageId,
          relevance: r.relevance as "primary" | "secondary",
          rationale: r.rationale,
        }));
    } catch {
      return [];
    }
  }
}
