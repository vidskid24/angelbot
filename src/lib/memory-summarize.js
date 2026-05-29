import {
  generateTextStrict,
  getGeminiChatModel,
  getGeminiFallbackChatModel,
} from './gemini.js';
import {
  getMemorySummaryRejectionReason,
} from './memory-summary-validate.js';

const SUMMARIZE_SYSTEM = `You maintain a memory summary for Omi, a Mastering Alchemy companion chatbot.
You will receive prior summary (if any) and new conversation excerpts from one user.

Write an updated memory document in markdown with EXACTLY these sections and headings:

## Work context
## Personal context
## How to work with me
## Top of mind
## Brief history
### Recent months

Rules:
- Merge prior summary with new information; do not duplicate bullets.
- The prior summary may include user edits; keep their intent and wording where still accurate.
- Focus on work, MA journey, preferences, ongoing themes, and how to collaborate well.
- Under Brief history / Recent months, note patterns from the past few months when visible.
- Do not store passwords, payment details, or clinical diagnoses.
- Keep the full document under 900 words.
- Use concise prose or short bullets. Third person is fine ("They..." or use their name if known).
- Output ONLY the markdown document, no preamble.`;

const MEMORY_MAX_ATTEMPTS = 3;
const MEMORY_RETRY_DELAYS_MS = [5000, 15000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {{ priorSummary: string; transcript: string; userLabel?: string }} input
 * @returns {string}
 */
function buildMemorySummarizePrompt({ priorSummary, transcript, userLabel = 'this user' }) {
  return (
    `User: ${userLabel}\n\n` +
    `Prior memory summary:\n${priorSummary.trim() || '(none yet)'}\n\n` +
    `New conversation excerpts (oldest first):\n${transcript.trim() || '(no new messages)'}\n\n` +
    'Produce the updated memory document.'
  );
}

/**
 * @param {{ priorSummary: string; transcript: string; userLabel?: string }} input
 * @returns {Promise<{ ok: true; summary: string; attempt: number } | { ok: false; reason: string; error?: unknown }>}
 */
export async function generateMemorySummaryWithRetry(input) {
  const userPrompt = buildMemorySummarizePrompt(input);
  const attempts = [
    { model: getGeminiChatModel(), temperature: 0.4 },
    { model: getGeminiFallbackChatModel(), temperature: 0.35 },
    { model: getGeminiFallbackChatModel(), temperature: 0.25 },
  ];

  let lastReason = 'unknown';
  let lastError = null;

  for (let i = 0; i < MEMORY_MAX_ATTEMPTS; i++) {
    if (i > 0) await sleep(MEMORY_RETRY_DELAYS_MS[i - 1] ?? 15000);
    const { model, temperature } = attempts[i] ?? attempts[attempts.length - 1];
    try {
      const text = await generateTextStrict({
        model,
        systemInstruction: SUMMARIZE_SYSTEM,
        userPrompt,
        temperature,
      });
      const rejection = getMemorySummaryRejectionReason(text);
      if (!rejection) {
        return { ok: true, summary: text, attempt: i + 1 };
      }
      lastReason = rejection;
      console.warn(
        `Memory summary rejected for ${input.userLabel || 'user'} ` +
          `(attempt ${i + 1}/${MEMORY_MAX_ATTEMPTS}, model=${model}): ${rejection}`
      );
    } catch (err) {
      lastError = err;
      lastReason = 'api_error';
      console.warn(
        `Memory summary API error for ${input.userLabel || 'user'} ` +
          `(attempt ${i + 1}/${MEMORY_MAX_ATTEMPTS}, model=${model}):`,
        err?.message || err
      );
    }
  }

  return { ok: false, reason: lastReason, error: lastError };
}

/**
 * @param {{ priorSummary: string; transcript: string; userLabel?: string }} input
 * @returns {Promise<string>}
 */
export async function generateMemorySummary(input) {
  const result = await generateMemorySummaryWithRetry(input);
  if (result.ok) return result.summary;
  throw result.error || new Error(`Memory summary failed: ${result.reason}`);
}

/**
 * @param {Array<{ role: string; content: string; threadTitle?: string }>} messages
 * @returns {string}
 */
export function formatMessagesForSummarizer(messages) {
  return messages
    .map((m) => {
      const who = m.role === 'assistant' ? 'Omi' : 'User';
      const title = m.threadTitle ? ` [${m.threadTitle}]` : '';
      const body = String(m.content || '').slice(0, 1500);
      return `${who}${title}: ${body}`;
    })
    .join('\n\n');
}
