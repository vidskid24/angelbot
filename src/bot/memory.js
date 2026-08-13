/**
 * In-memory rolling conversation history per channel (or DM channel).
 */

const maxTurns = parseInt(process.env.MAX_HISTORY_TURNS || '10', 10) || 10;
const store = new Map();
const excerptStore = new Map();
const MAX_SOURCE_EXCERPTS_CHARS = 20000;

/**
 * @param {string} key - Channel id (or DM channel id)
 * @returns {Array<{ role: 'user' | 'assistant'; content: string; thoughtSignature?: string | null }>}
 */
export function getHistory(key) {
  const list = store.get(key);
  return list ? [...list] : [];
}

/**
 * @param {string} key
 * @returns {string | null}
 */
export function getStoredExcerpts(key) {
  const text = String(excerptStore.get(key) || '').trim();
  return text || null;
}

/**
 * @param {string} key
 * @param {string} excerpts
 */
export function setStoredExcerpts(key, excerpts) {
  const text = String(excerpts || '').trim().slice(0, MAX_SOURCE_EXCERPTS_CHARS);
  if (!text) return;
  excerptStore.set(key, text);
}

/**
 * Append one user/assistant turn and keep only the last maxTurns.
 * @param {string} key - Channel id
 * @param {string} userContent
 * @param {string} assistantContent
 * @param {string | null} [thoughtSignature]
 */
export function appendTurn(key, userContent, assistantContent, thoughtSignature = null) {
  let list = store.get(key);
  if (!list) {
    list = [];
    store.set(key, list);
  }
  list.push({ role: 'user', content: userContent });
  list.push({
    role: 'assistant',
    content: assistantContent,
    thoughtSignature: thoughtSignature != null ? String(thoughtSignature) : null,
  });
  if (list.length > maxTurns * 2) {
    store.set(key, list.slice(-maxTurns * 2));
  }
}
