import { Client } from "@notionhq/client";
import type { NotionWriter, FeedbackRecord, FeedbackCategory } from "../../core/ports.js";

/** Notion caps a single text content value at 2000 characters. */
const MAX_TEXT = 2000;

/** Bounds the candidate set sent to the similarity detector — this is a duplicate check, not a general report. */
const MAX_RECENT_CANDIDATES = 30;

/**
 * NotionWriter implementation using the official Notion REST API. Property names match
 * the live "Customer Feedback" data source (verified). The DB has a single data source,
 * so we use the stable `parent: { database_id }` path on API version 2022-06-28.
 *
 * "Customer/Account", "Enrichment Confidence" (select), "Judge Rationale" (text),
 * "Visual Description" (text), "AI Suggested Category" (select, same options as
 * Category), "AI Suggested Summary" (text), "Related Feedback" (relation,
 * self-referencing), and "Related Feedback Rationale" (text) must all exist on the
 * Notion DB before use.
 */
export class NotionFeedbackWriter implements NotionWriter {
  private client: Client;

  constructor(apiKey: string, private databaseId: string) {
    this.client = new Client({ auth: apiKey, notionVersion: "2022-06-28" });
  }

  async createFeedback(r: FeedbackRecord): Promise<string> {
    const page = await this.client.pages.create({
      parent: { database_id: this.databaseId },
      properties: {
        Message: { title: [{ text: { content: r.message.slice(0, MAX_TEXT) } }] },
        Channel: { rich_text: [{ text: { content: r.channelName.slice(0, MAX_TEXT) } }] },
        Author: { rich_text: [{ text: { content: r.authorName.slice(0, MAX_TEXT) } }] },
        Date: { date: { start: r.dateIso } },
        "Flagged By": { rich_text: [{ text: { content: r.flaggedByName.slice(0, MAX_TEXT) } }] },
        Status: { select: { name: "New" } },
        Source: { rich_text: [{ text: { content: r.source.slice(0, MAX_TEXT) } }] },
        "Message URL": { url: r.messageUrl || null },
        "Customer/Account": {
          rich_text: r.customerAccount
            ? [{ text: { content: r.customerAccount.slice(0, MAX_TEXT) } }]
            : [],
        },
        ...(r.summary
          ? { Summary: { rich_text: [{ text: { content: r.summary.slice(0, MAX_TEXT) } }] } }
          : {}),
        ...(r.category ? { Category: { select: { name: r.category } } } : {}),
        ...(r.aiSuggestedCategory
          ? { "AI Suggested Category": { select: { name: r.aiSuggestedCategory } } }
          : {}),
        ...(r.aiSuggestedSummary
          ? { "AI Suggested Summary": { rich_text: [{ text: { content: r.aiSuggestedSummary.slice(0, MAX_TEXT) } }] } }
          : {}),
        ...(r.confidence ? { "Enrichment Confidence": { select: { name: r.confidence } } } : {}),
        ...(r.rationale
          ? { "Judge Rationale": { rich_text: [{ text: { content: r.rationale.slice(0, MAX_TEXT) } }] } }
          : {}),
        ...(r.visualDescription
          ? { "Visual Description": { rich_text: [{ text: { content: r.visualDescription.slice(0, MAX_TEXT) } }] } }
          : {}),
        ...(r.relatedFeedbackPageId
          ? { "Related Feedback": { relation: [{ id: r.relatedFeedbackPageId }] } }
          : {}),
        ...(r.relatedFeedbackRationale
          ? {
              "Related Feedback Rationale": {
                rich_text: [{ text: { content: r.relatedFeedbackRationale.slice(0, MAX_TEXT) } }],
              },
            }
          : {}),
      },
    });
    return page.id;
  }

  async appendFlagger(pageId: string, newFlaggerName: string): Promise<void> {
    // Fetch the current "Flagged By" value.
    const page = await this.client.pages.retrieve({ page_id: pageId });
    const props = (page as any).properties as Record<string, any>;
    const currentText: string = props["Flagged By"]?.rich_text?.[0]?.plain_text ?? "";

    const names = currentText
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);

    if (names.includes(newFlaggerName)) return; // already listed

    const updated = [...names, newFlaggerName].join(", ");

    await this.client.pages.update({
      page_id: pageId,
      properties: {
        "Flagged By": { rich_text: [{ text: { content: updated.slice(0, MAX_TEXT) } }] },
      },
    });
  }

  async findRecentByCategory(
    category: FeedbackCategory,
    sinceDateIso: string,
  ): Promise<Array<{ pageId: string; summary: string }>> {
    const res: any = await this.client.databases.query({
      database_id: this.databaseId,
      filter: {
        and: [
          { property: "Category", select: { equals: category } },
          { property: "Date", date: { on_or_after: sinceDateIso } },
        ],
      },
      page_size: MAX_RECENT_CANDIDATES,
    });

    return res.results
      .map((page: any) => ({
        pageId: page.id as string,
        summary: (page.properties?.["Summary"]?.rich_text?.[0]?.plain_text as string) ?? "",
      }))
      .filter((c: { summary: string }) => c.summary); // nothing to compare without a summary
  }
}
