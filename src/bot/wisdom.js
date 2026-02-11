/**
 * Builds prompt, optional RAG context, and calls LLM for wisdom replies.
 */

import { buildSystemPrompt } from '../prompts/wisdom-companion.js';
import { chat } from '../lib/openai.js';

/**
 * Get a wisdom reply from the LLM.
 * @param {string} userMessage - Current user message
 * @param {Array<{ role: 'user' | 'assistant'; content: string }>} [history] - Prior turns (oldest first)
 * @param {string} [styleExcerpts] - Optional RAG style excerpts to inject into system prompt
 * @param {string} [mode] - Optional mode: integration | reflection | orientation | stabilization
 * @returns {Promise<string>}
 */
export async function getWisdomReply(userMessage, history = [], styleExcerpts = null, mode = null) {
  const systemContent = buildSystemPrompt(styleExcerpts, mode);
  const messages = [{ role: 'system', content: systemContent }];

  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: 'user', content: userMessage });

  return chat(messages);
}
