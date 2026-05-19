/**
 * Transport-agnostic wisdom chat + memory flows (used by the HTTP API).
 */

import { getWisdomReply } from '../bot/wisdom.js';
import { getHistory, appendTurn } from '../bot/memory.js';
import * as threadDb from '../db/threads.js';
import { getMemories, addMemory, deleteMemoryByName } from '../bot/user-memory.js';
import {
  summarizeConversation,
  generateTitleForContent,
  generateThreadTitleFromMessage,
} from '../lib/gemini.js';
import { retrieve } from '../rag/retrieve.js';

/** Per-session flag: last reply was a save offer, so next "yes" triggers save. */
const saveOfferPendingBySession = new Map();

export const AT_LIMIT_MESSAGE =
  "You've reached the limit of **30** saved memories. To save this one, either:\n" +
  "1. Use **`/forget`** with the name of a memory you want to remove (use **`/memories`** to see your list), then try again, or\n" +
  "2. Use **`/remember`** with **Replace oldest** turned on to overwrite your oldest memory with this one.";

const CONCLUSION_PHRASES = [
  'thank you', 'thanks', 'thx', 'that\'s all', 'that is all', 'no that is all', 'no that\'s all',
  'that\'s it', 'thats it', 'i\'m good', 'im good', 'all good', 'nothing else', 'no more',
  'that\'s all for now', 'that is all for now', 'i\'m done', 'im done', 'we\'re good', 'were good',
  'good for now', 'all set', 'that\'ll be all', 'no further questions', 'nothing more',
  'that\'s all thanks', 'all set thanks', 'that\'s it for now', 'i\'m done for now', 'im done for now',
  'we\'re good thanks', 'were good thanks', 'that answers it', 'that answers it thanks',
  'perfect thanks', 'that helps thanks', 'that helped thanks', 'that makes sense thanks',
  'got it thanks', 'all good thanks',
];

const AFFIRMATIVE_PHRASES = [
  'yes', 'yeah', 'yep', 'yes please', 'please do', 'save it', 'hold it', 'save that',
  'please save', 'go ahead', 'that would be great', 'sure', 'ok', 'okay', 'please',
  'do it', 'save', 'hold this', 'hold that',
];

function isConclusionaryMessage(message) {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return false;
  const trimmed = normalized.replace(/[.,!?]+$/, '').trim();

  if (CONCLUSION_PHRASES.some((phrase) => {
    if (trimmed === phrase) return true;
    if (trimmed.startsWith(phrase + ' ') || trimmed.startsWith(phrase + ',')) return true;
    if (trimmed.endsWith(' ' + phrase) || trimmed.endsWith(',' + phrase)) return true;
    return false;
  })) return true;

  const lastBoundary = Math.max(
    trimmed.lastIndexOf('. '),
    trimmed.lastIndexOf('! '),
    trimmed.lastIndexOf('? '),
    trimmed.lastIndexOf(', ')
  );
  const lastSentence = lastBoundary >= 0 ? trimmed.slice(lastBoundary + 2).trim() : trimmed;
  const lastNorm = lastSentence.replace(/[.,!?]+$/, '').trim();
  return CONCLUSION_PHRASES.some((phrase) => {
    if (lastNorm === phrase) return true;
    if (lastNorm.endsWith(' ' + phrase) || lastNorm.endsWith(',' + phrase)) return true;
    return false;
  });
}

function isAffirmativeMessage(message) {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return false;
  const trimmed = normalized.replace(/[.,!?]+$/, '').trim();
  return AFFIRMATIVE_PHRASES.some((phrase) => {
    if (trimmed === phrase) return true;
    if (trimmed.startsWith(phrase + ' ') || trimmed.startsWith(phrase + ',')) return true;
    if (trimmed.endsWith(' ' + phrase) || trimmed.endsWith(',' + phrase)) return true;
    return false;
  });
}

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
 *   | { ok: true; kind: 'memory_saved'; text: string }
 *   | { ok: true; kind: 'reply'; assistantReply: string; displayFull: string; chunks: string[] }
 * >}
 */
export async function processWisdomMessage({ userId, sessionKey, message, threadId, useDb = false }) {
  const pendingKey = useDb && threadId ? `thread:${threadId}` : sessionKey;
  const history =
    useDb && threadId ? await threadDb.getThreadMessages(threadId) : getHistory(sessionKey);
  const memories = await getMemories(userId);
  const savedContext = memories.length
    ? memories.map((m) => `**${m.name}**\n${m.content}`).join('\n\n---\n\n')
    : null;
  const userSeemsToBeConcluding = isConclusionaryMessage(message);

  if (saveOfferPendingBySession.get(pendingKey) && isAffirmativeMessage(message)) {
    saveOfferPendingBySession.set(pendingKey, false);
    try {
      const dateLabel = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      let content = history.length ? await summarizeConversation(history) : '';
      if (!content?.trim()) {
        content = history.length
          ? history.map((t) => t.content).join('\n\n').slice(0, 2000)
          : `Conversation from ${dateLabel}.`;
      }
      const aiTitle = await generateTitleForContent(content);
      const name = `${dateLabel} - ${aiTitle}`;
      const result = await addMemory(userId, name, content, { overwriteOldest: false });
      if (!result.added && result.atLimit) {
        return { ok: true, kind: 'memory_saved', text: AT_LIMIT_MESSAGE };
      }
      return {
        ok: true,
        kind: 'memory_saved',
        text: `I've saved that for you as **${name}**. I'll keep it in mind next time you return.`,
      };
    } catch (err) {
      console.error('Yes-save flow error:', err);
      return {
        ok: false,
        code: 'error',
        text: 'Something went wrong saving. Please try `/remember` with your summary.',
      };
    }
  }

  try {
    const retrievalQuery = buildRetrievalQuery(message, history);
    const styleExcerpts = await retrieve(retrievalQuery, 2);
    const reply = await getWisdomReply(message, history, styleExcerpts || null, savedContext, userSeemsToBeConcluding);
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
    if (userSeemsToBeConcluding) saveOfferPendingBySession.set(pendingKey, true);
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

/**
 * @param {{ userId: string; content: string; nameOption?: string | null; replaceOldest?: boolean }} params
 */
export async function processRemember({ userId, content, nameOption, replaceOldest = false }) {
  const dateLabel = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const name = nameOption?.trim()
    ? `${dateLabel} - ${nameOption.trim()}`
    : `${dateLabel} - ${await generateTitleForContent(content)}`;
  const result = await addMemory(userId, name, content, { overwriteOldest: replaceOldest });
  if (!result.added && result.atLimit) {
    return { ok: true, text: AT_LIMIT_MESSAGE, atLimit: true };
  }
  const msg = result.overwroteOldest
    ? `I've saved **${name}** for you and replaced your oldest memory. I'll keep it in mind next time you return.`
    : `I've saved **${name}** for you. I'll keep it in mind next time you return.`;
  return { ok: true, text: msg, atLimit: false };
}

/**
 * @param {string} userId
 */
export async function processListMemories(userId) {
  const memories = await getMemories(userId);
  if (memories.length === 0) {
    return { ok: true, text: 'You do not have any saved memories yet. Use `/remember` to save a space or summary.' };
  }
  const lines = memories.map((m) => `**${m.name}**\n${m.content.slice(0, 200)}${m.content.length > 200 ? '...' : ''}`);
  const text = lines.join('\n\n---\n\n');
  const content = text.length > MAX_DISPLAY_TEXT ? text.slice(0, MAX_DISPLAY_TEXT - 20) + '\n\n...' : text;
  return { ok: true, text: `**Your saved memories:**\n\n${content}` };
}

/**
 * @param {string} userId
 * @param {string} name
 */
export async function processForget(userId, name) {
  const removed = await deleteMemoryByName(userId, name);
  return {
    ok: true,
    text: removed
      ? `I have removed **${name}** from your saved memories.`
      : `I could not find a memory named **${name}**. Use \`/memories\` to see your list.`,
  };
}