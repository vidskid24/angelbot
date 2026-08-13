/**
 * Keep src/config copies in sync with data/course-catalog.json.
 * Render often mounts a disk over data/, so deploy-safe copies live under src/config.
 *
 * Run: node scripts/sync-config-from-data.js
 */
import { copyFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pairs = [
  ['data/course-catalog.json', 'src/config/course-catalog.json'],
  ['data/chunk-source-index.json', 'src/config/chunk-source-index.json'],
];

await mkdir(join(ROOT, 'src', 'config'), { recursive: true });
for (const [fromRel, toRel] of pairs) {
  const from = join(ROOT, fromRel);
  const to = join(ROOT, toRel);
  try {
    await copyFile(from, to);
    console.log(`Synced ${fromRel} -> ${toRel}`);
  } catch (err) {
    if (err?.code === 'ENOENT') {
      console.warn(`Skip ${fromRel}: not found`);
      continue;
    }
    throw err;
  }
}
