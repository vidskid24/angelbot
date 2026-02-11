/**
 * Chunk style-guide files and embed them; save to data/embeddings.json.
 */

import { readdir, readFile, mkdir, writeFile } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { embed } from '../lib/openai.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const STYLE_GUIDES_PATH = process.env.STYLE_GUIDES_PATH || 'data/style-guides';
const EMBEDDINGS_PATH = join(ROOT, 'data', 'embeddings.json');
const CHUNK_SIZE = 500;
const EXTS = new Set(['.txt', '.md']);

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

export async function ingest() {
  const dir = join(ROOT, STYLE_GUIDES_PATH);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return { chunks: 0 };
    throw e;
  }

  const chunks = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!EXTS.has(extname(ent.name).toLowerCase())) continue;
    const path = join(dir, ent.name);
    const text = await readFile(path, 'utf-8');
    const parts = chunkText(text);
    for (const text of parts) {
      const embedding = await embed(text);
      chunks.push({ text, embedding });
    }
  }

  await mkdir(dirname(EMBEDDINGS_PATH), { recursive: true });
  await writeFile(EMBEDDINGS_PATH, JSON.stringify({ chunks }), 'utf-8');
  return { chunks: chunks.length };
}
