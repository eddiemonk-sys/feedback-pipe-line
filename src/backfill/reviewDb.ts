// src/backfill/reviewDb.ts
import { Client } from "@notionhq/client";
import type { ConfidenceLevel, FeedbackCategory } from "../core/ports.js";
import { CATEGORIES } from "../core/taxonomy.js";
import type { ReviewDecision } from "./decisions.js";

const MAX_TEXT = 2000;
const CATEGORY_OPTIONS = CATEGORIES.map((name) => ({ name }));
const CONFIDENCE_OPTIONS = [{ name: "High" }, { name: "Medium" }, { name: "Low" }];

export interface ReviewRowInput {
  channelId: string;
  messageTs: string;
  message: string;
  authorName: string;
  dateIso: string;
  slackUrl: string;
  proposedCategory?: FeedbackCategory;
  proposedSummary?: string;
  visualDescription?: string;
  gateConfidence?: ConfidenceLevel;
  gateRationale?: string;
  /** Notion file-upload id from a successful image upload; omitted => link-only. */
  imageUploadId?: string;
}

function clamp(s: string): string { return s.slice(0, MAX_TEXT); }
function isCategory(v: unknown): v is FeedbackCategory { return CATEGORIES.includes(v as FeedbackCategory); }

export class BackfillReviewDb {
  private client: Client;
  constructor(apiKey: string) {
    this.client = new Client({ auth: apiKey, notionVersion: "2022-06-28" });
  }

  async createDatabase(parentPageId: string): Promise<string> {
    const res = await this.client.databases.create({
      parent: { type: "page_id", page_id: parentPageId },
      title: [{ type: "text", text: { content: "Backfill Review" } }],
      properties: {
        Message: { title: {} },
        Author: { rich_text: {} },
        Date: { date: {} },
        "Slack Link": { url: {} },
        Image: { files: {} },
        "Proposed Category": { multi_select: { options: CATEGORY_OPTIONS } },
        "Proposed Summary": { rich_text: {} },
        "Visual Description": { rich_text: {} },
        "Gate Confidence": { select: { options: CONFIDENCE_OPTIONS } },
        "Gate Rationale": { rich_text: {} },
        // --- human inputs ---
        "Is Feedback?": { checkbox: {} },
        "Classification OK?": { checkbox: {} },
        "Corrected Category": { multi_select: { options: CATEGORY_OPTIONS } },
        "Corrected Summary": { rich_text: {} },
        "Correction Notes": { rich_text: {} },
        // --- machine fields (needed to rebuild the CaptureRequest) ---
        "Channel ID": { rich_text: {} },
        "Message TS": { rich_text: {} },
      },
    });
    return res.id;
  }

  async addCandidate(dbId: string, row: ReviewRowInput): Promise<void> {
    const rt = (s: string) => ({ rich_text: [{ text: { content: clamp(s) } }] });
    await this.client.pages.create({
      parent: { database_id: dbId },
      properties: {
        Message: { title: [{ text: { content: clamp(row.message || "(no text — attachment or file)") } }] },
        Author: rt(row.authorName),
        Date: { date: { start: row.dateIso } },
        "Slack Link": { url: row.slackUrl || null },
        ...(row.imageUploadId
          ? { Image: { files: [{ type: "file_upload", file_upload: { id: row.imageUploadId }, name: "screenshot.png" }] } as any }
          : {}),
        ...(row.proposedCategory ? { "Proposed Category": { multi_select: [{ name: row.proposedCategory }] } } : {}),
        ...(row.proposedSummary ? { "Proposed Summary": rt(row.proposedSummary) } : {}),
        ...(row.visualDescription ? { "Visual Description": rt(row.visualDescription) } : {}),
        ...(row.gateConfidence ? { "Gate Confidence": { select: { name: row.gateConfidence } } } : {}),
        ...(row.gateRationale ? { "Gate Rationale": rt(row.gateRationale) } : {}),
        "Channel ID": rt(row.channelId),
        "Message TS": rt(row.messageTs),
      },
    });
  }

  /** Read all rows the human marked "Is Feedback?" = true, as structured decisions. */
  async readDecisions(dbId: string): Promise<ReviewDecision[]> {
    const decisions: ReviewDecision[] = [];
    let cursor: string | undefined;
    do {
      const res = await this.client.databases.query({
        database_id: dbId,
        filter: { property: "Is Feedback?", checkbox: { equals: true } },
        start_cursor: cursor,
      });
      for (const page of res.results as any[]) {
        const p = page.properties;
        const correctedCat = p["Corrected Category"]?.multi_select?.[0]?.name;
        decisions.push({
          channelId: p["Channel ID"]?.rich_text?.[0]?.plain_text ?? "",
          messageTs: p["Message TS"]?.rich_text?.[0]?.plain_text ?? "",
          isFeedback: true,
          classificationOk: !!p["Classification OK?"]?.checkbox,
          correctedCategory: isCategory(correctedCat) ? correctedCat : undefined,
          correctedSummary: p["Corrected Summary"]?.rich_text?.[0]?.plain_text || undefined,
        });
      }
      cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
    } while (cursor);
    return decisions;
  }

  /** Read EVERY reviewed row (confirmed + rejected) as raw label records for eval. */
  async readAllRows(dbId: string): Promise<Array<Record<string, any>>> {
    const rows: Array<Record<string, any>> = [];
    let cursor: string | undefined;
    do {
      const res = await this.client.databases.query({ database_id: dbId, start_cursor: cursor });
      for (const page of res.results as any[]) {
        const p = page.properties;
        const txt = (k: string) => p[k]?.rich_text?.[0]?.plain_text ?? p[k]?.title?.[0]?.plain_text ?? "";
        rows.push({
          pageId: page.id,
          channelId: txt("Channel ID"),
          messageTs: txt("Message TS"),
          message: txt("Message"),
          gateConfidence: p["Gate Confidence"]?.select?.name ?? null,
          gateRationale: txt("Gate Rationale"),
          proposedCategory: p["Proposed Category"]?.multi_select?.[0]?.name ?? null,
          proposedSummary: txt("Proposed Summary"),
          isFeedback: !!p["Is Feedback?"]?.checkbox,
          classificationOk: !!p["Classification OK?"]?.checkbox,
          correctedCategory: p["Corrected Category"]?.multi_select?.map((o: any) => o.name).join("|") || null,
          correctedSummary: txt("Corrected Summary"),
          correctionNotes: txt("Correction Notes"),
        });
      }
      cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
    } while (cursor);
    return rows;
  }
}
