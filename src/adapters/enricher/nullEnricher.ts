import type { Enricher, ImageAttachment } from "../../core/ports.js";

/** Enricher that always returns null. Wired when ANTHROPIC_API_KEY is not set. */
export class NullEnricher implements Enricher {
  async enrich(_text: string, _channelName: string, _images?: ImageAttachment[]): Promise<null> {
    return null;
  }
}
