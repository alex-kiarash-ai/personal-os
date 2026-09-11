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
 *     ['last_run_at']. Rows are padded to the written width before comparing.
 *   - A cell read back can be a number where a string was written. Everything is compared as text.
 * Anything beyond those two is a genuine mismatch and throws.
 *
 * On success it emits the two spreadsheet ids, the two urls and the exact next steps, because the
 * ids have to be copied into two lane files by hand and a run whose output you have to reconstruct
 * from the executions list is a run whose ids get copied wrong.
 */

const LOGIC = `
const seedOut = $('Build Seed Payload').first().json;
const got = {
  bi: $('Verify BI Sheet').first().json,
  ai: $('Verify AI Sheet').first().json,
};
const created = {
  bi: $('Create BI Spreadsheet').first().json,
  ai: $('Create AI Spreadsheet').first().json,
};

function norm(rows, width) {
  return (rows || []).map(function (r) {
    const out = (r || []).slice(0, width);
    while (out.length < width) out.push('');
    return out.map(function (c) { return String(c === null || c === undefined ? '' : c); });
  });
}

const problems = [];
for (const laneKey of ['bi', 'ai']) {
  const expected = seedOut[laneKey].batchBody.data;
  const actual = (got[laneKey] && got[laneKey].valueRanges) || [];
  if (actual.length !== expected.length) {
    problems.push(laneKey + ': asked for ' + expected.length + ' range(s) and got ' + actual.length + ' back');
    continue;
  }
  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i];
    let width = 0;
    for (const row of exp.values) width = Math.max(width, row.length);
    const e = norm(exp.values, width);
    const a = norm(actual[i].values, width);
    if (a.length !== e.length) {
      problems.push(laneKey + ' ' + exp.range + ': wrote ' + e.length + ' row(s), read back ' + a.length);
      continue;
    }
    for (let r = 0; r < e.length; r++) {
      if (JSON.stringify(e[r]) !== JSON.stringify(a[r])) {
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

function laneReport(laneKey) {
  return {
    spreadsheet_id: created[laneKey].spreadsheetId,
    url: created[laneKey].spreadsheetUrl,
    title: seedOut[laneKey].title,
    tabs: seedOut[laneKey].tabs,
    settings_rows: seedOut[laneKey].settings_row_count,
    verified: true,
  };
}

return [{
  json: {
    ok: true,
    provisioned_at: new Date().toISOString(),
    bi: laneReport('bi'),
    ai: laneReport('ai'),
    next: [
      'Write bi.spreadsheet_id into work/34-job-search-bi/config/lane.json at sheet.spreadsheet_id.',
      'Write ai.spreadsheet_id into work/35-job-search-ai/config/lane.json at sheet.spreadsheet_id.',
      'Fix sheet.tab and sheet.run_ledger_tab in BOTH lane files: they say BI / BI runs and AI / AI runs, which assumed one shared spreadsheet. The tabs are jobs and runs inside each lane own spreadsheet.',
      'Deactivate this workflow if it was activated for the webhook, then DELETE it. It has done its only job.',
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
