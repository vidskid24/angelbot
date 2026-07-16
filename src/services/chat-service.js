/**
 * Transport-agnostic wisdom chat (used by the HTTP API).
 */

import { getWisdomReply } from '../bot/wisdom.js';
import { getHistory, appendTurn } from '../bot/memory.js';
import * as threadDb from '../db/threads.js';
import * as users from '../db/users.js';
import { generateThreadTitleFromMessage } from '../lib/gemini.js';
import { buildUserPreferencesPromptBlock } from '../lib/user-preferences.js';
import { buildUserMemoryPromptBlock } from '../lib/user-memory.js';
import { retrieve } from '../rag/retrieve.js';

const DEFAULT_RETRIEVE_TOP_K = 6;
const QUOTE_RETRIEVE_TOP_K = 8;

function isContextDependentFollowup(message) {
  const normalized = String(message || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return false;
  if (normalized.length <= 40) return true;
  return /\b(it|that|this|those|these|them|same|again)\b/.test(normalized);
}

/**
 * True when the user is asking for verbatim quotes / passages from the coursework.
 * @param {string} message
 * @returns {boolean}
 */
export function wantsDirectQuotes(message) {
  const normalized = String(message || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return false;
  return (
    /\b(quotes?|verbatim|word[\s-]for[\s-]word|exact wording|exact words|direct(?:ly)? from (?:the )?(?:material|coursework|course|text|excerpts?|passages?)|passages? from)\b/.test(
      normalized
    ) || /\b(provide|give|share|pull|offer)\b.{0,40}\bquotes?\b/.test(normalized)
  );
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

/**
 * @param {{ userId: string; sessionKey: string; message: string; threadId?: string; useDb?: boolean }} params
 * @returns {Promise<
 *   | { ok: false; code: 'error'; text: string }
 *   | { ok: true; kind: 'reply'; assistantReply: string; threadTitle?: string | null }
 * >}
 */
export async function processWisdomMessage({ userId, sessionKey, message, threadId, useDb = false }) {
  const history =
    useDb && threadId ? await threadDb.getThreadMessages(threadId) : getHistory(sessionKey);

  try {
    const retrievalQuery = buildRetrievalQuery(message, history);
    const quoteMode = wantsDirectQuotes(message);
    const topK = quoteMode ? QUOTE_RETRIEVE_TOP_K : DEFAULT_RETRIEVE_TOP_K;
    const styleExcerpts = await retrieve(retrievalQuery, topK);
    let userPreferencesBlock = null;
    let userMemoryBlock = null;
    if (useDb) {
      const settings = await users.getUserSettings(userId);
      userPreferencesBlock = buildUserPreferencesPromptBlock(settings);
      if (settings.tier === 'paid') {
        userMemoryBlock = buildUserMemoryPromptBlock(settings);
      }
    }
    const reply = await getWisdomReply(
      message,
      history,
      styleExcerpts || null,
      userPreferencesBlock,
      userMemoryBlock,
      { quoteMode }
    );
    let threadTitle = null;
    if (useDb && threadId) {
      await threadDb.appendThreadTurn(threadId, message, reply);
      await users.touchUserChatActivity(userId);
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
      threadTitle,
    };
  } catch (err) {
    console.error('Wisdom reply error:', err);
    return { ok: false, code: 'error', text: 'Something shifted in the field. Please try again in a moment.' };
  }
}
