/**
 * Ports — the interfaces the core depends on. Concrete implementations live in
 * `src/adapters/`. The core imports only from here, never from a vendor SDK, so any
 * adapter (Slack, Notion, SQLite) can be swapped without touching business logic.
 */

/** A Slack message reduced to what the core needs. */
export interface SlackMessage {
  text: string;
  authorUserId: string;
}

/** Read from / act on Slack, abstracted away from any specific SDK or transport. */
export interface SlackGateway {
  /** Fetch the message at (channelId, ts). Returns null if it can't be found. */
  getMessage(channelId: string, ts: string): Promise<SlackMessage | null>;
  /** Resolve a user ID to a human display name. */
  resolveUserName(userId: string): Promise<string>;
  /** Resolve a channel ID to its name, e.g. "#test-bot-to-capture-feedback". */
  resolveChannelName(channelId: string): Promise<string>;
  /** Public permalink to the message. */
  getPermalink(channelId: string, ts: string): Promise<string>;
  /** Add an emoji reaction (used for the ✅ / ⚠️ acknowledgment). */
  addReaction(channelId: string, ts: string, emoji: string): Promise<void>;
  /** Post a threaded reply in the given channel/thread (used for @mention acks). */
  postReply(channelId: string, threadTs: string, text: string): Promise<void>;
}

/** One row of the Notion "Customer Feedback" database. */
export interface FeedbackRecord {
  message: string;
  channelName: string;
  authorName: string;
  dateIso: string;
  flaggedByName: string;
  source: string;
  messageUrl: string;
  customerAccount: string;
  summary?: string;        // AI-generated; absent when enrichment is disabled or failed
  category?: FeedbackCategory; // AI-assigned; absent when enrichment is disabled or failed
}

export interface NotionWriter {
  /** Write a new feedback row. Returns the page/record ID for later updates. */
  createFeedback(record: FeedbackRecord): Promise<string>;
  /** Append a new flagger name to the "Flagged By" field of an existing row. */
  appendFlagger(pageId: string, newFlaggerName: string): Promise<void>;
}

/** Dedup store keyed on a stable message key (channelId:messageTs). */
export interface DedupStore {
  has(key: string): boolean;
  /** Record the key alongside the page ID returned by the writer (for later updates). */
  record(key: string, pageId: string): void;
  /** Return the stored page ID, or null for keys recorded before this field existed. */
  getPageId(key: string): string | null;
  close(): void;
}

export type FeedbackCategory =
  | "Bug / Broken"
  | "Feature Request"
  | "Pricing / Commercial"
  | "Onboarding / Setup"
  | "UX / Usability"
  | "Reporting / Data"
  | "Praise"
  | "Other";

export interface EnrichmentResult {
  summary: string;
  category: FeedbackCategory;
}

export interface Enricher {
  enrich(text: string, channelName: string): Promise<EnrichmentResult | null>;
}
