/**
 * Close-the-loop Slack replies (DS-59 v1).
 *
 * For every captured feedback item whose status has moved to Done, Backlog, or
 * Won't Fix, post a single threaded reply to the original Slack message so the
 * person who flagged it knows what happened.
 *
 * State is tracked in CLOSE_LOOP_STORE_PATH (default ./data/close-loop-sent.json).
 * If Heroku restarts clear that file, the worst outcome is a duplicate reply —
 * which is harmless since the message is polite and informative.
 *
 * Run on demand:  npm run close-loop
 */
import "dotenv/config";
import fs from "fs";
import { Client } from "@notionhq/client";
import { WebClient } from "@slack/web-api";

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const STORE_PATH = (process.env.CLOSE_LOOP_STORE_PATH ?? "./data/close-loop-sent.json").trim();

if (!NOTION_API_KEY || !NOTION_DATABASE_ID) throw new Error("NOTION_API_KEY and NOTION_DATABASE_ID required.");
if (!SLACK_BOT_TOKEN) throw new Error("SLACK_BOT_TOKEN required.");

const notion = new Client({ auth: NOTION_API_KEY, notionVersion: "2022-06-28" });
const slack = new WebClient(SLACK_BOT_TOKEN);

// --- State store -------------------------------------------------------

function loadSent(): Set<string> {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function saveSent(sent: Set<string>): void {
  fs.mkdirSync(STORE_PATH.replace(/\/[^/]+$/, ""), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify([...sent], null, 2));
}

// --- Notion reader -----------------------------------------------------

interface ActionedItem {
  pageId: string;
  title: string;
  status: string;
  messageUrl: string;
}

const ACTIONED_STATUSES = ["Actioned"];

async function readActionedItems(): Promise<ActionedItem[]> {
  const items: ActionedItem[] = [];
  let cursor: string | undefined;

  do {
    const res: any = await notion.databases.query({
      database_id: NOTION_DATABASE_ID!,
      filter: {
        and: [
          {
            or: ACTIONED_STATUSES.map((s) => ({
              property: "Status",
              select: { equals: s },
            })),
          },
          { property: "Message URL", url: { is_not_empty: true } },
        ],
      },
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of res.results) {
      const props = page.properties;
      const messageUrl: string = props["Message URL"]?.url ?? "";
      if (!messageUrl) continue;

      const titleText =
        (props["Title"]?.rich_text?.[0]?.plain_text ?? "").trim() ||
        (props["Message"]?.title?.[0]?.plain_text ?? "").slice(0, 80).trim();

      items.push({
        pageId: page.id as string,
        title: titleText || "(untitled)",
        status: props["Status"]?.select?.name ?? "",
        messageUrl,
      });
    }

    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  return items;
}

// --- Slack URL parser --------------------------------------------------

function parseSlackUrl(url: string): { channelId: string; threadTs: string } | null {
  // https://workspace.slack.com/archives/C1234567/p1234567890123456
  const match = url.match(/\/archives\/([A-Z0-9]+)\/p(\d+)/);
  if (!match) return null;
  const channelId = match[1]!;
  const raw = match[2]!;
  // Insert decimal: last 6 digits are microseconds
  const threadTs = `${raw.slice(0, -6)}.${raw.slice(-6)}`;
  return { channelId, threadTs };
}

// --- Reply templates --------------------------------------------------

function replyText(status: string, title: string): string {
  const excerpt = title.length > 60 ? title.slice(0, 57) + "…" : title;
  switch (status) {
    case "Actioned":
      return `✅ *Feedback update on "${excerpt}":* This has been actioned by the product team — thanks for flagging it!`;
    default:
      return `ℹ️ *Feedback update on "${excerpt}":* Status is now "${status}".`;
  }
}

// --- Main -------------------------------------------------------------

const sent = loadSent();
const items = await readActionedItems();

console.log(`${items.length} actioned items found. ${sent.size} already replied to.`);

let posted = 0;
let skipped = 0;
let failed = 0;

for (const item of items) {
  if (sent.has(item.pageId)) {
    skipped++;
    continue;
  }

  const parsed = parseSlackUrl(item.messageUrl);
  if (!parsed) {
    console.warn(`  SKIP (unparseable URL): ${item.title} — ${item.messageUrl}`);
    skipped++;
    continue;
  }

  try {
    await slack.chat.postMessage({
      channel: parsed.channelId,
      thread_ts: parsed.threadTs,
      text: replyText(item.status, item.title),
    });
    sent.add(item.pageId);
    posted++;
    console.log(`  ✅ replied: [${item.status}] ${item.title}`);
  } catch (err: any) {
    failed++;
    console.error(`  ❌ failed: ${item.title} — ${err.message}`);
  }
}

saveSent(sent);
console.log(`\nDone. Posted: ${posted} | Already sent: ${skipped} | Failed: ${failed}`);
