/**
 * Load embeddings index and return top-k chunks by similarity to the query.
 * The embeddings file is kept warm in memory and reloaded when mtime changes.
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
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
import { loadEmbeddingsChunks } from './embeddings-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const DEFAULT_TOP_K = 6;

/** @type {{ mtimeMs: number; chunks: any[] } | null} */
let embeddingsIndexCache = null;
/** @type {Promise<{ mtimeMs: number; chunks: any[] } | null> | null} */
let embeddingsIndexLoadPromise = null;

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

/**
 * @returns {Promise<{ mtimeMs: number; chunks: any[] } | null>}
 */
async function loadEmbeddingsIndex() {
  const loadedPreview = await loadEmbeddingsChunks();
  if (!loadedPreview) {
    embeddingsIndexCache = null;
    return null;
  }
  const mtimeMs = loadedPreview.mtimeMs;

  if (embeddingsIndexCache && embeddingsIndexCache.mtimeMs === mtimeMs) {
    return embeddingsIndexCache;
  }

  if (embeddingsIndexLoadPromise) {
    return embeddingsIndexLoadPromise;
  }

  embeddingsIndexLoadPromise = (async () => {
    try {
      const loaded = await loadEmbeddingsChunks();
      if (!loaded) {
        embeddingsIndexCache = null;
        return null;
      }
      if (embeddingsIndexCache && embeddingsIndexCache.mtimeMs === loaded.mtimeMs) {
        return embeddingsIndexCache;
      }
      const sourceIndex = await loadChunkSourceIndex();
      const rawChunks = loaded.chunks;
      let hydrated = 0;
      const chunks = rawChunks.map((chunk, index) => {
        const hadPath = Boolean(String(chunk?.sourcePath || '').trim());
        const next = hydrateRetrievedChunk(chunk, sourceIndex, {
          index,
          total: rawChunks.length,
        });
        if (!hadPath && next?.sourcePath) hydrated += 1;
        return next;
      });
      embeddingsIndexCache = { mtimeMs: loaded.mtimeMs, chunks };
      console.info(
        `[rag] Embeddings index loaded into memory (${chunks.length} chunks, hydrated ${hydrated} source paths)`
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

function isBookChunk(chunk) {
  const path = String(chunk?.sourcePath || '');
  const source = chunk?.source;
  if (source?.unitType === 'book') return true;
  if (String(source?.sessionKey || '').startsWith('book:')) return true;
  return /(^|\/)ACIMA/i.test(path);
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
  const index = await loadEmbeddingsIndex();
  if (!index) return { text: '', sources: [] };
  const scopeKey = String(options.scopeKey || '').trim();
  const chunks = scopeKey
    ? index.chunks.filter((c) =>
        chunkMatchesScope(
          scopeKey,
          c?.source?.sessionKey || parseCourseSourceLoose(c?.sourcePath || '')?.sessionKey || ''
        )
      )
    : index.chunks;
  if (!chunks.length) return { text: '', sources: [] };

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
  const withScore = chunks.map((c) => ({
    text: c.text || c.content || c.chunk || '',
    source: c.source ?? null,
    sourcePath: c.sourcePath || c.path || c.file || c.filename,
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
