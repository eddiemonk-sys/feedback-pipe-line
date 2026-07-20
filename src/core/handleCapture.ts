import type { CaptureRequest } from "./events.js";
import type { SlackGateway, NotionWriter, DedupStore, Enricher, Judge, SimilarityDetector, ImageAttachment } from "./ports.js";
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
  enricher: Enricher;
  judge: Judge;
  similarityDetector: SimilarityDetector;
  /** How far back to look for a possible duplicate, in days. */
  similarityWindowDays: number;
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
    const pageIds = dedup.getPageIds(key);
    if (pageIds.length === 0) {
      logger.info("Skipping duplicate (no stored page IDs)", { key });
      return { status: "duplicate", key };
    }
    try {
      const flaggedByName = await slack.resolveUserName(req.triggeredBy);
      // Append flagger to all rows (batch-split messages have multiple page IDs)
      for (const pageId of pageIds) {
        await notion.appendFlagger(pageId, flaggedByName);
      }
      logger.info("Appended flagger to existing feedback", { key, flaggedByName, rowCount: pageIds.length });
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

    // Download all attached images and pass directly to the enricher as multimodal input.
    // Each download failure is logged and skipped (fail-open).
    const images: ImageAttachment[] = [];
    if (message.imageUrls?.length) {
      for (const url of message.imageUrls) {
        const img = await fetchImage(deps, url, logger);
        if (img) images.push(img);
      }
    }

    const enrichments = await deps.enricher.enrich(text, channelName, images.length ? images : undefined).catch((err) => {
      logger.warn("Enrichment failed — capturing without summary/category", { err: String(err) });
      return null;
    });

    const isBatch = enrichments !== null && enrichments.length > 1;

    if (isBatch) {
      // Batch split path: one row per item. No Low-confidence retry (too complex for batch).
      const pageIds: string[] = [];
      for (const enrichment of enrichments!) {
        const verdict = enrichment
          ? await deps.judge
              .review(text, channelName, enrichment.summary, enrichment.categories)
              .catch(() => null)
          : null;

        const relatedMatch = enrichment
          ? await findRelatedFeedback(deps, enrichment.summary, enrichment.categories, logger)
          : null;

        const masterChoice = relatedMatch?.matchedSummary
          ? await deps.similarityDetector.selectMaster(enrichment.summary, relatedMatch.matchedSummary).catch(() => "existing" as const)
          : "existing";
        const newIsChild = masterChoice === "existing";

        const pageId = await notion.createFeedback({
          message: text,
          channelName,
          authorName,
          dateIso,
          flaggedByName,
          source,
          messageUrl,
          customerAccount: enrichment.clientName ?? "",
          summary: enrichment.summary,
          categories: enrichment.categories,
          aiSuggestedCategories: [...enrichment.categories],
          aiSuggestedSummary: enrichment.summary,
          confidence: verdict?.confidence,
          rationale: verdict?.rationale,
          sourceMessageKey: key,
          preambleContext: enrichment.preambleContext,
          mentionedUsers: enrichment.mentionedUsers,
          image: enrichment.imageIndices?.length
            ? images[enrichment.imageIndices[0]]  // use explicitly attributed image
            : undefined,
          relatedFeedbackPageId: newIsChild ? relatedMatch?.matchedPageId : undefined,
          relatedFeedbackRationale: relatedMatch?.rationale,
          status: req.initialStatus,
          title: enrichment.title,
        });
        pageIds.push(pageId);

        if (relatedMatch) {
          const masterPageId = newIsChild ? relatedMatch.matchedPageId : pageId;
          const childPageId = newIsChild ? pageId : relatedMatch.matchedPageId;
          await notion.relinkRelatedFeedback(masterPageId, childPageId).catch((err) => {
            logger.warn("relinkRelatedFeedback failed (fail-open)", { err: String(err) });
          });
        }
      }

      dedup.recordMultiple(key, pageIds);

      // Pass 2: sibling links. Fail-open — link failure must not roll back the capture.
      if (pageIds.length > 1) {
        for (const pageId of pageIds) {
          const siblings = pageIds.filter((id) => id !== pageId);
          await notion.updateSiblingLinks(pageId, siblings).catch((err) => {
            logger.warn("updateSiblingLinks failed (fail-open)", { pageId, err: String(err) });
          });
        }
      }

    } else {
      // Single-item path (non-split). Preserve existing retry logic.
      let enrichment = enrichments?.[0] ?? null;

      let verdict = enrichment
        ? await deps.judge
            .review(text, channelName, enrichment.summary, enrichment.categories)
            .catch((err) => {
              logger.warn("Judging failed — capturing without confidence/rationale", { err: String(err) });
              return null;
            })
        : null;

      if (verdict?.confidence === "Low" && enrichment) {
        const originalVerdict = verdict;
        logger.info("Low confidence — retrying enrichment", {
          key,
          firstCategories: enrichment.categories,
          judgeRationale: verdict.rationale,
        });
        const retryInput = `${text}\n\nNote: a previous classification of this message was rated Low confidence. Reviewer note: "${verdict.rationale}". Reconsider the category — pay particular attention to which category most precisely matches the primary signal.`;
        const retryEnrichments = await deps.enricher.enrich(retryInput, channelName, images.length ? images : undefined).catch((err) => {
          logger.warn("Retry enrichment failed — keeping original result", { err: String(err) });
          return null;
        });
        const retryEnrichment = retryEnrichments?.[0] ?? null;
        if (retryEnrichment) {
          const retryVerdict = await deps.judge
            .review(retryInput, channelName, retryEnrichment.summary, retryEnrichment.categories)
            .catch((err) => {
              logger.warn("Retry judging failed — keeping original verdict", { err: String(err) });
              return null;
            });
          enrichment = retryEnrichment;
          verdict = retryVerdict ?? originalVerdict;
        }
      }

      const relatedMatch = enrichment
        ? await findRelatedFeedback(deps, enrichment.summary, enrichment.categories, logger)
        : null;

      const masterChoice = relatedMatch?.matchedSummary && enrichment
        ? await deps.similarityDetector.selectMaster(enrichment.summary, relatedMatch.matchedSummary).catch(() => "existing" as const)
        : "existing";
      const newIsChild = masterChoice === "existing";

      const pageId = await notion.createFeedback({
        message: text,
        channelName,
        authorName,
        dateIso,
        flaggedByName,
        source,
        messageUrl,
        customerAccount: enrichment?.clientName ?? "",
        summary: enrichment?.summary,
        categories: enrichment?.categories,
        aiSuggestedCategories: enrichment?.categories ? [...enrichment.categories] : undefined,
        aiSuggestedSummary: enrichment?.summary,
        confidence: verdict?.confidence,
        rationale: verdict?.rationale,
        image: images[0],
        relatedFeedbackPageId: newIsChild ? relatedMatch?.matchedPageId : undefined,
        relatedFeedbackRationale: relatedMatch?.rationale,
        status: req.initialStatus,
        title: enrichment?.title,
      });

      if (relatedMatch) {
        const masterPageId = newIsChild ? relatedMatch.matchedPageId : pageId;
        const childPageId = newIsChild ? pageId : relatedMatch.matchedPageId;
        await notion.relinkRelatedFeedback(masterPageId, childPageId).catch((err) => {
          logger.warn("relinkRelatedFeedback failed (fail-open)", { err: String(err) });
        });
      }

      dedup.record(key, pageId);
    }

    logger.info("Captured feedback", { key, channelName, authorName, flaggedByName });
    return { status: "captured", key };
  } catch (err) {
    logger.error("Failed to write feedback to Notion", { key, err: String(err) });
    return { status: "error", key, detail: "notion.createFeedback failed" };
  }
}

/** Checks recent same-category captures for a likely duplicate; fails open (null) on any error. */
async function findRelatedFeedback(
  deps: CaptureDeps,
  summary: string,
  categories: import("./ports.js").FeedbackCategory[],
  logger: Logger,
): Promise<import("./ports.js").SimilarMatch | null> {
  try {
    const sinceDateIso = new Date(Date.now() - deps.similarityWindowDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const candidates = await deps.notion.findRecentByCategories(categories, sinceDateIso);
    if (candidates.length === 0) return null;
    return await deps.similarityDetector.findSimilar(summary, categories, candidates);
  } catch (err) {
    logger.warn("Similarity check failed — capturing without a related-feedback link", { err: String(err) });
    return null;
  }
}

/** Downloads the first attached image; fails open (null) on any error. */
async function fetchImage(
  deps: CaptureDeps,
  imageUrl: string,
  logger: Logger,
): Promise<ImageAttachment | null> {
  try {
    return await deps.slack.downloadImage(imageUrl);
  } catch (err) {
    logger.warn("Image download failed — capturing without the screenshot", { err: String(err) });
    return null;
  }
}
