import type { Enricher } from "../../core/ports.js";

/** Enricher that always returns null. Wired when ANTHROPIC_API_KEY is not set. */
export class NullEnricher implements Enricher {
  async enrich(): Promise<null> {
    return null;
  }
}
