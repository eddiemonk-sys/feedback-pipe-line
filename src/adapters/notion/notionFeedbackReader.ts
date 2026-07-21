import { Client } from "@notionhq/client";
import type { FeedbackDigestReader, DigestFeedbackItem } from "../../core/digest.js";

export class NotionFeedbackReader implements FeedbackDigestReader {
  private client: Client;
  private databaseId: string;

  constructor(apiKey: string, databaseId: string) {
    this.client = new Client({ auth: apiKey, notionVersion: "2022-06-28" });
    this.databaseId = databaseId;
  }

  async readRecentFeedback(daysBefore: number): Promise<DigestFeedbackItem[]> {
    const since = new Date();
    since.setDate(since.getDate() - daysBefore);
    const sinceIso = since.toISOString().split("T")[0]!;

    const items: DigestFeedbackItem[] = [];
    let cursor: string | undefined;

    do {
      const res: any = await this.client.databases.query({
        database_id: this.databaseId,
        filter: { property: "Date", date: { on_or_after: sinceIso } },
        sorts: [{ property: "Date", direction: "descending" }],
        start_cursor: cursor,
        page_size: 100,
      });

      for (const page of res.results) {
        const props = page.properties;

        const titleParts: any[] = props["Title"]?.rich_text ?? [];
        const title =
          titleParts.map((t: any) => t.plain_text).join("").trim() ||
          (props["Message"]?.title?.[0]?.plain_text ?? "").slice(0, 80).trim();

        const summary: string =
          props["AI Suggested Summary"]?.rich_text?.[0]?.plain_text ??
          props["Summary"]?.rich_text?.[0]?.plain_text ??
          "";

        if (!title && !summary) continue;

        const categories: string[] = (props["Categories"]?.multi_select ?? []).map((o: any) => o.name);
        const dateIso: string = props["Date"]?.date?.start ?? "";
        const customerAccount: string = props["Customer/Account"]?.rich_text?.[0]?.plain_text ?? "";
        const relatedCount: number = props["Related Feedback"]?.relation?.length ?? 0;

        items.push({ title, summary, categories, dateIso, customerAccount, relatedCount });
      }

      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);

    return items;
  }
}
