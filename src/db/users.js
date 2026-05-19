import { getPool } from './pool.js';
import { normalizePreferences } from '../lib/user-preferences.js';

/**
 * @param {string} userId
 * @returns {Promise<{ user_id: string; email: string | null; tier: string; tier_checked_at: Date | null } | null>}
 */
export async function getUserProfile(userId) {
  const { rows } = await getPool().query(
    `SELECT user_id, email, tier, tier_checked_at, created_at, updated_at
     FROM user_profiles WHERE user_id = $1`,
    [userId]
  );
  return rows[0] || null;
}

/**
 * @param {string} userId
 * @returns {Promise<{
 *   tone: string;
 *   maExperience: string;
 *   preferencesCompleted: boolean;
 *   tier: 'free' | 'paid';
 *   memoryInstructions: string;
 *   memorySummary: string;
 *   memorySummaryGeneratedAt: string | null;
 *   memorySummaryEditedAt: string | null;
 *   memoryAutoUpdateEnabled: boolean;
 *   memoryAvailable: boolean;
 * }>}
 */
export async function getUserSettings(userId) {
  const { rows } = await getPool().query(
    `SELECT tone, ma_experience, preferences_completed_at, tier,
            memory_instructions, memory_summary,
            memory_summary_generated_at, memory_summary_edited_at,
            memory_auto_update_enabled
     FROM user_profiles WHERE user_id = $1`,
    [userId]
  );
  const row = rows[0];
  const tier = row?.tier === 'paid' ? 'paid' : 'free';
  if (!row) {
    return {
      ...normalizePreferences({}),
      preferencesCompleted: false,
      tier: 'free',
      memoryInstructions: '',
      memorySummary: '',
      memorySummaryGeneratedAt: null,
      memorySummaryEditedAt: null,
      memoryAutoUpdateEnabled: true,
      memoryAvailable: false,
    };
  }
  const prefs = normalizePreferences({
    tone: row.tone,
    maExperience: row.ma_experience,
  });
  return {
    ...prefs,
    preferencesCompleted: Boolean(row.preferences_completed_at),
    tier,
    memoryInstructions: String(row.memory_instructions || ''),
    memorySummary: String(row.memory_summary || ''),
    memorySummaryGeneratedAt: row.memory_summary_generated_at
      ? new Date(row.memory_summary_generated_at).toISOString()
      : null,
    memorySummaryEditedAt: row.memory_summary_edited_at
      ? new Date(row.memory_summary_edited_at).toISOString()
      : null,
    memoryAutoUpdateEnabled: row.memory_auto_update_enabled !== false,
    memoryAvailable: tier === 'paid',
  };
}

/** @deprecated Use getUserSettings */
export async function getUserPreferences(userId) {
  return getUserSettings(userId);
}

/**
 * @param {string} userId
 * @param {{
 *   tone?: string;
 *   maExperience?: string;
 *   markCompleted?: boolean;
 *   memoryInstructions?: string;
 *   memorySummary?: string;
 *   memorySummaryEdited?: boolean;
 *   memoryAutoUpdateEnabled?: boolean;
 * }} prefs
 */
export async function updateUserSettings(userId, prefs) {
  const { tone, maExperience } = normalizePreferences(prefs);
  const markCompleted = prefs.markCompleted !== false;

  const fields = ['tone = $2', 'ma_experience = $3'];
  const values = [userId, tone, maExperience];
  let idx = 4;

  fields.push(
    `preferences_completed_at = CASE
       WHEN $${idx} THEN COALESCE(preferences_completed_at, NOW())
       ELSE preferences_completed_at
     END`
  );
  values.push(markCompleted);
  idx++;

  if (prefs.memoryInstructions !== undefined) {
    fields.push(`memory_instructions = $${idx}`);
    values.push(String(prefs.memoryInstructions || '').slice(0, 12000));
    idx++;
  }

  if (prefs.memorySummary !== undefined) {
    fields.push(`memory_summary = $${idx}`);
    values.push(String(prefs.memorySummary || '').slice(0, 16000));
    idx++;
    if (prefs.memorySummaryEdited) {
      fields.push(`memory_summary_edited_at = NOW()`);
    }
  }

  if (prefs.memoryAutoUpdateEnabled !== undefined) {
    fields.push(`memory_auto_update_enabled = $${idx}`);
    values.push(Boolean(prefs.memoryAutoUpdateEnabled));
    idx++;
  }

  fields.push('updated_at = NOW()');

  await getPool().query(
    `UPDATE user_profiles SET ${fields.join(', ')} WHERE user_id = $1`,
    values
  );
}

/** @deprecated Use updateUserSettings */
export async function updateUserPreferences(userId, prefs) {
  return updateUserSettings(userId, prefs);
}

/**
 * @param {string} userId
 */
export async function touchUserChatActivity(userId) {
  await getPool().query(
    `UPDATE user_profiles SET last_chat_activity_at = NOW(), updated_at = NOW() WHERE user_id = $1`,
    [userId]
  );
}

/**
 * @param {string} userId
 * @param {string} [email]
 * @param {'free' | 'paid'} tier
 */
export async function upsertUserProfile(userId, email, tier) {
  await getPool().query(
    `INSERT INTO user_profiles (user_id, email, tier, tier_checked_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, user_profiles.email),
       tier = EXCLUDED.tier,
       tier_checked_at = NOW(),
       updated_at = NOW()`,
    [userId, email || null, tier]
  );
}
