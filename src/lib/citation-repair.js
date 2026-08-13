/**
 * Keep citation markdown links aligned with RAG Source `cite:` values,
 * and strip unsolicited location brackets when the user did not ask for a source.
 */

/**
 * @typedef {{
 *   index: number;
 *   title: string;
 *   url: string;
 *   detail: string;
 *   access: string;
 *   isBook: boolean;
 * }} SourceCite
 */

/**
 * @param {string} excerpts
 * @returns {SourceCite[]}
 */
export function parseSourceCites(excerpts) {
  const text = String(excerpts || '');
  /** @type {SourceCite[]} */
  const cites = [];
  const blockRe =
    /---\s*Source\s+(\d+)\s*---\s*\r?\ncite:\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)[ \t]*(?:\r?\n[ \t]*detail:\s*([^\n\r]+))?[ \t]*(?:\r?\n[ \t]*access:\s*(\w+))?/gi;
  let match;
  while ((match = blockRe.exec(text)) !== null) {
    const title = String(match[2] || '').trim();
    const url = String(match[3] || '').trim();
    if (!title || !url) continue;
    const access = String(match[5] || '').trim().toLowerCase();
    const isBook =
      access === 'purchase' && /amazon\.com/i.test(url)
        ? true
        : /course in mastering alchemy book|acima/i.test(title) || /amazon\.com/i.test(url);
    cites.push({
      index: Number(match[1]) || cites.length + 1,
      title,
      url,
      detail: String(match[4] || '').trim(),
      access,
      isBook,
    });
  }
  return cites;
}

/**
 * @param {string} message
 * @returns {boolean}
 */
export function userAskedForCitation(message) {
  const t = String(message || '');
  return (
    /\b(where\s+(is|did|does|was|came|come)|source|citation|cite|reference|references)\b/i.test(t) ||
    /\b(which|what)\s+(class|course|session|level|lesson|book|chapter)\b/i.test(t) ||
    /\bfrom\s+which\b/i.test(t) ||
    /\bwhere\s+(?:can|could|do|would|might)\s+i\s+(?:find|read|listen|watch|get|see|locate)\b/i.test(t) ||
    /\bwhere\s+(?:to\s+)?find\b/i.test(t) ||
    /\bwhere\s+(?:in\s+)?(?:the\s+)?(?:coursework|course|class|material|transcript)\b/i.test(t) ||
    /\bfind\s+(?:this|that|it|more|the\s+answer|that\s+answer)\b.*\b(?:coursework|course|class|session|level)\b/i.test(
      t
    ) ||
    /\blink\s+to\s+(the\s+)?(class|course|lesson|session|book)\b/i.test(t) ||
    /\bin\s+(?:which|what)\s+(?:part\s+of\s+)?(?:the\s+)?(?:coursework|course|class)\b/i.test(t)
  );
}

/**
 * @param {SourceCite[]} cites
 * @returns {SourceCite | null}
 */
function preferredCite(cites) {
  if (!cites.length) return null;
  const classroom = cites.find((c) => c.access === 'classroom' && !c.isBook);
  if (classroom) return classroom;
  const course = cites.find((c) => !c.isBook);
  if (course) return course;
  return cites[0];
}

/**
 * Turn stuffed link text / bare location into plain detail when Source has none.
 * "Level 1, Chapter 1, Track 1 — \"The Mechanics of You\"" →
 * "Chapter 1, Track 1 — The Mechanics of You"
 * @param {string} text
 * @returns {string}
 */
function detailFromLocationText(text) {
  let t = String(text || '').trim();
  if (!t) return '';
  t = t.replace(/^\*{1,2}|\*{1,2}$/g, '').trim();
  t = t.replace(/^in\s+/i, '').trim();
  t = t.replace(/^Level\s+\d+\s*,\s*/i, '').trim();
  t = t
    .replace(/\s*—\s*"([^"]+)"/g, ' — $1')
    .replace(/"([^"]+)"/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/\b(?:Chapter|Session|Track|Lesson|Video)\b/i.test(t)) return '';
  return t;
}

/**
 * Format a canonical citation markdown snippet from a Source cite.
 * @param {SourceCite} cite
 * @param {string} [fallbackDetail]
 * @returns {string}
 */
function formatCiteMarkdown(cite, fallbackDetail = '') {
  if (!cite?.title || !cite?.url) return '';
  const detail = String(cite.detail || fallbackDetail || '').trim();
  return detail ? `[${cite.title}](${cite.url}), ${detail}` : `[${cite.title}](${cite.url})`;
}

/**
 * Legacy location phrases the model invents instead of pasting `cite:` + `detail:`.
 * Covers: Level 1, Chapter 1, Track 1 — "The Mechanics of You"
 * and shorter forms like Level 1, Chapter 2 / Level 2, Session 8 — title
 * @type {RegExp}
 */
const LOCATION_PHRASE_RE =
  /(\*{1,2})?Level\s+(\d+)\s*,\s*(Chapter|Session|Track|Lesson)\s+(\d+)(?:\s*,\s*(Chapter|Session|Track|Lesson|Video)\s+(\d+))?(?:\s*[—\-–:]\s*(?:"[^"]+"|[^*\n,[\]"][^*\n[\]]*?))?(\*{1,2})?/gi;

/**
 * True when markdown link text is a stuffed location, not a course/book title.
 * @param {string} linkText
 * @returns {boolean}
 */
function linkTextLooksLikeLocation(linkText) {
  const t = String(linkText || '').trim();
  if (!t) return false;
  if (/Level\s+\d+\s*,\s*(?:Chapter|Session|Track|Lesson)\b/i.test(t)) return true;
  if (
    /\b(?:Chapter|Session|Track|Lesson|Video)\s+\d+/i.test(t) &&
    /(?:Level\s+\d+|Core|Rewire|Connect|Living Lightbody|Energy Essentials|Mastery Live)/i.test(t) &&
    t.length > 48
  ) {
    return true;
  }
  return false;
}

/**
 * Pick the best Source cite for a Level N location phrase.
 * @param {SourceCite[]} cites
 * @param {number} levelNum
 * @returns {SourceCite | null}
 */
function citeForLocation(cites, levelNum) {
  return (
    findCiteForLevel(cites, levelNum) ||
    preferredCite(cites.filter((c) => !c.isBook)) ||
    preferredCite(cites)
  );
}

/**
 * If the user asked for a source but the model only wrote plain/bold "Level N, Chapter X…",
 * replace that entire phrase with the real catalog cite link (+ detail when available).
 * @param {string} reply
 * @param {string} styleExcerpts
 * @returns {string}
 */
function ensureProperCitation(reply, styleExcerpts) {
  const cites = parseSourceCites(styleExcerpts);
  if (!cites.length) return reply;

  const hasValidCiteLink = cites.some(
    (c) => reply.includes(`](${c.url})`) || reply.includes(`[${c.title}](`)
  );

  let text = String(reply || '');
  let replaced = false;
  text = text.replace(LOCATION_PHRASE_RE, (full, _openWrap, levelNum, kind, num) => {
    const cite = citeForLocation(cites, Number(levelNum));
    if (!cite) return full;
    replaced = true;
    const fallback = detailFromLocationText(full) || `${kind} ${num}`;
    return formatCiteMarkdown(cite, fallback);
  });

  if (hasValidCiteLink || replaced) return text;

  const fallback = preferredCite(cites.filter((c) => !c.isBook)) || preferredCite(cites);
  if (!fallback) return text;
  const snippet = formatCiteMarkdown(fallback);
  if (!snippet) return text;
  return `${text.trim()} You can find this in ${snippet}.`;
}

/**
 * @param {string} label
 * @param {string} url
 * @returns {boolean}
 */
function isCourseCitationMarkdown(label, url) {
  return (
    /masteringalchemy|amazon\.com|thinkific/i.test(url) ||
    /Level\s+\d+|Course|Mastery Live|Book|A Course in Mastering Alchemy|Core|Rewire|Connect|Living Lightbody|Energy Essentials/i.test(
      label
    )
  );
}

/**
 * Remove bare [Level …] / [Mastery Live …] brackets that are not markdown links.
 * Important: do not match the label of a real `[Title](url)` citation link.
 * @param {string} text
 * @returns {string}
 */
function stripBareLocationBrackets(text) {
  return String(text || '').replace(
    /\s*\[(?:Level\s+\d+|Mastery Live\s*\d*|Book|A Course in Mastering Alchemy|Core|Rewire|Connect|Living Lightbody|Energy Essentials)[^\]]*\](?!\()/gi,
    ''
  );
}

/**
 * Remove course/book markdown citation links from a reply.
 * Also removes wrapping parentheses and trailing Session/Lesson detail the model
 * often attaches, so we don't leave leftovers like `(, Session 1)`.
 * @param {string} text
 * @returns {string}
 */
function stripCitationLinks(text) {
  let s = String(text || '');

  // Whole parenthesized cite + optional location detail:
  // ([Course](url), Session 1 — Melchizedek)
  s = s.replace(
    /\(\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*(?:,\s*(?:Session|Lesson|Chapter|Track|Video)\b[^)]*)?\s*\)/gi,
    (full, label, url) => (isCourseCitationMarkdown(label, url) ? '' : full)
  );

  // Inline cite + optional location detail (no wrapping parens):
  // [Course](url), Session 13 — Q&A-1
  // Also stuffed locations: [Level 1, Chapter 1, Track 1 — "…"](url)
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*(?:,\s*(?:Session|Lesson|Chapter|Track|Video)\s+\d+(?:\s*[—\-–:]\s*[^.,!?\n(]{0,120})?)?/gi,
    (full, label, url) => (isCourseCitationMarkdown(label, url) ? '' : full)
  );

  // Leftover bare legacy locations when cites were stripped or never linked.
  s = s.replace(
    /\s*(?:\*{1,2})?(?:in\s+)?Level\s+\d+\s*,\s*(?:Chapter|Session|Track|Lesson)\s+\d+(?:\s*,\s*(?:Chapter|Session|Track|Lesson|Video)\s+\d+)?(?:\s*[—\-–:]\s*(?:"[^"]+"|[^*\n.[,][^*\n.]*?))?(?:\*{1,2})?/gi,
    ''
  );

  // Leftover fragments after a partial strip: (, Session 1) or (, Chapter 1, Track 2 — ...)
  s = s.replace(
    /\s*\(\s*,\s*(?:Session|Lesson|Chapter|Track|Video)\b[^)]*\)/gi,
    ''
  );

  return s;
}

/**
 * @param {string} text
 * @returns {string}
 */
function tidyAfterCitationStrip(text) {
  return String(text || '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+\./g, '.')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/ +\./g, '.')
    .replace(/ +,/g, ',')
    .replace(/ +!/g, '!')
    .replace(/ +\?/g, '?')
    .replace(/ +:/g, ':')
    .replace(/  +/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Collapse duplicated session mentions the model often invents around cites.
 * @param {string} text
 * @returns {string}
 */
function cleanupCitationProse(text) {
  return String(text || '')
    .replace(/\bSession\s+(\d+)\s*[,:]\s*Session\s+\1\b/gi, 'Session $1')
    .replace(/\bSession\s+(\d+)\s+Session\s+\1\b/gi, 'Session $1')
    // Drop quotation marks around track/lesson titles in citation tails.
    .replace(/(\[\s*[^\]]+\]\(\s*https?:\/\/[^)]+\)\s*,\s[^"\n]*)\s*—\s*"([^"]+)"/g, '$1 — $2')
    .replace(/(\[\s*[^\]]+\]\(\s*https?:\/\/[^)]+\)\s*,\s*(?:Session|Lesson|Chapter|Track|Video)\b[^"\n]*)"([^"\n]+)"/g, '$1$2');
}

/**
 * Normalize URL keys so trailing slashes still match Source cites.
 * @param {string} url
 * @returns {string}
 */
function normalizeCiteUrl(url) {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '');
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function isBrokenOrInventedCourseUrl(url) {
  const u = String(url || '').toLowerCase();
  if (/\/not-found\b/.test(u)) return true;
  // Level 2's real Thinkific slug IS level-2-program. Do not flag it.
  // Level 3+ do not use level-N-program (L3 current = rewire-level-3;
  // level-3-program is a separate legacy course with different session numbering).
  return /\/(?:take\/)?level-[1345]-program\b/.test(u);
}

/**
 * @param {string} text
 * @returns {number | null}
 */
function extractLevelNumber(text) {
  const s = String(text || '');
  const m =
    s.match(/\bLevel\s*(\d+)\b/i) ||
    s.match(/\blevel-(\d+)-program\b/i) ||
    s.match(/\brewire-level-(\d+)\b/i) ||
    s.match(/\brewire-l(\d+)\b/i) ||
    s.match(/\benergyessentials-level(\d+)\b/i) ||
    s.match(/\benergy-essentials-l(\d+)\b/i) ||
    s.match(/\bcore-l(\d+)\b/i) ||
    s.match(/\bconnect-level-(\d+)\b/i) ||
    s.match(/\bconnect-l(\d+)\b/i) ||
    s.match(/\bliving-lightbody-level-(\d+)\b/i) ||
    s.match(/\bliving-lightbody-l(\d+)\b/i) ||
    s.match(/\bL(\d+)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {SourceCite[]} cites
 * @param {number} levelNum
 * @returns {SourceCite | null}
 */
function findCiteForLevel(cites, levelNum) {
  if (!cites.length || levelNum == null) return null;
  const levelRe = new RegExp(`\\bLevel\\s*${levelNum}\\b`, 'i');
  const urlRe = new RegExp(
    `(?:rewire-level-${levelNum}|rewire-l${levelNum}|level-${levelNum}-program|level-${levelNum}|/l${levelNum}\\b|mastery-live-${levelNum}|energyessentials-level${levelNum}|energy-essentials-l${levelNum}|core-l${levelNum}|connect-level-${levelNum}|connect-l${levelNum}|living-lightbody-level-${levelNum}|living-lightbody-l${levelNum})`,
    'i'
  );
  return (
    cites.find((c) => !c.isBook && levelRe.test(c.title)) ||
    cites.find((c) => !c.isBook && urlRe.test(c.url)) ||
    null
  );
}

/**
 * Pick the Source cite that matches this markdown link.
 * @param {string} linkText
 * @param {string} url
 * @param {SourceCite[]} cites
 * @returns {SourceCite | null}
 */
function resolveCiteForMarkdownLink(linkText, url, cites) {
  if (!cites.length) return null;

  const normalized = normalizeCiteUrl(url);
  const byUrl = cites.find((c) => normalizeCiteUrl(c.url) === normalized);
  if (byUrl && !isBrokenOrInventedCourseUrl(url)) return byUrl;

  const looksBook =
    /acima|course in mastering alchemy|lesson\s+\d+/i.test(linkText) ||
    /amazon\.com/i.test(url);
  if (looksBook) {
    return cites.find((c) => c.isBook) || null;
  }

  const levelNum =
    extractLevelNumber(linkText) ||
    extractLevelNumber(url) ||
    null;
  const byLevel = findCiteForLevel(cites, levelNum);
  if (byLevel) return byLevel;

  // Invented/broken class URLs should never be kept.
  if (isBrokenOrInventedCourseUrl(url) || /masteringalchemy\.com|thinkific/i.test(url)) {
    return preferredCite(cites.filter((c) => !c.isBook)) || preferredCite(cites);
  }

  return preferredCite(cites.filter((c) => !c.isBook)) || preferredCite(cites);
}

/**
 * Force markdown citation links to use the exact course/book title for a known URL,
 * and replace unknown/invented URLs with the best matching Source cite.
 * Location-stuffed link text becomes a full cite + detail snippet.
 * @param {string} reply
 * @param {string} styleExcerpts
 * @returns {string}
 */
export function repairCitationMarkdown(reply, styleExcerpts) {
  const text = String(reply || '');
  const cites = parseSourceCites(styleExcerpts);
  if (!text || !cites.length) return text;

  return text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (full, linkText, url) => {
    const replacement = resolveCiteForMarkdownLink(linkText, url, cites);
    if (!replacement) return full;
    if (linkTextLooksLikeLocation(linkText)) {
      return formatCiteMarkdown(replacement, detailFromLocationText(linkText));
    }
    return `[${replacement.title}](${replacement.url})`;
  });
}

/**
 * Repair links when citing was requested; otherwise strip unsolicited citation markup.
 * @param {string} reply
 * @param {string} styleExcerpts
 * @param {string} userMessage
 * @returns {string}
 */
export function sanitizeReplyCitations(reply, styleExcerpts, userMessage) {
  let text = String(reply || '');
  if (!text) return text;

  if (userAskedForCitation(userMessage)) {
    text = repairCitationMarkdown(text, styleExcerpts);
    text = ensureProperCitation(text, styleExcerpts);
    text = stripBareLocationBrackets(text);
    text = cleanupCitationProse(text);
    return tidyAfterCitationStrip(text);
  }

  text = stripCitationLinks(text);
  text = stripBareLocationBrackets(text);
  text = cleanupCitationProse(text);
  return tidyAfterCitationStrip(text);
}
