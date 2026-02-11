/**
 * OpenAI client for chat completions (and embeddings when RAG is used).
 */

import OpenAI from 'openai';

let _client = null;

export function getOpenAI() {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

/**
 * @param {Array<{ role: 'system' | 'user' | 'assistant'; content: string }>} messages
 * @returns {Promise<string>} Assistant reply content
 */
export async function chat(messages) {
  const openai = getOpenAI();
  const model = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
  const completion = await openai.chat.completions.create({
    model,
    messages,
    max_tokens: 1024,
    temperature: 0.8,
  });
  const choice = completion.choices?.[0];
  if (!choice?.message?.content) throw new Error('Empty or missing OpenAI response');
  return choice.message.content;
}

/**
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embed(text) {
  const openai = getOpenAI();
  const model = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
  const res = await openai.embeddings.create({
    model,
    input: text.slice(0, 8191),
  });
  const vec = res.data?.[0]?.embedding;
  if (!vec) throw new Error('Empty or missing embedding');
  return vec;
}
