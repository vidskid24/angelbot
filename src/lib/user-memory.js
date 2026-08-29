/**
 * User memory blocks for system prompt and empty summary template.
 */

export const MEMORY_SUMMARY_SECTIONS = [
  'Work context',
  'Personal context',
  'How to work with me',
  'Top of mind',
  'Brief history',
];

export function emptyMemorySummaryTemplate() {
  return (
    '## Work context\n\n\n' +
    '## Personal context\n\n\n' +
    '## How to work with me\n\n\n' +
    '## Top of mind\n\n\n' +
    '## Brief history\n' +
    '### Recent months\n\n'
  );
}

/**
 * @param {{ memoryInstructions?: string; memorySummary?: string }} mem
 * @returns {string}
 */
export function buildUserMemoryPromptBlock(mem) {
  const instructions = String(mem?.memoryInstructions || '').trim();
  const summary = String(mem?.memorySummary || '').trim();
  if (!instructions && !summary) return '';

  let block = '## What Omi knows about this user (paid memory — apply across all conversations)\n';
  block += 'Reference when relevant; do not recite verbatim unless they ask.\n';
  if (instructions) {
    block += '\n### What they asked you to know\n' + instructions + '\n';
  }
  if (summary) {
    block += '\n### Summary from their conversations\n' + summary + '\n';
  }
  block += '\nHonor this context while following all roles, boundaries, and grounding rules.';
  return block;
}
