/**
 * Shared helpers: chunk a file, attach course source metadata, embed.
 */

import { embed } from '../lib/gemini.js';
import { parseCourseSourceFromPath, courseSourceEmbedPrefix } from './course-source.js';

const CHUNK_SIZE = 1600;

/** Leading punctuation from a mid-sentence chunk or line break (transcript/PDF artifacts). */
const ORPHAN_LEAD_RE = /^(?:"\s*)?(\.{1,3}|[,;:])\s*/;
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/;

/**
 * Join line breaks that split mid-sentence (e.g. "\n.all of a sudden" -> ". all of a sudden").
 * @param {string} text
 * @returns {string}
 */
export function repairTranscriptBreaks(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\n+(\.{1,3})\s*(?=[a-zA-Z"'(])/g, ' ')
    .replace(/\n+([,;:])\s*(?=[a-zA-Z"'(])/g, '$1 ');
}

/**
 * If text starts with orphan punctuation, return { prefix, rest }.
 * @param {string} text
 * @returns {{ prefix: string; rest: string }}
 */
export function splitOrphanLead(text) {
  const trimmed = String(text ?? '').trimStart();
  const leadMatch = trimmed.match(ORPHAN_LEAD_RE);
  if (!leadMatch) return { prefix: '', rest: text };
  const prefix = leadMatch[0];
  const rest = trimmed.slice(prefix.length);
  return { prefix, rest };
}

/**
 * @param {string} previous
 * @param {string} prefix
 * @returns {string}
 */
function attachOrphanToPrevious(previous, prefix) {
  const trimmedPrefix = prefix.trimEnd();
  if (/[.!?]$/.test(previous.trimEnd()) && /^\.+$/.test(trimmedPrefix.trim())) {
    return previous.trimEnd();
  }
  return `${previous.trimEnd()}${trimmedPrefix}`;
}

/**
 * Move orphan leading punctuation from chunk starts onto the previous chunk.
 * Strips orphan lead from the first chunk when there is nothing to attach to.
 * @param {string[]} chunks
 * @returns {string[]}
 */
export function normalizeChunkBoundaries(chunks) {
  if (chunks.length === 0) return chunks;

  const out = [];
  let firstRest = splitOrphanLead(chunks[0]).rest.trimStart();
  if (firstRest) out.push(firstRest);

  for (let i = 1; i < chunks.length; i++) {
    let piece = chunks[i];
    while (piece) {
      const { prefix, rest } = splitOrphanLead(piece);
      if (!prefix) {
        if (piece.trim()) out.push(piece.trim());
        break;
      }
      if (out.length === 0) {
        piece = rest.trimStart();
        continue;
      }
      out[out.length - 1] = attachOrphanToPrevious(out[out.length - 1], prefix);
      piece = rest.trimStart();
      if (!piece) break;
    }
  }

  return out.filter(Boolean);
}

/**
 * @param {string} paragraph
 * @returns {string[]}
 */
function sentencesFromParagraph(paragraph) {
  const parts = paragraph
    .split(SENTENCE_BOUNDARY)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [paragraph.trim()];
}

/**
 * @param {string} text
 * @param {number} maxSize
 * @returns {string[]}
 */
function hardSplit(text, maxSize) {
  const parts = [];
  let rest = text.trim();
  while (rest.length > maxSize) {
    let cut = rest.lastIndexOf(' ', maxSize);
    if (cut <= 0) cut = maxSize;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts.length ? parts : [text.trim()];
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function chunkText(text) {
  const normalized = repairTranscriptBreaks(text);
  const paragraphs = normalized.split(/\n\s*\n/).filter((p) => p.trim());
  const units = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_SIZE) {
      units.push(...sentencesFromParagraph(paragraph));
    } else {
      units.push(paragraph);
    }
  }

  const chunks = [];
  let current = '';

  for (const unit of units) {
    const separator = current ? '\n\n' : '';

    if (unit.length > CHUNK_SIZE) {
      if (current.trim()) {
        chunks.push(current.trim());
        current = '';
      }
      chunks.push(...hardSplit(unit, CHUNK_SIZE));
      continue;
    }

    if (current.length + separator.length + unit.length > CHUNK_SIZE && current.length > 0) {
      chunks.push(current.trim());
      current = unit;
    } else {
      current += separator + unit;
    }
  }

  if (current.trim()) chunks.push(current.trim());

  if (chunks.length === 0 && normalized.trim()) {
    chunks.push(normalized.trim().slice(0, CHUNK_SIZE * 2));
  }

  return normalizeChunkBoundaries(chunks);
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
