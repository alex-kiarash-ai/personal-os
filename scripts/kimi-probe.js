// Fix6 precondition probe: does kimi-k3 (Moonshot) VALIDATE reasoning_effort, or silently ignore it?
// Builds a throwaway webhook workflow that fires 4 calls (low/medium/high/bogus) through the existing
// n8n Kimi credential, curls it, reads the verdict, deletes the workflow. Key never leaves n8n.
const fs = require('fs');
const path = require('path');
const KEY = fs.readFileSync(path.join(__dirname, '../work/03-application-engine/config/n8n-api-key.txt'), 'utf8').trim();
const BASE = 'https://n8n.shaheenkiarash.com/api/v1';
const HOST = 'https://n8n.shaheenkiarash.com';
const HDRS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };
const WHPATH = 'kimi-effort-probe-' + Math.random().toString(36).slice(2, 10);
const api = async (m, u, b) => { const r = await fetch(BASE + u, { method: m, headers: HDRS, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, json: j, txt: t }; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const BUILD = `const values = ['low','medium','high','bogus'];
return values.map(v => ({ json: { value: v, body: { model:'kimi-k3', reasoning_effort: v, max_tokens: 64, messages: [{ role:'user', content:'Reply with the single word: ok' }] } } }));`;

const SUMMARIZE = `const vals = $('Build Probe Bodies').all();
const resps = $input.all();
const rows = [];
for (let i = 0; i < resps.length; i++) {
  const v = (vals[i] && vals[i].json.value) || '?';
  const r = resps[i].json || {};
  const code = Number(r.statusCode);
  let body = r.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) {} }
  const usage = (body && body.usage) || {};
  const err = (code >= 400) ? ((body && body.error && (body.error.message || body.error.type)) || '4xx') : '';
  rows.push({ value: v, status: code, completion_tokens: usage.completion_tokens != null ? usage.completion_tokens : null, note: err ? String(err) : '' });
}
const by = Object.fromEntries(rows.map(r => [r.value, r.status]));
let verdict;
if (by.low === 200 && by.medium === 200 && by.bogus >= 400 && by.bogus < 500) verdict = 'VALIDATED (low/medium accepted, bogus rejected) -> Fix6 A/B is viable';
else if (by.bogus === 200) verdict = 'IGNORED (bogus also 200) -> reasoning_effort not validated; Fix6 via this param impossible, pivot to a non-reasoning Match model';
else if (by.low >= 400 || by.medium >= 400) verdict = 'LIMITED (low/medium rejected) -> only high/max exist; no middle rung for Fix6';
else verdict = 'INCONCLUSIVE - inspect rows';
const line = 'KIMI PROBE :: ' + rows.map(r => r.value + '=' + r.status + (r.completion_tokens != null ? ('/ct' + r.completion_tokens) : '') + (r.note ? ('(' + r.note + ')') : '')).join('  ') + '  ::  ' + verdict;
return [{ json: { line, verdict, rows } }];`;

const WF = {
  name: 'ZZ Kimi effort probe (DELETE ME)',
  nodes: [
    { parameters: { httpMethod: 'GET', path: WHPATH, responseMode: 'lastNode', options: {} }, id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0,0], webhookId: WHPATH },
    { parameters: { jsCode: BUILD }, id: 'build', name: 'Build Probe Bodies', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220,0] },
    { parameters: { method: 'POST', url: 'https://api.moonshot.ai/v1/chat/completions', authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: '={{ $json.body }}', options: { response: { response: { fullResponse: true, neverError: true } }, batching: { batch: { batchSize: 1 } }, timeout: 120000 } }, id: 'call', name: 'Probe Call', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [440,0], credentials: { httpHeaderAuth: { id: 'OffvMkWR01zcpqxo', name: 'Kimi K3 (Moonshot header)' } } },
    { parameters: { jsCode: SUMMARIZE }, id: 'sum', name: 'Summarize', type: 'n8n-nodes-base.code', typeVersion: 2, position: [660,0] },
  ],
  connections: {
    'Webhook': { main: [[{ node: 'Build Probe Bodies', type: 'main', index: 0 }]] },
    'Build Probe Bodies': { main: [[{ node: 'Probe Call', type: 'main', index: 0 }]] },
    'Probe Call': { main: [[{ node: 'Summarize', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
};

(async () => {
  const post = await api('POST', '/workflows', WF);
  if (post.status !== 200 && post.status !== 201) { console.log('CREATE failed ' + post.status + ': ' + post.txt.slice(0,300)); return; }
  const id = post.json.id; console.log('probe workflow created ' + id);
  const act = await api('POST', `/workflows/${id}/activate`);
  console.log('activate: ' + act.status + ' active=' + (act.json && act.json.active));
  const url = `${HOST}/webhook/${WHPATH}`;
  let result = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    await sleep(2000);
    try {
      const r = await fetch(url);
      const t = await r.text();
      if (r.status === 200) { try { result = JSON.parse(t); } catch (e) { result = { raw: t }; } break; }
      console.log(`  attempt ${attempt}: webhook ${r.status} ${t.slice(0,120)}`);
    } catch (e) { console.log(`  attempt ${attempt}: ${e.message}`); }
  }
  console.log('\n===== PROBE RESULT =====');
  if (result && result.line) { console.log(result.line); console.log('\nrows:', JSON.stringify(result.rows, null, 2)); }
  else console.log('no clean result:', JSON.stringify(result));
  const del = await api('DELETE', `/workflows/${id}`);
  console.log('\ncleanup delete ' + id + ': ' + del.status);
})();
