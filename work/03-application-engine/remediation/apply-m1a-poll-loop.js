// Remediation Milestone 1a: F01 + F02, applied as one rework of the poll loop.
//
// SAFETY: dry-run by default. Without --apply nothing is written; the new graph is
// built in memory, every verification check is run against it, and a diff is printed.
// Pass --apply only after reviewing the dry output.
//
// F02 hold-all: replace the per-item `Snapshot Ready?` IF with an aggregate gate so
// the whole batch advances together and the pipeline below runs exactly once per run.
// F01 loud timeouts: partition ready vs exhausted and send exhausted snapshots to a
// needs_review row carrying the snapshot_id, instead of letting them parse into an
// empty successful run.
//
// Graph change (per engine): -1 node (Snapshot Ready?), +5 nodes, net 41 -> 45.
//   Poll Fetch Snapshot -> Poll Gate -> All Resolved?
//     false -> Poll Wait                       (keep looping)
//     true  -> Snapshot Ready Item?
//                true  -> Parse Jobs           (unchanged downstream)
//                false -> Format Timeout Row -> Append Timeout Review
'use strict';
const fs = require('fs');
const path = require('path');

const CFG = path.join(__dirname, '..', 'config');
const NODES = path.join(__dirname, 'nodes');
const BACKUPS = path.join(__dirname, '..', '..', '..', 'scripts', 'n8n-backups');
const API = 'https://n8n.shaheenkiarash.com/api/v1';
const KEY = fs.readFileSync(path.join(CFG, 'n8n-api-key.txt'), 'utf8').trim();
const HDRS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };

const APPLY = process.argv.includes('--apply');
const ENGINES = [['#03', '9XuIEfxS71DEetVR'], ['#14', '9x9M3EnEEeX3O8dy']];
const jsFile = (f) => fs.readFileSync(path.join(NODES, f), 'utf8');

const ALLOWED_SETTINGS = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution',
  'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'];

function must(c, m) { if (!c) { console.error('ASSERT FAILED:', m); process.exit(1); } }
const node = (w, n) => w.nodes.find((x) => x.name === n);

function ifNode(id, name, expr, pos) {
  return { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: id + '-c', leftValue: expr, rightValue: 'true', operator: { type: 'string', operation: 'equals' } }],
      combinator: 'and' }, options: {} },
    id, name, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos };
}

// Build the new graph in memory. Pure function of the fetched workflow.
function buildNewGraph(wf) {
  must(node(wf, 'Snapshot Ready?'), 'Snapshot Ready? missing (already reworked?)');
  must(node(wf, 'Parse Jobs'), 'Parse Jobs missing');
  must(node(wf, 'Poll Wait'), 'Poll Wait missing');
  must(node(wf, 'Poll Fetch Snapshot'), 'Poll Fetch Snapshot missing');
  const s3append = node(wf, 'Append Needs Review S3');
  must(s3append, 'Append Needs Review S3 missing');
  must(s3append.credentials, 'Append Needs Review S3 has no credentials to copy');

  const w = JSON.parse(JSON.stringify(wf));

  node(w, 'Parse Jobs').parameters.jsCode = jsFile('parse-jobs.js');

  // The poll fetch resolved its snapshot id through a paired-item lookup back to
  // Attach Row Context. That worked while the loop ran through an IF, which preserves
  // pairing. Poll Gate is a run-once-for-all-items Code node, so on the second
  // iteration the lookup would no longer resolve. Read the id off the item instead:
  // _snapshot_id on loop-back passes, snapshot_id on the first pass straight from
  // Attach Row Context.
  const pfs = node(w, 'Poll Fetch Snapshot');
  const oldUrl = pfs.parameters.url;
  must(/snapshot_id/.test(oldUrl), 'Poll Fetch Snapshot url does not reference snapshot_id');
  pfs.parameters.url = '=https://api.brightdata.com/datasets/v3/snapshot/{{ $json._snapshot_id || $json.snapshot_id }}?format=json';

  w.nodes = w.nodes.filter((n) => n.name !== 'Snapshot Ready?');

  w.nodes.push(
    { parameters: { jsCode: jsFile('poll-gate.js') }, id: 'poll-gate', name: 'Poll Gate',
      type: 'n8n-nodes-base.code', typeVersion: 2, position: [-160, 300] },
    ifNode('all-resolved', 'All Resolved?', '={{ $json._allResolved ? "true" : "false" }}', [60, 300]),
    ifNode('snap-ready-item', 'Snapshot Ready Item?', '={{ $json._ready ? "true" : "false" }}', [280, 300]),
    { parameters: { jsCode: jsFile('format-timeout-row.js') }, id: 'fmt-timeout', name: 'Format Timeout Row',
      type: 'n8n-nodes-base.code', typeVersion: 2, position: [280, 520] },
    { parameters: { operation: 'append',
        documentId: JSON.parse(JSON.stringify(s3append.parameters.documentId)),
        sheetName: JSON.parse(JSON.stringify(s3append.parameters.sheetName)),
        columns: { mappingMode: 'autoMapInputData', matchingColumns: [], schema: [] }, options: {} },
      id: 'append-timeout', name: 'Append Timeout Review',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: [500, 520],
      credentials: JSON.parse(JSON.stringify(s3append.credentials)),
      retryOnFail: true, maxTries: 4, waitBetweenTries: 5000 }
  );

  const C = w.connections;
  delete C['Snapshot Ready?'];
  C['Poll Fetch Snapshot'] = { main: [[{ node: 'Poll Gate', type: 'main', index: 0 }]] };
  C['Poll Gate'] = { main: [[{ node: 'All Resolved?', type: 'main', index: 0 }]] };
  C['All Resolved?'] = { main: [
    [{ node: 'Snapshot Ready Item?', type: 'main', index: 0 }],
    [{ node: 'Poll Wait', type: 'main', index: 0 }]
  ] };
  C['Snapshot Ready Item?'] = { main: [
    [{ node: 'Parse Jobs', type: 'main', index: 0 }],
    [{ node: 'Format Timeout Row', type: 'main', index: 0 }]
  ] };
  C['Format Timeout Row'] = { main: [[{ node: 'Append Timeout Review', type: 'main', index: 0 }]] };

  return w;
}

// Every check runs against a graph object, so the identical suite validates the
// in-memory dry-run result AND the post-PUT read-back.
// Checks must read EXECUTABLE code, not comments. The rewritten Parse Jobs documents
// the paired-item lookup it replaced, so a naive substring test for that call name
// matches the explanatory comment and reports a false failure.
function stripComments(src) {
  return String(src || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
    .replace(/([^:])\/\/.*$/gm, '$1');
}

function verify(v, before) {
  const names = v.nodes.map((n) => n.name);
  const pjRaw = node(v, 'Parse Jobs').parameters.jsCode;
  const pj = stripComments(pjRaw);
  const reachable = new Set();
  (function walk(n) {
    if (reachable.has(n)) return;
    reachable.add(n);
    const c = v.connections[n];
    if (!c) return;
    for (const out of c.main || []) for (const e of out || []) walk(e.node);
  })('Poll Fetch Snapshot');

  return {
    'Snapshot Ready? gone': !names.includes('Snapshot Ready?'),
    'no dangling ref to Snapshot Ready?': !JSON.stringify(v.connections).includes('Snapshot Ready?'),
    'Poll Gate added': names.includes('Poll Gate'),
    'All Resolved? added': names.includes('All Resolved?'),
    'Snapshot Ready Item? added': names.includes('Snapshot Ready Item?'),
    'Format Timeout Row added': names.includes('Format Timeout Row'),
    'Append Timeout Review added': names.includes('Append Timeout Review'),
    'Parse Jobs uses _ctx': pj.includes('item.json._ctx'),
    'Parse Jobs drops the paired-item call': !/\.\s*itemMatching\s*\(/.test(pj),
    'loop-back edge to Poll Wait': JSON.stringify(v.connections['All Resolved?']).includes('Poll Wait'),
    'ready lane reaches Parse Jobs': reachable.has('Parse Jobs'),
    'timeout lane reaches append': reachable.has('Append Timeout Review'),
    'downstream still reaches Append Run Log': reachable.has('Append Run Log'),
    'node count 45': v.nodes.length === 45,
    'poll fetch reads id off the item': /_snapshot_id \|\| \$json\.snapshot_id/.test(node(v, 'Poll Fetch Snapshot').parameters.url),
    'poll fetch drops cross-node pairing': !/\$\('Attach Row Context'\)/.test(node(v, 'Poll Fetch Snapshot').parameters.url),
    'Poll Gate sets pairedItem': /pairedItem/.test(stripComments(node(v, 'Poll Gate').parameters.jsCode)),
    'errorWorkflow preserved': (v.settings || {}).errorWorkflow === (before.settings || {}).errorWorkflow,
    'timezone preserved': (v.settings || {}).timezone === (before.settings || {}).timezone
  };
}

async function run(label, id) {
  console.log(`\n=== ${label} (${id}) ${APPLY ? 'APPLY' : 'DRY RUN'} ===`);
  const wf = await (await fetch(`${API}/workflows/${id}`, { headers: HDRS })).json();
  must(wf.nodes, 'fetch failed');
  const wasActive = wf.active;
  console.log(`before: ${wf.nodes.length} nodes, active=${wasActive}`);

  const built = buildNewGraph(wf);

  console.log('  new/changed nodes: Poll Gate, All Resolved?, Snapshot Ready Item?, Format Timeout Row, Append Timeout Review, Parse Jobs(code)');
  console.log('  removed: Snapshot Ready?');
  console.log('  edges: Poll Fetch Snapshot->Poll Gate->All Resolved? {T:Snapshot Ready Item?, F:Poll Wait}; Snapshot Ready Item? {T:Parse Jobs, F:Format Timeout Row->Append Timeout Review}');

  let bad = 0;
  for (const [k, ok] of Object.entries(verify(built, wf))) { if (!ok) bad++; console.log(`  ${ok ? 'OK  ' : 'FAIL'} [dry] ${k}`); }
  must(bad === 0, `${bad} dry-run check(s) failed on ${label}, nothing written`);

  if (!APPLY) { console.log(`  DRY RUN CLEAN for ${label}. Re-run with --apply to write.`); return; }

  fs.mkdirSync(BACKUPS, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const bak = path.join(BACKUPS, `${id}-pre-F01F02-${ts}.json`);
  fs.writeFileSync(bak, JSON.stringify(wf, null, 2));
  console.log('  backup:', path.basename(bak));

  const settings = {};
  for (const k of ALLOWED_SETTINGS) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
  const res = await fetch(`${API}/workflows/${id}`, { method: 'PUT', headers: HDRS,
    body: JSON.stringify({ name: built.name, nodes: built.nodes, connections: built.connections, settings }) });
  const body = await res.json();
  must(res.ok, 'PUT failed: ' + res.status + ' ' + JSON.stringify(body).slice(0, 600));

  let v = await (await fetch(`${API}/workflows/${id}`, { headers: HDRS })).json();
  if (wasActive && v.active !== true) {
    console.log('  PUT dropped the active flag, re-activating...');
    await fetch(`${API}/workflows/${id}/activate`, { method: 'POST', headers: HDRS });
    v = await (await fetch(`${API}/workflows/${id}`, { headers: HDRS })).json();
  }

  bad = 0;
  for (const [k, ok] of Object.entries(verify(v, wf))) { if (!ok) bad++; console.log(`  ${ok ? 'OK  ' : 'FAIL'} [live] ${k}`); }
  const activeOk = v.active === wasActive;
  if (!activeOk) bad++;
  console.log(`  ${activeOk ? 'OK  ' : 'FAIL'} [live] active preserved (${wasActive} -> ${v.active})`);
  console.log(`after: ${v.nodes.length} nodes, active=${v.active}`);
  must(bad === 0, `${bad} live check(s) failed on ${label} - RESTORE FROM ${path.basename(bak)}`);
}

(async () => {
  for (const [label, id] of ENGINES) await run(label, id);
  console.log(`\nF01 + F02 ${APPLY ? 'APPLIED AND VERIFIED' : 'DRY RUN CLEAN'} on both engines.`);
  console.log('NOT included, tracked separately: F01 step 3, the automatic re-poll recovery lane.');
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
