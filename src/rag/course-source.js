/**
 * Parse Mastering Alchemy course media filenames from Dropbox / style guides.
 *
 * Supported patterns:
 * - L1-C1-T2-Clear Your Energy.txt   — Level, Chapter, audio Track #
 * - L1-C1-V-GroundingCord.txt        — Level, Chapter, Video
 * - L1-C1-S4-Session Title.txt       — Level, Chapter, Session #
 * - L2-S2-TFull.txt                  — Level, Session/chapter (no class in name)
 * - ACIMA-final.pdf                  — Book (non L#-prefixed PDFs)
 */

import { basename, extname } from 'path';

/**
 * @typedef {'class-session' | 'class-track' | 'class-video' | 'level-session' | 'book'} CourseUnitType
 *
 * @typedef {{
 *   level?: number;
 *   levelCode?: string;
 *   class?: number;
 *   classCode?: string;
 *   session?: number;
 *   sessionCode?: string;
 *   unitType: CourseUnitType;
 *   unitNumber?: number;
 *   unitCode?: string;
 *   mediaType?: 'audio' | 'video' | 'document';
 *   sessionKey: string;
 *   title: string;
 *   sessionTitle: string;
 *   filename: string;
 * }} CourseSource
 */

const EXT_RE = '(txt|md|pdf)';

const CLASS_TRACK_RE = new RegExp(`^L(\\d+)-C(\\d+)-T(\\d+)-(.+)\\.${EXT_RE}$`, 'i');
const CLASS_VIDEO_RE = new RegExp(`^L(\\d+)-C(\\d+)-V-(.+)\\.${EXT_RE}$`, 'i');
const CLASS_SESSION_RE = new RegExp(`^L(\\d+)-C(\\d+)-S(\\d+)-(.+)\\.${EXT_RE}$`, 'i');
const LEVEL_SESSION_RE = new RegExp(`^L(\\d+)-S(\\d+)-(.+)\\.${EXT_RE}$`, 'i');

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeTitle(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * @param {string} filename
 * @returns {CourseSource | null}
 */
function parseBookSource(filename) {
  const ext = extname(filename).toLowerCase();
  if (ext !== '.pdf') return null;
  if (/^L\d/i.test(filename)) return null;

  const title = normalizeTitle(filename.replace(/\.[^.]+$/, ''));
  if (!title) return null;

  return {
    unitType: 'book',
    mediaType: 'document',
    sessionKey: `book:${title}`,
    title,
    sessionTitle: title,
    filename,
  };
}

/**
 * @param {string} filePathOrName
 * @returns {CourseSource | null}
 */
export function parseCourseSourceFromPath(filePathOrName) {
  const filename = basename(String(filePathOrName || '').trim());
  if (!filename) return null;

  let m = CLASS_TRACK_RE.exec(filename);
  if (m) {
    const level = Number(m[1]);
    const classNum = Number(m[2]);
    const track = Number(m[3]);
    const title = normalizeTitle(m[4]);
    if (!title) return null;
    const levelCode = `L${level}`;
    const classCode = `C${classNum}`;
    return {
      level,
      levelCode,
      class: classNum,
      classCode,
      unitType: 'class-track',
      unitNumber: track,
      unitCode: `T${track}`,
      mediaType: 'audio',
      sessionKey: `${levelCode}-${classCode}-T${track}`,
      title,
      sessionTitle: title,
      filename,
    };
  }

  m = CLASS_VIDEO_RE.exec(filename);
  if (m) {
    const level = Number(m[1]);
    const classNum = Number(m[2]);
    const title = normalizeTitle(m[3]);
    if (!title) return null;
    const levelCode = `L${level}`;
    const classCode = `C${classNum}`;
    return {
      level,
      levelCode,
      class: classNum,
      classCode,
      unitType: 'class-video',
      unitCode: 'V',
      mediaType: 'video',
      sessionKey: `${levelCode}-${classCode}-V`,
      title,
      sessionTitle: title,
      filename,
    };
  }

  m = CLASS_SESSION_RE.exec(filename);
  if (m) {
    const level = Number(m[1]);
    const classNum = Number(m[2]);
    const session = Number(m[3]);
    const title = normalizeTitle(m[4]);
    if (!title) return null;
    const levelCode = `L${level}`;
    const classCode = `C${classNum}`;
    const sessionCode = `S${session}`;
    return {
      level,
      levelCode,
      class: classNum,
      classCode,
      session,
      sessionCode,
      unitType: 'class-session',
      unitNumber: session,
      unitCode: sessionCode,
      mediaType: 'audio',
      sessionKey: `${levelCode}-${classCode}-${sessionCode}`,
      title,
      sessionTitle: title,
      filename,
    };
  }

  m = LEVEL_SESSION_RE.exec(filename);
  if (m) {
    const level = Number(m[1]);
    const session = Number(m[2]);
    const title = normalizeTitle(m[3]);
    if (!title) return null;
    const levelCode = `L${level}`;
    const sessionCode = `S${session}`;
    return {
      level,
      levelCode,
      session,
      sessionCode,
      unitType: 'level-session',
      unitNumber: session,
      unitCode: sessionCode,
      mediaType: 'audio',
      sessionKey: `${levelCode}-${sessionCode}`,
      title,
      sessionTitle: title,
      filename,
    };
  }

  return parseBookSource(filename);
}

/**
 * @param {CourseSource | null | undefined} source
 * @returns {string}
 */
function getTitle(source) {
  return normalizeTitle(source?.title || source?.sessionTitle || '');
}

/**
 * Human-readable location label for prompts and retrieval output.
 * @param {CourseSource | null | undefined} source
 * @returns {string | null}
 */
export function formatCourseSourceLabel(source) {
  if (!source?.sessionKey) return null;
  const title = getTitle(source);
  if (!title) return null;

  // Legacy chunks (pre unitType): level + class + session + sessionTitle
  if (!source.unitType && source.level != null && source.class != null && source.session != null) {
    return (
      `Level ${source.level}, Chapter ${source.class}, Session ${source.session}` +
      ` — "${getTitle(source)}"`
    );
  }

  switch (source.unitType) {
    case 'book':
      return `Book — "${title}"`;
    case 'class-track':
      return (
        `Level ${source.level}, Chapter ${source.class}, Track ${source.unitNumber}` +
        ` — "${title}"`
      );
    case 'class-video':
      return `Level ${source.level}, Chapter ${source.class}, Video — "${title}"`;
    case 'class-session':
      return (
        `Level ${source.level}, Chapter ${source.class}, Session ${source.unitNumber}` +
        ` — "${title}"`
      );
    case 'level-session':
      return `Level ${source.level}, Session ${source.unitNumber} — "${title}"`;
    default:
      return null;
  }
}

/**
 * @param {CourseSource | null | undefined} source
 * @returns {string}
 */
export function courseSourceEmbedPrefix(source) {
  const label = formatCourseSourceLabel(source);
  if (!label) return '';
  return `[Source: ${label} (${source.sessionKey})]\n\n`;
}

/**
 * @param {{ text: string; source?: CourseSource | null; sourcePath?: string }} chunk
 * @returns {string}
 */
export function formatRetrievedChunk(chunk) {
  const source =
    chunk.source ||
    (chunk.sourcePath ? parseCourseSourceFromPath(chunk.sourcePath) : null);
  const label = formatCourseSourceLabel(source);
  const body = String(chunk.text || '').trim();
  if (!body) return '';
  if (label) {
    return `--- Source: ${label} ---\n${body}`;
  }
  if (chunk.sourcePath) {
    return `--- Source: ${basename(chunk.sourcePath)} ---\n${body}`;
  }
  return body;
}
