// Wire the "Pipeline Error Alert" workflow as the errorWorkflow on EVERY active n8n
// workflow that lacks one, so any workflow that errors auto-writes a Notion Pipeline
// Alerts row (which the morning brief surfaces within 24h) + pushes RED to Alex HQ.
//
// Reuses the wire-bi-errorwf.js pattern: the public-API PUT schema rejects unknown
// settings keys, so rebuild settings from ONLY the allowed keys + errorWorkflow.
// Idempotent: skips workflows that already point at the handler, and the handler itself.
// Run: node work/16-alex-hq/scripts/wire-all-error-handlers.js
const fs = require('fs');
const path = require('path');
const BASE = 'https://n8n.shaheenkiarash.com/api/v1';
const KEY = fs.readFileSync(path.join(__dirname, '..', '..', '03-application-engine', 'config', 'n8n-api-key.txt'), 'utf8').trim();
const HDRS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };
const ERR = 'QlGy1BFzdKF852uR'; // Pipeline Error Alert
const ALLOWED = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'executionTimeout', 'timezone', 'executionOrder'];

(async () => {
  const list = (await (await fetch(`${BASE}/workflows?limit=250`, { headers: HDRS })).json()).data || [];
  const targets = list.filter(w => w.active && w.id !== ERR && !((w.settings || {}).errorWorkflow));
  console.log(`${list.filter(w => w.active).length} active; ${targets.length} to wire (skipping the handler + already-wired).\n`);
  let ok = 0, fail = 0;
  for (const t of targets) {
    const wf = await (await fetch(`${BASE}/workflows/${t.id}`, { headers: HDRS })).json();
    const settings = { errorWorkflow: ERR };
    for (const k of ALLOWED) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
    const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings };
    const res = await fetch(`${BASE}/workflows/${t.id}`, { method: 'PUT', headers: HDRS, body: JSON.stringify(body) });
    const j = await res.json();
    const good = j.settings && j.settings.errorWorkflow === ERR;
    console.log(`  ${good ? 'OK  ' : 'FAIL'}  ${t.name}`);
    if (!good) { fail++; console.log('        ' + JSON.stringify(j).slice(0, 200)); } else ok++;
  }
  console.log(`\nDone: ${ok} wired, ${fail} failed.`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
