#!/usr/bin/env node
// scripts/outputs-ledger.js - the outputs deliverables ledger (built 2026-07-11,
// research-team run 21 verdict: the amended Ledger, vault/research/output-structure-review.md).
//
// The retrieval layer over outputs/: every deliverable gets one append-only row in
// outputs/ledger.jsonl; INDEX.md (outputs/ + a vault copy for Obsidian) is generated
// from it, newest first. Files NEVER move; the ledger records where they already are.
//
//   node scripts/outputs-ledger.js add --project X --path outputs/... --desc "..."   one row (Close-Out A6 lane)
//   node scripts/outputs-ledger.js reconcile          self-heal: append skeleton rows for any
//                                                     unledgered deliverable on disk, then render.
//                                                     Idempotent. Runs nightly via vault-backup.ps1.
//   node scripts/outputs-ledger.js validate           naming check: outputs/ top-level dirs must be
//                                                     manifest keys or declared exemptions.
//                                                     Exit 0 ok / 2 violation (check.ps1 C12 calls this).
//   node scripts/outputs-ledger.js render             regenerate both INDEX files from the ledger.
//
// Row: {"date","project","kind","desc","path","added"}  path = repo-relative, forward slashes, THE key.
// Streams are exempt (never ledgered): logs/ (regenerable runtime), voice/ + typed/ (append-only corpora).
// ledger.jsonl rides the encrypted vault backup (whitelisted); INDEX files are regenerable.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const OUT = path.join(REPO, 'outputs');
const LEDGER = path.join(OUT, 'ledger.jsonl');
const INDEX_OUT = path.join(OUT, 'INDEX.md');
const INDEX_VAULT = path.join(REPO, 'vault', 'outputs-index.md');
const MANIFEST = path.join(REPO, 'system', 'manifest.json');

// Streams: never ledgered (logs = regenerable, voice/typed = corpora with load-bearing paths).
const STREAM_DIRS = ['logs', 'voice', 'typed'];
// Validation exemptions: legit top-level dirs that are not manifest keys.
// cv = working set; reports/brand/architecture/building-alex = frozen legacy (pre-ledger one-offs);
// sessions = THE home for future one-off session outputs (sessions/YYYY-MM-DD-topic/).
const EXEMPT_DIRS = [...STREAM_DIRS, 'cv', 'reports', 'brand', 'sessions', 'architecture', 'building-alex'];
const SKIP_FILES = new Set(['ledger.jsonl', 'INDEX.md', '.gitkeep', 'desktop.ini', 'Thumbs.db', '.platform']);
const SKIP_EXT = new Set(['.log', '.tmp', '.lock']);
// Multi-file bundle formats: internals are components of ONE deliverable, never rows themselves
// (PBIP explodes into dozens of .Report/.SemanticModel jsons; the .pbip file is the deliverable).
const BUNDLE_SEGMENT = /\/(?:[^/]+\.(?:Report|SemanticModel)|\.pbi)\//;
// Folder -> canonical project when they differ (path stays truthful in the row).
const PROJECT_MAP = { 'alex-interview': 'interview-copilot' };

function manifestNames() {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const names = m.projects.map(p => p.name);
  for (const u of (m.meta.unnumbered || [])) names.push(u.name);
  return new Set(names);
}

function rel(p) { return path.relative(REPO, p).split(path.sep).join('/'); }

function readLedger() {
  if (!fs.existsSync(LEDGER)) return [];
  return fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function appendRows(rows) {
  if (!rows.length) return;
  const text = rows.map(r => JSON.stringify(r)).join('\n') + '\n';
  fs.appendFileSync(LEDGER, text, 'utf8');
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function deliverablesOnDisk() {
  const files = [];
  if (!fs.existsSync(OUT)) return files;
  for (const e of fs.readdirSync(OUT, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (STREAM_DIRS.includes(e.name)) continue;
    for (const f of walk(path.join(OUT, e.name))) {
      const base = path.basename(f);
      if (SKIP_FILES.has(base) || SKIP_EXT.has(path.extname(f).toLowerCase())) continue;
      if (BUNDLE_SEGMENT.test('/' + rel(f) + '/')) continue;
      files.push(f);
    }
  }
  return files;
}

function dateFor(file) {
  const m = rel(file).match(/(\d{4}-\d{2}-\d{2})/); // first dated segment in the path
  if (m) return m[1];
  return new Date(fs.statSync(file).mtime).toISOString().slice(0, 10);
}

function projectFor(file) {
  const parts = rel(file).split('/'); // outputs/<top>/...
  const top = parts[1];
  const base = path.basename(file);
  if (top === 'reports') {
    if (/^weekly-exec/i.test(base)) return 'weekly-exec-report';
    if (/^expense-tracker/i.test(base)) return 'expense-wrangler';
    return 'session';
  }
  return PROJECT_MAP[top] || top;
}

function descFor(file) {
  return path.basename(file, path.extname(file)).replace(/[-_]+/g, ' ').trim();
}

function skeletonRow(file, added) {
  return {
    date: dateFor(file),
    project: projectFor(file),
    kind: path.extname(file).replace('.', '').toLowerCase() || 'file',
    desc: descFor(file),
    path: rel(file),
    added
  };
}

function render() {
  const rows = readLedger()
    .sort((a, b) => (b.date + b.path).localeCompare(a.date + a.path));
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const table = [
    '| Date | Project | Kind | What it is | Path |',
    '|---|---|---|---|---|',
    ...rows.map(r => `| ${r.date} | ${r.project} | ${r.kind} | ${r.desc} | \`${r.path}\` |`)
  ].join('\n');
  const body = `**${rows.length} deliverables, newest first.** Generated from \`outputs/ledger.jsonl\` by \`scripts/outputs-ledger.js\` - never hand-edit. Regenerate: \`node scripts/outputs-ledger.js render\`. Last generated: ${stamp}.\n\n${table}\n`;
  fs.writeFileSync(INDEX_OUT, `# Outputs Index\n\n${body}`, 'utf8');
  fs.writeFileSync(INDEX_VAULT,
    `---\ntags: [index, outputs, generated]\nupdated: ${stamp.slice(0, 10)}\n---\n\n# Outputs Index (deliverables ledger)\n\n${body}`, 'utf8');
  return rows.length;
}

function reconcile() {
  const known = new Set(readLedger().map(r => r.path));
  const missing = deliverablesOnDisk().filter(f => !known.has(rel(f)));
  const rows = missing.map(f => skeletonRow(f, known.size === 0 ? 'backfill' : 'reconcile'));
  appendRows(rows);
  const total = render();
  console.log(`reconcile: ${rows.length} row(s) added, ${total} total. INDEX.md + vault/outputs-index.md rendered.`);
  for (const r of rows.slice(0, 20)) console.log(`  + ${r.date} ${r.project} ${r.path}`);
  if (rows.length > 20) console.log(`  ... and ${rows.length - 20} more`);
}

function validate() {
  const names = manifestNames();
  const bad = [];
  for (const e of fs.readdirSync(OUT, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (names.has(e.name) || EXEMPT_DIRS.includes(e.name)) continue;
    bad.push(e.name);
  }
  if (bad.length) {
    console.log(`VALIDATE FAIL: outputs/ top-level dir(s) not a manifest key or declared exemption: ${bad.join(', ')}`);
    console.log('Fix: rename to the registry name, or (one-offs) move under outputs/sessions/, or add a justified exemption in scripts/outputs-ledger.js.');
    process.exit(2);
  }
  console.log('validate: outputs/ top-level naming clean.');
}

function add(args) {
  const get = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
  const p = get('path'), project = get('project'), desc = get('desc');
  if (!p || !project || !desc) { console.error('usage: add --project X --path outputs/... --desc "..."'); process.exit(1); }
  const full = path.join(REPO, p);
  if (!fs.existsSync(full)) { console.error(`add: file not found: ${p}`); process.exit(1); }
  const relP = rel(full);
  if (readLedger().some(r => r.path === relP)) { console.log(`add: already ledgered: ${relP}`); render(); return; }
  const row = { ...skeletonRow(full, 'manual'), project, desc };
  appendRows([row]);
  render();
  console.log(`add: ${row.date} ${row.project} ${relP}`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'reconcile') reconcile();
else if (cmd === 'validate') validate();
else if (cmd === 'render') { const n = render(); console.log(`render: ${n} rows.`); }
else if (cmd === 'add') add(rest);
else { console.error('usage: outputs-ledger.js <add|reconcile|validate|render>'); process.exit(1); }
