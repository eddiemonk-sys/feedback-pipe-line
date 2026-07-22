import { loadConfig } from "./config.js";
import { consoleLogger } from "./util/logger.js";
import { loadGuideFile } from "./util/loadGuideFile.js";
import { loadPrompt } from "./util/loadPrompt.js";
import { BoltSlackGateway } from "./adapters/slack/boltGateway.js";
import { NotionFeedbackWriter } from "./adapters/notion/notionWriter.js";
import { LocalFeedbackWriter } from "./adapters/notion/localWriter.js";
import { FileDedupStore } from "./adapters/dedup/fileStore.js";
import { startHttpMode } from "./adapters/transport/httpMode.js";
import { AnthropicLLMClient } from "./adapters/llm/anthropicClient.js";
import { OpenAILLMClient } from "./adapters/llm/openaiClient.js";
import { Enricher as EnricherImpl } from "./adapters/enricher/claudeEnricher.js";
import { NullEnricher } from "./adapters/enricher/nullEnricher.js";
import { Judge as JudgeImpl } from "./adapters/judge/claudeJudge.js";
import { NullJudge } from "./adapters/judge/nullJudge.js";
import { ClaudeSimilarityDetector } from "./adapters/similarity/claudeSimilarityDetector.js";
import { NullSimilarityDetector } from "./adapters/similarity/nullSimilarityDetector.js";
import { handleCapture, type CaptureDeps, type CaptureResult } from "./core/handleCapture.js";
import { handleThreadReply, type ThreadReplyDeps } from "./core/handleThreadReply.js";
import type { CaptureRequest } from "./core/events.js";
import type { Enricher, Judge, SimilarityDetector, SlackGateway, NotionWriter, LLMToolCall, ThreadRouter } from "./core/ports.js";
import { ClaudeThreadRouter } from "./adapters/threadRouter/claudeThreadRouter.js";
import { NullThreadRouter } from "./adapters/threadRouter/nullThreadRouter.js";
import { startGranolaPoller, StubGranolaClient } from "./adapters/granola/granolaAdapter.js";
import { GranolaGate as GranolaGateImpl } from "./adapters/granola/granolaGate.js";
import { FeedbackGate as FeedbackGateImpl } from "./adapters/gate/claudeFeedbackGate.js";
import { NullFeedbackGate } from "./adapters/gate/nullFeedbackGate.js";
import type { FeedbackGate } from "./core/ports.js";
import { NotionFeedbackReader } from "./adapters/notion/notionFeedbackReader.js";
import { ClaudeDigestBuilder } from "./adapters/digest/claudeDigestBuilder.js";
import { NotionDigestWriter } from "./adapters/digest/notionDigestWriter.js";
import { startDigestScheduler } from "./adapters/digest/digestScheduler.js";

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
    if (!openaiKey) throw new Error(`OPENAI_API_KEY is required when ENRICHER_MODEL, JUDGE_MODEL, or GATE_MODEL starts with 'gpt-'. Set it in .env.`);
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

  const similarityRules = loadGuideFile(config.similarityRulesPath);
  const similarityDetector: SimilarityDetector = config.anthropicApiKey
    ? new ClaudeSimilarityDetector(config.anthropicApiKey, similarityRules)
    : new NullSimilarityDetector();
  logger.info(
    config.anthropicApiKey
      ? `Related-feedback detection enabled (${config.similarityWindowDays}-day window)${similarityRules.trim() ? " + rules guide" : ""}`
      : "Related-feedback detection disabled — set ANTHROPIC_API_KEY to enable",
  );

  const threadRouterPrompt = loadPrompt("threadRouter");
  const threadRouter: ThreadRouter = hasLLMKey && config.anthropicApiKey
    ? new ClaudeThreadRouter(
        makeLLMClient(config.threadRouterModel, config.anthropicApiKey ?? config.openaiApiKey!),
        threadRouterPrompt ?? "",
      )
    : new NullThreadRouter();
  logger.info(
    hasLLMKey
      ? `Thread routing enabled (${config.threadRouterModel})`
      : "Thread routing disabled — set ANTHROPIC_API_KEY to enable",
  );

  const gatePrompt = loadPrompt("gate");
  const feedbackGate: FeedbackGate = hasLLMKey && config.anthropicApiKey
    ? new FeedbackGateImpl(makeLLMClient(config.gateModel, config.anthropicApiKey), gatePrompt ?? "")
    : new NullFeedbackGate();
  logger.info(
    config.autoCaptureChannelIds.length > 0
      ? `Live gate auto-capture enabled for channels: ${config.autoCaptureChannelIds.join(", ")} (${config.gateModel})`
      : "Live gate auto-capture disabled — set AUTO_CAPTURE_CHANNEL_IDS to enable",
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
    similarityDetector,
    similarityWindowDays: config.similarityWindowDays,
  };

  // ...and wire them into the single handler the transport invokes. handleCapture is
  // pure business logic; the transport hands it a normalized CaptureRequest.
  const onCapture = async (req: CaptureRequest): Promise<void> => {
    const result = await handleCapture(req, deps);
    await acknowledge(slack, req, result);
  };

  const threadReplyDeps: ThreadReplyDeps = {
    slack,
    notion: feedbackWriter,
    dedup,
    logger,
    threadRouter,
    handleCapture,  // the fully-wired function from above
    captureDeps: deps,
  };

  const onThreadReply = async (
    channelId: string,
    threadTs: string,
    replyTs: string,
    replyUserId: string,
    replyText: string,
    replyImageUrls: string[],
  ): Promise<void> => {
    await handleThreadReply(channelId, threadTs, replyTs, replyUserId, replyText, replyImageUrls, threadReplyDeps);
  };

  const onChannelMessage = async (
    channelId: string,
    messageTs: string,
    authorUserId: string,
    text: string,
    _imageUrls: string[],
  ): Promise<void> => {
    if (!config.autoCaptureChannelIds.includes(channelId)) return;
    const channelName = await slack.resolveChannelName(channelId).catch(() => channelId);
    const gateResult = await feedbackGate.classify(text, channelName).catch(() => null);
    if (!gateResult?.isLikelyFeedback) return;

    logger.info("Live gate: auto-capturing message", { channelId, messageTs, confidence: gateResult.confidence });
    const req: CaptureRequest = {
      triggerType: "live_gate",
      channelId,
      messageTs,
      triggeredBy: authorUserId,
      initialStatus: gateResult.confidence === "High" ? "New" : "Needs Review",
    };
    await onCapture(req);
  };

  await startHttpMode(
    {
      botToken: config.slackBotToken,
      signingSecret: config.slackSigningSecret,
      triggerEmoji: config.triggerEmoji,
      onThreadReply,
      onChannelMessage,
      botUserId,
      notionApiKey: config.notionApiKey,
      notionDatabaseId: config.notionDatabaseId,
    },
    onCapture,
    logger,
  );

  // Granola ingestion poller (DS-73). Runs alongside the HTTP transport.
  // Uses a StubGranolaClient until MCP access from Node is confirmed — see TODO(DS-73-mcp).
  if (hasLLMKey && config.anthropicApiKey) {
    const granolaGatePrompt = loadPrompt("granolaGate");
    const granolaGate = new GranolaGateImpl(
      makeLLMClient(config.gateModel, config.anthropicApiKey),
      granolaGatePrompt,
    );
    startGranolaPoller(
      { folderId: config.granolaFolderId, pollIntervalMs: config.granolaPollIntervalMs },
      {
        granolaClient: new StubGranolaClient(),
        gate: granolaGate,
        enricher,
        judge,
        notion: feedbackWriter,
        dedup,
        similarityDetector,
        similarityWindowDays: config.similarityWindowDays,
        source: "Granola",
      },
      logger,
    );
    logger.info(`Granola poller started (folder=${config.granolaFolderId}, interval=${config.granolaPollIntervalMs}ms) — using StubGranolaClient (MCP not yet wired)`);
  } else {
    logger.info("Granola poller disabled — set ANTHROPIC_API_KEY to enable");
  }

  // Weekly digest scheduler (DS-68, DS-69). Posts to Slack every Monday 09:00 UTC.
  if (config.digestSlackChannelId && config.notionApiKey && config.notionDatabaseId && config.anthropicApiKey) {
    const feedbackReader = new NotionFeedbackReader(config.notionApiKey, config.notionDatabaseId);
    const digestBuilderImpl = new ClaudeDigestBuilder(config.anthropicApiKey, config.digestModel);
    const notionWriter = new NotionDigestWriter(config.notionApiKey, config.notionDigestPageId);
    startDigestScheduler(
      { channelId: config.digestSlackChannelId, daysBefore: config.digestDaysBefore },
      { feedbackReader, digestBuilder: digestBuilderImpl, slackToken: config.slackBotToken, notionWriter },
      logger,
    );
    logger.info(`Digest scheduler started (channel=${config.digestSlackChannelId}, every Monday 09:00 UTC)`);
  } else {
    logger.info("Digest scheduler disabled — set DIGEST_SLACK_CHANNEL_ID to enable");
  }

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
