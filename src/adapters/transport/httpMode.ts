import pkg from "@slack/bolt";
import type { CaptureRequest } from "../../core/events.js";
import type { Logger } from "../../util/logger.js";

const { App } = pkg;

export interface HttpModeOptions {
  botToken: string;
  signingSecret: string;
  /** Emoji name (no colons) that triggers a capture, e.g. "mega". */
  triggerEmoji: string;
  /** Called for each non-bot thread reply in a channel the bot is in. */
  onThreadReply?: (
    channelId: string,
    threadTs: string,
    replyTs: string,
    replyUserId: string,
    replyText: string,
    replyImageUrls: string[],
  ) => Promise<void>;
  /** Called for each non-bot top-level message — used for live-gate auto-capture. */
  onChannelMessage?: (
    channelId: string,
    messageTs: string,
    authorUserId: string,
    text: string,
    imageUrls: string[],
  ) => Promise<void>;
  /** Bot's own user ID — used to filter out the bot's own ack replies (R6 loop prevention). */
  botUserId?: string;
}

/**
 * Transport adapter (HTTP / Webhooks mode).
 *
 * Bolt handles Slack's URL-verification challenge automatically.
 * Heroku sets PORT at runtime; the dyno type must be "web" in the Procfile.
 *
 * Identical event logic to socketMode.ts — only the Bolt initialisation and
 * app.start() call differ. Switching back to Socket Mode = swap the import in index.ts.
 */
export async function startHttpMode(
  options: HttpModeOptions,
  onCapture: (req: CaptureRequest) => Promise<void>,
  logger: Logger,
): Promise<void> {
  const app = new App({
    token: options.botToken,
    signingSecret: options.signingSecret,
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

  // Single message handler — split top-level messages from thread replies.
  if (options.onThreadReply || options.onChannelMessage) {
    app.event("message", async ({ event }: any) => {
      if (event.bot_id) return;
      if (options.botUserId && event.user === options.botUserId) return;
      if (!event.text && !event.files?.length) return;

      const imageUrls: string[] = (event.files ?? [])
        .filter((f: any) => f.mimetype?.startsWith("image/"))
        .map((f: any) => f.url_private as string)
        .filter(Boolean);

      const isThreadReply = event.thread_ts && event.thread_ts !== event.ts;

      if (isThreadReply) {
        if (!options.onThreadReply) return;
        try {
          await options.onThreadReply(
            event.channel,
            event.thread_ts,
            event.ts,
            event.user ?? "",
            event.text ?? "",
            imageUrls,
          );
        } catch (err) {
          logger.error("onThreadReply threw", { err: String(err) });
        }
      } else {
        if (!options.onChannelMessage) return;
        try {
          await options.onChannelMessage(
            event.channel,
            event.ts,
            event.user ?? "",
            event.text ?? "",
            imageUrls,
          );
        } catch (err) {
          logger.error("onChannelMessage threw", { err: String(err) });
        }
      }
    });
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.start(port);
  logger.info(
    `⚡ HTTP mode listening on port ${port} — :${options.triggerEmoji}: reactions + @mention triggers active`,
  );
}
