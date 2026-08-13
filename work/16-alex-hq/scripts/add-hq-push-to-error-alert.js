// Add an immediate Alex HQ signal to the Pipeline Error Alert workflow: alongside the
// Notion row, insert a RED n8n_broken_today row straight into the alex_metrics data table
// (same box, no HTTP, no token - the pipeline-stats sidecar pattern). So the "Broken n8n
// today" HQ card flips red the instant any guarded workflow throws, before the next
// liveness harvest. The daily/on-demand harvest then overwrites the key with the true
// count (0 green / N red), so it self-heals exactly like sprint run_status.
// Idempotent: bails if the HQ nodes already exist. Run once:
//   node work/16-alex-hq/scripts/add-hq-push-to-error-alert.js
const fs = require('fs');
const path = require('path');
const BASE = 'https://n8n.shaheenkiarash.com/api/v1';
const KEY = fs.readFileSync(path.join(__dirname, '..', '..', '03-application-engine', 'config', 'n8n-api-key.txt'), 'utf8').trim();
const HDRS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };
const ID = 'QlGy1BFzdKF852uR';
const ALLOWED = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'executionTimeout', 'timezone', 'executionOrder'];

const buildHqNode = {
  parameters: {
    jsCode: [
      "const p = ($input.first().json || {}).payload || {};",
      "const props = p.properties || {};",
      "const title = ((((props.Alert || {}).title || [])[0] || {}).text || {}).content || 'A workflow failed';",
      "const errMsg = ((((props.Error || {}).rich_text || [])[0] || {}).text || {}).content || '';",
      "const headline = (title + (errMsg ? (': ' + errMsg) : '')).slice(0, 240);",
      "return [{ json: {",
      "  project: 'infra',",
      "  metric_key: 'n8n_broken_today',",
      "  value_num: 1,",
      "  value_text: '',",
      "  headline,",
      "  status: 'red',",
      "  ts: new Date().toISOString()",
      "} }];",
    ].join('\n'),
  },
  id: 'd4444444-4444-4444-8444-444444444444',
  name: 'Build HQ Metric',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [720, 480],
};
const insertHqNode = {
  parameters: {
    resource: 'row',
    operation: 'insert',
    dataTableId: { __rl: true, value: 'etzrOnviaxXQFPll', mode: 'id', cachedResultName: 'alex_metrics' },
    columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] },
    options: {},
  },
  id: 'e5555555-5555-4555-8555-555555555555',
  name: 'Insert HQ Metric',
  type: 'n8n-nodes-base.dataTable',
  typeVersion: 1,
  position: [960, 480],
};

(async () => {
  const wf = await (await fetch(`${BASE}/workflows/${ID}`, { headers: HDRS })).json();
  if (wf.nodes.some(n => n.name === 'Build HQ Metric')) {
    console.log('HQ nodes already present - nothing to do.');
    return;
  }
  const nodes = [...wf.nodes, buildHqNode, insertHqNode];
  const connections = JSON.parse(JSON.stringify(wf.connections));
  // Build Alert Payload now fans out to BOTH the Notion node and the new HQ branch.
  connections['Build Alert Payload'] = { main: [[
    { node: 'Notion: Create Alert', type: 'main', index: 0 },
    { node: 'Build HQ Metric', type: 'main', index: 0 },
  ]] };
  connections['Build HQ Metric'] = { main: [[{ node: 'Insert HQ Metric', type: 'main', index: 0 }]] };
  const settings = {};
  for (const k of ALLOWED) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
  const body = { name: wf.name, nodes, connections, settings };
  const res = await fetch(`${BASE}/workflows/${ID}`, { method: 'PUT', headers: HDRS, body: JSON.stringify(body) });
  const j = await res.json();
  const names = (j.nodes || []).map(n => n.name);
  const ok = names.includes('Build HQ Metric') && names.includes('Insert HQ Metric');
  console.log(ok ? 'OK - HQ push nodes added. Nodes now: ' + names.join(', ')
                 : 'FAILED: ' + JSON.stringify(j).slice(0, 400));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
