/**
 * User tier (free / paid) and thread limits.
 */

import { isDbEnabled } from '../db/pool.js';
import * as users from '../db/users.js';

const FREE_THREAD_LIMIT =
  parseInt(process.env.OMIBOT_FREE_THREAD_LIMIT || process.env.ANGELBOT_FREE_THREAD_LIMIT || '3', 10) || 3;
const PAID_THREAD_LIMIT =
  parseInt(process.env.OMIBOT_PAID_THREAD_LIMIT || process.env.ANGELBOT_PAID_THREAD_LIMIT || '15', 10) || 15;
const FREE_DAILY_MESSAGE_LIMIT =
  parseInt(process.env.OMIBOT_FREE_DAILY_MESSAGE_LIMIT || process.env.ANGELBOT_FREE_DAILY_MESSAGE_LIMIT || '15', 10) ||
  15;
const PAID_DAILY_MESSAGE_LIMIT =
  parseInt(process.env.OMIBOT_PAID_DAILY_MESSAGE_LIMIT || process.env.ANGELBOT_PAID_DAILY_MESSAGE_LIMIT || '80', 10) ||
  80;

/**
 * @param {'free' | 'paid'} tier
 * @returns {number}
 */
export function getThreadLimitForTier(tier) {
  return tier === 'paid' ? PAID_THREAD_LIMIT : FREE_THREAD_LIMIT;
}

/**
 * @param {'free' | 'paid'} tier
 * @returns {number}
 */
export function getDailyMessageLimitForTier(tier) {
  return tier === 'paid' ? PAID_DAILY_MESSAGE_LIMIT : FREE_DAILY_MESSAGE_LIMIT;
}

/**
 * User-facing message when the daily message limit is reached.
 * @param {number} limit
 * @param {'free' | 'paid'} [tier]
 * @returns {string}
 */
export function getDailyMessageLimitMessage(limit, tier = 'free') {
  const cap = Number(limit) || FREE_DAILY_MESSAGE_LIMIT;
  if (tier === 'paid') {
    return (
      `You have reached today's limit of ${cap} messages on your plan. ` +
      'Please try again tomorrow, or email service@masteringalchemy.com if you need assistance.'
    );
  }
  return (
    `You have reached today's limit of ${cap} messages on your free plan. ` +
    'Please try again tomorrow, or upgrade to a paid plan for a higher daily limit.'
  );
}

/**
 * User-facing message when the saved-conversation limit is reached.
 * @param {number} limit
 * @param {'free' | 'paid'} [tier]
 * @returns {string}
 */
export function getThreadLimitMessage(limit, tier = 'free') {
  const cap = Number(limit) || FREE_THREAD_LIMIT;
  const planLabel = tier === 'paid' ? 'plan' : 'free plan';
  const base =
    `You can save up to ${cap} conversations on your ${planLabel}. ` +
    'Please delete one to continue or ask your question in one of your other saved conversations. ';
  if (tier === 'paid') {
    return (
      base +
      'If you would like a larger plan, please email and let us know, service@masteringalchemy.com'
    );
  }
  return base + 'You can also upgrade to a paid plan';
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
 * @param {{ force?: boolean }} [options] - force=true skips DB tier cache (e.g. on bootstrap)
 * @returns {Promise<'free' | 'paid'>}
 */
export async function ensureUserTier(userId, email, options = {}) {
  const force = options.force === true;

  if (!isDbEnabled()) {
    return resolveUserTier(userId, email);
  }

  const cacheMinutes =
    parseInt(process.env.OMIBOT_TIER_CACHE_MINUTES || process.env.ANGELBOT_TIER_CACHE_MINUTES || '60', 10) || 60;
  const existing = await users.getUserProfile(userId);
  if (!force && existing?.tier_checked_at) {
    const ageMs = Date.now() - new Date(existing.tier_checked_at).getTime();
    if (ageMs < cacheMinutes * 60 * 1000) {
      return existing.tier === 'paid' ? 'paid' : 'free';
    }
  }

  const tier = await resolveUserTier(userId, email);
  await users.upsertUserProfile(userId, email, tier);
  return tier;
}
