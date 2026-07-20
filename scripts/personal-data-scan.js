#!/usr/bin/env node
/*
 * personal-data-scan.js - the PUBLIC-repo personal-data conscience (security-sweep S9, 2026-07-20).
 *
 * WHY: gitleaks (S1) catches SECRETS, but nothing scanned for PERSONAL DATA. On 2026-07-20 two state
 * files, a cached HQ metrics dump, and a runway builder that hardcoded real salary/burn/severance sat
 * public on GitHub. The privacy policy: the public repo gets the FUNCTIONAL system + Shaheen's name
 * only; other people's names, financial figures, health values and contact info stay local (gitignored).
 * This is the level-triggered monthly re-check for that policy, a sibling of the V11 forced-add guard.
 *
 * DETECT-ONLY. Greps only the git-TRACKED files (git grep, so gitignored/local files are never scanned).
 *   - NAMES: derived at runtime from vault/people/ basenames (gitignored, always current) - never stored
 *     here, so this script carries no personal data itself.
 *   - PATTERNS: built-in (financial amounts, health data values, SE phone) - functional, no personal data.
 *   - ALLOWLIST: reviewed-OK exceptions in system/personal-data-allowlist.json (gitignored, optional) -
 *     mirrors the .gitleaks.toml allowlist workflow (a reviewed false positive is suppressed by hand).
 *
 * Exit 0 = clean, 2 = hit(s) found, 1 = scan error. `--json` prints a machine-readable summary.
 * Run: node scripts/personal-data-scan.js [--json]
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PEOPLE = path.join(ROOT, 'vault', 'people');
const ALLOWLIST_FILE = path.join(ROOT, 'system', 'personal-data-allowlist.json');
const JSON_OUT = process.argv.includes('--json');
const HIT_CAP = 80;

// ---- built-in detection patterns (functional; carry no personal data) ----
// High precision by design: financial requires an explicit SEK/kr currency next to the number (a bare
// comma-grouped number matches CSS rgba, word counts and dollar examples - all noise). Money in this
// repo is Swedish, so currency-adjacency is the discriminator.
const PATTERNS = [
  { cat: 'financial', re: '\\b[0-9][0-9.,\\s]*(kr|sek)\\b' },                // a number immediately followed by kr/SEK
  { cat: 'health',    re: '"(steps|sleep[_-]?score|sleepScore|sleep[_-]?hours|sleepHours)"\\s*:\\s*[0-9.]+' }, // health values in a JSON data blob
  { cat: 'contact',   re: '\\+46[\\s0-9]{7,}' },                            // a Swedish phone number
];

// Vendored / generated / self trees to skip: third-party skills carry their own example names + word
// counts (not Shaheen's data), and the sweep's own report/this scanner would self-match.
const EXCLUDE = [
  ':(exclude).agents/skills', ':(exclude).claude/skills',
  ':(exclude)scripts/personal-data-scan.js',
  ':(exclude)vault/projects/recovery/last-security-sweep.md',
];

// basename tokens that are not real names (page artifacts / too generic)
const NAME_STOP = new Set(['example', 'contact', 'inbox', 'index', 'test', 'template', 'self']);

function loadAllowlist() {
  const a = { names: [], substrings: [], files: [] };
  try {
    const j = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, 'utf8'));
    for (const k of ['names', 'substrings', 'files']) if (Array.isArray(j[k])) a[k] = j[k].map(String);
  } catch (_) { /* optional; absent = no suppressions */ }
  return a;
}

// Build the NAME watch-list from vault/people/ basenames (local, gitignored, always current).
function deriveNames() {
  const names = new Set();
  let dirs = [];
  try { dirs = fs.readdirSync(PEOPLE, { withFileTypes: true }); } catch (_) { return { names: [], hadPeople: false }; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    let files = [];
    try { files = fs.readdirSync(path.join(PEOPLE, d.name)); } catch (_) { continue; }
    for (const f of files) {
      if (!f.endsWith('.md') || f.startsWith('_') || f === 'index.md') continue;
      const base = f.replace(/\.md$/, '');
      // the full name as a phrase (hyphens -> spaces), plus each alpha token >= 4 chars
      const phrase = base.replace(/-/g, ' ').trim();
      if (phrase.split(' ').length > 1 && phrase.length >= 5) names.add(phrase);
      for (const tok of base.split('-')) {
        const t = tok.toLowerCase();
        if (t.length >= 4 && /^[a-z]+$/.test(t) && !NAME_STOP.has(t)) names.add(t);
      }
    }
  }
  return { names: [...names], hadPeople: true };
}

// git grep the TRACKED files for one ERE; returns [{file, line, text}] (empty on no match).
function gitGrep(re) {
  let out = '';
  try {
    out = execFileSync('git', ['grep', '-I', '-n', '-i', '-E', '-e', re, '--', '.', ...EXCLUDE],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    if (e.status === 1) return [];            // git grep: exit 1 = no matches (not an error)
    throw new Error(`git grep failed (exit ${e.status}): ${String(e.stderr || e.message).slice(0, 200)}`);
  }
  const hits = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^([^:]+):(\d+):(.*)$/);
    if (m) hits.push({ file: m[1].replace(/\\/g, '/'), line: +m[2], text: m[3] });
  }
  return hits;
}

function reEscapeAlt(items) {
  // word-boundaried alternation of literal terms (spaces allowed inside a phrase)
  const esc = items.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return '\\b(' + esc.join('|') + ')\\b';
}

function main() {
  const allow = loadAllowlist();
  const allowNames = new Set(allow.names.map(s => s.toLowerCase()));
  const { names, hadPeople } = deriveNames();
  const watchNames = names.filter(n => !allowNames.has(n.toLowerCase()));

  const raw = [];
  // names (one combined grep; skip if none)
  if (watchNames.length) {
    for (const h of gitGrep(reEscapeAlt(watchNames))) raw.push({ cat: 'name', ...h });
  }
  for (const p of PATTERNS) {
    for (const h of gitGrep(p.re)) raw.push({ cat: p.cat, ...h });
  }

  // suppress allowlisted hits: by file path, or by any allowlisted substring in the line
  const subs = allow.substrings.map(s => s.toLowerCase());
  const files = allow.files.map(s => s.replace(/\\/g, '/'));
  const seen = new Set();
  const hits = [];
  for (const h of raw) {
    const key = `${h.cat}|${h.file}|${h.line}`;
    if (seen.has(key)) continue; seen.add(key);
    if (files.some(f => h.file === f || h.file.startsWith(f))) continue;
    const lc = h.text.toLowerCase();
    if (subs.some(s => s && lc.includes(s))) continue;
    hits.push(h);
  }

  const byCat = hits.reduce((a, h) => (a[h.cat] = (a[h.cat] || 0) + 1, a), {});
  const clean = hits.length === 0;
  const summary = { clean, total: hits.length, byCat, namesWatched: watchNames.length, hadPeople,
    hits: hits.slice(0, HIT_CAP).map(h => ({ cat: h.cat, file: h.file, line: h.line, sample: h.text.trim().slice(0, 160) })) };

  if (JSON_OUT) { console.log(JSON.stringify(summary)); }
  else {
    if (!hadPeople) console.log('personal-data-scan: WARNING vault/people/ not found - name watch-list is empty (names not scanned).');
    if (clean) console.log(`personal-data-scan: CLEAN (0 personal-data hits across tracked files; ${watchNames.length} names watched).`);
    else {
      console.log(`personal-data-scan: ${hits.length} hit(s) [${Object.entries(byCat).map(([k, v]) => `${k}:${v}`).join(' ')}]`);
      for (const h of summary.hits) console.log(`  [${h.cat}] ${h.file}:${h.line}: ${h.sample}`);
      if (hits.length > HIT_CAP) console.log(`  ... +${hits.length - HIT_CAP} more`);
      console.log('Fix: move the value/name to a gitignored vault page + pointer, OR add a reviewed exception to system/personal-data-allowlist.json.');
    }
  }
  process.exit(clean ? 0 : 2);
}

try { main(); }
catch (e) { console.error(`personal-data-scan: ERROR ${e.message}`); process.exit(1); }
