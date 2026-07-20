import type { SimilarityDetector } from "../../core/ports.js";

/** Similarity detector that always returns null. Wired when ANTHROPIC_API_KEY is not set. */
export class NullSimilarityDetector implements SimilarityDetector {
  async findSimilar(): Promise<null> {
    return null;
  }

  async selectMaster(): Promise<"existing"> {
    return "existing";
  }
}
