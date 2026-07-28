// Clear the accumulated bank backlog on the 3 engines (Shaheen's call: "clear the whole backlog").
// Uses the Google Sheets values:clear API through the existing n8n Google credential, keeps the
// header row (A2:Z), keeps all seen_ids tabs (so nothing gets re-drafted). Throwaway webhook,
// self-deletes. DESTRUCTIVE by design + confirmed.
const fs = require('fs');
const path = require('path');
const KEY = fs.readFileSync(path.join(__dirname, '../work/03-application-engine/config/n8n-api-key.txt'), 'utf8').trim();
const BASE = 'https://n8n.shaheenkiarash.com/api/v1';
const HOST = 'https://n8n.shaheenkiarash.com';
const HDRS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };
const WHPATH = 'clear-bank-' + Math.random().toString(36).slice(2, 10);
const api = async (m, u, b) => { const r = await fetch(BASE + u, { method: m, headers: HDRS, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, json: j, txt: t }; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Each target: the sheet + the bank tab to clear (A2:Z keeps the header row).
const TARGETS = `return [
  { json: { label: '#03 bank',    url: 'https://sheets.googleapis.com/v4/spreadsheets/19puwN6wxFHI7iICrdafiFn1Diqq7qJTe5-5r0Y2XQFY/values/bank!A2:Z:clear' } },
  { json: { label: '#14 bank',    url: 'https://sheets.googleapis.com/v4/spreadsheets/11lvksV5NmLK7vWvt4oHIPTXZ1pwRVi67UrWVI3lrAHQ/values/bank!A2:Z:clear' } },
  { json: { label: '#31 processed_jobs', url: 'https://sheets.googleapis.com/v4/spreadsheets/1hmLHyW0Yu6ZV8MpiKrECo2OACk4eC3Eb5xWR73HIeiU/values/processed_jobs!A2:Z:clear' } }
];`;

const SUMMARIZE = `const tgt = $('Targets').all();
const res = $input.all();
const out = [];
for (let i = 0; i < res.length; i++) {
  const label = (tgt[i] && tgt[i].json.label) || '?';
  const r = res[i].json || {};
  const code = Number(r.statusCode);
  let body = r.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) {} }
  out.push({ label, status: code, clearedRange: (body && body.clearedRange) || null, err: code >= 400 ? JSON.stringify(body).slice(0,120) : '' });
}
return [{ json: { cleared: out } }];`;

const WF = {
  name: 'ZZ Clear bank backlog (DELETE ME)',
  nodes: [
    { parameters: { httpMethod: 'GET', path: WHPATH, responseMode: 'lastNode', options: {} }, id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0,0], webhookId: WHPATH },
    { parameters: { jsCode: TARGETS }, id: 'tg', name: 'Targets', type: 'n8n-nodes-base.code', typeVersion: 2, position: [200,0] },
    { parameters: { method: 'POST', url: '={{ $json.url }}', authentication: 'predefinedCredentialType', nodeCredentialType: 'googleSheetsOAuth2Api', sendBody: true, specifyBody: 'json', jsonBody: '={}', options: { response: { response: { fullResponse: true, neverError: true } }, batching: { batch: { batchSize: 1 } } } }, id: 'clr', name: 'Clear', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [400,0], onError: 'continueRegularOutput', credentials: { googleSheetsOAuth2Api: { id: 'UhK77WK48hRv85bo', name: 'Google Sheets account' } } },
    { parameters: { jsCode: SUMMARIZE }, id: 'sum', name: 'Summarize', type: 'n8n-nodes-base.code', typeVersion: 2, position: [600,0] },
  ],
  connections: {
    'Webhook': { main: [[{ node: 'Targets', type: 'main', index: 0 }]] },
    'Targets': { main: [[{ node: 'Clear', type: 'main', index: 0 }]] },
    'Clear': { main: [[{ node: 'Summarize', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
};

(async () => {
  const post = await api('POST', '/workflows', WF);
  if (post.status !== 200 && post.status !== 201) { console.log('CREATE failed ' + post.status + ': ' + post.txt.slice(0,300)); return; }
  const id = post.json.id;
  await api('POST', `/workflows/${id}/activate`);
  const url = `${HOST}/webhook/${WHPATH}`;
  let result = null;
  for (let a = 1; a <= 4; a++) { await sleep(2500); try { const r = await fetch(url); const t = await r.text(); if (r.status === 200) { try { result = JSON.parse(t); } catch (e) { result = { raw: t }; } break; } else console.log(`  attempt ${a}: ${r.status} ${t.slice(0,120)}`); } catch (e) { console.log(`  attempt ${a}: ${e.message}`); } }
  console.log('\n===== BANK CLEAR =====');
  console.log(JSON.stringify(result, null, 2));
  const del = await api('DELETE', `/workflows/${id}`);
  console.log('\ncleanup delete ' + id + ': ' + del.status);
})();
