#!/usr/bin/env node
/*
 * add-flags-column-2026-09-17.js - one-shot, Shaheen's instruction the same evening as the trim.
 *
 * Appends ONE column, `flags`, to the `jobs` and `jobs_test` tabs of BOTH job-search spreadsheets.
 *
 * WHY A SECOND SCRIPT AND NOT AN EDIT TO THE TRIM. The trim script is the record of what was
 * DELETED and it is idempotent about that: re-running it reports "ALREADY the new header, nothing to
 * do". Teaching it to also add a column would make that sentence a lie, and the one thing a
 * destructive script must never do is become ambiguous about what state it is asserting.
 *
 * THE SAFE DIRECTION. This is an APPEND: one column on the right, no existing cell moves, and
 * `status` keeps column K, which is the letter #36 writes an addressed cell at. That is why `flags`
 * went last rather than next to `fit_score` where it would read better. A column INSERTED before
 * status would have moved the one A1 address in this system computed from another project's
 * contract, and this script would have had to move it in the same run.
 *
 * WHAT IT DOES NOT DO. It does not backfill. Every row already in the sheet gets an EMPTY flags
 * cell, because the red flags for those rows were produced by scoring calls that are already paid
 * for and gone, and inventing them now would put model output in a cell nobody generated for that
 * job. The rows collected from tomorrow morning carry their own flags.
 *
 * Same four rules as the trim script: read the LIVE header first and refuse on a mismatch, append
 * right (nothing shifts), read back in the same run, and take every id from the gitignored lane
 * files so this file carries none.
 *
 * Usage:
 *   node scripts/add-flags-column-2026-09-17.js            # report the plan, change nothing
 *   node scripts/add-flags-column-2026-09-17.js --confirm   # append, then read back
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const KEY = (process.env.N8N_API_KEY || fs.readFileSync(path.join(REPO, 'work/03-application-engine/config/n8n-api-key.txt'), 'utf8')).trim();
const BASE = 'https://n8n.shaheenkiarash.com/api/v1';
const HOST = 'https://n8n.shaheenkiarash.com';
const HDRS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };
const CONFIRM = process.argv.includes('--confirm');

function laneFile(rel) {
  const p = path.join(REPO, rel);
  if (!fs.existsSync(p)) throw new Error('missing ' + rel + ' (gitignored, local-only; restore it from the encrypted backup)');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
const LANE_BI = laneFile('work/34-job-search-bi/config/lane.json');
const LANE_AI = laneFile('work/35-job-search-ai/config/lane.json');
const GOOGLE_CRED = { id: LANE_BI.credentials.google_sheets, name: 'Google Sheets account' };
const LANES = [
  { key: 'bi', label: 'Job Search - BI (34)', spreadsheetId: LANE_BI.sheet.spreadsheet_id },
  { key: 'ai', label: 'Job Search - AI (35)', spreadsheetId: LANE_AI.sheet.spreadsheet_id },
];

// The header this script expects to find, and the one it leaves behind. Read from the CONTRACT, so
// this script cannot disagree with the nodes about what the sheet should look like.
const CONTRACT = JSON.parse(fs.readFileSync(path.join(REPO, 'work/34-job-search-bi/config/sources.json'), 'utf8'));
const AFTER = CONTRACT.shared_row_shape.slice();
const BEFORE = AFTER.filter((c) => c !== 'flags');
if (AFTER.length !== BEFORE.length + 1 || AFTER[AFTER.length - 1] !== 'flags') {
  throw new Error('the contract row shape is ' + JSON.stringify(AFTER) + '. This script appends exactly one column and it has to be `flags` at the end.');
}
const TABS = ['jobs', 'jobs_test'];

const api = async (m, u, b) => {
  const r = await fetch(BASE + u, { method: m, headers: HDRS, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch (e) { /* non-json */ }
  return { status: r.status, json: j, txt: t };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CALLS_FROM_QUERY = `
const q = $input.first().json.query || {};
return JSON.parse(q.plan || '[]').map((c) => ({ json: c }));
`;
const SUMMARIZE = `
const planned = $('Calls').all().map((i) => i.json);
const res = $input.all();
const out = [];
for (let i = 0; i < res.length; i++) {
  const r = res[i].json || {};
  let body = r.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) {} }
  out.push({ label: (planned[i] || {}).label || '?', status: Number(r.statusCode), body: body === undefined ? null : body });
}
return [{ json: { results: out } }];
`;

function workflow(whpath) {
  return {
    name: 'ZZ Add flags column 2026-09-17 (DELETE ME)',
    nodes: [
      { parameters: { httpMethod: 'GET', path: whpath, responseMode: 'lastNode', options: {} }, id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], webhookId: whpath },
      { parameters: { jsCode: CALLS_FROM_QUERY }, id: 'cl', name: 'Calls', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 0] },
      {
        // POST only, sendBody a LITERAL true. See the trim script: an expression in either of those
        // silently sent no body at all and every write came back 400.
        parameters: {
          method: 'POST', url: '={{ $json.url }}',
          authentication: 'predefinedCredentialType', nodeCredentialType: 'googleSheetsOAuth2Api',
          sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.body) }}',
          options: { response: { response: { fullResponse: true, neverError: true } }, batching: { batch: { batchSize: 1 } } },
        },
        id: 'ht', name: 'Sheets', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [440, 0],
        onError: 'continueRegularOutput',
        credentials: { googleSheetsOAuth2Api: GOOGLE_CRED },
      },
      { parameters: { jsCode: SUMMARIZE }, id: 'sm', name: 'Summarize', type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 0] },
    ],
    connections: {
      Webhook: { main: [[{ node: 'Calls', type: 'main', index: 0 }]] },
      Calls: { main: [[{ node: 'Sheets', type: 'main', index: 0 }]] },
      Sheets: { main: [[{ node: 'Summarize', type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1' },
  };
}

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/';
const valuesRead = (id, ranges) => ({ url: SHEETS + id + '/values:batchGetByDataFilter', body: { dataFilters: ranges.map((r) => ({ a1Range: r })), majorDimension: 'ROWS' } });
const metaRead = (id, ranges) => ({ url: SHEETS + id + ':getByDataFilter', body: { dataFilters: ranges.map((r) => ({ a1Range: r })), includeGridData: false } });
function rangesOf(body) {
  const out = {};
  for (const e of ((body && body.valueRanges) || [])) {
    const vr = e.valueRange || e;
    const tab = String(vr.range || '').split('!')[0].replace(/^'|'$/g, '');
    if (tab) out[tab] = vr.values || [];
  }
  return out;
}
const colLetter = (i) => String.fromCharCode(65 + i);

async function callPlan(whpath, plan) {
  const url = HOST + '/webhook/' + whpath + '?plan=' + encodeURIComponent(JSON.stringify(plan));
  for (let a = 1; a <= 5; a += 1) {
    await sleep(2200);
    try {
      const r = await fetch(url);
      const t = await r.text();
      if (r.status === 200) { try { return JSON.parse(t); } catch (e) { return { raw: t }; } }
      console.log('  attempt ' + a + ': ' + r.status + ' ' + t.slice(0, 160));
    } catch (e) { console.log('  attempt ' + a + ': ' + e.message); }
  }
  return null;
}

(async () => {
  console.log('ADD THE flags COLUMN' + (CONFIRM ? '  (--confirm: WILL WRITE)' : '  (dry: plan only)'));
  console.log('  before: ' + BEFORE.join(',') + '  (' + BEFORE.length + ')');
  console.log('  after : ' + AFTER.join(',') + '  (' + AFTER.length + ')');

  const post = await api('POST', '/workflows', workflow('add-flags-' + Math.random().toString(36).slice(2, 10)));
  if (post.status !== 200 && post.status !== 201) { console.log('CREATE failed ' + post.status + ': ' + post.txt.slice(0, 300)); process.exit(1); }
  const wfId = post.json.id;
  const whpath = post.json.nodes[0].parameters.path;
  await api('POST', '/workflows/' + wfId + '/activate');
  console.log('temp workflow ' + wfId + ' created');

  let failed = false;
  try {
    // 1. READ the live headers and the grid metadata.
    const readPlan = [];
    for (const L of LANES) {
      const m = metaRead(L.spreadsheetId, TABS.map((t) => t + '!A1'));
      const v = valuesRead(L.spreadsheetId, TABS.map((t) => t + '!1:1'));
      readPlan.push({ label: L.key + ':meta', url: m.url, body: m.body });
      readPlan.push({ label: L.key + ':header', url: v.url, body: v.body });
    }
    const read = await callPlan(whpath, readPlan);
    if (!read || !read.results) { console.log('READ failed, nothing written.'); failed = true; throw new Error('read'); }

    const writePlan = [];
    for (const L of LANES) {
      const meta = read.results.find((r) => r.label === L.key + ':meta');
      const hdr = read.results.find((r) => r.label === L.key + ':header');
      if (!meta || meta.status !== 200 || !hdr || hdr.status !== 200) { console.log('  ' + L.label + ': read failed'); failed = true; continue; }
      const sheetIds = {};
      for (const sh of (meta.body.sheets || [])) sheetIds[sh.properties.title] = sh.properties.sheetId;
      const rows = rangesOf(hdr.body);
      const requests = [];
      const values = [];
      for (const tab of TABS) {
        const header = ((rows[tab] || [])[0] || []).map((h) => String(h).trim());
        if (!header.length) { console.log('  ' + L.label + ' ' + tab + ': no header row, skipping'); continue; }
        if (header.join(',') === AFTER.join(',')) { console.log('  ' + L.label + ' ' + tab + ': ALREADY has flags, nothing to do'); continue; }
        if (header.join(',') !== BEFORE.join(',')) {
          console.log('  REFUSED ' + L.label + ' ' + tab + ': the live header is neither the before nor the after list.');
          console.log('    live: ' + header.join(','));
          failed = true; continue;
        }
        const sheetId = sheetIds[tab];
        if (sheetId === undefined) { console.log('  REFUSED ' + L.label + ' ' + tab + ': no sheetId'); failed = true; continue; }
        // appendDimension, not insertDimension: there is nothing to the right to push.
        requests.push({ appendDimension: { sheetId: sheetId, dimension: 'COLUMNS', length: 1 } });
        values.push({ range: tab + '!' + colLetter(AFTER.length - 1) + '1', values: [['flags']] });
        console.log('  ' + L.label + ' ' + tab + ': append one column, header cell ' + colLetter(AFTER.length - 1) + '1 = flags');
      }
      if (requests.length) {
        writePlan.push({ label: L.key + ':grow', url: SHEETS + L.spreadsheetId + ':batchUpdate', body: { requests: requests } });
        writePlan.push({ label: L.key + ':name', url: SHEETS + L.spreadsheetId + '/values:batchUpdate', body: { valueInputOption: 'RAW', data: values } });
      }
    }
    if (failed) { console.log('\nREFUSED: nothing was written.'); throw new Error('plan'); }
    if (!writePlan.length) { console.log('\nNothing to do: both spreadsheets already carry the flags column.'); return; }
    if (!CONFIRM) { console.log('\nDRY RUN. --confirm sends the plan above.'); return; }

    // 2. WRITE.
    const wrote = await callPlan(whpath, writePlan);
    if (!wrote || !wrote.results) { console.log('WRITE failed; read the headers back before assuming nothing changed.'); failed = true; throw new Error('write'); }
    for (const r of wrote.results) {
      console.log('  ' + r.label + ': HTTP ' + r.status + (r.status === 200 ? '' : ' ' + JSON.stringify(r.body).slice(0, 200)));
      if (r.status !== 200) failed = true;
    }

    // 3. READ BACK.
    const ver = await callPlan(whpath, LANES.map((L) => {
      const v = valuesRead(L.spreadsheetId, TABS.map((t) => t + '!1:1'));
      return { label: L.key + ':verify', url: v.url, body: v.body };
    }));
    console.log('\nREAD BACK:');
    if (!ver || !ver.results) { console.log('  the read back failed; check the sheets by hand.'); failed = true; }
    else {
      for (const L of LANES) {
        const v = ver.results.find((r) => r.label === L.key + ':verify');
        if (!v || v.status !== 200) { console.log('  ' + L.label + ': read back failed'); failed = true; continue; }
        const rows = rangesOf(v.body);
        for (const tab of TABS) {
          const header = ((rows[tab] || [])[0] || []).map((h) => String(h).trim());
          if (!header.length) continue;
          const ok = header.join(',') === AFTER.join(',');
          console.log('  ' + (ok ? 'OK   ' : 'WRONG') + ' ' + L.label + ' ' + tab + ': ' + header.join(','));
          if (!ok) failed = true;
        }
      }
    }
  } finally {
    const d = await api('DELETE', '/workflows/' + wfId);
    const left = await api('GET', '/workflows/' + wfId);
    console.log('\ncleanup: delete ' + wfId + ' -> ' + d.status + ', GET -> ' + left.status + (left.status === 404 ? ' (gone)' : ' (STILL THERE, delete by hand)'));
  }
  console.log(failed ? '\nVERDICT: FAILED.' : '\nVERDICT: DONE and verified.');
  process.exit(failed ? 1 : 0);
})();
