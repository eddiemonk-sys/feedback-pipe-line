import "dotenv/config";
import { Client } from "@notionhq/client";
import { CATEGORIES } from "../src/core/taxonomy.js";

// Same option colours as the existing "Category" select (see live schema).
const COLORS: Record<string, string> = {
  "Bug / Broken": "red",
  "Feature Request": "blue",
  "Pricing / Commercial": "yellow",
  "Onboarding / Setup": "orange",
  "UX / Usability": "purple",
  "Reporting / Data": "green",
  "Praise": "pink",
  "Other": "gray",
  "Candidate Experience": "brown",
  "Assessment Accuracy/Validity": "default",
};

async function main() {
  const token = process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!token) throw new Error("NOTION_API_KEY missing in .env");
  if (!databaseId) throw new Error("NOTION_DATABASE_ID missing in .env");
  const notion = new Client({ auth: token, notionVersion: "2022-06-28" });

  await notion.databases.update({
    database_id: databaseId,
    properties: {
      "AI Suggested Category": {
        select: { options: CATEGORIES.map((name) => ({ name, color: COLORS[name] ?? "default" })) },
      },
    },
  });
  console.log("✅ Added 'AI Suggested Category' select property with 10 taxonomy options.");
}

main().catch((err) => { console.error("Failed:", err?.body ?? err); process.exit(1); });
