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
  summary?: string;
  /** AI-assigned categories (1–2 items). Absent when enrichment disabled or failed. */
  categories?: FeedbackCategory[];
  /** Frozen AI copy — never edited after initial write. */
  aiSuggestedCategories?: FeedbackCategory[];
  aiSuggestedSummary?: string;
  confidence?: ConfidenceLevel;
  rationale?: string;
  image?: ImageAttachment;
  relatedFeedbackPageId?: string;
  relatedFeedbackRationale?: string;
  /** Initial Notion Status. Defaults to "New". Live gate sets "Needs Review" for medium/low confidence. */
  status?: "New" | "Needs Review";
}

export interface NotionWriter {
  /** Write a new feedback row. Returns the page/record ID for later updates. */
  createFeedback(record: FeedbackRecord): Promise<string>;
  /** Append a new flagger name to the "Flagged By" field of an existing row. */
  appendFlagger(pageId: string, newFlaggerName: string): Promise<void>;
  /** Recent rows in any of the given categories, for similarity comparison. */
  findRecentByCategories(categories: FeedbackCategory[], sinceDateIso: string): Promise<Array<{ pageId: string; summary: string }>>;
}

/** Dedup store keyed on a stable message key (channelId:messageTs). */
export interface DedupStore {
  has(key: string): boolean;
  /** Record the key alongside the page ID returned by the writer (for later updates). */
  record(key: string, pageId: string): void;
  /** Return the stored page ID, or null for keys recorded before this field existed. */
  getPageId(key: string): string | null;
  /** Remove a key from the store (used when a "Not Feedback" verdict deletes a row). */
  delete(key: string): void;
  /** Find the dedup key associated with a Notion page ID. Returns null if not found. */
  findKeyByPageId(pageId: string): string | null;
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
  | "Assessment Accuracy/Validity"
  | "Compliance / Legal / Governance";

/**
 * Provider-agnostic forced tool-call interface. The model MUST call the named tool —
 * both Anthropic and OpenAI support this via tool_choice. Returns the parsed tool input,
 * or null on any failure (API error, malformed response, missing tool call).
 */
export interface LLMToolCall {
  complete(params: {
    system: string;
    userMessage: string;
    tool: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    };
    temperature?: number;
    maxTokens: number;
    images?: ImageAttachment[];
  }): Promise<Record<string, unknown> | null>;
}

export interface EnrichmentResult {
  summary: string;
  /** 1–2 AI-assigned categories. Never empty. */
  categories: FeedbackCategory[];
}

export interface Enricher {
  enrich(text: string, channelName: string, images?: ImageAttachment[]): Promise<EnrichmentResult | null>;
}

export type ConfidenceLevel = "High" | "Medium" | "Low";

export interface JudgeVerdict {
  confidence: ConfidenceLevel;
  rationale: string;
}

/**
 * Reviews an enrichment result against the original message (reference-grounded,
 * not self-comparison) and returns a pointwise confidence + short rationale.
 * Checks: category fit, multi-category justification (if 2 assigned), and summary faithfulness.
 */
export interface Judge {
  review(
    originalMessage: string,
    channelName: string,
    summary: string,
    categories: FeedbackCategory[],
  ): Promise<JudgeVerdict | null>;
}

export interface SimilarMatch {
  matchedPageId: string;
  rationale: string;
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
 * Detects whether a new capture duplicates an existing one, pointwise against a bounded
 * set of recent same-category candidates — not a general similarity search. Fails open
 * (null) on any error, same as Judge; a failed check must never block a capture.
 */
export interface SimilarityDetector {
  findSimilar(
    summary: string,
    categories: FeedbackCategory[],
    candidates: Array<{ pageId: string; summary: string }>,
  ): Promise<SimilarMatch | null>;
}

/**
 * Backfill-only gate: a scoped-down version of the deferred "is this feedback?" check
 * (ENRICHMENT-DESIGN-DECISIONS.md §2). High-recall by design — a human confirms every hit.
 * NOT wired into the live pipeline.
 */
export interface FeedbackGate {
  classify(text: string, channelName: string): Promise<FeedbackGateResult | null>;
}
