/**
 * User-facing preference enums and system-prompt instructions.
 */

export const TONE_VALUES = ['warm', 'playful', 'concise'];
export const MA_EXPERIENCE_VALUES = ['new', 'some_experience', 'long_time'];

export const DEFAULT_TONE = 'warm';
export const DEFAULT_MA_EXPERIENCE = 'some_experience';

/**
 * @param {unknown} value
 * @returns {value is typeof DEFAULT_TONE}
 */
export function isValidTone(value) {
  return typeof value === 'string' && TONE_VALUES.includes(value);
}

/**
 * @param {unknown} value
 * @returns {value is typeof DEFAULT_MA_EXPERIENCE}
 */
export function isValidMaExperience(value) {
  return typeof value === 'string' && MA_EXPERIENCE_VALUES.includes(value);
}

/**
 * @param {{ tone?: string; maExperience?: string }} raw
 * @returns {{ tone: string; maExperience: string }}
 */
export function normalizePreferences(raw = {}) {
  let tone = raw.tone;
  if (tone === 'professional') tone = 'warm';
  return {
    tone: isValidTone(tone) ? tone : DEFAULT_TONE,
    maExperience: isValidMaExperience(raw.maExperience) ? raw.maExperience : DEFAULT_MA_EXPERIENCE,
  };
}

const TONE_INSTRUCTIONS = {
  warm:
    'Warm and companionable — conversational, gentle, and inviting. Lead with presence and curiosity; wisdom follows naturally.',
  playful:
    'Playful and lighthearted — warm, curious, and gently humorous when it fits; keep wisdom grounded and never flippant about their experience.',
  concise:
    'Concise and direct — shorter paragraphs, fewer repetitions, get to the point while staying kind and grounded.',
};

const MA_EXPERIENCE_INSTRUCTIONS = {
  new:
    'New to Mastering Alchemy — define terms briefly when you use them, favor foundational concepts, and avoid deep multi-layer framework unless they ask or show readiness.',
  some_experience:
    'Some experience with Mastering Alchemy — balanced depth; brief definitions only when introducing something new.',
  long_time:
    'Long-time participant in Mastering Alchemy — they know the basics; you may go deeper into field mechanics, rays, and advanced material when relevant, without lecturing or assuming the role of teacher.',
};

/**
 * Short block appended to the system prompt (keep compact for token budget).
 * @param {{ tone: string; maExperience: string }} prefs
 * @returns {string}
 */
export function buildUserPreferencesPromptBlock(prefs) {
  const { tone, maExperience } = normalizePreferences(prefs);
  return (
    '## This user\'s preferences (apply to every reply)\n' +
    `- **Tone:** ${TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS[DEFAULT_TONE]}\n` +
    `- **MA familiarity:** ${MA_EXPERIENCE_INSTRUCTIONS[maExperience] || MA_EXPERIENCE_INSTRUCTIONS[DEFAULT_MA_EXPERIENCE]}\n` +
    'Honor these preferences while still following all roles, boundaries, and formatting rules above.'
  );
}
