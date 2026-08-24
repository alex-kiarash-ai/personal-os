#!/usr/bin/env node
// scripts/outputs-ledger.js - the outputs deliverables ledger (built 2026-07-11,
// research-team run 21 verdict: the amended Ledger, vault/research/output-structure-review.md).
//
// The retrieval layer over outputs/: every deliverable gets one append-only row in
// outputs/ledger.jsonl; INDEX.md (outputs/ + a vault copy for Obsidian) is generated
// from it, newest first. Files NEVER move; the ledger records where they already are.
//
//   node scripts/outputs-ledger.js add --project X --path outputs/... --desc "..." [--link a.md,b]  one row (Close-Out A6 lane)
//   node scripts/outputs-ledger.js update-desc --path outputs/... [--desc "..."] [--link ...]  supersede a row's
//                                                     desc/links (append-only; render shows latest-per-path). The
//                                                     enrichment lane for skeletal backfill rows. (upgrade P11)
//   node scripts/outputs-ledger.js reconcile          self-heal: append skeleton rows for any
//                                                     unledgered deliverable on disk, then render.
//                                                     Idempotent. Runs nightly via vault-backup.ps1.
//   node scripts/outputs-ledger.js validate           naming check, two legs: (1) outputs/ top-level dirs
//                                                     must be manifest keys or declared exemptions;
//                                                     (2) CV/cover-letter files carry his NAME ONLY, never a
//                                                     company or role (Shaheen 2026-08-20, grandfathered
//                                                     to files dated on/after that day).
//                                                     Exit 0 ok / 2 violation (check.ps1 C12 calls this).
//   node scripts/outputs-ledger.js render             regenerate both INDEX files from the ledger.
//
// Row: {"date","project","kind","desc","path","added","links"?}  path = repo-relative, forward slashes, THE key.
// Append-only; render() shows the LATEST row per path (update-desc supersedes, upgrade P11).
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
// sessions = THE home for future one-off session outputs (sessions/YYYY-MM-DD-topic/);
// prompting-scheduled = the Quota Reset Auto-Run tool's result dir (work/quota-reset-autorun/scripts/
//   poll-and-run.ps1 writes qra-*.txt here by design; QRA is a registered known_work_folder, 2026-07-15).
// explainer = the narrated-explainer lane's rendered MP4s (work/voice/explainer/make-explainer.py,
//   built 2026-07-24). Deliberately a LIGHT TOOL, not a numbered project, so it has no manifest key to
//   name its folder after - which is exactly what C12 flagged on 2026-07-25 (stress-test F-12). Its
//   artifacts ARE deliverables and DO get ledger rows; only the folder-name assertion needed the
//   exemption. If the lane ever earns a /new registry slot, drop this entry and use the manifest key.
const EXEMPT_DIRS = [...STREAM_DIRS, 'cv', 'reports', 'brand', 'sessions', 'architecture', 'building-alex', 'prompting-scheduled', 'explainer'];
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

/*
 * P1.1 + P1.2 (run-47 merged plan, 2026-08-23): every new row carries the run's shared join key and
 * a UTC-Z timestamp.
 *
 * run_id comes from the ALEX_RUN_ID the scheduled wrappers export (scripts/lib/close-out.ps1). An
 * interactive session has none, and the field is simply omitted - absence means "a human was
 * driving", which is information rather than a gap. This is the D1 fix: the same id also lands in
 * heal-log rows and the close-out line, so one grep joins three surfaces that previously shared
 * nothing at all.
 *
 * ts is UTC ISO-8601 with Z. The existing `date` field stays exactly as it is (every consumer and
 * the whole render path key off it); ts is additive, and old rows simply lack it. Root cause it
 * closes: four substrates each stamped a different way (UTC-Z, naive local, date-only, prose), so
 * even a TEMPORAL join across them was unreliable (run-46 N9).
 */
function runStamp() {
  const s = { ts: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') };
  if (process.env.ALEX_RUN_ID) s.run_id = process.env.ALEX_RUN_ID;
  return s;
}

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

// Latest-per-path (upgrade P11, 2026-07-12): the ledger stays append-only, but the INDEX shows the
// LAST row per path so `update-desc` (a superseding row) and `--link` corrections win. Append order
// is chronological, so a Map keyed by path keeps the newest.
function latestPerPath(rows) {
  const byPath = new Map();
  for (const r of rows) byPath.set(r.path, r);
  return [...byPath.values()];
}

// Links column (upgrade P11, e2): outputs/INDEX.md renders links as plain code; the vault copy turns
// vault-relative .md paths into [[wiki links]] so the deliverable joins the Obsidian graph.
function linkCell(links, wiki) {
  if (!links || !links.length) return '';
  return links.map(l => {
    if (!wiki) return `\`${l}\``;
    const m = String(l).match(/^vault\/(.+)\.md$/);
    return m ? `[[${m[1]}]]` : String(l);
  }).join(' · ');
}

function buildBody(rows, wiki, stamp) {
  const table = [
    '| Date | Project | Kind | What it is | Path | Links |',
    '|---|---|---|---|---|---|',
    ...rows.map(r => `| ${r.date} | ${r.project} | ${r.kind} | ${r.desc} | \`${r.path}\` | ${linkCell(r.links, wiki)} |`)
  ].join('\n');
  return `**${rows.length} deliverables, newest first.** Generated from \`outputs/ledger.jsonl\` by \`scripts/outputs-ledger.js\` - never hand-edit. Regenerate: \`node scripts/outputs-ledger.js render\`. Last generated: ${stamp}.\n\n${table}\n`;
}

function render() {
  // BUG-10 fix (2026-07-16 diagnostic audit): the INDEX is the RETRIEVAL surface ("find that file"),
  // so a row whose file no longer exists on disk (moved/reorganized/deleted) must not render a dead
  // link. The append-only ledger keeps the full history; the INDEX shows only what is currently
  // retrievable. This suppresses the 6 pre-reorg career-relaunch flat-path rows (their files moved to
  // ai/ and powerbi/ subfolders, already re-ledgered) and any future move/delete, without ever
  // rewriting a ledger line (NEVER-TOUCH: outputs/ledger.jsonl is append-only).
  const rows = latestPerPath(readLedger())
    .filter(r => !r.path || fs.existsSync(path.join(REPO, r.path)))
    .sort((a, b) => (b.date + b.path).localeCompare(a.date + a.path));
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  fs.writeFileSync(INDEX_OUT, `# Outputs Index\n\n${buildBody(rows, false, stamp)}`, 'utf8');
  fs.writeFileSync(INDEX_VAULT,
    `---\ntags: [index, outputs, generated]\nupdated: ${stamp.slice(0, 10)}\n---\n\n# Outputs Index (deliverables ledger)\n\n${buildBody(rows, true, stamp)}`, 'utf8');
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

// --- CV / cover-letter filename law (Shaheen, 2026-08-20, verbatim: "NEVER AGAIN when you
// produce a new CV for any compay, mention the company name in the file name itself. Nver again.
// fix this! Only my name and CV or a cover letter").
// WHY it is a rule and not a preference: the filename travels WITH the attachment. A recruiter who
// receives Shaheen_Kiarash_AI_Engineer_<Company>.pdf learns two things he never chose to tell them,
// that this is one of many per-company tailored versions, and (on a forward) which company he was
// targeting. The company, the role and the date belong in the FOLDER name and the ledger row, which
// are his and never leave the machine.
// Both CoverLetter spellings pass: the four live n8n engines already emit Shaheen_Kiarash_CoverLetter.pdf
// and were compliant before the rule existed, so an underscore is not worth editing four live workflows.
// GRANDFATHERED: only deliverables dated on/after the rule date are enforced. Pre-rule files are
// already-sent history that is never re-sent (the point-in-time convention in vault/me/cv-sources.md),
// and failing on them would paint C12 permanently red, which is how a real check gets ignored.
const CV_RULE_FROM = '2026-08-20';
const CV_FAMILY  = /^shaheen[_-]kiarash/i;
const CV_ALLOWED = /^Shaheen_Kiarash_(CV|Cover_?Letter)\.(pdf|docx)$/;

function validate() {
  let failed = false;

  // leg 1: outputs/ top-level dirs must be manifest keys or declared exemptions
  const names = manifestNames();
  const bad = [];
  for (const e of fs.readdirSync(OUT, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (names.has(e.name) || EXEMPT_DIRS.includes(e.name)) continue;
    bad.push(e.name);
  }
  if (bad.length) {
    failed = true;
    console.log(`VALIDATE FAIL: outputs/ top-level dir(s) not a manifest key or declared exemption: ${bad.join(', ')}`);
    console.log('Fix: rename to the registry name, or (one-offs) move under outputs/sessions/, or add a justified exemption in scripts/outputs-ledger.js.');
  } else {
    console.log('validate: outputs/ top-level naming clean.');
  }

  // leg 2: CV / cover-letter filenames carry his name and nothing else
  const badName = [];
  for (const f of deliverablesOnDisk()) {
    const base = path.basename(f);
    if (!CV_FAMILY.test(base) || CV_ALLOWED.test(base)) continue;
    if (dateFor(f) < CV_RULE_FROM) continue;
    badName.push(rel(f));
  }
  if (badName.length) {
    failed = true;
    console.log(`VALIDATE FAIL: CV/cover-letter filename carries more than his name: ${badName.join(', ')}`);
    console.log('Fix: rename to Shaheen_Kiarash_CV.<ext> or Shaheen_Kiarash_Cover_Letter.<ext>. The company, the role and the date live in the FOLDER name and the ledger row, never in the file a recruiter receives (Shaheen, 2026-08-20).');
  } else {
    console.log('validate: CV/cover-letter filenames clean (name only).');
  }

  if (failed) process.exit(2);
}

// links: comma-separated, from --link (upgrade P11, e2). vault/*.md paths become [[wiki links]]
// in the vault INDEX; anything else (Notion URLs) renders as-is.
function parseLinks(get) {
  const l = get('link');
  return l ? l.split(',').map(s => s.trim()).filter(Boolean) : [];
}

function add(args) {
  const get = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
  const p = get('path'), project = get('project'), desc = get('desc');
  if (!p || !project || !desc) { console.error('usage: add --project X --path outputs/... --desc "..." [--link a.md,b]'); process.exit(1); }
  const full = path.join(REPO, p);
  if (!fs.existsSync(full)) { console.error(`add: file not found: ${p}`); process.exit(1); }
  const relP = rel(full);
  if (readLedger().some(r => r.path === relP)) { console.log(`add: already ledgered: ${relP} (use update-desc to revise)`); render(); return; }
  const row = { ...skeletonRow(full, 'manual'), project, desc, ...runStamp() };
  const links = parseLinks(get);
  if (links.length) row.links = links;
  appendRows([row]);
  render();
  console.log(`add: ${row.date} ${row.project} ${relP}${row.run_id ? ' run=' + row.run_id : ''}${links.length ? ' +' + links.length + ' link(s)' : ''}`);
}

// update-desc (upgrade P11, e1/e2): append a SUPERSEDING row for an existing path with a better
// description and/or links. The ledger stays append-only; render()'s latest-per-path shows the new
// one. This is the enrichment lane for skeletal backfill rows.
function updateDesc(args) {
  const get = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
  const p = get('path'), desc = get('desc');
  if (!p || (!desc && !get('link'))) { console.error('usage: update-desc --path outputs/... [--desc "..."] [--link a.md,b]'); process.exit(1); }
  const relP = p.split(path.sep).join('/');
  const existing = latestPerPath(readLedger()).find(r => r.path === relP);
  if (!existing) { console.error(`update-desc: no ledger row for ${relP} - add it first`); process.exit(1); }
  const row = { ...existing, added: 'update' };
  if (desc) row.desc = desc;
  const links = parseLinks(get);
  if (links.length) row.links = links;
  appendRows([row]);
  render();
  console.log(`update-desc: ${relP}${desc ? ' desc revised' : ''}${links.length ? ' +' + links.length + ' link(s)' : ''}`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'reconcile') reconcile();
else if (cmd === 'validate') validate();
else if (cmd === 'render') { const n = render(); console.log(`render: ${n} rows.`); }
else if (cmd === 'add') add(rest);
else if (cmd === 'update-desc') updateDesc(rest);
else { console.error('usage: outputs-ledger.js <add|update-desc|reconcile|validate|render>'); process.exit(1); }
