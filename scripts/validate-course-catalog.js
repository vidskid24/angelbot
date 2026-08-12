/**
 * List sessionKeys in embeddings.json that are missing from course-catalog.json.
 * Run: node scripts/validate-course-catalog.js
 */
import 'dotenv/config';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseCourseSourceFromPath } from '../src/rag/course-source.js';
import {
  loadCourseCatalog,
  listMissingCatalogUnits,
  clearCourseCatalogCache,
  formatCourseSourceLabelWithCatalog,
  catalogLevelUrlCoverage,
  resolvePurchaseUrlForSource,
} from '../src/rag/course-catalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const EMBEDDINGS_PATH = join(ROOT, 'data', 'embeddings.json');

clearCourseCatalogCache();
const catalog = await loadCourseCatalog();

let chunks = [];
try {
  const raw = await readFile(EMBEDDINGS_PATH, 'utf-8');
  const data = JSON.parse(raw);
  chunks = data.chunks || [];
} catch (err) {
  if (err?.code === 'ENOENT') {
    console.log('No embeddings.json found — run npm run ingest first.');
    process.exit(0);
  }
  throw err;
}

const sessionKeys = [];
const labels = new Map();

for (const chunk of chunks) {
  const source = chunk.source || parseCourseSourceFromPath(chunk.sourcePath || '');
  if (!source?.sessionKey) continue;
  sessionKeys.push(source.sessionKey);
  if (!labels.has(source.sessionKey)) {
    labels.set(
      source.sessionKey,
      formatCourseSourceLabelWithCatalog(source, catalog)
    );
  }
}

const uniqueKeys = [...new Set(sessionKeys)].sort();
const missing = listMissingCatalogUnits(catalog, sessionKeys);

console.log('--- Course catalog validation ---');
console.log('Indexed session keys:', uniqueKeys.length);
console.log('Catalog units defined:', Object.keys(catalog.units || {}).length);
console.log('Missing from catalog:', missing.length);
if (missing.length) {
  for (const key of missing) {
    console.log('  -', key, labels.get(key) ? `(${labels.get(key)})` : '');
  }
}

const levelCodes = [
  ...new Set(
    [
      ...Object.keys(catalog.levels || {}),
      ...sessionKeys.map((k) => k.match(/^(L\d+)/)?.[1]).filter(Boolean),
    ].filter(Boolean)
  ),
].sort();

console.log('\nCourse link coverage by level (owned / membership → course page):');
for (const levelCode of levelCodes) {
  const coverage = catalogLevelUrlCoverage(catalog, levelCode);
  const purchaseUrl = resolvePurchaseUrlForSource(catalog, { levelCode }, null);
  console.log(`  - ${levelCode}`);
  console.log(`      owned:      ${coverage.ownedUrl || '(none)'}`);
  console.log(`      membership: ${coverage.membershipUrl || '(none)'}`);
  console.log(`      purchase:   ${purchaseUrl || '(none)'}`);
}

if (catalog.defaultPurchaseUrl) {
  console.log('\nSite defaultPurchaseUrl:', catalog.defaultPurchaseUrl);
}
