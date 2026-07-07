/** Header the human-curated guide is appended under, so it reads clearly in a prompt dump. */
const GUIDANCE_HEADER = "## Additional guidance (learned from human review)";

/**
 * Appends a human-curated guide (distilled rules) to a classifier's system prompt.
 *
 * Pure and fail-open: an empty / whitespace-only / absent guide returns the base prompt
 * unchanged, so "no rules yet" behaves exactly as the classifier did before. File I/O to load
 * the guide stays at the composition root; this function just does the (testable) injection.
 * Shared by the enricher and the similarity detector so the rule-injection logic is identical.
 */
export function appendGuidance(base: string, guide?: string): string {
  const trimmed = guide?.trim();
  if (!trimmed) return base;
  return `${base}\n\n${GUIDANCE_HEADER}\n${trimmed}`;
}
