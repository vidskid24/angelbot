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
 * Excerpt bodies only — no course titles, URLs, or session labels for the model.
 * @param {string} excerpts
 * @returns {string}
 */
export function excerptBodiesForModel(excerpts) {
  const text = String(excerpts || '').trim();
  if (!text) return '';
  if (!/---\s*Source(?:\s+\d+)?\s*---/i.test(text)) {
    return text
      .replace(/^cite:\s*.*$/gim, '')
      .replace(/^detail:\s*.*$/gim, '')
      .replace(/^access:\s*.*$/gim, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  const out = parseSourceBlocks(text)
    .map((b, i) => {
      const body = String(b.body || '').trim();
      return body ? `--- Excerpt ${i + 1} ---\n${body}` : '';
    })
    .filter(Boolean);
  return out.join('\n\n');
}

/**
 * Catalog sources for the widget Source control.
 * @param {string} excerpts
 * @param {import('../rag/course-catalog.js').CourseCatalog | null} [catalog]
 * @returns {Array<{ title: string; url: string; detail: string; access: string }>}
 */
export function sourcesFromExcerpts(excerpts, catalog = null) {
  const cites = parseSourceCites(excerpts, catalog);
  const seen = new Set();
  /** @type {Array<{ title: string; url: string; detail: string; access: string }>} */
  const out = [];
  for (const c of cites) {
    const title = String(c.title || '').trim();
    const url = String(c.url || '').trim();
    if (!title || !url) continue;
    const detail = String(c.detail || '').trim();
    const key = `${title}|${url}|${detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      url,
      detail,
      access: String(c.access || '').trim(),
    });
  }
  return out;
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
 * Drop invented classroom coordinates; Source UI owns provenance.
 * @param {string} text
 * @returns {string}
 */
function stripInventedLocations(text) {
  return String(text || '')
    .replace(
      /\bcomes?\s+(?:straight\s+)?from\s+Level\s+\d+(?:\s*[—\-–,]\s*Session\s+\d+(?:\s*[—\-–:]\s*[^.,\n]{0,80})?)?/gi,
      'comes from the coursework'
    )
    .replace(/\bLevel\s+\d+\s*,\s*Session\s+\d+(?:\s*[—\-–:]\s*[^.,\n]{0,80})?/gi, '')
    .replace(
      /\b(?:Energy Essentials|Core|Rewire|Connect|Living Lightbody)\s*[—\-–:]\s*Level\s+\d+(?:\s+Program)?\b/gi,
      ''
    )
    .replace(
      /\bLevel\s+\d+\s*[—\-–:]\s*(?:Energy Essentials|Core(?:\s+Program)?|Rewire|Connect|Living Lightbody)\b/gi,
      ''
    );
}

/**
 * Strip invented cites/locations. Do not inject catalog lines into prose.
 * @param {string} reply
 * @param {string} styleExcerpts
 * @param {string} [_userMessage]
 * @returns {string}
 */
export function sanitizeReplyCitations(reply, styleExcerpts, _userMessage) {
  const original = String(reply || '');
  if (!original) return original;

  let text = verifyQuotesAgainstExcerpts(original, styleExcerpts);
  text = stripModelCitationMarkup(text);
  text = stripInventedLocations(text);
  text = cleanupRedactedLocationJunk(text);
  return tidyProse(text);
}
