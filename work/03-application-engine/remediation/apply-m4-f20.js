// Remediation F20, Option B (Shaheen's decision 2026-07-27): cross-ledger dedup.
//
// The two lanes keep separate ledgers, so a posting matching both search sets could be
// discovered, matched and drafted by BOTH engines, producing two applications with two
// different CVs for one vacancy. Option B: the first engine to source a job owns it;
// the other lane skips it, both on intake and on drain.
//
// Each engine gains one Sheets read pointing at the SIBLING's processed_jobs, chained
// between Read Processed Log and Dedup Against Log. Dedup reads both by name.
// Fail-open by design: if the sibling ledger cannot be read, this lane proceeds as
// before rather than blocking itself.
//
// SAFETY: dry-run by default; --apply to write.
'use strict';
const fs = require('fs');
const path = require('path');

const CFG = path.join(__dirname, '..', 'config');
const BACKUPS = path.join(__dirname, '..', '..', '..', 'scripts', 'n8n-backups');
const API = 'https://n8n.shaheenkiarash.com/api/v1';
const KEY = fs.readFileSync(path.join(CFG, 'n8n-api-key.txt'), 'utf8').trim();
const HDRS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };

const APPLY = process.argv.includes('--apply');
const SHEET_03 = '19puwN6wxFHI7iICrdafiFn1Diqq7qJTe5-5r0Y2XQFY';
const SHEET_14 = '11lvksV5NmLK7vWvt4oHIPTXZ1pwRVi67UrWVI3lrAHQ';
const ENGINES = [
  ['#03', '9XuIEfxS71DEetVR', SHEET_14],
  ['#14', '9x9M3EnEEeX3O8dy', SHEET_03]
];
const ALLOWED_SETTINGS = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution',
  'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'];

function must(c, m) { if (!c) { console.error('ASSERT FAILED:', m); process.exit(1); } }
const node = (w, n) => w.nodes.find((x) => x.name === n);
function syntaxOk(src, l) { try { new Function(src); return true; } catch (e) { console.error(`  SYNTAX ${l}: ${e.message}`); return false; } }
function replaceOnce(src, from, to, label) {
  const n = src.split(from).length - 1;
  must(n === 1, `${label}: expected 1 anchor, found ${n}`);
  return src.split(from).join(to);
}

const SIBLING_BLOCK = `
// F20 Option B: the sibling lane owns any job it has already sourced. Without this the
// same vacancy can be drafted by both engines with two different CVs, and paid for
// twice. Fail-open: an unreadable sibling ledger must never block this lane.
const siblingOwned = new Set();
try {
  for (const li of $('Read Sibling Log').all()) {
    const sj = li.json || {};
    const sid = sj.job_posting_id ? String(sj.job_posting_id) : '';
    if (sid) siblingOwned.add(sid);
  }
} catch (e) { /* sibling unreadable, proceed as before */ }
`;

function buildNewGraph(wf, siblingSheet) {
  const w = JSON.parse(JSON.stringify(wf));
  const rpl = node(w, 'Read Processed Log');
  const dedup = node(w, 'Dedup Against Log');
  must(rpl && dedup, 'required nodes missing');
  must(!node(w, 'Read Sibling Log'), 'Read Sibling Log already present');

  w.nodes.push({
    parameters: {
      documentId: { __rl: true, value: siblingSheet, mode: 'id' },
      sheetName: { __rl: true, value: 'processed_jobs', mode: 'name' },
      options: {}
    },
    id: 'read-sibling-log', name: 'Read Sibling Log',
    type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: [rpl.position[0] + 100, rpl.position[1] + 200],
    credentials: JSON.parse(JSON.stringify(rpl.credentials)),
    executeOnce: true, alwaysOutputData: true,
    retryOnFail: true, maxTries: 4, waitBetweenTries: 5000,
    onError: 'continueRegularOutput'
  });

  w.connections['Read Processed Log'] = { main: [[{ node: 'Read Sibling Log', type: 'main', index: 0 }]] };
  w.connections['Read Sibling Log'] = { main: [[{ node: 'Dedup Against Log', type: 'main', index: 0 }]] };

  let src = dedup.parameters.jsCode;
  src = replaceOnce(src, 'const out = [];', SIBLING_BLOCK.trim() + '\nconst out = [];', 'F20 sibling set');
  src = replaceOnce(src,
    '  if (id && (done.has(id) || inRun.has(id) || drainable.has(id))) continue;',
    '  if (id && siblingOwned.has(id)) continue; // F20: sibling lane owns it\n  if (id && (done.has(id) || inRun.has(id) || drainable.has(id))) continue;',
    'F20 intake skip');
  src = replaceOnce(src, '  if (inRun.has(id)) continue;',
    '  if (inRun.has(id) || siblingOwned.has(id)) continue; // F20: sibling lane owns it',
    'F20 drain skip');
  dedup.parameters.jsCode = src;
  return w;
}

function verify(v, before, siblingSheet) {
  const d = node(v, 'Dedup Against Log').parameters.jsCode;
  const sib = node(v, 'Read Sibling Log');
  return {
    'Dedup syntax': syntaxOk(d, 'Dedup'),
    'sibling set built': /const siblingOwned = new Set\(\)/.test(d),
    'intake skip wired': /if \(id && siblingOwned\.has\(id\)\) continue;/.test(d),
    'drain skip wired': /inRun\.has\(id\) \|\| siblingOwned\.has\(id\)/.test(d),
    'fail-open try/catch': /catch \(e\) \{ \/\* sibling unreadable/.test(d),
    'Read Sibling Log added': !!sib,
    'sibling points at the OTHER sheet': sib && sib.parameters.documentId.value === siblingSheet,
    'sibling reads processed_jobs': sib && sib.parameters.sheetName.value === 'processed_jobs',
    'sibling executeOnce': sib && sib.executeOnce === true,
    'sibling alwaysOutputData': sib && sib.alwaysOutputData === true,
    'chain RPL -> Sibling': JSON.stringify(v.connections['Read Processed Log']).includes('Read Sibling Log'),
    'chain Sibling -> Dedup': JSON.stringify(v.connections['Read Sibling Log']).includes('Dedup Against Log'),
    'node count +1': v.nodes.length === before.nodes.length + 1,
    'errorWorkflow preserved': (v.settings || {}).errorWorkflow === (before.settings || {}).errorWorkflow
  };
}

async function run(label, id, siblingSheet) {
  console.log(`\n=== ${label} (${id}) ${APPLY ? 'APPLY' : 'DRY RUN'} | sibling sheet ${siblingSheet.slice(0, 12)}... ===`);
  const wf = await (await fetch(`${API}/workflows/${id}`, { headers: HDRS })).json();
  must(wf.nodes, 'fetch failed');
  const wasActive = wf.active;
  console.log(`before: ${wf.nodes.length} nodes, active=${wasActive}`);

  const built = buildNewGraph(wf, siblingSheet);
  let bad = 0;
  const dry = verify(built, wf, siblingSheet);
  for (const [k, ok] of Object.entries(dry)) if (!ok) { bad++; console.log(`  FAIL [dry] ${k}`); }
  console.log(`  dry checks: ${Object.keys(dry).length} run, ${bad} failed`);
  must(bad === 0, `${bad} dry check(s) failed on ${label}`);
  if (!APPLY) { console.log(`  DRY RUN CLEAN for ${label}.`); return; }

  fs.mkdirSync(BACKUPS, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const bak = path.join(BACKUPS, `${id}-pre-F20-${ts}.json`);
  fs.writeFileSync(bak, JSON.stringify(wf, null, 2));
  console.log('  backup:', path.basename(bak));

  const settings = {};
  for (const k of ALLOWED_SETTINGS) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
  const res = await fetch(`${API}/workflows/${id}`, { method: 'PUT', headers: HDRS,
    body: JSON.stringify({ name: built.name, nodes: built.nodes, connections: built.connections, settings }) });
  const rb = await res.json();
  must(res.ok, 'PUT failed: ' + res.status + ' ' + JSON.stringify(rb).slice(0, 600));

  let v = await (await fetch(`${API}/workflows/${id}`, { headers: HDRS })).json();
  if (wasActive && v.active !== true) {
    console.log('  PUT dropped the active flag, re-activating...');
    await fetch(`${API}/workflows/${id}/activate`, { method: 'POST', headers: HDRS });
    v = await (await fetch(`${API}/workflows/${id}`, { headers: HDRS })).json();
  }
  bad = 0;
  for (const [k, ok] of Object.entries(verify(v, wf, siblingSheet))) if (!ok) { bad++; console.log(`  FAIL [live] ${k}`); }
  if (v.active !== wasActive) bad++;
  console.log(`  live checks done, ${bad} failed | active ${wasActive} -> ${v.active} | nodes ${v.nodes.length}`);
  must(bad === 0, `${bad} live check(s) failed on ${label} - RESTORE FROM ${path.basename(bak)}`);
}

(async () => {
  for (const [label, id, sib] of ENGINES) await run(label, id, sib);
  console.log(`\nF20 Option B ${APPLY ? 'APPLIED AND VERIFIED' : 'DRY RUN CLEAN'} on both engines.`);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
