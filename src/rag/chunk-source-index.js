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

/** @typedef {{ byHash: Record<string, string>; byPrefix: Record<string, string>; byFingerprint: Record<string, string>; paths: string[] }} ChunkSourceIndex */

/** @type {ChunkSourceIndex | null} */
let indexCache = null;
/** @type {Promise<ChunkSourceIndex> | null} */
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
 * @param {string} text
 * @returns {string}
 */
export function chunkTextFingerprint(text) {
  const n = normalizeChunkTextForIndex(text);
  if (n.length < 40) return '';
  return `${n.slice(0, 80)}|${n.slice(-80)}`;
}

function sessionKeyFromText(text) {
  const raw = String(text || '');
  const prefixed = raw.match(/^\s*\[Source:[^\]]*?\(([^)]+)\)\]/i);
  if (prefixed?.[1]) {
    const parsed = parseCourseSourceLoose(prefixed[1].trim());
    if (parsed?.sessionKey) return parsed.sessionKey;
    return String(prefixed[1]).trim();
  }
  const paren = raw.slice(0, 280).match(/\(((?:ML\d+|L\d+|ETPF|CFWATI|LWTLB|R[123])(?:-[A-Za-z0-9]+)+)\)/);
  return paren?.[1] ? String(paren[1]).trim() : '';
}

/**
 * @returns {Promise<ChunkSourceIndex>}
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
        byFingerprint: data?.k && typeof data.k === 'object' ? data.k : {},
        paths: Array.isArray(data?.a) ? data.a.map((p) => String(p || '').trim()) : [],
      };
      console.info(
        `[rag] Chunk source index loaded (${Object.keys(indexCache.byHash).length} hashes, ${indexCache.paths.length} ordered paths)`
      );
    } catch (err) {
      if (err?.code === 'ENOENT') {
        indexCache = { byHash: {}, byPrefix: {}, byFingerprint: {}, paths: [] };
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
 * @param {ChunkSourceIndex | null | undefined} index
 * @returns {string}
 */
export function lookupChunkSourcePath(text, index) {
  if (!text || !index) return '';
  const hash = chunkTextHash(text);
  const fromHash = hash ? String(index.byHash?.[hash] || '').trim() : '';
  if (fromHash) return fromHash;
  const prefix = chunkTextPrefix(text);
  const fromPrefix = prefix ? String(index.byPrefix?.[prefix] || '').trim() : '';
  if (fromPrefix) return fromPrefix;
  const fingerprint = chunkTextFingerprint(text);
  return fingerprint ? String(index.byFingerprint?.[fingerprint] || '').trim() : '';
}

/**
 * Fill missing sourcePath / source / text aliases on an embedding chunk.
 * @param {any} chunk
 * @param {ChunkSourceIndex | null | undefined} index
 * @param {{ index?: number; total?: number }} [position]
 * @returns {any}
 */
export function hydrateRetrievedChunk(chunk, index, position = {}) {
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
  if (
    !sourcePath &&
    index?.paths?.length &&
    Number.isInteger(position.index) &&
    position.total === index.paths.length
  ) {
    sourcePath = String(index.paths[position.index] || '').trim();
  }
  if (!sourcePath && text) {
    const fromPrefix = sessionKeyFromText(text);
    if (fromPrefix) sourcePath = /\.(txt|md|pdf)$/i.test(fromPrefix) ? fromPrefix : `${fromPrefix}.txt`;
  }

  if ((!source || !source.sessionKey) && sourcePath) {
    source = parseCourseSourceLoose(sourcePath) || source;
  }

  if (sourcePath) chunk.sourcePath = sourcePath;
  if (source) chunk.source = source;
  return chunk;
}
