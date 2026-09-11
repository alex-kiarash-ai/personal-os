#!/usr/bin/env node
/**
 * stress-remediation.js - the machine-checkable ledger for a stress-test remediation run.
 *
 * WHY THIS EXISTS. Through the 2026-09-10 passes the count of "rows fixed" lived in prose,
 * in three places, reconciled by hand at the end of each pass. Every other number in this
 * system derives from the file that owns it; this one did not, and it drifted: the session
 * summary said 82 of 186 closed when git said 77. A denominator nobody can recompute is a
 * denominator that quietly rounds in the reporter's favour.
 *
 * THE DERIVATION, both halves from files, neither from memory:
 *   - the SET comes from the aspect files' "## Findings raised" tables (the report is the
 *     source of truth for what was found),
 *   - the CLOSED half comes from commit subjects on the remediation branch, which name the
 *     finding ids they land (A09-T04, or "A12-T6, T10" where the bare ids inherit the
 *     aspect to their left).
 *
 * So a row counts as closed when a commit says so, and the commit is the evidence. Editing
 * this file cannot make the count move.
 *
 * Usage:
 *   node scripts/stress-remediation.js                  # ledger for the newest run dir
 *   node scripts/stress-remediation.js --run <dir>      # a specific run
 *   node scripts/stress-remediation.js --open           # only the open rows, with their fixes
 *   node scripts/stress-remediation.js --aspect A09     # one aspect
 *   node scripts/stress-remediation.js --sev Med,Low    # filter severity
 *   node scripts/stress-remediation.js --json           # machine output
 *   node scripts/stress-remediation.js --base main      # compare against another base ref
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const SESSIONS = path.join(REPO, 'outputs', 'sessions');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

/** Newest directory matching a stress-test run, so the tool follows the run without being told. */
function newestRun() {
  if (!fs.existsSync(SESSIONS)) return null;
  const cands = fs
    .readdirSync(SESSIONS)
    .filter((d) => /stress-test/.test(d) && fs.existsSync(path.join(SESSIONS, d, 'aspects')))
    .sort();
  return cands.length ? path.join(SESSIONS, cands[cands.length - 1]) : null;
}

/** Pad so A09-T4 and A09-T-04 are the same key no matter which spelling a commit used. */
const key = (aspect, n) => `${aspect}-T-${String(n).padStart(2, '0')}`;
/** Case ids live in their own namespace: a case key can never collide with a finding key. */
const caseKey = (aspect, n) => `${aspect}#C${String(n).padStart(2, '0')}`;

/**
 * THE TRAP THIS FUNCTION EXISTS FOR. An aspect file numbers its CASES (the test matrix,
 * A09-T25) and its FINDINGS (the findings table, T-01..T-11) in two independent sequences
 * that both look like "T<number>". Commits name whichever id the author was holding, and a
 * naive parser matches A12-T6-the-case against A12-T-06-the-finding and reports a row closed
 * that nobody touched. So each finding declares the cases it covers, in the trailing paren
 * of its text, and a commit naming EITHER closes it.
 */
function casesOf(aspect, findingText) {
  const out = new Set();
  const tok = /\b(A\d\d)-T-?(\d+)\b|\bT-?(\d+)\b/g;
  let m;
  let last = null;
  while ((m = tok.exec(findingText))) {
    if (m[1]) {
      last = m[1];
      out.add(caseKey(m[1], m[2]));
    } else if (m[3] && last) {
      out.add(caseKey(last, m[3]));
    }
  }
  return [...out];
}

function readFindings(runDir) {
  const dir = path.join(runDir, 'aspects');
  const rows = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!/^A\d\d/.test(f)) continue;
    const aspect = f.split('-')[0];
    let inFindings = false;
    for (const ln of fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/)) {
      if (/^##\s/.test(ln)) {
        inFindings = /^##\s+Findings raised/i.test(ln);
        continue;
      }
      if (!inFindings || !ln.startsWith('|')) continue;
      // | T-04 | Med | finding text (case ids) | one concrete fix |
      const cells = ln.split('|').map((c) => c.trim());
      if (cells.length < 5) continue;
      const idm = cells[1].match(/^T-?(\d+)$/);
      if (!idm) continue;
      const sev = cells[2].replace(/\*/g, '').replace(/\s*\(.*\)$/, '').trim();
      rows.push({
        aspect,
        id: key(aspect, idm[1]),
        sev: sev || 'Unlabelled',
        finding: cells[3],
        fix: cells[4] || '',
        file: f,
        cases: casesOf(aspect, cells[3]),
      });
    }
  }
  return rows;
}

/**
 * Closed set from commit subjects+bodies. A bare "T12" inherits the aspect named to its
 * left ON THE SAME LINE only, which is how the commits were actually written; letting it
 * inherit across lines would silently over-count.
 */
function closedFromGit(base) {
  let log;
  try {
    log = execSync(`git log --format=%s%n%b ${base}..HEAD`, {
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 1e8,
    });
  } catch (e) {
    console.error(`Cannot read git history against "${base}": ${e.message}`);
    console.error('Unable to derive the closed set is not the same as nothing being closed.');
    process.exit(2);
  }
  const closed = new Map();
  const tok = /\b(A\d\d)-T-?(\d+)\b|\bT-?(\d+)\b/g;
  for (const line of log.split(/\r?\n/)) {
    let m;
    let lastAspect = null;
    tok.lastIndex = 0;
    while ((m = tok.exec(line))) {
      const [a, n] = m[1] ? [m[1], m[2]] : m[3] && lastAspect ? [lastAspect, m[3]] : [null, null];
      if (!a) continue;
      lastAspect = a;
      // A commit id is ambiguous by construction, so record it in BOTH namespaces and let
      // the finding decide which one reaches it.
      closed.set(key(a, n), line);
      closed.set(caseKey(a, n), line);
    }
  }
  return closed;
}

function main() {
  const runDir = arg('run') ? path.resolve(arg('run')) : newestRun();
  if (!runDir || !fs.existsSync(runDir)) {
    console.error('No stress-test run directory found under outputs/sessions/.');
    process.exit(2);
  }
  const base = arg('base', 'main');
  const rows = readFindings(runDir);
  const closed = closedFromGit(base);

  const sevFilter = arg('sev') ? arg('sev').split(',').map((s) => s.trim()) : null;
  const aspectFilter = arg('aspect');

  const scoped = rows.filter(
    (r) => (!sevFilter || sevFilter.includes(r.sev)) && (!aspectFilter || r.aspect === aspectFilter)
  );
  // The two passes wrote ids differently: the High passes named CASES (A09-T25), the Med/Low
  // passes named FINDINGS (A12-T6). Both are honoured, and which one matched is recorded,
  // because a case-only match is weaker evidence than a finding-id match and a reader is
  // entitled to know which kind of claim the number rests on.
  for (const r of scoped) {
    const byFinding = closed.has(r.id);
    const byCase = r.cases.find((k) => closed.has(k));
    r.closed = byFinding || Boolean(byCase);
    r.match = byFinding ? 'finding-id' : byCase ? 'case-id' : null;
    r.evidence = byFinding ? closed.get(r.id) : byCase ? closed.get(byCase) : null;
  }

  const open = scoped.filter((r) => !r.closed);
  const done = scoped.filter((r) => r.closed);

  if (flag('json')) {
    console.log(JSON.stringify({ runDir, base, total: scoped.length, closed: done.length, open }, null, 2));
    return;
  }

  console.log(`Stress-test remediation ledger`);
  console.log(`  run:  ${path.relative(REPO, runDir)}`);
  console.log(`  base: ${base}`);
  console.log('');

  const sevOrder = ['Critical', 'High', 'Med-High', 'Med', 'Low', 'NOT RUN', 'Unlabelled'];
  const bySev = {};
  for (const r of scoped) {
    bySev[r.sev] = bySev[r.sev] || { total: 0, closed: 0 };
    bySev[r.sev].total++;
    if (r.closed) bySev[r.sev].closed++;
  }
  console.log('  Severity      closed / total');
  for (const s of sevOrder) {
    if (!bySev[s]) continue;
    console.log(`  ${s.padEnd(13)} ${String(bySev[s].closed).padStart(4)} / ${bySev[s].total}`);
  }
  console.log('');

  if (flag('open') || !flag('quiet')) {
    const byAspect = {};
    for (const r of open) (byAspect[r.aspect] = byAspect[r.aspect] || []).push(r);
    console.log(`  OPEN: ${open.length} of ${scoped.length}`);
    for (const a of Object.keys(byAspect).sort()) {
      console.log(`    ${a}: ${byAspect[a].map((r) => r.id.replace(`${a}-`, '')).join(', ')}`);
    }
  }

  if (flag('open')) {
    console.log('\n---\n');
    for (const r of open) {
      console.log(`### ${r.id}  [${r.sev}]  (${r.file})`);
      console.log(`FINDING: ${r.finding}`);
      console.log(`FIX:     ${r.fix}`);
      console.log('');
    }
  }
}

main();
