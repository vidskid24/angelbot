/**
 * Load embeddings index and return top-k chunks by similarity to the query.
 * Large indexes are searched shard-by-shard to avoid loading all vectors into RAM.
 */

import { embed } from '../lib/gemini.js';
import {
  loadCourseCatalog,
  formatRetrievedChunkWithCatalog,
  citeFromRetrievedChunk,
  sourcesFromCatalogMatch,
  MAX_REPLY_SOURCES,
} from './course-catalog.js';
import { hydrateRetrievedChunk, loadChunkSourceIndex } from './chunk-source-index.js';
import { parseCourseSourceLoose } from './course-source.js';
import { chunkMatchesScope } from './material-scope.js';
import {
  iterateEmbeddingChunks,
  loadEmbeddingsChunks,
  readEmbeddingsIndexMeta,
} from './embeddings-store.js';

const DEFAULT_TOP_K = 6;
/** Legacy monolithic indexes at or below this size may stay fully in memory. */
const LEGACY_IN_MEMORY_MAX_CHUNKS = 3000;

/** @type {{ mtimeMs: number; chunkCount: number; format: string } | null} */
let embeddingsMetaCache = null;
/** @type {{ mtimeMs: number; chunks: any[] } | null} */
let legacyChunksCache = null;

function embeddingVector(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.values)) return raw.values;
  if (typeof raw === 'string') {
    try {
      return embeddingVector(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

function cosineSimilarity(aRaw, bRaw) {
  const a = embeddingVector(aRaw);
  const b = embeddingVector(bRaw);
  if (!a.length || a.length !== b.length) return 0;
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

function isBookChunk(chunk) {
  const path = String(chunk?.sourcePath || '');
  const source = chunk?.source;
  if (source?.unitType === 'book') return true;
  if (String(source?.sessionKey || '').startsWith('book:')) return true;
  return /(^|\/)ACIMA/i.test(path);
}

/**
 * @param {{ score: number; source?: any; sourcePath?: string }} a
 * @param {{ score: number; source?: any; sourcePath?: string }} b
 * @returns {number}
 */
function compareScoredChunks(a, b) {
  const diff = b.score - a.score;
  if (Math.abs(diff) > 0.025) return diff;
  return Number(isBookChunk(a)) - Number(isBookChunk(b));
}

/**
 * @param {Array<{ score: number }>} pool
 * @param {{ score: number }} item
 * @param {number} maxSize
 */
function pushTopScored(pool, item, maxSize) {
  pool.push(item);
  pool.sort(compareScoredChunks);
  if (pool.length > maxSize) pool.length = maxSize;
}

/**
 * @returns {Promise<{ mtimeMs: number; chunkCount: number; format: string } | null>}
 */
async function getEmbeddingsMeta() {
  const meta = await readEmbeddingsIndexMeta();
  if (!meta) {
    embeddingsMetaCache = null;
    legacyChunksCache = null;
    return null;
  }
  if (embeddingsMetaCache && embeddingsMetaCache.mtimeMs === meta.mtimeMs) {
    return embeddingsMetaCache;
  }
  embeddingsMetaCache = {
    mtimeMs: meta.mtimeMs,
    chunkCount: meta.chunkCount,
    format: meta.format,
  };
  if (legacyChunksCache && legacyChunksCache.mtimeMs !== meta.mtimeMs) {
    legacyChunksCache = null;
  }
  return embeddingsMetaCache;
}

/**
 * @param {number[]} queryEmbedding
 * @param {number} poolSize
 * @param {string} scopeKey
 * @returns {Promise<Array<{ text: string; source: any; sourcePath: string; score: number }>>}
 */
async function searchSimilarChunks(queryEmbedding, poolSize, scopeKey) {
  const meta = await readEmbeddingsIndexMeta();
  if (!meta || meta.chunkCount === 0) return [];

  const sourceIndex = await loadChunkSourceIndex();
  /** @type {Array<{ text: string; source: any; sourcePath: string; score: number }>} */
  const pool = [];
  let index = 0;

  const consider = (rawChunk) => {
    const chunk = hydrateRetrievedChunk(rawChunk, sourceIndex, {
      index,
      total: meta.chunkCount,
    });
    index += 1;
    const sessionKey =
      chunk?.source?.sessionKey || parseCourseSourceLoose(chunk?.sourcePath || '')?.sessionKey || '';
    if (scopeKey && !chunkMatchesScope(scopeKey, sessionKey)) return;

    const score = cosineSimilarity(chunk.embedding, queryEmbedding);
    pushTopScored(
      pool,
      {
        text: chunk.text || chunk.content || chunk.chunk || '',
        source: chunk.source ?? null,
        sourcePath: chunk.sourcePath || chunk.path || chunk.file || chunk.filename,
        score,
      },
      poolSize
    );
  };

  if (meta.format === 'legacy' && meta.chunkCount <= LEGACY_IN_MEMORY_MAX_CHUNKS) {
    if (!legacyChunksCache || legacyChunksCache.mtimeMs !== meta.mtimeMs) {
      const loaded = await loadEmbeddingsChunks();
      legacyChunksCache = loaded
        ? { mtimeMs: loaded.mtimeMs, chunks: loaded.chunks }
        : null;
    }
    for (const rawChunk of legacyChunksCache?.chunks || []) {
      consider(rawChunk);
    }
    return pool;
  }

  for await (const rawChunk of iterateEmbeddingChunks()) {
    consider(rawChunk);
  }

  return pool;
}

/**
 * Warm the embeddings index at process startup (metadata only — no vector preload).
 * @returns {Promise<void>}
 */
export async function preloadEmbeddingsIndex() {
  const meta = await getEmbeddingsMeta();
  if (!meta) {
    console.warn('[rag] No embeddings index found');
    return;
  }
  console.info(
    `[rag] Embeddings index ready (${meta.chunkCount} chunks, ${meta.format}, shard streaming enabled)`
  );
}

/** Clear in-memory index (tests / after manual ingest in same process). */
export function clearEmbeddingsIndexCache() {
  embeddingsMetaCache = null;
  legacyChunksCache = null;
}

/**
 * @param {string} query
 * @param {number} [topK]
 * @param {{
 *   linkVariant?: import('./course-catalog.js').CourseLinkVariant | null;
 *   sourceDetail?: import('./course-catalog.js').SourceDetail;
 *   scopeKey?: string | null;
 * }} [options]
 * @returns {Promise<{ text: string; sources: Array<{ title: string; url: string; detail: string; access: string }> }>}
 */
export async function retrieve(query, topK = DEFAULT_TOP_K, options = {}) {
  const meta = await getEmbeddingsMeta();
  if (!meta) return { text: '', sources: [] };

  const scopeKey = String(options.scopeKey || '').trim();

  let queryEmbedding;
  try {
    queryEmbedding = await embed(query);
  } catch (err) {
    const status = Number(err?.status);
    if (status === 429 || status === 500 || status === 503) {
      console.warn('RAG retrieval degraded: embedding temporarily unavailable.', err?.message || err);
      return { text: '', sources: [] };
    }
    throw err;
  }

  const poolSize = Math.max(topK * 3, topK);
  const withScore = await searchSimilarChunks(queryEmbedding, poolSize, scopeKey);
  if (!withScore.length) return { text: '', sources: [] };

  const catalog = await loadCourseCatalog();
  const linkVariant = options.linkVariant || null;
  const sourceDetail = options.sourceDetail === 'course' ? 'course' : 'full';

  const courses = withScore.filter((c) => !isBookChunk(c));
  const books = withScore.filter((c) => isBookChunk(c));
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

  /** @type {Array<{ title: string; url: string; detail: string; access: string }>} */
  const sources = [];
  const seen = new Set();
  const top = chosen
    .map((c, i) => {
      const formatted = formatRetrievedChunkWithCatalog(c, catalog, linkVariant, {
        sourceDetail,
        sourceIndex: i + 1,
      });
      const cite = citeFromRetrievedChunk(c, catalog, linkVariant || 'owned');
      if (cite?.title && cite?.url && sources.length < MAX_REPLY_SOURCES) {
        const key = `${cite.title}|${cite.url}|${cite.detail || ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          sources.push({
            title: cite.title,
            url: cite.url,
            detail: cite.detail || '',
            access: cite.access || '',
          });
        }
      }
      return formatted;
    })
    .filter(Boolean);
  if (top.length && sources.length < MAX_REPLY_SOURCES) {
    for (const extra of sourcesFromCatalogMatch(
      top.join('\n\n'),
      catalog,
      linkVariant || 'owned',
      MAX_REPLY_SOURCES - sources.length
    )) {
      const key = `${extra.title}|${extra.url}|${extra.detail || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push(extra);
      if (sources.length >= MAX_REPLY_SOURCES) break;
    }
  }
  if (top.length && !sources.length) {
    console.warn(
      '[rag] retrieve returned excerpts but no catalog sources; chosen0 keys=',
      chosen[0] ? Object.keys(chosen[0]).filter((k) => k !== 'embedding' && k !== 'score') : []
    );
  }
  return { text: top.join('\n\n'), sources };
}
