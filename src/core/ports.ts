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
  /** channelId:messageTs of the parent Slack message. Present on all rows from a batch-split capture. */
  sourceMessageKey?: string;
  /** Framing text from the message header. Propagated to every child row in a batch split. */
  preambleContext?: string;
  /** @mention display names within this item's bullet (not preamble-level mentions). */
  mentionedUsers?: string[];
  /** Notion page IDs of sibling rows from the same batch split. Populated in pass 2. */
  siblingPageIds?: string[];
  /** Initial Notion Status. Defaults to "New". Live gate sets "Needs Review" for medium/low confidence. */
  status?: "New" | "Needs Review";
  /** Company name of the external client (Granola ingestion). Derived from participant email domain or meeting title. */
  clientCompany?: string;
  /** Primary audience persona for this feedback item (Granola ingestion). */
  audience?: "Recruiter" | "Talent Leader" | "Candidate" | "Worker" | "Admin" | "Unknown";
}

export interface NotionWriter {
  /** Write a new feedback row. Returns the page/record ID for later updates. */
  createFeedback(record: FeedbackRecord): Promise<string>;
  /** Append a new flagger name to the "Flagged By" field of an existing row. */
  appendFlagger(pageId: string, newFlaggerName: string): Promise<void>;
  /** Recent rows in any of the given categories, for similarity comparison. */
  findRecentByCategories(categories: FeedbackCategory[], sinceDateIso: string): Promise<Array<{ pageId: string; summary: string }>>;
  /**
   * Write the `Siblings` relation on a page, linking it to all sibling page IDs.
   * Called in pass 2 after all child rows are created. Fails open — caller logs and continues.
   */
  updateSiblingLinks(pageId: string, siblingPageIds: string[]): Promise<void>;

  /**
   * Appends a timestamped thread log block to the Notion page body for this reply.
   * Fails open — a block append failure must never surface as a capture error.
   */
  updateSummaryAndLog(
    pageId: string,
    replyText: string,
    replyAuthorName: string,
    replyTs: string,
    images?: ImageAttachment[],
  ): Promise<void>;

  /**
   * Fetch the summary and preamble context for a set of page IDs.
   * Used to build the candidates array for ThreadRouter.route().
   * Returns only pages that have a Summary property set.
   */
  getPageSummaries(
    pageIds: string[],
  ): Promise<Array<{ pageId: string; summary: string; preambleContext?: string }>>;
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
  /**
   * Record a batch-split key alongside all its page IDs (replaces individual `record()` calls
   * when a single message produces multiple rows).
   */
  recordMultiple(key: string, pageIds: string[]): void;
  /**
   * Return all page IDs stored for a key. Returns `[]` if the key is absent.
   * For legacy entries (single string or null), wraps in array for uniform iteration.
   */
  getPageIds(key: string): string[];
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
  // Batch metadata — populated only when the enricher splits a message into multiple items:
  preambleContext?: string;     // framing text from message header (e.g. "Call notes from DTG meeting:")
  clientName?: string;          // account name extracted from preamble; explicit only, never inferred
  mentionedUsers?: string[];    // @mention display names within this item's bullet
  imageIndices?: number[];      // indices into the parent images[] array this item claims
}

export interface Enricher {
  enrich(text: string, channelName: string, images?: ImageAttachment[]): Promise<EnrichmentResult[] | null>;
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

export interface ThreadRouterResult {
  /** The page ID of the row this reply is relevant to. */
  pageId: string;
  /** "primary" if the reply directly addresses this row; "secondary" if tangentially relevant. */
  relevance: "primary" | "secondary";
  /** One sentence explaining why this row matches. */
  rationale: string;
}

/**
 * Routes a thread reply to the Notion row(s) it most likely addresses.
 * Returns [] on any failure (fail-open). Never throws.
 */
export interface ThreadRouter {
  route(
    replyText: string,
    replyImages: ImageAttachment[],
    candidates: Array<{ pageId: string; summary: string; preambleContext?: string }>,
  ): Promise<ThreadRouterResult[]>;
}

/** A meeting note from Granola, reduced to what the core needs. */
export interface GranolaNote {
  id: string;
  title: string;
  /** ISO 8601 date string. */
  createdAt: string;
}

/**
 * Provider-agnostic Granola client. The real adapter uses the Granola MCP tools;
 * tests use a stub. Fails open — listNotes returns [] on any error.
 */
export interface GranolaClient {
  /** List all notes in a given folder. Returns [] if folder is empty or on error. */
  listNotes(folderId: string): Promise<GranolaNote[]>;
  /** Fetch the full markdown content of a specific note. Returns "" on error. */
  getNoteContent(noteId: string): Promise<string>;
}

export interface GranolaGateResult {
  /** True if this meeting note contains client feedback worth capturing. */
  shouldCapture: boolean;
  /** One short sentence explaining the decision. */
  reason: string;
}

/**
 * Gate for Granola meeting notes. Decides whether a note contains client-facing
 * product feedback worth ingesting. Fails open — returns null on any error, which
 * the adapter treats as "capture" (high-recall bias).
 */
export interface GranolaGate {
  classify(
    title: string,
    markdownContent: string,
    participants: string[],
  ): Promise<GranolaGateResult | null>;
}
