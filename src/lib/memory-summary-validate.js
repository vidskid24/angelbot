import { emptyMemorySummaryTemplate } from './user-memory.js';

const REQUIRED_HEADINGS = ['## Work context', '## Personal context', '## How to work with me'];

/** Substrings from live-chat fallbacks that must never be saved as memory. */
const CHAT_FALLBACK_MARKERS = [
  'oops!',
  'hiccup connecting just now',
  'bump into a limit on my side',
  "here's a brief **summary** so we can keep moving",
  'which part would you like first: pattern, feeling, or practical experiment',
  "hi friend - i'm glad you're here in **presence**",
];

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isChatFallbackText(text) {
  const lower = String(text || '').trim().toLowerCase();
  if (!lower) return true;
  return CHAT_FALLBACK_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function isMostlyEmptyTemplate(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return true;
  const compact = trimmed.replace(/\s+/g, '');
  const templateCompact = emptyMemorySummaryTemplate().replace(/\s+/g, '');
  if (compact === templateCompact) return true;
  return compact.length < 80;
}

/**
 * @param {string} text
 * @returns {string | null} rejection reason, or null if valid
 */
export function getMemorySummaryRejectionReason(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 'empty_output';
  if (isChatFallbackText(trimmed)) return 'chat_fallback';
  if (isMostlyEmptyTemplate(trimmed)) return 'empty_template';
  for (const heading of REQUIRED_HEADINGS) {
    if (!trimmed.includes(heading)) return 'missing_headings';
  }
  if (trimmed.length < 120) return 'too_short';
  return null;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isValidMemorySummary(text) {
  return getMemorySummaryRejectionReason(text) === null;
}
