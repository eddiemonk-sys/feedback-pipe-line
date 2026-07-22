/**
 * Digest ports — interfaces consumed by the weekly Slack digest job (DS-68/DS-69).
 * Concrete implementations live in src/adapters/. The scheduler in index.ts wires them.
 */

export interface DigestFeedbackItem {
  title: string;
  summary: string;
  categories: string[];
  dateIso: string;
  customerAccount: string;
  /** Number of related feedback rows linked to this item (demand signal). */
  relatedCount: number;
  /** Notion Status field — used for the close-the-loop section (DS-83). */
  status?: string;
}

/** Reads recent captured feedback for the digest. */
export interface FeedbackDigestReader {
  readRecentFeedback(daysBefore: number): Promise<DigestFeedbackItem[]>;
}

/** Transforms a list of feedback items into a Slack-formatted digest string. */
export interface DigestBuilder {
  buildDigest(items: DigestFeedbackItem[], weekLabel: string): Promise<string>;
}

/** Writes a digest to a Notion page (DS-66). Returns the page URL. */
export interface DigestNotionWriter {
  writeDigest(digestText: string, weekLabel: string): Promise<string>;
}
