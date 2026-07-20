import { dirname } from "node:path";
import { mkdirSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import type { NotionWriter, FeedbackRecord, FeedbackCategory, ImageAttachment } from "../../core/ports.js";
import type { Logger } from "../../util/logger.js";

let localIdSeq = 0;

/**
 * Test/dev output sink. Appends each captured feedback record to a local JSONL file
 * (one JSON object per line) instead of writing to Notion. Implements the same
 * NotionWriter port, so switching to the real Notion writer is a config change only.
 */
export class LocalFeedbackWriter implements NotionWriter {
  constructor(private filePath: string, private logger: Logger) {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  async createFeedback(record: FeedbackRecord): Promise<string> {
    const id = `local_${++localIdSeq}_${Date.now()}`;
    const line = JSON.stringify({ capturedAt: new Date().toISOString(), id, ...record });
    appendFileSync(this.filePath, line + "\n", "utf8");
    this.logger.info("Wrote feedback to local file", {
      file: this.filePath,
      author: record.authorName,
      message: record.message,
    });
    return id;
  }

  async appendFlagger(pageId: string, newFlaggerName: string): Promise<void> {
    const line = JSON.stringify({
      capturedAt: new Date().toISOString(),
      event: "flagger_added",
      pageId,
      newFlaggerName,
    });
    appendFileSync(this.filePath, line + "\n", "utf8");
    this.logger.info("Appended flagger to local file", { pageId, newFlaggerName });
  }

  async findRecentByCategories(
    categories: FeedbackCategory[],
    sinceDateIso: string,
  ): Promise<Array<{ pageId: string; summary: string }>> {
    if (!existsSync(this.filePath)) return [];

    const lines = readFileSync(this.filePath, "utf8").trim().split("\n").filter(Boolean);
    const candidates: Array<{ pageId: string; summary: string }> = [];
    const categorySet = new Set(categories);

    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        // Support both old single-category and new multi-category records
        const recordCategories: FeedbackCategory[] = record.categories ?? (record.category ? [record.category] : []);
        if (!recordCategories.some((c: FeedbackCategory) => categorySet.has(c)) || !record.summary) continue;
        if (record.dateIso && record.dateIso < sinceDateIso) continue;
        if (record.id) candidates.push({ pageId: record.id, summary: record.summary });
      } catch {
        continue; // skip malformed lines (e.g. the flagger-added event lines)
      }
    }

    return candidates;
  }

  async updateSiblingLinks(pageId: string, siblingPageIds: string[]): Promise<void> {
    const line = JSON.stringify({
      capturedAt: new Date().toISOString(),
      event: "sibling_links_updated",
      pageId,
      siblingPageIds,
    });
    appendFileSync(this.filePath, line + "\n", "utf8");
    this.logger.info("Sibling links updated (local)", { pageId, siblingCount: siblingPageIds.length });
  }

  async getPageSummaries(
    pageIds: string[],
  ): Promise<Array<{ pageId: string; summary: string; preambleContext?: string }>> {
    // Local writer can't look up by page ID — return empty (thread routing will route to all)
    return [];
  }

  async updateSummaryAndLog(
    pageId: string,
    replyText: string,
    replyAuthorName: string,
    replyTs: string,
    _images?: ImageAttachment[],
  ): Promise<void> {
    const childId = `local_thread_${++localIdSeq}_${Date.now()}`;
    const line = JSON.stringify({
      capturedAt: new Date().toISOString(),
      event: "thread_child_created",
      parentPageId: pageId,
      childPageId: childId,
      replyAuthorName,
      replyTs,
      replyText,
      title: `Thread: ${replyText.slice(0, 80)}`,
    });
    appendFileSync(this.filePath, line + "\n", "utf8");
    this.logger.info("Thread child created (local)", { parentPageId: pageId, childPageId: childId });
  }
}
