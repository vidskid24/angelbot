/**
 * Resolve which Thinkific course link variant (owned vs membership) applies to a user.
 * Separate from Omi paid/free tier — picks the classroom URL for RAG source lines.
 */

import {
  isThinkificConfigured,
  fetchThinkificEnrollments,
  fetchThinkificCourses,
  isThinkificEnrollmentActive,
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

function slugSetForLevel(levelEntry) {
  const slugs = new Set();
  const variants = levelEntry?.variants && typeof levelEntry.variants === 'object' ? levelEntry.variants : {};
  for (const variant of Object.values(variants)) {
    const slug = String(variant?.courseSlug || '').trim().replace(/^\/+|\/+$/g, '').toLowerCase();
    if (slug) slugs.add(slug);
  }
  return slugs;
}

function compactName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function enrollmentNameMatchesLevel(enrollment, levelEntry, courseMeta) {
  const slugs = slugSetForLevel(levelEntry);
  const courseSlug = String(courseMeta?.slug || '').trim().toLowerCase();
  if (courseSlug && slugs.has(courseSlug)) return true;

  const catalogTitle = compactName(levelEntry?.title);
  const names = [
    enrollment.product_name,
    enrollment.course_name,
    enrollment.name,
    enrollment.bundle_name,
    courseMeta?.name,
  ]
    .map(compactName)
    .filter(Boolean);

  if (catalogTitle && names.some((n) => n === catalogTitle || n.includes(catalogTitle) || catalogTitle.includes(n))) {
    return true;
  }

  for (const slug of slugs) {
    const fromSlug = compactName(slug.replace(/-/g, ' '));
    if (fromSlug.length >= 8 && names.some((n) => n.includes(fromSlug) || fromSlug.includes(n))) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the user has an active Thinkific enrollment in this catalog course
 * (owned classroom, membership classroom, or membership product for L1–L5).
 * When Thinkific is not configured, paid-scoped access is allowed (local/dev).
 * @param {string} userId
 * @param {string | undefined} email
 * @param {string} levelCode
 * @param {import('../rag/course-catalog.js').CourseCatalog | null | undefined} catalog
 * @returns {Promise<boolean>}
 */
export async function userHasAccessToCourseLevel(userId, email, levelCode, catalog) {
  const code = String(levelCode || '').trim();
  const levelEntry = code && catalog?.levels ? catalog.levels[code] : null;
  if (!code || !levelEntry) return false;
  if (!isThinkificConfigured()) return true;

  const thinkificUserId = String(userId || '').trim();
  if (!thinkificUserId && !email) return false;
  if (thinkificUserId.startsWith('email:') && !email) return false;

  try {
    const membershipBase = parseProductMatchersFromEnv('THINKIFIC_MEMBERSHIP_PRODUCT_IDS');
    const hasMembershipConfig = membershipBase.ids.size > 0 || membershipBase.names.size > 0;
    const hasMembershipVariant = Boolean(levelEntry.variants?.membership);

    const [items, courses, membershipMatchers] = await Promise.all([
      fetchThinkificEnrollments(userId, email),
      fetchThinkificCourses(),
      hasMembershipConfig && hasMembershipVariant
        ? buildEffectiveMatchers(membershipBase)
        : Promise.resolve(null),
    ]);

    /** @type {Map<number, { id: number; name: string; slug: string }>} */
    const courseById = new Map();
    for (const course of courses) {
      if (course.id > 0) courseById.set(course.id, course);
    }

    for (const enrollment of items) {
      if (!isThinkificEnrollmentActive(enrollment)) continue;
      const cid = Number(enrollment.course_id);
      const courseMeta = Number.isFinite(cid) && cid > 0 ? courseById.get(cid) : null;
      if (enrollmentNameMatchesLevel(enrollment, levelEntry, courseMeta)) return true;
      if (membershipMatchers && isActiveEnrollmentForProduct(enrollment, membershipMatchers)) {
        return true;
      }
    }
    return false;
  } catch (err) {
    console.warn('Course enrollment check failed:', err?.message || err);
    return false;
  }
}
