/**
 * Shared post-processing for chat completions.
 * Keeps Discord-facing behavior identical when output hits the token cap.
 *
 * @param {string} content - Raw assistant text (may be empty)
 * @param {boolean} truncatedByLength - True when the provider stopped due to max output tokens
 * @returns {string}
 */
export function finalizeAssistantText(content, truncatedByLength) {
  const c = content ?? '';
  if (truncatedByLength && c.trim()) {
    return `${c.trim()}\n\nThat's a start—**which part** would you like to go deeper on?`;
  }
  if (truncatedByLength) {
    return "That's a start—**which part** would you like to go deeper on?";
  }
  if (c) return c;
  throw new Error('Empty or missing LLM response');
}
