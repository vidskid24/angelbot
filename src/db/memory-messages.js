import { getPool } from './pool.js';
import { getMemoryCalendarDate, getMemoryTimezone } from '../lib/memory-timezone.js';

/**
 * Messages from all threads for a user on a given calendar day (memory timezone).
 * @param {string} userId
 * @param {string} [calendarDate] YYYY-MM-DD
 * @param {number} [limit]
 */
export async function listUserMessagesOnDate(userId, calendarDate = getMemoryCalendarDate(), limit = 120) {
  const tz = getMemoryTimezone();
  const { rows } = await getPool().query(
    `SELECT tm.role, tm.content, tm.created_at, t.title AS thread_title
     FROM thread_messages tm
     INNER JOIN threads t ON t.id = tm.thread_id
     WHERE t.user_id = $1
       AND (tm.created_at AT TIME ZONE $2)::date = $3::date
     ORDER BY tm.created_at ASC, tm.id ASC
     LIMIT $4`,
    [userId, tz, calendarDate, limit]
  );
  return rows.map((r) => ({
    role: r.role === 'assistant' ? 'assistant' : 'user',
    content: String(r.content || ''),
    createdAt: r.created_at,
    threadTitle: r.thread_title,
  }));
}

/**
 * Paid users with at least one thread message on the given calendar day (memory timezone).
 * Uses message dates, not last_chat_activity_at, so backfill includes users who chatted
 * on that day even if they have since chatted on a later day.
 * @param {string} [calendarDate]
 */
export async function listPaidUsersWithMessagesOnDate(calendarDate = getMemoryCalendarDate()) {
  const tz = getMemoryTimezone();
  const { rows } = await getPool().query(
    `SELECT DISTINCT up.user_id, up.email, up.memory_summary,
            up.memory_auto_update_enabled
     FROM user_profiles up
     INNER JOIN threads t ON t.user_id = up.user_id
     INNER JOIN thread_messages tm ON tm.thread_id = t.id
     WHERE up.tier = 'paid'
       AND (tm.created_at AT TIME ZONE $1)::date = $2::date`,
    [tz, calendarDate]
  );
  return rows;
}

/** @deprecated Use listPaidUsersWithMessagesOnDate */
export const listPaidUsersActiveOnDate = listPaidUsersWithMessagesOnDate;
