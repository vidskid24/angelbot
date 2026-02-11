/**
 * In-memory rolling conversation history per channel (or DM channel).
 */

const maxTurns = parseInt(process.env.MAX_HISTORY_TURNS || '10', 10) || 10;
const store = new Map();

/**
 * @param {string} key - Channel id (or DM channel id)
 * @returns {Array<{ role: 'user' | 'assistant'; content: string }>}
 */
export function getHistory(key) {
  const list = store.get(key);
  return list ? [...list] : [];
}

/**
 * Append one user/assistant turn and keep only the last maxTurns.
 * @param {string} key - Channel id
 * @param {string} userContent
 * @param {string} assistantContent
 */
export function appendTurn(key, userContent, assistantContent) {
  let list = store.get(key);
  if (!list) {
    list = [];
    store.set(key, list);
  }
  list.push({ role: 'user', content: userContent });
  list.push({ role: 'assistant', content: assistantContent });
  if (list.length > maxTurns * 2) {
    store.set(key, list.slice(-maxTurns * 2));
  }
}
