/**
 * Parse Mastering Alchemy course media filenames from Dropbox / style guides.
 *
 * Supported patterns:
 * - L1-C1-T2-Clear Your Energy.txt   — Level, Chapter, audio Track #
 * - L1-C1-V-GroundingCord.txt        — Level, Chapter, Video
 * - L1-C1-S4-Session Title.txt       — Level, Chapter, Session #
 * - L2-S3-Q&A Clairvoyance.txt      — Level, session Q&A / supplement track
 * - L3-S1a-TFull.txt / L3-S1a-TKuthumi.txt — Level 3+ session tracks (optional "a")
 * - ETPF-S1-Star Tetrahedron-Electric Blue.txt — Enter the Present Future session
 * - CFWATI-S1-Being Conscious in the Cell and Particle.txt — Creating From Within All That Is
 * - LWTLB-S1-Complete.txt — Living Within The Light Body
 * - R3-S1-Love in the StarTetrahedron.txt — Reset 3
 * - R2-S1-Imagination.txt — Reset 2
 * - R1-S1-Merging Layers of Consciousness.txt — Reset 1
 * - ML1-C1-S1.txt — Mastery Live (chapter / session)
 * - 2011-Conf-D1-AM.txt — Annual conferences (ConfA/ConfB for multi-venue years)
 * - ACIMA-final.pdf                  — Book (non L#-prefixed PDFs)
 */

import { basename, extname } from 'path';

/**
 * @typedef {'class-session' | 'class-track' | 'class-video' | 'class-chapter' | 'level-session' | 'level-session-full' | 'level-session-supplement' | 'book'} CourseUnitType
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
const CLASS_CHAPTER_RE = new RegExp(
  `^L(\\d+)-C(\\d+)-(?!T\\d+-|V-|S\\d+-)(.+)\\.${EXT_RE}$`,
  'i'
);
const LEVEL_SESSION_QA_RE = new RegExp(`^L(\\d+)-S(\\d+)a?-Q&A (.+)\\.${EXT_RE}$`, 'i');
const LEVEL_SESSION_QA_ONLY_RE = new RegExp(`^L(\\d+)-S(\\d+)a?-Q&A\\.${EXT_RE}$`, 'i');
const LEVEL_SESSION_FULL_RE = new RegExp(`^L(\\d+)-S(\\d+)a?-TFull\\.${EXT_RE}$`, 'i');
const LEVEL_SESSION_NAMED_RE = new RegExp(`^L(\\d+)-S(\\d+)a?-(.+)\\.${EXT_RE}$`, 'i');
const LEVEL_EXTRA_RE = new RegExp(`^L(\\d+)-Extra-(.+)\\.${EXT_RE}$`, 'i');
const ETPF_SUGGESTED_RE = new RegExp(`^ETPF-Suggested Classes-(.+)\\.${EXT_RE}$`, 'i');
const ETPF_SESSION_RE = new RegExp(`^ETPF-S(\\d+)-(.+)\\.${EXT_RE}$`, 'i');
const CFWATI_BONUS_RE = new RegExp(`^CFWATI-BONUS-(.+)\\.${EXT_RE}$`, 'i');
const CFWATI_LISTEN_BEFORE_RE = new RegExp(`^CFWATI-Listen Before-(.+)\\.${EXT_RE}$`, 'i');
const CFWATI_SESSION_RE = new RegExp(`^CFWATI-S(\\d+)-(.+)\\.${EXT_RE}$`, 'i');
const LWTLB_BONUS_RE = new RegExp(`^LWTLB-Bonus Material-(.+)\\s*\\.${EXT_RE}$`, 'i');
const LWTLB_FOUNDATION_RE = new RegExp(`^LWTLB-Setting the Foundation-(.+)\\s*\\.${EXT_RE}$`, 'i');
const LWTLB_SUPPORTING_RE = new RegExp(
  `^LWTLB-S(\\d+)-Supporting Material-(.+)\\s*\\.${EXT_RE}$`,
  'i'
);
const LWTLB_SESSION_RE = new RegExp(`^LWTLB-S(\\d+)-\\s*(.+)\\s*\\.${EXT_RE}$`, 'i');
const R3_SESSION_RE = new RegExp(`^R3-S(\\d+)-\\s*(.+)\\s*\\.${EXT_RE}$`, 'i');
const R2_SPECIAL_RE = new RegExp(`^R2-Special-(.+)\\s*\\.${EXT_RE}$`, 'i');
const R2_SESSION_RE = new RegExp(`^R2-S(\\d+)-\\s*(.+)\\s*\\.${EXT_RE}$`, 'i');
const R1_WELCOME_RE = new RegExp(`^R1-Welcome-(.+)\\s*\\.${EXT_RE}$`, 'i');
const R1_BONUS_RE = new RegExp(`^R1-Bonus Material-(.+)\\s*\\.${EXT_RE}$`, 'i');
const R1_ADDITIONAL_RE = new RegExp(`^R1-Additional Material-(.+)\\s*\\.${EXT_RE}$`, 'i');
const R1_SESSION_RE = new RegExp(`^R1-S(\\d+)-\\s*(.+)\\s*\\.${EXT_RE}$`, 'i');
const ML_SESSION_RE = new RegExp(
  `^ML(\\d+)-C(\\d+)-S(\\d+)(?:-\\s*(.+))?\\s*\\.${EXT_RE}$`,
  'i'
);
const CONF_RE = new RegExp(`^(\\d{4})-Conf([AB])?-(.+)\\.${EXT_RE}$`, 'i');
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
 * Catalog unit key for a named session track (e.g. L2-S4-ChairExercise).
 * @param {string} levelCode
 * @param {string} sessionCode
 * @param {string} title
 * @returns {string}
 */
function sessionTrackCatalogKey(levelCode, sessionCode, title) {
  const normalized = normalizeTitle(title);
  const compact = normalized.replace(/[\s&]+/g, '');
  // Filenames use TQ&A / TQA; catalog keys are often …-TQA or …-QA.
  if (/^t?qa\d*$/i.test(compact)) {
    const num = compact.match(/(\d+)$/);
    return num
      ? `${levelCode}-${sessionCode}-TQA${num[1]}`
      : `${levelCode}-${sessionCode}-TQA`;
  }
  if (/^q&a$/i.test(normalized)) return `${levelCode}-${sessionCode}-QA`;
  const slug = normalized.replace(/[^a-z0-9]+/gi, '');
  return `${levelCode}-${sessionCode}-${slug}`;
}

/**
 * Friendly display title for track filenames like TMetatron, TQ&A, TFull.
 * @param {string} raw
 * @returns {string}
 */
export function humanizeTrackTitle(raw) {
  let t = normalizeTitle(raw);
  if (!t) return '';
  const compact = t.replace(/[\s&]+/g, '');
  if (/^t?qa\d*$/i.test(compact)) {
    const num = compact.match(/(\d+)$/);
    return num ? `Q&A ${num[1]}` : 'Q&A';
  }
  if (/^tfull$/i.test(compact)) return 'Full session';
  if (/^T[A-Z]/.test(t) && t.length > 2) {
    t = t.slice(1);
  }
  return t;
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
 * Friendly title from the segment after YYYY-Conf / YYYY-ConfA.
 * @param {string} rest
 * @returns {string}
 */
function formatConferenceSegmentTitle(rest) {
  let s = normalizeTitle(rest);
  if (!s) return '';

  if (/^FollowUp\b/i.test(s)) {
    const tail = s.replace(/^FollowUp/i, '').replace(/-/g, ' ');
    return normalizeTitle(`Follow-Up${tail}`);
  }
  if (/^PreConf\b/i.test(s)) {
    const tail = s.replace(/^PreConf/i, '').replace(/-/g, ' ');
    return normalizeTitle(`Pre-Conference${tail}`);
  }

  // D1-AM, D1 -PM2, D2-PM-QA, D3-Full, D1-AM1
  s = s.replace(/^D(\d+)\s*-?\s*/i, 'Day $1 ');
  s = s.replace(/-/g, ' ');
  return normalizeTitle(s);
}

/**
 * Annual conferences: 2011-Conf-D1-AM.txt, 2024-ConfA-D1-AM1.txt, 2025-Conf-PreConf-1.txt.
 * @param {string} filename
 * @returns {CourseSource | null}
 */
function parseConfSource(filename) {
  const m = CONF_RE.exec(filename);
  if (!m) return null;

  const year = m[1];
  const venue = m[2] ? String(m[2]).toUpperCase() : '';
  const rest = normalizeTitle(m[3]);
  if (!rest) return null;

  const levelCode = venue ? `Conf${year}${venue}` : `Conf${year}`;
  const title = formatConferenceSegmentTitle(rest);
  if (!title) return null;

  const restSlug = rest.replace(/[^a-z0-9]+/gi, '');
  const sessionKey = `${levelCode}-${restSlug}`;

  return {
    levelCode,
    unitType: 'level-session-supplement',
    unitCode: sessionKey,
    mediaType: 'audio',
    sessionKey,
    title,
    sessionTitle: title,
    filename,
  };
}

/**
 * Mastery Live: ML1-C1-S1.txt (optional descriptive suffix).
 * @param {string} filename
 * @returns {CourseSource | null}
 */
function parseMlSource(filename) {
  const m = ML_SESSION_RE.exec(filename);
  if (!m) return null;

  const series = Number(m[1]);
  const classNum = Number(m[2]);
  const session = Number(m[3]);
  const descriptive = normalizeTitle(m[4]);
  const title = descriptive || `Session ${session}`;
  const levelCode = `ML${series}`;
  const classCode = `C${classNum}`;
  const sessionCode = `S${session}`;
  const sessionKey = `${levelCode}-${classCode}-${sessionCode}`;

  return {
    levelCode,
    class: classNum,
    classCode,
    session,
    sessionCode,
    unitType: 'class-session',
    unitNumber: session,
    unitCode: sessionCode,
    mediaType: 'audio',
    sessionKey,
    title,
    sessionTitle: title,
    filename,
  };
}

/**
 * @param {string} filename
 * @returns {CourseSource | null}
 */
function parseR1Source(filename) {
  let m = R1_WELCOME_RE.exec(filename);
  if (m) {
    const title = normalizeTitle(m[1]);
    if (!title) return null;
    const sessionKey = sessionTrackCatalogKey('R1', 'Welcome', title);
    return {
      levelCode: 'R1',
      unitType: 'level-session-supplement',
      unitCode: sessionKey,
      mediaType: 'audio',
      sessionKey,
      title,
      sessionTitle: title,
      filename,
    };
  }

  m = R1_BONUS_RE.exec(filename);
  if (m) {
    const title = normalizeTitle(m[1]);
    if (!title) return null;
    const sessionKey = sessionTrackCatalogKey('R1', 'BonusMaterial', title);
    return {
      levelCode: 'R1',
      unitType: 'level-session-supplement',
      unitCode: sessionKey,
      mediaType: 'audio',
      sessionKey,
      title,
      sessionTitle: title,
      filename,
    };
  }

  m = R1_ADDITIONAL_RE.exec(filename);
  if (m) {
    const title = normalizeTitle(m[1]);
    if (!title) return null;
    const sessionKey = sessionTrackCatalogKey('R1', 'AdditionalMaterial', title);
    return {
      levelCode: 'R1',
      unitType: 'level-session-supplement',
      unitCode: sessionKey,
      mediaType: 'audio',
      sessionKey,
      title,
      sessionTitle: title,
      filename,
    };
  }

  m = R1_SESSION_RE.exec(filename);
  if (!m) return null;

  const session = Number(m[1]);
  const title = normalizeTitle(m[2]);
  if (!title) return null;
  const sessionCode = `S${session}`;
  const sessionKey = sessionTrackCatalogKey('R1', sessionCode, title);
  return {
    levelCode: 'R1',
    session,
    sessionCode,
    unitType: 'level-session-supplement',
    unitNumber: session,
    unitCode: sessionKey,
    mediaType: 'audio',
    sessionKey,
    title,
    sessionTitle: title,
    filename,
  };
}

/**
 * @param {string} filename
 * @returns {CourseSource | null}
 */
function parseR2Source(filename) {
  let m = R2_SPECIAL_RE.exec(filename);
  if (m) {
    const title = normalizeTitle(m[1]);
    if (!title) return null;
    const sessionKey = sessionTrackCatalogKey('R2', 'Special', title);
    return {
      levelCode: 'R2',
      unitType: 'level-session-supplement',
      unitCode: sessionKey,
      mediaType: 'audio',
      sessionKey,
      title,
      sessionTitle: title,
      filename,
    };
  }

  m = R2_SESSION_RE.exec(filename);
  if (!m) return null;

  const session = Number(m[1]);
  const title = normalizeTitle(m[2]);
  if (!title) return null;
  const sessionCode = `S${session}`;
  const sessionKey = sessionTrackCatalogKey('R2', sessionCode, title);
  return {
    levelCode: 'R2',
    session,
    sessionCode,
    unitType: 'level-session-supplement',
    unitNumber: session,
    unitCode: sessionKey,
    mediaType: 'audio',
    sessionKey,
    title,
    sessionTitle: title,
    filename,
  };
}

/**
 * @param {string} filename
 * @returns {CourseSource | null}
 */
function parseR3Source(filename) {
  const m = R3_SESSION_RE.exec(filename);
  if (!m) return null;

  const session = Number(m[1]);
  const title = normalizeTitle(m[2]);
  if (!title) return null;
  const sessionCode = `S${session}`;
  const sessionKey = sessionTrackCatalogKey('R3', sessionCode, title);
  return {
    levelCode: 'R3',
    session,
    sessionCode,
    unitType: 'level-session-supplement',
    unitNumber: session,
    unitCode: sessionKey,
    mediaType: 'audio',
    sessionKey,
    title,
    sessionTitle: title,
    filename,
  };
}

/**
 * @param {string} filename
 * @returns {CourseSource | null}
 */
function parseLwtlbSource(filename) {
  let m = LWTLB_BONUS_RE.exec(filename);
  if (m) {
    const title = normalizeTitle(m[1]);
    if (!title) return null;
    const sessionKey = sessionTrackCatalogKey('LWTLB', 'BonusMaterial', title);
    return {
      levelCode: 'LWTLB',
      unitType: 'level-session-supplement',
      unitCode: sessionKey,
      mediaType: 'audio',
      sessionKey,
      title,
      sessionTitle: title,
      filename,
    };
  }

  m = LWTLB_FOUNDATION_RE.exec(filename);
  if (m) {
    const title = normalizeTitle(m[1]);
    if (!title) return null;
    const sessionKey = sessionTrackCatalogKey('LWTLB', 'SettingtheFoundation', title);
    return {
      levelCode: 'LWTLB',
      unitType: 'level-session-supplement',
      unitCode: sessionKey,
      mediaType: 'audio',
      sessionKey,
      title,
      sessionTitle: title,
      filename,
    };
  }

  m = LWTLB_SUPPORTING_RE.exec(filename);
  if (m) {
    const session = Number(m[1]);
    const title = normalizeTitle(m[2]);
    if (!title) return null;
    const sessionCode = `S${session}`;
    const sessionKey = sessionTrackCatalogKey('LWTLB', `${sessionCode}-SupportingMaterial`, title);
    return {
      levelCode: 'LWTLB',
      session,
      sessionCode,
      unitType: 'level-session-supplement',
      unitNumber: session,
      unitCode: sessionKey,
      mediaType: 'audio',
      sessionKey,
      title,
      sessionTitle: title,
      filename,
    };
  }

  m = LWTLB_SESSION_RE.exec(filename);
  if (!m) return null;

  const session = Number(m[1]);
  const title = normalizeTitle(m[2]);
  if (!title) return null;
  const sessionCode = `S${session}`;
  const sessionKey = sessionTrackCatalogKey('LWTLB', sessionCode, title);
  return {
    levelCode: 'LWTLB',
    session,
    sessionCode,
    unitType: 'level-session-supplement',
    unitNumber: session,
    unitCode: sessionKey,
    mediaType: 'audio',
    sessionKey,
    title,
    sessionTitle: title,
    filename,
  };
}

/**
 * @param {string} filename
 * @returns {CourseSource | null}
 */
function parseCfwatiSource(filename) {
  let m = CFWATI_BONUS_RE.exec(filename);
  if (m) {
    const title = normalizeTitle(m[1]);
    if (!title) return null;
    const sessionKey = sessionTrackCatalogKey('CFWATI', 'BONUS', title);
    return {
      levelCode: 'CFWATI',
      unitType: 'level-session-supplement',
      unitCode: sessionKey,
      mediaType: 'audio',
      sessionKey,
      title,
      sessionTitle: title,
      filename,
    };
  }

  m = CFWATI_LISTEN_BEFORE_RE.exec(filename);
  if (m) {
    const title = normalizeTitle(m[1]);
    if (!title) return null;
    const sessionKey = sessionTrackCatalogKey('CFWATI', 'ListenBefore', title);
    return {
      levelCode: 'CFWATI',
      unitType: 'level-session-supplement',
      unitCode: sessionKey,
      mediaType: 'audio',
      sessionKey,
      title,
      sessionTitle: title,
      filename,
    };
  }

  m = CFWATI_SESSION_RE.exec(filename);
  if (!m) return null;

  const session = Number(m[1]);
  const title = normalizeTitle(m[2]);
  if (!title) return null;
  const sessionCode = `S${session}`;
  const sessionKey = sessionTrackCatalogKey('CFWATI', sessionCode, title);
  return {
    levelCode: 'CFWATI',
    session,
    sessionCode,
    unitType: 'level-session-supplement',
    unitNumber: session,
    unitCode: sessionKey,
    mediaType: /pdf/i.test(title) ? 'document' : 'audio',
    sessionKey,
    title,
    sessionTitle: title,
    filename,
  };
}

/**
 * @param {string} filename
 * @returns {CourseSource | null}
 */
function parseEtpfSource(filename) {
  let m = ETPF_SUGGESTED_RE.exec(filename);
  if (m) {
    const title = normalizeTitle(m[1]);
    if (!title) return null;
    const sessionKey = sessionTrackCatalogKey('ETPF', 'SuggestedClasses', title);
    return {
      levelCode: 'ETPF',
      unitType: 'level-session-supplement',
      unitCode: sessionKey,
      mediaType: 'audio',
      sessionKey,
      title,
      sessionTitle: title,
      filename,
    };
  }

  m = ETPF_SESSION_RE.exec(filename);
  if (!m) return null;

  const session = Number(m[1]);
  const title = normalizeTitle(m[2]);
  if (!title) return null;
  const sessionCode = `S${session}`;
  const sessionKey = sessionTrackCatalogKey('ETPF', sessionCode, title);
  return {
    levelCode: 'ETPF',
    session,
    sessionCode,
    unitType: 'level-session-supplement',
    unitNumber: session,
    unitCode: sessionKey,
    mediaType: /video/i.test(title) ? 'video' : 'audio',
    sessionKey,
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

  if (/^ETPF-/i.test(filename)) {
    return parseEtpfSource(filename);
  }
  if (/^CFWATI-/i.test(filename)) {
    return parseCfwatiSource(filename);
  }
  if (/^LWTLB-/i.test(filename)) {
    return parseLwtlbSource(filename);
  }
  if (/^R3-/i.test(filename)) {
    return parseR3Source(filename);
  }
  if (/^R2-/i.test(filename)) {
    return parseR2Source(filename);
  }
  if (/^R1-/i.test(filename)) {
    return parseR1Source(filename);
  }
  if (/^ML\d+-/i.test(filename)) {
    return parseMlSource(filename);
  }
  if (/^\d{4}-Conf/i.test(filename)) {
    return parseConfSource(filename);
  }

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

  m = LEVEL_SESSION_QA_RE.exec(filename);
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
      unitType: 'level-session-supplement',
      unitNumber: session,
      unitCode: 'QA',
      mediaType: 'audio',
      sessionKey: `${levelCode}-${sessionCode}-QA`,
      title,
      sessionTitle: title,
      filename,
    };
  }

  m = LEVEL_SESSION_QA_ONLY_RE.exec(filename);
  if (m) {
    const level = Number(m[1]);
    const session = Number(m[2]);
    const levelCode = `L${level}`;
    const sessionCode = `S${session}`;
    const title = 'Q&A';
    return {
      level,
      levelCode,
      session,
      sessionCode,
      unitType: 'level-session-supplement',
      unitNumber: session,
      unitCode: 'QA',
      mediaType: 'audio',
      sessionKey: `${levelCode}-${sessionCode}-QA`,
      title,
      sessionTitle: title,
      filename,
    };
  }

  m = LEVEL_SESSION_FULL_RE.exec(filename);
  if (m) {
    const level = Number(m[1]);
    const session = Number(m[2]);
    const levelCode = `L${level}`;
    const sessionCode = `S${session}`;
    return {
      level,
      levelCode,
      session,
      sessionCode,
      unitType: 'level-session-full',
      unitNumber: session,
      unitCode: sessionCode,
      mediaType: 'document',
      sessionKey: `${levelCode}-${sessionCode}`,
      title: 'TFull',
      sessionTitle: 'TFull',
      filename,
    };
  }

  m = LEVEL_SESSION_NAMED_RE.exec(filename);
  if (m) {
    const level = Number(m[1]);
    const session = Number(m[2]);
    const rawTitle = normalizeTitle(m[3]);
    if (!rawTitle) return null;
    const levelCode = `L${level}`;
    const sessionCode = `S${session}`;
    const title = humanizeTrackTitle(rawTitle);
    return {
      level,
      levelCode,
      session,
      sessionCode,
      unitType: 'level-session-supplement',
      unitNumber: session,
      unitCode: sessionTrackCatalogKey(levelCode, sessionCode, rawTitle),
      mediaType: 'audio',
      sessionKey: sessionTrackCatalogKey(levelCode, sessionCode, rawTitle),
      title,
      sessionTitle: title,
      filename,
    };
  }

  m = LEVEL_EXTRA_RE.exec(filename);
  if (m) {
    const level = Number(m[1]);
    let title = normalizeTitle(m[2]);
    if (!title) return null;
    title = title
      .replace(/QandA/gi, 'Q&A')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();
    const levelCode = `L${level}`;
    const sessionKey = sessionTrackCatalogKey(levelCode, 'Extra', m[2]);
    return {
      level,
      levelCode,
      sessionCode: 'Extra',
      unitType: 'level-session-supplement',
      unitCode: sessionKey,
      mediaType: 'audio',
      sessionKey,
      title,
      sessionTitle: title,
      filename,
    };
  }

  m = CLASS_CHAPTER_RE.exec(filename);
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
      unitType: 'class-chapter',
      unitCode: classCode,
      mediaType: 'document',
      sessionKey: `${levelCode}-${classCode}`,
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
    case 'class-session': {
      const course =
        source.level != null
          ? `Level ${source.level}`
          : source.levelCode || null;
      if (!course || source.class == null) return null;
      const genericSession = new RegExp(`^Session\\s*${source.unitNumber}$`, 'i').test(
        title
      );
      const base = `${course}, Chapter ${source.class}, Session ${source.unitNumber}`;
      return genericSession ? base : `${base} — "${title}"`;
    }
    case 'class-chapter':
      return `Level ${source.level}, Chapter ${source.class}`;
    case 'level-session-full':
      if (source.levelCode && source.level == null) {
        return `${source.levelCode}, Session ${source.unitNumber}`;
      }
      return `Level ${source.level}, Session ${source.unitNumber}`;
    case 'level-session-supplement':
      if (source.sessionCode === 'Extra') {
        const course =
          source.level != null ? `Level ${source.level}` : source.levelCode || null;
        return course ? `${course} — "${title}"` : `Extra — "${title}"`;
      }
      if (source.levelCode && source.level == null) {
        return `${source.levelCode}, Session ${source.unitNumber} — "${title}"`;
      }
      return (
        `Level ${source.level}, Session ${source.unitNumber}` +
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
