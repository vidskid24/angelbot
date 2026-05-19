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
 * @returns {Promise<{ tone: string; maExperience: string; preferencesCompleted: boolean }>}
 */
export async function getUserPreferences(userId) {
  const { rows } = await getPool().query(
    `SELECT tone, ma_experience, preferences_completed_at
     FROM user_profiles WHERE user_id = $1`,
    [userId]
  );
  const row = rows[0];
  if (!row) {
    return {
      ...normalizePreferences({}),
      preferencesCompleted: false,
    };
  }
  const prefs = normalizePreferences({
    tone: row.tone,
    maExperience: row.ma_experience,
  });
  return {
    ...prefs,
    preferencesCompleted: Boolean(row.preferences_completed_at),
  };
}

/**
 * @param {string} userId
 * @param {{ tone: string; maExperience: string; markCompleted?: boolean }} prefs
 */
export async function updateUserPreferences(userId, prefs) {
  const { tone, maExperience } = normalizePreferences(prefs);
  const markCompleted = prefs.markCompleted !== false;
  await getPool().query(
    `UPDATE user_profiles SET
       tone = $2,
       ma_experience = $3,
       preferences_completed_at = CASE
         WHEN $4 THEN COALESCE(preferences_completed_at, NOW())
         ELSE preferences_completed_at
       END,
       updated_at = NOW()
     WHERE user_id = $1`,
    [userId, tone, maExperience, markCompleted]
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
