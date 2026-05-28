/**
 * Whether the user meaningfully customized memory summary (sets edited_at for tracking).
 * Does not block nightly cron; cron always merges new chats into the current summary text.
 * @param {string} existingSummary
 * @param {string} incomingSummary
 * @returns {boolean}
 */
export function shouldSetMemorySummaryEdited(existingSummary, incomingSummary) {
  const trimmedIncoming = String(incomingSummary ?? '').trim();
  const trimmedExisting = String(existingSummary ?? '').trim();
  if (trimmedIncoming === trimmedExisting) return false;
  if (trimmedIncoming === '' && trimmedExisting === '') return false;
  return true;
}
