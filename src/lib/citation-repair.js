/**
 * Keep citation markdown links aligned with RAG Source `cite:` values.
 * Models often invent link text (lesson titles, "ACIMA") or mix a book title with a class URL.
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

  const byUrl = new Map(cites.map((c) => [c.url, c]));
  const fallback = preferredCite(cites);

  return text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (full, linkText, url) => {
    const matched = byUrl.get(url);
    if (matched) {
      // Keep the correct destination; never allow lesson/session text inside the link label.
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
