// Remediation F06: calibrate the match stage against a cheaper model before switching.
//
// The match stage fires far more often than the writer and does structured scoring,
// not human-facing prose, so it is the obvious cost saving. The blocker is that
// FIT_THRESHOLD is calibrated to the CURRENT model's score distribution, so a blind
// swap silently moves the gate. The plan prohibits that; this measures it instead.
//
// Method: take 50 banked jobs from the engine's own ledger (they carry the full
// posting in payload_json), score each with BOTH models through a verbatim copy of the
// LIVE Build Match Request node so the prompt is byte-identical, and compare.
//
// Decision rule, from the plan: if the large majority of deltas are within about 5
// points, switch and keep the threshold. Otherwise pick the threshold that preserves
// the current pass rate on the sample.
//
// Read-only against the engines: it copies their nodes, never writes to them.
'use strict';
const fs = require('fs');
const path = require('path');

const CFG = path.join(__dirname, '..', 'config');
const BASE = 'https://n8n.shaheenkiarash.com';
const API = BASE + '/api/v1';
const KEY = fs.readFileSync(path.join(CFG, 'n8n-api-key.txt'), 'utf8').trim();
const HDRS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };
const SHEETS_CRED = { googleSheetsOAuth2Api: { id: 'UhK77WK48hRv85bo', name: 'Google Sheets account' } };

const BASELINE = 'claude-opus-4-8';
const CANDIDATE = process.env.F06_CANDIDATE || 'claude-sonnet-4-6';
const N = Number(process.env.F06_N || 50);

const ENGINES = [
  ['#03', '9XuIEfxS71DEetVR', '19puwN6wxFHI7iICrdafiFn1Diqq7qJTe5-5r0Y2XQFY', 70],
  ['#14', '9x9M3EnEEeX3O8dy', '11lvksV5NmLK7vWvt4oHIPTXZ1pwRVi67UrWVI3lrAHQ', 50]
];

function must(c, m) { if (!c) { console.error('ASSERT FAILED:', m); process.exit(1); } }
const node = (w, n) => w.nodes.find((x) => x.name === n);

const PICK = (n) => `
// Take the first N banked rows that carry a full posting, and explode them into the
// shape Build Match Request expects.
const rows = ($input.first().json.values || []).slice(1);
const out = [];
for (const r of rows) {
  if (out.length >= ${n}) break;
  if (r[4] !== 'sourced_unscored' || !r[5]) continue;
  let j = null; try { j = JSON.parse(r[5]); } catch (e) { continue; }
  if (!j || !j.description || String(j.description).length < 200) continue;
  out.push({ json: {
    job_posting_id: j.job_posting_id, job_title: j.job_title, company_name: j.company_name,
    job_location: j.job_location, description: j.description, url: j.url,
    work_conditions: j.work_conditions, origin_location: j.origin_location, origin_country: j.origin_country
  } });
}
return out;
`;

const FAN = `
// One request per model, same body otherwise.
const out = [];
for (const it of $input.all()) {
  const j = it.json;
  for (const m of ${JSON.stringify([BASELINE, CANDIDATE])}) {
    out.push({ json: { ...j, _model: m, body: { ...j.body, model: m } } });
  }
}
return out;
`;

const COLLECT = `
// Pair the two scores per job. The live build node appends an assistant turn opening
// with "{", so replies come back without it.
function parseScore(resp) {
  let t = '';
  try { t = resp.content[0].text; } catch (e) { return null; }
  let s = String(t).trim().replace(/^\\\`\\\`\\\`json/i, '').replace(/^\\\`\\\`\\\`/, '').replace(/\\\`\\\`\\\`$/, '').trim();
  let p = null;
  try { p = JSON.parse(s); } catch (e) {}
  if (!p && s && s[0] !== '{') { try { p = JSON.parse('{' + s); } catch (e) {} }
  if (!p) { const a = s.indexOf('{'), b = s.lastIndexOf('}'); if (a >= 0 && b > a) { try { p = JSON.parse(s.slice(a, b + 1)); } catch (e) {} } }
  return p;
}
const fan = $('Fan Models').all();
const res = $input.all();
const byJob = {};
for (let i = 0; i < res.length; i++) {
  const meta = (fan[i] && fan[i].json) || {};
  const id = meta.job_posting_id || ('idx' + i);
  const p = parseScore(res[i].json || {});
  byJob[id] = byJob[id] || { job_posting_id: id, job_title: meta.job_title, company_name: meta.company_name };
  byJob[id][meta._model] = p ? { fit: p.fit_score, interest: p.interest_score, target_role: p.target_role } : null;
}
return [{ json: { results: Object.values(byJob) } }];
`;

async function calibrate(label, id, sheet, threshold) {
  console.log(`\n=== ${label} calibration | ${BASELINE} vs ${CANDIDATE} | n=${N} | threshold=${threshold} ===`);
  const eng = await (await fetch(`${API}/workflows/${id}`, { headers: HDRS })).json();
  must(eng.nodes, 'engine fetch failed');
  const bmr = JSON.parse(JSON.stringify(node(eng, 'Build Match Request')));
  const claude = JSON.parse(JSON.stringify(node(eng, 'Claude Match+Research')));
  must(bmr && claude, 'source nodes missing');
  // Speed: the live node sends one item per batch. This is an offline measurement, so
  // let it run a few concurrently.
  claude.parameters.options = Object.assign({}, claude.parameters.options, { batching: { batch: { batchSize: 4, batchInterval: 500 } } });
  claude.name = 'Claude Calib';
  claude.id = 'claude-calib';
  bmr.position = [400, 0]; claude.position = [1000, 0];

  const p = 'f06-' + Date.now();
  const nodes = [
    { parameters: { httpMethod: 'GET', path: p, responseMode: 'onReceived', options: {} },
      id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], webhookId: p },
    { parameters: { method: 'GET', url: `https://sheets.googleapis.com/v4/spreadsheets/${sheet}/values/${encodeURIComponent('processed_jobs!A1:F5000')}`,
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleSheetsOAuth2Api', options: {} },
      id: 'rd', name: 'Read Corpus', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [200, 0], credentials: SHEETS_CRED },
    { parameters: { jsCode: PICK(N) }, id: 'pick', name: 'Pick Corpus', type: 'n8n-nodes-base.code', typeVersion: 2, position: [300, 0] },
    bmr,
    { parameters: { jsCode: FAN }, id: 'fan', name: 'Fan Models', type: 'n8n-nodes-base.code', typeVersion: 2, position: [700, 0] },
    claude,
    { parameters: { jsCode: COLLECT }, id: 'coll', name: 'Collect', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1300, 0] }
  ];
  const order = ['Webhook', 'Read Corpus', 'Pick Corpus', bmr.name, 'Fan Models', 'Claude Calib', 'Collect'];
  const connections = {};
  for (let i = 0; i < order.length - 1; i++) connections[order[i]] = { main: [[{ node: order[i + 1], type: 'main', index: 0 }]] };

  const c = await fetch(API + '/workflows', { method: 'POST', headers: HDRS,
    body: JSON.stringify({ name: 'TEMP F06 Calib ' + label, nodes, connections, settings: { executionOrder: 'v1', timezone: 'Europe/Stockholm' } }) });
  const wf = await c.json();
  must(c.ok, 'calib create failed: ' + JSON.stringify(wf).slice(0, 400));
  console.log('  temp calib workflow:', wf.id);

  let results = null;
  try {
    await fetch(`${API}/workflows/${wf.id}/activate`, { method: 'POST', headers: HDRS });
    await new Promise((r) => setTimeout(r, 1500));
    await fetch(`${BASE}/webhook/${p}`);
    console.log('  fired, polling (this makes ' + (2 * N) + ' Claude calls)...');
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setTimeout(r, 10000));
      const l = await (await fetch(`${API}/executions?workflowId=${wf.id}&limit=3`, { headers: HDRS })).json();
      const e = (l.data || [])[0];
      if (!e) { process.stdout.write('.'); continue; }
      if (!(e.finished || e.status === 'error' || e.status === 'crashed' || e.status === 'success')) { process.stdout.write('.'); continue; }
      console.log(`\n  execution ${e.id} ${e.status}`);
      const full = await (await fetch(`${API}/executions/${e.id}?includeData=true`, { headers: HDRS })).json();
      const rd = full.data && full.data.resultData;
      if (rd && rd.lastNodeExecuted) console.log('  lastNodeExecuted:', rd.lastNodeExecuted);
      if (rd && rd.error) {
        console.log('  ERROR:', String(rd.error.message).slice(0, 300));
        const d = rd.error.description || (rd.error.cause && (rd.error.cause.message || JSON.stringify(rd.error.cause)));
        if (d) console.log('  DESCRIPTION:', String(d).slice(0, 900));
      }
      if (rd && rd.runData) {
        for (const [nm, runs] of Object.entries(rd.runData)) {
          const r0 = runs && runs[0];
          const cnt = (r0 && r0.data && r0.data.main && r0.data.main[0]) ? r0.data.main[0].length : 0;
          const err = r0 && r0.error ? ' ERR: ' + String(r0.error.message || '').slice(0, 200) +
            ' | ' + String((r0.error.description) || '').slice(0, 400) : '';
          console.log(`    ${nm.padEnd(24)} items=${cnt}${err}`);
        }
      }
      const col = rd && rd.runData && rd.runData.Collect && rd.runData.Collect[0];
      const arr = col && col.data && col.data.main && col.data.main[0];
      if (arr && arr[0]) results = arr[0].json.results;
      break;
    }
  } finally {
    await fetch(`${API}/workflows/${wf.id}/deactivate`, { method: 'POST', headers: HDRS }).catch(() => {});
    await fetch(`${API}/workflows/${wf.id}`, { method: 'DELETE', headers: HDRS }).catch(() => {});
    console.log('  temp calib deleted');
  }

  if (!results) { console.log('  NO RESULTS'); return null; }

  const paired = results.filter((r) => r[BASELINE] && r[CANDIDATE] && Number.isFinite(r[BASELINE].fit) && Number.isFinite(r[CANDIDATE].fit));
  const deltas = paired.map((r) => r[CANDIDATE].fit - r[BASELINE].fit);
  const abs = deltas.map(Math.abs).sort((a, b) => a - b);
  const within5 = abs.filter((d) => d <= 5).length;
  const mean = deltas.reduce((a, b) => a + b, 0) / (deltas.length || 1);
  const median = abs.length ? abs[Math.floor(abs.length / 2)] : null;
  const basePass = paired.filter((r) => r[BASELINE].fit >= threshold).length;
  const candPass = paired.filter((r) => r[CANDIDATE].fit >= threshold).length;
  const roleAgree = paired.filter((r) => r[BASELINE].target_role === r[CANDIDATE].target_role).length;

  console.log(`  paired:${paired.length}/${results.length} | mean delta ${mean.toFixed(1)} | median |delta| ${median} | within 5pts: ${within5}/${paired.length} (${Math.round(100 * within5 / paired.length)}%)`);
  console.log(`  pass@${threshold}: baseline ${basePass}, candidate ${candPass} | target_role agreement ${roleAgree}/${paired.length}`);

  // Threshold that best preserves the baseline pass count, if a switch is made anyway.
  let bestT = threshold, bestDiff = Infinity;
  for (let t = 0; t <= 100; t += 1) {
    const n = paired.filter((r) => r[CANDIDATE].fit >= t).length;
    const d = Math.abs(n - basePass);
    if (d < bestDiff) { bestDiff = d; bestT = t; }
  }
  const verdict = (within5 / paired.length) >= 0.7
    ? `SWITCH OK, keep threshold ${threshold}`
    : `DO NOT switch blindly. To preserve the pass rate the threshold would have to move ${threshold} -> ${bestT}`;
  console.log(`  VERDICT: ${verdict}`);

  return { engine: label, baseline: BASELINE, candidate: CANDIDATE, threshold, n: paired.length,
    meanDelta: +mean.toFixed(2), medianAbsDelta: median, within5, within5pct: +(100 * within5 / paired.length).toFixed(1),
    basePass, candPass, roleAgree, thresholdToPreservePassRate: bestT, verdict, rows: paired };
}

(async () => {
  const out = [];
  for (const [l, i, s, t] of ENGINES) {
    const r = await calibrate(l, i, s, t);
    if (r) out.push(r);
  }
  const dest = path.join(__dirname, 'f06-calibration.json');
  fs.writeFileSync(dest, JSON.stringify({ ran: '2026-07-27', baseline: BASELINE, candidate: CANDIDATE, engines: out }, null, 2));
  console.log('\ncalibration table saved to', path.basename(dest));
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
