import type { WebClient } from "@slack/web-api";
import { extractImageUrls } from "../adapters/slack/boltGateway.js";
import { isScannable, type RawSlackMessage } from "./filter.js";

export interface ScanCandidate {
  ts: string;
  user: string;
  text: string;
  imageUrls?: string[];
}

function toRaw(m: any): RawSlackMessage {
  return {
    ts: m.ts,
    user: m.user,
    text: m.text ?? "",
    subtype: m.subtype,
    hasImage: !!extractImageUrls(m.files),
    reactions: Array.isArray(m.reactions) ? m.reactions.map((r: any) => r.name) : undefined,
  };
}

function toCandidate(m: any): ScanCandidate {
  return { ts: m.ts, user: m.user, text: m.text ?? "", imageUrls: extractImageUrls(m.files) };
}

/**
 * Paginated scan of a channel's history since `oldestEpochSec`, including thread
 * replies, keeping only messages the filter deems scannable. Thin I/O — the keep/drop
 * decision is the pure, tested `isScannable`.
 */
export async function scanChannelHistory(
  client: WebClient,
  channelId: string,
  oldestEpochSec: number,
  opts: { botUserId: string; triggerEmoji: string },
): Promise<ScanCandidate[]> {
  const out: ScanCandidate[] = [];
  let cursor: string | undefined;

  do {
    const page = await client.conversations.history({
      channel: channelId,
      oldest: String(oldestEpochSec),
      limit: 200,
      cursor,
    });
    for (const m of page.messages ?? []) {
      if (isScannable(toRaw(m), opts)) out.push(toCandidate(m));

      // Thread parent: pull its replies too (feedback often lives in threads).
      if ((m as any).thread_ts && (m as any).reply_count) {
        let replyCursor: string | undefined;
        do {
          const replies = await client.conversations.replies({
            channel: channelId,
            ts: (m as any).thread_ts,
            limit: 200,
            cursor: replyCursor,
          });
          for (const r of replies.messages ?? []) {
            if (r.ts === (m as any).thread_ts) continue; // parent already handled
            if (isScannable(toRaw(r), opts)) out.push(toCandidate(r));
          }
          replyCursor = replies.response_metadata?.next_cursor || undefined;
        } while (replyCursor);
      }
    }
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return out;
}
