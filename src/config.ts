import "dotenv/config";

export type CaptureSink = "notion" | "file";

export interface Config {
  slackBotToken: string;
  slackAppToken: string;
  captureSink: CaptureSink;
  notionApiKey?: string;
  notionDatabaseId?: string;
  capturesFilePath: string;
  triggerEmoji: string;
  dedupStorePath: string;
  anthropicApiKey?: string;
  /** Channels where screenshots may be sent to Claude vision. Empty = disabled everywhere (fail closed). */
  visionEnabledChannelIds: string[];
  /** How far back to look for a possible duplicate when checking for related feedback. */
  similarityWindowDays: number;
  /** Notion page (shared with the integration) under which the Backfill Review DB is created. */
  backfillReviewParentPageId?: string;
  /** Slack user id credited as "Flagged By" on backfilled captures (defaults to bot). */
  backfillFlaggedByUserId?: string;
  /** Path to the enricher's distilled style guide, appended to its system prompt at startup. */
  enrichmentStyleGuidePath: string;
  /** Path to the similarity detector's distilled rules guide, appended to its system prompt. */
  similarityRulesPath: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}. See .env.example.`);
  }
  return value.trim();
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

export function loadConfig(): Config {
  const captureSink: CaptureSink =
    (process.env.CAPTURE_SINK ?? "notion").trim() === "file" ? "file" : "notion";

  const config: Config = {
    slackBotToken: required("SLACK_BOT_TOKEN"),
    slackAppToken: required("SLACK_APP_TOKEN"),
    captureSink,
    notionApiKey: optional("NOTION_API_KEY"),
    notionDatabaseId: optional("NOTION_DATABASE_ID"),
    capturesFilePath: (process.env.CAPTURES_FILE_PATH ?? "./data/captures.jsonl").trim(),
    triggerEmoji: (process.env.TRIGGER_EMOJI ?? "mega").trim(),
    dedupStorePath: (process.env.DEDUP_STORE_PATH ?? "./data/dedup.json").trim(),
    anthropicApiKey: optional("ANTHROPIC_API_KEY"),
    visionEnabledChannelIds: (process.env.VISION_ENABLED_CHANNEL_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    similarityWindowDays: Number(process.env.SIMILARITY_WINDOW_DAYS ?? "30"),
    backfillReviewParentPageId: optional("BACKFILL_REVIEW_PARENT_PAGE_ID"),
    backfillFlaggedByUserId: optional("BACKFILL_FLAGGED_BY_USER_ID"),
    enrichmentStyleGuidePath: (process.env.ENRICHMENT_STYLE_GUIDE_PATH ?? "./docs/enrichment-style-guide.md").trim(),
    similarityRulesPath: (process.env.SIMILARITY_RULES_PATH ?? "./docs/similarity-rules.md").trim(),
  };

  // Notion creds are only needed when actually writing to Notion.
  if (captureSink === "notion") {
    if (!config.notionApiKey) {
      throw new Error("CAPTURE_SINK=notion requires NOTION_API_KEY. See .env.example.");
    }
    if (!config.notionDatabaseId) {
      throw new Error("CAPTURE_SINK=notion requires NOTION_DATABASE_ID. See .env.example.");
    }
  }

  return config;
}
