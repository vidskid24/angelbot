/**
 * Paid-only conversation pin: focus RAG on a catalog course/session.
 * Keys match course-catalog levels / chapters / units (e.g. L4, L4-S6, L1-C2).
 */

/**
 * @typedef {{
 *   levelCode: string;
 *   scopeKey: string;
 *   courseTitle: string;
 *   unitTitle: string;
 *   label: string;
 *   purchaseUrl: string;
 * }} MaterialScope
 */

const EXPLICIT_KEY_RE =
  /\b((?:L\d+|ETPF|CFWATI|LWTLB|R[123]|ML\d+|Conf\d+[A-Z]?)(?:-(?:C\d+|S\d+[a-z]?|D\d+[A-Za-z]*|Extra|BONUS|Welcome|SuggestedClasses|ListenBefore|BonusMaterial|SettingtheFoundation|AdditionalMaterial|Special)(?:-[A-Za-z0-9]+)*)?)\b/i;

const CLEAR_SCOPE_RE =
  /\b((leave|drop|clear|exit|stop|end)\b[\s\S]{0,48}\b(session|chapter|focus|pin)\b|\b(all courses|entire library|whole library|all the (?:coursework|material)|focus on (?:everything|all))\b)/i;

/**
 * @param {string} value
 */
function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {import('./course-catalog.js').CourseCatalog | null | undefined} catalog
 */
function levelEntries(catalog) {
  const levels = catalog?.levels && typeof catalog.levels === 'object' ? catalog.levels : {};
  return Object.entries(levels)
    .filter(([code, entry]) => {
      const key = String(code || '');
      const title = String(entry?.title || '');
      if (key.startsWith('book:') || /^book$/i.test(key)) return false;
      if (/\bbook\b/i.test(title)) return false;
      return true;
    })
    .map(([code, entry]) => ({
      code,
      title: String(entry?.title || code).trim(),
      purchaseUrl: String(entry?.purchaseUrl || catalog?.defaultPurchaseUrl || '').trim(),
      entry,
    }));
}

/**
 * @param {string} levelCode
 */
function levelAliasNeedles(levelCode, title) {
  const code = String(levelCode || '').trim();
  const titleNorm = normalize(title);
  const withoutLevel = titleNorm.replace(/\s*-\s*level\s*\d+\s*$/, '').replace(/\s+level\s*\d+\s*$/, '').trim();
  const needles = [normalize(code), titleNorm, withoutLevel];
  const firstWord = withoutLevel.split(' ')[0] || '';
  if (firstWord.length >= 4) needles.push(firstWord);
  const levelNum = code.match(/^L(\d+)$/i);
  if (levelNum) {
    needles.push(`level ${levelNum[1]}`);
    needles.push(`lvl ${levelNum[1]}`);
  }
  const ml = code.match(/^ML(\d+)$/i);
  if (ml) {
    needles.push(`mastery live ${ml[1]}`);
    needles.push(`ml ${ml[1]}`);
  }
  if (/^R([123])$/i.test(code)) needles.push(`reset ${code.slice(1)}`);
  return [...new Set(needles.filter(Boolean))];
}

function containsNeedle(haystack, needle) {
  if (!haystack || !needle || needle.length < 2) return false;
  if (haystack === needle) return true;
  return (
    haystack.startsWith(`${needle} `) ||
    haystack.endsWith(` ${needle}`) ||
    haystack.includes(` ${needle} `)
  );
}

function matchLevelFromText(catalog, text) {
  const n = normalize(text);
  if (!n) return null;
  const entries = levelEntries(catalog);
  let best = null;
  let bestLen = 0;
  for (const item of entries) {
    for (const needle of levelAliasNeedles(item.code, item.title)) {
      if (containsNeedle(n, needle) && needle.length >= bestLen) {
        best = item;
        bestLen = needle.length;
      }
    }
  }
  return best;
}

/**
 * @param {string} scopeKey
 * @param {string} chunkKey
 */
export function chunkMatchesScope(scopeKey, chunkKey) {
  const scope = String(scopeKey || '').trim();
  const key = String(chunkKey || '').trim();
  if (!scope || !key) return false;
  if (key === scope) return true;
  return key.startsWith(`${scope}-`);
}

/**
 * @param {import('./course-catalog.js').CourseCatalog | null | undefined} catalog
 * @param {string} levelCode
 */
function sessionsForLevel(catalog, levelCode) {
  const code = String(levelCode || '').trim();
  if (!code || !catalog) return [];
  /** @type {Map<string, string>} */
  const byKey = new Map();

  const chapters = catalog.chapters && typeof catalog.chapters === 'object' ? catalog.chapters : {};
  const chapterRe = new RegExp(`^${code}-(?:C|S)\\d+[a-z]?$`, 'i');
  for (const [key, meta] of Object.entries(chapters)) {
    if (!chapterRe.test(key)) continue;
    byKey.set(key, String(meta?.title || key).trim());
  }

  const units = catalog.units && typeof catalog.units === 'object' ? catalog.units : {};
  const parentRe = new RegExp(
    `^(${code}-(?:C\\d+-S\\d+|S\\d+[a-z]?|C\\d+|D\\d+[A-Za-z]*))(?:-|$)`,
    'i'
  );
  for (const [key, meta] of Object.entries(units)) {
    if (key === code) continue;
    if (!key.startsWith(`${code}-`)) continue;
    const parent = key.match(parentRe)?.[1] || (chapterRe.test(key) ? key : '');
    if (!parent) continue;
    if (byKey.has(parent)) continue;
    const title = String(meta?.title || parent).trim();
    byKey.set(parent, title);
  }

  return [...byKey.entries()]
    .map(([key, title]) => ({ key, title }))
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}

/**
 * @param {import('./course-catalog.js').CourseCatalog | null | undefined} catalog
 * @param {string} scopeKey
 * @returns {MaterialScope | null}
 */
function findCatalogKey(catalog, scopeKey) {
  const raw = String(scopeKey || '').trim();
  if (!raw || !catalog) return '';
  const wanted = raw.toLowerCase();
  const levels = catalog.levels && typeof catalog.levels === 'object' ? catalog.levels : {};
  for (const code of Object.keys(levels)) {
    if (code.toLowerCase() === wanted) return code;
  }
  const chapters = catalog.chapters && typeof catalog.chapters === 'object' ? catalog.chapters : {};
  for (const code of Object.keys(chapters)) {
    if (code.toLowerCase() === wanted) return code;
  }
  const units = catalog.units && typeof catalog.units === 'object' ? catalog.units : {};
  for (const code of Object.keys(units)) {
    if (code.toLowerCase() === wanted) return code;
  }
  for (const code of Object.keys(levels)) {
    if (wanted.startsWith(`${code.toLowerCase()}-`)) {
      return `${code}${raw.slice(code.length)}`;
    }
  }
  return raw;
}

export function resolveMaterialScope(catalog, scopeKey) {
  const key = findCatalogKey(catalog, scopeKey);
  if (!key || !catalog) return null;
  const levels = levelEntries(catalog);
  const level =
    levels.find((item) => item.code === key) ||
    levels.find((item) => key.startsWith(`${item.code}-`));
  if (!level) return null;

  if (key === level.code) {
    return {
      levelCode: level.code,
      scopeKey: level.code,
      courseTitle: level.title,
      unitTitle: 'All sessions',
      label: level.title,
      purchaseUrl: level.purchaseUrl,
    };
  }

  const chapter = catalog.chapters?.[key];
  const unit = catalog.units?.[key];
  let unitTitle = String(chapter?.title || unit?.title || '').trim();
  if (!unitTitle) {
    const session = sessionsForLevel(catalog, level.code).find((s) => s.key === key);
    unitTitle = session?.title || key;
  }

  const isChapter = /(?:^|-)C\d+/i.test(key) && !/(?:^|-)S\d+/i.test(key);
  const num = key.match(/-(?:C|S)(\d+)/i)?.[1];
  const kindLabel = isChapter ? 'Chapter' : 'Session';
  const detail = num ? `${kindLabel} ${num} — ${unitTitle}` : unitTitle;

  return {
    levelCode: level.code,
    scopeKey: key,
    courseTitle: level.title,
    unitTitle: detail,
    label: `${level.title} — ${detail}`,
    purchaseUrl: level.purchaseUrl,
  };
}

/**
 * Catalog for the paid new-conversation picker.
 * @param {import('./course-catalog.js').CourseCatalog | null | undefined} catalog
 */
export function listMaterialScopeOptions(catalog) {
  return levelEntries(catalog).map((item) => ({
    code: item.code,
    title: item.title,
    sessions: [
      { key: item.code, title: 'All sessions' },
      ...sessionsForLevel(catalog, item.code).map((s) => ({
        key: s.key,
        title: formatSessionOptionLabel(s.key, s.title),
      })),
    ],
  }));
}

/**
 * @param {string} key
 * @param {string} title
 */
function formatSessionOptionLabel(key, title) {
  const sessionNum = key.match(/-S(\d+)/i)?.[1];
  const chapterNum = key.match(/-C(\d+)/i)?.[1];
  if (sessionNum && chapterNum) return `Chapter ${chapterNum}, Session ${sessionNum} — ${title}`;
  if (sessionNum) return `Session ${sessionNum} — ${title}`;
  if (chapterNum) return `Chapter ${chapterNum} — ${title}`;
  return title;
}

/**
 * @param {string} message
 */
export function userAskedToClearMaterialScope(message) {
  return CLEAR_SCOPE_RE.test(String(message || ''));
}

/**
 * Parse a course/session location from a user message.
 * @param {string} message
 * @param {import('./course-catalog.js').CourseCatalog | null | undefined} catalog
 * @returns {MaterialScope | null}
 */
export function parseMaterialScopeFromMessage(message, catalog) {
  const text = String(message || '').trim();
  if (!text || !catalog) return null;

  const explicit = text.match(EXPLICIT_KEY_RE);
  if (explicit?.[1]) {
    const resolved = resolveMaterialScope(catalog, explicit[1]);
    if (resolved) return resolved;
  }

  const level = matchLevelFromText(catalog, text);
  if (!level) return null;

  const sessionMatch = text.match(/\b(?:session|class)\s*(\d+)\b/i);
  const chapterMatch = text.match(/\bchapter\s*(\d+)\b/i);
  if (sessionMatch && /^ML\d+$/i.test(level.code) && chapterMatch) {
    const key = `${level.code}-C${chapterMatch[1]}-S${sessionMatch[1]}`;
    return resolveMaterialScope(catalog, key) || resolveMaterialScope(catalog, `${level.code}-S${sessionMatch[1]}`);
  }
  if (chapterMatch && /^L1$/i.test(level.code)) {
    return resolveMaterialScope(catalog, `${level.code}-C${chapterMatch[1]}`);
  }
  if (sessionMatch) {
    const key = `${level.code}-S${sessionMatch[1]}`;
    return resolveMaterialScope(catalog, key);
  }
  if (chapterMatch) {
    return resolveMaterialScope(catalog, `${level.code}-C${chapterMatch[1]}`);
  }

  return resolveMaterialScope(catalog, level.code);
}

/**
 * Detect that the user named a course/session even if we cannot resolve a pin.
 * Used for free-tier upgrade notices.
 * @param {string} message
 */
export function userNamedCourseLocation(message) {
  const text = String(message || '');
  if (EXPLICIT_KEY_RE.test(text)) return true;
  if (/\blevel\s+\d+\b/i.test(text) && /\b(session|chapter|class)\s+\d+\b/i.test(text)) return true;
  if (/\b(session|chapter)\s+\d+\b/i.test(text) && /\b(level|rewire|connect|core|energy essentials|lightbody|reset|mastery live|conference)\b/i.test(text)) {
    return true;
  }
  return /\b(i'?m in|working (?:in|on)|focus on|from)\b.{0,40}\b(level\s+\d+|session\s+\d+|chapter\s+\d+|rewire|connect)\b/i.test(
    text
  );
}

/**
 * Prompt block when a pin is active.
 * @param {MaterialScope} scope
 */
export function buildMaterialScopePromptBlock(scope) {
  if (!scope?.label) return '';
  return (
    `## User-named material scope\n` +
    `The user is focusing this conversation on: ${scope.label}. ` +
    `Stay with the supplied excerpts from that location (including related tracks). ` +
    `You may acknowledge this location because the user chose it. ` +
    `Do not invent other course titles, Level/Session numbers, or URLs.`
  );
}
