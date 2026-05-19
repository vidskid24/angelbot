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
 * Split message into plain, bold (**), and italic (*) segments (bold matched first).
 * @param {string} text
 * @returns {Array<{ type: 'text' | 'bold' | 'italic'; content: string }>}
 */
export function parseChatMarkdownSegments(text) {
  const normalized = normalizeBoldMarkers(text);
  const segments = [];
  const re = /\*\*([^*]+?)\*\*|\*([^*]+?)\*/g;
  let lastIndex = 0;
  let match;
  while ((match = re.exec(normalized)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: normalized.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      segments.push({ type: 'bold', content: match[1] });
    } else if (match[2] !== undefined) {
      segments.push({ type: 'italic', content: match[2] });
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < normalized.length) {
    segments.push({ type: 'text', content: normalized.slice(lastIndex) });
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
