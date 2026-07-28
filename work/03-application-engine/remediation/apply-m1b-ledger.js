// Remediation Milestone 1b: F03 + F04, with F07 (parse side), F14 and F16 folded in
// because they live in the same four nodes and batching them means one PUT per engine
// instead of four.
//
//   F03  per-stage spend logged where it is first known
//   F04  RATES map keyed by model, all four billable usage fields
//   F07  three-stage JSON extractor in both parse nodes
//   F14  scores clamped to 0-100 in Parse Match
//   F16  dash sanitizers deleted from Parse Writer, QA keeps sole ownership
//
// SAFETY: dry-run by default; --apply to write. Backup-first, GET read-back, active
// flag hard-verified.
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
const ALLOWED_SETTINGS = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution',
  'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'];

const RATES_LIB = fs.readFileSync(path.join(NODES, '_rates-lib.js'), 'utf8');
const jsFile = (f) => {
  const src = fs.readFileSync(path.join(NODES, f), 'utf8');
  if (!src.includes('__RATES_LIB__')) return src;
  return src.replace('__RATES_LIB__', RATES_LIB);
};

function must(c, m) { if (!c) { console.error('ASSERT FAILED:', m); process.exit(1); } }
const node = (w, n) => w.nodes.find((x) => x.name === n);
function stripComments(src) {
  return String(src || '').replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ').replace(/([^:])\/\/.*$/gm, '$1');
}
// n8n Code node bodies are function bodies, so this catches syntax errors before they
// reach production, where they would only surface as a failed run.
function syntaxOk(src, label) {
  try { new Function(src); return true; }
  catch (e) { console.error(`  SYNTAX ERROR in ${label}: ${e.message}`); return false; }
}

const CODE_SWAPS = [
  ['Parse Match', 'parse-match.js'],
  ['Parse Writer', 'parse-writer.js'],
  ['Format Processed Row', 'format-processed-row.js'],
  ['Format Review Row S5', 'format-review-row-s5.js'],
  ['Compute Costs', 'compute-costs.js']
];
// These appends gain columns, so extra fields must create new columns rather than be
// dropped. F18 later replaces autoMap entirely with explicit mapping.
const EXTRA_DATA_APPENDS = ['Append Processed Job', 'Append Needs Review S5', 'Append Run Log'];

function buildNewGraph(wf) {
  const w = JSON.parse(JSON.stringify(wf));
  for (const [name, file] of CODE_SWAPS) {
    must(node(w, name), `${name} missing`);
    node(w, name).parameters.jsCode = jsFile(file);
  }
  for (const name of EXTRA_DATA_APPENDS) {
    const n = node(w, name);
    must(n, `${name} missing`);
    n.parameters.options = Object.assign({}, n.parameters.options || {}, { handlingExtraData: 'insertInNewColumn' });
  }
  return w;
}

function verify(v, before) {
  const c = (n) => node(v, n).parameters.jsCode;
  const out = {};
  for (const [name] of CODE_SWAPS) {
    out[`${name}: syntax`] = syntaxOk(c(name), name);
    out[`${name}: no placeholder left`] = !c(name).includes('__RATES_LIB__');
  }
  for (const name of ['Format Processed Row', 'Format Review Row S5', 'Compute Costs']) {
    out[`${name}: RATES lib injected once`] = (c(name).match(/const RATES = \{/g) || []).length === 1;
    out[`${name}: uses costOf`] = /costOf\(/.test(stripComments(c(name)));
  }
  out['Format Processed Row: stage2_cost column'] = /stage2_cost:/.test(c('Format Processed Row'));
  out['Format Review Row S5: stage4_cost column'] = /stage4_cost:/.test(c('Format Review Row S5'));
  out['Compute Costs: per-stage columns'] = /stage2_cost,/.test(c('Compute Costs')) && /stage4_cost/.test(c('Compute Costs'));
  out['Compute Costs: no hardcoded IN_RATE'] = !/const IN_RATE/.test(stripComments(c('Compute Costs')));
  out['Compute Costs: counts cache tokens'] = /cache_creation_input_tokens/.test(c('Compute Costs'));
  out['Parse Match: clamps 0-100'] = /Math\.min\(100, Math\.max\(0/.test(stripComments(c('Parse Match')));
  out['Parse Match: captures cache tokens'] = /stage2_cache_write_tokens/.test(c('Parse Match'));
  out['Parse Match: substring fallback'] = /lastIndexOf\('\}'\)/.test(stripComments(c('Parse Match')));
  out['Parse Writer: captures stage4_model'] = /stage4_model:/.test(c('Parse Writer'));
  out['Parse Writer: sanitizers removed'] = !/function deEm|function deDashProse/.test(stripComments(c('Parse Writer')));
  out['QA still owns stripProse'] = /stripProse/.test(node(v, 'QA + Fill Templates').parameters.jsCode);
  for (const name of EXTRA_DATA_APPENDS) {
    out[`${name}: insertInNewColumn`] = (node(v, name).parameters.options || {}).handlingExtraData === 'insertInNewColumn';
  }
  out['node count unchanged'] = v.nodes.length === before.nodes.length;
  out['errorWorkflow preserved'] = (v.settings || {}).errorWorkflow === (before.settings || {}).errorWorkflow;
  return out;
}

async function run(label, id) {
  console.log(`\n=== ${label} (${id}) ${APPLY ? 'APPLY' : 'DRY RUN'} ===`);
  const wf = await (await fetch(`${API}/workflows/${id}`, { headers: HDRS })).json();
  must(wf.nodes, 'fetch failed');
  const wasActive = wf.active;
  console.log(`before: ${wf.nodes.length} nodes, active=${wasActive}`);

  const built = buildNewGraph(wf);
  let bad = 0;
  for (const [k, ok] of Object.entries(verify(built, wf))) { if (!ok) { bad++; console.log(`  FAIL [dry] ${k}`); } }
  console.log(`  dry checks: ${Object.keys(verify(built, wf)).length} run, ${bad} failed`);
  must(bad === 0, `${bad} dry check(s) failed on ${label}, nothing written`);

  if (!APPLY) { console.log(`  DRY RUN CLEAN for ${label}.`); return; }

  fs.mkdirSync(BACKUPS, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const bak = path.join(BACKUPS, `${id}-pre-F03F04-${ts}.json`);
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
  for (const [k, ok] of Object.entries(verify(v, wf))) { if (!ok) { bad++; console.log(`  FAIL [live] ${k}`); } }
  const activeOk = v.active === wasActive;
  if (!activeOk) bad++;
  console.log(`  live checks done, ${bad} failed | active ${wasActive} -> ${v.active}`);
  console.log(`after: ${v.nodes.length} nodes`);
  must(bad === 0, `${bad} live check(s) failed on ${label} - RESTORE FROM ${path.basename(bak)}`);
}

(async () => {
  for (const [label, id] of ENGINES) await run(label, id);
  console.log(`\nF03 + F04 (+F07 parse side, F14, F16) ${APPLY ? 'APPLIED AND VERIFIED' : 'DRY RUN CLEAN'} on both engines.`);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
