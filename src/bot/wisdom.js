/**
 * Builds prompt, optional RAG context, and calls LLM for wisdom replies.
 */

import { buildSystemPrompt } from '../prompts/wisdom-companion.js';
import { chat } from '../lib/gemini.js';

/** Default char budget for retrieved course excerpts (whole chunks preferred). */
const DEFAULT_STYLE_LIMIT = 8000;
/** Larger budget when the user asks for direct quotes / verbatim passages. */
const QUOTE_STYLE_LIMIT = 12000;

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
 * Get a wisdom reply from the LLM.
 * @param {string} userMessage - Current user message
 * @param {Array<{ role: 'user' | 'assistant'; content: string }>} [history] - Prior turns (oldest first)
 * @param {string} [styleExcerpts] - Optional RAG style excerpts to inject into system prompt
 * @param {string} [userPreferencesBlock] - Optional per-user preference instructions
 * @param {string} [userMemoryBlock] - Optional paid-tier memory context
 * @param {{ quoteMode?: boolean }} [options]
 * @returns {Promise<string>}
 */
export async function getWisdomReply(
  userMessage,
  history = [],
  styleExcerpts = null,
  userPreferencesBlock = null,
  userMemoryBlock = null,
  options = {}
) {
  const quoteMode = Boolean(options.quoteMode);
  const styleLimit = quoteMode ? QUOTE_STYLE_LIMIT : DEFAULT_STYLE_LIMIT;
  const historyTurnsLimit = 8;
  const perTurnLimit = 1200;

  const styleExcerptsCapped = capStyleExcerpts(styleExcerpts, styleLimit);
  let historyCapped = Array.isArray(history) ? history.slice(-historyTurnsLimit * 2) : [];
  historyCapped = historyCapped.map((t) => ({
    role: t.role,
    content: String(t.content || '').slice(0, perTurnLimit),
  }));
  const systemContent = buildSystemPrompt(
    styleExcerptsCapped,
    userPreferencesBlock,
    userMemoryBlock,
    { quoteMode }
  );

  const messages = [{ role: 'system', content: systemContent }];

  for (const turn of historyCapped) {
    messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: 'user', content: userMessage });

  return chat(messages);
}
