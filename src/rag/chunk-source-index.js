/**
 * Lightweight sourcePath lookup for embeddings that were built without
 * `sourcePath` / `source` metadata (common on Render when only vectors shipped).
 *
 * Built from local data/embeddings.json via scripts/build-chunk-source-index.js.
 */

import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseCourseSourceLoose } from './course-source.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const INDEX_PATH = join(ROOT, 'data', 'chunk-source-index.json');

/** @type {{ byHash: Record<string, string>; byPrefix: Record<string, string> } | null} */
let indexCache = null;
/** @type {Promise<{ byHash: Record<string, string>; byPrefix: Record<string, string> }> | null} */
let indexLoadPromise = null;

/**
 * @param {string} text
 * @returns {string}
 */
export function normalizeChunkTextForIndex(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/^\[Source:[^\]]*\]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} text
 * @returns {string}
 */
export function chunkTextHash(text) {
  const n = normalizeChunkTextForIndex(text);
  if (!n) return '';
  return createHash('sha1').update(n).digest('hex');
}

/**
 * @param {string} text
 * @returns {string}
 */
export function chunkTextPrefix(text) {
  return normalizeChunkTextForIndex(text).slice(0, 160);
}

/**
 * @returns {Promise<{ byHash: Record<string, string>; byPrefix: Record<string, string> }>}
 */
export async function loadChunkSourceIndex() {
  if (indexCache) return indexCache;
  if (indexLoadPromise) return indexLoadPromise;

  indexLoadPromise = (async () => {
    try {
      const raw = await readFile(INDEX_PATH, 'utf-8');
      const data = JSON.parse(raw);
      indexCache = {
        byHash: data?.h && typeof data.h === 'object' ? data.h : {},
        byPrefix: data?.p && typeof data.p === 'object' ? data.p : {},
      };
      console.info(
        `[rag] Chunk source index loaded (${Object.keys(indexCache.byHash).length} hashes)`
      );
    } catch (err) {
      if (err?.code === 'ENOENT') {
        indexCache = { byHash: {}, byPrefix: {} };
        console.warn('[rag] data/chunk-source-index.json missing; catalog cites need chunk metadata');
      } else {
        throw err;
      }
    } finally {
      indexLoadPromise = null;
    }
    return indexCache;
  })();

  return indexLoadPromise;
}

export function clearChunkSourceIndexCache() {
  indexCache = null;
  indexLoadPromise = null;
}

/**
 * @param {string} text
 * @param {{ byHash?: Record<string, string>; byPrefix?: Record<string, string> } | null | undefined} index
 * @returns {string}
 */
export function lookupChunkSourcePath(text, index) {
  if (!text || !index) return '';
  const hash = chunkTextHash(text);
  const fromHash = hash ? String(index.byHash?.[hash] || '').trim() : '';
  if (fromHash) return fromHash;
  const prefix = chunkTextPrefix(text);
  return prefix ? String(index.byPrefix?.[prefix] || '').trim() : '';
}

/**
 * Fill missing sourcePath / source / text aliases on an embedding chunk.
 * @param {any} chunk
 * @param {{ byHash?: Record<string, string>; byPrefix?: Record<string, string> } | null | undefined} index
 * @returns {any}
 */
export function hydrateRetrievedChunk(chunk, index) {
  if (!chunk || typeof chunk !== 'object') return chunk;
  const text = String(chunk.text || chunk.content || chunk.chunk || '');
  if (text && !chunk.text) chunk.text = text;

  let source = chunk.source || chunk.metadata?.source || null;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      source = null;
    }
  }

  let sourcePath = String(
    chunk.sourcePath ||
      chunk.path ||
      chunk.file ||
      chunk.filename ||
      chunk.metadata?.sourcePath ||
      ''
  ).trim();
  if (!sourcePath && text) {
    sourcePath = lookupChunkSourcePath(text, index);
  }

  if ((!source || !source.sessionKey) && sourcePath) {
    source = parseCourseSourceLoose(sourcePath) || source;
  }

  if (sourcePath) chunk.sourcePath = sourcePath;
  if (source) chunk.source = source;
  return chunk;
}
