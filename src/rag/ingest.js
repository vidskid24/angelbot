/**
 * Chunk style-guide files and embed them; save to data/embeddings.json.
 * Source can be a local folder (STYLE_GUIDES_PATH) or a Dropbox folder (DROPBOX_ACCESS_TOKEN + DROPBOX_FOLDER_PATH).
 */

import { createRequire } from 'module';
import { readdir, readFile, mkdir, writeFile } from 'fs/promises';
import { join, extname, isAbsolute, dirname } from 'path';
import { fileURLToPath } from 'url';
import { embed } from '../lib/gemini.js';
import { listFilesInFolder, downloadFileAsText, downloadFileAsBuffer } from '../lib/dropbox.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const STYLE_GUIDES_PATH = process.env.STYLE_GUIDES_PATH || 'data/style-guides';
const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;
const DROPBOX_FOLDER_PATH = process.env.DROPBOX_FOLDER_PATH || '';
const EMBEDDINGS_PATH = join(ROOT, 'data', 'embeddings.json');
const CHUNK_SIZE = 1600;
const EXTS = new Set(['.txt', '.md', '.pdf']);

const useDropbox = Boolean(DROPBOX_ACCESS_TOKEN);

async function extractPdfText(buffer) {
  try {
    const data = await pdfParse(buffer);
    return (data && data.text) ? String(data.text) : '';
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

function chunkText(text) {
  const chunks = [];
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());
  let current = '';
  for (const p of paragraphs) {
    if (current.length + p.length > CHUNK_SIZE && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }
    current += (current ? '\n\n' : '') + p;
  }
  if (current.trim()) chunks.push(current.trim());
  if (chunks.length === 0 && text.trim()) chunks.push(text.trim().slice(0, CHUNK_SIZE * 2));
  return chunks;
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

async function ingestFromLocal() {
  const dir = isAbsolute(STYLE_GUIDES_PATH) ? STYLE_GUIDES_PATH : join(ROOT, STYLE_GUIDES_PATH);
  const entries = await readdir(dir, { withFileTypes: true });
  const chunks = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const ext = extname(ent.name).toLowerCase();
    if (!EXTS.has(ext)) continue;
    const filePath = join(dir, ent.name);
    const text = await getFileText(filePath, ext, 'local');
    if (!text || !text.trim()) continue;
    const parts = chunkText(text);
    for (const part of parts) {
      const embedding = await embed(part);
      chunks.push({ text: part, embedding, sourcePath: filePath });
    }
  }
  return chunks;
}

async function ingestFromDropbox() {
  const raw = DROPBOX_FOLDER_PATH.trim();
  let folderPath = raw === '' ? '' : raw.startsWith('/') ? raw : `/${raw}`;
  // App folder apps: API root is ""; paths like /Apps/AppName are invalid and cause 409. Use "" for app root.
  if (folderPath === '' || /^\/Apps\//i.test(folderPath)) {
    folderPath = '';
  }
  const files = await listFilesInFolder(DROPBOX_ACCESS_TOKEN, folderPath);
  const chunks = [];
  for (const file of files) {
    const ext = extname(file.name).toLowerCase();
    if (!EXTS.has(ext)) continue;
    const text = await getFileText(file.path_display, ext, 'dropbox');
    if (!text || !text.trim()) continue;
    const parts = chunkText(text);
    for (const part of parts) {
      const embedding = await embed(part);
      chunks.push({ text: part, embedding, sourcePath: file.path_display });
    }
  }
  return chunks;
}

export async function ingest() {
  let chunks;
  if (useDropbox) {
    try {
      chunks = await ingestFromDropbox();
    } catch (e) {
      const errorMessage = e?.message ?? String(e);
      if (errorMessage.includes('expired_access_token') || errorMessage.includes('access token has expired')) {
        chunks = await ingestFromLocal();
      } else if (e.message?.includes('path/not_found') || e.message?.includes('not_found')) {
        return { chunks: 0 };
      } else {
        throw e;
      }
    }
  } else {
    try {
      chunks = await ingestFromLocal();
    } catch (e) {
      if (e.code === 'ENOENT') return { chunks: 0 };
      throw e;
    }
  }

  const manifest = {};
  for (const c of chunks) manifest[c.sourcePath] = true;

  await mkdir(dirname(EMBEDDINGS_PATH), { recursive: true });
  await writeFile(EMBEDDINGS_PATH, JSON.stringify({ chunks, manifest }), 'utf-8');
  return { chunks: chunks.length };
}

/**
 * Ingest only files not yet in the manifest. Loads existing embeddings.json, diffs
 * against current source files, and embeds only new ones. If no manifest exists (e.g.
 * pre-upgrade index), runs full ingest once to populate manifest + sourcePath.
 */
export async function ingestIncremental() {
  let chunks = [];
  let manifest = {};
  try {
    const raw = await readFile(EMBEDDINGS_PATH, 'utf-8');
    const data = JSON.parse(raw);
    chunks = data.chunks || [];
    manifest = data.manifest || {};
    if (!data.manifest) {
      return ingest();
    }
  } catch (e) {
    if (e.code === 'ENOENT') {
      chunks = [];
      manifest = {};
    } else throw e;
  }

  const sourceFiles = await listSourceFiles();
  const newPaths = sourceFiles.filter((f) => !manifest[f.path]).map((f) => f.path);
  if (newPaths.length === 0) {
    return { chunks: chunks.length, added: 0 };
  }

  for (const path of newPaths) {
    const ext = extname(path).toLowerCase();
    const text = await getFileText(path, ext, useDropbox ? 'dropbox' : 'local');
    if (!text || !text.trim()) continue;
    const parts = chunkText(text);
    for (const part of parts) {
      const embedding = await embed(part);
      chunks.push({ text: part, embedding, sourcePath: path });
    }
    manifest[path] = true;
  }

  await mkdir(dirname(EMBEDDINGS_PATH), { recursive: true });
  await writeFile(EMBEDDINGS_PATH, JSON.stringify({ chunks, manifest }), 'utf-8');
  return { chunks: chunks.length, added: newPaths.length };
}
