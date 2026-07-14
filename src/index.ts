import { loadConfig } from "./config.js";
import { consoleLogger } from "./util/logger.js";
import { loadGuideFile } from "./util/loadGuideFile.js";
import { loadPrompt } from "./util/loadPrompt.js";
import { BoltSlackGateway } from "./adapters/slack/boltGateway.js";
import { NotionFeedbackWriter } from "./adapters/notion/notionWriter.js";
import { LocalFeedbackWriter } from "./adapters/notion/localWriter.js";
import { FileDedupStore } from "./adapters/dedup/fileStore.js";
import { startSocketMode } from "./adapters/transport/socketMode.js";
import { AnthropicLLMClient } from "./adapters/llm/anthropicClient.js";
import { OpenAILLMClient } from "./adapters/llm/openaiClient.js";
import { Enricher as EnricherImpl } from "./adapters/enricher/claudeEnricher.js";
import { NullEnricher } from "./adapters/enricher/nullEnricher.js";
import { Judge as JudgeImpl } from "./adapters/judge/claudeJudge.js";
import { NullJudge } from "./adapters/judge/nullJudge.js";
import { ClaudeVisionReader } from "./adapters/vision/claudeVisionReader.js";
import { NullVisionReader } from "./adapters/vision/nullVisionReader.js";
import { ClaudeSimilarityDetector } from "./adapters/similarity/claudeSimilarityDetector.js";
import { NullSimilarityDetector } from "./adapters/similarity/nullSimilarityDetector.js";
import { handleCapture, type CaptureDeps, type CaptureResult } from "./core/handleCapture.js";
import type { CaptureRequest } from "./core/events.js";
import type { Enricher, Judge, VisionReader, SimilarityDetector, SlackGateway, NotionWriter, LLMToolCall } from "./core/ports.js";

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

/**
 * Build the right LLM client for a model name. Provider is auto-detected from the
 * model prefix (claude-* → Anthropic, gpt-* → OpenAI) so each pipeline stage can be
 * pointed at a different provider purely by changing its *_MODEL env var.
 */
function makeLLMClient(model: string, apiKey: string): LLMToolCall {
  if (model.startsWith("claude-")) {
    return new AnthropicLLMClient(apiKey, model);
  }
  if (model.startsWith("gpt-")) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) throw new Error(`OPENAI_API_KEY is required when ENRICHER_MODEL or JUDGE_MODEL starts with 'gpt-'. Set it in .env.`);
    return new OpenAILLMClient(openaiKey, model);
  }
  throw new Error(`Unknown model provider for "${model}". Use claude-* for Anthropic or gpt-* for OpenAI.`);
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

  const hasLLMKey = !!(config.anthropicApiKey || config.openaiApiKey);

  const enrichmentStyleGuide = loadGuideFile(config.enrichmentStyleGuidePath);
  const enricher: Enricher = hasLLMKey
    ? new EnricherImpl(
        makeLLMClient(config.enricherModel, config.anthropicApiKey ?? config.openaiApiKey!),
        loadPrompt("enricher"),
        enrichmentStyleGuide,
      )
    : new NullEnricher();
  logger.info(
    hasLLMKey
      ? `Enrichment enabled (${config.enricherModel})${enrichmentStyleGuide.trim() ? " + style guide" : ""}`
      : "Enrichment disabled — set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable",
  );

  const judge: Judge = hasLLMKey
    ? new JudgeImpl(
        makeLLMClient(config.judgeModel, config.anthropicApiKey ?? config.openaiApiKey!),
        loadPrompt("judge"),
      )
    : new NullJudge();
  logger.info(
    hasLLMKey ? `Judging enabled (${config.judgeModel})` : "Judging disabled — set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable",
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

  const similarityRules = loadGuideFile(config.similarityRulesPath);
  const similarityDetector: SimilarityDetector = config.anthropicApiKey
    ? new ClaudeSimilarityDetector(config.anthropicApiKey, similarityRules)
    : new NullSimilarityDetector();
  logger.info(
    config.anthropicApiKey
      ? `Related-feedback detection enabled (${config.similarityWindowDays}-day window)${similarityRules.trim() ? " + rules guide" : ""}`
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
