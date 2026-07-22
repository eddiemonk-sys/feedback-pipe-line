import pkg from "@slack/bolt";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import type { CaptureRequest } from "../../core/events.js";
import type { Logger } from "../../util/logger.js";
import { FeedbackBoardReader, generateFeedbackDataJs } from "../api/feedbackBoardReader.js";

const { App, ExpressReceiver } = pkg;

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
  /** When set, serves the web feedback board at / and injects live Notion data at /feedback-data.js */
  notionApiKey?: string;
  /** Notion database ID for the board reader — required when notionApiKey is set. */
  notionDatabaseId?: string;
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
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".png":  "image/png",
  ".svg":  "image/svg+xml",
  ".json": "application/json",
  ".otf":  "font/otf",
  ".woff2":"font/woff2",
};

export async function startHttpMode(
  options: HttpModeOptions,
  onCapture: (req: CaptureRequest) => Promise<void>,
  logger: Logger,
): Promise<void> {
  const receiver = new ExpressReceiver({ signingSecret: options.signingSecret });

  // --- Web board: serve web/ directory and inject live feedback-data.js ---
  const webDir = join(process.cwd(), "web");
  if (options.notionApiKey && options.notionDatabaseId) {
    const boardReader = new FeedbackBoardReader(options.notionApiKey, options.notionDatabaseId);
    let cache: { js: string; expiresAt: number } | null = null;
    const CACHE_TTL_MS = 60_000;
    receiver.router.get("/feedback-data.js", async (_req: any, res: any) => {
      try {
        const now = Date.now();
        if (!cache || now > cache.expiresAt) {
          const rows = await boardReader.readAllRows();
          cache = { js: generateFeedbackDataJs(rows), expiresAt: now + CACHE_TTL_MS };
          logger.info("Web board: refreshed Notion data cache");
        }
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.send(cache.js);
      } catch (err) {
        logger.error("Board reader failed", { err: String(err) });
        if (cache) {
          res.setHeader("Content-Type", "application/javascript; charset=utf-8");
          res.send(cache.js); // serve stale on error rather than blank board
        } else {
          res.status(500).send("/* Error loading live data — reload to retry */");
        }
      }
    });
    logger.info("Web board: live /feedback-data.js enabled (reads Notion, 60s cache)");
  }

  if (existsSync(webDir)) {
    receiver.router.use((req: any, res: any, next: any) => {
      let urlPath: string = req.path;
      if (urlPath === "/") urlPath = "/index.html";
      const filePath = join(webDir, urlPath.replace(/\.\./g, ""));
      if (!existsSync(filePath) || !statSync(filePath).isFile()) return next();
      const mime = MIME[extname(filePath)] ?? "application/octet-stream";
      res.setHeader("Content-Type", mime);
      res.send(readFileSync(filePath));
    });
    logger.info(`Web board: serving static files from ${webDir}`);
  }

  const app = new App({
    token: options.botToken,
    receiver,
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
