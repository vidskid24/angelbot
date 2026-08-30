/**
 * Chunk style-guide files and embed them; save to data/embeddings/ (sharded JSONL).
 * Source can be a local folder (STYLE_GUIDES_PATH) or a Dropbox folder (DROPBOX_ACCESS_TOKEN + DROPBOX_FOLDER_PATH).
 *
 * Course session files use: L{level}-C{class}-S{session}-{title}.ext
 * Example: L1-C1-S4-Living Light Meditation.pdf
 */

import { createRequire } from 'module';
import { readdir, readFile } from 'fs/promises';
import { join, extname, isAbsolute, dirname } from 'path';
import { fileURLToPath } from 'url';
import { listFilesInFolder, downloadFileAsText, downloadFileAsBuffer } from '../lib/dropbox.js';
import { buildEmbeddedChunksForFile } from './ingest-chunks.js';
import { clearEmbeddingsIndexCache } from './retrieve.js';
import { clearChunkSourceIndexCache } from './chunk-source-index.js';
import {
  createEmbeddingsWriter,
  openEmbeddingsAppender,
  readEmbeddingsManifest,
} from './embeddings-store.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const STYLE_GUIDES_PATH = process.env.STYLE_GUIDES_PATH || 'data/style-guides';
const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;
const DROPBOX_FOLDER_PATH = process.env.DROPBOX_FOLDER_PATH || '';
const EXTS = new Set(['.txt', '.md', '.pdf']);

const useDropbox = Boolean(DROPBOX_ACCESS_TOKEN);

async function extractPdfText(buffer) {
  try {
    const data = await pdfParse(buffer);
    return data && data.text ? String(data.text) : '';
  } catch (err) {
    console.error('PDF extract error:', err?.message || err);
    return '';
  }
}

/**
 * Get plain text for a file (path). For .txt/.md reads as UTF-8; for .pdf extracts text from buffer.
 */
async function getFileText(path, ext, source = 'auto') {
  const useDropboxForFile = source === 'dropbox' || (source === 'auto' && useDropbox);
  const isPdf = ext.toLowerCase() === '.pdf';
  if (isPdf) {
    const buffer = useDropboxForFile
      ? await downloadFileAsBuffer(DROPBOX_ACCESS_TOKEN, path)
      : await readFile(path);
    return extractPdfText(buffer);
  }
  return useDropboxForFile
    ? downloadFileAsText(DROPBOX_ACCESS_TOKEN, path)
    : readFile(path, 'utf-8');
}

async function listSourceFilesLocal() {
  const dir = isAbsolute(STYLE_GUIDES_PATH) ? STYLE_GUIDES_PATH : join(ROOT, STYLE_GUIDES_PATH);
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!EXTS.has(extname(ent.name).toLowerCase())) continue;
    out.push({ path: join(dir, ent.name) });
  }
  return out;
}

async function listSourceFilesDropbox() {
  const raw = DROPBOX_FOLDER_PATH.trim();
  let folderPath = raw === '' ? '' : raw.startsWith('/') ? raw : `/${raw}`;
  if (folderPath === '' || /^\/Apps\//i.test(folderPath)) {
    folderPath = '';
  }
  const files = await listFilesInFolder(DROPBOX_ACCESS_TOKEN, folderPath);
  const out = [];
  for (const file of files) {
    if (!EXTS.has(extname(file.name).toLowerCase())) continue;
    out.push({ path: file.path_display });
  }
  return out;
}

async function listSourceFiles() {
  if (useDropbox) return listSourceFilesDropbox();
  return listSourceFilesLocal();
}

/**
 * @param {{ appendChunk: (chunk: any) => Promise<void> }} writer
 * @param {Record<string, boolean>} manifest
 */
async function ingestLocalFilesIntoWriter(writer, manifest) {
  const dir = isAbsolute(STYLE_GUIDES_PATH) ? STYLE_GUIDES_PATH : join(ROOT, STYLE_GUIDES_PATH);
  const entries = await readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const ext = extname(ent.name).toLowerCase();
    if (!EXTS.has(ext)) continue;
    const filePath = join(dir, ent.name);
    const text = await getFileText(filePath, ext, 'local');
    if (!text || !text.trim()) continue;
    for (const chunk of await buildEmbeddedChunksForFile(filePath, text)) {
      await writer.appendChunk(chunk);
    }
    manifest[filePath] = true;
  }
}

/**
 * @param {{ appendChunk: (chunk: any) => Promise<void> }} writer
 * @param {Record<string, boolean>} manifest
 */
async function ingestFilesIntoWriter(writer, manifest) {
  if (useDropbox) {
    const raw = DROPBOX_FOLDER_PATH.trim();
    let folderPath = raw === '' ? '' : raw.startsWith('/') ? raw : `/${raw}`;
    if (folderPath === '' || /^\/Apps\//i.test(folderPath)) {
      folderPath = '';
    }
    const files = await listFilesInFolder(DROPBOX_ACCESS_TOKEN, folderPath);
    let fileIndex = 0;
    for (const file of files) {
      fileIndex += 1;
      const ext = extname(file.name).toLowerCase();
      if (!EXTS.has(ext)) continue;
      const text = await getFileText(file.path_display, ext, 'dropbox');
      if (!text || !text.trim()) continue;
      const fileChunks = await buildEmbeddedChunksForFile(file.path_display, text);
      for (const chunk of fileChunks) {
        await writer.appendChunk(chunk);
      }
      manifest[file.path_display] = true;
      if (fileIndex % 25 === 0 || fileIndex === files.length) {
        console.log(`Ingest progress: ${fileIndex}/${files.length} files`);
      }
    }
    return;
  }

  await ingestLocalFilesIntoWriter(writer, manifest);
}

async function ingestLocalOnly(writer, manifest) {
  try {
    await ingestLocalFilesIntoWriter(writer, manifest);
  } catch (e) {
    if (e.code === 'ENOENT') return { chunks: 0 };
    throw e;
  }
  return null;
}

export async function ingest() {
  const writer = await createEmbeddingsWriter();
  /** @type {Record<string, boolean>} */
  const manifest = {};

  if (!useDropbox) {
    const early = await ingestLocalOnly(writer, manifest);
    if (early) return early;
    const result = await writer.finalize(manifest);
    clearEmbeddingsIndexCache();
    clearChunkSourceIndexCache();
    return { chunks: result.chunkCount };
  }

  try {
    await ingestFilesIntoWriter(writer, manifest);
  } catch (e) {
    const errorMessage = e?.message ?? String(e);
    if (errorMessage.includes('expired_access_token') || errorMessage.includes('access token has expired')) {
      const localWriter = await createEmbeddingsWriter();
      const localManifest = {};
      const early = await ingestLocalOnly(localWriter, localManifest);
      if (early) return early;
      const result = await localWriter.finalize(localManifest);
      clearEmbeddingsIndexCache();
      clearChunkSourceIndexCache();
      return { chunks: result.chunkCount };
    }
    if (e.message?.includes('path/not_found') || e.message?.includes('not_found')) {
      return { chunks: 0 };
    }
    throw e;
  }

  const result = await writer.finalize(manifest);
  clearEmbeddingsIndexCache();
  clearChunkSourceIndexCache();
  return { chunks: result.chunkCount };
}

/**
 * Ingest only files not yet in the manifest. Appends to the sharded index.
 * If no manifest exists (legacy monolithic index), runs full ingest once.
 */
export async function ingestIncremental() {
  const existing = await readEmbeddingsManifest();
  if (!existing?.manifest || Object.keys(existing.manifest).length === 0) {
    return ingest();
  }

  const sourceFiles = await listSourceFiles();
  const newPaths = sourceFiles.filter((f) => !existing.manifest[f.path]).map((f) => f.path);
  if (newPaths.length === 0) {
    return { chunks: existing.chunkCount, added: 0 };
  }

  const appender = await openEmbeddingsAppender();
  if (!appender) return ingest();

  const manifest = { ...existing.manifest };
  for (const path of newPaths) {
    const ext = extname(path).toLowerCase();
    const text = await getFileText(path, ext, useDropbox ? 'dropbox' : 'local');
    if (!text || !text.trim()) continue;
    for (const chunk of await buildEmbeddedChunksForFile(path, text)) {
      await appender.appendChunk(chunk);
    }
    manifest[path] = true;
  }

  const result = await appender.finalize(manifest);
  clearEmbeddingsIndexCache();
  clearChunkSourceIndexCache();
  return { chunks: result.chunkCount, added: newPaths.length };
}
