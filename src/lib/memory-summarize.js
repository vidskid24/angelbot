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
- Do not store or repeat explicit terms or details about sexual abuse, sexual assault, sexual violation, rape, or similar. If prior summary or new excerpts mention these, rewrite to high-level wording only (e.g. "past trauma") and keep collaboration-relevant preferences — never the explicit phrasing or graphic detail.
- If the prior summary already contains those explicit terms, replace them with the high-level wording above in the updated document.
- Keep the full document under 900 words.
- Use concise prose or short bullets. Third person is fine ("They..." or use their name if known).
- Output ONLY the markdown document, no preamble.`;

const MEMORY_MAX_ATTEMPTS = 3;
const MEMORY_RETRY_DELAYS_MS = [5000, 15000];
/** Gemini 2.5 thinking can consume output budget; leave room for the markdown document. */
const MEMORY_MAX_OUTPUT_TOKENS = 8192;

/**
 * Phrases aligned with SUMMARIZE_SYSTEM sensitive-trauma rules.
 * Applied to prior summary + transcript before Gemini (and to model output before save).
 * Longer phrases first so replacements do not overlap oddly.
 * @type {Array<{ pattern: RegExp; replacement: string }>}
 */
const MEMORY_SENSITIVE_PHRASE_REPLACEMENTS = [
  { pattern: /sexual\s+abuse/gi, replacement: 'trauma' },
  { pattern: /sexual\s+assault/gi, replacement: 'trauma' },
  { pattern: /sexual\s+violation/gi, replacement: 'trauma' },
  { pattern: /\brape(?:d|s)?\b/gi, replacement: 'trauma' },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Redact sensitive trauma phrases so Gemini does not reject the request as PROHIBITED_CONTENT.
 * Does not change live chat — only text sent to / saved from the nightly summarizer.
 * @param {string} text
 * @returns {string}
 */
export function sanitizeMemoryTextForSummarizer(text) {
  let out = String(text || '');
  for (const { pattern, replacement } of MEMORY_SENSITIVE_PHRASE_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * @param {{ priorSummary: string; transcript: string; userLabel?: string }} input
 * @returns {{ priorSummary: string; transcript: string; userLabel?: string }}
 */
function sanitizeMemorySummarizeInput(input) {
  return {
    ...input,
    priorSummary: sanitizeMemoryTextForSummarizer(input.priorSummary),
    transcript: sanitizeMemoryTextForSummarizer(input.transcript),
  };
}

/**
 * @param {{ priorSummary: string; transcript: string; userLabel?: string }} input
 * @param {{ shortenTranscript?: boolean; enforceHeadings?: boolean }} [opts]
 * @returns {string}
 */
function buildMemorySummarizePrompt(
  { priorSummary, transcript, userLabel = 'this user' },
  opts = {}
) {
  let body = String(transcript || '').trim() || '(no new messages)';
  if (opts.shortenTranscript && body.length > 3500) {
    body = `${body.slice(0, 3500)}\n\n[...transcript truncated for retry...]`;
  }
  const closing = opts.enforceHeadings
    ? 'Produce the updated memory document. You MUST include these exact headings: ## Work context, ## Personal context, ## How to work with me, ## Top of mind, ## Brief history.'
    : 'Produce the updated memory document.';
  return (
    `User: ${userLabel}\n\n` +
    `Prior memory summary:\n${priorSummary.trim() || '(none yet)'}\n\n` +
    `New conversation excerpts (oldest first):\n${body}\n\n` +
    closing
  );
}

/**
 * Classify empty/blocked Gemini failures for clearer cron logs and metrics.
 * @param {unknown} err
 * @returns {string}
 */
function classifyMemoryApiError(err) {
  const msg = String(err?.message || err || '');
  const finish = String(err?.finishReason || '');
  const block = String(err?.blockReason || '');
  const combined = `${finish} ${block} ${msg}`.toUpperCase();
  if (combined.includes('SAFETY') || combined.includes('BLOCK')) return 'safety_blocked';
  if (combined.includes('MAX_TOKENS')) return 'max_tokens_empty';
  if (err?.code === 'empty_gemini_response' || msg.includes('Empty Gemini response')) {
    return 'empty_response';
  }
  return 'api_error';
}

/**
 * @param {{ priorSummary: string; transcript: string; userLabel?: string }} input
 * @returns {Promise<{ ok: true; summary: string; attempt: number } | { ok: false; reason: string; error?: unknown }>}
 */
export async function generateMemorySummaryWithRetry(input) {
  const safeInput = sanitizeMemorySummarizeInput(input);
  const attempts = [
    { model: getGeminiChatModel(), temperature: 0.4 },
    { model: getGeminiFallbackChatModel(), temperature: 0.35 },
    { model: getGeminiFallbackChatModel(), temperature: 0.25 },
  ];

  let lastReason = 'unknown';
  let lastError = null;
  let sawMaxTokensEmpty = false;
  let sawMissingHeadings = false;

  for (let i = 0; i < MEMORY_MAX_ATTEMPTS; i++) {
    if (i > 0) await sleep(MEMORY_RETRY_DELAYS_MS[i - 1] ?? 15000);
    const { model, temperature } = attempts[i] ?? attempts[attempts.length - 1];
    const userPrompt = buildMemorySummarizePrompt(safeInput, {
      shortenTranscript: sawMaxTokensEmpty && i > 0,
      enforceHeadings: sawMissingHeadings && i > 0,
    });
    try {
      const text = await generateTextStrict({
        model,
        systemInstruction: SUMMARIZE_SYSTEM,
        userPrompt,
        temperature,
        maxOutputTokens: MEMORY_MAX_OUTPUT_TOKENS,
      });
      const sanitized = sanitizeMemoryTextForSummarizer(text);
      const rejection = getMemorySummaryRejectionReason(sanitized);
      if (!rejection) {
        return { ok: true, summary: sanitized, attempt: i + 1 };
      }
      lastReason = rejection;
      if (rejection === 'missing_headings') sawMissingHeadings = true;
      console.warn(
        `Memory summary rejected for ${input.userLabel || 'user'} ` +
          `(attempt ${i + 1}/${MEMORY_MAX_ATTEMPTS}, model=${model}): ${rejection}`
      );
    } catch (err) {
      lastError = err;
      lastReason = classifyMemoryApiError(err);
      if (lastReason === 'max_tokens_empty') sawMaxTokensEmpty = true;
      console.warn(
        `Memory summary API error for ${input.userLabel || 'user'} ` +
          `(attempt ${i + 1}/${MEMORY_MAX_ATTEMPTS}, model=${model}):`,
        err?.message || err
      );
      // Same sanitized payload will keep failing; do not burn remaining attempts.
      if (lastReason === 'safety_blocked') break;
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
