/**
 * Transport-agnostic wisdom chat (used by the HTTP API).
 */

import { getWisdomReply } from '../bot/wisdom.js';
import { getHistory, appendTurn } from '../bot/memory.js';
import * as threadDb from '../db/threads.js';
import * as users from '../db/users.js';
import { generateThreadTitleFromMessage } from '../lib/gemini.js';
import { buildUserPreferencesPromptBlock } from '../lib/user-preferences.js';
import { retrieve } from '../rag/retrieve.js';

function isContextDependentFollowup(message) {
  const normalized = String(message || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return false;
  if (normalized.length <= 40) return true;
  return /\b(it|that|this|those|these|them|same|again)\b/.test(normalized);
}

function buildRetrievalQuery(message, history) {
  const current = String(message || '').trim();
  if (!isContextDependentFollowup(current)) return current;
  const lastUser = [...history].reverse().find((t) => t.role === 'user' && t.content)?.content || '';
  const lastAssistant = [...history].reverse().find((t) => t.role === 'assistant' && t.content)?.content || '';
  const assistantAnchor = String(lastAssistant).slice(0, 500);
  const userAnchor = String(lastUser).slice(0, 300);
  return [userAnchor, assistantAnchor, current].filter(Boolean).join('\n\n');
}

const MAX_DISPLAY_TEXT = 2000;

/**
 * Split large text for clients that need chunked rendering.
 * @param {string} fullContent
 * @returns {string[]}
 */
export function chunkDisplayContent(fullContent) {
  const chunks = [];
  let offset = 0;
  while (offset < fullContent.length) {
    chunks.push(fullContent.slice(offset, offset + MAX_DISPLAY_TEXT));
    offset += MAX_DISPLAY_TEXT;
  }
  return chunks.length ? chunks : [''];
}

/**
 * @param {{ userId: string; sessionKey: string; message: string; threadId?: string; useDb?: boolean }} params
 * @returns {Promise<
 *   | { ok: false; code: 'error'; text: string }
 *   | { ok: true; kind: 'reply'; assistantReply: string; displayFull: string; chunks: string[]; threadTitle?: string | null }
 * >}
 */
export async function processWisdomMessage({ userId, sessionKey, message, threadId, useDb = false }) {
  const history =
    useDb && threadId ? await threadDb.getThreadMessages(threadId) : getHistory(sessionKey);

  try {
    const retrievalQuery = buildRetrievalQuery(message, history);
    const styleExcerpts = await retrieve(retrievalQuery, 2);
    let userPreferencesBlock = null;
    if (useDb) {
      const prefs = await users.getUserPreferences(userId);
      userPreferencesBlock = buildUserPreferencesPromptBlock(prefs);
    }
    const reply = await getWisdomReply(message, history, styleExcerpts || null, userPreferencesBlock);
    let threadTitle = null;
    if (useDb && threadId) {
      await threadDb.appendThreadTurn(threadId, message, reply);
      if (history.length === 0) {
        try {
          const thread = await threadDb.getThreadForUser(threadId, userId);
          if (thread && threadDb.isDefaultThreadTitle(thread.title)) {
            const aiTitle = await generateThreadTitleFromMessage(message);
            const updated = await threadDb.updateThreadTitle(threadId, userId, aiTitle);
            threadTitle = updated?.title || null;
          }
        } catch (titleErr) {
          console.error('Auto thread title error:', titleErr);
        }
      }
    } else {
      appendTurn(sessionKey, message, reply);
    }
    return {
      ok: true,
      kind: 'reply',
      assistantReply: reply,
      displayFull: reply,
      chunks: chunkDisplayContent(reply),
      threadTitle,
    };
  } catch (err) {
    console.error('Wisdom reply error:', err);
    return { ok: false, code: 'error', text: 'Something shifted in the field. Please try again in a moment.' };
  }
}
