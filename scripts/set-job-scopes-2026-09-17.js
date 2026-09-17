#!/usr/bin/env node
/*
 * set-job-scopes-2026-09-17.js - writes the SETTINGS cells that decide which scopes are live.
 *
 * Two cells per spreadsheet, four in total: `locations` and `geo_rule`.
 *
 * WHY THIS IS THE SHARP END. The node files decide what a scope MEANS; the `locations` cell decides
 * which scopes are ACTIVE, and the two must name the same set. Plan Queries refuses a run when the
 * sheet lists a scope it has no target for, and the Filter refuses when the sheet lists one it has
 * no token list for. Both refusals are correct and both stop the whole morning, so deploying the
 * code without this write leaves two workflows that throw at 06:30.
 *
 * WHY NOT THE SETTINGS SYNC WORKFLOW. `ocR7RJ988KcnAL6V` is the documented bulk path and it writes
 * every settings row from seed.json. That is the wrong tool here: Shaheen has HAND EDITED cells in
 * those tabs (linkedin_max_calls_per_run reads 25 on the live sheet and 25 is not in seed.json), and
 * a bulk rewrite would silently reset them. Two targeted cells, read back, touch nothing else.
 *
 * WHAT IT READS FIRST, AND WHY IT CAN REFUSE. The current `locations` value has to be the one this
 * change expects. If somebody has already edited it, the safe move is to stop: this script cannot
 * tell a half-applied change from a deliberate one.
 *
 * Usage:
 *   node scripts/set-job-scopes-2026-09-17.js            # print the diff, change nothing
 *   node scripts/set-job-scopes-2026-09-17.js --confirm   # write, then read back
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
  if (!fs.existsSync(p)) throw new Error('missing ' + rel + ' (gitignored, local-only)');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
const LANE_BI = laneFile('work/34-job-search-bi/config/lane.json');
const LANE_AI = laneFile('work/35-job-search-ai/config/lane.json');
const SEED = laneFile('work/34-job-search-bi/config/seed.json');
const GOOGLE_CRED = { id: LANE_BI.credentials.google_sheets, name: 'Google Sheets account' };

// The values come from seed.json, which is the source of truth for the settings. Never typed here:
// a literal in this file is a second copy of a list that already has an owner.
const WANT = {
  locations: SEED.lanes.bi.settings.locations.join('|'),
  geo_rule: SEED.lanes.bi.settings.geo_rule,
};
if (SEED.lanes.ai.settings.locations.join('|') !== WANT.locations) {
  throw new Error('seed.json gives the two lanes DIFFERENT location lists. They have always shared one; if that changed deliberately this script needs a per-lane value.');
}
if (SEED.lanes.ai.settings.geo_rule !== WANT.geo_rule) {
  throw new Error('seed.json gives the two lanes different geo_rule text. Same reasoning as above.');
}

// What the cell is expected to say BEFORE the write. A mismatch is a refusal, not a warning.
const EXPECT_LOCATIONS = 'Sweden|Remote EU|Remote UK|Remote EMEA|Gulf|Non-EU Europe';

const LANES = [
  { key: 'bi', label: 'Job Search - BI (34)', spreadsheetId: LANE_BI.sheet.spreadsheet_id, tab: LANE_BI.sheet.settings_tab },
  { key: 'ai', label: 'Job Search - AI (35)', spreadsheetId: LANE_AI.sheet.spreadsheet_id, tab: LANE_AI.sheet.settings_tab },
];

const api = async (m, u, b) => {
  const r = await fetch(BASE + u, { method: m, headers: HDRS, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch (e) { /* non-json */ }
  return { status: r.status, json: j, txt: t };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CALLS = "\nconst q = $input.first().json.query || {};\nreturn JSON.parse(q.plan || '[]').map((c) => ({ json: c }));\n";
const SUMMARIZE = "\nconst planned = $('Calls').all().map((i) => i.json);\nconst res = $input.all();\nconst out = [];\nfor (let i = 0; i < res.length; i++) {\n  const r = res[i].json || {};\n  let body = r.body;\n  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) {} }\n  out.push({ label: (planned[i] || {}).label || '?', status: Number(r.statusCode), body: body === undefined ? null : body });\n}\nreturn [{ json: { results: out } }];\n";

function workflow(whpath) {
  return {
    name: 'ZZ Set job scopes 2026-09-17 (DELETE ME)',
    nodes: [
      { parameters: { httpMethod: 'GET', path: whpath, responseMode: 'lastNode', options: {} }, id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], webhookId: whpath },
      { parameters: { jsCode: CALLS }, id: 'cl', name: 'Calls', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 0] },
      {
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
const read = (id, ranges) => ({ url: SHEETS + id + '/values:batchGetByDataFilter', body: { dataFilters: ranges.map((r) => ({ a1Range: r })), majorDimension: 'ROWS' } });
function rowsOf(body) {
  const out = [];
  for (const e of ((body && body.valueRanges) || [])) {
    const vr = e.valueRange || e;
    for (const row of (vr.values || [])) out.push(row);
  }
  return out;
}

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
  console.log('SET JOB SCOPES' + (CONFIRM ? '  (--confirm: WILL WRITE)' : '  (dry: diff only)'));
  console.log('  locations -> ' + WANT.locations);
  console.log('  geo_rule  -> ' + WANT.geo_rule.slice(0, 100) + '...');

  const post = await api('POST', '/workflows', workflow('set-scopes-' + Math.random().toString(36).slice(2, 10)));
  if (post.status !== 200 && post.status !== 201) { console.log('CREATE failed ' + post.status + ': ' + post.txt.slice(0, 300)); process.exit(1); }
  const wfId = post.json.id;
  const whpath = post.json.nodes[0].parameters.path;
  await api('POST', '/workflows/' + wfId + '/activate');
  console.log('temp workflow ' + wfId + ' created');

  let failed = false;
  try {
    // 1. READ the whole settings tab, so the row NUMBER of each key is found rather than assumed.
    const got = await callPlan(whpath, LANES.map((L) => {
      const r = read(L.spreadsheetId, [L.tab + '!A:B']);
      return { label: L.key, url: r.url, body: r.body };
    }));
    if (!got || !got.results) { console.log('READ failed, nothing written.'); failed = true; throw new Error('read'); }

    const writes = [];
    for (const L of LANES) {
      const res = got.results.find((r) => r.label === L.key);
      if (!res || res.status !== 200) { console.log('  ' + L.label + ': read failed'); failed = true; continue; }
      const rows = rowsOf(res.body);
      const at = {};
      rows.forEach((row, i) => { if (row && row[0]) at[String(row[0]).trim()] = { row: i + 1, value: row.length > 1 ? String(row[1]) : '' }; });

      for (const key of ['locations', 'geo_rule']) {
        const cur = at[key];
        if (!cur) { console.log('  REFUSED ' + L.label + ': the settings tab has no `' + key + '` row.'); failed = true; continue; }
        if (cur.value === WANT[key]) { console.log('  ' + L.label + ' ' + key + ': ALREADY correct, nothing to do'); continue; }
        if (key === 'locations' && cur.value !== EXPECT_LOCATIONS) {
          console.log('  REFUSED ' + L.label + ' locations: the cell is neither the expected old value nor the new one.');
          console.log('    live    : ' + cur.value);
          console.log('    expected: ' + EXPECT_LOCATIONS);
          failed = true; continue;
        }
        console.log('  ' + L.label + ' ' + key + ': row ' + cur.row + ', ' + JSON.stringify(cur.value.slice(0, 60)) + ' -> ' + JSON.stringify(WANT[key].slice(0, 60)));
        writes.push({ lane: L, key: key, range: L.tab + '!B' + cur.row });
      }
    }
    if (failed) { console.log('\nREFUSED: nothing was written.'); throw new Error('plan'); }
    if (!writes.length) { console.log('\nNothing to do: both settings tabs already carry the new values.'); return; }
    if (!CONFIRM) { console.log('\nDRY RUN. --confirm sends the ' + writes.length + ' cell write(s) above.'); return; }

    // 2. WRITE, one batch per spreadsheet.
    const byLane = {};
    for (const w of writes) {
      byLane[w.lane.key] = byLane[w.lane.key] || { lane: w.lane, data: [] };
      byLane[w.lane.key].data.push({ range: w.range, values: [[WANT[w.key]]] });
    }
    const wrote = await callPlan(whpath, Object.values(byLane).map((g) => ({
      label: g.lane.key + ':write',
      url: SHEETS + g.lane.spreadsheetId + '/values:batchUpdate',
      body: { valueInputOption: 'RAW', data: g.data },
    })));
    if (!wrote || !wrote.results) { console.log('WRITE failed; read the cells back before assuming nothing changed.'); failed = true; throw new Error('write'); }
    for (const r of wrote.results) {
      console.log('  ' + r.label + ': HTTP ' + r.status + (r.status === 200 ? ' (' + ((r.body && r.body.totalUpdatedCells) || 0) + ' cells)' : ' ' + JSON.stringify(r.body).slice(0, 200)));
      if (r.status !== 200) failed = true;
    }

    // 3. READ BACK.
    const ver = await callPlan(whpath, LANES.map((L) => {
      const r = read(L.spreadsheetId, [L.tab + '!A:B']);
      return { label: L.key + ':verify', url: r.url, body: r.body };
    }));
    console.log('\nREAD BACK:');
    if (!ver || !ver.results) { console.log('  the read back failed; check the sheets by hand.'); failed = true; }
    else {
      for (const L of LANES) {
        const res = ver.results.find((r) => r.label === L.key + ':verify');
        if (!res || res.status !== 200) { console.log('  ' + L.label + ': read back failed'); failed = true; continue; }
        const rows = rowsOf(res.body);
        for (const key of ['locations', 'geo_rule']) {
          const row = rows.find((r) => r && String(r[0]).trim() === key);
          const val = row && row.length > 1 ? String(row[1]) : '';
          const ok = val === WANT[key];
          console.log('  ' + (ok ? 'OK   ' : 'WRONG') + ' ' + L.label + ' ' + key + ': ' + val.slice(0, 90) + (val.length > 90 ? '...' : ''));
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
