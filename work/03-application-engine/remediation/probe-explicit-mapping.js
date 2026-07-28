// F18 pre-flight: prove the n8n Google Sheets "define below" explicit mapping shape
// actually WRITES before it is applied to six live append nodes.
//
// The whole risk of F18 is that a wrong mapping config round-trips through a GET
// looking perfectly correct and then silently writes nothing, which is precisely the
// failure class F18 exists to prevent. So it gets tested against a scratch tab on the
// PORTAL sheet (own sheet, zero Claude cost, nothing live depends on it).
'use strict';
const fs = require('fs');
const path = require('path');

const CFG = path.join(__dirname, '..', 'config');
const BASE = 'https://n8n.shaheenkiarash.com';
const API = BASE + '/api/v1';
const KEY = fs.readFileSync(path.join(CFG, 'n8n-api-key.txt'), 'utf8').trim();
const HDRS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };
const SHEET = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '31-portal-scanner', 'config', 'infra-ids.json'), 'utf8')).spreadsheetId;
const SHEETS_CRED = { googleSheetsOAuth2Api: { id: 'UhK77WK48hRv85bo', name: 'Google Sheets account' } };
const TAB = 'f18_probe';
const COLS = ['alpha', 'beta', 'gamma'];
const P = 'f18-probe-' + Date.now();

function explicitColumns(cols) {
  const value = {};
  for (const c of cols) value[c] = `={{ $json[${JSON.stringify(c)}] }}`;
  return {
    mappingMode: 'defineBelow',
    value,
    matchingColumns: [],
    schema: cols.map((c) => ({
      id: c, displayName: c, required: false, defaultMatch: false,
      display: true, type: 'string', canBeUsedToMatch: true
    })),
    attemptToConvertTypes: false,
    convertFieldsToString: true
  };
}

(async () => {
  const nodes = [
    { parameters: { httpMethod: 'GET', path: P, responseMode: 'lastNode', options: {} },
      id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], webhookId: P },
    // Create the scratch tab and its header row, ignoring "already exists".
    { parameters: { method: 'POST', url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}:batchUpdate`,
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleSheetsOAuth2Api',
        sendBody: true, contentType: 'json', specifyBody: 'json',
        jsonBody: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB } } }] }), options: {} },
      id: 'mk', name: 'Make Tab', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [200, 0],
      credentials: SHEETS_CRED, onError: 'continueRegularOutput' },
    { parameters: { method: 'PUT',
        url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${TAB}!A1:C1?valueInputOption=RAW`,
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleSheetsOAuth2Api',
        sendBody: true, contentType: 'json', specifyBody: 'json',
        jsonBody: JSON.stringify({ values: [COLS] }), options: {} },
      id: 'hdr', name: 'Write Header', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [400, 0],
      credentials: SHEETS_CRED, onError: 'continueRegularOutput' },
    { parameters: { jsCode: "return [{ json: { alpha: 'A1', beta: 'B1', gamma: 'C1', extra_ignored: 'X' } }];" },
      id: 'row', name: 'Test Row', type: 'n8n-nodes-base.code', typeVersion: 2, position: [600, 0] },
    { parameters: { operation: 'append',
        documentId: { __rl: true, value: SHEET, mode: 'id' },
        sheetName: { __rl: true, value: TAB, mode: 'name' },
        columns: explicitColumns(COLS), options: {} },
      id: 'app', name: 'Append Explicit', type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [800, 0], credentials: SHEETS_CRED },
    { parameters: { method: 'GET',
        url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${TAB}!A1:D10`,
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleSheetsOAuth2Api', options: {} },
      id: 'rd', name: 'Read Back', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1000, 0],
      credentials: SHEETS_CRED, onError: 'continueRegularOutput' }
  ];
  const order = nodes.map((n) => n.name);
  const connections = {};
  for (let i = 0; i < order.length - 1; i++) connections[order[i]] = { main: [[{ node: order[i + 1], type: 'main', index: 0 }]] };

  const c = await fetch(API + '/workflows', { method: 'POST', headers: HDRS,
    body: JSON.stringify({ name: 'TEMP F18 Probe', nodes, connections, settings: { executionOrder: 'v1' } }) });
  const wf = await c.json();
  if (!c.ok) { console.error('CREATE FAILED', JSON.stringify(wf).slice(0, 500)); process.exit(1); }
  try {
    await fetch(`${API}/workflows/${wf.id}/activate`, { method: 'POST', headers: HDRS });
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(`${BASE}/webhook/${P}`);
    const txt = await res.text();
    console.log('probe status:', res.status);
    let j = null; try { j = JSON.parse(txt); } catch (e) {}
    const rows = (j && j.values) || [];
    console.log('read-back rows:', JSON.stringify(rows));
    const header = rows[0] || [];
    const data = rows[1] || [];
    const ok = header.join(',') === COLS.join(',') && data[0] === 'A1' && data[1] === 'B1' && data[2] === 'C1' && data.length === 3;
    console.log(ok ? 'F18 MAPPING SHAPE VALID: row written to the right columns, unmapped field ignored'
                   : 'F18 MAPPING SHAPE INVALID: ' + txt.slice(0, 400));
    process.exitCode = ok ? 0 : 1;
  } finally {
    await fetch(`${API}/workflows/${wf.id}/deactivate`, { method: 'POST', headers: HDRS }).catch(() => {});
    await fetch(`${API}/workflows/${wf.id}`, { method: 'DELETE', headers: HDRS }).catch(() => {});
    console.log('temp probe deleted');
  }
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
