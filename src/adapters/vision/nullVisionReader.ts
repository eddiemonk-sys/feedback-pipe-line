import type { VisionReader } from "../../core/ports.js";

/** Vision reader that always returns null. Wired when ANTHROPIC_API_KEY is not set. */
export class NullVisionReader implements VisionReader {
  async describe(): Promise<null> {
    return null;
  }
}
