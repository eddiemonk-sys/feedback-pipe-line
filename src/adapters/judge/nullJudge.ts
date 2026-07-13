import type { Judge, FeedbackCategory, JudgeVerdict } from "../../core/ports.js";

/** Judge that always returns null. Wired when ANTHROPIC_API_KEY is not set. */
export class NullJudge implements Judge {
  async review(
    _originalMessage: string,
    _channelName: string,
    _summary: string,
    _categories: FeedbackCategory[],
  ): Promise<JudgeVerdict | null> {
    return null;
  }
}
