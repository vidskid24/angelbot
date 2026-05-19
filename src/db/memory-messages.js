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
     ORDER BY tm.created_at ASC
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
 * Paid users with chat activity on the given calendar day (memory timezone).
 * @param {string} [calendarDate]
 */
export async function listPaidUsersActiveOnDate(calendarDate = getMemoryCalendarDate()) {
  const tz = getMemoryTimezone();
  const { rows } = await getPool().query(
    `SELECT user_id, email, memory_summary, memory_summary_generated_at,
            memory_summary_edited_at, memory_auto_update_enabled
     FROM user_profiles
     WHERE tier = 'paid'
       AND last_chat_activity_at IS NOT NULL
       AND (last_chat_activity_at AT TIME ZONE $1)::date = $2::date`,
    [tz, calendarDate]
  );
  return rows;
}
