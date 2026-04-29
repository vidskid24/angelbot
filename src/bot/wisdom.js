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
 * @param {string} [savedContext] - Optional saved context for this user (memories / "hold this space")
 * @param {boolean} [userSeemsToBeConcluding] - If true, prompt the model to offer to save/hold this space
 * @returns {Promise<string>}
 */
export async function getWisdomReply(userMessage, history = [], styleExcerpts = null, savedContext = null, userSeemsToBeConcluding = false) {
  let styleLimit = 1600;
  let savedLimit = 1200;
  let historyTurnsLimit = 8;
  let perTurnLimit = 1200;

  let styleExcerptsCapped = styleExcerpts ? String(styleExcerpts).slice(0, styleLimit) : null;
  let savedContextCapped = savedContext ? String(savedContext).slice(0, savedLimit) : null;
  let historyCapped = Array.isArray(history) ? history.slice(-historyTurnsLimit) : [];
  historyCapped = historyCapped.map((t) => ({ role: t.role, content: String(t.content || '').slice(0, perTurnLimit) }));
  let systemContent = buildSystemPrompt(styleExcerptsCapped, savedContextCapped, userSeemsToBeConcluding);

  // Hard budget guard for oversized system payloads.
  while (systemContent.length > 6500 && (styleLimit > 600 || savedLimit > 400)) {
    if (styleLimit > 600) styleLimit -= 200;
    else if (savedLimit > 400) savedLimit -= 200;
    styleExcerptsCapped = styleExcerpts ? String(styleExcerpts).slice(0, styleLimit) : null;
    savedContextCapped = savedContext ? String(savedContext).slice(0, savedLimit) : null;
    systemContent = buildSystemPrompt(styleExcerptsCapped, savedContextCapped, userSeemsToBeConcluding);
  }

  const messages = [{ role: 'system', content: systemContent }];

  for (const turn of historyCapped) {
    messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: 'user', content: userMessage });

  return chat(messages);
}
