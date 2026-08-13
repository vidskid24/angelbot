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
    /---\s*Source\s+(\d+)\s*---\s*\ncite:\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*(?:\ndetail:\s*([^\n]+))?\s*(?:\naccess:\s*(\w+))?/gi;
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
    /\b(which|what)\s+(class|course|session|level|lesson|book)\b/i.test(t) ||
    /\bfrom\s+which\b/i.test(t) ||
    /\bwhere\s+can\s+i\s+(find|read|listen|watch)\b/i.test(t) ||
    /\blink\s+to\s+(the\s+)?(class|course|lesson|session|book)\b/i.test(t)
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
 * Remove bare [Level …] / [Mastery Live …] brackets that are not markdown links.
 * Important: do not match the label of a real `[Title](url)` citation link.
 * @param {string} text
 * @returns {string}
 */
function stripBareLocationBrackets(text) {
  return String(text || '').replace(
    /\s*\[(?:Level\s+\d+|Mastery Live\s*\d*|Book|A Course in Mastering Alchemy)[^\]]*\](?!\()/gi,
    ''
  );
}

/**
 * Remove course/book markdown citation links from a reply.
 * @param {string} text
 * @returns {string}
 */
function stripCitationLinks(text) {
  return String(text || '').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (full, label, url) => {
    if (
      /masteringalchemy|amazon\.com|thinkific/i.test(url) ||
      /Level\s+\d+|Course|Mastery Live|Book|A Course in Mastering Alchemy/i.test(label)
    ) {
      return '';
    }
    return full;
  });
}

/**
 * @param {string} text
 * @returns {string}
 */
function tidyAfterCitationStrip(text) {
  return String(text || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/ +\./g, '.')
    .replace(/ +,/g, ',')
    .replace(/ +!/g, '!')
    .replace(/ +\?/g, '?')
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
    .replace(/\bSession\s+(\d+)\s+Session\s+\1\b/gi, 'Session $1');
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
 * Force markdown citation links to use the exact course/book title for a known URL,
 * and replace unknown/invented URLs with the best matching Source cite.
 * @param {string} reply
 * @param {string} styleExcerpts
 * @returns {string}
 */
export function repairCitationMarkdown(reply, styleExcerpts) {
  const text = String(reply || '');
  const cites = parseSourceCites(styleExcerpts);
  if (!text || !cites.length) return text;

  const byUrl = new Map(cites.map((c) => [normalizeCiteUrl(c.url), c]));
  const fallback = preferredCite(cites);

  return text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (full, linkText, url) => {
    const matched = byUrl.get(normalizeCiteUrl(url));
    if (matched) {
      // Course/book name only — never leave Session/Lesson text inside the link label.
      return `[${matched.title}](${matched.url})`;
    }

    const looksBook = /acima|course in mastering alchemy|lesson\s+\d+/i.test(linkText);
    const replacement = looksBook
      ? cites.find((c) => c.isBook) || fallback
      : preferredCite(cites.filter((c) => !c.isBook)) || fallback;
    if (!replacement) return full;
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
    text = stripBareLocationBrackets(text);
    text = cleanupCitationProse(text);
    return tidyAfterCitationStrip(text);
  }

  text = stripCitationLinks(text);
  text = stripBareLocationBrackets(text);
  text = cleanupCitationProse(text);
  return tidyAfterCitationStrip(text);
}
