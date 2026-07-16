import type { SlackGateway, NotionWriter, DedupStore, ThreadRouter, ImageAttachment } from "./ports.js";
import type { CaptureRequest } from "./events.js";
import type { CaptureResult, CaptureDeps } from "./handleCapture.js";
import type { Logger } from "../util/logger.js";

export interface ThreadReplyDeps {
  slack: SlackGateway;
  notion: NotionWriter;
  dedup: DedupStore;
  logger: Logger;
  threadRouter: ThreadRouter;
  /**
   * Fully-wired handleCapture from index.ts — used when the parent message has not yet
   * been captured (missing-parent recovery, risk R2). Must be the complete wired closure,
   * not a partial import.
   */
  handleCapture: (req: CaptureRequest, deps: CaptureDeps) => Promise<CaptureResult>;
  /** The complete CaptureDeps to pass to the handleCapture callback. */
  captureDeps?: CaptureDeps;
}

/**
 * Handles a Slack thread reply to a previously captured message.
 * - Looks up the parent's Notion row(s) via DedupStore.
 * - If the parent is not yet captured, triggers handleCapture first (missing-parent recovery).
 * - Downloads any images attached to the reply.
 * - Routes the reply text + images to the most relevant row(s) via ThreadRouter.
 * - Appends a timestamped thread log block to each matched row.
 * Fail-open throughout — any individual failure is logged and swallowed.
 */
export async function handleThreadReply(
  channelId: string,
  threadTs: string,
  replyTs: string,
  replyUserId: string,
  replyText: string,
  replyImageUrls: string[],
  deps: ThreadReplyDeps,
): Promise<void> {
  const { slack, notion, dedup, logger, threadRouter } = deps;
  const parentKey = `${channelId}:${threadTs}`;

  // Missing-parent recovery: if the parent was never captured, capture it now
  if (!dedup.has(parentKey) && deps.captureDeps) {
    logger.info("Thread reply: parent not captured — capturing parent first", { parentKey });
    try {
      const captureReq: CaptureRequest = {
        triggerType: "mega_reaction",
        channelId,
        messageTs: threadTs,
        triggeredBy: replyUserId,
        initialStatus: "New",
      };
      await deps.handleCapture(captureReq, deps.captureDeps);
    } catch (err) {
      logger.error("Thread reply: parent capture failed", { parentKey, err: String(err) });
    }
  }

  const pageIds = dedup.getPageIds(parentKey);
  if (pageIds.length === 0) {
    logger.warn("Thread reply: parent still absent after capture attempt — reply dropped", { parentKey });
    return;
  }

  // Download reply images (fail-open per image)
  const replyImages: ImageAttachment[] = [];
  for (const url of replyImageUrls) {
    try {
      const img = await slack.downloadImage(url);
      if (img) replyImages.push(img);
    } catch (err) {
      logger.warn("Thread reply: image download failed", { url, err: String(err) });
    }
  }

  // Fetch candidate summaries for routing
  const candidates = await notion.getPageSummaries(pageIds).catch((err) => {
    logger.warn("Thread reply: getPageSummaries failed — routing to all rows", { parentKey, err: String(err) });
    return pageIds.map((pageId) => ({ pageId, summary: "" }));
  });

  // Route reply to relevant rows
  const routes = await threadRouter
    .route(replyText, replyImages, candidates)
    .catch((err) => {
      logger.warn("Thread reply: routing failed — no updates written", { parentKey, err: String(err) });
      return [];
    });

  if (routes.length === 0) {
    logger.info("Thread reply: no routes matched — reply not logged to any row", { parentKey });
    return;
  }

  // Resolve author name once
  const replyAuthorName = await slack.resolveUserName(replyUserId).catch(() => replyUserId);

  // Update each matched row (fail-open per row)
  for (const route of routes) {
    await notion
      .updateSummaryAndLog(route.pageId, replyText, replyAuthorName, replyTs, replyImages.length ? replyImages : undefined)
      .catch((err) => {
        logger.warn("Thread reply: updateSummaryAndLog failed (fail-open)", {
          pageId: route.pageId,
          err: String(err),
        });
      });
  }

  logger.info("Thread reply logged", {
    parentKey,
    routedTo: routes.map((r) => r.pageId),
  });
}
