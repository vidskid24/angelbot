import { getPool } from './pool.js';

/**
 * Calendar date (YYYY-MM-DD) for daily limits in the configured timezone.
 * @returns {string}
 */
export function getDailyUsageDateString() {
  const tz =
    process.env.OMIBOT_DAILY_LIMIT_TIMEZONE ||
    process.env.ANGELBOT_DAILY_LIMIT_TIMEZONE ||
    'America/Los_Angeles';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * @param {string} userId
 * @param {string} [usageDate]
 * @returns {Promise<number>}
 */
export async function getDailyMessageCount(userId, usageDate = getDailyUsageDateString()) {
  const { rows } = await getPool().query(
    `SELECT message_count FROM user_daily_message_usage
     WHERE user_id = $1 AND usage_date = $2`,
    [userId, usageDate]
  );
  return rows[0]?.message_count ?? 0;
}

/**
 * @param {string} userId
 * @param {string} [usageDate]
 */
export async function incrementDailyMessageCount(userId, usageDate = getDailyUsageDateString()) {
  await getPool().query(
    `INSERT INTO user_daily_message_usage (user_id, usage_date, message_count)
     VALUES ($1, $2, 1)
     ON CONFLICT (user_id, usage_date)
     DO UPDATE SET message_count = user_daily_message_usage.message_count + 1`,
    [userId, usageDate]
  );
}
