import "dotenv/config";

export type CaptureSink = "notion" | "file";

export interface Config {
  slackBotToken: string;
  slackSigningSecret: string;
  captureSink: CaptureSink;
  notionApiKey?: string;
  notionDatabaseId?: string;
  capturesFilePath: string;
  triggerEmoji: string;
  dedupStorePath: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  /** Model name for the enricher stage. Provider detected from prefix (claude-* / gpt-*). */
  enricherModel: string;
  /** Model name for the judge stage. Provider detected from prefix (claude-* / gpt-*). */
  judgeModel: string;
  /** Model name for the gate stage. Provider detected from prefix (claude-* / gpt-*). */
  gateModel: string;
  /** Model for the thread router. Defaults to the enricher model. */
  threadRouterModel: string;
  /** Channels where screenshots may be sent to Claude vision. Empty = disabled everywhere (fail closed). */
  visionEnabledChannelIds: string[];
  /** How far back to look for a possible duplicate when checking for related feedback. */
  similarityWindowDays: number;
  /** Notion page (shared with the integration) under which the Backfill Review DB is created. */
  backfillReviewParentPageId?: string;
  /** Slack user id credited as "Flagged By" on backfilled captures (defaults to bot). */
  backfillFlaggedByUserId?: string;
  /** Slack channel IDs the backfill scan reads history from (comma-separated in env). */
  backfillChannelIds: string[];
  /** How many weeks of history the backfill scan reads back. */
  backfillWeeksBack: number;
  /** Path to the enricher's distilled style guide, appended to its system prompt at startup. */
  enrichmentStyleGuidePath: string;
  /** Path to the similarity detector's distilled rules guide, appended to its system prompt. */
  similarityRulesPath: string;
  /** Granola folder ID to poll for meeting notes (DS-73). */
  granolaFolderId: string;
  /** How often to poll the Granola folder, in milliseconds. Default: 300_000 (5 min). */
  granolaPollIntervalMs: number;
  /**
   * Slack channel IDs to auto-capture from using the live gate (comma-separated in env).
   * Empty = feature disabled. Messages in these channels are run through the gate and
   * captured automatically — no emoji reaction needed.
   */
  autoCaptureChannelIds: string[];
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
    slackSigningSecret: required("SLACK_SIGNING_SECRET"),
    captureSink,
    notionApiKey: optional("NOTION_API_KEY"),
    notionDatabaseId: optional("NOTION_DATABASE_ID"),
    capturesFilePath: (process.env.CAPTURES_FILE_PATH ?? "./data/captures.jsonl").trim(),
    triggerEmoji: (process.env.TRIGGER_EMOJI ?? "mega").trim(),
    dedupStorePath: (process.env.DEDUP_STORE_PATH ?? "./data/dedup.json").trim(),
    anthropicApiKey: optional("ANTHROPIC_API_KEY"),
    openaiApiKey: optional("OPENAI_API_KEY"),
    enricherModel: (process.env.ENRICHER_MODEL ?? "claude-sonnet-4-6").trim(),
    judgeModel: (process.env.JUDGE_MODEL ?? "claude-sonnet-4-6").trim(),
    gateModel: (process.env.GATE_MODEL ?? "claude-haiku-4-5-20251001").trim(),
    threadRouterModel: (process.env.THREAD_ROUTER_MODEL ?? process.env.ENRICHER_MODEL ?? "claude-sonnet-4-6").trim(),
    visionEnabledChannelIds: (process.env.VISION_ENABLED_CHANNEL_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    similarityWindowDays: Number(process.env.SIMILARITY_WINDOW_DAYS ?? "30"),
    backfillReviewParentPageId: optional("BACKFILL_REVIEW_PARENT_PAGE_ID"),
    backfillFlaggedByUserId: optional("BACKFILL_FLAGGED_BY_USER_ID"),
    backfillChannelIds: (process.env.BACKFILL_CHANNEL_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    backfillWeeksBack: Number(process.env.BACKFILL_WEEKS_BACK ?? "8"),
    enrichmentStyleGuidePath: (process.env.ENRICHMENT_STYLE_GUIDE_PATH ?? "./docs/enrichment-style-guide.md").trim(),
    similarityRulesPath: (process.env.SIMILARITY_RULES_PATH ?? "./docs/similarity-rules.md").trim(),
    granolaFolderId: (process.env.GRANOLA_FOLDER_ID ?? "0ddcb9b2-4d60-4774-842f-1d7bcd7897ea").trim(),
    granolaPollIntervalMs: Number(process.env.GRANOLA_POLL_INTERVAL_MS ?? "300000"),
    autoCaptureChannelIds: (process.env.AUTO_CAPTURE_CHANNEL_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
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
