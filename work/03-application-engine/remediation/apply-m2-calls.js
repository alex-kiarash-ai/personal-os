// Remediation Milestone 2: F05, F07 (request side), F15, F12, F13.
//
//   F05  master CV + system prompt moved into CACHED system blocks
//   F07  assistant prefill so the model cannot emit a preamble before the JSON
//   F15  match max_tokens 1024 -> 2048 (truncation risk; unused tokens cost nothing)
//   F12  BD Trigger Search gains the house-standard 4x/5s retry
//   F13  limit_per_input 10 -> 25
//
// All edits are anchored string surgery on the existing node source: the master CV is
// a 9.3K-char literal and re-emitting it wholesale risks corrupting it, so the CV is
// never rewritten, only moved by relocating its wrapper.
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
const ENGINES = [['#03', '9XuIEfxS71DEetVR'], ['#14', '9x9M3EnEEeX3O8dy']];
const ALLOWED_SETTINGS = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution',
  'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'];

function must(c, m) { if (!c) { console.error('ASSERT FAILED:', m); process.exit(1); } }
const node = (w, n) => w.nodes.find((x) => x.name === n);
function stripComments(src) {
  return String(src || '').replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ').replace(/([^:])\/\/.*$/gm, '$1');
}
function syntaxOk(src, label) {
  try { new Function(src); return true; }
  catch (e) { console.error(`  SYNTAX ERROR in ${label}: ${e.message}`); return false; }
}
function replaceOnce(src, from, to, label) {
  const n = src.split(from).length - 1;
  must(n === 1, `${label}: expected exactly 1 occurrence of anchor, found ${n}`);
  return src.split(from).join(to);
}

// The CV wrapper as it appears in the SOURCE text (literal backslash-n sequences
// inside a template literal), moved verbatim from the user message into a system block.
const CV_WRAPPER = '`<master_cv>\\n${MASTER_CV}\\n</master_cv>\\n\\n<job_posting>';

const SYSTEM_BLOCKS_DEF = [
  '// F05 prompt caching: the static prefix (system prompt + the ~9.3K-char master CV)',
  '// was resent at full input price on every single call. It now sits in cached system',
  '// blocks with the cache_control breakpoint at the end of the CV, and the user message',
  '// carries only per-job content. Jobs run back to back inside a run, so the cache stays',
  '// warm for the whole batch. Cache tokens are priced by the F04 RATES map',
  '// (cache write 1.25x input, cache read 0.1x).',
  'const SYSTEM_BLOCKS = [',
  '  { type: \'text\', text: SYSTEM },',
  '  { type: \'text\', text: `<master_cv>\\n${MASTER_CV}\\n</master_cv>`, cache_control: { type: \'ephemeral\' } }',
  '];',
  ''
].join('\n');

// F07: an assistant turn opening with "{" forces raw JSON, so a preamble line can no
// longer waste a paid call. Both parse nodes already recover the missing brace.
const PREFILL = ', { role: \'assistant\', content: \'{\' }';

function patchBuildNode(src, which) {
  let out = src;
  out = replaceOnce(out, CV_WRAPPER, '`<job_posting>', `${which}: move CV out of user message`);
  const anchor = which === 'match' ? 'const body = {' : 'const writer_body = {';
  out = replaceOnce(out, anchor, SYSTEM_BLOCKS_DEF + anchor, `${which}: insert SYSTEM_BLOCKS`);
  out = replaceOnce(out, '  system: SYSTEM,', '  system: SYSTEM_BLOCKS,', `${which}: point at SYSTEM_BLOCKS`);
  out = replaceOnce(out, '  messages: [ { role: \'user\', content: userContent } ]',
    '  messages: [ { role: \'user\', content: userContent }' + PREFILL + ' ]', `${which}: prefill`);
  if (which === 'match') {
    out = replaceOnce(out, '  max_tokens: 1024,', '  max_tokens: 2048,', 'match: F15 max_tokens');
  }
  if (which === 'writer') {
    // The writer's system prompt told the model the master CV would arrive in the user
    // message. F05 moves it into a system block, so that sentence became false and the
    // instruction would point the model at content that is no longer there.
    out = replaceOnce(out,
      'The master CV, job posting, fit analysis, and tone instruction are provided in the user message.',
      'The master CV is provided as a separate system block above, tagged <master_cv>. The job posting, fit analysis, and tone instruction are provided in the user message.',
      'writer: system prompt describes where the CV now lives');
  }
  return out;
}

function buildNewGraph(wf) {
  const w = JSON.parse(JSON.stringify(wf));

  const bm = node(w, 'Build Match Request');
  const bw = node(w, 'Build Writer Request');
  must(bm && bw, 'build nodes missing');
  bm.parameters.jsCode = patchBuildNode(bm.parameters.jsCode, 'match');
  bw.parameters.jsCode = patchBuildNode(bw.parameters.jsCode, 'writer');

  // F12: the node that starts the entire run was the only external call with zero
  // retries. Both Claude calls and both Gotenberg calls already retry 4x/5s.
  const trig = node(w, 'BD Trigger Search');
  must(trig, 'BD Trigger Search missing');
  trig.retryOnFail = true;
  trig.maxTries = 4;
  trig.waitBetweenTries = 5000;

  // F13: each search row was capped at 10 postings per run and the remainder was
  // dropped for good, since discover_new never returns the same posting twice.
  must(/limit_per_input=10\b/.test(trig.parameters.url), 'limit_per_input=10 not found in trigger url');
  trig.parameters.url = trig.parameters.url.replace('limit_per_input=10', 'limit_per_input=25');

  return w;
}

function verify(v, before) {
  const bm = node(v, 'Build Match Request').parameters.jsCode;
  const bw = node(v, 'Build Writer Request').parameters.jsCode;
  const trig = node(v, 'BD Trigger Search');
  const o = {};
  for (const [label, src] of [['Build Match Request', bm], ['Build Writer Request', bw]]) {
    o[`${label}: syntax`] = syntaxOk(src, label);
    o[`${label}: SYSTEM_BLOCKS defined`] = /const SYSTEM_BLOCKS = \[/.test(src);
    o[`${label}: cache_control set`] = /cache_control: \{ type: 'ephemeral' \}/.test(src);
    o[`${label}: system points at blocks`] = /system: SYSTEM_BLOCKS,/.test(stripComments(src));
    o[`${label}: plain system: SYSTEM gone`] = !/system: SYSTEM,/.test(stripComments(src));
    o[`${label}: CV out of user message`] = !/userContent = `<master_cv>/.test(src);
    o[`${label}: CV still present once`] = (src.match(/\$\{MASTER_CV\}/g) || []).length === 1;
    o[`${label}: assistant prefill`] = /role: 'assistant', content: '\{'/.test(src);
  }
  o['writer: prompt points at the system block'] = /provided as a separate system block above, tagged <master_cv>/.test(bw);
  o['writer: stale "in the user message" claim gone'] = !/master CV, job posting, fit analysis, and tone instruction are provided in the user message/.test(bw);
  o['match: max_tokens 2048'] = /max_tokens: 2048,/.test(bm);
  o['writer: max_tokens unchanged 4096'] = /max_tokens: 4096,/.test(bw);
  o['F12: trigger retryOnFail'] = trig.retryOnFail === true && trig.maxTries === 4 && trig.waitBetweenTries === 5000;
  o['F13: limit_per_input 25'] = /limit_per_input=25\b/.test(trig.parameters.url);
  o['node count unchanged'] = v.nodes.length === before.nodes.length;
  o['errorWorkflow preserved'] = (v.settings || {}).errorWorkflow === (before.settings || {}).errorWorkflow;
  return o;
}

async function run(label, id) {
  console.log(`\n=== ${label} (${id}) ${APPLY ? 'APPLY' : 'DRY RUN'} ===`);
  const wf = await (await fetch(`${API}/workflows/${id}`, { headers: HDRS })).json();
  must(wf.nodes, 'fetch failed');
  const wasActive = wf.active;
  console.log(`before: ${wf.nodes.length} nodes, active=${wasActive}`);

  const built = buildNewGraph(wf);
  let bad = 0;
  const dry = verify(built, wf);
  for (const [k, ok] of Object.entries(dry)) if (!ok) { bad++; console.log(`  FAIL [dry] ${k}`); }
  console.log(`  dry checks: ${Object.keys(dry).length} run, ${bad} failed`);
  must(bad === 0, `${bad} dry check(s) failed on ${label}, nothing written`);
  if (!APPLY) { console.log(`  DRY RUN CLEAN for ${label}.`); return; }

  fs.mkdirSync(BACKUPS, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const bak = path.join(BACKUPS, `${id}-pre-M2-${ts}.json`);
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
  for (const [k, ok] of Object.entries(verify(v, wf))) if (!ok) { bad++; console.log(`  FAIL [live] ${k}`); }
  if (v.active !== wasActive) bad++;
  console.log(`  live checks done, ${bad} failed | active ${wasActive} -> ${v.active}`);
  must(bad === 0, `${bad} live check(s) failed on ${label} - RESTORE FROM ${path.basename(bak)}`);
}

(async () => {
  for (const [label, id] of ENGINES) await run(label, id);
  console.log(`\nF05 + F07 + F12 + F13 + F15 ${APPLY ? 'APPLIED AND VERIFIED' : 'DRY RUN CLEAN'} on both engines.`);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
