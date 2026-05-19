import { chat } from './gemini.js';
import { emptyMemorySummaryTemplate } from './user-memory.js';

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
- Focus on work, MA journey, preferences, ongoing themes, and how to collaborate well.
- Under Brief history / Recent months, note patterns from the past few months when visible.
- Do not store passwords, payment details, or clinical diagnoses.
- Keep the full document under 900 words.
- Use concise prose or short bullets. Third person is fine ("They..." or use their name if known).
- Output ONLY the markdown document, no preamble.`;

/**
 * @param {{ priorSummary: string; transcript: string; userLabel?: string }} input
 * @returns {Promise<string>}
 */
export async function generateMemorySummary({ priorSummary, transcript, userLabel = 'this user' }) {
  const userPrompt =
    `User: ${userLabel}\n\n` +
    `Prior memory summary:\n${priorSummary.trim() || '(none yet)'}\n\n` +
    `New conversation excerpts (oldest first):\n${transcript.trim() || '(no new messages)'}\n\n` +
    'Produce the updated memory document.';

  const text = await chat([
    { role: 'system', content: SUMMARIZE_SYSTEM },
    { role: 'user', content: userPrompt },
  ]);
  const out = String(text || '').trim();
  return out || emptyMemorySummaryTemplate();
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
