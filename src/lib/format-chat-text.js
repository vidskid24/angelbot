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
 * @param {string} itemText
 * @returns {{ title: string, desc: string } | null}
 */
function splitListItemTitleDesc(itemText) {
  const parts = String(itemText || '')
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const title = parts[0].replace(/^\*\*([^*][\s\S]*?)\*\*$/, '$1').trim();
    return { title, desc: parts.slice(1).join(' ') };
  }
  const single = parts[0] || '';
  const boldLead = single.match(/^\*\*([^*]+?)\*\*(:?)\s+(\S[\s\S]*)$/);
  if (boldLead) {
    let title = boldLead[1].trim();
    if (boldLead[2] === ':' && !title.endsWith(':')) title += ':';
    return { title, desc: boldLead[3].trim() };
  }
  const colonLead = single.match(/^(.{1,80}?):\s+(\S[\s\S]*)$/);
  if (colonLead) {
    const titleCore = colonLead[1].trim();
    const wordCount = titleCore.split(/\s+/).filter(Boolean).length;
    if (wordCount >= 1 && wordCount <= 8 && !/[.!?]$/.test(titleCore)) {
      return { title: `${titleCore}:`, desc: colonLead[2].trim() };
    }
  }
  return null;
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
        // Blank lines: keep the list if another same-type item follows.
        if (!String(lines[i] || '').trim()) {
          let j = i + 1;
          while (j < lines.length && !String(lines[j] || '').trim()) j += 1;
          const peek = j < lines.length ? parseListLine(lines[j]) : null;
          if (peek && peek.ordered === ordered) {
            i = j;
            continue;
          }
          break;
        }
        const next = parseListLine(lines[i]);
        if (next && next.ordered === ordered) {
          items.push(next.text);
          i += 1;
          continue;
        }
        // Continuation of the current item (indented or plain description prose).
        if (!next && !/^\s*#{1,6}\s+\S/.test(lines[i])) {
          items[items.length - 1] += `\n${String(lines[i]).trim()}`;
          i += 1;
          continue;
        }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      const cls = ordered ? 'omibot-list omibot-list-ol' : 'omibot-list omibot-list-ul';
      parts.push(
        `<${tag} class="${cls}">${items
          .map((item, idx) => {
            const marker = ordered ? `${idx + 1}.` : '\u2022';
            const split = splitListItemTitleDesc(item);
            const bodyHtml = split
              ? `<strong class="omibot-list-title">${escapeHtml(split.title)}</strong><span class="omibot-list-desc">${formatInlineHtml(split.desc)}</span>`
              : formatInlineHtml(item);
            return `<li><span class="omibot-list-marker" aria-hidden="true">${marker}</span><span class="omibot-list-text">${bodyHtml}</span></li>`;
          })
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
