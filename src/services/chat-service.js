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
import { resolveCourseLinkVariant } from '../lib/course-access.js';
import {
  sanitizeReplyCitations,
  userAskedForCitation,
  parseSourceCites,
} from '../lib/citation-repair.js';

const DEFAULT_RETRIEVE_TOP_K = 8;

function isContextDependentFollowup(message) {
  const normalized = String(message || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return false;
  if (normalized.length <= 40) return true;
  return /\b(it|that|this|those|these|them|same|again)\b/.test(normalized);
}

function extractAssistantQuotes(text) {
  const s = String(text || '');
  const quotes = [];
  const patterns = [/^>\s*["“]([^"”\n]{20,})["”]/gm, /["“]([^"”\n]{40,})["”]/g];
  for (const re of patterns) {
    let match;
    while ((match = re.exec(s)) !== null) {
      quotes.push(match[1].trim());
    }
  }
  return [...new Set(quotes)];
}

function buildRetrievalQuery(message, history) {
  const current = String(message || '').trim();
  const citationAsk = userAskedForCitation(current);
  if (!citationAsk && !isContextDependentFollowup(current)) return current;

  const lastTopicUser =
    [...history]
      .reverse()
      .find((t) => t.role === 'user' && t.content && !userAskedForCitation(t.content))?.content || '';
  const lastAssistant =
    [...history].reverse().find((t) => t.role === 'assistant' && t.content)?.content || '';
  const quotes = extractAssistantQuotes(lastAssistant);
  const assistantAnchor = citationAsk
    ? quotes.length
      ? quotes.join('\n')
      : String(lastAssistant).slice(-1500)
    : String(lastAssistant).slice(0, 500);
  const userAnchor = String(lastTopicUser || '').slice(0, 400);
  // Don't include the citation question itself — it dilutes RAG toward "where/coursework"
  // instead of the quote or teaching being located.
  if (citationAsk) {
    return [userAnchor, assistantAnchor].filter(Boolean).join('\n\n') || current;
  }
  return [userAnchor, assistantAnchor, current].filter(Boolean).join('\n\n');
}

/**
 * @param {{ userId: string; sessionKey: string; message: string; threadId?: string; useDb?: boolean; email?: string }} params
 * @returns {Promise<
 *   | { ok: false; code: 'error'; text: string }
 *   | { ok: true; kind: 'reply'; assistantReply: string; threadTitle?: string | null }
 * >}
 */
export async function processWisdomMessage({ userId, sessionKey, message, threadId, useDb = false, email }) {
  const history =
    useDb && threadId ? await threadDb.getThreadMessages(threadId) : getHistory(sessionKey);

  try {
    const retrievalQuery = buildRetrievalQuery(message, history);
    let userPreferencesBlock = null;
    let userMemoryBlock = null;
    /** @type {'free' | 'paid'} */
    let tier = 'free';
    if (useDb) {
      const settings = await users.getUserSettings(userId);
      tier = settings.tier === 'paid' ? 'paid' : 'free';
      userPreferencesBlock = buildUserPreferencesPromptBlock(settings);
      if (tier === 'paid') {
        userMemoryBlock = buildUserMemoryPromptBlock(settings);
      }
    }
    const sourceDetail = tier === 'paid' ? 'full' : 'course';
    // Resolve Thinkific owned vs membership for everyone so Source lines can link
    // to the appropriate class page (classroom when enrolled, otherwise purchase).
    const linkVariant = useDb ? await resolveCourseLinkVariant(userId, email) : null;
    let styleExcerpts = await retrieve(retrievalQuery, DEFAULT_RETRIEVE_TOP_K, {
      linkVariant,
      sourceDetail,
    });
    if (userAskedForCitation(message) && !parseSourceCites(styleExcerpts || '').length) {
      const lastAssistant =
        [...history].reverse().find((t) => t.role === 'assistant' && t.content)?.content || '';
      const quotes = extractAssistantQuotes(lastAssistant);
      const retryQuery = (quotes.length ? quotes.join('\n') : String(lastAssistant).slice(-1500)).trim();
      if (retryQuery && retryQuery !== retrievalQuery) {
        styleExcerpts = await retrieve(retryQuery, DEFAULT_RETRIEVE_TOP_K, {
          linkVariant,
          sourceDetail,
        });
      }
    }
    const result = await getWisdomReply(
      message,
      history,
      styleExcerpts || null,
      userPreferencesBlock,
      userMemoryBlock
    );
    const reply = sanitizeReplyCitations(result.text, styleExcerpts || '', message);
    const thoughtSignature = result.thoughtSignature;
    let threadTitle = null;
    if (useDb && threadId) {
      await threadDb.appendThreadTurn(threadId, message, reply, thoughtSignature);
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
      appendTurn(sessionKey, message, reply, thoughtSignature);
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
