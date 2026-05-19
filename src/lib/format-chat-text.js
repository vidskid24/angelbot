/**
 * Normalize markdown asterisks (ASCII + common Unicode lookalikes, zero-width chars).
 * @param {string} text
 * @returns {string}
 */
export function normalizeBoldMarkers(text) {
  return String(text ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u2217\uFF0A\u2055]/g, '*')
    .replace(/\\\*\\\*/g, '**');
}

const MAX_ITALIC_CHARS = 40;
const MAX_ITALIC_WORDS = 4;

/** Same-line italic only; opening * must not be followed by space (avoids "* bullet" lists). */
const ITALIC_RE = /(?<!\*)\*(?!\*)(?!\s)([^*\n]{1,40}?)(?<!\s)\*(?!\*)/g;

/**
 * @param {string} inner
 * @returns {boolean}
 */
function isValidItalicContent(inner) {
  const t = String(inner || '').trim();
  if (!t || t.length > MAX_ITALIC_CHARS) return false;
  if (/\n/.test(t)) return false;
  if (t.split(/\s+/).length > MAX_ITALIC_WORDS) return false;
  return true;
}

/**
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * @param {string} chunk
 * @param {Array<{ type: 'text' | 'bold' | 'italic'; content: string }>} segments
 */
function parseItalicInTextChunk(chunk, segments) {
  let lastIndex = 0;
  let match;
  ITALIC_RE.lastIndex = 0;
  while ((match = ITALIC_RE.exec(chunk)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: chunk.slice(lastIndex, match.index) });
    }
    if (isValidItalicContent(match[1])) {
      segments.push({ type: 'italic', content: match[1] });
    } else {
      segments.push({ type: 'text', content: match[0] });
    }
    lastIndex = ITALIC_RE.lastIndex;
  }
  if (lastIndex < chunk.length) {
    segments.push({ type: 'text', content: chunk.slice(lastIndex) });
  }
}

/**
 * Split message into plain, bold (**), and safe italic (*) segments.
 * @param {string} text
 * @returns {Array<{ type: 'text' | 'bold' | 'italic'; content: string }>}
 */
export function parseChatMarkdownSegments(text) {
  const normalized = normalizeBoldMarkers(text);
  const segments = [];
  const boldRe = /\*\*([^*]+?)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = boldRe.exec(normalized)) !== null) {
    if (match.index > lastIndex) {
      parseItalicInTextChunk(normalized.slice(lastIndex, match.index), segments);
    }
    segments.push({ type: 'bold', content: match[1] });
    lastIndex = boldRe.lastIndex;
  }
  if (lastIndex < normalized.length) {
    parseItalicInTextChunk(normalized.slice(lastIndex), segments);
  }
  return segments;
}

/**
 * Web chat display: escape HTML and render **bold** and *italic* markers.
 * @param {string} text
 * @returns {string} Safe HTML fragment
 */
export function formatChatTextHtml(text) {
  return parseChatMarkdownSegments(text)
    .map((seg) => {
      const esc = escapeHtml(seg.content);
      if (seg.type === 'bold') return `<strong>${esc}</strong>`;
      if (seg.type === 'italic') return `<em class="omibot-italic">${esc}</em>`;
      return esc;
    })
    .join('');
}
