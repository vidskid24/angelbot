/**
 * Check Thinkific active enrollment for paid product(s) (option B).
 * Requires THINKIFIC_API_KEY, THINKIFIC_SUBDOMAIN, and THINKIFIC_PAID_PRODUCT_IDS (comma-separated).
 */

const API_BASE = 'https://api.thinkific.com/api/public/v1';

/**
 * @returns {Set<number>}
 */
export function parsePaidProductIds() {
  const ids = new Set();
  const raw = String(process.env.THINKIFIC_PAID_PRODUCT_IDS || '').trim();
  if (!raw) return ids;
  for (const part of raw.split(',')) {
    const n = Number(part.trim());
    if (!Number.isNaN(n) && n > 0) ids.add(n);
  }
  return ids;
}

function isActiveEnrollment(enrollment, paidProductIds) {
  const pid = enrollment.product_id ?? enrollment.course_id;
  const productNum = Number(pid);
  if (!paidProductIds.has(productNum)) return false;
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
  const paidProductIds = parsePaidProductIds();
  if (!apiKey || !subdomain || paidProductIds.size === 0) return false;

  const headers = {
    'X-Auth-API-Key': apiKey,
    'X-Auth-Subdomain': subdomain,
    Accept: 'application/json',
  };

  try {
    const url = new URL(`${API_BASE}/enrollments`);
    url.searchParams.set('page', '1');
    url.searchParams.set('limit', '100');
    if (userId) url.searchParams.set('query[user_id]', userId);

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      console.warn('Thinkific enrollments API:', res.status, await res.text().catch(() => ''));
      return false;
    }

    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];

    return items.some((enrollment) => isActiveEnrollment(enrollment, paidProductIds));
  } catch (err) {
    console.warn('Thinkific enrollment check failed:', err?.message || err);
    return false;
  }
}
