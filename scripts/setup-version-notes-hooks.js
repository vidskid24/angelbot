/**
 * Point this repo at .githooks so pre-push can update VERSION-NOTES.txt.
 * Run once: npm run notes:hooks
 */

import { execFileSync } from 'child_process';
import { chmodSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { platform } from 'os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const prePush = join(root, '.githooks', 'pre-push');

execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
  cwd: root,
  stdio: 'inherit',
});

if (existsSync(prePush) && platform() !== 'win32') {
  try {
    chmodSync(prePush, 0o755);
  } catch {
    // ignore
  }
}

console.log('Git hooks enabled (core.hooksPath = .githooks).');
console.log('On each git push, new commit messages will be prepended to VERSION-NOTES.txt.');
