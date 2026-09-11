#!/usr/bin/env node
// scripts/outputs-ledger.js - the outputs deliverables ledger (built 2026-07-11,
// research-team run 21 verdict: the amended Ledger, vault/research/output-structure-review.md).
//
// The retrieval layer over outputs/: every deliverable gets one append-only row in
// outputs/ledger.jsonl; INDEX.md (outputs/ + a vault copy for Obsidian) is generated
// from it, newest first. Files NEVER move; the ledger records where they already are.
//
//   node scripts/outputs-ledger.js add --project X --path outputs/... --desc "..." [--link a.md,b]  one row (Close-Out A6 lane)
//     identity-carrying deliverables (.pdf/.docx/.pptx/.png/.jpg/.svg/.html) also need
//     --grader PASS|FAIL|SKIPPED (+ --grader-note for FAIL/SKIPPED) - Close-Out C, A01-T-06
//   node scripts/outputs-ledger.js update-desc --path outputs/... [--desc "..."] [--link ...]  supersede a row's
//                                                     desc/links (append-only; render shows latest-per-path). The
//                                                     enrichment lane for skeletal backfill rows. (upgrade P11)
//   node scripts/outputs-ledger.js reconcile          self-heal: append skeleton rows for any
//                                                     unledgered deliverable on disk, then render.
//                                                     Idempotent. Runs nightly via vault-backup.sh.
//   node scripts/outputs-ledger.js validate           naming check, two legs: (1) outputs/ top-level dirs
//                                                     must be manifest keys or declared exemptions;
//                                                     (2) CV/cover-letter files carry his NAME ONLY, never a
//                                                     company or role (Shaheen 2026-08-20, grandfathered
//                                                     to files dated on/after that day).
//                                                     Exit 0 ok / 2 violation (check.mjs C12 calls this).
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
//   poll-and-run.sh writes qra-*.txt here by design; QRA is a registered known_work_folder, 2026-07-15).
// explainer = the narrated-explainer lane's rendered MP4s (work/voice/explainer/make-explainer.py,
//   built 2026-07-24). Deliberately a LIGHT TOOL, not a numbered project, so it has no manifest key to
//   name its folder after - which is exactly what C12 flagged on 2026-07-25 (stress-test F-12). Its
//   artifacts ARE deliverables and DO get ledger rows; only the folder-name assertion needed the
//   exemption. If the lane ever earns a /new registry slot, drop this entry and use the manifest key.
// git-bundles = the nightly `git bundle create --all` written by vault-backup.sh (2026-09-10,
//   stress-test A06-T17): one file holding every LOCAL git ref so a branch that was never pushed is
//   not one disk failure from gone. It is infrastructure for the backup, not a deliverable, so it is
//   exempt from the folder-naming assertion and gets no ledger row. Gitignored by the outputs/ rule.
const EXEMPT_DIRS = [...STREAM_DIRS, 'cv', 'reports', 'brand', 'sessions', 'architecture', 'building-alex', 'prompting-scheduled', 'explainer', 'git-bundles'];
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
 * run_id comes from the ALEX_RUN_ID the scheduled wrappers export (log_init in scripts/lib/common.sh). An
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
  const mtime = new Date(fs.statSync(file).mtime).toISOString().slice(0, 10);
  if (!m) return mtime;
  // A15-T-07 (2026-09-11): take the LATER of the folder date and the file's own mtime. The folder
  // date alone means a file written today into a pre-rule folder is grandfathered as history, which
  // is a rename away from switching the filename law off for any new deliverable. The folder date
  // still wins where it is later, because a dated folder is the deliberate statement of when a
  // deliverable belongs and mtime moves for reasons nobody intended (a copy, a restore, a sync).
  return m[1] > mtime ? m[1] : mtime;
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
// A15-T-07 (2026-09-11): TWO holes, both in how the law decides what to look at.
//
// (1) This anchored with ^, so only a filename STARTING with his name was ever inspected.
//     `AI_Engineer_Shaheen_Kiarash.pdf` and `CV_Volvo_2026.pdf` both leak exactly what the law
//     exists to stop and neither was examined. The name check stays (it is the broad net that
//     catches a filename with no CV token in it at all) and a second net catches the CV-shaped
//     names that do not lead with him.
// (2) See dateFor: the grandfather date came from the FOLDER, so a file written today into a
//     2026-08-19 folder was treated as pre-rule history and skipped.
const CV_FAMILY  = /shaheen[_-]kiarash/i;
// The CV-SHAPED net, scoped to the extensions that actually SHIP. The law's own wording is
// "the only two shapes that may ship: Shaheen_Kiarash_CV.{pdf,docx}", and the leak it prevents
// travels WITH the attachment - so an intermediate .txt or .html source that never leaves the
// machine is not the target. The first draft of this net was unscoped and immediately flagged
// nine working files (cover-letter.txt, cv-source.html, a .bak), which is how a privacy rule
// gets a reputation for crying wolf and then gets switched off.
const CV_SHAPED  = /(^|[_-])(cv|resume|curriculum|lebenslauf|cover[_-]?letter)([_-]|\.|$)/i;
const CV_SHIPS   = /\.(pdf|docx)$/i;
const CV_ALLOWED = /^Shaheen_Kiarash_(CV|Cover_?Letter)\.(pdf|docx)$/;
// Reviewed exceptions to the filename law, by exact repo-relative path (2026-09-10, stress-test
// A04-T3 follow-on). The law is deliberately matched on HIS NAME rather than on CV-ish words,
// because the leak it prevents is `Shaheen_Kiarash_AI_Engineer_<Company>.pdf` - a filename with no
// CV token in it at all. Narrowing the pattern to catch only files that LOOK like a CV would open
// exactly the hole the law exists to close, so the pattern stays broad and a genuine non-application
// document is exempted here ONE PATH AT A TIME with its reason, the same shape as the gitleaks and
// personal-data allowlists. An entry here is a claim that this file is never sent to a recruiter.
const CV_NAME_EXCEPTIONS = new Map([
  ['outputs/sessions/2026-08-25-istvan-action-plan/Shaheen_Kiarash_Action_Plan.pdf',
   'a personal career action plan from a coaching session, never an application attachment; it is not a CV or a cover letter and carries no company or role in its name'],
]);

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
    const looksLikeHim = CV_FAMILY.test(base);
    const looksLikeACv = CV_SHAPED.test(base) && CV_SHIPS.test(base);
    if ((!looksLikeHim && !looksLikeACv) || CV_ALLOWED.test(base)) continue;
    if (dateFor(f) < CV_RULE_FROM) continue;
    if (CV_NAME_EXCEPTIONS.has(rel(f).split(path.sep).join('/'))) continue;
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
  /*
   * A01-T-06 (2026-09-11): IDENTITY-CARRYING deliverables must record a grader verdict.
   *
   * Close-Out C says a shipped visual or piece of prose in Shaheen's voice gets a blind grader - a
   * fresh subagent that sees only the artifact and the rubric, never this session's reasoning,
   * because the 2026-07-03 brand incident shipped past a session grading its own work. The grader
   * is ADVISORY by Shaheen's choice, and advisory turned out to mean it fired on 2 of 11 identity
   * days: a rule with no mechanism decays to the rate at which someone remembers it.
   *
   * This does not force the grader to RUN, which would make an advisory step blocking against his
   * decision. It forces the row to SAY, so "not graded" becomes a recorded fact instead of an
   * absence nobody can see afterwards. `--grader PASS|FAIL|SKIPPED` with a reason for the last two.
   * Non-identity deliverables (.md, .json, .csv) are unaffected.
   */
  const IDENTITY_EXT = /\.(pdf|docx|pptx|png|jpg|jpeg|svg|html)$/i;
  let grader = get('grader');
  if (IDENTITY_EXT.test(relP)) {
    const VALID = ['PASS', 'FAIL', 'SKIPPED'];
    if (!grader || !VALID.includes(String(grader).toUpperCase())) {
      console.error(`add: ${relP} is an identity-carrying deliverable, so it needs --grader ${VALID.join('|')}.`);
      console.error('  Close-Out C: a shipped visual or prose-in-his-voice gets a blind grader (work/23-self-review/close-out-grader/).');
      console.error('  The grader stays ADVISORY - this only requires the row to SAY what happened, so "not graded" is recorded rather than invisible.');
      console.error('  SKIPPED is a legitimate answer: add --grader SKIPPED --grader-note "why".');
      process.exit(1);
    }
    grader = String(grader).toUpperCase();
    if (grader !== 'PASS' && !get('grader-note')) {
      console.error(`add: --grader ${grader} needs --grader-note "<why>" - a FAIL or a SKIP without a reason is the thing a reader cannot act on later.`);
      process.exit(1);
    }
  }

  const row = { ...skeletonRow(full, 'manual'), project, desc, ...runStamp() };
  if (grader) { row.grader = grader; const gn = get('grader-note'); if (gn) row.grader_note = gn; }
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
