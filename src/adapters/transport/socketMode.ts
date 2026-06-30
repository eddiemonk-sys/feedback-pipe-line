import pkg from "@slack/bolt";
import type { CaptureRequest } from "../../core/events.js";
import type { Logger } from "../../util/logger.js";

const { App } = pkg;

export interface SocketModeOptions {
  botToken: string;
  appToken: string;
  /** Emoji name (no colons) that triggers a capture, e.g. "mega". */
  triggerEmoji: string;
}

/**
 * Transport adapter (Socket Mode).
 *
 * Its ONLY job: receive raw Slack events (`reaction_added`, `app_mention`), normalize
 * each into a CaptureRequest, and invoke `onCapture`. It knows nothing about Notion,
 * dedup, or acknowledgments. Switching to HTTP webhooks later = a sibling file exposing
 * the same `(options, onCapture)` contract; the core and the composition root are unchanged.
 *
 * Channel scope: membership-based — the bot captures in every channel it is invited to.
 * There is no allow-list filter here; access is controlled by which channels have the bot.
 */
export async function startSocketMode(
  options: SocketModeOptions,
  onCapture: (req: CaptureRequest) => Promise<void>,
  logger: Logger,
): Promise<void> {
  const app = new App({
    token: options.botToken,
    appToken: options.appToken,
    socketMode: true,
  });

  app.event("reaction_added", async ({ event }) => {
    if (event.reaction !== options.triggerEmoji) return;
    if (event.item.type !== "message") return;

    const req: CaptureRequest = {
      triggerType: "mega_reaction",
      channelId: event.item.channel,
      messageTs: event.item.ts,
      triggeredBy: event.user,
    };

    try {
      await onCapture(req);
    } catch (err) {
      logger.error("onCapture threw (reaction)", { err: String(err) });
    }
  });

  app.event("app_mention", async ({ event }) => {
    // Thread reply: capture the parent message so the context is richer.
    // Standalone mention: capture the mention itself.
    const isThreadReply = !!event.thread_ts && event.thread_ts !== event.ts;
    const messageTs = isThreadReply ? event.thread_ts! : event.ts;

    const req: CaptureRequest = {
      triggerType: "mention",
      channelId: event.channel,
      messageTs,
      triggeredBy: event.user ?? "",
    };

    try {
      await onCapture(req);
    } catch (err) {
      logger.error("onCapture threw (mention)", { err: String(err) });
    }
  });

  await app.start();
  logger.info(
    `⚡ Socket Mode connected — :${options.triggerEmoji}: reactions + @mention triggers active`,
  );
}
