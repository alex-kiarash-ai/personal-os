'use strict';
/*
 * 10-report.js - compares what was written against what came back, then reports.
 *
 * This is the half of Verify-after-write that actually decides. The two verify nodes fetch; this
 * one asserts, cell by cell, against the SAME payload that was sent, taken from Build Seed Payload
 * rather than from a second copy of the expectation. A separately typed expectation can agree with
 * itself and disagree with reality.
 *
 * Two normalisations, both real behaviour of the Sheets API and neither of them a fudge:
 *   - Sheets trims trailing empty cells, so a written row ['last_run_at',''] reads back as
 *     ['last_run_at']. Rows are padded to a common width before comparing.
 *   - A cell read back can be a number where a string was written. Everything is compared as text.
 * Anything beyond those two is a genuine mismatch and throws.
 *
 * On success it emits the two spreadsheet ids, the two urls and the exact next steps, because the
 * ids have to be copied into two lane files by hand and a run whose output you have to reconstruct
 * from the executions list is a run whose ids get copied wrong.
 *
 * HARDENED 2026-09-11 after a code review. Four real defects fixed, one adopted defensively:
 *   (a) Ranges were paired by INDEX (actual[i] vs expected[i]). batchGet does return ranges in the
 *       order asked, so it worked, but nothing enforced that the verify node's range list stayed in
 *       the same order as batchBody.data. Now paired by TAB NAME. The API normalises a range on the
 *       way back (settings!A:B comes back settings!A1:B31), so the key is the part before the '!',
 *       never the whole range string.
 *   (b) Width was taken from the EXPECTED rows only and the actual row was sliced to it, so an extra
 *       column in the sheet was cut away and the check passed. This was live: the header rows are
 *       read as <tab>!1:1, which returns every column present, so a stray 16th column on `jobs`
 *       would have been invisible. Width is now the max over both sides.
 *   (c) The failure path could crash before reporting: created.bi.spreadsheetId throws a TypeError
 *       if the create node produced nothing, hiding the real cause. Every lookup is guarded.
 *   (d) An error item (if a verify node is ever switched to continue-on-fail) was reported as
 *       "got 0 ranges back". The underlying error is surfaced instead. The verify nodes fail hard
 *       today, so this is insurance against a future rewiring, not a live fix.
 *   (e) Tab names are now checked against the create response, but DEFENSIVELY: the n8n Google
 *       Sheets node's spreadsheet:create output shape is not verified on this box, so an absent
 *       sheets[] array is recorded as a skipped check rather than failing a correct run. A check
 *       that cannot run must say so, not quietly pass.
 */

const LOGIC = `
const seedOut = $('Build Seed Payload').first().json;

// Every lookup guarded: on a failure path these may be empty, and a TypeError here would hide the
// real cause behind a stack trace about reading a property of undefined.
const pick = (node) => {
  try { const it = $(node).first(); return (it && it.json) || {}; } catch (e) { return {}; }
};
const created = { bi: pick('Create BI Spreadsheet'), ai: pick('Create AI Spreadsheet') };
const got = { bi: pick('Verify BI Sheet'), ai: pick('Verify AI Sheet') };

// The API normalises ranges on the way back, so match on the tab name, not the range string.
const tabOf = (range) => String(range || '').split('!')[0].replace(/^'/, '').replace(/'$/, '').toLowerCase();
const cell = (c) => String(c === null || c === undefined ? '' : c);
const widthOf = (rows) => (rows || []).reduce((w, r) => Math.max(w, (r || []).length), 0);
const norm = (rows, width) => (rows || []).map((r) => {
  const out = (r || []).map(cell);
  while (out.length < width) out.push('');
  return out;
});
const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);

const problems = [];
const notes = [];

for (const laneKey of ['bi', 'ai']) {
  const seed = seedOut[laneKey];
  const create = created[laneKey];
  const read = got[laneKey];

  if (!seed) { problems.push(laneKey + ': no seed payload found'); continue; }
  if (!create.spreadsheetId) { problems.push(laneKey + ': create returned no spreadsheetId'); continue; }
  if (read.error) { problems.push(laneKey + ': read back errored: ' + JSON.stringify(read.error)); continue; }

  // (e) tab names, only when the create response actually carries them.
  const declaredTabs = (create.sheets || []).map((s) => (s.properties || {}).title).filter(Boolean);
  if (declaredTabs.length) {
    if (!same(declaredTabs.map(String), (seed.tabs || []).map(String))) {
      problems.push(laneKey + ': tabs are ' + JSON.stringify(declaredTabs) + ', expected ' + JSON.stringify(seed.tabs));
    }
  } else {
    notes.push(laneKey + ': tab-name check SKIPPED, the create response carried no sheets[] array');
  }

  const actualByTab = {};
  for (const vr of read.valueRanges || []) actualByTab[tabOf(vr.range)] = vr.values || [];

  for (const exp of seed.batchBody.data) {
    const tab = tabOf(exp.range);
    if (!(tab in actualByTab)) {
      problems.push(laneKey + ' ' + exp.range + ': tab missing from the read back');
      continue;
    }
    const width = Math.max(widthOf(exp.values), widthOf(actualByTab[tab]));
    const e = norm(exp.values, width);
    const a = norm(actualByTab[tab], width);
    if (a.length !== e.length) {
      problems.push(laneKey + ' ' + exp.range + ': wrote ' + e.length + ' row(s), read back ' + a.length);
      continue;
    }
    for (let r = 0; r < e.length; r++) {
      if (!same(e[r], a[r])) {
        problems.push(laneKey + ' ' + exp.range + ' row ' + (r + 1) + ': wrote ' + JSON.stringify(e[r]) + ', read back ' + JSON.stringify(a[r]));
      }
    }
  }
}

if (problems.length) {
  throw new Error(
    'provision: READ-BACK FAILED. The spreadsheets exist but do not hold what was written.\\n' +
    '  BI ' + (created.bi.spreadsheetId || 'unknown') + '\\n' +
    '  AI ' + (created.ai.spreadsheetId || 'unknown') + '\\n' +
    '  - ' + problems.join('\\n  - ') + '\\n' +
    '  Do NOT copy these ids into the lane files. Delete both spreadsheets and run this again.'
  );
}

const laneReport = (laneKey) => ({
  spreadsheet_id: created[laneKey].spreadsheetId,
  url: created[laneKey].spreadsheetUrl,
  title: seedOut[laneKey].title,
  tabs: seedOut[laneKey].tabs,
  settings_rows: seedOut[laneKey].settings_row_count,
  verified: true,
});

return [{
  json: {
    ok: true,
    provisioned_at: new Date().toISOString(),
    checks_skipped: notes,
    bi: laneReport('bi'),
    ai: laneReport('ai'),
    next: [
      'Write bi.spreadsheet_id into work/34-job-search-bi/config/lane.json at sheet.spreadsheet_id.',
      'Write ai.spreadsheet_id into work/35-job-search-ai/config/lane.json at sheet.spreadsheet_id.',
      'Fix sheet.tab and sheet.run_ledger_tab in BOTH lane files: they say BI / BI runs and AI / AI runs, which assumed one shared spreadsheet. The tabs are jobs and runs inside each lane own spreadsheet.',
      'DELETE this workflow. It has done its only job.',
    ],
  },
}];
`;

module.exports = {
  name: 'Report',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [1780, 100],
  connectFrom: 'Verify AI Sheet',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: LOGIC,
  },
};
