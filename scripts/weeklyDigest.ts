/**
 * On-demand weekly digest: reads the last N days of feedback from Notion, builds a themed
 * Slack digest with Claude, and posts it to the configured channel.
 *
 * Run manually:  npm run digest
 * Scheduled:     started automatically by src/index.ts every Monday 09:00 UTC
 *                when DIGEST_SLACK_CHANNEL_ID is set.
 */
import "dotenv/config";
import { WebClient } from "@slack/web-api";
import { NotionFeedbackReader } from "../src/adapters/notion/notionFeedbackReader.js";
import { ClaudeDigestBuilder } from "../src/adapters/digest/claudeDigestBuilder.js";
import { NotionDigestWriter } from "../src/adapters/digest/notionDigestWriter.js";

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const NOTION_DIGEST_PAGE_ID = process.env.NOTION_DIGEST_PAGE_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const DIGEST_SLACK_CHANNEL_ID = process.env.DIGEST_SLACK_CHANNEL_ID;
const DIGEST_MODEL = (process.env.DIGEST_MODEL ?? "claude-haiku-4-5-20251001").trim();
const DAYS_BEFORE = Number(process.env.DIGEST_DAYS_BEFORE ?? "7");

if (!NOTION_API_KEY || !NOTION_DATABASE_ID) throw new Error("NOTION_API_KEY and NOTION_DATABASE_ID required.");
if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY required.");
if (!SLACK_BOT_TOKEN) throw new Error("SLACK_BOT_TOKEN required.");
if (!DIGEST_SLACK_CHANNEL_ID) throw new Error("DIGEST_SLACK_CHANNEL_ID required. Set it in .env to the channel you want the digest posted to.");

const reader = new NotionFeedbackReader(NOTION_API_KEY, NOTION_DATABASE_ID);
const builder = new ClaudeDigestBuilder(ANTHROPIC_API_KEY, DIGEST_MODEL);
const slack = new WebClient(SLACK_BOT_TOKEN);

const d = new Date();
const weekLabel = `w/c ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;

console.log(`Reading feedback from the last ${DAYS_BEFORE} days…`);
const items = await reader.readRecentFeedback(DAYS_BEFORE);
console.log(`${items.length} items found. Building digest with ${DIGEST_MODEL}…`);

const text = await builder.buildDigest(items, weekLabel);

console.log("\n--- DIGEST PREVIEW ---");
console.log(text);
console.log("--- END PREVIEW ---\n");

await slack.chat.postMessage({ channel: DIGEST_SLACK_CHANNEL_ID, text });
console.log(`Posted to #${DIGEST_SLACK_CHANNEL_ID}`);

const notionWriter = new NotionDigestWriter(NOTION_API_KEY, NOTION_DIGEST_PAGE_ID);
const pageUrl = await notionWriter.writeDigest(text, weekLabel);
console.log(`Notion digest page: ${pageUrl}`);
