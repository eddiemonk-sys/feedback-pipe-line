import type { FeedbackGate, FeedbackGateResult } from "../../core/ports.js";

/** Used when no ANTHROPIC_API_KEY is set: classifies nothing. */
export class NullFeedbackGate implements FeedbackGate {
  async classify(): Promise<FeedbackGateResult | null> {
    return null;
  }
}
