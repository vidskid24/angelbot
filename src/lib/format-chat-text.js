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
 * Web chat display: escape HTML and render **bold** markers.
 * @param {string} text
 * @returns {string} Safe HTML fragment
 */
export function formatChatTextHtml(text) {
  let escaped = normalizeBoldMarkers(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  let prev;
  do {
    prev = escaped;
    escaped = escaped.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  } while (escaped !== prev);

  return escaped;
}
