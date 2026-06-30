import Anthropic from "@anthropic-ai/sdk";
import type { Enricher, EnrichmentResult, FeedbackCategory } from "../../core/ports.js";

const CATEGORIES: FeedbackCategory[] = [
  "Bug / Broken",
  "Feature Request",
  "Pricing / Commercial",
  "Onboarding / Setup",
  "UX / Usability",
  "Reporting / Data",
  "Praise",
  "Other",
];

const SYSTEM_PROMPT = `You are a feedback classifier for a B2B SaaS company. Given a Slack message and its channel, produce a 1-2 sentence plain-English summary and classify it into exactly one category.

  Categories and examples:
  - Bug / Broken: "The export button throws an error" → "Export feature is broken and throws an error when clicked."
  - Feature Request: "It would be great if we could bulk-assign candidates" → "User wants bulk candidate assignment functionality."
  - Pricing / Commercial: "The per-seat pricing is too high for us" → "User finds per-seat pricing too expensive for their team size."
  - Onboarding / Setup: "We couldn't figure out how to connect our ATS" → "User struggled to connect their ATS during onboarding."
  - UX / Usability: "The navigation is confusing, I can never find reports" → "User finds navigation confusing and has trouble locating reports."
  - Reporting / Data: "The pipeline report doesn't include withdrawn candidates" → "Pipeline report is missing withdrawn candidates from the data."
  - Praise: "The new search is so much faster, our team loves it!" → "User is very happy with the improved search speed."
  - Other: "Quick question about your roadmap" → "User has a general roadmap inquiry."

  Remove Slack noise (raw @mentions, filler phrases). Keep the summary factual and concise.`;

export class ClaudeEnricher implements Enricher {
  private client: Anthropic;

  constructor(apiKey: string, private model = "claude-haiku-4-5-20251001") {
    this.client = new Anthropic({ apiKey });
  }

  async enrich(text: string, channelName: string): Promise<EnrichmentResult | null> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Channel: ${channelName}\nMessage: ${text}`,
          },
        ],
        tools: [
          {
            name: "submit_enrichment",
            description: "Submit the summary and category for this feedback message.",
            input_schema: {
              type: "object" as const,
              properties: {
                summary: {
                  type: "string",
                  description: "1-2 sentence plain-English summary of the feedback",
                },
                category: {
                  type: "string",
                  enum: CATEGORIES,
                  description: "The category that best fits this feedback",
                },
              },
              required: ["summary", "category"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "submit_enrichment" },
      });

      const toolUse = response.content.find((b) => b.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") return null;

      const input = toolUse.input as { summary: string; category: string };
      if (!input.summary || !CATEGORIES.includes(input.category as FeedbackCategory)) return null;

      return {
        summary: input.summary,
        category: input.category as FeedbackCategory,
      };
    } catch {
      return null;
    }
  }
}
