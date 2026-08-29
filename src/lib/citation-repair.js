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

/** Max chars for merged follow-up excerpts (matches wisdom capStyleExcerpts default). */
export const MERGED_EXCERPT_MAX_CHARS = 12000;

/** Max distinct source blocks kept when merging prior + new retrieval. */
export const MERGED_EXCERPT_MAX_BLOCKS = 12;

/**
 * User wants a fuller or stepwise answer on the same thread topic.
 * @param {string} message
 * @returns {boolean}
 */
export function userAskedForMoreDetail(message) {
  const t = String(message || '');
  if (!t.trim()) return false;
  if (userAskedForCitation(t)) return false;
  return (
    /\bmore\s+(?:detail|explicit|specific|thorough(?:ly)?)\b/i.test(t) ||
    /\b(?:step[\s-]*by[\s-]*step|walk\s+me\s+through)\b/i.test(t) ||
    /\b(?:exact|full)\s+(?:sequence|protocol|steps?)\b/i.test(t) ||
    /\bin\s+what\s+order\b/i.test(t) ||
    /\b(?:expand|elaborate)\s+(?:on|that|this|it)\b/i.test(t) ||
    /\bgo\s+(?:deeper|into\s+more\s+detail)\b/i.test(t) ||
    /\bbreak\s+(?:it|this|that)\s+down\b/i.test(t) ||
    /\bspell\s+(?:it|this|that)\s+out\b/i.test(t) ||
    /\blist\s+(?:the\s+)?steps\b/i.test(t) ||
    /\b(?:what|give)\s+(?:are\s+)?(?:me\s+)?(?:the\s+)?steps\b/i.test(t) ||
    /\bhow\s+exactly\b/i.test(t)
  );
}

/**
 * @param {SourceBlock} block
 * @returns {string}
 */
function blockDedupeKey(block) {
  const body = String(block.body || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)
    .toLowerCase();
  return `${String(block.url || '').trim()}|${String(block.detail || '').trim()}|${body}`;
}

/**
 * @param {SourceBlock} block
 * @param {number} index
 * @returns {string}
 */
function serializeSourceBlockForRetrieval(block, index) {
  const header = `--- Source ${index} ---`;
  const title = String(block.title || '').trim();
  const url = String(block.url || '').trim();
  const detail = String(block.detail || '').trim();
  const access = String(block.access || '').trim().toLowerCase();
  const body = String(block.body || '').trim();
  const labelLine = String(block.labelLine || '').trim();

  if (title && url) {
    const headerLines = [header, `cite: [${title}](${url})`];
    if (detail) headerLines.push(`detail: ${detail}`);
    if (access) headerLines.push(`access: ${access}`);
    headerLines.push('---');
    return body ? `${headerLines.join('\n')}\n${body}` : headerLines.join('\n');
  }

  if (labelLine && url) {
    const pipe =
      access === 'purchase'
        ? `${labelLine} | purchase: ${url}`
        : `${labelLine} | ${url}`;
    return body ? `${header}\n${pipe}\n---\n${body}` : `${header}\n${pipe}`;
  }

  return body ? `${header}\n---\n${body}` : header;
}

/**
 * Merge fresh retrieval with prior stored excerpts on detail follow-ups.
 * Dedupes by url + detail + body prefix; caps block count and total chars.
 * @param {string} previousExcerpts
 * @param {string} newExcerpts
 * @param {{ maxChars?: number; maxBlocks?: number }} [options]
 * @returns {string}
 */
export function mergeRetrievedExcerpts(previousExcerpts, newExcerpts, options = {}) {
  const maxChars = Number(options.maxChars) > 0 ? Number(options.maxChars) : MERGED_EXCERPT_MAX_CHARS;
  const maxBlocks =
    Number(options.maxBlocks) > 0 ? Number(options.maxBlocks) : MERGED_EXCERPT_MAX_BLOCKS;
  const incoming = parseSourceBlocks(newExcerpts);
  const prior = parseSourceBlocks(previousExcerpts);
  const seen = new Set();
  /** @type {SourceBlock[]} */
  const merged = [];

  const add = (block) => {
    const key = blockDedupeKey(block);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(block);
  };

  for (const block of incoming) add(block);
  for (const block of prior) add(block);

  let text = '';
  for (let i = 0; i < Math.min(merged.length, maxBlocks); i++) {
    const part = serializeSourceBlockForRetrieval(merged[i], i + 1);
    const next = text ? `${text}\n\n${part}` : part;
    if (next.length > maxChars) break;
    text = next;
  }
  return text;
}

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
 * Opening `"` must follow whitespace or punctuation — not a word character or another quote.
 * Prevents `"ecstasy" from the universal mind"` from being read as `" from the universal mind"`.
 * @param {string} text
 * @param {number} openIndex
 * @returns {boolean}
 */
function isQuoteOpenPosition(text, openIndex) {
  if (openIndex <= 0) return true;
  const before = text[openIndex - 1];
  return !/[\w"'\u2018\u2019\u201C\u201D]/.test(before);
}

/**
 * @param {string} text
 * @param {string} haystack normalized excerpt text; empty means strip all long quotes
 * @returns {string}
 */
function stripUnverifiedQuotes(text, haystack) {
  const s = String(text || '').replace(/[\u201C\u201D]/g, '"');
  return s.replace(/"([^"]{12,})"/g, (full, inner, offset) => {
    if (!isQuoteOpenPosition(s, offset)) return full;
    const trimmed = String(inner || '').trim();
    if (trimmed.length < 12) return full;
    if (!haystack) return trimmed;
    const needle = normalizeForQuoteCheck(trimmed);
    if (needle.length >= 12 && haystack.includes(needle)) return full;
    return trimmed;
  });
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
  return stripUnverifiedQuotes(reply, haystack);
}

/**
 * @param {string} text
 * @returns {string}
 */
function tidyProse(text) {
  return String(text || '')
    .replace(/([a-z])"([A-Z])/g, '$1 $2')
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
