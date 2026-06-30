import type { CaptureRequest } from "./events.js";
import type { SlackGateway, NotionWriter, DedupStore } from "./ports.js";
import type { Logger } from "../util/logger.js";

export type CaptureStatus = "captured" | "flagger_added" | "duplicate" | "no_message" | "error";

export interface CaptureResult {
  status: CaptureStatus;
  key: string;
  detail?: string;
}

export interface CaptureDeps {
  slack: SlackGateway;
  notion: NotionWriter;
  dedup: DedupStore;
  logger: Logger;
  /** Always "Slack" for now; kept here so the value isn't hard-coded inside the logic. */
  source: string;
  /** Bot's own Slack user ID. When set, stripped from captured text on @mention triggers. */
  botUserId?: string;
}

/**
 * Stable per-message dedup key. Independent of permalink formatting differences.
 */
export function dedupKey(req: CaptureRequest): string {
  return `${req.channelId}:${req.messageTs}`;
}

/**
 * Core business logic. Transport-agnostic: it receives a normalized CaptureRequest and
 * knows nothing about Socket Mode, webhooks, or raw Slack event payloads.
 *
 * Returns a CaptureResult the caller maps to an acknowledgment. Records the dedup key
 * ONLY after a successful Notion write — so a transient Notion failure can be retried
 * (by re-reacting) rather than silently swallowing the feedback forever.
 *
 * When the same message is flagged again (dedup hit), appends the new flagger to the
 * existing Notion row instead of rejecting. Falls back to "duplicate" for legacy entries
 * that predate page-ID storage.
 */
export async function handleCapture(
  req: CaptureRequest,
  deps: CaptureDeps,
): Promise<CaptureResult> {
  const { slack, notion, dedup, logger, source, botUserId } = deps;
  const key = dedupKey(req);

  if (dedup.has(key)) {
    const pageId = dedup.getPageId(key);
    if (!pageId) {
      logger.info("Skipping duplicate (no stored page ID)", { key });
      return { status: "duplicate", key };
    }
    try {
      const flaggedByName = await slack.resolveUserName(req.triggeredBy);
      await notion.appendFlagger(pageId, flaggedByName);
      logger.info("Appended flagger to existing feedback", { key, flaggedByName });
      return { status: "flagger_added", key };
    } catch (err) {
      logger.error("Failed to append flagger", { key, err: String(err) });
      return { status: "error", key, detail: "notion.appendFlagger failed" };
    }
  }

  let message;
  try {
    message = await slack.getMessage(req.channelId, req.messageTs);
  } catch (err) {
    logger.error("Failed to fetch Slack message", { key, err: String(err) });
    return { status: "error", key, detail: "slack.getMessage failed" };
  }

  if (!message) {
    logger.warn("Message not found (deleted, or unsupported thread reply)", { key });
    return { status: "no_message", key };
  }

  try {
    const [authorName, flaggedByName, channelName, messageUrl] = await Promise.all([
      slack.resolveUserName(message.authorUserId),
      slack.resolveUserName(req.triggeredBy),
      slack.resolveChannelName(req.channelId),
      slack.getPermalink(req.channelId, req.messageTs),
    ]);

    let text = message.text.trim() || "(no text — attachment or file)";
    if (req.triggerType === "mention" && botUserId) {
      text = text.replace(new RegExp(`<@${botUserId}>\\s*`, "g"), "").trim() ||
        "(no text — attachment or file)";
    }

    const dateIso = new Date(Number(req.messageTs) * 1000).toISOString().slice(0, 10);

    const pageId = await notion.createFeedback({
      message: text,
      channelName,
      authorName,
      dateIso,
      flaggedByName,
      source,
      messageUrl,
      customerAccount: "",
    });

    dedup.record(key, pageId);
    logger.info("Captured feedback", { key, channelName, authorName, flaggedByName });
    return { status: "captured", key };
  } catch (err) {
    logger.error("Failed to write feedback to Notion", { key, err: String(err) });
    return { status: "error", key, detail: "notion.createFeedback failed" };
  }
}
