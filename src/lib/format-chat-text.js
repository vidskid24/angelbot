/**
 * Normalize markdown asterisks (ASCII + common Unicode lookalikes, zero-width chars).
 * @param {string} text
 * @returns {string}
 */
export function normalizeBoldMarkers(text) {
  return String(text ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u2217\uFF0A\u2055]/g, '*')
    .replace(/\uFF3F/g, '_')
    .replace(/\\\*\\\*/g, '**');
}

/** Same-line italic; opening marker must not be followed by space (avoids "* bullet" lists). */
const ITALIC_RE =
  /(?<!\*)\*(?!\*)(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)|(?<!_)_(?!_)(?!\s)([^_\n]+?)(?<!\s)_(?!_)/g;

/**
 * @param {string} inner
 * @returns {boolean}
 */
function isValidItalicContent(inner) {
  const t = String(inner || '').trim();
  if (!t || /\n/.test(t)) return false;
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
    const inner = match[1] != null && match[1] !== '' ? match[1] : match[2];
    if (isValidItalicContent(inner)) {
      segments.push({ type: 'italic', content: inner });
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
 * Split message into plain, bold (**), and italic (* or _) segments.
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
 * @param {string} text
 * @returns {string}
 */
function formatInlineHtml(text) {
  return parseChatMarkdownSegments(text)
    .map((seg) => {
      const esc = escapeHtml(seg.content);
      if (seg.type === 'bold') return `<strong>${esc}</strong>`;
      if (seg.type === 'italic') return `<em class="omibot-italic">${esc}</em>`;
      return esc;
    })
    .join('');
}

/**
 * @param {string} line
 * @returns {{ ordered: boolean; text: string } | null}
 */
function parseListLine(line) {
  const m = String(line || '').match(/^\s*([-*•]|\d+[.)])\s+(\S.*)$/);
  if (!m) return null;
  return { ordered: /^\d+[.)]$/.test(m[1]), text: m[2] };
}

/**
 * Web chat display: escape HTML and render bold, italic, and lists.
 * @param {string} text
 * @returns {string} Safe HTML fragment
 */
export function formatChatTextHtml(text) {
  const normalized = normalizeBoldMarkers(text);
  const lines = normalized.split(/\r?\n/);
  const parts = [];
  let i = 0;
  while (i < lines.length) {
    const listLine = parseListLine(lines[i]);
    if (listLine) {
      const ordered = listLine.ordered;
      const items = [listLine.text];
      i += 1;
      while (i < lines.length) {
        if (!String(lines[i] || '').trim()) break;
        const next = parseListLine(lines[i]);
        if (next && next.ordered === ordered) {
          items.push(next.text);
          i += 1;
          continue;
        }
        if (!next && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1] += ` ${String(lines[i]).trim()}`;
          i += 1;
          continue;
        }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      const cls = ordered ? 'omibot-list omibot-list-ol' : 'omibot-list omibot-list-ul';
      parts.push(
        `<${tag} class="${cls}">${items
          .map((item) => `<li>${formatInlineHtml(item)}</li>`)
          .join('')}</${tag}>`
      );
      continue;
    }
    const prose = [];
    while (i < lines.length && !parseListLine(lines[i])) {
      prose.push(lines[i]);
      i += 1;
    }
    if (prose.length) parts.push(formatInlineHtml(prose.join('\n')));
  }
  return parts.join('');
}
