/**
 * Memory cron uses America/Los_Angeles by default (configurable).
 */

export function getMemoryTimezone() {
  return (
    process.env.OMIBOT_MEMORY_TIMEZONE ||
    process.env.OMIBOT_DAILY_LIMIT_TIMEZONE ||
    process.env.ANGELBOT_DAILY_LIMIT_TIMEZONE ||
    'America/Los_Angeles'
  );
}

/**
 * Calendar date YYYY-MM-DD in the memory timezone.
 * @param {Date} [now]
 * @returns {string}
 */
export function getMemoryCalendarDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: getMemoryTimezone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Calendar date YYYY-MM-DD for N days ago in the memory timezone.
 * @param {number} [daysAgo]
 * @param {Date} [now]
 * @returns {string}
 */
export function getMemoryCalendarDateDaysAgo(daysAgo = 1, now = new Date()) {
  const wholeDays = Math.max(0, Math.floor(Number(daysAgo) || 0));
  const shifted = new Date(now.getTime() - wholeDays * 24 * 60 * 60 * 1000);
  return getMemoryCalendarDate(shifted);
}
