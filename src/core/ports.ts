/**
 * Ports — the interfaces the core depends on. Concrete implementations live in
 * `src/adapters/`. The core imports only from here, never from a vendor SDK, so any
 * adapter (Slack, Notion, SQLite) can be swapped without touching business logic.
 */

/** A Slack message reduced to what the core needs. */
export interface SlackMessage {
  text: string;
  authorUserId: string;
  /** Private Slack URLs for any image files attached to the message. */
  imageUrls?: string[];
}

export interface ImageAttachment {
  data: string; // base64-encoded
  mimeType: string;
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
  /** Download an authenticated Slack file URL (e.g. from SlackMessage.imageUrls). */
  downloadImage(url: string): Promise<ImageAttachment | null>;
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
  aiSuggestedCategory?: FeedbackCategory; // frozen copy of `category` at write time — never edited after, so a later human correction to `category` stays diffable against what the AI originally said
  confidence?: ConfidenceLevel; // judge's confidence in the above; absent when judging is disabled or failed
  rationale?: string;      // judge's short rationale; absent when judging is disabled or failed
  visualDescription?: string; // vision's description of an attached screenshot, when present
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
  | "Other"
  | "Candidate Experience"
  | "Assessment Accuracy/Validity";

export interface EnrichmentResult {
  summary: string;
  category: FeedbackCategory;
}

export interface Enricher {
  enrich(text: string, channelName: string): Promise<EnrichmentResult | null>;
}

export type ConfidenceLevel = "High" | "Medium" | "Low";

export interface JudgeVerdict {
  confidence: ConfidenceLevel;
  rationale: string;
}

/**
 * Reviews an enrichment result against the original message (reference-grounded,
 * not self-comparison) and returns a pointwise confidence + short rationale.
 * Phase 1 scope: checks category-correctness and summary-faithfulness only.
 */
export interface Judge {
  review(
    originalMessage: string,
    channelName: string,
    summary: string,
    category: FeedbackCategory,
  ): Promise<JudgeVerdict | null>;
}

export interface VisionResult {
  description: string;
}

/** Describes an attached screenshot. Scope: one image per message, description only (no OCR/coordinates). */
export interface VisionReader {
  describe(image: ImageAttachment, channelName: string): Promise<VisionResult | null>;
}

export interface FeedbackGateResult {
  /** True if this message is plausibly customer feedback (high-recall bias). */
  isLikelyFeedback: boolean;
  /** How confident the gate is in that call. */
  confidence: ConfidenceLevel;
  /** One short sentence of reasoning, shown to the human reviewer. */
  rationale: string;
}

/**
 * Backfill-only gate: a scoped-down version of the deferred "is this feedback?" check
 * (ENRICHMENT-DESIGN-DECISIONS.md §2). High-recall by design — a human confirms every hit.
 * NOT wired into the live pipeline.
 */
export interface FeedbackGate {
  classify(text: string, channelName: string): Promise<FeedbackGateResult | null>;
}
