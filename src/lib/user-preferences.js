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

/** @type {Record<string, string>} */
const TONE_BLOCKS = {
  warm: `## Tone for this user (MANDATORY)
**Selected: Warm and companionable.**

How every reply should sound:
- Steady, gentle, and unhurried — like a calm friend holding space in the field.
- Soft reflective openings; unhurried pacing; no punchy quips or jokey asides.
- Stay grounded and kind; do not sound brisk, clinical, or overly formal.`,

  playful: `## Tone for this user (MANDATORY)
**Selected: Playful and lighthearted.**

How every reply should sound — this must be **noticeably different** from your default companion voice:
- Lighter and brighter: warm **with sparkle** — curious, breezy, gently humorous when it fits.
- Use vivid, everyday metaphors and varied rhythm; short lively sentences are welcome.
- Wordplay and gentle wit are encouraged (never at the user's expense, never mocking).
- Openings can feel inviting and a bit bright (e.g. name what's present with ease and curiosity).
- Choice-gate closings may sound casual (e.g. "Want to stay with this a bit longer, or try a small experiment?") — unless the user has clearly signaled they are done; then close warmly without a question.
- If the topic is grief, fear, trauma, or crisis: soften playfulness immediately and lead with presence first.
- **Do not** sound solemn, stiff, textbook-like, or heavily formal in ordinary exchanges.`,

  concise: `## Tone for this user (MANDATORY)
**Selected: Concise and direct.**

How every reply should sound:
- Shorter paragraphs; fewer repetitions; one clear idea per beat when possible.
- Get to the point quickly while staying kind; skip long preambles.
- Do not ramble or stack multiple metaphors unless the user asks for more depth.`,
};

const MA_EXPERIENCE_INSTRUCTIONS = {
  new:
    '**MA familiarity:** New to Mastering Alchemy — define terms briefly when you use them, favor foundational concepts, and avoid deep multi-layer framework unless they ask or show readiness.',
  some_experience:
    '**MA familiarity:** Some experience — balanced depth; brief definitions only when introducing something new.',
  long_time:
    '**MA familiarity:** Long-time participant — they know the basics; you may go deeper into field mechanics, rays, and advanced material when relevant, without lecturing.',
};

/**
 * Appended last in the system prompt so tone overrides the base persona and RAG style.
 * @param {{ tone: string; maExperience: string }} prefs
 * @returns {string}
 */
export function buildUserPreferencesPromptBlock(prefs) {
  const { tone, maExperience } = normalizePreferences(prefs);
  const toneBlock = TONE_BLOCKS[tone] || TONE_BLOCKS[DEFAULT_TONE];
  const maBlock = MA_EXPERIENCE_INSTRUCTIONS[maExperience] || MA_EXPERIENCE_INSTRUCTIONS[DEFAULT_MA_EXPERIENCE];

  return (
    `${toneBlock}\n\n${maBlock}\n\n` +
    '**Priority:** These tone rules override the general companion voice and any retrieved material\'s tone. ' +
    'Roles, boundaries, formatting, and factual grounding still apply. ' +
    'If earlier turns in this thread used a different voice, **shift to the selected tone now**.'
  );
}
