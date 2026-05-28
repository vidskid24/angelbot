import { getMemoryCalendarDate } from '../lib/memory-timezone.js';
import { listPaidUsersWithMessagesOnDate, listUserMessagesOnDate } from '../db/memory-messages.js';
import { generateMemorySummary, formatMessagesForSummarizer } from '../lib/memory-summarize.js';
import { getPool, isDbEnabled } from '../db/pool.js';

/**
 * Regenerate memory summaries for paid users with messages on the given day.
 * Skips users who edited the summary after the last auto-generation.
 * @param {string} [calendarDate] YYYY-MM-DD in memory timezone
 * @returns {Promise<{ processed: number; updated: number; skipped: number; errors: number }>}
 */
export async function regenerateUserMemoriesForDate(calendarDate = getMemoryCalendarDate()) {
  if (!isDbEnabled()) {
    return { processed: 0, updated: 0, skipped: 0, errors: 0 };
  }

  const users = await listPaidUsersWithMessagesOnDate(calendarDate);
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const user of users) {
    try {
      if (user.memory_auto_update_enabled === false) {
        skipped++;
        continue;
      }
      const editedAt = user.memory_summary_edited_at
        ? new Date(user.memory_summary_edited_at).getTime()
        : 0;
      const generatedAt = user.memory_summary_generated_at
        ? new Date(user.memory_summary_generated_at).getTime()
        : 0;
      if (editedAt > generatedAt) {
        skipped++;
        continue;
      }

      const messages = await listUserMessagesOnDate(user.user_id, calendarDate);
      if (!messages.length) {
        skipped++;
        continue;
      }

      const transcript = formatMessagesForSummarizer(messages);
      const priorSummary = String(user.memory_summary || '');
      const summary = await generateMemorySummary({
        priorSummary,
        transcript,
        userLabel: user.email || user.user_id,
      });

      await getPool().query(
        `UPDATE user_profiles SET
           memory_summary = $2,
           memory_summary_generated_at = NOW(),
           updated_at = NOW()
         WHERE user_id = $1`,
        [user.user_id, summary]
      );
      updated++;
    } catch (e) {
      console.error('Memory regeneration error for', user.user_id, e);
      errors++;
    }
  }

  return { processed: users.length, updated, skipped, errors };
}
