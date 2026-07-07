import { readFileSync } from "node:fs";

/**
 * Reads a distilled-rules guide file (e.g. the enrichment style guide) for injection into a
 * classifier's system prompt. Fail-open: any error — missing file, unreadable, etc. — returns
 * "" so "no guide yet" behaves exactly as the classifier did before. Called only at the
 * composition root, keeping file I/O at the edges (the injection itself is the pure
 * `appendGuidance`, which is unit-tested).
 */
export function loadGuideFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
