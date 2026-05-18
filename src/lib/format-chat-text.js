/**
 * Web chat display: escape HTML and render **bold** markers.
 * @param {string} text
 * @returns {string} Safe HTML fragment
 */
export function formatChatTextHtml(text) {
  let escaped = String(text ?? '')
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
