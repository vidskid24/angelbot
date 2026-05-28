/**
 * Whether saving memory summary should block automatic cron updates.
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
