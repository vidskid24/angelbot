/**
 * Builds prompt, optional RAG context, and calls LLM for wisdom replies.
 */

import {
  getStaticSystemPrompt,
  buildDynamicContextBlock,
} from '../prompts/wisdom-companion.js';
import { chat } from '../lib/gemini.js';

/** Default char budget for retrieved course excerpts (whole chunks preferred). */
const DEFAULT_STYLE_LIMIT = 12000;

/**
 * Cap excerpts without cutting mid-chunk when possible (chunks start with --- Source:).
 * @param {string | null | undefined} excerpts
 * @param {number} limit
 * @returns {string | null}
 */
export function capStyleExcerpts(excerpts, limit) {
  const text = String(excerpts || '').trim();
  if (!text) return null;
  if (text.length <= limit) return text;

  const parts = text.split(/\n\n(?=--- )/);
  let out = '';
  for (const part of parts) {
    const next = out ? `${out}\n\n${part}` : part;
    if (next.length > limit) break;
    out = next;
  }
  if (out) return out;
  return text.slice(0, limit);
}

/**
 * Attach per-turn RAG / prefs / memory to the user message so the system prompt
 * stays stable for Gemini context caching. Not persisted to thread history.
 * @param {string} userMessage
 * @param {string} dynamicContext
 * @returns {string}
 */
function attachDynamicContextToUserMessage(userMessage, dynamicContext) {
  const dynamic = String(dynamicContext || '').trim();
  const user = String(userMessage || '');
  if (!dynamic) return user;
  return (
    `[Context for this reply — not written by the user]\n${dynamic}\n\n` +
    `[User message]\n${user}`
  );
}

/**
 * Get a wisdom reply from the LLM.
 * @param {string} userMessage - Current user message
 * @param {Array<{ role: 'user' | 'assistant'; content: string; thoughtSignature?: string | null }>} [history] - Prior turns (oldest first)
 * @param {string} [styleExcerpts] - Optional RAG style excerpts to inject into system prompt
 * @param {string} [userPreferencesBlock] - Optional per-user preference instructions
 * @param {string} [userMemoryBlock] - Optional paid-tier memory context
 * @returns {Promise<{ text: string; thoughtSignature: string | null }>}
 */
export async function getWisdomReply(
  userMessage,
  history = [],
  styleExcerpts = null,
  userPreferencesBlock = null,
  userMemoryBlock = null
) {
  const historyTurnsLimit = 8;
  const perTurnLimit = 1200;

  const styleExcerptsCapped = capStyleExcerpts(styleExcerpts, DEFAULT_STYLE_LIMIT);
  let historyCapped = Array.isArray(history) ? history.slice(-historyTurnsLimit * 2) : [];
  historyCapped = historyCapped.map((t) => ({
    role: t.role,
    content: String(t.content || '').slice(0, perTurnLimit),
    thoughtSignature: t.thoughtSignature != null ? String(t.thoughtSignature) : null,
  }));

  // Keep system instruction stable (cacheable). Variable RAG/prefs/memory ride on the user turn.
  const staticSystem = getStaticSystemPrompt();
  const dynamicContext = buildDynamicContextBlock(
    styleExcerptsCapped,
    userPreferencesBlock,
    userMemoryBlock
  );

  const messages = [{ role: 'system', content: staticSystem }];

  for (const turn of historyCapped) {
    messages.push({
      role: turn.role,
      content: turn.content,
      thoughtSignature: turn.thoughtSignature,
    });
  }
  messages.push({
    role: 'user',
    content: attachDynamicContextToUserMessage(userMessage, dynamicContext),
  });

  return chat(messages);
}
