/**
 * Check Thinkific active enrollment for a paid product (option B).
 * Requires THINKIFIC_API_KEY, THINKIFIC_SUBDOMAIN, THINKIFIC_PAID_PRODUCT_ID.
 */

const API_BASE = 'https://api.thinkific.com/api/public/v1';

/**
 * @param {string} userId Thinkific user id (numeric string)
 * @param {string} [email]
 * @returns {Promise<boolean>}
 */
export async function hasActivePaidEnrollment(userId, email) {
  const apiKey = process.env.THINKIFIC_API_KEY?.trim();
  const subdomain = process.env.THINKIFIC_SUBDOMAIN?.trim();
  const productId = process.env.THINKIFIC_PAID_PRODUCT_ID?.trim();
  if (!apiKey || !subdomain || !productId) return false;

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
    const targetProductId = Number(productId);

    return items.some((enrollment) => {
      const pid = enrollment.product_id ?? enrollment.course_id;
      if (Number(pid) !== targetProductId) return false;
      if (enrollment.expired === true) return false;
      if (enrollment.expiry_date) {
        const exp = new Date(enrollment.expiry_date);
        if (!Number.isNaN(exp.getTime()) && exp.getTime() < Date.now()) return false;
      }
      return true;
    });
  } catch (err) {
    console.warn('Thinkific enrollment check failed:', err?.message || err);
    return false;
  }
}
