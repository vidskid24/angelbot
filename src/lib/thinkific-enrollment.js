/**
 * Check Thinkific active enrollment for paid product(s) (option B).
 * Requires THINKIFIC_API_KEY, THINKIFIC_SUBDOMAIN, and THINKIFIC_PAID_PRODUCT_IDS (comma-separated).
 * Each entry may be a numeric Thinkific product/course id or an exact product/course name (case-insensitive).
 */

const API_BASE = 'https://api.thinkific.com/api/public/v1';
const PRODUCTS_CACHE_MS = 5 * 60 * 1000;

/** @type {{ at: number; items: object[] } | null} */
let productsCache = null;

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

function thinkificHeaders() {
  const apiKey = process.env.THINKIFIC_API_KEY?.trim();
  const subdomain = process.env.THINKIFIC_SUBDOMAIN?.trim();
  if (!apiKey || !subdomain) return null;
  return {
    'X-Auth-API-Key': apiKey,
    'X-Auth-Subdomain': subdomain,
    Accept: 'application/json',
  };
}

/**
 * @param {string} path e.g. /products
 * @param {Record<string, string>} [query]
 */
async function thinkificGet(path, query = {}) {
  const headers = thinkificHeaders();
  if (!headers) return null;
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, status: res.status, text, items: [] };
  }
  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items : [];
  return { ok: true, status: res.status, items, meta: data.meta || null };
}

async function fetchAllCatalogItems(path) {
  const now = Date.now();
  if (path === '/products' && productsCache && now - productsCache.at < PRODUCTS_CACHE_MS) {
    return productsCache.items;
  }

  const all = [];
  for (let page = 1; page <= 20; page++) {
    const result = await thinkificGet(path, { page: String(page), limit: '100' });
    if (!result || !result.ok) break;
    all.push(...result.items);
    const pagination = result.meta?.pagination;
    if (!pagination || page >= (pagination.total_pages || page)) break;
    if (!result.items.length) break;
  }

  if (path === '/products') {
    productsCache = { at: now, items: all };
  }
  return all;
}

/**
 * Resolve configured product names to numeric ids via Thinkific /products and /bundles.
 * @param {Set<string>} names
 * @returns {Promise<Set<number>>}
 */
async function resolveProductIdsFromNames(names) {
  const resolved = new Set();
  if (!names.size) return resolved;

  const catalogs = await Promise.all([fetchAllCatalogItems('/products'), fetchAllCatalogItems('/bundles')]);
  for (const items of catalogs) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const label = normalizeName(item.name || item.title || item.product_name);
      if (!label || !names.has(label)) continue;
      const id = Number(item.id ?? item.product_id ?? item.productable_id);
      if (!Number.isNaN(id) && id > 0) resolved.add(id);
    }
  }
  return resolved;
}

/**
 * @param {string} userId
 * @param {string} [email]
 * @returns {Promise<object[]>}
 */
export async function fetchThinkificEnrollments(userId, email) {
  const headers = thinkificHeaders();
  if (!headers) return [];

  const thinkificUserId = String(userId || '').trim();
  const queries = [];
  if (thinkificUserId && !thinkificUserId.startsWith('email:')) {
    queries.push({ 'query[user_id]': thinkificUserId });
  }
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (normalizedEmail) {
    queries.push({ 'query[email]': normalizedEmail });
  }
  if (!queries.length) return [];

  const seen = new Set();
  const merged = [];

  async function appendFromEnrollmentList(items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const key = String(item.id ?? `${item.user_id}-${item.course_id}-${item.product_id}`);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }

  for (let q = 0; q < queries.length; q++) {
    for (let page = 1; page <= 10; page++) {
      const url = new URL(`${API_BASE}/enrollments`);
      url.searchParams.set('page', String(page));
      url.searchParams.set('limit', '100');
      for (const [key, value] of Object.entries(queries[q])) {
        url.searchParams.set(key, value);
      }
      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
        console.warn('Thinkific enrollments API:', res.status, await res.text().catch(() => ''));
        break;
      }
      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];
      await appendFromEnrollmentList(items);
      const pagination = data.meta?.pagination;
      if (!pagination || page >= (pagination.total_pages || page)) break;
      if (!items.length) break;
    }
  }

  if (!merged.length && thinkificUserId && !thinkificUserId.startsWith('email:')) {
    for (let page = 1; page <= 10; page++) {
      const url = new URL(`${API_BASE}/users/${encodeURIComponent(thinkificUserId)}/enrollments`);
      url.searchParams.set('page', String(page));
      url.searchParams.set('limit', '100');
      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
        if (page === 1) {
          console.warn('Thinkific user enrollments API:', res.status, await res.text().catch(() => ''));
        }
        break;
      }
      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];
      await appendFromEnrollmentList(items);
      const pagination = data.meta?.pagination;
      if (!pagination || page >= (pagination.total_pages || page)) break;
      if (!items.length) break;
    }
  }

  return merged;
}

function enrollmentMatchesPaidProduct(enrollment, matchers) {
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
 * @param {string} userId
 * @param {string} [email]
 * @returns {Promise<{ ids: Set<number>; names: Set<string>; resolvedIdsFromNames: Set<number> }>}
 */
async function buildEffectiveMatchers(userId, email) {
  const base = parsePaidProductMatchers();
  const resolvedIdsFromNames = await resolveProductIdsFromNames(base.names);
  const ids = new Set(base.ids);
  for (const id of resolvedIdsFromNames) ids.add(id);
  return { ids, names: base.names, resolvedIdsFromNames };
}

/**
 * @param {string} userId
 * @param {string} [email]
 * @returns {Promise<boolean>}
 */
export async function hasActivePaidEnrollment(userId, email) {
  const headers = thinkificHeaders();
  const base = parsePaidProductMatchers();
  if (!headers || (base.ids.size === 0 && base.names.size === 0)) return false;

  const thinkificUserId = String(userId || '').trim();
  if (!thinkificUserId && !email) return false;
  if (thinkificUserId.startsWith('email:') && !email) return false;

  try {
    const matchers = await buildEffectiveMatchers(userId, email);
    if (matchers.ids.size === 0 && matchers.names.size === 0) return false;

    const items = await fetchThinkificEnrollments(userId, email);
    return items.some((enrollment) => isActiveEnrollment(enrollment, matchers));
  } catch (err) {
    console.warn('Thinkific enrollment check failed:', err?.message || err);
    return false;
  }
}

/**
 * Diagnostic snapshot for tier troubleshooting (no secrets).
 * @param {string} userId
 * @param {string} [email]
 */
export async function diagnoseThinkificTier(userId, email) {
  const headers = thinkificHeaders();
  const configured = parsePaidProductMatchers();
  const thinkificUserId = String(userId || '').trim();

  const out = {
    thinkificConfigured: Boolean(headers),
    configuredIds: [...configured.ids],
    configuredNames: [...configured.names],
    userId: thinkificUserId,
    email: email || null,
    userIdUsableForThinkific: Boolean(thinkificUserId && !thinkificUserId.startsWith('email:')),
    resolvedIdsFromNames: [],
    enrollmentCount: 0,
    enrollments: [],
    matchedPaidEnrollment: false,
    hints: [],
  };

  if (!headers) {
    out.hints.push('Set THINKIFIC_API_KEY and THINKIFIC_SUBDOMAIN on the API server.');
    return out;
  }
  if (configured.ids.size === 0 && configured.names.size === 0) {
    out.hints.push('Set THINKIFIC_PAID_PRODUCT_IDS (comma-separated ids or exact product/course names).');
    return out;
  }
  if (!out.userIdUsableForThinkific && !email) {
    out.hints.push('Pass Thinkific numeric user id as external_id (Thinkific.current_user.id), not email-only.');
    return out;
  }

  try {
    const matchers = await buildEffectiveMatchers(userId, email);
    out.resolvedIdsFromNames = [...matchers.resolvedIdsFromNames];
    if (configured.names.size && matchers.resolvedIdsFromNames.size === 0) {
      out.hints.push(
        'Configured names did not match any Thinkific /products or /bundles — verify exact catalog names or use numeric ids.'
      );
    }

    const items = await fetchThinkificEnrollments(userId, email);
    out.enrollmentCount = items.length;
    out.enrollments = items.slice(0, 20).map((e) => ({
      id: e.id,
      course_id: e.course_id,
      course_name: e.course_name,
      product_id: e.product_id,
      product_name: e.product_name,
      expired: e.expired,
      expiry_date: e.expiry_date,
    }));
    out.matchedPaidEnrollment = items.some((enrollment) => isActiveEnrollment(enrollment, matchers));

    if (items.length === 0) {
      out.hints.push('No enrollments returned from Thinkific for this user/email — confirm purchase/enrollment exists.');
    } else if (!out.matchedPaidEnrollment) {
      out.hints.push(
        'Enrollments exist but none match THINKIFIC_PAID_PRODUCT_IDS — compare course_name/product_name in enrollments above.'
      );
    }
  } catch (err) {
    out.hints.push(`Thinkific API error: ${err?.message || err}`);
  }

  return out;
}
