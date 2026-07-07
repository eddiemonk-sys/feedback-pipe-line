/** A raw Slack history message reduced to what the filter needs. */
export interface RawSlackMessage {
  ts: string;
  user?: string;
  text?: string;
  subtype?: string;
  hasImage: boolean;
  reactions?: string[];
}

/**
 * True if this historical message is worth sending to the feedback gate.
 * Drops: the bot's own posts, any system message (subtype set), messages with
 * neither text nor image, and anything already flagged with the trigger emoji.
 */
export function isScannable(
  msg: RawSlackMessage,
  opts: { botUserId: string; triggerEmoji: string },
): boolean {
  if (!msg.user || msg.user === opts.botUserId) return false;
  if (msg.subtype) return false;
  if (!msg.text?.trim() && !msg.hasImage) return false;
  if (msg.reactions?.includes(opts.triggerEmoji)) return false;
  return true;
}
