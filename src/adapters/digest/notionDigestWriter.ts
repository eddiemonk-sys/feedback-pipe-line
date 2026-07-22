import { Client } from "@notionhq/client";
import type { DigestNotionWriter } from "../../core/digest.js";

const FEEDBACK_ANALYTICS_PAGE_ID = "59c89b9adf5f4283a122a1bc65c2112c";

function heading1(text: string) {
  return { object: "block" as const, type: "heading_1" as const, heading_1: { rich_text: [{ text: { content: text } }] } };
}
function heading2(text: string) {
  return { object: "block" as const, type: "heading_2" as const, heading_2: { rich_text: [{ text: { content: text } }] } };
}
function paragraph(text: string) {
  return { object: "block" as const, type: "paragraph" as const, paragraph: { rich_text: [{ text: { content: text.slice(0, 2000) } }] } };
}
function divider() {
  return { object: "block" as const, type: "divider" as const, divider: {} };
}

export class NotionDigestWriter implements DigestNotionWriter {
  private client: Client;
  private existingPageId?: string;

  constructor(apiKey: string, existingPageId?: string) {
    this.client = new Client({ auth: apiKey, notionVersion: "2022-06-28" });
    this.existingPageId = existingPageId;
  }

  async writeDigest(digestText: string, weekLabel: string): Promise<string> {
    const blocks = buildBlocks(digestText, weekLabel);

    if (this.existingPageId) {
      const existing: any = await this.client.blocks.children.list({ block_id: this.existingPageId, page_size: 100 });
      for (const block of existing.results) {
        await this.client.blocks.delete({ block_id: block.id });
      }
      await this.client.blocks.children.append({ block_id: this.existingPageId, children: blocks });
      return `https://notion.so/${this.existingPageId.replace(/-/g, "")}`;
    }

    const page: any = await this.client.pages.create({
      parent: { page_id: FEEDBACK_ANALYTICS_PAGE_ID },
      properties: { title: { title: [{ text: { content: `Weekly Digest — ${weekLabel}` } }] } },
      children: blocks,
    });
    console.log(`Notion digest page created: ${page.id}`);
    console.log(`Set NOTION_DIGEST_PAGE_ID=${page.id} in .env / Heroku config vars to update in place next time.`);
    return page.url as string;
  }
}

function buildBlocks(digestText: string, weekLabel: string) {
  const blocks: ReturnType<typeof paragraph | typeof heading1 | typeof heading2 | typeof divider>[] = [
    heading1(`Weekly Feedback Digest — ${weekLabel}`),
    divider(),
  ];

  for (const rawLine of digestText.split("\n")) {
    const line = rawLine
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/^[•·]\s*/, "")
      .trim();
    if (!line) continue;

    if (line.startsWith("📋") || line.startsWith("📊")) {
      blocks.push(heading2(line));
    } else if (line.startsWith("🔥") || line.startsWith("🔄")) {
      blocks.push(heading2(line));
    } else {
      blocks.push(paragraph(line));
    }
  }

  return blocks;
}
