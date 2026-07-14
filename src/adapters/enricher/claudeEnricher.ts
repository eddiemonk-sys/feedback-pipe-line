import Anthropic from "@anthropic-ai/sdk";
import type { Enricher, EnrichmentResult, FeedbackCategory } from "../../core/ports.js";
import { CATEGORIES } from "../../core/taxonomy.js";
import { appendGuidance } from "../../core/promptGuidance.js";

const SYSTEM_PROMPT = `You are a feedback classifier for a B2B SaaS company providing HR / talent-assessment software. Given a Slack message and its channel, produce a 1-2 sentence plain-English summary and classify it into 1 or 2 categories.

Categories and examples:
- Bug / Broken: "The export button throws an error" → "Export feature is broken and throws an error when clicked."
- Feature Request: "It would be great if we could bulk-assign candidates" → "User wants bulk candidate assignment functionality."
- Pricing / Commercial: "The per-seat pricing is too high for us" → "User finds per-seat pricing too expensive for their team size."
- Onboarding / Setup: "We couldn't figure out how to connect our ATS" → "User struggled to connect their ATS during onboarding."
- UX / Usability: "The navigation is confusing, I can never find reports" → "User finds navigation confusing and has trouble locating reports."
- Reporting / Data: "The pipeline report doesn't include withdrawn candidates" → "Pipeline report is missing withdrawn candidates from the data."
- Praise: "The new search is so much faster, our team loves it!" → "User is very happy with the improved search speed."
- Other: "Quick question about your roadmap" → "User has a general roadmap inquiry."
- Candidate Experience: "A candidate said the assessment invite email looked like spam" → "Candidate found the assessment invite email untrustworthy-looking."
- Assessment Accuracy/Validity: "The scoring doesn't seem to reflect how the candidate actually performed" → "User doubts the assessment's scoring accurately reflects candidate performance."
- Compliance / Legal / Governance: "We need GDPR data-deletion support for candidate records" → "User needs GDPR-compliant data deletion for candidate records."

Use Assessment Accuracy/Validity only when the concern is about whether the assessment MEASURES THE RIGHT THING or scores correctly — not general bugs or UX complaints about the assessment tool itself.
Use 2 categories only when the message genuinely spans two distinct areas. Most messages need only 1.

Remove Slack noise (raw @mentions, filler phrases). Keep the summary factual and concise.`;

export class ClaudeEnricher implements Enricher {
  private client: Anthropic;
  private systemPrompt: string;

  constructor(apiKey: string, systemPrompt?: string, styleGuide?: string, private model = "claude-haiku-4-5-20251001") {
    this.client = new Anthropic({ apiKey });
    this.systemPrompt = appendGuidance(systemPrompt ?? SYSTEM_PROMPT, styleGuide);
  }

  async enrich(text: string, channelName: string): Promise<EnrichmentResult | null> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        temperature: 0,
        system: this.systemPrompt,
        messages: [
          {
            role: "user",
            content: `Channel: ${channelName}\nMessage: ${text}`,
          },
        ],
        tools: [
          {
            name: "submit_enrichment",
            description: "Submit the classification for this feedback message. Fill reasoning first, then summary and categories.",
            input_schema: {
              type: "object" as const,
              properties: {
                reasoning: {
                  type: "string",
                  description: "1-2 sentences: which signals in the message drove your category choice, and why you ruled out the closest alternative.",
                },
                summary: {
                  type: "string",
                  description: "1-2 sentence plain-English summary of the feedback",
                },
                categories: {
                  type: "array",
                  items: { type: "string", enum: CATEGORIES },
                  minItems: 1,
                  maxItems: 2,
                  description: "1 or 2 categories that best fit this feedback. Use 2 only when the message genuinely spans two distinct areas.",
                },
              },
              required: ["reasoning", "summary", "categories"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "submit_enrichment" },
      });

      const toolUse = response.content.find((b) => b.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") return null;

      const input = toolUse.input as { reasoning: string; summary: string; categories: string[] };
      if (
        !input.summary ||
        !Array.isArray(input.categories) ||
        input.categories.length < 1 ||
        input.categories.length > 2 ||
        !input.categories.every((c) => CATEGORIES.includes(c as FeedbackCategory))
      ) return null;

      return {
        summary: input.summary,
        categories: input.categories as FeedbackCategory[],
      };
    } catch {
      return null;
    }
  }
}
