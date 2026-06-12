/**
 * Shared helpers: chunk a file, attach course source metadata, embed.
 */

import { embed } from '../lib/gemini.js';
import { parseCourseSourceFromPath, courseSourceEmbedPrefix } from './course-source.js';

const CHUNK_SIZE = 1600;

/**
 * @param {string} text
 * @returns {string[]}
 */
export function chunkText(text) {
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

/**
 * @param {string} filePath
 * @param {string} text
 * @returns {Promise<Array<{ text: string; embedding: number[]; sourcePath: string; source: import('./course-source.js').CourseSource | null }>>}
 */
export async function buildEmbeddedChunksForFile(filePath, text) {
  const source = parseCourseSourceFromPath(filePath);
  const prefix = courseSourceEmbedPrefix(source);
  const parts = chunkText(text);
  const out = [];

  for (const part of parts) {
    const embedText = prefix ? `${prefix}${part}` : part;
    const embedding = await embed(embedText);
    out.push({
      text: part,
      embedding,
      sourcePath: filePath,
      source,
    });
  }

  return out;
}
