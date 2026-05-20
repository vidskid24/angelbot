/**
 * Check Thinkific active enrollment for paid product(s) (option B).
 * Requires THINKIFIC_API_KEY, THINKIFIC_SUBDOMAIN, and THINKIFIC_PAID_PRODUCT_IDS (comma-separated).
 * Each entry may be a numeric Thinkific product/course id or an exact product/course name (case-insensitive).
 */

const API_BASE = 'https://api.thinkific.com/api/public/v1';

/**
 * @returns {{ ids: Set<number>; names: Set<string> }}
 */
export function parsePaidProductMatchers() {
  const ids = new Set();
  const names = new Set();
  const raw = String(process.env.THINKIFIC_PAID_PRODUCT_IDS || '').trim();
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

/** @deprecated Use parsePaidProductMatchers */
export function parsePaidProductIds() {
  return parsePaidProductMatchers().ids;
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function enrollmentMatchesPaidProduct(enrollment, matchers) {
  const pid = enrollment.product_id ?? enrollment.course_id;
  const productNum = Number(pid);
  if (!Number.isNaN(productNum) && productNum > 0 && matchers.ids.has(productNum)) {
    return true;
  }

  const candidateNames = [
    enrollment.product_name,
    enrollment.course_name,
    enrollment.name,
  ]
    .map(normalizeName)
    .filter(Boolean);

  for (let i = 0; i < candidateNames.length; i++) {
    if (matchers.names.has(candidateNames[i])) return true;
  }
  return false;
}

function isActiveEnrollment(enrollment, matchers) {
  if (!enrollmentMatchesPaidProduct(enrollment, matchers)) return false;
  if (enrollment.expired === true) return false;
  if (enrollment.expiry_date) {
    const exp = new Date(enrollment.expiry_date);
    if (!Number.isNaN(exp.getTime()) && exp.getTime() < Date.now()) return false;
  }
  return true;
}

/**
 * @param {string} userId Thinkific user id (numeric string)
 * @param {string} [email]
 * @returns {Promise<boolean>}
 */
export async function hasActivePaidEnrollment(userId, email) {
  const apiKey = process.env.THINKIFIC_API_KEY?.trim();
  const subdomain = process.env.THINKIFIC_SUBDOMAIN?.trim();
  const matchers = parsePaidProductMatchers();
  if (!apiKey || !subdomain || (matchers.ids.size === 0 && matchers.names.size === 0)) {
    return false;
  }

  const thinkificUserId = String(userId || '').trim();
  if (!thinkificUserId || thinkificUserId.startsWith('email:')) {
    return false;
  }

  const headers = {
    'X-Auth-API-Key': apiKey,
    'X-Auth-Subdomain': subdomain,
    Accept: 'application/json',
  };

  try {
    const url = new URL(`${API_BASE}/enrollments`);
    url.searchParams.set('page', '1');
    url.searchParams.set('limit', '100');
    url.searchParams.set('query[user_id]', thinkificUserId);

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      console.warn('Thinkific enrollments API:', res.status, await res.text().catch(() => ''));
      return false;
    }

    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];

    return items.some((enrollment) => isActiveEnrollment(enrollment, matchers));
  } catch (err) {
    console.warn('Thinkific enrollment check failed:', err?.message || err);
    return false;
  }
}
