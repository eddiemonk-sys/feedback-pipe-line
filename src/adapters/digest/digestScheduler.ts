import { WebClient } from "@slack/web-api";
import type { FeedbackDigestReader, DigestBuilder, DigestNotionWriter } from "../../core/digest.js";

export interface DigestSchedulerConfig {
  channelId: string;
  daysBefore: number;
}

export interface DigestSchedulerDeps {
  feedbackReader: FeedbackDigestReader;
  digestBuilder: DigestBuilder;
  slackToken: string;
  notionWriter?: DigestNotionWriter;
}

export interface DigestLogger {
  info(msg: string, meta?: object): void;
  error(msg: string, meta?: object): void;
}

function msUntilNextMonday9amUTC(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(9, 0, 0, 0);
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon
  let daysToAdd = (1 - dayOfWeek + 7) % 7;
  if (daysToAdd === 0 && now >= next) daysToAdd = 7;
  next.setUTCDate(next.getUTCDate() + daysToAdd);
  return Math.max(0, next.getTime() - now.getTime());
}

function currentWeekLabel(): string {
  return `w/c ${new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  })}`;
}

export function startDigestScheduler(
  config: DigestSchedulerConfig,
  deps: DigestSchedulerDeps,
  logger: DigestLogger,
): void {
  const slack = new WebClient(deps.slackToken);

  const runDigest = async (): Promise<void> => {
    logger.info("Digest scheduler: running weekly digest");
    try {
      const items = await deps.feedbackReader.readRecentFeedback(config.daysBefore);
      logger.info(`Digest scheduler: ${items.length} items read`);
      const text = await deps.digestBuilder.buildDigest(items, currentWeekLabel());
      await slack.chat.postMessage({ channel: config.channelId, text });
      logger.info("Digest scheduler: posted to Slack", { channelId: config.channelId });
      if (deps.notionWriter) {
        const url = await deps.notionWriter.writeDigest(text, currentWeekLabel());
        logger.info("Digest scheduler: written to Notion", { url });
      }
    } catch (err) {
      logger.error("Digest scheduler: run failed", { error: String(err) });
    }
  };

  const scheduleNext = (): void => {
    const delayMs = msUntilNextMonday9amUTC();
    const hoursUntil = Math.round(delayMs / 1000 / 60 / 60);
    logger.info(`Digest scheduler: next run in ~${hoursUntil}h (Monday 09:00 UTC)`);
    setTimeout(async () => {
      await runDigest();
      scheduleNext();
    }, delayMs);
  };

  scheduleNext();
}
