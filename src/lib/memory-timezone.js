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
