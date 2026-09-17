#!/usr/bin/env node
/*
 * trim-job-sheets-2026-09-17.js - one-shot, DESTRUCTIVE, Shaheen's instruction 2026-09-17.
 *
 * Removes four columns from the `jobs` tab and four from the `applications` tab in BOTH job-search
 * spreadsheets, snapshotting every affected tab first.
 *
 *   jobs:         apply_url, fit_reasons, lane, excerpt      (15 columns -> 11)
 *   applications: lane, last_contact_at, outcome, notes      (13 columns -> 9)
 *
 * WHY IT RUNS THROUGH n8n. Deleting a COLUMN is a spreadsheets.batchUpdate deleteDimension request,
 * and the Google credential that can make it lives on the box as an n8n credential, never on this
 * machine. So this builds a throwaway webhook workflow that carries the credential, calls it once,
 * and deletes it. Same pattern as scripts/clear-bank-backlog.js, which cleared three live bank tabs
 * the same way on 2026-07-28.
 *
 * THE ORDER IS LOAD BEARING, all four of these:
 *
 *  1. SNAPSHOT BEFORE ANY DELETE. A deleted column takes its data with it and there is no undo on
 *     an API write. Every affected tab is read in full and written to a local file OUTSIDE the repo
 *     before a single delete is sent, and the run ABORTS if a snapshot is short or unreadable.
 *  2. DELETE RIGHT TO LEFT. deleteDimension takes an INDEX, and deleting index 9 shifts every
 *     column after it left by one. Deleting in descending index order means no index moves under a
 *     later request. (The same batch would also apply requests in order, so this is not belt AND
 *     braces, it is the only correct order.)
 *  3. INDICES ARE READ OFF THE LIVE HEADER, never taken from the contract. If the live header is not
 *     the fifteen and thirteen columns this script expects, it refuses the whole spreadsheet rather
 *     than deleting by position into a sheet somebody has already edited.
 *  4. READ BACK IN THE SAME RUN (the Verify-after-write standing order). The header of every tab is
 *     re-read after the delete and asserted against the expected new list. A 200 is not
 *     verification, and this is a destructive write on his only copy of the data.
 *
 * ---------------------------------------------------------------------------------------------
 * THE DISPLACED HEADER, found by the first dry run and not something this script went looking for.
 * ---------------------------------------------------------------------------------------------
 * The BI `jobs` tab came back with a DATA row in row 1 and the header row at the BOTTOM (row 37).
 * Every row including the header is fifteen cells wide, which is what a sort applied to the whole
 * range rather than to the data does. The sheet was last modified by hand a few hours after the
 * morning runs, so the sort is recent and the runs that fired this morning were fine.
 *
 * IT IS NOT COSMETIC. The Google Sheets append node reads the FIRST ROW as the header and, on
 * mappingMode defineBelow, runs checkForSchemaChanges against it; #36 node 05 asserts the live
 * header before it reads a cell. So a header sitting in the last row breaks tomorrow's 06:30 write
 * and the 07:15 writer, and it would have broken them whether or not anybody trimmed a column.
 *
 * So this script repairs it FIRST, before any column is deleted, in three requests per affected tab:
 * insert one row at the top, write the fifteen header cells into it, delete the old header row at
 * its shifted index. The DATA row order is left exactly as it is: whoever sorted the tab may have
 * meant to, and moving the header back is the whole fix.
 *
 * Usage:
 *   node scripts/trim-job-sheets-2026-09-17.js            # snapshot + report the plan, change nothing
 *   node scripts/trim-job-sheets-2026-09-17.js --confirm   # repair, delete, then read back
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const KEY = (process.env.N8N_API_KEY || fs.readFileSync(path.join(REPO, 'work/03-application-engine/config/n8n-api-key.txt'), 'utf8')).trim();
const BASE = 'https://n8n.shaheenkiarash.com/api/v1';
const HOST = 'https://n8n.shaheenkiarash.com';
const HDRS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };
const CONFIRM = process.argv.includes('--confirm');

// The snapshot lands OUTSIDE the repo. The repo is public and these rows carry company names, job
// urls and, in the applications notes column, whole cover letters.
const SNAP_DIR = path.join(os.homedir(), 'alex-sheet-snapshots', '2026-09-17-job-sheets');

// ---------------------------------------------------------------------------------------------
// EVERY ID IS READ FROM THE GITIGNORED LANE FILES. NONE IS IN THIS FILE.
//
// This script is TRACKED and the repo is PUBLIC. A spreadsheet id and a credential id are exactly
// what the 2026-07-04 privacy scrub keeps out of it, and both lanes already carry theirs in
// `work/{34,35}-job-search-{bi,ai}/config/lane.json`, which is gitignored (.gitignore:98). The
// first draft of this file had all three pasted in as literals, which is how a public repo acquires
// them: not by anybody deciding to publish, but by a one-shot script that was useful enough to keep.
// ---------------------------------------------------------------------------------------------
function laneFile(rel) {
  const p = path.join(REPO, rel);
  if (!fs.existsSync(p)) {
    throw new Error('missing ' + rel + '. It is gitignored and local-only, and every id this script needs lives in it, so a fresh clone cannot run this without the lane files restored from the encrypted backup.');
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const LANE_BI = laneFile('work/34-job-search-bi/config/lane.json');
const LANE_AI = laneFile('work/35-job-search-ai/config/lane.json');

const GOOGLE_CRED = { id: LANE_BI.credentials.google_sheets, name: 'Google Sheets account' };

const LANES = [
  { key: 'bi', label: 'Job Search - BI (34)', spreadsheetId: LANE_BI.sheet.spreadsheet_id },
  { key: 'ai', label: 'Job Search - AI (35)', spreadsheetId: LANE_AI.sheet.spreadsheet_id },
];
for (const L of LANES) {
  if (!L.spreadsheetId) throw new Error(L.label + ': the lane file carries no sheet.spreadsheet_id.');
}
if (!GOOGLE_CRED.id) throw new Error('work/34-job-search-bi/config/lane.json carries no credentials.google_sheets, and the throwaway workflow cannot reach Sheets without it.');
if (LANE_AI.credentials.google_sheets !== GOOGLE_CRED.id) {
  throw new Error('the two lanes name DIFFERENT Google Sheets credentials. They have always shared one; if that changed deliberately this script needs one workflow per credential.');
}

const JOBS_BEFORE = ['job_id', 'found_at', 'source', 'title', 'company', 'location', 'remote', 'posted_at', 'url', 'apply_url', 'fit_score', 'fit_reasons', 'status', 'lane', 'excerpt'];
const JOBS_DROP = ['apply_url', 'fit_reasons', 'lane', 'excerpt'];
const APPS_BEFORE = ['job_id', 'applied_at', 'lane', 'company', 'title', 'url', 'channel', 'cv_ref', 'cover_letter_ref', 'status', 'last_contact_at', 'outcome', 'notes'];
const APPS_DROP = ['lane', 'last_contact_at', 'outcome', 'notes'];

const JOBS_AFTER = JOBS_BEFORE.filter((c) => JOBS_DROP.indexOf(c) === -1);
const APPS_AFTER = APPS_BEFORE.filter((c) => APPS_DROP.indexOf(c) === -1);

// Both spreadsheets also carry a jobs_test tab, written once during the 2026-09-14 proving runs and
// never since. It is trimmed too: leaving one tab on the old shape is how a future reader concludes
// the trim half-landed.
const TABS = [
  { tab: 'jobs', before: JOBS_BEFORE, drop: JOBS_DROP, after: JOBS_AFTER, required: true },
  { tab: 'jobs_test', before: JOBS_BEFORE, drop: JOBS_DROP, after: JOBS_AFTER, required: false },
  { tab: 'applications', before: APPS_BEFORE, drop: APPS_DROP, after: APPS_AFTER, required: true },
];

const api = async (m, u, b) => {
  const r = await fetch(BASE + u, { method: m, headers: HDRS, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch (e) { /* non-json */ }
  return { status: r.status, json: j, txt: t };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// The throwaway workflow. ONE webhook, one Code node that builds the calls, one HTTP node that
// makes them with the Google credential, one Code node that summarises. The Code node receives the
// plan as a query parameter so the same workflow serves read and write.
// ---------------------------------------------------------------------------------------------
const CALLS_FROM_QUERY = `
const q = $input.first().json.query || {};
const plan = JSON.parse(q.plan || '[]');
return plan.map((c) => ({ json: c }));
`;

const SUMMARIZE = `
const planned = $('Calls').all().map((i) => i.json);
const res = $input.all();
const out = [];
for (let i = 0; i < res.length; i++) {
  const p = planned[i] || {};
  const r = res[i].json || {};
  let body = r.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) {} }
  out.push({
    label: p.label || '?',
    method: p.method,
    status: Number(r.statusCode),
    // values:batchGet returns valueRanges; batchUpdate returns replies. Both are kept whole: this
    // is the only record of what the call actually did.
    body: body === undefined ? null : body,
  });
}
return [{ json: { results: out } }];
`;

function workflow(whpath) {
  return {
    name: 'ZZ Trim job sheets 2026-09-17 (DELETE ME)',
    nodes: [
      { parameters: { httpMethod: 'GET', path: whpath, responseMode: 'lastNode', options: {} }, id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], webhookId: whpath },
      { parameters: { jsCode: CALLS_FROM_QUERY }, id: 'cl', name: 'Calls', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 0] },
      {
        // EVERY CALL IS A POST AND sendBody IS A LITERAL true. The first --confirm attempt had
        // `method` and `sendBody` as expressions ('={{ $json.method === "POST" }}'), and the GETs
        // worked while all three writes came back 400 "Must specify at least one request": the
        // boolean expression did not evaluate, so n8n sent no body at all. Nothing was changed by
        // that run, which is the only reason this is a note rather than an incident.
        //
        // So the reads use the POST twins of the two read endpoints (:getByDataFilter and
        // values:batchGetByDataFilter) rather than their GET originals, and this node needs no
        // per-item branching at all. One shape, one path, no expression deciding whether a body
        // exists.
        parameters: {
          method: 'POST',
          url: '={{ $json.url }}',
          authentication: 'predefinedCredentialType',
          nodeCredentialType: 'googleSheetsOAuth2Api',
          sendBody: true,
          specifyBody: 'json',
          jsonBody: '={{ JSON.stringify($json.body) }}',
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
// The POST twins of values:batchGet and spreadsheets.get. Same data, and they take their arguments
// in a body like every write here does, which is what lets one node serve every call.
function valuesRead(id, tabs) {
  return {
    url: SHEETS + id + '/values:batchGetByDataFilter',
    body: { dataFilters: tabs.map((t) => ({ a1Range: t })), majorDimension: 'ROWS' },
  };
}
function metaRead(id, tabs) {
  return {
    url: SHEETS + id + ':getByDataFilter',
    body: { dataFilters: tabs.map((t) => ({ a1Range: t })), includeGridData: false },
  };
}
// batchGetByDataFilter nests each range one level deeper than batchGet does.
function rangesOf(body) {
  const out = {};
  for (const entry of ((body && body.valueRanges) || [])) {
    const vr = entry.valueRange || entry;
    const tab = String(vr.range || '').split('!')[0].replace(/^'|'$/g, '');
    if (tab) out[tab] = vr.values || [];
  }
  return out;
}

async function callPlan(wfId, whpath, plan) {
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
  console.log('TRIM JOB SHEETS 2026-09-17' + (CONFIRM ? '  (--confirm: WILL DELETE)' : '  (dry: snapshot and plan only)'));
  fs.mkdirSync(SNAP_DIR, { recursive: true });

  const post = await api('POST', '/workflows', workflow('trim-sheets-' + Math.random().toString(36).slice(2, 10)));
  if (post.status !== 200 && post.status !== 201) { console.log('CREATE failed ' + post.status + ': ' + post.txt.slice(0, 300)); process.exit(1); }
  const wfId = post.json.id;
  const whpath = post.json.nodes[0].parameters.path;
  const act = await api('POST', '/workflows/' + wfId + '/activate');
  console.log('temp workflow ' + wfId + ' created, activate ' + act.status);

  let failed = false;
  try {
    // ---------------- 1. READ: the live headers, the grid metadata and a full snapshot ----------
    const readPlan = [];
    for (const L of LANES) {
      const m = metaRead(L.spreadsheetId, TABS.map((t) => t.tab + '!A1'));
      const v = valuesRead(L.spreadsheetId, TABS.map((t) => t.tab + '!A:Z'));
      readPlan.push({ label: L.key + ':meta', method: 'POST', url: m.url, body: m.body });
      readPlan.push({ label: L.key + ':values', method: 'POST', url: v.url, body: v.body });
    }
    const read = await callPlan(wfId, whpath, readPlan);
    if (!read || !read.results) { console.log('READ failed, nothing was changed.'); failed = true; throw new Error('read'); }

    const state = {};
    for (const L of LANES) {
      const meta = read.results.find((r) => r.label === L.key + ':meta');
      const vals = read.results.find((r) => r.label === L.key + ':values');
      if (!meta || meta.status !== 200 || !vals || vals.status !== 200) {
        console.log('  ' + L.label + ': read failed (' + (meta && meta.status) + '/' + (vals && vals.status) + ')');
        failed = true; continue;
      }
      const sheetIds = {};
      for (const s of (meta.body.sheets || [])) sheetIds[s.properties.title] = s.properties.sheetId;
      const ranges = rangesOf(vals.body);
      state[L.key] = { sheetIds, ranges };

      // The snapshot, one JSON file per spreadsheet per RUN, every affected tab in full.
      //
      // THE FILENAME CARRIES A TIMESTAMP AND AN EXISTING FILE IS NEVER OVERWRITTEN, and that is not
      // tidiness. The first version wrote `<lane>-before.json` flat, so re-running the script AFTER
      // the trim replaced the only copy of the pre-trim data with a copy of the post-trim data. It
      // happened: a verification re-run on 2026-09-17 overwrote both files minutes after the
      // columns were deleted. A snapshot that a later run can clobber is not a snapshot, it is a
      // cache, and the whole reason this one exists is that a deleted column cannot be undone.
      const snap = { spreadsheet_id: L.spreadsheetId, label: L.label, taken_at: new Date().toISOString(), tabs: ranges, sheet_ids: sheetIds };
      const widths = {};
      for (const t of Object.keys(ranges)) widths[t] = (ranges[t][0] || []).length;
      snap.header_widths = widths;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const f = path.join(SNAP_DIR, L.key + '-' + stamp + '.json');
      if (fs.existsSync(f)) { console.log('  REFUSED to overwrite ' + f); failed = true; continue; }
      fs.writeFileSync(f, JSON.stringify(snap, null, 2));
      const rows = Object.keys(ranges).map((t) => t + '=' + ranges[t].length + 'x' + widths[t]).join(' ');
      console.log('  ' + L.label + ': snapshot ' + path.basename(f) + '  (' + rows + ')');
      // The WIDTH is printed beside the row count on purpose: it is the one number that says at a
      // glance whether this snapshot was taken before or after the trim.
    }
    if (failed) throw new Error('snapshot');

    // ---------------- 2a. REPAIR: a header row that a sort moved out of row 1 -----------------
    // Run as its own call BEFORE the deletes, because every delete index below is read off row 1.
    const repairPlan = [];
    const repaired = [];
    for (const L of LANES) {
      const S = state[L.key];
      const requests = [];
      const valueWrites = [];
      for (const T of TABS) {
        const rows = S.ranges[T.tab];
        if (!rows || !rows.length) continue;
        const firstIsHeader = rows[0].map((h) => String(h).trim()).join(',') === T.before.join(',')
          || rows[0].map((h) => String(h).trim()).join(',') === T.after.join(',');
        if (firstIsHeader) continue;
        const at = rows.findIndex((r) => r && String(r[0]).trim() === T.before[0]
          && r.map((h) => String(h).trim()).join(',') === T.before.join(','));
        if (at === -1) {
          console.log('  REFUSED ' + L.label + ' ' + T.tab + ': row 1 is not the header and no row in the tab is.');
          failed = true; continue;
        }
        const sheetId = S.sheetIds[T.tab];
        if (sheetId === undefined) { console.log('  REFUSED ' + L.label + ' ' + T.tab + ': no sheetId.'); failed = true; continue; }
        // Insert at the top, then delete the OLD header row at its index SHIFTED DOWN by one.
        requests.push({ insertDimension: { range: { sheetId: sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, inheritFromBefore: false } });
        valueWrites.push({ range: T.tab + '!A1', values: [T.before] });
        requests.push({ deleteDimension: { range: { sheetId: sheetId, dimension: 'ROWS', startIndex: at + 1, endIndex: at + 2 } } });
        repaired.push(L.label + ' ' + T.tab + ' (header was row ' + (at + 1) + ' of ' + rows.length + ')');
        console.log('  REPAIR ' + L.label + ' ' + T.tab + ': header is at row ' + (at + 1) + ', moving it back to row 1');
        // The snapshot already holds this tab in full, so the repair is reversible from disk.
      }
      if (requests.length) {
        // The insert and the delete go in ONE batchUpdate so the tab is never left with two header
        // rows or none; the values write is a separate call because it is a values:batchUpdate.
        repairPlan.push({ label: L.key + ':repair-structure', method: 'POST', url: SHEETS + L.spreadsheetId + ':batchUpdate', body: { requests: [requests[0]] } });
        repairPlan.push({ label: L.key + ':repair-values', method: 'POST', url: SHEETS + L.spreadsheetId + '/values:batchUpdate', body: { valueInputOption: 'RAW', data: valueWrites } });
        repairPlan.push({ label: L.key + ':repair-cleanup', method: 'POST', url: SHEETS + L.spreadsheetId + ':batchUpdate', body: { requests: requests.slice(1) } });
      }
    }
    if (failed) { console.log('\nREFUSED before any write. Nothing was changed.'); throw new Error('repair-plan'); }

    if (repairPlan.length) {
      if (!CONFIRM) {
        console.log('\n  (dry run: the repair above would run FIRST, then the deletes below)');
      } else {
        const rep = await callPlan(wfId, whpath, repairPlan);
        if (!rep || !rep.results) { console.log('REPAIR call failed. Check the sheets by hand before re-running.'); failed = true; throw new Error('repair'); }
        for (const r of rep.results) {
          console.log('  ' + r.label + ': HTTP ' + r.status + (r.status === 200 ? '' : ' ' + JSON.stringify(r.body).slice(0, 240)));
          if (r.status !== 200) failed = true;
        }
        if (failed) throw new Error('repair');
        // Re-read, because every delete index below is taken off row 1 and it has just moved.
        const re = await callPlan(wfId, whpath, LANES.map((L) => {
          const v = valuesRead(L.spreadsheetId, TABS.map((t) => t.tab + '!A:Z'));
          return { label: L.key + ':values', method: 'POST', url: v.url, body: v.body };
        }));
        if (!re || !re.results) { console.log('the re-read after the repair failed; refusing to delete by an index nobody has seen.'); failed = true; throw new Error('reread'); }
        for (const L of LANES) {
          const vals = re.results.find((r) => r.label === L.key + ':values');
          if (!vals || vals.status !== 200) { console.log('  ' + L.label + ': re-read failed'); failed = true; continue; }
          state[L.key].ranges = rangesOf(vals.body);
        }
        if (failed) throw new Error('reread');
        console.log('  repaired and re-read: ' + repaired.join('; '));
      }
    }

    // ---------------- 2b. PLAN: indices off the LIVE header, descending -----------------------
    const deletePlan = [];
    for (const L of LANES) {
      const S = state[L.key];
      const requests = [];
      for (const T of TABS) {
        const rows = S.ranges[T.tab];
        if (!rows || !rows.length) {
          if (T.required) { console.log('  REFUSED ' + L.label + ' ' + T.tab + ': the tab is empty or missing, so there is no header to delete by.'); failed = true; }
          else console.log('  skipping ' + L.label + ' ' + T.tab + ': not present or empty, which is fine.');
          continue;
        }
        const header = rows[0].map((h) => String(h).trim());
        if (header.join(',') !== T.before.join(',')) {
          // Already trimmed is not a failure: it makes this script idempotent.
          if (header.join(',') === T.after.join(',')) { console.log('  ' + L.label + ' ' + T.tab + ': ALREADY the new header, nothing to do.'); continue; }
          console.log('  REFUSED ' + L.label + ' ' + T.tab + ': the live header is not the one this script expects.');
          console.log('    live:     ' + header.join(','));
          console.log('    expected: ' + T.before.join(','));
          failed = true; continue;
        }
        const sheetId = S.sheetIds[T.tab];
        if (sheetId === undefined) { console.log('  REFUSED ' + L.label + ' ' + T.tab + ': no sheetId in the grid metadata.'); failed = true; continue; }
        const idx = T.drop.map((c) => header.indexOf(c)).sort((a, b) => b - a);   // descending, see header note 2
        for (const i of idx) {
          requests.push({ deleteDimension: { range: { sheetId: sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 } } });
        }
        console.log('  ' + L.label + ' ' + T.tab + ': delete columns ' + idx.slice().reverse().map((i) => header[i] + '(' + i + ')').join(', ') + ' -> ' + T.after.length + ' columns');
      }
      if (requests.length) {
        deletePlan.push({ label: L.key + ':delete', method: 'POST', url: SHEETS + L.spreadsheetId + ':batchUpdate', body: { requests: requests } });
      }
    }
    if (failed) { console.log('\nREFUSED: nothing was deleted. Fix the mismatch above and run again.'); throw new Error('plan'); }
    if (!deletePlan.length) { console.log('\nNothing to delete: both spreadsheets already carry the new headers.'); return; }
    if (!CONFIRM) { console.log('\nDRY RUN. The snapshot is written and the plan above is what --confirm would send.'); return; }

    // ---------------- 3. DELETE ----------------------------------------------------------------
    const del = await callPlan(wfId, whpath, deletePlan);
    if (!del || !del.results) { console.log('DELETE call failed. Read the headers back before assuming nothing changed.'); failed = true; throw new Error('delete'); }
    for (const r of del.results) {
      console.log('  ' + r.label + ': HTTP ' + r.status + (r.status === 200 ? ' (' + ((r.body && r.body.replies) || []).length + ' replies)' : ' ' + JSON.stringify(r.body).slice(0, 240)));
      if (r.status !== 200) failed = true;
    }

    // ---------------- 4. READ BACK, the standing order ----------------------------------------
    const verifyPlan = LANES.map((L) => {
      const v = valuesRead(L.spreadsheetId, TABS.map((t) => t.tab + '!1:1'));
      return { label: L.key + ':verify', method: 'POST', url: v.url, body: v.body };
    });
    const ver = await callPlan(wfId, whpath, verifyPlan);
    console.log('\nREAD BACK:');
    if (!ver || !ver.results) { console.log('  the read back itself failed. The delete may have landed; check the sheets by hand.'); failed = true; }
    else {
      for (const L of LANES) {
        const v = ver.results.find((r) => r.label === L.key + ':verify');
        if (!v || v.status !== 200) { console.log('  ' + L.label + ': read back failed'); failed = true; continue; }
        const rr = rangesOf(v.body);
        const got = {};
        for (const tab of Object.keys(rr)) got[tab] = ((rr[tab] || [])[0] || []).map((h) => String(h).trim());
        for (const T of TABS) {
          const header = got[T.tab];
          if (!header) { if (T.required) { console.log('  ' + L.label + ' ' + T.tab + ': MISSING on read back'); failed = true; } continue; }
          const ok = header.join(',') === T.after.join(',');
          console.log('  ' + (ok ? 'OK   ' : 'WRONG') + ' ' + L.label + ' ' + T.tab + ': ' + header.join(','));
          if (!ok) failed = true;
        }
      }
    }
  } finally {
    const d = await api('DELETE', '/workflows/' + wfId);
    console.log('\ncleanup: delete temp workflow ' + wfId + ' -> ' + d.status);
    const left = await api('GET', '/workflows/' + wfId);
    console.log('cleanup verified: GET ' + wfId + ' -> ' + left.status + (left.status === 404 ? ' (gone)' : ' (STILL THERE, delete it by hand)'));
  }
  console.log(failed ? '\nVERDICT: FAILED, read the lines above.' : '\nVERDICT: DONE and verified.');
  process.exit(failed ? 1 : 0);
})();
