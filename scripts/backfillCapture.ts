// scripts/backfillCapture.ts
import "dotenv/config";
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { consoleLogger as logger } from "../src/util/logger.js";
import { BoltSlackGateway } from "../src/adapters/slack/boltGateway.js";
import { NotionFeedbackWriter } from "../src/adapters/notion/notionWriter.js";
import { FileDedupStore } from "../src/adapters/dedup/fileStore.js";
import { ClaudeEnricher } from "../src/adapters/enricher/claudeEnricher.js";
import { NullEnricher } from "../src/adapters/enricher/nullEnricher.js";
import { ClaudeJudge } from "../src/adapters/judge/claudeJudge.js";
import { NullJudge } from "../src/adapters/judge/nullJudge.js";
import { ClaudeVisionReader } from "../src/adapters/vision/claudeVisionReader.js";
import { NullVisionReader } from "../src/adapters/vision/nullVisionReader.js";
import { handleCapture, dedupKey, type CaptureDeps } from "../src/core/handleCapture.js";
import { BackfillReviewDb } from "../src/backfill/reviewDb.js";
import { toCaptureRequest, correctionFor } from "../src/backfill/decisions.js";

const STATE_PATH = "./data/backfill-review.json";
const MEGA = "mega";

async function main() {
  const config = loadConfig();
  if (config.captureSink !== "notion" || !config.notionApiKey || !config.notionDatabaseId) {
    throw new Error("backfillCapture requires CAPTURE_SINK=notion with NOTION_API_KEY + NOTION_DATABASE_ID.");
  }
  const { reviewDatabaseId } = JSON.parse(readFileSync(STATE_PATH, "utf8")) as { reviewDatabaseId: string };

  const slack = new BoltSlackGateway(config.slackBotToken, logger);
  const botUserId = await slack.getBotUserId();
  const notion = new NotionFeedbackWriter(config.notionApiKey, config.notionDatabaseId);
  const dedup = new FileDedupStore(config.dedupStorePath);
  const deps: CaptureDeps = {
    slack, notion, dedup, logger, source: "Slack", botUserId,
    enricher: config.anthropicApiKey ? new ClaudeEnricher(config.anthropicApiKey) : new NullEnricher(),
    judge: config.anthropicApiKey ? new ClaudeJudge(config.anthropicApiKey) : new NullJudge(),
    vision: config.anthropicApiKey ? new ClaudeVisionReader(config.anthropicApiKey) : new NullVisionReader(),
    visionEnabledChannelIds: new Set(config.visionEnabledChannelIds),
  };
  const triggeredBy = config.backfillFlaggedByUserId ?? botUserId;

  const reviewDb = new BackfillReviewDb(config.notionApiKey);
  const decisions = await reviewDb.readDecisions(reviewDatabaseId);
  logger.info(`${decisions.length} confirmed feedback row(s) to capture.`);

  let captured = 0, patched = 0, marked = 0;
  for (const d of decisions) {
    if (!d.channelId || !d.messageTs) { logger.warn("Row missing Channel ID / Message TS — skipping", { d }); continue; }
    const req = toCaptureRequest(d, triggeredBy);
    const result = await handleCapture(req, deps);
    if (result.status !== "captured" && result.status !== "flagger_added") {
      logger.warn(`Capture ${result.status} for ${d.messageTs}`, { detail: result.detail }); continue;
    }
    captured++;

    // Patch the human's correction onto the created page (frozen AI Suggested Category is left intact).
    const correction = correctionFor(d);
    const pageId = dedup.getPageId(dedupKey(req));
    if (correction && pageId) { await notion.updateClassification(pageId, correction); patched++; }

    // Add the visible :mega: marker to the original Slack message.
    await slack.addReaction(d.channelId, d.messageTs, MEGA);
    marked++;
  }
  dedup.close();
  logger.info(`Done. captured=${captured} patched=${patched} mega_marked=${marked}`);
}

main().catch((err) => { console.error("Capture failed:", err?.body ?? err); process.exit(1); });
