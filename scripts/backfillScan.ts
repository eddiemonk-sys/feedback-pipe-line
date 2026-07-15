// scripts/backfillScan.ts
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { consoleLogger as logger } from "../src/util/logger.js";
import { BoltSlackGateway } from "../src/adapters/slack/boltGateway.js";
import { FeedbackGate } from "../src/adapters/gate/claudeFeedbackGate.js";
import { NullFeedbackGate } from "../src/adapters/gate/nullFeedbackGate.js";
import { AnthropicLLMClient } from "../src/adapters/llm/anthropicClient.js";
import { Enricher } from "../src/adapters/enricher/claudeEnricher.js";
import { loadGuideFile } from "../src/util/loadGuideFile.js";
import { loadPrompt } from "../src/util/loadPrompt.js";
import { NullEnricher } from "../src/adapters/enricher/nullEnricher.js";
import { scanChannelHistory } from "../src/backfill/slackHistory.js";
import { BackfillReviewDb } from "../src/backfill/reviewDb.js";
import { uploadImageToNotion } from "../src/backfill/imageUpload.js";

// Channels + window are configured via BACKFILL_CHANNEL_IDS and BACKFILL_WEEKS_BACK (see config.ts).
// The old test-channel-only hard-lock is lifted — the AI/data review was signed off 2026-07-06.
const STATE_PATH = "./data/backfill-review.json";

async function main() {
  const config = loadConfig();
  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY required for the gate/enrichment.");
  if (!config.notionApiKey) throw new Error("NOTION_API_KEY required.");
  const notionApiKey = config.notionApiKey; // narrowed to string by the guard above
  if (!config.backfillReviewParentPageId) throw new Error("BACKFILL_REVIEW_PARENT_PAGE_ID required (a Notion page shared with the integration).");
  if (config.backfillChannelIds.length === 0) throw new Error("BACKFILL_CHANNEL_IDS required (comma-separated Slack channel IDs to scan).");

  const slack = new BoltSlackGateway(config.slackBotToken, logger);
  const botUserId = await slack.getBotUserId();
  const gate = config.anthropicApiKey ? new FeedbackGate(new AnthropicLLMClient(config.anthropicApiKey, config.gateModel), loadPrompt("gate")) : new NullFeedbackGate();
  const enrichmentStyleGuide = loadGuideFile(config.enrichmentStyleGuidePath);
  const enricher = config.anthropicApiKey ? new Enricher(new AnthropicLLMClient(config.anthropicApiKey, process.env.ENRICHER_MODEL ?? "claude-sonnet-4-6"), loadPrompt("enricher"), enrichmentStyleGuide) : new NullEnricher();
  const reviewDb = new BackfillReviewDb(notionApiKey);

  const oldest = Math.floor((Date.now() - config.backfillWeeksBack * 7 * 24 * 60 * 60 * 1000) / 1000);

  // One Review DB for the whole run — every channel's candidates land in it.
  const dbId = await reviewDb.createDatabase(config.backfillReviewParentPageId);
  writeFileSync(STATE_PATH, JSON.stringify({ reviewDatabaseId: dbId, createdAtIso: new Date().toISOString() }, null, 2));
  logger.info(`Created Backfill Review DB: ${dbId}`);
  logger.info(`Scanning ${config.backfillChannelIds.length} channel(s), back to ${new Date(oldest * 1000).toISOString().slice(0, 10)} (${config.backfillWeeksBack} weeks).`);

  let totalKept = 0;
  for (const channelId of config.backfillChannelIds) {
    try {
      const channelName = await slack.resolveChannelName(channelId);
      logger.info(`\n=== ${channelName} (${channelId}) ===`);
      const raw = await scanChannelHistory((slack as any)["client"], channelId, oldest, { botUserId, triggerEmoji: config.triggerEmoji });
      logger.info(`Found ${raw.length} scannable message(s); running the gate...`);

      let kept = 0;
      for (const c of raw) {
        try {
          let imageUploadId: string | undefined;
          let enrichmentImages: { data: string; mimeType: string }[] | undefined;
          const imageUrl = c.imageUrls?.[0];
          if (imageUrl) {
            const img = await slack.downloadImage(imageUrl);
            if (img) {
              imageUploadId = (await uploadImageToNotion(notionApiKey, img)) ?? undefined; // best-effort
              enrichmentImages = [img];
            }
          }

          const verdict = await gate.classify(c.text, channelName);
          if (!verdict?.isLikelyFeedback) continue; // high recall, but skip clear non-feedback
          kept++;

          const enrichment = await enricher.enrich(c.text, channelName, enrichmentImages).catch(() => null);
          const [authorName, slackUrl] = await Promise.all([
            slack.resolveUserName(c.user),
            slack.getPermalink(channelId, c.ts),
          ]);

          await reviewDb.addCandidate(dbId, {
            channelId,
            messageTs: c.ts,
            message: c.text,
            authorName,
            dateIso: new Date(Number(c.ts) * 1000).toISOString().slice(0, 10),
            slackUrl,
            proposedCategory: enrichment?.categories?.[0],
            proposedSummary: enrichment?.summary,
            gateConfidence: verdict.confidence,
            gateRationale: verdict.rationale,
            imageUploadId,
          });
          logger.info(`  + candidate ${c.ts} (${verdict.confidence})`);
        } catch (err) {
          logger.warn(`  Skipping candidate ${c.ts} after error`, { err: String(err) });
          continue;
        }
      }
      logger.info(`${channelName}: ${kept} candidate(s) kept.`);
      totalKept += kept;
    } catch (err) {
      logger.warn(`Skipping channel ${channelId} — could not scan (is the bot a member, with channels:history?)`, { err: String(err) });
      continue;
    }
  }

  logger.info(`\nDone. ${totalKept} candidate(s) written to the review DB. Review them in Notion, then run backfillCapture.`);
}

main().catch((err) => { console.error("Scan failed:", err?.body ?? err); process.exit(1); });
