/**
 * Quick smoke test: widget heading parse + render (uses linkedom).
 * Run: node scripts/test-widget-headings.js
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import test from 'node:test';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

async function loadWidgetApi() {
  const { parseHTML } = await import('linkedom');
  const { window } = parseHTML('<!DOCTYPE html><html><body></body></html>');

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.OMIBOT_API_BASE = 'https://test.example';
  globalThis.__omiWidgetTest = null;

  let src = readFileSync(join(rootDir, 'embed/omi-chat-widget.js'), 'utf8');
  src = src.replace(
    /  if \(document\.readyState === 'loading'\) \{[\s\S]*?mount\(getOmiRootId\(\)\);\s*\n  \}\n\}\)\(\);/,
    `  globalThis.__omiWidgetTest = {
    appendFormattedContent,
    parseHeadingLine,
    isStrayMarkerLine,
    applyMessageBodyLayout,
  };
})();`
  );

  // eslint-disable-next-line no-new-func
  new Function(src)();

  const api = globalThis.__omiWidgetTest;
  if (!api) throw new Error('Failed to load widget test API');
  return { api, document: window.document };
}

function blockSummary(parent) {
  return [...parent.children].map((el) => {
    const heading = el.querySelector('[role="heading"]');
    return {
      class: el.className,
      text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 100),
      ariaLevel: heading ? heading.getAttribute('aria-level') : null,
    };
  });
}

test('widget heading smoke tests', async (t) => {
  let api;
  let document;
  try {
    ({ api, document } = await loadWidgetApi());
  } catch (err) {
    if (String(err?.message || err).includes("Cannot find package 'linkedom'")) {
      console.error('Missing linkedom. Run: npm install --no-save linkedom');
      process.exit(1);
    }
    throw err;
  }

  const { parseHeadingLine, isStrayMarkerLine, appendFormattedContent, applyMessageBodyLayout } =
    api;

  await t.test('parseHeadingLine detects ### titles', () => {
    assert.deepEqual(parseHeadingLine('### The Fourteenth Chakra'), {
      level: 3,
      text: 'The Fourteenth Chakra',
    });
    assert.deepEqual(parseHeadingLine('## Shorter'), { level: 2, text: 'Shorter' });
    assert.equal(parseHeadingLine('Plain paragraph.'), null);
    assert.equal(parseHeadingLine('---'), null);
  });

  await t.test('isStrayMarkerLine does not treat headings as stray', () => {
    assert.equal(isStrayMarkerLine('---'), true);
    assert.equal(isStrayMarkerLine('*'), true);
    assert.equal(isStrayMarkerLine('### Section'), false);
  });

  await t.test('appendFormattedContent renders heading blocks', () => {
    const parent = document.createElement('div');
    applyMessageBodyLayout(parent);

    const sample = [
      'Opening paragraph before the section.',
      '',
      '### Energetic Boundaries',
      '',
      'Body text after the heading.',
      '',
      '"This is a long quoted passage that should render as a block quote in the widget display layer."',
    ].join('\n');

    appendFormattedContent(parent, sample);
    const blocks = blockSummary(parent);

    assert.equal(
      blocks.length,
      4,
      `expected 4 blocks, got ${blocks.length}: ${JSON.stringify(blocks)}`
    );
    assert.equal(blocks[0].class, 'omibot-prose');
    assert.match(blocks[0].text, /Opening paragraph/);

    assert.equal(blocks[1].class, 'omibot-heading-wrap');
    assert.match(blocks[1].text, /Energetic Boundaries/);
    assert.equal(blocks[1].ariaLevel, '3');

    assert.equal(blocks[2].class, 'omibot-prose');
    assert.match(blocks[2].text, /Body text after/);

    assert.equal(blocks[3].class, 'omibot-quote-wrap');
  });

  await t.test('stray divider lines are dropped, headings kept', () => {
    const parent = document.createElement('div');
    appendFormattedContent(parent, ['Before', '---', '### Still Here', 'After'].join('\n'));
    const blocks = blockSummary(parent);
    const classes = blocks.map((b) => b.class);
    assert.deepEqual(classes, ['omibot-prose', 'omibot-heading-wrap', 'omibot-prose']);
    assert.match(blocks[1].text, /Still Here/);
  });

  await t.test('numbered lists stay sequential across blank lines and descriptions', () => {
    const parent = document.createElement('div');
    const sample = [
      'Here are five tools:',
      '',
      '1. The Grounding Cord',
      'A line of energy from the first chakra.',
      '',
      '2. Present-Time Attention',
      'Bring awareness back to the Now.',
      '',
      '3. The Rose',
      '',
      'Would you like to try one?',
    ].join('\n');
    appendFormattedContent(parent, sample);
    const list = parent.querySelector('.omibot-list-ol');
    assert.ok(list, 'expected one ordered list');
    const markers = [...list.querySelectorAll('.omibot-list-marker')].map((el) => el.textContent);
    assert.deepEqual(markers, ['1.', '2.', '3.']);
    const texts = [...list.querySelectorAll('.omibot-list-text')].map((el) =>
      el.textContent.replace(/\s+/g, ' ').trim()
    );
    assert.match(texts[0], /Grounding Cord.*line of energy/i);
    assert.match(texts[1], /Present-Time Attention.*Now/i);
    assert.match(texts[2], /The Rose/);
    const prose = [...parent.querySelectorAll('.omibot-prose')].map((el) => el.textContent);
    assert.ok(prose.some((t) => /Would you like/.test(t)), 'trailing prose should stay outside the list');
  });

  await t.test('list titles stay bold and break above descriptions', () => {
    const parent = document.createElement('div');
    appendFormattedContent(
      parent,
      [
        '1. **Re-activating the First Chakra Grounding Cord**',
        'Acknowledge the line of energy from the spine.',
        '',
        '2. **Present-Time Attention**',
        'Bring awareness back to the Now.',
      ].join('\n')
    );
    const titles = [...parent.querySelectorAll('.omibot-list-title')].map((el) => el.textContent);
    assert.deepEqual(titles, [
      'Re-activating the First Chakra Grounding Cord',
      'Present-Time Attention',
    ]);
    const descs = [...parent.querySelectorAll('.omibot-list-desc')].map((el) => el.textContent);
    assert.match(descs[0], /Acknowledge the line/);
    assert.match(descs[1], /Bring awareness/);
    assert.equal(parent.querySelectorAll('.omibot-list-title').length, 2);
  });

  await t.test('repeated 1. markers still renumber inside one list', () => {
    const parent = document.createElement('div');
    appendFormattedContent(
      parent,
      ['1. First tool', '', '1. Second tool', '', '1. Third tool'].join('\n')
    );
    const markers = [...parent.querySelectorAll('.omibot-list-marker')].map((el) => el.textContent);
    assert.deepEqual(markers, ['1.', '2.', '3.']);
  });

  console.log('All widget heading smoke tests passed.');
});
