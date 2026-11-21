/**
 * Shared constants and helpers for chat components.
 */

import { truncate } from "@/lib/utils/format";

/** Collapse whitespace the same way the API does, for favourite matching. */
export function normalizeQuestion(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Proven starting questions shown in the empty state. */
export const STARTER_PROMPTS = [
  "Summarize the key points across our documents",
  "What is our onboarding process?",
  "Find the latest policy updates",
  "Which documents cover compliance?",
] as const;

/** Truncate a question for display in the empty state. */
export function truncateQuestion(question: string, maxLen = 60): string {
  return truncate(question, maxLen);
}
