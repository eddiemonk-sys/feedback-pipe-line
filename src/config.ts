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
