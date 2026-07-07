import type { CaptureRequest } from "../core/events.js";
import type { FeedbackCategory } from "../core/ports.js";

export interface ReviewDecision {
  channelId: string;
  messageTs: string;
  /** "Is Feedback?" checkbox — only true rows are captured. */
  isFeedback: boolean;
  /** "Classification OK?" checkbox. */
  classificationOk: boolean;
  /** From the "Corrected Category" select, when the human overrode it. */
  correctedCategory?: FeedbackCategory;
  /** From the "Corrected Summary" text, when the human overrode it. */
  correctedSummary?: string;
}

/** Reconstruct the live-pipeline request from a confirmed review row. */
export function toCaptureRequest(d: ReviewDecision, triggeredBy: string): CaptureRequest {
  return {
    triggerType: "mega_reaction",
    channelId: d.channelId,
    messageTs: d.messageTs,
    triggeredBy,
  };
}

/**
 * The fields to patch onto the created Notion page after capture.
 * Returns null when the classification was accepted or no correction was supplied —
 * so the caller can skip the extra Notion write entirely.
 */
export function correctionFor(
  d: ReviewDecision,
): { category?: FeedbackCategory; summary?: string } | null {
  if (d.classificationOk) return null;
  const patch: { category?: FeedbackCategory; summary?: string } = {};
  if (d.correctedCategory) patch.category = d.correctedCategory;
  if (d.correctedSummary?.trim()) patch.summary = d.correctedSummary.trim();
  return Object.keys(patch).length ? patch : null;
}
