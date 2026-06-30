import "dotenv/config";
import { Client } from "@notionhq/client";

/**
 * One-off helper: recreates the "Customer Feedback" database schema in a workspace you
 * control (used when the production Notion workspace blocks member-created API tokens).
 *
 * Usage:  tsx scripts/createTestDb.ts <parent-page-URL-or-ID>
 * The parent page must be shared with the integration whose token is in NOTION_API_KEY.
 */

function extractPageId(input: string): string {
  const clean = input.replace(/-/g, "");
  const matches = clean.match(/[0-9a-fA-F]{32}/g);
  return matches ? matches[matches.length - 1] : input.trim();
}

async function main(): Promise<void> {
  const token = process.env.NOTION_API_KEY;
  const parentInput = process.argv[2] ?? process.env.SETUP_PARENT_PAGE_ID;
  if (!token) throw new Error("NOTION_API_KEY missing in .env");
  if (!parentInput) {
    throw new Error("Pass the parent page URL or ID, e.g.: tsx scripts/createTestDb.ts <pageUrlOrId>");
  }

  const pageId = extractPageId(parentInput);
  const notion = new Client({ auth: token, notionVersion: "2022-06-28" });

  const res = await notion.databases.create({
    parent: { type: "page_id", page_id: pageId },
    title: [{ type: "text", text: { content: "Customer Feedback" } }],
    properties: {
      Message: { title: {} },
      Channel: { rich_text: {} },
      Author: { rich_text: {} },
      Date: { date: {} },
      "Flagged By": { rich_text: {} },
      Status: {
        select: {
          options: [
            { name: "New", color: "blue" },
            { name: "Reviewed", color: "yellow" },
            { name: "Actioned", color: "green" },
          ],
        },
      },
      Source: { rich_text: {} },
      "Message URL": { url: {} },
    },
  });

  console.log("\n✅ Created 'Customer Feedback' database.");
  console.log("NOTION_DATABASE_ID=" + res.id);
}

main().catch((err) => {
  console.error("Setup failed:", err?.body ?? err);
  process.exit(1);
});
