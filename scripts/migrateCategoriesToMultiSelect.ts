import "dotenv/config";
import { Client } from "@notionhq/client";
import { loadConfig } from "../src/config.js";

async function main() {
  const config = loadConfig();
  if (!config.notionApiKey || !config.notionDatabaseId) throw new Error("NOTION_API_KEY and NOTION_DATABASE_ID required.");

  const client = new Client({ auth: config.notionApiKey, notionVersion: "2022-06-28" });

  let cursor: string | undefined;
  let migrated = 0;
  let skipped = 0;

  console.log("Starting migration: Category (select) → Categories (multi-select)...");

  do {
    const res: any = await client.databases.query({
      database_id: config.notionDatabaseId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of res.results) {
      const props = page.properties as Record<string, any>;
      const singleCategory: string | undefined = props["Category"]?.select?.name;
      const multiCategories: any[] = props["Categories"]?.multi_select ?? [];

      // Skip if already migrated
      if (multiCategories.length > 0) { skipped++; continue; }
      if (!singleCategory) { skipped++; continue; }

      await client.pages.update({
        page_id: page.id,
        properties: {
          Categories: { multi_select: [{ name: singleCategory }] },
        },
      });

      migrated++;
      if (migrated % 20 === 0) console.log(`  Migrated ${migrated} rows...`);

      // Rate limit: Notion allows ~3 req/s
      await new Promise((r) => setTimeout(r, 350));
    }

    cursor = res.next_cursor ?? undefined;
  } while (cursor);

  // Now migrate "AI Suggested Category" → "AI Suggested Categories"
  console.log("\nMigrating AI Suggested Category...");
  cursor = undefined;
  let aiMigrated = 0;

  do {
    const res: any = await client.databases.query({
      database_id: config.notionDatabaseId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of res.results) {
      const props = page.properties as Record<string, any>;
      const singleAI: string | undefined = props["AI Suggested Category"]?.select?.name;
      const multiAI: any[] = props["AI Suggested Categories"]?.multi_select ?? [];

      if (multiAI.length > 0 || !singleAI) continue;

      await client.pages.update({
        page_id: page.id,
        properties: {
          "AI Suggested Categories": { multi_select: [{ name: singleAI }] },
        },
      });

      aiMigrated++;
      if (aiMigrated % 20 === 0) console.log(`  Migrated ${aiMigrated} AI rows...`);
      await new Promise((r) => setTimeout(r, 350));
    }

    cursor = res.next_cursor ?? undefined;
  } while (cursor);

  console.log(`\nDone. ${migrated} rows migrated (Category), ${aiMigrated} rows migrated (AI Suggested), ${skipped} skipped.`);
}

main().catch((err) => { console.error("Migration failed:", err?.body ?? err); process.exit(1); });
