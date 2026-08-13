/**
 * Build data/chunk-source-index.json from local embeddings.json.
 * Maps chunk text → sourcePath so production can cite even when vectors
 * were uploaded without source metadata.
 *
 * Run from repo root: node scripts/build-chunk-source-index.js
 */
import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EMBEDDINGS_PATH = join(ROOT, 'data', 'embeddings.json');
const OUT_PATHS = [
  join(ROOT, 'src', 'config', 'chunk-source-index.json'),
  join(ROOT, 'data', 'chunk-source-index.json'),
];

function normalize(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/^\[Source:[^\]]*\]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const raw = await readFile(EMBEDDINGS_PATH, 'utf-8');
const data = JSON.parse(raw);
const chunks = Array.isArray(data?.chunks) ? data.chunks : [];

/** @type {Record<string, string>} */
const byHash = {};
/** @type {Record<string, string>} */
const byPrefix = {};
/** @type {Record<string, string>} */
const byFingerprint = {};
/** @type {Set<string>} */
const prefixCollisions = new Set();
/** @type {Set<string>} */
const fingerprintCollisions = new Set();
/** @type {string[]} */
const paths = [];

let withPath = 0;
let skipped = 0;

for (const chunk of chunks) {
  const sourcePath = String(chunk?.sourcePath || '').trim();
  paths.push(sourcePath);
  const text = String(chunk?.text || chunk?.content || chunk?.chunk || '');
  const n = normalize(text);
  if (!sourcePath || !n) {
    skipped++;
    continue;
  }
  withPath++;
  const hash = createHash('sha1').update(n).digest('hex');
  byHash[hash] = sourcePath;
  const prefix = n.slice(0, 160);
  if (prefix && !prefixCollisions.has(prefix)) {
    if (byPrefix[prefix] && byPrefix[prefix] !== sourcePath) {
      delete byPrefix[prefix];
      prefixCollisions.add(prefix);
    } else {
      byPrefix[prefix] = sourcePath;
    }
  }
  if (n.length >= 40) {
    const fingerprint = `${n.slice(0, 80)}|${n.slice(-80)}`;
    if (!fingerprintCollisions.has(fingerprint)) {
      if (byFingerprint[fingerprint] && byFingerprint[fingerprint] !== sourcePath) {
        delete byFingerprint[fingerprint];
        fingerprintCollisions.add(fingerprint);
      } else {
        byFingerprint[fingerprint] = sourcePath;
      }
    }
  }
}

const out = { v: 2, h: byHash, p: byPrefix, k: byFingerprint, a: paths };
const payload = JSON.stringify(out);
for (const outPath of OUT_PATHS) {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, payload);
  console.log(
    `Wrote ${outPath} (${withPath} paths, ${Object.keys(byHash).length} hashes, ${Object.keys(byPrefix).length} prefixes, ${Object.keys(byFingerprint).length} fingerprints, ${paths.length} ordered, skipped ${skipped})`
  );
}
