import { Client } from "@notionhq/client";
import type { NotionWriter, FeedbackRecord, FeedbackCategory, ImageAttachment } from "../../core/ports.js";
import { uploadImageToNotion } from "../../backfill/imageUpload.js";

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

  constructor(private apiKey: string, private databaseId: string) {
    this.client = new Client({ auth: apiKey, notionVersion: "2022-06-28" });
  }

  async createFeedback(r: FeedbackRecord): Promise<string> {
    // Best-effort: an image-upload failure must never block the capture (we just attach nothing).
    const imageUploadId = r.image ? await uploadImageToNotion(this.apiKey, r.image) : null;
    const page = await this.client.pages.create({
      parent: { database_id: this.databaseId },
      properties: {
        Message: { title: [{ text: { content: r.message.slice(0, MAX_TEXT) } }] },
        Channel: { rich_text: [{ text: { content: r.channelName.slice(0, MAX_TEXT) } }] },
        Author: { rich_text: [{ text: { content: r.authorName.slice(0, MAX_TEXT) } }] },
        Date: { date: { start: r.dateIso } },
        "Flagged By": { rich_text: [{ text: { content: r.flaggedByName.slice(0, MAX_TEXT) } }] },
        Status: { select: { name: r.status ?? "New" } },
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
        ...(r.categories && r.categories.length > 0
          ? { Categories: { multi_select: r.categories.map((name) => ({ name })) } }
          : {}),
        ...(r.aiSuggestedCategories && r.aiSuggestedCategories.length > 0
          ? { "AI Suggested Categories": { multi_select: r.aiSuggestedCategories.map((name) => ({ name })) } }
          : {}),
        // Migration shim — remove after migration script has run
        ...(r.categories && r.categories.length > 0
          ? { Category: { select: { name: r.categories[0] } } }
          : {}),
        ...(r.aiSuggestedCategories && r.aiSuggestedCategories.length > 0
          ? { "AI Suggested Category": { select: { name: r.aiSuggestedCategories[0] } } }
          : {}),
        ...(r.aiSuggestedSummary
          ? { "AI Suggested Summary": { rich_text: [{ text: { content: r.aiSuggestedSummary.slice(0, MAX_TEXT) } }] } }
          : {}),
        ...(r.confidence ? { "Enrichment Confidence": { select: { name: r.confidence } } } : {}),
        ...(r.rationale
          ? { "Judge Rationale": { rich_text: [{ text: { content: r.rationale.slice(0, MAX_TEXT) } }] } }
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
        ...(r.sourceMessageKey
          ? { "Source Message Key": { rich_text: [{ text: { content: r.sourceMessageKey.slice(0, MAX_TEXT) } }] } }
          : {}),
        ...(r.preambleContext
          ? { "Preamble Context": { rich_text: [{ text: { content: r.preambleContext.slice(0, MAX_TEXT) } }] } }
          : {}),
        ...(r.mentionedUsers?.length
          ? { "Mentioned Users": { rich_text: [{ text: { content: r.mentionedUsers.join(", ").slice(0, MAX_TEXT) } }] } }
          : {}),
        ...(r.clientCompany
          ? { "Client Company": { rich_text: [{ text: { content: r.clientCompany.slice(0, MAX_TEXT) } }] } }
          : {}),
        ...(r.audience
          ? { "Audience": { select: { name: r.audience } } }
          : {}),
      },
    });

    // Write Title as a best-effort update — fails open if the column doesn't exist in the DB yet.
    if (r.title) {
      await this.client.pages.update({
        page_id: page.id,
        properties: {
          Title: { rich_text: [{ text: { content: r.title.slice(0, MAX_TEXT) } }] },
        },
      }).catch((err) => {
        console.warn("[notionWriter] Title write failed (add Title column to DB):", err);
      });
    }

    // Embed the uploaded image as an inline page block (requires "Insert content" integration permission).
    // Fails open — a block append failure must never cause a capture loss.
    if (imageUploadId) {
      try {
        await (this.client.blocks.children as any).append({
          block_id: page.id,
          children: [
            {
              type: "image",
              image: {
                type: "file_upload",
                file_upload: { id: imageUploadId },
              },
            },
          ],
        });
      } catch (err) {
        // Log but do not rethrow — the page was created successfully
        console.warn("[notionWriter] blocks.children.append failed (image not embedded):", err);
      }
    }

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

  async findRecentByCategories(
    categories: FeedbackCategory[],
    sinceDateIso: string,
  ): Promise<Array<{ pageId: string; summary: string }>> {
    if (categories.length === 0) return [];

    const filter =
      categories.length === 1
        ? { property: "Categories", multi_select: { contains: categories[0] } }
        : {
            or: categories.map((cat) => ({
              property: "Categories",
              multi_select: { contains: cat },
            })),
          };

    const res: any = await this.client.databases.query({
      database_id: this.databaseId,
      filter: {
        and: [filter, { property: "Date", date: { on_or_after: sinceDateIso } }],
      },
      page_size: MAX_RECENT_CANDIDATES,
    });

    return res.results
      .map((page: any) => ({
        pageId: page.id as string,
        summary: (page.properties?.["Summary"]?.rich_text?.[0]?.plain_text as string) ?? "",
      }))
      .filter((c: { summary: string }) => c.summary);
  }

  async updateSiblingLinks(pageId: string, siblingPageIds: string[]): Promise<void> {
    if (siblingPageIds.length === 0) return;
    await this.client.pages.update({
      page_id: pageId,
      properties: {
        Siblings: {
          relation: siblingPageIds.map((id) => ({ id })),
        },
      },
    });
  }

  async getPageSummaries(
    pageIds: string[],
  ): Promise<Array<{ pageId: string; summary: string; preambleContext?: string }>> {
    const results: Array<{ pageId: string; summary: string; preambleContext?: string }> = [];
    await Promise.all(
      pageIds.map(async (pageId) => {
        try {
          const page = await this.client.pages.retrieve({ page_id: pageId });
          const props = (page as any).properties as Record<string, any>;
          const summary: string = props["Summary"]?.rich_text?.[0]?.plain_text ?? "";
          if (!summary) return; // skip rows without a summary
          const preambleContext: string | undefined =
            props["Preamble Context"]?.rich_text?.[0]?.plain_text || undefined;
          results.push({ pageId, summary, preambleContext });
        } catch {
          // fail-open: skip pages that can't be retrieved
        }
      }),
    );
    return results;
  }

  async updateSummaryAndLog(
    pageId: string,
    replyText: string,
    replyAuthorName: string,
    replyTs: string,
    images?: ImageAttachment[],
  ): Promise<void> {
    const timestamp = new Date(Number(replyTs) * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
    const newEntry = `[${timestamp}] ${replyAuthorName}: ${replyText}`;
    const dateIso = new Date(Number(replyTs) * 1000).toISOString().slice(0, 10);

    // 1. Append to "Thread Replies" text property on the parent (quick-scan log).
    let current = "";
    try {
      const page = await this.client.pages.retrieve({ page_id: pageId });
      current =
        ((page as any).properties as Record<string, any>)["Thread Replies"]
          ?.rich_text?.[0]?.plain_text ?? "";
    } catch {
      // fail-open
    }
    const combined = current ? `${current}\n${newEntry}` : newEntry;
    const content = combined.length > MAX_TEXT ? combined.slice(combined.length - MAX_TEXT) : combined;

    await this.client.pages.update({
      page_id: pageId,
      properties: { "Thread Replies": { rich_text: [{ text: { content } }] } },
    });

    // 2. Create a child Notion row for this thread reply (master/child structure).
    const childTitle = `Thread: ${replyText.slice(0, 80)}${replyText.length > 80 ? "…" : ""}`;
    let childPageId: string | null = null;
    try {
      const childPage = await this.client.pages.create({
        parent: { database_id: this.databaseId },
        properties: {
          Message: { title: [{ text: { content: replyText.slice(0, MAX_TEXT) } }] },
          Author: { rich_text: [{ text: { content: replyAuthorName.slice(0, MAX_TEXT) } }] },
          Date: { date: { start: dateIso } },
          Source: { rich_text: [{ text: { content: "Thread Reply" } }] },
          Channel: { rich_text: [] },
          "Flagged By": { rich_text: [] },
          "Message URL": { url: null },
          "Customer/Account": { rich_text: [] },
        },
      });
      childPageId = childPage.id;

      // Write Title to child — best-effort (fails if column not yet in DB).
      await this.client.pages.update({
        page_id: childPageId,
        properties: { Title: { rich_text: [{ text: { content: childTitle.slice(0, MAX_TEXT) } }] } },
      }).catch((err) => console.warn("[notionWriter] child Title write failed:", err));
    } catch (err) {
      console.warn("[notionWriter] thread child page creation failed:", err);
    }

    // 3. Link child to parent's "Threads" relation — best-effort.
    if (childPageId) {
      try {
        const parentPage = await this.client.pages.retrieve({ page_id: pageId });
        const existing: Array<{ id: string }> =
          ((parentPage as any).properties as Record<string, any>)["Threads"]?.relation ?? [];
        await this.client.pages.update({
          page_id: pageId,
          properties: {
            Threads: { relation: [...existing.map((r) => ({ id: r.id })), { id: childPageId }] },
          },
        });
      } catch (err) {
        console.warn("[notionWriter] Threads relation link failed (add Threads column to DB):", err);
      }
    }

    // 4. Attach reply images to the child row (not the parent).
    if (images?.length && childPageId) {
      const imageUploadIds = await Promise.all(
        images.map(async (img) => {
          try { return await uploadImageToNotion(this.apiKey, img); }
          catch { return null; }
        }),
      );
      const validIds = imageUploadIds.filter((id): id is string => id !== null);
      if (validIds.length > 0) {
        await (this.client.blocks.children as any).append({
          block_id: childPageId,
          children: validIds.map((id) => ({
            type: "image",
            image: { type: "file_upload", file_upload: { id } },
          })),
        }).catch((err: unknown) => console.warn("[notionWriter] child image append failed:", err));
      }
    }
  }

  async relinkRelatedFeedback(masterPageId: string, childPageId: string): Promise<void> {
    // 1. Append child to master's "Related Feedback" list.
    try {
      const masterPage = await this.client.pages.retrieve({ page_id: masterPageId });
      const existing: Array<{ id: string }> =
        ((masterPage as any).properties as Record<string, any>)["Related Feedback"]?.relation ?? [];
      const alreadyLinked = existing.some((r) => r.id === childPageId);
      if (!alreadyLinked) {
        await this.client.pages.update({
          page_id: masterPageId,
          properties: {
            "Related Feedback": {
              relation: [...existing.map((r) => ({ id: r.id })), { id: childPageId }],
            },
          },
        });
      }
    } catch (err: unknown) {
      console.warn("[notionWriter] relinkRelatedFeedback: master update failed:", err);
    }

    // 2. Set child's "Related Feedback" to [master] (overwrite — child has exactly one master).
    try {
      await this.client.pages.update({
        page_id: childPageId,
        properties: {
          "Related Feedback": { relation: [{ id: masterPageId }] },
        },
      });
    } catch (err: unknown) {
      console.warn("[notionWriter] relinkRelatedFeedback: child update failed:", err);
    }
  }

  /**
   * Backfill-only: overwrite the human-editable Category / Summary on an existing row.
   * Leaves "AI Suggested Category" untouched so the AI's original call stays diffable.
   */
  async updateClassification(
    pageId: string,
    patch: { category?: FeedbackCategory; summary?: string },
  ): Promise<void> {
    const properties: Record<string, any> = {};
    if (patch.category) properties["Category"] = { select: { name: patch.category } };
    if (patch.summary) properties["Summary"] = { rich_text: [{ text: { content: patch.summary.slice(0, MAX_TEXT) } }] };
    if (Object.keys(properties).length === 0) return;
    await this.client.pages.update({ page_id: pageId, properties });
  }

  /**
   * Backfill-only: record that a human reviewed this row (the Phase A signal). Sets
   * "Category Reviewed" = true and "Summary Verdict" per whether the summary was faithful.
   * A human confirming an item during backfill IS that review — this avoids a second pass.
   */
  async markReviewed(pageId: string, summaryFaithful: boolean): Promise<void> {
    await this.client.pages.update({
      page_id: pageId,
      properties: {
        "Category Reviewed": { checkbox: true },
        "Summary Verdict": {
          select: { name: summaryFaithful ? "Confirmed Faithful" : "Confirmed Not Faithful" },
        },
      },
    });
  }
}
