import { getMemoryCalendarDate } from '../lib/memory-timezone.js';
import { listPaidUsersWithMessagesOnDate, listUserMessagesOnDate } from '../db/memory-messages.js';
import { generateMemorySummaryWithRetry, formatMessagesForSummarizer } from '../lib/memory-summarize.js';
import { getPool, isDbEnabled } from '../db/pool.js';

function getMemoryUserDelayMs() {
  const raw =
    process.env.OMIBOT_MEMORY_USER_DELAY_MS || process.env.ANGELBOT_MEMORY_USER_DELAY_MS || '3000';
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 3000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Regenerate memory summaries for paid users with messages on the given day.
 * Merges that day's conversations into the current summary (including user edits).
 * Retries transient Gemini failures; preserves prior summary if all attempts fail.
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
  const userDelayMs = getMemoryUserDelayMs();
  let summarizeCount = 0;

  for (const user of users) {
    try {
      if (user.memory_auto_update_enabled === false) {
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
      const userLabel = user.email || user.user_id;
      if (summarizeCount > 0 && userDelayMs > 0) {
        await sleep(userDelayMs);
      }
      summarizeCount++;
      const result = await generateMemorySummaryWithRetry({
        priorSummary,
        transcript,
        userLabel,
      });

      if (!result.ok) {
        console.error(
          'Memory regeneration failed for',
          user.user_id,
          'reason:',
          result.reason,
          result.error?.message || ''
        );
        errors++;
        continue;
      }

      await getPool().query(
        `UPDATE user_profiles SET
           memory_summary = $2,
           memory_summary_generated_at = NOW(),
           updated_at = NOW()
         WHERE user_id = $1`,
        [user.user_id, result.summary]
      );
      updated++;
    } catch (e) {
      console.error('Memory regeneration error for', user.user_id, e);
      errors++;
    }
  }

  return { processed: users.length, updated, skipped, errors };
}
