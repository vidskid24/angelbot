/**
 * Resolve which Thinkific course link variant (owned vs membership) applies to a user.
 * Separate from Omi paid/free tier — picks the classroom URL for RAG source lines.
 */

import {
  isThinkificConfigured,
  fetchThinkificEnrollments,
  resolveProductIdsFromNames,
} from './thinkific-enrollment.js';

/** @typedef {'owned' | 'membership'} CourseLinkVariant */

/**
 * @param {string} envKey
 * @returns {{ ids: Set<number>; names: Set<string> }}
 */
export function parseProductMatchersFromEnv(envKey) {
  const ids = new Set();
  const names = new Set();
  const raw = String(process.env[envKey] || '').trim();
  if (!raw) return { ids, names };

  for (const part of raw.split(',')) {
    const token = part.trim();
    if (!token) continue;
    const n = Number(token);
    if (!Number.isNaN(n) && n > 0) {
      ids.add(n);
      continue;
    }
    names.add(token.toLowerCase());
  }
  return { ids, names };
}

function parseOwnedProductMatchers() {
  const owned = parseProductMatchersFromEnv('THINKIFIC_OWNED_PRODUCT_IDS');
  if (owned.ids.size > 0 || owned.names.size > 0) return owned;
  return parseProductMatchersFromEnv('THINKIFIC_DOWNLOAD_PRODUCT_IDS');
}

/**
 * @param {{ ids: Set<number>; names: Set<string> }} base
 * @returns {Promise<{ ids: Set<number>; names: Set<string> }>}
 */
async function buildEffectiveMatchers(base) {
  const resolvedIdsFromNames = await resolveProductIdsFromNames(base.names);
  const ids = new Set(base.ids);
  for (const id of resolvedIdsFromNames) ids.add(id);
  return { ids, names: base.names };
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * @param {object} enrollment
 * @param {{ ids: Set<number>; names: Set<string> }} matchers
 * @returns {boolean}
 */
function enrollmentMatchesProduct(enrollment, matchers) {
  const pid = enrollment.product_id ?? enrollment.course_id ?? enrollment.productable_id;
  const productNum = Number(pid);
  if (!Number.isNaN(productNum) && productNum > 0 && matchers.ids.has(productNum)) {
    return true;
  }

  const candidateNames = [
    enrollment.product_name,
    enrollment.course_name,
    enrollment.name,
    enrollment.bundle_name,
  ]
    .map(normalizeName)
    .filter(Boolean);

  for (let i = 0; i < candidateNames.length; i++) {
    if (matchers.names.has(candidateNames[i])) return true;
  }
  return false;
}

/**
 * @param {object} enrollment
 * @param {{ ids: Set<number>; names: Set<string> }} matchers
 * @returns {boolean}
 */
function isActiveEnrollmentForProduct(enrollment, matchers) {
  if (!enrollmentMatchesProduct(enrollment, matchers)) return false;
  if (enrollment.is_free_trial === true) return false;
  if (enrollment.expired === true) return false;
  if (enrollment.expiry_date) {
    const exp = new Date(enrollment.expiry_date);
    if (!Number.isNaN(exp.getTime()) && exp.getTime() < Date.now()) return false;
  }
  return true;
}

/**
 * Prefer owned when the user has both enrollments.
 * @param {string} userId
 * @param {string} [email]
 * @returns {Promise<CourseLinkVariant | null>}
 */
export async function resolveCourseLinkVariant(userId, email) {
  const forced = String(
    process.env.OMIBOT_COURSE_LINK_VARIANT || process.env.ANGELBOT_COURSE_LINK_VARIANT || ''
  )
    .trim()
    .toLowerCase();
  if (forced === 'owned' || forced === 'download') return 'owned';
  if (forced === 'membership') return 'membership';

  if (!isThinkificConfigured()) return null;

  const ownedBase = parseOwnedProductMatchers();
  const membershipBase = parseProductMatchersFromEnv('THINKIFIC_MEMBERSHIP_PRODUCT_IDS');
  const hasOwnedConfig = ownedBase.ids.size > 0 || ownedBase.names.size > 0;
  const hasMembershipConfig = membershipBase.ids.size > 0 || membershipBase.names.size > 0;
  if (!hasOwnedConfig && !hasMembershipConfig) return null;

  const thinkificUserId = String(userId || '').trim();
  if (!thinkificUserId && !email) return null;
  if (thinkificUserId.startsWith('email:') && !email) return null;

  try {
    const [ownedMatchers, membershipMatchers, items] = await Promise.all([
      hasOwnedConfig ? buildEffectiveMatchers(ownedBase) : Promise.resolve(null),
      hasMembershipConfig ? buildEffectiveMatchers(membershipBase) : Promise.resolve(null),
      fetchThinkificEnrollments(userId, email),
    ]);

    let hasOwned = false;
    let hasMembership = false;

    for (const enrollment of items) {
      if (ownedMatchers && isActiveEnrollmentForProduct(enrollment, ownedMatchers)) {
        hasOwned = true;
      }
      if (membershipMatchers && isActiveEnrollmentForProduct(enrollment, membershipMatchers)) {
        hasMembership = true;
      }
    }

    if (hasOwned) return 'owned';
    if (hasMembership) return 'membership';
    return null;
  } catch (err) {
    console.warn('Course link variant check failed:', err?.message || err);
    return null;
  }
}
