/**
 * Server-owned citations: catalog `cite:` / `detail:` are the only allowed
 * course names and URLs. The model must not invent links; we strip any it
 * writes and inject the matching Source header when the user asked for a source.
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
 *
 * @typedef {{ sourceIndex: number | null; levelNum: number | null }} CiteHints
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
 * @param {SourceCite} cite
 * @returns {string}
 */
function formatCiteMarkdown(cite) {
  if (!cite?.title || !cite?.url) return '';
  const detail = String(cite.detail || '').trim();
  return detail ? `[${cite.title}](${cite.url}), ${detail}` : `[${cite.title}](${cite.url})`;
}

/**
 * @param {string} text
 * @returns {number | null}
 */
function extractLevelNumber(text) {
  const m = String(text || '').match(/\bLevel\s+(\d+)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Course-name hints only when no explicit "Level N" is present.
 * @param {string} text
 * @returns {number | null}
 */
function extractLevelFromCourseName(text) {
  const t = String(text || '');
  if (/\bEnergy Essentials\b/i.test(t)) return 1;
  if (/\bRewire\b/i.test(t)) return 3;
  if (/\bConnect\b/i.test(t)) return 4;
  if (/\bLiving Lightbody\b/i.test(t)) return 5;
  if (/\bCore\b/i.test(t)) return 2;
  return null;
}

/**
 * @param {string} text
 * @returns {CiteHints}
 */
function extractCiteHints(text) {
  const s = String(text || '');
  const sourceMatch = s.match(/\[\[\s*source:\s*(\d+)\s*\]\]/i);
  const sourceIndex = sourceMatch ? Number(sourceMatch[1]) : null;
  const levelNum = extractLevelNumber(s) || extractLevelFromCourseName(s);
  return {
    sourceIndex: Number.isFinite(sourceIndex) ? sourceIndex : null,
    levelNum: Number.isFinite(levelNum) ? levelNum : null,
  };
}

/**
 * @param {SourceCite[]} cites
 * @param {number} levelNum
 * @returns {SourceCite | null}
 */
function findCiteForLevel(cites, levelNum) {
  if (!cites.length || levelNum == null) return null;
  const levelRe = new RegExp(`\\bLevel\\s*${levelNum}\\b`, 'i');
  return cites.find((c) => !c.isBook && levelRe.test(c.title)) || null;
}

/**
 * @param {SourceCite[]} cites
 * @param {CiteHints} hint
 * @param {string} userMessage
 * @returns {SourceCite | null}
 */
function pickCite(cites, hint, userMessage) {
  if (!cites.length) return null;

  if (hint?.sourceIndex != null) {
    const byIndex = cites.find((c) => c.index === hint.sourceIndex);
    if (byIndex) return byIndex;
  }

  const levelNum = hint?.levelNum || extractLevelNumber(userMessage) || extractLevelFromCourseName(userMessage);
  const byLevel = findCiteForLevel(cites, levelNum);
  if (byLevel) return byLevel;

  const looksBook = /\b(book|acima|lesson)\b/i.test(String(userMessage || ''));
  if (looksBook) {
    const book = cites.find((c) => c.isBook);
    if (book) return book;
  }

  return preferredCite(cites);
}

/**
 * Remove model-invented citation markup, location phrases, and source markers.
 * @param {string} text
 * @returns {string}
 */
function stripModelCitations(text) {
  let s = String(text || '');

  s = s.replace(/\[\[\s*source:\s*\d+\s*\]\]/gi, '');

  // Parenthesized markdown cite + optional location detail.
  s = s.replace(
    /\(\s*\[[^\]]+\]\(https?:\/\/[^)\s]+\)\s*(?:,\s*(?:Session|Lesson|Chapter|Track|Video)\b[^)]*)?\s*\)/gi,
    ''
  );

  // Inline markdown cite + optional location detail (course/book URLs or any http link
  // whose label looks like a course/level/book title).
  s = s.replace(
    /\[[^\]]+\]\(https?:\/\/[^)\s]+\)\s*(?:,\s*(?:Session|Lesson|Chapter|Track|Video)\s+\d+(?:\s*[—\-–:]\s*[^.,!?\n(]{0,120})?)?/gi,
    (full) => (/masteringalchemy|amazon\.com|thinkific|Level\s+\d+|Core|Rewire|Connect|Living Lightbody|Energy Essentials|Course in Mastering Alchemy|Mastery Live/i.test(full) ? '' : full)
  );

  // Bare [Level …] / [Course name …] brackets that are not markdown links.
  s = s.replace(
    /\s*\[(?:Level\s+\d+|Mastery Live\s*\d*|Book|A Course in Mastering Alchemy|Core|Rewire|Connect|Living Lightbody|Energy Essentials)[^\]]*\](?!\()/gi,
    ''
  );

  // Invented or unlinked course titles: "Level 4 - Core Program", "Connect - Level 4".
  s = s.replace(
    /(?:\*{1,2})?(?:Level\s+\d+\s*[—\-–:]\s*(?:Core(?:\s+Program)?|Rewire|Connect|Living Lightbody|Energy Essentials|Program)|(?:Energy Essentials|Core|Rewire|Connect|Living Lightbody)\s*[—\-–:]\s*Level\s+\d+(?:\s+Program)?|Level\s+\d+\s+Program|A Course in Mastering Alchemy(?: Book)?)(?:\s*,\s*(?:Chapter|Session|Track|Lesson|Video)\s+\d+(?:\s*[—\-–:]\s*[^.,!?\n*]{0,80})?)?(?:\*{1,2})?/gi,
    ''
  );

  // Legacy location phrases: Level 1, Chapter 1, Track 1 — "…".
  s = s.replace(
    /(?:\*{1,2})?Level\s+\d+\s*,\s*(?:Chapter|Session|Track|Lesson)\s+\d+(?:\s*,\s*(?:Chapter|Session|Track|Lesson|Video)\s+\d+)?(?:\s*[—\-–:]\s*(?:"[^"]+"|[^*\n.[,][^*\n.]*?))?(?:\*{1,2})?/gi,
    ''
  );

  s = s.replace(/\s*\(\s*,\s*(?:Session|Lesson|Chapter|Track|Video)\b[^)]*\)/gi, '');

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
    .replace(/\bin\s+of\s+the\b/gi, 'in the')
    .replace(/\bin\s+of\b/gi, 'in')
    .replace(/  +/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Splice a catalog cite into the reply, or append it.
 * @param {string} text
 * @param {string} snippet
 * @returns {string}
 */
function attachCiteSnippet(text, snippet) {
  let t = tidyAfterCitationStrip(text);
  if (!snippet) return t;
  t = t.replace(/^(see|look(?:\s+here)?)\.?\s*$/i, '').trim();
  if (!t) return `You can find this in ${snippet}.`;

  const spliced = t.replace(
    /\b(in|from)(?:\s+(?:the\s+)?(?:coursework|course|class|material|book)?)?\.?\s*$/i,
    `$1 ${snippet}`
  );
  if (spliced !== t) return spliced;

  const spliced2 = t.replace(
    /\b(in|from)\s+(?:the\s+)?(?:coursework|course|class|material)\b/i,
    `$1 ${snippet}`
  );
  if (spliced2 !== t) return spliced2;

  return `${t} You can find this in ${snippet}.`;
}

/**
 * Strip unsolicited cites, or replace them with the catalog Source cite.
 * @param {string} reply
 * @param {string} styleExcerpts
 * @param {string} userMessage
 * @returns {string}
 */
export function sanitizeReplyCitations(reply, styleExcerpts, userMessage) {
  const original = String(reply || '');
  if (!original) return original;

  const cites = parseSourceCites(styleExcerpts);
  const hint = extractCiteHints(original);
  let text = stripModelCitations(original);

  if (!userAskedForCitation(userMessage)) {
    return tidyAfterCitationStrip(text);
  }

  const cite = pickCite(cites, hint, userMessage);
  if (!cite) return tidyAfterCitationStrip(text);

  const snippet = formatCiteMarkdown(cite);
  return tidyAfterCitationStrip(attachCiteSnippet(text, snippet));
}
