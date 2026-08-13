/**
 * Phase 2: friendly course names and Thinkific course links keyed by sessionKey.
 * sessionKey matches Phase 1 course-source.js (e.g. L1-C1-S4, L1-C1-T2, L2-S21, book:ACIMA-final).
 * Owned/membership users get the level's course page (not per-lesson deep links).
 * Session/chapter titles still come from catalog units and chapters.
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { basename } from 'path';
import {
  parseCourseSourceFromPath,
  formatCourseSourceLabel,
  humanizeTrackTitle,
} from './course-source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const DEFAULT_CATALOG_PATH = join(ROOT, 'data', 'course-catalog.json');

/**
 * @typedef {{
 *   title?: string;
 *   thinkificUrl?: string;
 *   thinkificUrls?: { owned?: string; membership?: string; download?: string };
 *   purchaseUrl?: string;
 *   keywords?: string[];
 * }} CatalogUnit
 *
 * @typedef {{
 *   title?: string;
 *   thinkificCourseId?: string;
 *   purchaseUrl?: string;
 *   variants?: Record<string, { courseSlug?: string; courseUrl?: string }>;
 * }} CatalogLevel
 *
 * @typedef {{
 *   siteBaseUrl?: string;
 *   defaultPurchaseUrl?: string;
 *   levels?: Record<string, CatalogLevel>;
 *   chapters?: Record<string, { title?: string }>;
 *   units?: Record<string, CatalogUnit>;
 * }} CourseCatalog
 */

/** @type {CourseCatalog | null} */
let catalogCache = null;

/**
 * @returns {Promise<CourseCatalog>}
 */
export async function loadCourseCatalog() {
  if (catalogCache) return catalogCache;

  const path = process.env.COURSE_CATALOG_PATH || DEFAULT_CATALOG_PATH;
  try {
    const raw = await readFile(path, 'utf-8');
    catalogCache = normalizeCatalog(JSON.parse(raw));
  } catch (err) {
    if (err?.code === 'ENOENT') {
      catalogCache = normalizeCatalog({});
    } else {
      throw err;
    }
  }
  return catalogCache;
}

/** Clear cached catalog (tests). */
export function clearCourseCatalogCache() {
  catalogCache = null;
}

/**
 * @param {unknown} raw
 * @returns {CourseCatalog}
 */
function normalizeCatalog(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    siteBaseUrl: String(data.siteBaseUrl || 'https://courses.masteringalchemy.com').replace(/\/$/, ''),
    defaultPurchaseUrl: String(data.defaultPurchaseUrl || '').trim(),
    levels: data.levels && typeof data.levels === 'object' ? data.levels : {},
    chapters: data.chapters && typeof data.chapters === 'object' ? data.chapters : {},
    units: data.units && typeof data.units === 'object' ? data.units : {},
  };
}

/** @typedef {'owned' | 'membership'} CourseLinkVariant */

/**
 * Pick an optional per-unit Thinkific URL (rare overrides; books use purchaseUrl instead).
 * @param {CatalogUnit | null | undefined} unit
 * @param {CourseLinkVariant | null | undefined} [linkVariant]
 * @returns {string}
 */
export function resolveThinkificUrlForUnit(unit, linkVariant) {
  const urls = unit?.thinkificUrls;
  if (urls && typeof urls === 'object' && linkVariant) {
    const chosen = String(
      urls[linkVariant] || (linkVariant === 'owned' ? urls.download : '')
    ).trim();
    if (chosen) return chosen;
  }
  return String(unit?.thinkificUrl || '').trim();
}

/**
 * Product / sales page when the user has no owned or membership lesson access.
 * @param {CourseCatalog | null | undefined} catalog
 * @param {import('./course-source.js').CourseSource | null | undefined} source
 * @param {CatalogUnit | null | undefined} unit
 * @returns {string}
 */
export function resolvePurchaseUrlForSource(catalog, source, unit) {
  const fromUnit = String(unit?.purchaseUrl || '').trim();
  if (fromUnit) return fromUnit;

  const levelCode = source?.levelCode;
  const levelEntry = levelCode && catalog?.levels ? catalog.levels[levelCode] : null;
  if (levelEntry && typeof levelEntry === 'object') {
    const fromLevel = String(levelEntry.purchaseUrl || '').trim();
    if (fromLevel) return fromLevel;
  }

  return String(catalog?.defaultPurchaseUrl || '').trim();
}

/**
 * Course home page for owned vs membership enrollment (level-scoped, not per lesson).
 * @param {CourseCatalog | null | undefined} catalog
 * @param {import('./course-source.js').CourseSource | null | undefined} source
 * @param {CourseLinkVariant} linkVariant
 * @returns {string}
 */
export function resolveLevelCourseUrl(catalog, source, linkVariant) {
  const levelCode = source?.levelCode;
  const levelEntry = levelCode && catalog?.levels ? catalog.levels[levelCode] : null;
  if (!levelEntry || typeof levelEntry !== 'object') return '';

  const variant = levelEntry.variants?.[linkVariant];
  if (variant && typeof variant === 'object') {
    const explicit = String(variant.courseUrl || '').trim();
    if (explicit) return explicit;
    const slug = String(variant.courseSlug || '').trim().replace(/^\/+|\/+$/g, '');
    if (slug) {
      const base = String(catalog?.siteBaseUrl || 'https://courses.masteringalchemy.com').replace(
        /\/$/,
        ''
      );
      return `${base}/courses/${slug}`;
    }
  }

  return String(levelEntry.purchaseUrl || '').trim();
}

/**
 * @param {CatalogUnit | null | undefined} unit
 * @param {CourseLinkVariant | null | undefined} linkVariant
 * @param {CourseCatalog | null | undefined} catalog
 * @param {import('./course-source.js').CourseSource | null | undefined} source
 * @returns {{ url: string; kind: 'course' | 'purchase' | null }}
 */
export function resolveLinkForSource(unit, linkVariant, catalog, source) {
  if (linkVariant) {
    const courseUrl = resolveLevelCourseUrl(catalog, source, linkVariant);
    if (courseUrl) return { url: courseUrl, kind: 'course' };

    // Units without a level (e.g. book) may still have a direct URL.
    const unitUrl = resolveThinkificUrlForUnit(unit, linkVariant);
    if (unitUrl) return { url: unitUrl, kind: 'course' };

    const purchaseUrl = resolvePurchaseUrlForSource(catalog, source, unit);
    if (purchaseUrl) return { url: purchaseUrl, kind: 'purchase' };
    return { url: '', kind: null };
  }

  const purchaseUrl = resolvePurchaseUrlForSource(catalog, source, unit);
  if (purchaseUrl) return { url: purchaseUrl, kind: 'purchase' };
  return { url: '', kind: null };
}

/**
 * @param {CourseCatalog} catalog
 * @param {string | undefined | null} sessionKey
 * @returns {CatalogUnit | null}
 */
export function lookupCatalogUnit(catalog, sessionKey) {
  const key = String(sessionKey || '').trim();
  if (!key || !catalog?.units) return null;
  const unit = catalog.units[key];
  return unit && typeof unit === 'object' ? unit : null;
}

/**
 * @param {import('./course-source.js').CourseSource | null | undefined} source
 * @param {CatalogUnit | null | undefined} unit
 * @returns {string}
 */
function resolveDisplayTitle(source, unit) {
  const fromCatalog = String(unit?.title || '').trim();
  if (fromCatalog) return fromCatalog;
  return humanizeTrackTitle(source?.title || source?.sessionTitle || '');
}

/**
 * @param {CourseCatalog} catalog
 * @param {string | undefined} levelCode
 * @param {number | undefined} levelNum
 * @returns {string | null}
 */
function formatLevelLabel(catalog, levelCode, levelNum) {
  const entry = levelCode ? catalog?.levels?.[levelCode] : null;
  const friendly = String(entry?.title || '').trim();
  if (friendly) return friendly;
  if (levelNum != null) return `Level ${levelNum}`;
  if (levelCode) return levelCode;
  return null;
}

/**
 * @param {CourseCatalog} catalog
 * @param {import('./course-source.js').CourseSource} source
 * @returns {string | null}
 */
function formatClassChapterLabel(catalog, source) {
  if (source.class == null) return null;
  const chapterKey =
    source.levelCode && source.class != null ? `${source.levelCode}-C${source.class}` : null;
  const entry = chapterKey ? catalog.chapters?.[chapterKey] : null;
  const friendly = String(entry?.title || '').trim();
  if (friendly) return `Chapter ${source.class}: ${friendly}`;
  return `Chapter ${source.class}`;
}

/**
 * @param {CourseCatalog} catalog
 * @param {string | undefined} chapterCode
 * @param {number | undefined} chapterNum
 * @param {string | undefined} [levelCode]
 * @returns {string | null}
 */
function formatChapterLabel(catalog, chapterCode, chapterNum, levelCode) {
  if (chapterNum == null) return null;
  const compositeKey = levelCode ? `${levelCode}-C${chapterNum}` : null;
  const entry =
    (compositeKey && catalog.chapters?.[compositeKey]) ||
    (chapterCode ? catalog.chapters?.[chapterCode] : null);
  const friendly = String(entry?.title || '').trim();
  if (friendly) return `Chapter ${chapterNum}: ${friendly}`;
  return `Chapter ${chapterNum}`;
}

/**
 * Level 2+ sessions keyed as L2-S13 in catalog.chapters.
 * @param {CourseCatalog | null | undefined} catalog
 * @param {import('./course-source.js').CourseSource} source
 * @returns {string | null}
 */
function formatLevelSessionLabel(catalog, source) {
  const sessionNum = source.session ?? source.unitNumber;
  if (sessionNum == null) return null;
  const parentKey =
    source.levelCode && source.session != null
      ? `${source.levelCode}-S${source.session}`
      : null;
  // Prefer parent session title (ETPF-S4) over supplement key (ETPF-S4a).
  const entry =
    (parentKey ? catalog?.chapters?.[parentKey] : null) ??
    catalog?.chapters?.[source.sessionKey] ??
    (source.levelCode && source.sessionCode
      ? catalog?.chapters?.[`${source.levelCode}-${source.sessionCode}`]
      : null);
  const friendly = String(entry?.title || '').trim();
  if (friendly) return `Session ${sessionNum}: ${friendly}`;
  return `Session ${sessionNum}`;
}

/**
 * Human-readable label with optional catalog overrides (title, level, chapter).
 * @param {import('./course-source.js').CourseSource | null | undefined} source
 * @param {CourseCatalog | null | undefined} [catalog]
 * @returns {string | null}
 */
export function formatCourseSourceLabelWithCatalog(source, catalog) {
  if (!source?.sessionKey) return null;

  const unit = catalog ? lookupCatalogUnit(catalog, source.sessionKey) : null;
  const title = resolveDisplayTitle(source, unit);
  if (!title) return formatCourseSourceLabel(source);

  const levelLabel = formatLevelLabel(catalog, source.levelCode, source.level);
  const chapterLabel = formatChapterLabel(catalog, source.classCode, source.class, source.levelCode);

  if (source.unitType === 'book' || source.sessionKey.startsWith('book:')) {
    return `Book — "${title}"`;
  }

  // Named courses without chapter structure (ETPF, CFWATI, Resets, …):
  // course name + catalog/file title only.
  const isNamedCourse =
    levelLabel &&
    source.level == null &&
    source.levelCode &&
    !/^L\d+$/i.test(source.levelCode);
  if (isNamedCourse && source.class == null) {
    return `${levelLabel} — "${title}"`;
  }

  if (source.unitType === 'class-chapter' && levelLabel) {
    const classChapterLabel = formatClassChapterLabel(catalog, source);
    if (classChapterLabel) return `${levelLabel}, ${classChapterLabel}`;
  }

  if (source.unitType === 'level-session-full' && levelLabel) {
    const sessionLabel = formatLevelSessionLabel(catalog, source);
    if (sessionLabel) return `${levelLabel}, ${sessionLabel}`;
  }

  if (source.unitType === 'level-session-supplement' && levelLabel) {
    if (source.sessionCode === 'Extra') {
      return `${levelLabel} — ${title}`;
    }
    // Prefer Session N — "Track" so detail does not repeat the session chapter title.
    const sessionNum = source.session ?? source.unitNumber;
    if (sessionNum != null) {
      return `${levelLabel}, Session ${sessionNum} — ${title}`;
    }
  }

  if (source.unitType === 'class-track' && levelLabel && chapterLabel) {
    return `${levelLabel}, ${chapterLabel}, Track ${source.unitNumber} — ${title}`;
  }
  if (source.unitType === 'class-video' && levelLabel && chapterLabel) {
    return `${levelLabel}, ${chapterLabel}, Video — ${title}`;
  }
  if (source.unitType === 'class-session' && levelLabel && chapterLabel) {
    const genericSession = new RegExp(`^Session\\s*${source.unitNumber}$`, 'i').test(
      title
    );
    const base = `${levelLabel}, ${chapterLabel}, Session ${source.unitNumber}`;
    return genericSession ? base : `${base} — ${title}`;
  }
  if (source.unitType === 'level-session' && levelLabel) {
    const sessionLabel = formatLevelSessionLabel(catalog, source);
    if (sessionLabel) return `${levelLabel}, ${sessionLabel} — ${title}`;
  }

  if (unit?.title) {
    const base = formatCourseSourceLabel(source);
    if (base) {
      return base
        .replace(/ — "[^"]+"$/, ` — ${title}`)
        .replace(/ — [^\n]+$/, ` — ${title}`);
    }
  }

  return formatCourseSourceLabel(source);
}

/**
 * Coarse label for free-tier citations: course/level name only (no chapter/session).
 * @param {import('./course-source.js').CourseSource | null | undefined} source
 * @param {CourseCatalog | null | undefined} [catalog]
 * @returns {string | null}
 */
export function formatCourseNameOnlyLabel(source, catalog) {
  if (!source?.sessionKey) return null;

  const unit = catalog ? lookupCatalogUnit(catalog, source.sessionKey) : null;
  const title = resolveDisplayTitle(source, unit);

  if (source.unitType === 'book' || source.sessionKey.startsWith('book:')) {
    if (title) return `Book — "${title}"`;
    return formatCourseSourceLabel(source);
  }

  const levelLabel = formatLevelLabel(catalog, source.levelCode, source.level);
  if (levelLabel) return levelLabel;

  if (source.levelCode && catalog?.levels?.[source.levelCode]) {
    const friendly = String(catalog.levels[source.levelCode].title || '').trim();
    if (friendly) return friendly;
  }

  if (source.level != null) return `Level ${source.level}`;
  return null;
}

/**
 * Course / level / book title suitable for a citation markdown link.
 * @param {import('./course-source.js').CourseSource | null | undefined} source
 * @param {CourseCatalog | null | undefined} catalog
 * @returns {string}
 */
function getLinkableCourseTitle(source, catalog) {
  if (!source?.sessionKey) return '';

  if (source.unitType === 'book' || source.sessionKey.startsWith('book:')) {
    const unit = catalog ? lookupCatalogUnit(catalog, source.sessionKey) : null;
    return resolveDisplayTitle(source, unit);
  }

  const levelLabel = formatLevelLabel(catalog, source.levelCode, source.level);
  if (levelLabel) return levelLabel;

  if (source.level != null) return `Level ${source.level}`;
  return String(source.levelCode || '').trim();
}

/**
 * Location text after the course/level/book title (session, chapter, track, etc.).
 * @param {string} label
 * @param {string} courseTitle
 * @returns {string}
 */
function getLocationDetailAfterCourseTitle(label, courseTitle) {
  const text = String(label || '').trim();
  const title = String(courseTitle || '').trim();
  if (!text || !title) return text;

  if (text === title) return '';
  if (text.startsWith(title)) {
    return text.slice(title.length).replace(/^[\s,|:;—-]+/, '').trim();
  }

  const bookForm = `Book — "${title}"`;
  if (text === bookForm) return '';
  if (text.startsWith(bookForm)) {
    return text.slice(bookForm.length).replace(/^[\s,|:;—-]+/, '').trim();
  }

  return text;
}

/**
 * Pull Lesson N + title from book excerpt body when present.
 * @param {string} body
 * @returns {string}
 */
function extractBookLessonDetail(body) {
  const text = String(body || '');
  const m = text.match(/LESSON\s+(\d+)\s*[\r\n]+\s*([^\r\n]{3,120})/i);
  if (!m) return '';
  const lessonNum = m[1];
  const lessonTitle = String(m[2] || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*Alchemy\.indd.*$/i, '')
    .trim();
  if (!lessonTitle) return `Lesson ${lessonNum}`;
  return `Lesson ${lessonNum} — ${lessonTitle}`;
}

/**
 * Plain-language cite detail without wrapping titles in quotation marks.
 * @param {string} detail
 * @returns {string}
 */
function formatDetailForCite(detail) {
  return String(detail || '')
    .replace(/\s*—\s*"([^"]+)"/g, ' — $1')
    .replace(/"([^"]+)"/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build a catalog cite from a Source label or transcript filename when `cite:` is missing.
 * @param {string} labelLine
 * @param {CourseCatalog | null | undefined} catalog
 * @param {CourseLinkVariant | null} [linkVariant]
 * @returns {{ title: string; url: string; detail: string; access: string; isBook: boolean } | null}
 */
export function citeFromSourceLabel(labelLine, catalog, linkVariant = 'owned') {
  const label = String(labelLine || '').trim();
  if (!label || !catalog) return null;

  const filename = basename(label);
  const source =
    parseCourseSourceFromPath(filename) ||
    parseCourseSourceFromPath(label) ||
    null;
  if (source?.sessionKey) {
    const unit = lookupCatalogUnit(catalog, source.sessionKey);
    const title = getLinkableCourseTitle(source, catalog);
    let link = resolveLinkForSource(unit, linkVariant, catalog, source);
    if (!link.url) link = resolveLinkForSource(unit, 'owned', catalog, source);
    const url = link.url || resolvePurchaseUrlForSource(catalog, source, unit);
    if (title && url) {
      const fullLabel = formatCourseSourceLabelWithCatalog(source, catalog) || label;
      return {
        title,
        url,
        detail: formatDetailForCite(getLocationDetailAfterCourseTitle(fullLabel, title) || ''),
        access: link.kind === 'purchase' ? 'purchase' : 'classroom',
        isBook: source.unitType === 'book' || String(source.sessionKey).startsWith('book:'),
      };
    }
  }

  const levels = catalog.levels && typeof catalog.levels === 'object' ? Object.values(catalog.levels) : [];
  const lower = label.toLowerCase();
  for (const entry of levels) {
    const title = String(entry?.title || '').trim();
    if (!title || !lower.includes(title.toLowerCase())) continue;
    const url =
      String(entry?.variants?.owned?.courseUrl || '').trim() ||
      String(entry?.variants?.membership?.courseUrl || '').trim() ||
      String(entry?.purchaseUrl || '').trim();
    if (!url) continue;
    return {
      title,
      url,
      detail: formatDetailForCite(getLocationDetailAfterCourseTitle(label, title) || ''),
      access: 'classroom',
      isBook: false,
    };
  }
  return null;
}

/**
 * Catalog cite from a retrieved embedding chunk (uses source metadata, not formatted text).
 * @param {{ text?: string; source?: import('./course-source.js').CourseSource | null; sourcePath?: string }} chunk
 * @param {CourseCatalog | null | undefined} catalog
 * @param {CourseLinkVariant | null} [linkVariant]
 * @returns {{ title: string; url: string; detail: string; access: string } | null}
 */
export function citeFromRetrievedChunk(chunk, catalog, linkVariant = 'owned') {
  const source =
    chunk?.source ||
    (chunk?.sourcePath ? parseCourseSourceFromPath(chunk.sourcePath) : null);
  if (source?.sessionKey && catalog) {
    const unit = lookupCatalogUnit(catalog, source.sessionKey);
    const title = getLinkableCourseTitle(source, catalog);
    let link = resolveLinkForSource(unit, linkVariant, catalog, source);
    if (!link.url) link = resolveLinkForSource(unit, 'owned', catalog, source);
    const url = link.url || resolvePurchaseUrlForSource(catalog, source, unit);
    if (title && url) {
      const fullLabel =
        formatCourseSourceLabelWithCatalog(source, catalog) ||
        formatCourseNameOnlyLabel(source, catalog) ||
        title;
      let detail = getLocationDetailAfterCourseTitle(fullLabel, title);
      if (
        !detail &&
        (source.unitType === 'book' || String(source.sessionKey).startsWith('book:'))
      ) {
        detail = extractBookLessonDetail(String(chunk?.text || ''));
      }
      return {
        title,
        url,
        detail: formatDetailForCite(detail || ''),
        access: link.kind === 'purchase' ? 'purchase' : 'classroom',
      };
    }
  }
  if (chunk?.sourcePath) {
    const fromName = citeFromSourceLabel(basename(chunk.sourcePath), catalog, linkVariant);
    if (fromName?.title && fromName?.url) {
      return {
        title: fromName.title,
        url: fromName.url,
        detail: fromName.detail || '',
        access: fromName.access || '',
      };
    }
  }
  return null;
}

/** @typedef {'full' | 'course'} SourceDetail */

/**
 * @param {{ text: string; source?: import('./course-source.js').CourseSource | null; sourcePath?: string }} chunk
 * @param {CourseCatalog | null | undefined} [catalog]
 * @param {CourseLinkVariant | null} [linkVariant]
 * @param {{ sourceDetail?: SourceDetail; sourceIndex?: number }} [options]
 * @returns {string}
 */
export function formatRetrievedChunkWithCatalog(chunk, catalog, linkVariant = null, options = {}) {
  const source =
    chunk.source ||
    (chunk.sourcePath ? parseCourseSourceFromPath(chunk.sourcePath) : null);
  const unit = catalog && source?.sessionKey ? lookupCatalogUnit(catalog, source.sessionKey) : null;
  const sourceDetail = options.sourceDetail === 'course' ? 'course' : 'full';
  const label =
    sourceDetail === 'course'
      ? formatCourseNameOnlyLabel(source, catalog)
      : formatCourseSourceLabelWithCatalog(source, catalog);
  const body = String(chunk.text || '').trim();
  if (!body) return '';

  // Prefer owned/membership classroom URL when known; otherwise purchase/product page.
  let link = resolveLinkForSource(unit, linkVariant, catalog, source);
  if (!link.url) {
    link = resolveLinkForSource(unit, 'owned', catalog, source);
  }
  const courseTitle = getLinkableCourseTitle(source, catalog);
  const sourceIndex =
    Number.isFinite(options.sourceIndex) && options.sourceIndex > 0
      ? Math.floor(options.sourceIndex)
      : null;
  const sourceHeading = sourceIndex != null ? `--- Source ${sourceIndex} ---` : '--- Source ---';

  if (label && link.url && courseTitle) {
    const cite = `[${courseTitle}](${link.url})`;
    let detail = getLocationDetailAfterCourseTitle(label, courseTitle);
    if (
      !detail &&
      (source?.unitType === 'book' || String(source?.sessionKey || '').startsWith('book:'))
    ) {
      detail = extractBookLessonDetail(body);
    }
    const access = link.kind === 'purchase' ? 'purchase' : 'classroom';
    const headerLines = [sourceHeading, `cite: ${cite}`];
    if (detail) headerLines.push(`detail: ${formatDetailForCite(detail)}`);
    headerLines.push(`access: ${access}`, `---`);
    return `${headerLines.join('\n')}\n${body}`;
  }

  if (label && link.url && link.kind === 'purchase') {
    return `${sourceHeading}\n${label} | purchase: ${link.url}\n---\n${body}`;
  }
  if (label && link.url) {
    return `${sourceHeading}\n${label} | ${link.url}\n---\n${body}`;
  }
  if (label) {
    return `${sourceHeading}\n${label}\n---\n${body}`;
  }

  if (chunk.sourcePath) {
    return `${sourceHeading}\n${basename(chunk.sourcePath)}\n---\n${body}`;
  }
  return body;
}

/**
 * @param {CourseCatalog} catalog
 * @param {string[]} sessionKeys
 * @returns {string[]}
 */
export function listMissingCatalogUnits(catalog, sessionKeys) {
  const unique = [...new Set(sessionKeys.filter(Boolean))].sort();
  return unique.filter((key) => !catalog.units?.[key]);
}

/**
 * Whether a level has course URLs for owned and membership link variants.
 * @param {CourseCatalog | null | undefined} catalog
 * @param {string} levelCode
 * @returns {{ owned: boolean; membership: boolean; ownedUrl: string; membershipUrl: string }}
 */
export function catalogLevelUrlCoverage(catalog, levelCode) {
  const sampleSource = { levelCode, sessionKey: `${levelCode}-sample` };
  const ownedUrl = resolveLevelCourseUrl(catalog, sampleSource, 'owned');
  const membershipUrl = resolveLevelCourseUrl(catalog, sampleSource, 'membership');
  return {
    owned: Boolean(ownedUrl),
    membership: Boolean(membershipUrl),
    ownedUrl,
    membershipUrl,
  };
}

/**
 * @param {CatalogUnit | null | undefined} unit
 * @returns {{ owned: boolean; membership: boolean }}
 * @deprecated Prefer catalogLevelUrlCoverage — links are level-scoped now.
 */
export function catalogUnitUrlCoverage(unit) {
  const urls = unit?.thinkificUrls;
  const legacy = String(unit?.thinkificUrl || '').trim();
  return {
    owned: Boolean(String(urls?.owned || urls?.download || '').trim() || legacy),
    membership: Boolean(String(urls?.membership || '').trim()),
  };
}
