/**
 * Server-owned provenance: catalog `cite:` / `detail:` are the only course
 * titles and URLs. The model teaches from excerpt bodies; we attach the
 * catalog line when the user asks where something comes from.
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
    /---\s*Source\s+(\d+)\s*---\s*(?:\r?\n)+cite:\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)[ \t]*(?:\r?\n[ \t]*detail:\s*([^\n\r]+))?[ \t]*(?:\r?\n[ \t]*access:\s*(\w+))?/gi;
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
  if (cites.length) return cites;

  const looseCite = /cite:\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi;
  while ((match = looseCite.exec(text)) !== null) {
    const title = String(match[1] || '').trim();
    const url = String(match[2] || '').trim();
    if (!title || !url) continue;
    cites.push({
      index: cites.length + 1,
      title,
      url,
      detail: '',
      access: /amazon\.com/i.test(url) ? 'purchase' : 'classroom',
      isBook: /amazon\.com|course in mastering alchemy book|acima/i.test(`${title} ${url}`),
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
    /\b(what|which)\s+course\b/i.test(t) ||
    /\bfrom\s+which\b/i.test(t) ||
    /\bwhere\b.{0,80}\b(come|comes|came|coming)\s+from\b/i.test(t) ||
    /\bwhere\s+(?:is\s+)?(?:this|that|it)\s+from\b/i.test(t) ||
    /\btell me where\b/i.test(t) ||
    /\bquote\b.{0,80}\b(from|source|course|class|where|courses)\b/i.test(t) ||
    /\bwhere\s+(?:can|could|do|would|might)\s+i\s+(?:find|read|listen|watch|get|see|locate)\b/i.test(t) ||
    /\bwhere\s+(?:to\s+)?find\b/i.test(t) ||
    /\bwhere\s+(?:in\s+)?(?:the\s+)?(?:coursework|courses|course|class|material|transcript)\b/i.test(t) ||
    /\bfind\s+(?:this|that|it|more|the\s+answer|that\s+answer)\b.*\b(?:coursework|courses|course|class|session|level)\b/i.test(
      t
    ) ||
    /\blink\s+to\s+(the\s+)?(class|course|lesson|session|book)\b/i.test(t) ||
    /\bin\s+(?:which|what)\s+(?:part\s+of\s+)?(?:the\s+)?(?:coursework|courses|course|class)\b/i.test(t)
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
 * @param {SourceCite[]} cites
 * @param {string} userMessage
 * @returns {SourceCite | null}
 */
function pickCite(cites, userMessage) {
  if (!cites.length) return null;
  const levelNum = extractLevelNumber(userMessage);
  if (levelNum != null) {
    const levelRe = new RegExp(`\\bLevel\\s*${levelNum}\\b`, 'i');
    const byLevel = cites.find((c) => !c.isBook && levelRe.test(c.title));
    if (byLevel) return byLevel;
  }
  if (/\b(book|acima|lesson)\b/i.test(String(userMessage || ''))) {
    const book = cites.find((c) => c.isBook);
    if (book) return book;
  }
  return preferredCite(cites);
}

/**
 * @param {string} markdown
 * @returns {boolean}
 */
function isInventedCitationLink(markdown) {
  return /masteringalchemy|amazon\.com|thinkific|Level\s+\d+|Core|Rewire|Connect|Living Lightbody|Energy Essentials|Course in Mastering Alchemy|Mastery Live/i.test(
    String(markdown || '')
  );
}

/**
 * Strip only invented markdown cites / source markers. Leave teacher names,
 * Q&A, and prose alone.
 * @param {string} text
 * @returns {string}
 */
function stripModelCitationMarkup(text) {
  let s = String(text || '');
  s = s.replace(/\[\[\s*source\s*:\s*[^\]\n]*\]\]/gi, '');
  s = s.replace(/\[source\s*:\s*[^\]]+\]/gi, '');
  s = s.replace(
    /\(\s*\[[^\]]+\]\(https?:\/\/[^)\s]+\)\s*(?:,\s*(?:Session|Lesson|Chapter|Track|Video)\b[^)]*)?\s*\)/gi,
    (full) => (isInventedCitationLink(full) ? '' : full)
  );
  s = s.replace(
    /\[[^\]]+\]\(https?:\/\/[^)\s]+\)\s*(?:,\s*(?:Session|Lesson|Chapter|Track|Video)\s+\d+(?:\s*[—\-–:]\s*[^.,!?\n(]{0,120})?)?/gi,
    (full) => (isInventedCitationLink(full) ? '' : full)
  );
  return s;
}

/**
 * Drop redaction artifacts like "_A" / "&A" without removing real "Q&A".
 * @param {string} text
 * @returns {string}
 */
function cleanupRedactedLocationJunk(text) {
  return String(text || '')
    .replace(/\s*,\s*and also pops up in(?:\s+_A|\s+&A)+\b/gi, '')
    .replace(/\bpops up in(?:\s+_A|\s+&A)+\b/gi, '')
    .replace(/\bcomes?\s+(?:straight\s+)?from(?:\s+_A|\s+&A)+\s*,?\s*(?:with\s+)?/gi, 'comes from ')
    .replace(/\b_A\b/g, '')
    .replace(/(^|[\s,])&A\b/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');
}

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeForQuoteCheck(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^a-z0-9']+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * If quoted text is not actually in the excerpts, drop the quote marks so we
 * do not present a paraphrase as a verbatim source quote.
 * @param {string} reply
 * @param {string} excerpts
 * @returns {string}
 */
export function verifyQuotesAgainstExcerpts(reply, excerpts) {
  const haystack = normalizeForQuoteCheck(excerpts);
  if (!haystack) {
    return String(reply || '').replace(/[“”]/g, '"').replace(/"([^"]{12,})"/g, '$1');
  }

  return String(reply || '').replace(/“([^”]{12,})”|"([^"]{12,})"/g, (full, curly, straight) => {
    const inner = String(curly || straight || '').trim();
    if (!inner) return full;
    const needle = normalizeForQuoteCheck(inner);
    if (needle.length >= 12 && haystack.includes(needle)) return full;
    return inner;
  });
}

/**
 * @param {string} text
 * @returns {string}
 */
function tidyProse(text) {
  return String(text || '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+and\s+[.,]/g, '.')
    .replace(/\bSee\s*[.]/gi, '.')
    .replace(/\.{2,}/g, '.')
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
 * Append the catalog cite without rewriting the model's teaching prose.
 * @param {string} text
 * @param {string} snippet
 * @returns {string}
 */
function ensureCitePresent(text, snippet) {
  const t = String(text || '').trim();
  const urlMatch = String(snippet || '').match(/\((https?:\/\/[^)\s]+)\)/);
  const url = urlMatch ? urlMatch[1] : '';
  if (url && t.includes(url)) return t;
  if (!snippet) return t;

  const gate = t.match(
    /(\n\n(?:Want to |Would you like |How would you like |Is there |Are you complete).*)\s*$/is
  );
  if (gate) {
    const head = t.slice(0, t.length - gate[1].length).trim();
    return `${head} You can find this in ${snippet}.${gate[1]}`;
  }
  if (!t) return `You can find this in ${snippet}.`;
  return `${t} You can find this in ${snippet}.`;
}

/**
 * @param {string} reply
 * @param {string} styleExcerpts
 * @param {string} userMessage
 * @returns {string}
 */
export function sanitizeReplyCitations(reply, styleExcerpts, userMessage) {
  const original = String(reply || '');
  if (!original) return original;

  let text = verifyQuotesAgainstExcerpts(original, styleExcerpts);
  text = stripModelCitationMarkup(text);

  if (!userAskedForCitation(userMessage)) {
    return tidyProse(text);
  }

  text = cleanupRedactedLocationJunk(text);
  const cite = pickCite(parseSourceCites(styleExcerpts), userMessage);
  if (!cite) return tidyProse(text);

  return tidyProse(ensureCitePresent(text, formatCiteMarkdown(cite)));
}
