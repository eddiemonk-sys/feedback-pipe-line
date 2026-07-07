import { loadConfig } from "./config.js";
import { consoleLogger } from "./util/logger.js";
import { BoltSlackGateway } from "./adapters/slack/boltGateway.js";
import { NotionFeedbackWriter } from "./adapters/notion/notionWriter.js";
import { LocalFeedbackWriter } from "./adapters/notion/localWriter.js";
import { FileDedupStore } from "./adapters/dedup/fileStore.js";
import { startSocketMode } from "./adapters/transport/socketMode.js";
import { ClaudeEnricher } from "./adapters/enricher/claudeEnricher.js";
import { NullEnricher } from "./adapters/enricher/nullEnricher.js";
import { ClaudeJudge } from "./adapters/judge/claudeJudge.js";
import { NullJudge } from "./adapters/judge/nullJudge.js";
import { ClaudeVisionReader } from "./adapters/vision/claudeVisionReader.js";
import { NullVisionReader } from "./adapters/vision/nullVisionReader.js";
import { ClaudeSimilarityDetector } from "./adapters/similarity/claudeSimilarityDetector.js";
import { NullSimilarityDetector } from "./adapters/similarity/nullSimilarityDetector.js";
import { handleCapture, type CaptureDeps, type CaptureResult } from "./core/handleCapture.js";
import type { CaptureRequest } from "./core/events.js";
import type { Enricher, Judge, VisionReader, SimilarityDetector, SlackGateway, NotionWriter } from "./core/ports.js";

const SUCCESS_EMOJI = "white_check_mark";
const FAILURE_EMOJI = "warning";

/**
 * Acknowledgment lives in the composition root (via the SlackGateway port), NOT in the
 * core or the transport — so every transport reuses the same ✅ / ⚠️ behaviour.
 *
 * @mention triggers also post a threaded reply so the person who tagged the bot gets
 * immediate confirmation in context.
 */
async function acknowledge(
  slack: SlackGateway,
  req: CaptureRequest,
  result: CaptureResult,
): Promise<void> {
  const success =
    result.status === "captured" ||
    result.status === "flagger_added" ||
    result.status === "duplicate";
  const emoji = success ? SUCCESS_EMOJI : FAILURE_EMOJI;

  if (req.triggerType === "mention") {
    const replyText =
      result.status === "flagger_added"
        ? "Got it — you've been added as a flagger on this feedback!"
        : success
          ? "Got it — feedback captured!"
          : "Something went wrong capturing that feedback. Please try again.";
    await slack.postReply(req.channelId, req.messageTs, replyText);
  }

  await slack.addReaction(req.channelId, req.messageTs, emoji);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = consoleLogger;

  // Build the adapters (concrete implementations of the ports)...
  const slack = new BoltSlackGateway(config.slackBotToken, logger);

  logger.info("Fetching bot user ID...");
  const botUserId = await slack.getBotUserId();
  logger.info(`Bot user ID: ${botUserId}`);

  const feedbackWriter: NotionWriter =
    config.captureSink === "file"
      ? new LocalFeedbackWriter(config.capturesFilePath, logger)
      : new NotionFeedbackWriter(config.notionApiKey!, config.notionDatabaseId!);
  const dedup = new FileDedupStore(config.dedupStorePath);
  logger.info(`Capture sink: ${config.captureSink}`);

  const enricher: Enricher = config.anthropicApiKey
    ? new ClaudeEnricher(config.anthropicApiKey)
    : new NullEnricher();
  logger.info(
    config.anthropicApiKey ? "Enrichment enabled (Claude Haiku)" : "Enrichment disabled — set ANTHROPIC_API_KEY to enable",
  );

  const judge: Judge = config.anthropicApiKey
    ? new ClaudeJudge(config.anthropicApiKey)
    : new NullJudge();
  logger.info(
    config.anthropicApiKey ? "Judging enabled (category + summary checks)" : "Judging disabled — set ANTHROPIC_API_KEY to enable",
  );

  const vision: VisionReader = config.anthropicApiKey
    ? new ClaudeVisionReader(config.anthropicApiKey)
    : new NullVisionReader();
  const visionEnabledChannelIds = new Set(config.visionEnabledChannelIds);
  logger.info(
    visionEnabledChannelIds.size > 0
      ? `Vision enabled for ${visionEnabledChannelIds.size} channel(s)`
      : "Vision disabled — set VISION_ENABLED_CHANNEL_IDS to enable for specific channels",
  );

  const similarityDetector: SimilarityDetector = config.anthropicApiKey
    ? new ClaudeSimilarityDetector(config.anthropicApiKey)
    : new NullSimilarityDetector();
  logger.info(
    config.anthropicApiKey
      ? `Related-feedback detection enabled (${config.similarityWindowDays}-day window)`
      : "Related-feedback detection disabled — set ANTHROPIC_API_KEY to enable",
  );

  const deps: CaptureDeps = {
    slack,
    notion: feedbackWriter,
    dedup,
    logger,
    source: "Slack",
    botUserId,
    enricher,
    judge,
    vision,
    visionEnabledChannelIds,
    similarityDetector,
    similarityWindowDays: config.similarityWindowDays,
  };

  // ...and wire them into the single handler the transport invokes. handleCapture is
  // pure business logic; the transport hands it a normalized CaptureRequest.
  const onCapture = async (req: CaptureRequest): Promise<void> => {
    const result = await handleCapture(req, deps);
    await acknowledge(slack, req, result);
  };

  await startSocketMode(
    {
      botToken: config.slackBotToken,
      appToken: config.slackAppToken,
      triggerEmoji: config.triggerEmoji,
    },
    onCapture,
    logger,
  );

  const shutdown = () => {
    logger.info("Shutting down");
    dedup.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
