import { getPool } from './pool.js';

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
