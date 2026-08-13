/**
 * Load embeddings index and return top-k chunks by similarity to the query.
 * The embeddings file is kept warm in memory and reloaded when mtime changes.
 */

import { readFile, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { embed } from '../lib/gemini.js';
import { loadCourseCatalog, formatRetrievedChunkWithCatalog } from './course-catalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const EMBEDDINGS_PATH = join(ROOT, 'data', 'embeddings.json');
const DEFAULT_TOP_K = 6;

/** @type {{ mtimeMs: number; chunks: any[] } | null} */
let embeddingsIndexCache = null;
/** @type {Promise<{ mtimeMs: number; chunks: any[] } | null> | null} */
let embeddingsIndexLoadPromise = null;

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
 * @returns {Promise<{ mtimeMs: number; chunks: any[] } | null>}
 */
async function loadEmbeddingsIndex() {
  let mtimeMs = 0;
  try {
    const info = await stat(EMBEDDINGS_PATH);
    mtimeMs = info.mtimeMs;
  } catch (e) {
    if (e?.code === 'ENOENT') {
      embeddingsIndexCache = null;
      return null;
    }
    throw e;
  }

  if (embeddingsIndexCache && embeddingsIndexCache.mtimeMs === mtimeMs) {
    return embeddingsIndexCache;
  }

  if (embeddingsIndexLoadPromise) {
    return embeddingsIndexLoadPromise;
  }

  embeddingsIndexLoadPromise = (async () => {
    try {
      // Recheck cache after awaiting — another caller may have finished first.
      if (embeddingsIndexCache && embeddingsIndexCache.mtimeMs === mtimeMs) {
        return embeddingsIndexCache;
      }
      const raw = await readFile(EMBEDDINGS_PATH, 'utf-8');
      const data = JSON.parse(raw);
      const chunks = Array.isArray(data?.chunks) ? data.chunks : [];
      embeddingsIndexCache = { mtimeMs, chunks };
      console.info(
        `[rag] Embeddings index loaded into memory (${chunks.length} chunks, ${(Buffer.byteLength(raw) / (1024 * 1024)).toFixed(1)} MB)`
      );
      return embeddingsIndexCache;
    } finally {
      embeddingsIndexLoadPromise = null;
    }
  })();

  return embeddingsIndexLoadPromise;
}

/**
 * Warm the embeddings index at process startup (optional; retrieve also lazy-loads).
 * @returns {Promise<void>}
 */
export async function preloadEmbeddingsIndex() {
  await loadEmbeddingsIndex();
}

/** Clear in-memory index (tests / after manual ingest in same process). */
export function clearEmbeddingsIndexCache() {
  embeddingsIndexCache = null;
  embeddingsIndexLoadPromise = null;
}

/**
 * @param {string} query
 * @param {number} [topK]
 * @param {{
 *   linkVariant?: import('./course-catalog.js').CourseLinkVariant | null;
 *   sourceDetail?: import('./course-catalog.js').SourceDetail;
 * }} [options]
 * @returns {Promise<string>} Labeled top-k chunk texts for system prompt
 */
function isBookChunk(chunk) {
  const path = String(chunk?.sourcePath || '');
  const source = chunk?.source;
  if (source?.unitType === 'book') return true;
  if (String(source?.sessionKey || '').startsWith('book:')) return true;
  return /(^|\/)ACIMA/i.test(path);
}

export async function retrieve(query, topK = DEFAULT_TOP_K, options = {}) {
  const index = await loadEmbeddingsIndex();
  if (!index) return '';
  const chunks = index.chunks;
  if (!chunks.length) return '';

  let queryEmbedding;
  try {
    queryEmbedding = await embed(query);
  } catch (err) {
    const status = Number(err?.status);
    if (status === 429 || status === 500 || status === 503) {
      console.warn('RAG retrieval degraded: embedding temporarily unavailable.', err?.message || err);
      return '';
    }
    throw err;
  }
  const withScore = chunks.map((c) => ({
    text: c.text,
    source: c.source ?? null,
    sourcePath: c.sourcePath,
    score: cosineSimilarity(c.embedding, queryEmbedding),
  }));
  // Prefer online coursework over the book when similarity is close.
  withScore.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) > 0.025) return diff;
    return Number(isBookChunk(a)) - Number(isBookChunk(b));
  });

  const catalog = await loadCourseCatalog();
  const linkVariant = options.linkVariant || null;
  const sourceDetail = options.sourceDetail === 'course' ? 'course' : 'full';

  const pool = withScore.slice(0, Math.max(topK * 3, topK));
  const courses = pool.filter((c) => !isBookChunk(c));
  const books = pool.filter((c) => isBookChunk(c));
  /** @type {typeof withScore} */
  const chosen = [];
  for (const c of courses) {
    if (chosen.length >= topK) break;
    chosen.push(c);
  }
  for (const c of books) {
    if (chosen.length >= topK) break;
    chosen.push(c);
  }

  const top = chosen
    .map((c, i) =>
      formatRetrievedChunkWithCatalog(c, catalog, linkVariant, {
        sourceDetail,
        sourceIndex: i + 1,
      })
    )
    .filter(Boolean);
  return top.join('\n\n');
}
