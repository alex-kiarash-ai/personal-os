#!/usr/bin/env node
// scripts/tests/portability-check.mjs
// The permanent cross-platform guard (bash migration Phase 1, 2026-08-05).
//
// Replaces the throwaway "case audit" the migration plan originally called for, because this class
// of bug recurs forever, not once. Three checks, all deterministic, zero tokens:
//
//   P1 CASE      every path literal in the repo resolves with EXACT case.
//                Windows and macOS are case-INSENSITIVE by default, so a wrong-cased path has been
//                silently working and will break the moment it lands on Linux. This check compares
//                against the real directory listing, so it is meaningful even when RUN on a
//                case-insensitive filesystem. That matters: running a naive fs.existsSync() audit
//                on macOS proves exactly nothing.
//
//   P2 BSD/GNU   no GNU-only command spelling inside a .sh file (sed -i, date -d, readlink -f,
//                stat -c, GNU mktemp). These pass on Linux and fail on the macOS dev machine, or
//                the reverse, and they surface late.
//
//   P3 BASH32    no bash 4+ construct inside a .sh file (declare -A, ${var^^}, mapfile/readarray,
//                globstar). macOS ships bash 3.2.57, so these are hard failures on the dev machine.
//
// Exit 0 = clean. Exit 1 = findings (prints every one, grouped, with file:line).
// Run: node scripts/tests/portability-check.mjs   (or: npm run portability)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.next', 'venv', '.venv', '__pycache__', '.obsidian',
  '.browser-profile', 'outputs', '.agents', '.claude',
]);

const findings = [];
const add = (check, file, line, msg) =>
  findings.push({ check, file: path.relative(ROOT, file), line, msg });

// ---------------------------------------------------------------- walk
function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.gitattributes' && e.name !== '.gitignore') {
      if (SKIP_DIRS.has(e.name)) continue;
    }
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------- P1: exact-case path resolution
// Cache of dir -> Set(real entry names), so we can test EXACT case on any filesystem.
const dirCache = new Map();
function realEntries(dir) {
  if (dirCache.has(dir)) return dirCache.get(dir);
  let set;
  try {
    set = new Set(fs.readdirSync(dir));
  } catch {
    set = null;
  }
  dirCache.set(dir, set);
  return set;
}

/**
 * Does this repo-relative path resolve with exact case?
 * Returns 'ok' | 'missing' | 'case:<the real spelling>'
 */
function resolveExact(relPath) {
  const parts = relPath.split('/').filter((p) => p && p !== '.');
  let cur = ROOT;
  const rebuilt = [];
  for (const part of parts) {
    const entries = realEntries(cur);
    if (!entries) return 'missing';
    if (entries.has(part)) {
      rebuilt.push(part);
      cur = path.join(cur, part);
      continue;
    }
    // Not an exact match. Is there a case-insensitive match? That is the dangerous case.
    const lower = part.toLowerCase();
    let hit = null;
    for (const e of entries) {
      if (e.toLowerCase() === lower) {
        hit = e;
        break;
      }
    }
    if (hit) {
      rebuilt.push(hit);
      return `case:${rebuilt.join('/')}`;
    }
    return 'missing';
  }
  return 'ok';
}

// Path-shaped literals inside quotes: must contain a '/', must look like a repo path, and must end
// in a known extension or be a known top-level dir. Deliberately conservative: this check has to be
// trustworthy, so it would rather miss a literal than cry wolf on prose.
const PATH_LITERAL = /['"`]([A-Za-z0-9_.\-/]+\.(?:js|mjs|cjs|py|ps1|sh|json|md|txt|jsonl|db|sql|html|css|xml|csv|docx|xlsx))['"`]/g;
const REPO_TOP = new Set([
  'scripts', 'system', 'work', 'vault', 'docs', 'brand', 'templates', 'scheduler',
  'outputs', 'inbox', 'refactor',
]);

function checkCase(file, text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip obvious non-code contexts that legitimately name foreign paths.
    if (/^\s*(#|\/\/|\*)/.test(line) && !/scripts\/|system\/|work\//.test(line)) continue;
    let m;
    PATH_LITERAL.lastIndex = 0;
    while ((m = PATH_LITERAL.exec(line)) !== null) {
      const lit = m[1];
      if (lit.startsWith('/') || lit.includes('://')) continue; // absolute or URL, not ours
      const top = lit.split('/')[0];
      if (!REPO_TOP.has(top)) continue; // only judge paths that clearly point into this repo
      const res = resolveExact(lit);
      if (res.startsWith('case:')) {
        add('P1 CASE', file, i + 1, `'${lit}' resolves only case-insensitively; on disk it is '${res.slice(5)}'. This breaks on Linux.`);
      }
      // 'missing' is NOT reported: this is a scrubbed skeleton clone where vault/ and many
      // work/*/config files legitimately do not exist. Only wrong-CASE is a portability defect.
    }
  }
}

// ---------------------------------------------------------------- P2 + P3: shell portability
const GNUISMS = [
  [/\bsed\s+-i\b(?!\s*['"]{2})/, "GNU `sed -i` without a backup suffix; BSD sed requires `sed -i ''`. Do it in Node instead."],
  [/\bdate\s+-d\b/, 'GNU `date -d`; BSD date uses -v/-j -f. Do date math in Node instead.'],
  [/\breadlink\s+-f\b/, 'GNU `readlink -f`; BSD readlink has no -f. Use: "$(cd "$(dirname "$0")/.." && pwd)".'],
  [/\bstat\s+-c\b/, 'GNU `stat -c`; BSD stat uses -f. Do it in Node instead.'],
  [/\bmktemp\s+-p\b/, 'GNU `mktemp -p`; BSD mktemp has no -p. Use a full template path.'],
  [/\bgrep\s+-P\b/, 'GNU `grep -P` (PCRE); BSD grep has no -P. Use -E, or do it in Node.'],
  [/\bsort\s+-V\b/, 'GNU `sort -V`; BSD sort has no -V.'],
  [/\bcp\s+--/, 'GNU long-option `cp --...`; BSD cp takes short flags only.'],
  [/\bsed\s+-r\b/, 'GNU `sed -r`; BSD sed uses -E (which GNU also accepts). Use -E.'],
];

const BASH4 = [
  [/\bdeclare\s+-A\b/, '`declare -A` (associative array) is bash 4+; macOS ships 3.2.'],
  [/\$\{[A-Za-z_][A-Za-z0-9_]*\^\^/, '`${var^^}` case conversion is bash 4+; use tr.'],
  [/\$\{[A-Za-z_][A-Za-z0-9_]*,,/, '`${var,,}` case conversion is bash 4+; use tr.'],
  [/\b(mapfile|readarray)\b/, '`mapfile`/`readarray` is bash 4+; use a while-read loop.'],
  [/\bshopt\s+-s\s+globstar\b/, 'globstar (`**`) is bash 4+; use find.'],
  [/\bwait\s+-n\b/, '`wait -n` is bash 4.3+.'],
  [/\blocal\s+-n\b/, '`local -n` nameref is bash 4.3+.'],
];

function checkShell(file, text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const code = line.replace(/#.*$/, ''); // ignore comments; this file documents the bans in prose
    if (!code.trim()) continue;
    for (const [re, msg] of GNUISMS) if (re.test(code)) add('P2 BSD/GNU', file, i + 1, msg);
    for (const [re, msg] of BASH4) if (re.test(code)) add('P3 BASH32', file, i + 1, msg);
  }
}

// ---------------------------------------------------------------- run
const files = walk(ROOT);
let scannedCase = 0;
let scannedShell = 0;

for (const f of files) {
  const ext = path.extname(f);
  let text;
  try {
    text = fs.readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  if (['.js', '.mjs', '.cjs', '.py', '.json', '.ps1', '.sh'].includes(ext)) {
    checkCase(f, text);
    scannedCase++;
  }
  if (ext === '.sh') {
    checkShell(f, text);
    scannedShell++;
  }
}

// ---------------------------------------------------------------- report
const byCheck = {};
for (const f of findings) (byCheck[f.check] ||= []).push(f);

console.log(`portability-check: ${scannedCase} files scanned for path case, ${scannedShell} shell files scanned for portability`);
if (process.platform !== 'linux') {
  console.log(`note: running on ${process.platform}. P1 compares against real directory listings, so it is valid here, but a full confirmation run on the Linux host is still the gate (migration plan Phase 1 step 6).`);
}

if (!findings.length) {
  console.log('PASS: no portability findings.');
  process.exit(0);
}

for (const [check, list] of Object.entries(byCheck)) {
  console.log(`\n${check}  (${list.length})`);
  for (const f of list) console.log(`  ${f.file}:${f.line}  ${f.msg}`);
}
console.log(`\nFAIL: ${findings.length} portability finding(s).`);
process.exit(1);
