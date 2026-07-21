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
}

/** Reads recent captured feedback for the digest. */
export interface FeedbackDigestReader {
  readRecentFeedback(daysBefore: number): Promise<DigestFeedbackItem[]>;
}

/** Transforms a list of feedback items into a Slack-formatted digest string. */
export interface DigestBuilder {
  buildDigest(items: DigestFeedbackItem[], weekLabel: string): Promise<string>;
}
