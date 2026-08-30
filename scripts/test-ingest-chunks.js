/**
 * Smoke tests for RAG chunk boundary normalization.
 * Run: node scripts/test-ingest-chunks.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkText,
  normalizeChunkBoundaries,
  repairTranscriptBreaks,
  splitOrphanLead,
} from '../src/rag/ingest-chunks.js';

test('repairTranscriptBreaks joins mid-sentence line breaks', () => {
  const raw = 'The Teachers pause here.\n.all of a sudden the color shifts.';
  assert.equal(
    repairTranscriptBreaks(raw),
    'The Teachers pause here. all of a sudden the color shifts.'
  );
});

test('splitOrphanLead detects leading period fragment', () => {
  assert.deepEqual(splitOrphanLead('.all of a sudden'), {
    prefix: '.',
    rest: 'all of a sudden',
  });
});

test('normalizeChunkBoundaries attaches orphan lead to previous chunk', () => {
  const out = normalizeChunkBoundaries([
    'Teachers describe the blue code.',
    '.all of a sudden you feel it in your body.',
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0], 'Teachers describe the blue code.');
  assert.match(out[1], /^all of a sudden/);
});

test('chunkText does not start later chunks with orphan punctuation', () => {
  const filler = 'Word '.repeat(350).trim();
  const text = `${filler} End of first part.\n\n.all of a sudden the light changes.`;
  const chunks = chunkText(text);
  assert.ok(chunks.length >= 2);
  for (let i = 1; i < chunks.length; i++) {
    assert.equal(splitOrphanLead(chunks[i]).prefix, '', chunks[i].slice(0, 40));
  }
});

test('chunkText splits long paragraphs at sentence boundaries', () => {
  const sentences = Array.from(
    { length: 80 },
    (_, i) => `Sentence number ${i + 1} ends here with extra words for length.`
  ).join(' ');
  const chunks = chunkText(sentences);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.equal(splitOrphanLead(chunk).prefix, '', chunk.slice(0, 30));
  }
});
