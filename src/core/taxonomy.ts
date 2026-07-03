import type { FeedbackCategory } from "./ports.js";

/**
 * Single source of truth for the category taxonomy, shared by the enricher (assigns
 * a category) and the judge (validates one) so the two can never drift apart.
 */
export const CATEGORIES: FeedbackCategory[] = [
  "Bug / Broken",
  "Feature Request",
  "Pricing / Commercial",
  "Onboarding / Setup",
  "UX / Usability",
  "Reporting / Data",
  "Praise",
  "Other",
  "Candidate Experience",
  "Assessment Accuracy/Validity",
];
