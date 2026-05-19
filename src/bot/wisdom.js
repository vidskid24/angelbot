/**
 * Builds prompt, optional RAG context, and calls LLM for wisdom replies.
 */

import { buildSystemPrompt } from '../prompts/wisdom-companion.js';
import { chat } from '../lib/gemini.js';

/**
 * Get a wisdom reply from the LLM.
 * @param {string} userMessage - Current user message
 * @param {Array<{ role: 'user' | 'assistant'; content: string }>} [history] - Prior turns (oldest first)
 * @param {string} [styleExcerpts] - Optional RAG style excerpts to inject into system prompt
 * @param {string} [userPreferencesBlock] - Optional per-user preference instructions
 * @returns {Promise<string>}
 */
export async function getWisdomReply(userMessage, history = [], styleExcerpts = null, userPreferencesBlock = null) {
  let styleLimit = 1600;
  let historyTurnsLimit = 8;
  let perTurnLimit = 1200;

  let styleExcerptsCapped = styleExcerpts ? String(styleExcerpts).slice(0, styleLimit) : null;
  let historyCapped = Array.isArray(history) ? history.slice(-historyTurnsLimit) : [];
  historyCapped = historyCapped.map((t) => ({ role: t.role, content: String(t.content || '').slice(0, perTurnLimit) }));
  let systemContent = buildSystemPrompt(styleExcerptsCapped, userPreferencesBlock);

  while (systemContent.length > 6500 && styleLimit > 600) {
    styleLimit -= 200;
    styleExcerptsCapped = styleExcerpts ? String(styleExcerpts).slice(0, styleLimit) : null;
    systemContent = buildSystemPrompt(styleExcerptsCapped, userPreferencesBlock);
  }

  const messages = [{ role: 'system', content: systemContent }];

  for (const turn of historyCapped) {
    messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: 'user', content: userMessage });

  return chat(messages);
}
