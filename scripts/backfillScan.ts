// scripts/backfillScan.ts
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { consoleLogger as logger } from "../src/util/logger.js";
import { BoltSlackGateway } from "../src/adapters/slack/boltGateway.js";
import { ClaudeFeedbackGate } from "../src/adapters/gate/claudeFeedbackGate.js";
import { NullFeedbackGate } from "../src/adapters/gate/nullFeedbackGate.js";
import { ClaudeEnricher } from "../src/adapters/enricher/claudeEnricher.js";
import { loadGuideFile } from "../src/util/loadGuideFile.js";
import { NullEnricher } from "../src/adapters/enricher/nullEnricher.js";
import { ClaudeVisionReader } from "../src/adapters/vision/claudeVisionReader.js";
import { NullVisionReader } from "../src/adapters/vision/nullVisionReader.js";
import { scanChannelHistory } from "../src/backfill/slackHistory.js";
import { BackfillReviewDb } from "../src/backfill/reviewDb.js";
import { uploadImageToNotion } from "../src/backfill/imageUpload.js";

const CHANNEL_ID = "C0BDD5KE91V"; // #test-bot-to-capture-feedback — DO NOT widen (see plan constraints)
const MONTHS_BACK = 4;
const STATE_PATH = "./data/backfill-review.json";

async function main() {
  const config = loadConfig();
  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY required for the gate/enrichment.");
  if (!config.notionApiKey) throw new Error("NOTION_API_KEY required.");
  if (!config.backfillReviewParentPageId) throw new Error("BACKFILL_REVIEW_PARENT_PAGE_ID required (a Notion page shared with the integration).");

  const slack = new BoltSlackGateway(config.slackBotToken, logger);
  const botUserId = await slack.getBotUserId();
  const gate = config.anthropicApiKey ? new ClaudeFeedbackGate(config.anthropicApiKey) : new NullFeedbackGate();
  const enrichmentStyleGuide = loadGuideFile(config.enrichmentStyleGuidePath);
  const enricher = config.anthropicApiKey ? new ClaudeEnricher(config.anthropicApiKey, enrichmentStyleGuide) : new NullEnricher();
  const vision = config.anthropicApiKey ? new ClaudeVisionReader(config.anthropicApiKey) : new NullVisionReader();
  const reviewDb = new BackfillReviewDb(config.notionApiKey);
  const visionEnabled = new Set(config.visionEnabledChannelIds).has(CHANNEL_ID);

  const oldest = Math.floor((Date.now() - MONTHS_BACK * 30 * 24 * 60 * 60 * 1000) / 1000);
  const channelName = await slack.resolveChannelName(CHANNEL_ID);

  logger.info(`Scanning ${channelName} since ${new Date(oldest * 1000).toISOString().slice(0, 10)}...`);
  const raw = await scanChannelHistory((slack as any)["client"], CHANNEL_ID, oldest, { botUserId, triggerEmoji: config.triggerEmoji });
  logger.info(`Found ${raw.length} scannable message(s); running the gate...`);

  const dbId = await reviewDb.createDatabase(config.backfillReviewParentPageId);
  writeFileSync(STATE_PATH, JSON.stringify({ reviewDatabaseId: dbId, createdAtIso: new Date().toISOString() }, null, 2));
  logger.info(`Created Backfill Review DB: ${dbId}`);

  let kept = 0;
  for (const c of raw) {
    try {
      // Vision first so image-only messages get a description the gate/enricher can use.
      let visualDescription: string | undefined;
      let imageUploadId: string | undefined;
      const imageUrl = c.imageUrls?.[0];
      if (imageUrl && visionEnabled) {
        const img = await slack.downloadImage(imageUrl);
        if (img) {
          visualDescription = (await vision.describe(img, channelName))?.description;
          imageUploadId = (await uploadImageToNotion(config.notionApiKey, img)) ?? undefined; // best-effort
        }
      }
      const gateInput = visualDescription
        ? (c.text.trim() ? `${c.text}\n\n[Attached screenshot shows: ${visualDescription}]` : `[Screenshot only. Shows: ${visualDescription}]`)
        : c.text;

      const verdict = await gate.classify(gateInput, channelName);
      if (!verdict?.isLikelyFeedback) continue; // high recall, but skip clear non-feedback
      kept++;

      const enrichment = await enricher.enrich(gateInput, channelName).catch(() => null);
      const [authorName, slackUrl] = await Promise.all([
        slack.resolveUserName(c.user),
        slack.getPermalink(CHANNEL_ID, c.ts),
      ]);

      await reviewDb.addCandidate(dbId, {
        channelId: CHANNEL_ID,
        messageTs: c.ts,
        message: c.text,
        authorName,
        dateIso: new Date(Number(c.ts) * 1000).toISOString().slice(0, 10),
        slackUrl,
        proposedCategory: enrichment?.category,
        proposedSummary: enrichment?.summary,
        visualDescription,
        gateConfidence: verdict.confidence,
        gateRationale: verdict.rationale,
        imageUploadId,
      });
      logger.info(`  + candidate ${c.ts} (${verdict.confidence})`);
    } catch (err) {
      logger.warn(`Skipping candidate ${c.ts} after error`, { err: String(err) });
      continue;
    }
  }

  logger.info(`Done. ${kept} candidate(s) written to the review DB. Review them in Notion, then run backfillCapture.`);
}

main().catch((err) => { console.error("Scan failed:", err?.body ?? err); process.exit(1); });
