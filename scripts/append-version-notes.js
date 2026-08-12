/**
 * Prepend git commit entries into VERSION-NOTES.txt.
 *
 * Usage:
 *   node scripts/append-version-notes.js --range <rev-range>
 *   node scripts/append-version-notes.js --from-push   (reads pre-push stdin ranges)
 *   node scripts/append-version-notes.js --commits <sha> [<sha>...]
 *
 * Entries are skipped when their short SHA is already present in the file.
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const notesPath = join(root, 'VERSION-NOTES.txt');

const SEPARATOR_RE = /^-{10,}\r?\n\r?\n/m;

function git(args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function todayLocalDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * @param {string} range e.g. "abc..def" or a single commit sha
 * @returns {Array<{ short: string; subject: string; body: string }>}
 */
function commitsFromRange(range) {
  if (!range) return [];
  const format = '%h%x1f%s%x1f%b%x1e';
  let out = '';
  try {
    // Oldest first so newest can be listed first after reverse
    out = git(['log', '--reverse', `--format=${format}`, range]);
  } catch {
    return [];
  }
  if (!out) return [];

  return out
    .split('\x1e')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const [short, subject, body = ''] = block.split('\x1f');
      return {
        short: (short || '').trim(),
        subject: (subject || '').trim(),
        body: (body || '').trim(),
      };
    })
    .filter((c) => c.short && c.subject);
}

/**
 * @param {string[]} shas
 */
function commitsFromShas(shas) {
  const list = [];
  for (const sha of shas) {
    if (!sha || /^0+$/.test(sha)) continue;
    try {
      const line = git(['log', '-1', '--format=%h%x1f%s%x1f%b', sha]);
      const [short, subject, body = ''] = line.split('\x1f');
      if (short && subject) {
        list.push({
          short: short.trim(),
          subject: subject.trim(),
          body: (body || '').trim(),
        });
      }
    } catch {
      // skip invalid
    }
  }
  return list;
}

/**
 * pre-push passes lines: <local_ref> <local_sha> <remote_ref> <remote_sha>
 * @param {string} stdinText
 * @returns {Array<{ short: string; subject: string; body: string }>}
 */
function commitsFromPushStdin(stdinText) {
  const lines = String(stdinText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  /** @type {Array<{ short: string; subject: string; body: string }>} */
  const all = [];
  const seen = new Set();

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;
    const localSha = parts[1];
    const remoteSha = parts[3];
    if (!localSha || /^0+$/.test(localSha)) continue; // delete ref

    if (!remoteSha || /^0+$/.test(remoteSha)) {
      // New branch: commits not already on any remote
      try {
        const format = '%h%x1f%s%x1f%b%x1e';
        const out = execFileSync(
          'git',
          ['log', '--reverse', `--format=${format}`, localSha, '--not', '--remotes'],
          { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
        ).trim();
        for (const block of out.split('\x1e')) {
          const b = block.trim();
          if (!b) continue;
          const [short, subject, body = ''] = b.split('\x1f');
          if (!short || !subject || seen.has(short)) continue;
          seen.add(short);
          all.push({
            short: short.trim(),
            subject: subject.trim(),
            body: (body || '').trim(),
          });
        }
        continue;
      } catch {
        for (const c of commitsFromRange(localSha)) {
          if (seen.has(c.short)) continue;
          seen.add(c.short);
          all.push(c);
        }
        continue;
      }
    }

    for (const c of commitsFromRange(`${remoteSha}..${localSha}`)) {
      if (seen.has(c.short)) continue;
      seen.add(c.short);
      all.push(c);
    }
  }
  return all;
}

/**
 * @param {Array<{ short: string; subject: string; body: string }>} commits
 * @param {string} existing
 */
function filterNew(commits, existing) {
  return commits.filter((c) => {
    const re = new RegExp(`^\\s*-\\s*${c.short}\\b`, 'm');
    return !re.test(existing);
  });
}

function cleanBody(body) {
  return String(body || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^co-authored-by:/i.test(l) && !/^signed-off-by:/i.test(l))
    .join('\n');
}

/**
 * @param {Array<{ short: string; subject: string; body: string }>} commits
 */
function formatEntry(commits) {
  const date = todayLocalDate();
  const n = commits.length;
  const title = n === 1 ? commits[0].subject : `Push - ${n} commits`;

  const lines = [`[${date}] ${title}`, '  - What changed:'];
  const newestFirst = [...commits].reverse();
  for (const c of newestFirst) {
    lines.push(`  - ${c.short} ${c.subject}`);
    const body = cleanBody(c.body);
    if (body) {
      for (const bodyLine of body.split(/\r?\n/)) {
        const t = bodyLine.trim();
        if (t) lines.push(`      ${t}`);
      }
    }
  }
  lines.push('  - Why / notes: Auto-logged from git (commit subjects/bodies).');
  lines.push('  - Related files or areas: (see commits)');
  lines.push('');
  lines.push('');
  return lines.join('\n');
}

/**
 * Insert newest-first after the first dashed separator block.
 * @param {string} content
 * @param {string} entry
 */
function insertEntry(content, entry) {
  const m = content.match(SEPARATOR_RE);
  if (!m || m.index === undefined) {
    return content.trimEnd() + '\n\n' + entry;
  }
  const insertAt = m.index + m[0].length;
  return content.slice(0, insertAt) + entry + content.slice(insertAt);
}

function parseArgs(argv) {
  /** @type {{ mode: 'range' | 'from-push' | 'commits'; range?: string; shas: string[] }} */
  const out = { mode: 'range', shas: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from-push') {
      out.mode = 'from-push';
    } else if (a === '--range' && argv[i + 1]) {
      out.mode = 'range';
      out.range = argv[++i];
    } else if (a === '--commits') {
      out.mode = 'commits';
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        out.shas.push(argv[++i]);
      }
    }
  }
  return out;
}

function readStdinSync() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  const args = parseArgs(process.argv);
  let commits = [];

  if (args.mode === 'from-push') {
    commits = commitsFromPushStdin(readStdinSync());
  } else if (args.mode === 'commits') {
    commits = commitsFromShas(args.shas);
  } else {
    const range =
      args.range ||
      (() => {
        try {
          return `${git(['rev-parse', '--abbrev-ref', '@{u}'])}..HEAD`;
        } catch {
          try {
            git(['rev-parse', 'origin/main']);
            return 'origin/main..HEAD';
          } catch {
            return 'HEAD~10..HEAD';
          }
        }
      })();
    commits = commitsFromRange(range);
  }

  if (!commits.length) {
    process.exit(0);
  }

  if (!existsSync(notesPath)) {
    console.error('VERSION-NOTES.txt not found at project root.');
    process.exit(1);
  }

  const existing = readFileSync(notesPath, 'utf8');
  const novel = filterNew(commits, existing);
  if (!novel.length) {
    process.exit(0);
  }

  const entry = formatEntry(novel);
  writeFileSync(notesPath, insertEntry(existing, entry), 'utf8');
  console.log(
    `VERSION-NOTES.txt: added ${novel.length} commit(s) for ${todayLocalDate()}.`
  );
  console.log(
    'Commit VERSION-NOTES.txt on your next change so the log is tracked in git.'
  );
}

main();
