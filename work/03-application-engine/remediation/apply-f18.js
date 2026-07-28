// Remediation F18: replace autoMapInputData with explicit column mapping on every
// append node, so a renamed header produces a loud node error instead of silently
// dropping a column forever.
//
// Two steps, in this order and for a reason:
//   1. ENSURE HEADERS. Explicit mapping binds to headers that already exist. The
//      stage2_* / stage4_* columns F03 introduced do not exist in the sheets yet (they
//      would have been created on the first run by insertInNewColumn), so mapping to
//      them before they exist would break the append. Missing headers are APPENDED to
//      the end of row 1, never reordered, so existing column data stays aligned.
//   2. SWITCH MAPPING, using the sheet's real post-step-1 header names.
//
// Mapping shape was proven to actually write by probe-explicit-mapping.js against a
// scratch tab before this script was allowed near the engines.
//
// SAFETY: dry-run by default; --apply to write.
'use strict';
const fs = require('fs');
const path = require('path');

const CFG = path.join(__dirname, '..', 'config');
const BACKUPS = path.join(__dirname, '..', '..', '..', 'scripts', 'n8n-backups');
const BASE = 'https://n8n.shaheenkiarash.com';
const API = BASE + '/api/v1';
const KEY = fs.readFileSync(path.join(CFG, 'n8n-api-key.txt'), 'utf8').trim();
const HDRS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };
const SHEETS_CRED = { googleSheetsOAuth2Api: { id: 'UhK77WK48hRv85bo', name: 'Google Sheets account' } };

const APPLY = process.argv.includes('--apply');
const ENGINES = [
  ['#03', '9XuIEfxS71DEetVR', '19puwN6wxFHI7iICrdafiFn1Diqq7qJTe5-5r0Y2XQFY'],
  ['#14', '9x9M3EnEEeX3O8dy', '11lvksV5NmLK7vWvt4oHIPTXZ1pwRVi67UrWVI3lrAHQ']
];
const ALLOWED_SETTINGS = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution',
  'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'];

const S2 = ['stage2_input_tokens', 'stage2_output_tokens', 'stage2_cache_write_tokens', 'stage2_cache_read_tokens', 'stage2_model', 'stage2_cost'];
const S4 = ['stage4_input_tokens', 'stage4_output_tokens', 'stage4_cache_write_tokens', 'stage4_cache_read_tokens', 'stage4_model', 'stage4_cost'];
const NR = ['date', 'stage', 'job_posting_id', 'job_title', 'company_name', 'job_location', 'url', 'fit_score', 'interest_score', 'rank_score', 'reasons'];

// Exactly what each node emits, matching its Format node field-for-field.
const NODE_COLS = {
  'Append Processed Job': { tab: 'processed_jobs', cols: ['job_posting_id', 'date', 'company_name', 'job_title', 'gate_status', ...S2] },
  'Bank Sourced Jobs': { tab: 'processed_jobs', cols: ['job_posting_id', 'date', 'company_name', 'job_title', 'gate_status', 'payload_json'] },
  'Append Run Log': { tab: 'run_log', cols: ['date', 'job_posting_id', 'company', 'location', 'country', 'target_role', 'fit_score', 'interest_score', 'rank_score', 'model', 'input_tokens', 'output_tokens', 'claude_cost', 'brightdata_cost', 'total_cost', 'drive_folder_url', 'job_url', 'status', 'stage2_model', 'stage2_cost', 'stage4_model', 'stage4_cost'] },
  'Append Needs Review S3': { tab: 'needs_review', cols: NR },
  'Append Needs Review S5': { tab: 'needs_review', cols: [...NR, ...S4] },
  'Append Timeout Review': { tab: 'needs_review', cols: NR }
};

function must(c, m) { if (!c) { console.error('ASSERT FAILED:', m); process.exit(1); } }
const node = (w, n) => w.nodes.find((x) => x.name === n);

// Run a list of HTTP ops through a throwaway n8n workflow (the public API has no sheet
// access of its own; this reuses the existing OAuth credential).
async function viaN8n(name, ops) {
  const p = 'f18-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
  const nodes = [{ parameters: { httpMethod: 'GET', path: p, responseMode: 'lastNode', options: {} },
    id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], webhookId: p }];
  ops.forEach((o, i) => nodes.push({
    parameters: Object.assign({ method: o.method, url: o.url, authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleSheetsOAuth2Api', options: {} },
      o.body === undefined ? {} : { sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: JSON.stringify(o.body) }),
    id: 'op' + i, name: 'Op' + i, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
    position: [200 * (i + 1), 0], credentials: SHEETS_CRED, onError: 'continueRegularOutput' }));
  const order = nodes.map((n) => n.name);
  const connections = {};
  for (let i = 0; i < order.length - 1; i++) connections[order[i]] = { main: [[{ node: order[i + 1], type: 'main', index: 0 }]] };
  const c = await fetch(API + '/workflows', { method: 'POST', headers: HDRS,
    body: JSON.stringify({ name: 'TEMP ' + name, nodes, connections, settings: { executionOrder: 'v1' } }) });
  const wf = await c.json();
  must(c.ok, 'temp create failed: ' + JSON.stringify(wf).slice(0, 300));
  try {
    await fetch(`${API}/workflows/${wf.id}/activate`, { method: 'POST', headers: HDRS });
    await new Promise((r) => setTimeout(r, 1400));
    const res = await fetch(`${BASE}/webhook/${p}`);
    const t = await res.text();
    try { return JSON.parse(t); } catch (e) { return { _raw: t }; }
  } finally {
    await fetch(`${API}/workflows/${wf.id}/deactivate`, { method: 'POST', headers: HDRS }).catch(() => {});
    await fetch(`${API}/workflows/${wf.id}`, { method: 'DELETE', headers: HDRS }).catch(() => {});
  }
}

const valUrl = (sheet, range) => `https://sheets.googleapis.com/v4/spreadsheets/${sheet}/values/${encodeURIComponent(range)}`;

async function readHeaders(sheet, tab) {
  const r = await viaN8n('F18 Read ' + tab, [{ method: 'GET', url: valUrl(sheet, `${tab}!A1:BZ1`) }]);
  return (r && r.values && r.values[0]) ? r.values[0] : [];
}

function colLetter(n) { // 1 -> A
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function explicitColumns(cols) {
  const value = {};
  for (const c of cols) value[c] = `={{ $json[${JSON.stringify(c)}] }}`;
  return { mappingMode: 'defineBelow', value, matchingColumns: [],
    schema: cols.map((c) => ({ id: c, displayName: c, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true })),
    // Both false so values reach the sheet with their original types, matching what
    // autoMapInputData did. convertFieldsToString would write fit_score and every cost
    // column as text, which silently breaks any SUM() over the ledger.
    attemptToConvertTypes: false, convertFieldsToString: false };
}

async function run(label, id, sheet) {
  console.log(`\n=== ${label} (${id}) ${APPLY ? 'APPLY' : 'DRY RUN'} ===`);
  const wf = await (await fetch(`${API}/workflows/${id}`, { headers: HDRS })).json();
  must(wf.nodes, 'fetch failed');
  const wasActive = wf.active;

  // ---- step 1: headers -----------------------------------------------------
  const tabs = {};
  for (const [n, spec] of Object.entries(NODE_COLS)) {
    must(node(wf, n), `${n} missing on ${label}`);
    (tabs[spec.tab] = tabs[spec.tab] || new Set());
    spec.cols.forEach((c) => tabs[spec.tab].add(c));
  }
  const writes = [];
  for (const [tab, want] of Object.entries(tabs)) {
    const have = await readHeaders(sheet, tab);
    const missing = Array.from(want).filter((c) => have.indexOf(c) === -1);
    console.log(`  ${tab}: ${have.length} headers, ${missing.length} missing${missing.length ? ' -> ' + missing.join(', ') : ''}`);
    if (missing.length) {
      const final = have.concat(missing);
      writes.push({ tab, final, range: `${tab}!A1:${colLetter(final.length)}1` });
    }
  }
  if (APPLY && writes.length) {
    for (const w of writes) {
      const r = await viaN8n('F18 Header ' + w.tab, [
        { method: 'PUT', url: valUrl(sheet, w.range) + '?valueInputOption=RAW', body: { values: [w.final] } },
        { method: 'GET', url: valUrl(sheet, w.range) }
      ]);
      const back = (r && r.values && r.values[0]) || [];
      must(back.length === w.final.length, `${w.tab}: header read-back ${back.length} != ${w.final.length}`);
      console.log(`  ${w.tab}: headers now ${back.length} (verified)`);
    }
  }

  // ---- step 2: mapping -----------------------------------------------------
  const built = JSON.parse(JSON.stringify(wf));
  for (const [n, spec] of Object.entries(NODE_COLS)) {
    const nn = node(built, n);
    nn.parameters.columns = explicitColumns(spec.cols);
    // handlingExtraData is meaningless once mapping is explicit.
    if (nn.parameters.options) delete nn.parameters.options.handlingExtraData;
  }
  const bad0 = Object.entries(NODE_COLS).filter(([n]) =>
    JSON.stringify(node(built, n).parameters.columns).includes('autoMapInputData')).length;
  console.log(`  mapping: ${Object.keys(NODE_COLS).length} nodes switched, ${bad0} still autoMap`);
  must(bad0 === 0, 'autoMap survived');
  if (!APPLY) { console.log(`  DRY RUN CLEAN for ${label} (headers not written).`); return; }

  fs.mkdirSync(BACKUPS, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const bak = path.join(BACKUPS, `${id}-pre-F18-${ts}.json`);
  fs.writeFileSync(bak, JSON.stringify(wf, null, 2));
  console.log('  backup:', path.basename(bak));

  const settings = {};
  for (const k of ALLOWED_SETTINGS) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
  const res = await fetch(`${API}/workflows/${id}`, { method: 'PUT', headers: HDRS,
    body: JSON.stringify({ name: built.name, nodes: built.nodes, connections: built.connections, settings }) });
  must(res.ok, 'PUT failed ' + res.status + ' ' + JSON.stringify(await res.json()).slice(0, 400));

  let v = await (await fetch(`${API}/workflows/${id}`, { headers: HDRS })).json();
  if (wasActive && v.active !== true) {
    await fetch(`${API}/workflows/${id}/activate`, { method: 'POST', headers: HDRS });
    v = await (await fetch(`${API}/workflows/${id}`, { headers: HDRS })).json();
  }
  let bad = 0;
  for (const [n, spec] of Object.entries(NODE_COLS)) {
    const cfg = node(v, n).parameters.columns;
    const ok = cfg.mappingMode === 'defineBelow' && Object.keys(cfg.value || {}).length === spec.cols.length;
    if (!ok) { bad++; console.log(`  FAIL [live] ${n} mapping`); }
  }
  if (v.active !== wasActive) { bad++; console.log('  FAIL [live] active flag'); }
  console.log(`  live checks: ${bad} failed | active ${wasActive} -> ${v.active} | nodes ${v.nodes.length}`);
  must(bad === 0, `${bad} live check(s) failed on ${label} - RESTORE FROM ${path.basename(bak)}`);
}

(async () => {
  for (const [l, i, s] of ENGINES) await run(l, i, s);
  console.log(`\nF18 ${APPLY ? 'APPLIED AND VERIFIED' : 'DRY RUN CLEAN'} on both engines.`);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
