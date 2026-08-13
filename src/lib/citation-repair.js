/**
 * Server-owned provenance: catalog `cite:` / `detail:` are the only course
 * titles and URLs. The model teaches from excerpt bodies; we attach the
 * catalog line when the user asks where something comes from.
 */

import { citeFromSourceLabel } from '../rag/course-catalog.js';

/**
 * @typedef {{
 *   index: number;
 *   title: string;
 *   url: string;
 *   detail: string;
 *   access: string;
 *   isBook: boolean;
 *   body?: string;
 * }} SourceCite
 */

/**
 * @typedef {{
 *   index: number;
 *   title: string;
 *   url: string;
 *   detail: string;
 *   access: string;
 *   labelLine: string;
 *   body: string;
 * }} SourceBlock
 */

/**
 * @param {string} excerpts
 * @returns {SourceBlock[]}
 */
export function parseSourceBlocks(excerpts) {
  const text = String(excerpts || '').trim();
  if (!text) return [];
  const parts = text.split(/\n(?=---\s*Source(?:\s+\d+)?\s*---)/i);
  /** @type {SourceBlock[]} */
  const blocks = [];
  for (let i = 0; i < parts.length; i++) {
    const part = String(parts[i] || '').trim();
    if (!part) continue;
    const headerMatch = part.match(/^---\s*Source(?:\s+(\d+))?\s*---\s*/i);
    const rest = headerMatch ? part.slice(headerMatch[0].length) : part;
    const citeMatch = rest.match(/cite:\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/i);
    const detailMatch = rest.match(/detail:\s*([^\n\r]+)/i);
    const accessMatch = rest.match(/access:\s*(\w+)/i);
    const pipeMatch = rest.match(
      /^([^\n|]+?)\s*\|\s*(?:purchase:\s*)?(https?:\/\/[^\s]+)/im
    );
    const bodyMatch = rest.match(/\n---\s*\n([\s\S]*)$/);
    const headerLines = rest
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && l !== '---' && !/^(cite|detail|access):/i.test(l));
    const labelLine = String(pipeMatch?.[1] || headerLines[0] || '').trim();
    blocks.push({
      index: Number(headerMatch?.[1]) || i + 1,
      title: String(citeMatch?.[1] || '').trim(),
      url: String(citeMatch?.[2] || pipeMatch?.[2] || '').trim(),
      detail: String(detailMatch?.[1] || '').trim(),
      access: String(accessMatch?.[1] || '').trim().toLowerCase(),
      labelLine,
      body: String(bodyMatch?.[1] || '').trim(),
    });
  }
  return blocks;
}

/**
 * @param {SourceBlock} block
 * @param {number} fallbackIndex
 * @returns {SourceCite}
 */
function blockToCite(block, fallbackIndex) {
  const title = String(block.title || '').trim();
  const url = String(block.url || '').trim();
  const access = String(block.access || '').trim().toLowerCase();
  return {
    index: Number(block.index) || fallbackIndex,
    title,
    url,
    detail: String(block.detail || '').trim(),
    access,
    isBook:
      access === 'purchase' && /amazon\.com/i.test(url)
        ? true
        : /course in mastering alchemy book|acima/i.test(`${title} ${url}`) ||
          /amazon\.com/i.test(url),
    body: String(block.body || ''),
  };
}

/**
 * @param {string} excerpts
 * @param {import('../rag/course-catalog.js').CourseCatalog | null} [catalog]
 * @returns {SourceCite[]}
 */
export function parseSourceCites(excerpts, catalog = null) {
  const blocks = parseSourceBlocks(excerpts);
  /** @type {SourceCite[]} */
  const cites = [];
  for (const block of blocks) {
    if (block.title && block.url) {
      cites.push(blockToCite(block, cites.length + 1));
      continue;
    }
    if (block.url) {
      const title =
        block.title ||
        block.labelLine.split(',')[0].replace(/\s*\|\s*$/, '').trim() ||
        'Course';
      cites.push(blockToCite({ ...block, title }, cites.length + 1));
      continue;
    }
    if (catalog && block.labelLine) {
      const hydrated = citeFromSourceLabel(block.labelLine, catalog);
      if (hydrated?.title && hydrated?.url) {
        cites.push({
          index: block.index || cites.length + 1,
          title: hydrated.title,
          url: hydrated.url,
          detail: block.detail || hydrated.detail || '',
          access: hydrated.access || 'classroom',
          isBook: Boolean(hydrated.isBook),
          body: block.body,
        });
      }
    }
  }
  if (cites.length) return cites;

  const text = String(excerpts || '');
  const looseCite = /cite:\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi;
  let match;
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
      body: '',
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
    /\bwhere\s+is\s+(this|that|the)\s+quote\b/i.test(t) ||
    /\b(where\s+(is|did|does|was|came|come)|source|citation|cite|reference|references)\b/i.test(t) ||
    /\b(which|what)\s+(class|course|session|level|lesson|book|chapter)\b/i.test(t) ||
    /\b(what|which)\s+course\b/i.test(t) ||
    /\bfrom\s+which\b/i.test(t) ||
    /\bwhere\b.{0,80}\b(come|comes|came|coming)\s+from\b/i.test(t) ||
    /\bwhere\s+(?:is\s+)?(?:this|that|it)\s+from\b/i.test(t) ||
    /\btell me where\b/i.test(t) ||
    /\bquote\b.{0,40}\b(from|source|course|class|where|courses)\b/i.test(t) ||
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
 * @param {string} reply
 * @param {string} body
 * @returns {number}
 */
function quoteOverlapScore(reply, body) {
  const r = normalizeForQuoteCheck(reply);
  const b = normalizeForQuoteCheck(body);
  if (!r || !b || r.length < 24 || b.length < 24) return 0;
  if (b.includes(r) || r.includes(b)) return Math.min(r.length, b.length);
  const words = r.split(' ').filter(Boolean);
  for (let n = Math.min(20, words.length); n >= 8; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const span = words.slice(i, i + n).join(' ');
      if (span.length >= 40 && b.includes(span)) return span.length;
    }
  }
  return 0;
}

/**
 * @param {SourceCite[]} cites
 * @param {string} userMessage
 * @param {string} [replyText]
 * @returns {SourceCite | null}
 */
function pickCite(cites, userMessage, replyText = '') {
  if (!cites.length) return null;

  let best = null;
  let bestScore = 0;
  for (const cite of cites) {
    const score = quoteOverlapScore(replyText, cite.body || '');
    if (score > bestScore) {
      bestScore = score;
      best = cite;
    }
  }
  if (best && bestScore >= 40) return best;

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
 * @param {import('../rag/course-catalog.js').CourseCatalog | null} [catalog]
 * @returns {string}
 */
export function sanitizeReplyCitations(reply, styleExcerpts, userMessage, catalog = null) {
  const original = String(reply || '');
  if (!original) return original;

  let text = verifyQuotesAgainstExcerpts(original, styleExcerpts);
  text = stripModelCitationMarkup(text);

  if (!userAskedForCitation(userMessage)) {
    return tidyProse(text);
  }

  text = cleanupRedactedLocationJunk(text);
  const cite = pickCite(parseSourceCites(styleExcerpts, catalog), userMessage, text);
  if (!cite) return tidyProse(text);

  return tidyProse(ensureCitePresent(text, formatCiteMarkdown(cite)));
}
