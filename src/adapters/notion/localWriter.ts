import { dirname } from "node:path";
import { mkdirSync, appendFileSync } from "node:fs";
import type { NotionWriter, FeedbackRecord } from "../../core/ports.js";
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
}
