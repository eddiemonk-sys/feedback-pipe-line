import type { CaptureRequest } from "./events.js";
import type { SlackGateway, NotionWriter, DedupStore, Enricher, Judge, VisionReader, SimilarityDetector, ImageAttachment } from "./ports.js";
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
  vision: VisionReader;
  /** Channels where screenshots may be sent for vision processing. Empty = nowhere. */
  visionEnabledChannelIds: Set<string>;
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

    const hasRealText = !!message.text.trim();
    let text = message.text.trim() || "(no text — attachment or file)";
    if (req.triggerType === "mention" && botUserId) {
      text = text.replace(new RegExp(`<@${botUserId}>\\s*`, "g"), "").trim() ||
        "(no text — attachment or file)";
    }

    const dateIso = new Date(Number(req.messageTs) * 1000).toISOString().slice(0, 10);

    // Vision runs BEFORE enrichment so a screenshot's content can inform the summary/category —
    // otherwise an image-only message enriches on just the "(no text...)" placeholder and the
    // AI (correctly) says it can't classify something with no text, even though vision already
    // read the screenshot fine.
    const imageUrl = message.imageUrls?.[0];
    const image =
      imageUrl && deps.visionEnabledChannelIds.has(req.channelId)
        ? await fetchImage(deps, imageUrl, logger)
        : null;
    const visualDescription = image ? await describeImage(deps, image, channelName, logger) : undefined;

    const enrichmentInput = visualDescription
      ? hasRealText
        ? `${text}\n\n[Attached screenshot shows: ${visualDescription}]`
        : `[No message text — only an attached screenshot. Screenshot shows: ${visualDescription}]`
      : text;

    let enrichment = await deps.enricher.enrich(enrichmentInput, channelName).catch((err) => {
      logger.warn("Enrichment failed — capturing without summary/category", { err: String(err) });
      return null;
    });

    let verdict = enrichment
      ? await deps.judge
          .review(enrichmentInput, channelName, enrichment.summary, enrichment.categories)
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
      const retryInput = `${enrichmentInput}\n\nNote: a previous classification of this message was rated Low confidence. Reviewer note: "${verdict.rationale}". Reconsider the category — pay particular attention to which category most precisely matches the primary signal.`;
      const retryEnrichment = await deps.enricher.enrich(retryInput, channelName).catch((err) => {
        logger.warn("Retry enrichment failed — keeping original result", { err: String(err) });
        return null;
      });
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

    const relatedMatch = enrichment ? await findRelatedFeedback(deps, enrichment.summary, enrichment.categories, logger) : null;

    const pageId = await notion.createFeedback({
      message: text,
      channelName,
      authorName,
      dateIso,
      flaggedByName,
      source,
      messageUrl,
      customerAccount: "",
      summary: enrichment?.summary,
      categories: enrichment?.categories,
      aiSuggestedCategories: enrichment?.categories ? [...enrichment.categories] : undefined,
      aiSuggestedSummary: enrichment?.summary,
      confidence: verdict?.confidence,
      rationale: verdict?.rationale,
      visualDescription,
      image: image ?? undefined,
      relatedFeedbackPageId: relatedMatch?.matchedPageId,
      relatedFeedbackRationale: relatedMatch?.rationale,
      status: req.initialStatus,
    });

    dedup.record(key, pageId);
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

/** Describes an already-downloaded screenshot; fails open (undefined) on any error. */
async function describeImage(
  deps: CaptureDeps,
  image: ImageAttachment,
  channelName: string,
  logger: Logger,
): Promise<string | undefined> {
  try {
    const result = await deps.vision.describe(image, channelName);
    return result?.description;
  } catch (err) {
    logger.warn("Vision failed — capturing without visualDescription", { err: String(err) });
    return undefined;
  }
}
