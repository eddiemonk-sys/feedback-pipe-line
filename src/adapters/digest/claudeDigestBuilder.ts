import Anthropic from "@anthropic-ai/sdk";
import type { DigestBuilder, DigestFeedbackItem } from "../../core/digest.js";

export class ClaudeDigestBuilder implements DigestBuilder {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async buildDigest(items: DigestFeedbackItem[], weekLabel: string): Promise<string> {
    if (items.length === 0) {
      return `*📋 Weekly Feedback Digest — ${weekLabel}*\n_No feedback captured this week._`;
    }

    const formatted = items
      .map(
        (item, i) =>
          `[${i + 1}] *${item.title || "(untitled)"}*\n` +
          `Category: ${item.categories.join(", ") || "—"}\n` +
          `Customer: ${item.customerAccount || "—"}\n` +
          `Mentions: ${item.relatedCount + 1}\n` +
          item.summary,
      )
      .join("\n\n");

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `You are writing the weekly feedback digest for the Spotted Zebra product team in Slack.

${items.length} feedback items captured ${weekLabel}:

${formatted}

Write a concise, skimmable Slack digest. Rules:
- Open exactly with: "*📋 Weekly Feedback Digest — ${weekLabel}*\\n_${items.length} items captured_"
- Show a *🔥 Trending* section for any items with Mentions ≥ 3 — name the customers and the specific ask
- Group remaining items into 3–5 named themes with *bold* headers
- 2–3 bullet points per theme (• prefix), one sentence each — be specific, name customers and deadlines
- Close with: "_Category breakdown: Feature Request: N · Bug: N · UX: N · ..._" (include all categories with count > 0)
- Use Slack markdown: *bold*, _italic_, • bullets. No markdown headers (# ---).
- 350–500 words total. No generic filler — every bullet should be something the product team can act on.`,
        },
      ],
    });

    const block = response.content.find((b) => b.type === "text");
    return block && block.type === "text" ? block.text : "(digest generation failed — check ANTHROPIC_API_KEY)";
  }
}
