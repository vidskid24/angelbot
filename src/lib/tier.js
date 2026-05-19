/**
 * User tier (free / paid) and thread limits.
 */

import { isDbEnabled } from '../db/pool.js';
import * as users from '../db/users.js';

const FREE_THREAD_LIMIT =
  parseInt(process.env.OMIBOT_FREE_THREAD_LIMIT || process.env.ANGELBOT_FREE_THREAD_LIMIT || '2', 10) || 2;
const PAID_THREAD_LIMIT =
  parseInt(process.env.OMIBOT_PAID_THREAD_LIMIT || process.env.ANGELBOT_PAID_THREAD_LIMIT || '10', 10) || 10;

/**
 * @param {'free' | 'paid'} tier
 * @returns {number}
 */
export function getThreadLimitForTier(tier) {
  return tier === 'paid' ? PAID_THREAD_LIMIT : FREE_THREAD_LIMIT;
}

/**
 * Resolve tier for a user (Thinkific enrollment when configured, else free).
 * @param {string} userId
 * @param {string} [email]
 * @returns {Promise<'free' | 'paid'>}
 */
export async function resolveUserTier(userId, email) {
  const forced = String(process.env.OMIBOT_FORCE_TIER || process.env.ANGELBOT_FORCE_TIER || '')
    .trim()
    .toLowerCase();
  if (forced === 'paid' || forced === 'free') return forced;

  const paidIds = String(process.env.OMIBOT_PAID_USER_IDS || process.env.ANGELBOT_PAID_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (paidIds.includes(userId)) return 'paid';

  const { hasActivePaidEnrollment } = await import('./thinkific-enrollment.js');
  if (await hasActivePaidEnrollment(userId, email)) return 'paid';

  return 'free';
}

/**
 * Ensure user row exists and refresh tier when stale.
 * @param {string} userId
 * @param {string} [email]
 * @returns {Promise<'free' | 'paid'>}
 */
export async function ensureUserTier(userId, email) {
  if (!isDbEnabled()) {
    return resolveUserTier(userId, email);
  }

  const cacheMinutes =
    parseInt(process.env.OMIBOT_TIER_CACHE_MINUTES || process.env.ANGELBOT_TIER_CACHE_MINUTES || '60', 10) || 60;
  const existing = await users.getUserProfile(userId);
  if (existing?.tier_checked_at) {
    const ageMs = Date.now() - new Date(existing.tier_checked_at).getTime();
    if (ageMs < cacheMinutes * 60 * 1000) {
      return existing.tier === 'paid' ? 'paid' : 'free';
    }
  }

  const tier = await resolveUserTier(userId, email);
  await users.upsertUserProfile(userId, email, tier);
  return tier;
}
