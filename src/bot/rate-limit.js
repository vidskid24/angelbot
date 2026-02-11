/**
 * Per-user rate limit (requests per minute).
 */

const limit = parseInt(process.env.RATE_LIMIT_PER_MINUTE || '5', 10) || 5;
const windowMs = 60_000;
const timestamps = new Map();

/**
 * @param {string} userId - Discord user id
 * @returns {boolean} true if allowed, false if rate limited
 */
export function check(userId) {
  const now = Date.now();
  let list = timestamps.get(userId);
  if (!list) {
    timestamps.set(userId, [now]);
    return true;
  }
  const cutoff = now - windowMs;
  list = list.filter((t) => t > cutoff);
  if (list.length >= limit) return false;
  list.push(now);
  timestamps.set(userId, list);
  return true;
}
