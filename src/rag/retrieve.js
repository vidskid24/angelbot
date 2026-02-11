/**
 * Load embeddings index and return top-k chunks by similarity to the query.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { embed } from '../lib/openai.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const EMBEDDINGS_PATH = join(ROOT, 'data', 'embeddings.json');
const DEFAULT_TOP_K = 5;

function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * @param {string} query
 * @param {number} [topK]
 * @returns {Promise<string>} Concatenated top-k chunk texts for system prompt
 */
export async function retrieve(query, topK = DEFAULT_TOP_K) {
  let data;
  try {
    const raw = await readFile(EMBEDDINGS_PATH, 'utf-8');
    data = JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return '';
    throw e;
  }
  const chunks = data.chunks;
  if (!chunks || chunks.length === 0) return '';

  const queryEmbedding = await embed(query);
  const withScore = chunks.map((c) => ({
    text: c.text,
    score: cosineSimilarity(c.embedding, queryEmbedding),
  }));
  withScore.sort((a, b) => b.score - a.score);
  const top = withScore.slice(0, topK).map((c) => c.text);
  return top.join('\n\n---\n\n');
}
