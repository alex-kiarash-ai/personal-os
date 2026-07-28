// Diagnostic: what balance does the n8n Kimi API key actually see? Resolves "I have $30 but it says
// suspended". Throwaway webhook -> GET the Moonshot balance endpoint through the existing credential
// -> read -> delete. Read-only, key never leaves n8n.
const fs = require('fs');
const path = require('path');
const KEY = fs.readFileSync(path.join(__dirname, '../work/03-application-engine/config/n8n-api-key.txt'), 'utf8').trim();
const BASE = 'https://n8n.shaheenkiarash.com/api/v1';
const HOST = 'https://n8n.shaheenkiarash.com';
const HDRS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };
const WHPATH = 'kimi-balance-' + Math.random().toString(36).slice(2, 10);
const api = async (m, u, b) => { const r = await fetch(BASE + u, { method: m, headers: HDRS, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, json: j, txt: t }; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Try both the .ai and .cn balance endpoints so we can see which platform the key belongs to.
const SUMMARIZE = `const resps = $input.all();
const out = [];
for (const it of resps) {
  const r = it.json || {};
  const code = Number(r.statusCode);
  let body = r.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) {} }
  out.push({ url: it.json._url || '(unknown)', status: code, body });
}
return [{ json: { probes: out } }];`;

const BUILD = `return [
  { json: { _url: 'https://api.moonshot.ai/v1/users/me/balance' } }
];`;

const WF = {
  name: 'ZZ Kimi balance check (DELETE ME)',
  nodes: [
    { parameters: { httpMethod: 'GET', path: WHPATH, responseMode: 'lastNode', options: {} }, id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0,0], webhookId: WHPATH },
    { parameters: { jsCode: BUILD }, id: 'build', name: 'Build', type: 'n8n-nodes-base.code', typeVersion: 2, position: [200,0] },
    { parameters: { method: 'GET', url: '={{ $json._url }}', authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', options: { response: { response: { fullResponse: true, neverError: true } }, batching: { batch: { batchSize: 1 } }, timeout: 30000 } }, id: 'bal', name: 'Balance', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [400,0], onError: 'continueRegularOutput', credentials: { httpHeaderAuth: { id: 'OffvMkWR01zcpqxo', name: 'Kimi K3 (Moonshot header)' } } },
    { parameters: { jsCode: SUMMARIZE }, id: 'sum', name: 'Summarize', type: 'n8n-nodes-base.code', typeVersion: 2, position: [600,0] },
  ],
  connections: {
    'Webhook': { main: [[{ node: 'Build', type: 'main', index: 0 }]] },
    'Build': { main: [[{ node: 'Balance', type: 'main', index: 0 }]] },
    'Balance': { main: [[{ node: 'Summarize', type: 'main', index: 0 }]] },
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
  for (let a = 1; a <= 4; a++) { await sleep(2000); try { const r = await fetch(url); const t = await r.text(); if (r.status === 200) { try { result = JSON.parse(t); } catch (e) { result = { raw: t }; } break; } else console.log(`  attempt ${a}: ${r.status} ${t.slice(0,100)}`); } catch (e) { console.log(`  attempt ${a}: ${e.message}`); } }
  console.log('\n===== BALANCE CHECK =====');
  console.log(JSON.stringify(result, null, 2));
  const del = await api('DELETE', `/workflows/${id}`);
  console.log('\ncleanup delete ' + id + ': ' + del.status);
})();
