#!/usr/bin/env node
/*
 * run-job-lane-once.js - fire ONE real run of a job-search lane, on demand, from this machine.
 *
 *   node scripts/run-job-lane-once.js 34 [--confirm]
 *   node scripts/run-job-lane-once.js 35 [--confirm]
 *
 * WHY THIS EXISTS. n8n's PUBLIC API cannot start an execution. Measured, not assumed: POST to
 * /workflows/{id}/run, /workflows/{id}/execute and /executions all return 405 on 2.30.3. The only
 * documented way to run a lane by hand is the Execute button in the editor, which needs a human at
 * a browser, and the only other way is to wait for 06:30.
 *
 * WHAT IT DOES INSTEAD, and what it deliberately does NOT do. It takes the LIVE workflow, copies it
 * into a throwaway with a WEBHOOK where the schedule trigger was, calls that webhook once, polls for
 * the execution, prints the run report, and deletes the copy.
 *
 * THE PRODUCTION WORKFLOW IS NEVER TOUCHED. The obvious alternative was to add a webhook node to the
 * live workflow and rebuild it afterwards. That is one command to undo and it is still worse: for
 * the minutes in between, the live workflow carries a trigger nobody designed, and if anything
 * interrupts the session it stays there. A copy cannot do that. The cost of the copy is that it
 * holds a second workflow on the box for a couple of minutes, against a documented cap that is known
 * to be stale, and it is deleted in a `finally`.
 *
 * IT IS A REAL RUN AND IT HAS REAL SIDE EFFECTS. Same credentials, same spreadsheet, same Anthropic
 * account. It writes job rows, writes a run-ledger row, advances `last_run_at`, pushes to HQ and
 * spends money. That is the point: a dry run would prove nothing about a change to what the lane
 * collects. Consequences worth knowing before pressing --confirm:
 *   - the next scheduled run sees a SHORTER window, because this one moved the clock. That is
 *     exactly what any manual run does and the window logic is built for it.
 *   - dedupe means tomorrow's 06:30 will find fewer new rows. Not a fault.
 *   - it makes the same ~20 LinkedIn calls a scheduled run makes, from the same datacenter IP.
 *     Running BOTH lanes back to back doubles that in one window, which is why the two crons sit 15
 *     minutes apart. Space them.
 *
 * The copy keeps the lane's own error workflow, timezone and executionOrder, so a failure lands
 * where a scheduled failure would.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const KEY = (process.env.N8N_API_KEY || fs.readFileSync(path.join(REPO, 'work/03-application-engine/config/n8n-api-key.txt'), 'utf8')).trim();
const BASE = 'https://n8n.shaheenkiarash.com/api/v1';
const HOST = 'https://n8n.shaheenkiarash.com';
const HDRS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };

const LANE_ARG = process.argv[2];
const CONFIRM = process.argv.includes('--confirm');
const LANES = {
  34: 'work/34-job-search-bi/config/lane.json',
  35: 'work/35-job-search-ai/config/lane.json',
};
if (!LANES[LANE_ARG]) {
  console.error('usage: run-job-lane-once.js <34|35> [--confirm]');
  process.exit(2);
}
const LANE = JSON.parse(fs.readFileSync(path.join(REPO, LANES[LANE_ARG]), 'utf8'));
const WF_ID = LANE.workflow_id;
if (!WF_ID) { console.error('lane ' + LANE_ARG + ' has no workflow_id in its lane file.'); process.exit(2); }

const SETTINGS_ALLOWED = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution',
  'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'];

const api = async (m, u, b) => {
  const r = await fetch(BASE + u, { method: m, headers: HDRS, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch (e) { /* non-json */ }
  return { status: r.status, json: j, txt: t };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const live = await api('GET', '/workflows/' + WF_ID);
  if (live.status !== 200) { console.error('could not read the live workflow: ' + live.status); process.exit(1); }
  const wf = live.json;
  console.log('LANE #' + LANE_ARG + '  "' + wf.name + '"  ' + wf.nodes.length + ' nodes, active ' + wf.active);

  const trigger = wf.nodes.find((n) => n.type === 'n8n-nodes-base.scheduleTrigger');
  if (!trigger) { console.error('no schedule trigger to stand in for.'); process.exit(1); }
  const downstream = (wf.connections[trigger.name] || {}).main;
  if (!downstream || !downstream[0] || !downstream[0].length) { console.error('the schedule trigger feeds nothing.'); process.exit(1); }
  console.log('  trigger "' + trigger.name + '" feeds: ' + downstream[0].map((c) => c.node).join(', '));

  if (!CONFIRM) {
    console.log('\nDRY RUN. --confirm would:');
    console.log('  1. copy these ' + wf.nodes.length + ' nodes into a throwaway workflow, swapping the schedule trigger for a webhook');
    console.log('  2. call the webhook ONCE, which is a REAL run: real LinkedIn calls, real Anthropic spend,');
    console.log('     real rows written to the live sheet, last_run_at advanced, HQ pushed');
    console.log('  3. poll for the execution, print its run report');
    console.log('  4. delete the copy and verify it is gone');
    console.log('\nThe production workflow ' + WF_ID + ' is not modified at any point.');
    return;
  }

  // The copy. The webhook takes the trigger's NAME so every connection in the graph still resolves.
  const whpath = 'run-lane-' + LANE_ARG + '-' + Math.random().toString(36).slice(2, 10);
  const nodes = wf.nodes
    .filter((n) => n.type !== 'n8n-nodes-base.scheduleTrigger')
    .map((n) => JSON.parse(JSON.stringify(n)));
  nodes.push({
    parameters: { httpMethod: 'GET', path: whpath, responseMode: 'onReceived', options: {} },
    id: 'gowh', name: trigger.name, type: 'n8n-nodes-base.webhook', typeVersion: 2,
    position: trigger.position || [0, 0], webhookId: whpath,
  });
  const settings = {};
  for (const k of SETTINGS_ALLOWED) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];

  const copy = { name: 'ZZ RUN ONCE lane ' + LANE_ARG + ' (DELETE ME)', nodes: nodes, connections: wf.connections, settings: settings };
  const post = await api('POST', '/workflows', copy);
  if (post.status !== 200 && post.status !== 201) { console.error('copy failed ' + post.status + ': ' + post.txt.slice(0, 400)); process.exit(1); }
  const copyId = post.json.id;
  console.log('  copy ' + copyId + ' created (' + (post.json.nodes || []).length + ' nodes)');

  let failed = false;
  try {
    const act = await api('POST', '/workflows/' + copyId + '/activate');
    if (act.status !== 200) { console.error('  activate failed ' + act.status + ': ' + act.txt.slice(0, 300)); failed = true; throw new Error('activate'); }
    await sleep(2500);

    const started = new Date().toISOString();
    const url = HOST + '/webhook/' + whpath;
    console.log('  firing ' + url);
    const fired = await fetch(url).catch((e) => ({ status: 0, err: e.message }));
    console.log('  webhook returned ' + (fired.status || fired.err));

    // Poll. A scheduled run of this lane took about 90 seconds on 2026-09-17.
    let ex = null;
    for (let i = 0; i < 60; i += 1) {
      await sleep(5000);
      const list = await api('GET', '/executions?workflowId=' + copyId + '&limit=3');
      const rows = (list.json && list.json.data) || [];
      const mine = rows.filter((r) => !r.startedAt || r.startedAt >= started);
      if (mine.length) {
        ex = mine[0];
        if (ex.status !== 'running' && ex.status !== 'new' && ex.status !== 'waiting') break;
      }
      if (i % 4 === 3) console.log('    still running... ' + ((i + 1) * 5) + 's');
    }
    if (!ex) { console.error('  no execution appeared. The copy may not have fired.'); failed = true; throw new Error('no execution'); }
    console.log('  execution ' + ex.id + ': ' + ex.status + '  ' + ex.startedAt + ' -> ' + (ex.stoppedAt || 'still going'));
    if (ex.status !== 'success') failed = true;

    // READ THE EXECUTION BEFORE THE COPY IS DELETED. Deleting a workflow deletes ITS EXECUTIONS with
    // it, so the first version of this script threw away the run report it existed to fetch: the run
    // was real and successful and there was nothing left to show for it but the sheet. Fetch, save to
    // disk, and print, all inside the try, so the `finally` can delete freely.
    const full = await api('GET', '/executions/' + ex.id + '?includeData=true');
    if (full.status !== 200 || !full.json || !full.json.data) {
      console.log('  could not read the execution data (' + full.status + '). The run still happened; read the sheet.');
    } else {
      const outFile = path.join(REPO, 'scripts', 'n8n-backups', 'run-once-lane' + LANE_ARG + '-exec' + ex.id + '.json');
      fs.writeFileSync(outFile, JSON.stringify(full.json));
      console.log('  execution data saved: ' + path.relative(REPO, outFile));
      const runData = ((full.json.data || {}).resultData || {}).runData || {};
      const row = (((runData['Build Run Row'] || [])[0] || {}).data || {}).main;
      const r = row && row[0] && row[0][0] && row[0][0].json;
      if (r) {
        console.log('\n  RUN LEDGER ROW');
        for (const k of ['date', 'exec_id', 'searched', 'filtered', 'new', 'scored', 'verdict', 'cost_usd']) {
          console.log('    ' + String(k).padEnd(9) + ' ' + r[k]);
        }
        console.log('    note      ' + String(r.note || '').slice(0, 400));
      }
      const filt = (((runData.Filter || [])[0] || {}).data || {}).main;
      if (filt) {
        const kept = [];
        for (const out of filt) for (const it of (out || [])) if (it.json && it.json._kind === 'job') kept.push(it.json);
        const byScope = {};
        for (const k of kept) {
          const sc = (k._filter || {}).scope || '(none)';
          byScope[sc] = (byScope[sc] || 0) + 1;
        }
        console.log('\n  SURVIVED THE FILTER, BY SCOPE');
        for (const [k, v] of Object.entries(byScope).sort((a, b) => b[1] - a[1])) console.log('    ' + k.padEnd(20) + v);
      }
    }
  } finally {
    const d = await api('DELETE', '/workflows/' + copyId);
    const g = await api('GET', '/workflows/' + copyId);
    console.log('  cleanup: delete ' + copyId + ' -> ' + d.status + ', GET -> ' + g.status + (g.status === 404 ? ' (gone)' : ' (STILL THERE, delete by hand)'));
    if (g.status !== 404) failed = true;
    const after = await api('GET', '/workflows/' + WF_ID);
    console.log('  production ' + WF_ID + ' after: ' + ((after.json && after.json.nodes) || []).length + ' nodes, active ' + (after.json && after.json.active));
  }
  console.log(failed ? '\nVERDICT: the run did not finish clean.' : '\nVERDICT: run complete.');
  process.exit(failed ? 1 : 0);
})();
