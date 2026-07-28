// Remediation F19: stop reading the whole fat ledger on every run.
//
// Every run pulled the entire processed_jobs tab, whose banked rows carry the full job
// payload in a single fat cell. #14 is already at 2548 rows. Read latency and n8n
// memory grow every run, forever, and F13 (limit_per_input 10 -> 25) makes it grow
// faster. Dedup needs only ids; banking needs payloads only until drained.
//
// New shape per sheet:
//   seen_ids  job_posting_id | date | gate_status      compact completion state
//   bank      job_posting_id | date | company_name | job_title | gate_status | payload_json
//
// Graph: Read Processed Log now reads seen_ids; a new Read Bank supplies payloads;
// Bank Sourced Jobs writes to bank; a new Append Seen Id mirrors each completed row;
// Read Sibling Log (F20) drops to the sibling's seen_ids, which is what made the plan
// call F20 "cheap after F19". processed_jobs stays as the full analytics ledger, it is
// simply no longer on the hot read path.
//
// SAFETY: dry-run by default; --apply to write. Backfill is idempotent (it refuses to
// run twice by checking the destination tabs are empty).
'use strict';
const fs = require('fs');
const path = require('path');

const CFG = path.join(__dirname, '..', 'config');
const BACKUPS = path.join(__dirname, '..', '..', '..', 'scripts', 'n8n-backups');
const BASE = 'https://n8n.shaheenkiarash.com';
const API = BASE + '/api/v1';
const KEY = fs.readFileSync(path.join(CFG, 'n8n-api-key.txt'), 'utf8').trim();
const HDRS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };
const CRED = { googleSheetsOAuth2Api: { id: 'UhK77WK48hRv85bo', name: 'Google Sheets account' } };

const APPLY = process.argv.includes('--apply');
const S03 = '19puwN6wxFHI7iICrdafiFn1Diqq7qJTe5-5r0Y2XQFY';
const S14 = '11lvksV5NmLK7vWvt4oHIPTXZ1pwRVi67UrWVI3lrAHQ';
const ENGINES = [['#03', '9XuIEfxS71DEetVR', S03, S14], ['#14', '9x9M3EnEEeX3O8dy', S14, S03]];
const ALLOWED_SETTINGS = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution',
  'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'];

const SEEN_COLS = ['job_posting_id', 'date', 'gate_status'];
const BANK_COLS = ['job_posting_id', 'date', 'company_name', 'job_title', 'gate_status', 'payload_json'];

function must(c, m) { if (!c) { console.error('ASSERT FAILED:', m); process.exit(1); } }
const node = (w, n) => w.nodes.find((x) => x.name === n);
const valUrl = (s, r) => `https://sheets.googleapis.com/v4/spreadsheets/${s}/values/${encodeURIComponent(r)}`;

async function viaN8n(name, ops) {
  const p = 'f19-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
  const nodes = [{ parameters: { httpMethod: 'GET', path: p, responseMode: 'lastNode', options: {} },
    id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], webhookId: p }];
  ops.forEach((o, i) => nodes.push({
    parameters: Object.assign({ method: o.method, url: o.url, authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleSheetsOAuth2Api', options: { timeout: 120000 } },
      o.body === undefined ? {} : { sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: JSON.stringify(o.body) }),
    id: 'op' + i, name: 'Op' + i, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
    position: [200 * (i + 1), 0], credentials: CRED, onError: 'continueRegularOutput' }));
  const order = nodes.map((n) => n.name);
  const connections = {};
  for (let i = 0; i < order.length - 1; i++) connections[order[i]] = { main: [[{ node: order[i + 1], type: 'main', index: 0 }]] };
  const c = await fetch(API + '/workflows', { method: 'POST', headers: HDRS,
    body: JSON.stringify({ name: 'TEMP ' + name, nodes, connections, settings: { executionOrder: 'v1' } }) });
  const wf = await c.json();
  must(c.ok, 'temp create failed ' + JSON.stringify(wf).slice(0, 300));
  try {
    await fetch(`${API}/workflows/${wf.id}/activate`, { method: 'POST', headers: HDRS });
    await new Promise((r) => setTimeout(r, 1400));
    const res = await fetch(`${BASE}/webhook/${p}`, { signal: AbortSignal.timeout(240000) });
    const t = await res.text();
    try { return JSON.parse(t); } catch (e) { return { _raw: t.slice(0, 400) }; }
  } finally {
    await fetch(`${API}/workflows/${wf.id}/deactivate`, { method: 'POST', headers: HDRS }).catch(() => {});
    await fetch(`${API}/workflows/${wf.id}`, { method: 'DELETE', headers: HDRS }).catch(() => {});
  }
}

const OLD_DEDUP = `const done = new Set();        // ids with a completed (non-banked) row
const drainable = new Map();   // id -> stored payload_json of banked-only rows
for (const li of $('Read Processed Log').all()) {
  const j = li.json || {};
  const id = j.job_posting_id ? String(j.job_posting_id) : '';
  if (!id) continue;
  if (String(j.gate_status || '') === 'sourced_unscored') {
    if (!drainable.has(id) && j.payload_json) drainable.set(id, String(j.payload_json));
  } else {
    done.add(id);
  }
}
for (const id of done) drainable.delete(id);`;

const NEW_DEDUP = `// F19: completion state now comes from the compact seen_ids tab and payloads from the
// bank tab, instead of pulling the entire processed_jobs ledger (with its fat
// payload_json cells) on every single run. Behaviour is identical; only the source
// tabs changed.
const done = new Set();        // ids with a completed (non-banked) row
const drainable = new Map();   // id -> stored payload_json of banked-only rows
for (const li of $('Read Processed Log').all()) {
  const j = li.json || {};
  const id = j.job_posting_id ? String(j.job_posting_id) : '';
  if (!id) continue;
  if (String(j.gate_status || '') !== 'sourced_unscored') done.add(id);
}
for (const li of $('Read Bank').all()) {
  const j = li.json || {};
  const id = j.job_posting_id ? String(j.job_posting_id) : '';
  if (!id) continue;
  if (!drainable.has(id) && j.payload_json) drainable.set(id, String(j.payload_json));
}
for (const id of done) drainable.delete(id);`;

function explicitColumns(cols) {
  const value = {};
  for (const c of cols) value[c] = `={{ $json[${JSON.stringify(c)}] }}`;
  return { mappingMode: 'defineBelow', value, matchingColumns: [],
    schema: cols.map((c) => ({ id: c, displayName: c, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true })),
    attemptToConvertTypes: false, convertFieldsToString: false };
}

async function migrate(label, sheet) {
  console.log(`  migrating ${label} sheet...`);
  const r = await viaN8n('F19 Read ' + label, [{ method: 'GET', url: valUrl(sheet, 'processed_jobs!A1:F20000') }]);
  const rows = (r.values || []).slice(1);
  const seen = [], bank = [];
  for (const x of rows) {
    const id = x[0], date = x[1] || '', st = x[4] || '';
    if (!id) continue;
    if (st === 'sourced_unscored') { if (x[5]) bank.push([id, date, x[2] || '', x[3] || '', st, x[5]]); }
    else seen.push([id, date, st]);
  }
  console.log(`    processed_jobs ${rows.length} rows -> seen_ids ${seen.length}, bank ${bank.length}`);
  if (!APPLY) return { seen: seen.length, bank: bank.length };

  // Create tabs (ignore "already exists"), write headers, then guard against a second run.
  await viaN8n('F19 Tabs ' + label, [{ method: 'POST', url: `https://sheets.googleapis.com/v4/spreadsheets/${sheet}:batchUpdate`,
    body: { requests: [{ addSheet: { properties: { title: 'seen_ids' } } }, { addSheet: { properties: { title: 'bank' } } }] } }]);
  await viaN8n('F19 Headers ' + label, [
    { method: 'PUT', url: valUrl(sheet, 'seen_ids!A1:C1') + '?valueInputOption=RAW', body: { values: [SEEN_COLS] } },
    { method: 'PUT', url: valUrl(sheet, 'bank!A1:F1') + '?valueInputOption=RAW', body: { values: [BANK_COLS] } }
  ]);
  const chk = await viaN8n('F19 Guard ' + label, [{ method: 'GET', url: valUrl(sheet, 'seen_ids!A1:A5') }]);
  const existing = ((chk.values || []).length) - 1;
  if (existing > 0) { console.log(`    seen_ids already has ${existing} rows, SKIPPING backfill (idempotent)`); return { seen: 0, bank: 0, skipped: true }; }

  // Append in chunks so no single request is huge.
  const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
  for (const c of chunk(seen, 500)) {
    await viaN8n('F19 Seed seen ' + label, [{ method: 'POST',
      url: valUrl(sheet, 'seen_ids!A1') + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', body: { values: c } }]);
  }
  for (const c of chunk(bank, 100)) {
    await viaN8n('F19 Seed bank ' + label, [{ method: 'POST',
      url: valUrl(sheet, 'bank!A1') + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', body: { values: c } }]);
  }
  const back = await viaN8n('F19 Verify ' + label, [{ method: 'GET', url: valUrl(sheet, 'seen_ids!A1:A20000') }]);
  const back2 = await viaN8n('F19 Verify2 ' + label, [{ method: 'GET', url: valUrl(sheet, 'bank!A1:A20000') }]);
  const gotSeen = ((back.values || []).length) - 1, gotBank = ((back2.values || []).length) - 1;
  console.log(`    backfill verified: seen_ids ${gotSeen}/${seen.length}, bank ${gotBank}/${bank.length}`);
  must(gotSeen === seen.length && gotBank === bank.length, 'backfill row count mismatch');
  return { seen: gotSeen, bank: gotBank };
}

async function run(label, id, sheet, sibling) {
  console.log(`\n=== ${label} ${APPLY ? 'APPLY' : 'DRY RUN'} ===`);
  const wf = await (await fetch(`${API}/workflows/${id}`, { headers: HDRS })).json();
  must(wf.nodes, 'fetch failed');
  const wasActive = wf.active;
  await migrate(label, sheet);

  const w = JSON.parse(JSON.stringify(wf));
  const rpl = node(w, 'Read Processed Log');
  const bank = node(w, 'Bank Sourced Jobs');
  const apj = node(w, 'Append Processed Job');
  const sib = node(w, 'Read Sibling Log');
  must(rpl && bank && apj && sib, 'required nodes missing');
  must(!node(w, 'Read Bank'), 'Read Bank already present');

  rpl.parameters.sheetName = { __rl: true, value: 'seen_ids', mode: 'name' };
  bank.parameters.sheetName = { __rl: true, value: 'bank', mode: 'name' };
  sib.parameters.sheetName = { __rl: true, value: 'seen_ids', mode: 'name' };

  w.nodes.push({
    parameters: { documentId: { __rl: true, value: sheet, mode: 'id' },
      sheetName: { __rl: true, value: 'bank', mode: 'name' }, options: {} },
    id: 'read-bank', name: 'Read Bank', type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
    position: [rpl.position[0] + 60, rpl.position[1] + 320], credentials: JSON.parse(JSON.stringify(rpl.credentials)),
    executeOnce: true, alwaysOutputData: true, retryOnFail: true, maxTries: 4, waitBetweenTries: 5000
  });
  w.nodes.push({
    parameters: { operation: 'append', documentId: { __rl: true, value: sheet, mode: 'id' },
      sheetName: { __rl: true, value: 'seen_ids', mode: 'name' }, columns: explicitColumns(SEEN_COLS), options: {} },
    id: 'append-seen', name: 'Append Seen Id', type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
    position: [apj.position[0] + 200, apj.position[1] + 160], credentials: JSON.parse(JSON.stringify(apj.credentials)),
    retryOnFail: true, maxTries: 4, waitBetweenTries: 5000
  });

  w.connections['Read Processed Log'] = { main: [[{ node: 'Read Bank', type: 'main', index: 0 }]] };
  w.connections['Read Bank'] = { main: [[{ node: 'Read Sibling Log', type: 'main', index: 0 }]] };
  // Append Seen Id hangs in PARALLEL off Format Processed Row, not downstream of the
  // append. A Sheets append under explicit mapping does not reliably echo the input
  // json back, so chaining it there would have written blank rows; this way the node
  // reads the completed row directly.
  w.connections['Format Processed Row'] = { main: [[
    { node: 'Append Processed Job', type: 'main', index: 0 },
    { node: 'Append Seen Id', type: 'main', index: 0 }
  ]] };

  const d = node(w, 'Dedup Against Log');
  const cnt = d.parameters.jsCode.split(OLD_DEDUP).length - 1;
  must(cnt === 1, `dedup anchor found ${cnt} times`);
  d.parameters.jsCode = d.parameters.jsCode.split(OLD_DEDUP).join(NEW_DEDUP);

  const check = (v) => {
    const dd = node(v, 'Dedup Against Log').parameters.jsCode;
    return {
      'Dedup syntax': (() => { try { new Function(dd); return true; } catch (e) { return false; } })(),
      'reads Read Bank': /\$\('Read Bank'\)\.all\(\)/.test(dd),
      'no payload from seen tab': !/gate_status \|\| ''\) === 'sourced_unscored'/.test(dd),
      'Read Processed Log -> seen_ids': node(v, 'Read Processed Log').parameters.sheetName.value === 'seen_ids',
      'Bank Sourced Jobs -> bank': node(v, 'Bank Sourced Jobs').parameters.sheetName.value === 'bank',
      'Read Sibling Log -> seen_ids': node(v, 'Read Sibling Log').parameters.sheetName.value === 'seen_ids',
      'Read Bank node added': !!node(v, 'Read Bank'),
      'Append Seen Id added': !!node(v, 'Append Seen Id'),
      'chain RPL->Bank->Sibling': JSON.stringify(v.connections['Read Processed Log']).includes('Read Bank')
        && JSON.stringify(v.connections['Read Bank']).includes('Read Sibling Log'),
      'FPR fans to both appends': JSON.stringify(v.connections['Format Processed Row']).includes('Append Seen Id')
        && JSON.stringify(v.connections['Format Processed Row']).includes('Append Processed Job'),
      'Append Processed Job stays a leaf': !v.connections['Append Processed Job'],
      'node count +2': v.nodes.length === wf.nodes.length + 2
    };
  };
  let bad = 0;
  for (const [k, ok] of Object.entries(check(w))) if (!ok) { bad++; console.log(`  FAIL [dry] ${k}`); }
  console.log(`  graph checks: ${Object.keys(check(w)).length} run, ${bad} failed`);
  must(bad === 0, 'dry failed');
  if (!APPLY) { console.log('  DRY RUN CLEAN'); return; }

  fs.mkdirSync(BACKUPS, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const bak = path.join(BACKUPS, `${id}-pre-F19-${ts}.json`);
  fs.writeFileSync(bak, JSON.stringify(wf, null, 2));

  const settings = {};
  for (const k of ALLOWED_SETTINGS) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
  const res = await fetch(`${API}/workflows/${id}`, { method: 'PUT', headers: HDRS,
    body: JSON.stringify({ name: w.name, nodes: w.nodes, connections: w.connections, settings }) });
  must(res.ok, 'PUT failed ' + res.status + ' ' + JSON.stringify(await res.json()).slice(0, 400));

  let v = await (await fetch(`${API}/workflows/${id}`, { headers: HDRS })).json();
  if (wasActive && v.active !== true) {
    await fetch(`${API}/workflows/${id}/activate`, { method: 'POST', headers: HDRS });
    v = await (await fetch(`${API}/workflows/${id}`, { headers: HDRS })).json();
  }
  bad = 0;
  for (const [k, ok] of Object.entries(check(v))) if (!ok) { bad++; console.log(`  FAIL [live] ${k}`); }
  if (v.active !== wasActive) bad++;
  console.log(`  live checks: ${bad} failed | active ${wasActive} -> ${v.active} | nodes ${v.nodes.length} | backup ${path.basename(bak)}`);
  must(bad === 0, 'live failed - RESTORE FROM ' + path.basename(bak));
}

(async () => {
  for (const [l, i, s, sib] of ENGINES) await run(l, i, s, sib);
  console.log(`\nF19 ${APPLY ? 'APPLIED AND VERIFIED' : 'DRY RUN CLEAN'} on both engines.`);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
