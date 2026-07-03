import type { Judge } from "../../core/ports.js";

/** Judge that always returns null. Wired when ANTHROPIC_API_KEY is not set. */
export class NullJudge implements Judge {
  async review(): Promise<null> {
    return null;
  }
}
