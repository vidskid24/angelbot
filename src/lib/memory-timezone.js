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
 * @param {Date} now
 * @param {string} timeZone
 * @returns {string} YYYY-MM-DD
 */
function formatCalendarDateInZone(now, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Calendar date YYYY-MM-DD in the memory timezone.
 * @param {Date} [now]
 * @returns {string}
 */
export function getMemoryCalendarDate(now = new Date()) {
  return formatCalendarDateInZone(now, getMemoryTimezone());
}

/**
 * UTC ms of the first instant of a calendar day (00:00:00.000) in a timezone.
 * @param {string} ymd YYYY-MM-DD
 * @param {string} timeZone
 */
function zonedMidnightUtcMs(ymd, timeZone) {
  const [Y, M, D] = ymd.split('-').map(Number);
  let lo = Date.UTC(Y, M - 1, D - 2);
  let hi = Date.UTC(Y, M - 1, D + 2);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (formatCalendarDateInZone(new Date(mid), timeZone) < ymd) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Add or subtract whole calendar days in a timezone (handles DST).
 * @param {string} ymd YYYY-MM-DD
 * @param {number} dayDelta
 * @param {string} [timeZone]
 * @returns {string}
 */
export function shiftMemoryCalendarDate(ymd, dayDelta, timeZone = getMemoryTimezone()) {
  const delta = Math.trunc(Number(dayDelta) || 0);
  if (!delta) return ymd;

  let current = ymd;
  const steps = Math.abs(delta);
  const sign = delta > 0 ? 1 : -1;

  for (let i = 0; i < steps; i++) {
    const midnight = zonedMidnightUtcMs(current, timeZone);
    if (sign > 0) {
      let probe = midnight + 24 * 60 * 60 * 1000;
      while (formatCalendarDateInZone(new Date(probe), timeZone) === current) {
        probe += 60 * 60 * 1000;
      }
      current = formatCalendarDateInZone(new Date(probe), timeZone);
    } else {
      current = formatCalendarDateInZone(new Date(midnight - 1), timeZone);
    }
  }

  return current;
}

/**
 * Calendar date YYYY-MM-DD for N calendar days ago in the memory timezone.
 * @param {number} [daysAgo]
 * @param {Date} [now]
 * @returns {string}
 */
export function getMemoryCalendarDateDaysAgo(daysAgo = 1, now = new Date()) {
  const wholeDays = Math.max(0, Math.floor(Number(daysAgo) || 0));
  const today = getMemoryCalendarDate(now);
  if (wholeDays === 0) return today;
  return shiftMemoryCalendarDate(today, -wholeDays, getMemoryTimezone());
}
