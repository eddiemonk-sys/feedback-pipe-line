import { WebClient } from "@slack/web-api";
import type { ImageAttachment, SlackGateway, SlackMessage } from "../../core/ports.js";
import type { Logger } from "../../util/logger.js";

export function extractImageUrls(files?: Array<{ mimetype?: string; url_private?: string }>): string[] | undefined {
  const urls = (files ?? [])
    .filter((f): f is { mimetype: string; url_private: string } =>
      !!f.mimetype?.startsWith("image/") && !!f.url_private,
    )
    .map((f) => f.url_private);
  return urls.length ? urls : undefined;
}

/**
 * SlackGateway implementation backed by Slack's Web API. This is the only Slack-data
 * adapter; the core never touches @slack/web-api directly. Names and channel names are
 * cached to avoid repeated lookups.
 */
export class BoltSlackGateway implements SlackGateway {
  private client: WebClient;
  private userCache = new Map<string, string>();
  private channelCache = new Map<string, string>();

  constructor(private botToken: string, private logger: Logger) {
    this.client = new WebClient(botToken);
  }

  async getMessage(channelId: string, ts: string): Promise<SlackMessage | null> {
    // Top-level message.
    const hist = await this.client.conversations.history({
      channel: channelId,
      latest: ts,
      oldest: ts,
      inclusive: true,
      limit: 1,
    });
    const top = hist.messages?.find((m) => m.ts === ts);
    if (top) {
      return { text: top.text ?? "", authorUserId: top.user ?? "", imageUrls: extractImageUrls(top.files) };
    }

    // Fall back to a threaded reply (Slack resolves a reply ts to its thread).
    try {
      const replies = await this.client.conversations.replies({ channel: channelId, ts });
      const reply = replies.messages?.find((m) => m.ts === ts);
      if (reply) {
        return { text: reply.text ?? "", authorUserId: reply.user ?? "", imageUrls: extractImageUrls(reply.files) };
      }
    } catch (err) {
      this.logger.warn("conversations.replies fallback failed", { err: String(err) });
    }
    return null;
  }

  async downloadImage(url: string): Promise<ImageAttachment | null> {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${this.botToken}` } });
      if (!res.ok) {
        this.logger.warn("Failed to download image", { url, status: res.status });
        return null;
      }
      const buffer = await res.arrayBuffer();
      const mimeType = res.headers.get("content-type") ?? "image/png";
      return { data: Buffer.from(buffer).toString("base64"), mimeType };
    } catch (err) {
      this.logger.warn("Failed to download image", { url, err: String(err) });
      return null;
    }
  }

  async resolveUserName(userId: string): Promise<string> {
    if (!userId) return "Unknown";
    const cached = this.userCache.get(userId);
    if (cached) return cached;
    const res = await this.client.users.info({ user: userId });
    const profile = res.user?.profile;
    const name =
      profile?.display_name?.trim() ||
      profile?.real_name?.trim() ||
      res.user?.name ||
      userId;
    this.userCache.set(userId, name);
    return name;
  }

  async resolveChannelName(channelId: string): Promise<string> {
    const cached = this.channelCache.get(channelId);
    if (cached) return cached;
    const res = await this.client.conversations.info({ channel: channelId });
    const name = res.channel?.name ? `#${res.channel.name}` : channelId;
    this.channelCache.set(channelId, name);
    return name;
  }

  async getPermalink(channelId: string, ts: string): Promise<string> {
    const res = await this.client.chat.getPermalink({ channel: channelId, message_ts: ts });
    return res.permalink ?? "";
  }

  async addReaction(channelId: string, ts: string, emoji: string): Promise<void> {
    try {
      await this.client.reactions.add({ channel: channelId, timestamp: ts, name: emoji });
    } catch (err: any) {
      // "already_reacted" is fine — the ack is idempotent.
      if (err?.data?.error !== "already_reacted") {
        this.logger.warn("Failed to add reaction", { emoji, err: String(err) });
      }
    }
  }

  async postReply(channelId: string, threadTs: string, text: string): Promise<void> {
    await this.client.chat.postMessage({ channel: channelId, thread_ts: threadTs, text });
  }

  /** Not on the port — called once at startup to obtain the bot's own user ID. */
  async getBotUserId(): Promise<string> {
    const res = await this.client.auth.test();
    return res.user_id ?? "";
  }
}
