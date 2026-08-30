/**
 * Sharded embeddings index on disk (JSONL shards + index.json manifest).
 * Avoids V8 JSON.stringify / readFile limits for large corpora.
 */

import { createReadStream } from 'fs';
import { mkdir, open, readFile, rm, stat, writeFile } from 'fs/promises';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
export const EMBEDDINGS_DIR = join(ROOT, 'data', 'embeddings');
export const EMBEDDINGS_INDEX_PATH = join(EMBEDDINGS_DIR, 'index.json');
export const EMBEDDINGS_SHARDS_DIR = join(EMBEDDINGS_DIR, 'shards');
/** @deprecated Legacy monolithic index — still loaded when present. */
export const LEGACY_EMBEDDINGS_PATH = join(ROOT, 'data', 'embeddings.json');

/** Keep each shard under V8's max string size when reading/writing. */
const SHARD_MAX_BYTES = 80 * 1024 * 1024;

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (e) {
    if (e?.code === 'ENOENT') return false;
    throw e;
  }
}

/**
 * @returns {Promise<number>}
 */
async function indexMtimeMs() {
  if (await pathExists(EMBEDDINGS_INDEX_PATH)) {
    return (await stat(EMBEDDINGS_INDEX_PATH)).mtimeMs;
  }
  if (await pathExists(LEGACY_EMBEDDINGS_PATH)) {
    return (await stat(LEGACY_EMBEDDINGS_PATH)).mtimeMs;
  }
  return 0;
}

/**
 * @param {string} filePath
 * @returns {Promise<any[]>}
 */
async function readJsonlFile(filePath) {
  /** @type {any[]} */
  const chunks = [];
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    chunks.push(JSON.parse(trimmed));
  }
  return chunks;
}

/**
 * @param {import('fs/promises').FileHandle} handle
 * @param {string} line
 */
async function appendLine(handle, line) {
  await handle.write(line);
}

/**
 * @returns {Promise<{ appendChunk: (chunk: any) => Promise<void>; finalize: (manifest: Record<string, boolean>) => Promise<{ chunkCount: number }> }>}
 */
export async function createEmbeddingsWriter() {
  await rm(EMBEDDINGS_DIR, { recursive: true, force: true });
  await mkdir(EMBEDDINGS_SHARDS_DIR, { recursive: true });

  /** @type {string[]} */
  const shardNames = [];
  /** @type {import('fs/promises').FileHandle | null} */
  let currentHandle = null;
  let shardIndex = 0;
  let shardBytes = 0;
  let shardChunks = 0;
  let totalChunks = 0;

  async function openNewShard() {
    if (currentHandle) {
      await currentHandle.close();
      currentHandle = null;
    }
    const name = `shard-${String(shardIndex).padStart(3, '0')}.jsonl`;
    shardNames.push(name);
    const shardPath = join(EMBEDDINGS_SHARDS_DIR, name);
    currentHandle = await open(shardPath, 'w');
    shardIndex += 1;
    shardBytes = 0;
    shardChunks = 0;
  }

  async function ensureShard() {
    if (!currentHandle) await openNewShard();
  }

  return {
    async appendChunk(chunk) {
      const line = `${JSON.stringify(chunk)}\n`;
      const lineBytes = Buffer.byteLength(line, 'utf8');
      if (currentHandle && shardBytes + lineBytes > SHARD_MAX_BYTES && shardChunks > 0) {
        await openNewShard();
      }
      await ensureShard();
      await appendLine(currentHandle, line);
      shardBytes += lineBytes;
      shardChunks += 1;
      totalChunks += 1;
    },

    async finalize(manifest) {
      if (currentHandle) {
        await currentHandle.close();
        currentHandle = null;
      }
      await mkdir(EMBEDDINGS_DIR, { recursive: true });
      await writeFile(
        EMBEDDINGS_INDEX_PATH,
        JSON.stringify(
          {
            version: 2,
            chunkCount: totalChunks,
            manifest,
            shards: shardNames,
          },
          null,
          0
        ),
        'utf-8'
      );
      return { chunkCount: totalChunks };
    },
  };
}

/**
 * Open writer that appends to existing sharded index (incremental ingest).
 * @returns {Promise<{ appendChunk: (chunk: any) => Promise<void>; finalize: (manifest: Record<string, boolean>) => Promise<{ chunkCount: number }> } | null>}
 */
export async function openEmbeddingsAppender() {
  if (!(await pathExists(EMBEDDINGS_INDEX_PATH))) return null;

  const raw = await readFile(EMBEDDINGS_INDEX_PATH, 'utf-8');
  const index = JSON.parse(raw);
  /** @type {string[]} */
  const shardNames = Array.isArray(index.shards) ? [...index.shards] : [];
  let totalChunks = Number(index.chunkCount) || 0;

  await mkdir(EMBEDDINGS_SHARDS_DIR, { recursive: true });

  let shardIndex = shardNames.length;
  /** @type {import('fs/promises').FileHandle | null} */
  let currentHandle = null;
  let shardBytes = 0;
  let shardChunks = 0;

  if (shardNames.length > 0) {
    const lastShard = shardNames[shardNames.length - 1];
    const lastPath = join(EMBEDDINGS_SHARDS_DIR, lastShard);
    if (await pathExists(lastPath)) {
      const info = await stat(lastPath);
      shardBytes = info.size;
      currentHandle = await open(lastPath, 'a');
      const existing = await readJsonlFile(lastPath);
      shardChunks = existing.length;
    }
  }

  async function openNewShard() {
    if (currentHandle) {
      await currentHandle.close();
      currentHandle = null;
    }
    const name = `shard-${String(shardIndex).padStart(3, '0')}.jsonl`;
    shardNames.push(name);
    currentHandle = await open(join(EMBEDDINGS_SHARDS_DIR, name), 'w');
    shardIndex += 1;
    shardBytes = 0;
    shardChunks = 0;
  }

  async function ensureShard() {
    if (!currentHandle) await openNewShard();
  }

  return {
    async appendChunk(chunk) {
      const line = `${JSON.stringify(chunk)}\n`;
      const lineBytes = Buffer.byteLength(line, 'utf8');
      if (currentHandle && shardBytes + lineBytes > SHARD_MAX_BYTES && shardChunks > 0) {
        await openNewShard();
      }
      await ensureShard();
      await appendLine(currentHandle, line);
      shardBytes += lineBytes;
      shardChunks += 1;
      totalChunks += 1;
    },

    async finalize(manifest) {
      if (currentHandle) {
        await currentHandle.close();
        currentHandle = null;
      }
      await writeFile(
        EMBEDDINGS_INDEX_PATH,
        JSON.stringify(
          {
            version: 2,
            chunkCount: totalChunks,
            manifest,
            shards: shardNames,
          },
          null,
          0
        ),
        'utf-8'
      );
      return { chunkCount: totalChunks };
    },
  };
}

/**
 * @returns {Promise<{ manifest: Record<string, boolean>; chunkCount: number } | null>}
 */
export async function readEmbeddingsManifest() {
  if (await pathExists(EMBEDDINGS_INDEX_PATH)) {
    const raw = await readFile(EMBEDDINGS_INDEX_PATH, 'utf-8');
    const data = JSON.parse(raw);
    return {
      manifest: data.manifest && typeof data.manifest === 'object' ? data.manifest : {},
      chunkCount: Number(data.chunkCount) || 0,
    };
  }
  if (await pathExists(LEGACY_EMBEDDINGS_PATH)) {
    const raw = await readFile(LEGACY_EMBEDDINGS_PATH, 'utf-8');
    const data = JSON.parse(raw);
    return {
      manifest: data.manifest && typeof data.manifest === 'object' ? data.manifest : {},
      chunkCount: Array.isArray(data.chunks) ? data.chunks.length : 0,
    };
  }
  return null;
}

/**
 * @returns {Promise<{ mtimeMs: number; chunkCount: number; shards: string[]; manifest: Record<string, boolean>; format: 'sharded' | 'legacy' } | null>}
 */
export async function readEmbeddingsIndexMeta() {
  const mtimeMs = await indexMtimeMs();
  if (!mtimeMs) return null;

  if (await pathExists(EMBEDDINGS_INDEX_PATH)) {
    const raw = await readFile(EMBEDDINGS_INDEX_PATH, 'utf-8');
    const index = JSON.parse(raw);
    return {
      mtimeMs,
      chunkCount: Number(index.chunkCount) || 0,
      shards: Array.isArray(index.shards) ? index.shards : [],
      manifest: index.manifest && typeof index.manifest === 'object' ? index.manifest : {},
      format: 'sharded',
    };
  }

  if (await pathExists(LEGACY_EMBEDDINGS_PATH)) {
    const raw = await readFile(LEGACY_EMBEDDINGS_PATH, 'utf-8');
    const data = JSON.parse(raw);
    return {
      mtimeMs,
      chunkCount: Array.isArray(data.chunks) ? data.chunks.length : 0,
      shards: [],
      manifest: data.manifest && typeof data.manifest === 'object' ? data.manifest : {},
      format: 'legacy',
    };
  }

  return null;
}

/**
 * Stream chunks one at a time (sharded JSONL or legacy array).
 * @returns {AsyncGenerator<any, void, unknown>}
 */
export async function* iterateEmbeddingChunks() {
  if (await pathExists(EMBEDDINGS_INDEX_PATH)) {
    const raw = await readFile(EMBEDDINGS_INDEX_PATH, 'utf-8');
    const index = JSON.parse(raw);
    for (const shardName of index.shards || []) {
      const shardPath = join(EMBEDDINGS_SHARDS_DIR, shardName);
      const stream = createReadStream(shardPath, { encoding: 'utf8' });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        yield JSON.parse(trimmed);
      }
    }
    return;
  }

  if (await pathExists(LEGACY_EMBEDDINGS_PATH)) {
    const raw = await readFile(LEGACY_EMBEDDINGS_PATH, 'utf-8');
    const data = JSON.parse(raw);
    for (const chunk of data.chunks || []) {
      yield chunk;
    }
  }
}

/**
 * Load all chunks from sharded or legacy index.
 * Prefer {@link iterateEmbeddingChunks} on memory-constrained servers (e.g. Render).
 * @returns {Promise<{ mtimeMs: number; chunks: any[]; manifest: Record<string, boolean> } | null>}
 */
export async function loadEmbeddingsChunks() {
  const mtimeMs = await indexMtimeMs();
  if (!mtimeMs) return null;

  if (await pathExists(EMBEDDINGS_INDEX_PATH)) {
    const raw = await readFile(EMBEDDINGS_INDEX_PATH, 'utf-8');
    const index = JSON.parse(raw);
    /** @type {any[]} */
    const chunks = [];
    for (const shardName of index.shards || []) {
      const shardPath = join(EMBEDDINGS_SHARDS_DIR, shardName);
      chunks.push(...(await readJsonlFile(shardPath)));
    }
    return {
      mtimeMs,
      chunks,
      manifest: index.manifest && typeof index.manifest === 'object' ? index.manifest : {},
    };
  }

  if (await pathExists(LEGACY_EMBEDDINGS_PATH)) {
    const raw = await readFile(LEGACY_EMBEDDINGS_PATH, 'utf-8');
    const data = JSON.parse(raw);
    return {
      mtimeMs,
      chunks: Array.isArray(data.chunks) ? data.chunks : [],
      manifest: data.manifest && typeof data.manifest === 'object' ? data.manifest : {},
    };
  }

  return null;
}
