'use strict';
/*
 * 71-check-sheet-writes.js - "Check Sheet Writes". The comparator: what the spreadsheet says now,
 * cell by cell, against what this run intended to write.
 *
 * =============================================================================================
 * 1. THE EXPECTED SIDE AND THE ACTUAL SIDE COME FROM DIFFERENT PLACES. THAT IS THE WHOLE POINT.
 * =============================================================================================
 * On 2026-09-12 this relay recorded its sharpest lesson: a node was "verified" by asking the n8n API
 * for a property name that does not exist on that node, and the echo was reported as proof. The test
 * suite made the identical mistake from the other side. A CHECK WHOSE EXPECTED VALUE COMES FROM THE
 * SAME PLACE AS THE ACTUAL VALUE CANNOT FAIL.
 *
 * So the EXPECTED values here come from Build Sheet Writes, which decided them before any write
 * existed, and the ACTUAL values come from a fresh read of the document. If Build Sheet Writes
 * cannot be reached, this node reports UNVERIFIED and does NOT fall back to comparing the read
 * against itself.
 *
 * =============================================================================================
 * 2. WHAT IS COMPARED, AND WHY EACH ONE CATCHES SOMETHING THE OTHERS DO NOT.
 * =============================================================================================
 *   the applications block   every cell of every row, by A1 address. Catches a row that landed in
 *                            the wrong columns, a truncated value, and a link that did not arrive.
 *   the applications A column  the row COUNT. This is the one that catches an OVERWRITE. The block
 *                            comparison alone cannot: if the computed free row was wrong and this
 *                            run wrote over somebody else rows, reading those cells back returns
 *                            exactly what was written and passes. Only the count says the tab did
 *                            not grow by the number of rows added.
 *   each jobs status cell    by A1 address. Catches a cell written at the wrong row number, which
 *                            would close the wrong job and leave the real one to be paid for again.
 *   the writer_runs row      every cell. This is the ledger the daily cap is counted out of, so a
 *                            wrong `attempted` cell is tomorrow spending the day twice.
 *   the writer_runs A column the row count, same argument as the applications one.
 *
 * A mismatch NAMES THE CELL, by tab and A1 address, with what was sent and what came back. A report
 * that says "a cell did not match" is a report somebody has to go and diff by hand.
 *
 * =============================================================================================
 * 3. IT NEVER THROWS. Assert Run does, three nodes later, AFTER the heartbeat.
 * =============================================================================================
 * The Verify-after-write order says a mismatch hard fails OR logs RED. This stage does both, in the
 * order that keeps the message: this node decides and colours, Build Run Report assembles, Push HQ
 * sends, and only then does Assert Run fail the execution. Throwing here would suppress the exact
 * message that says why, which is the failure this whole design is arranged against.
 *
 * =============================================================================================
 * 4. THE ONE TOLERANCE, AND IT IS A REAL SHEETS BEHAVIOUR RATHER THAN A LOOSENING.
 * =============================================================================================
 * Google TRIMS TRAILING EMPTY CELLS on the way back, so a thirteen column row whose last two cells
 * are empty comes home with eleven. `outcome` and `last_contact_at` are deliberately left empty by
 * this workflow, so that is not an edge case here, it is every single row. An absent trailing cell
 * and an empty one are the same thing. Every other difference is a failure.
 *
 * Numbers are compared as numbers. The read back asks for UNFORMATTED_VALUE precisely so a cost of
 * 0.284531 does not come back as a locale formatted string, and the comparison still coerces, so a
 * number that arrives as text still matches the number that was sent.
 */

const W = require('./_write');

const NODE_NAME = 'Check Sheet Writes';
const SAMPLE_MAX = 120;

(function assertAgainstUpstream() {
  const merge = require('./70-sheet-write-results.js');
  const build = require('./66-build-sheet-writes.js');
  const write = require('./68-write-sheets.js');
  const read = require('./69-read-back-sheets.js');
  if (merge.name !== 'Sheet Write Results') throw new Error(NODE_NAME + ': node 70 is named ' + JSON.stringify(merge.name) + ' and this node connects from it.');
  for (const [def, want] of [[build, 'Build Sheet Writes'], [write, 'Write Sheets'], [read, 'Read Back Sheets']]) {
    if (def.name !== want) {
      throw new Error(NODE_NAME + ': a node is named ' + JSON.stringify(def.name) + ' where ' + JSON.stringify(want) + ' was expected, and this node looks all three up BY NAME. A rename here is a rename inside a string literal, which nothing else would catch.');
    }
  }
  for (const [def, want] of [[write, 'Write Sheets'], [read, 'Read Back Sheets']]) {
    const resp = def.parameters.options.response.response;
    if (resp.fullResponse !== true || resp.neverError !== true) {
      throw new Error(NODE_NAME + ': ' + want + ' no longer sets fullResponse AND neverError, and this node reads statusCode and body off those items to tell a refused call from an empty tab.');
    }
  }
  const code = String(build.parameters.jsCode || '');
  for (const [needle, what] of [
    ['_intent: {', 'the whole EXPECTED side of every comparison below'],
    ['rows: appRows,', 'the applications rows as they were sent'],
    ['jobs_status: statusCells,', 'every addressed status cell as it was sent'],
    ['values: runRow,', 'the ledger row as it was sent'],
    ['rows_before: appsRowsBefore,', 'the row count BEFORE the write, which is the only thing that can catch an overwrite'],
  ]) {
    if (code.indexOf(needle) === -1) {
      throw new Error(
        NODE_NAME + ': Build Sheet Writes no longer emits ' + JSON.stringify(needle) + ', which is ' + what + '.\n' +
        '  Without an independent expected side this node would be comparing the sheet against itself,\n' +
        '  which is a check that cannot fail.'
      );
    }
  }
  if (code.indexOf('valueRenderOption=UNFORMATTED_VALUE') === -1) {
    throw new Error(
      NODE_NAME + ': the read back no longer asks for UNFORMATTED_VALUE.\n' +
      '  The batchGet default is FORMATTED_VALUE, which returns each cell as the string the UI would\n' +
      '  show under the spreadsheet locale, so a cost of 0.284531 can come back with a comma for a\n' +
      '  decimal point and the cell by cell comparison fails on a ledger row that was written perfectly.'
    );
  }
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// Check Sheet Writes. Cell by cell, expected from the node that decided, actual
// from a fresh read. Never throws: Assert Run does that, after the heartbeat.
// ---------------------------------------------------------------------------
function txt(v) { return String(v === null || v === undefined ? '' : v); }
function cut(s, n) { const t = txt(s); return t.length > n ? t.slice(0, n - 3) + '...' : t; }
function errText(e) { return cut(typeof e === 'string' ? e : ((e && e.message) || JSON.stringify(e)), 200); }
function rowsOf(vr) { return (vr && Array.isArray(vr.values)) ? vr.values : []; }

// Google TRIMS TRAILING EMPTY CELLS on the way back, so an absent cell and an empty one are the
// same thing. Numbers are compared as numbers: the read asks for UNFORMATTED_VALUE, and this still
// coerces so a number that arrives as text matches the number that was sent.
function sameCell(expected, actual) {
  if (typeof expected === 'number' && isFinite(expected)) {
    const a = Number(actual);
    if (!isFinite(a)) return false;
    return Math.abs(a - expected) < 1e-9;
  }
  return txt(expected) === txt(actual);
}
function colLetter(index) {
  let n = index;
  let s = '';
  while (true) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return s;
}

const inputItems = $input.all();
if (!inputItems.length) {
  throw new Error('Check Sheet Writes: Sheet Write Results delivered no items at all. Both of its inputs are always populated, so an empty input means the merge did not run.');
}

// --- 1. the three views, from three different nodes ---------------------------
function readNode(name) {
  try { return $(name).all().map((i) => i.json || {}); } catch (e) { return null; }
}
const intentsAll = readNode('Build Sheet Writes');
const writeResp = readNode('Write Sheets');
const readResp = readNode('Read Back Sheets');
const intents = intentsAll === null ? null : intentsAll.filter((j) => j && j._kind === 'sheet_write');

const problems = [];
const notes = [];
const perLane = [];
const verifiedJobIds = {};
const verifiedStatusRows = {};
let comparable = true;

if (intents === null) {
  comparable = false;
  problems.push('Build Sheet Writes could not be reached from this node, so there is no independent record of what this run intended to write. Comparing the sheet against itself is not a check, and this node will not do it.');
} else if (writeResp === null || readResp === null) {
  comparable = false;
  problems.push('the write responses or the read back responses could not be reached, so nothing can be compared. The run is reported UNVERIFIED.');
} else if (!intents.length) {
  comparable = false;
  problems.push('no write request was built for any lane. Build Sheet Writes emits one per lane on every run, including a lane with nothing to write, so none at all means that node did not run its lane loop.');
} else if (writeResp.length !== intents.length || readResp.length !== intents.length) {
  comparable = false;
  problems.push('THE CALL COUNTS DO NOT MATCH: ' + intents.length + ' lane(s) intended, ' + writeResp.length + ' write response(s), ' + readResp.length + ' read back(s). One call per lane is what stops the two spreadsheets being reported against each other, and a count that does not match makes every comparison below a guess.');
}

// --- 2. lane by lane -----------------------------------------------------------
if (comparable) {
  for (let i = 0; i < intents.length; i += 1) {
    const it = intents[i];
    const intent = (it && it._intent) || {};
    const key = txt(it.lane_key);
    const lane = { lane: key, wrote: 0, checked: 0, problems: [], write_status: null, read_status: null, writable: intent.writable === true };

    // --- the write itself ---
    const w = writeResp[i] || {};
    if (w.error !== undefined && w.statusCode === undefined) {
      lane.problems.push('the write never completed: ' + errText(w.error));
    } else {
      const ws = Number(w.statusCode);
      lane.write_status = isFinite(ws) ? ws : null;
      if (!isFinite(ws)) {
        lane.problems.push('the write response carried no statusCode, and fullResponse is set on Write Sheets, so the item is not an HTTP response at all.');
      } else if (ws < 200 || ws >= 300) {
        const msg = (w.body && w.body.error && w.body.error.message) ? txt(w.body.error.message) : '';
        lane.problems.push('THE WRITE WAS REFUSED, HTTP ' + ws + (msg ? ': ' + cut(msg, 300) : '') + '. Nothing was written for this lane, so every one of its job rows is still new and tomorrow morning offers them again.');
      }
    }

    const wantRanges = Array.isArray(it.read_back_range_names) ? it.read_back_range_names : [];
    const r = readResp[i] || {};
    let vrs = null;
    if (r.error !== undefined && r.statusCode === undefined) {
      lane.problems.push('the read back never completed: ' + errText(r.error) + '. Nothing this lane wrote can be proved, which is not the same as nothing having been written.');
    } else {
      const rs = Number(r.statusCode);
      lane.read_status = isFinite(rs) ? rs : null;
      if (!isFinite(rs)) {
        lane.problems.push('the read back response carried no statusCode.');
      } else if (rs < 200 || rs >= 300) {
        const msg = (r.body && r.body.error && r.body.error.message) ? txt(r.body.error.message) : '';
        lane.problems.push('THE READ BACK WAS REFUSED, HTTP ' + rs + (msg ? ': ' + cut(msg, 300) : '') + '. What this lane wrote cannot be proved either way.');
      } else {
        const got = (r.body && Array.isArray(r.body.valueRanges)) ? r.body.valueRanges : null;
        if (!got || got.length !== wantRanges.length) {
          lane.problems.push('the read back returned ' + (got ? got.length : 'no') + ' valueRange(s) and this run asked for ' + wantRanges.length + ' (' + wantRanges.join(', ') + '), read BY POSITION. A different count means the url and this node have come apart.');
        } else {
          vrs = {};
          for (let k = 0; k < wantRanges.length; k += 1) vrs[wantRanges[k]] = got[k];
        }
      }
    }

    if (vrs) {
      const appsTab = txt(intent.applications && intent.applications.tab);
      const runsTab = txt(intent.writer_runs && intent.writer_runs.tab);
      const jobsTab = txt((intent.jobs_status && intent.jobs_status[0] && intent.jobs_status[0].range) || '').split('!')[0];

      // --- the applications block, cell by cell ---
      const appIntent = intent.applications || {};
      const appRows = Array.isArray(appIntent.rows) ? appIntent.rows : [];
      if (appRows.length) {
        const back = rowsOf(vrs.applications_rows);
        if (back.length !== appRows.length) {
          lane.problems.push(appsTab + '!' + txt(appIntent.range) + ': ' + appRows.length + ' row(s) were written and ' + back.length + ' came back. A short read back over the exact range that was written means the rows are not where this run put them.');
        } else {
          for (let ri = 0; ri < appRows.length; ri += 1) {
            const exp = appRows[ri];
            const act = back[ri] || [];
            const sheetRow = Number(appIntent.start_row) + ri;
            let rowOk = true;
            for (let ci = 0; ci < exp.length; ci += 1) {
              lane.checked += 1;
              if (!sameCell(exp[ci], act[ci])) {
                rowOk = false;
                lane.problems.push(appsTab + '!' + colLetter(ci) + sheetRow + ' (' + APP_COLUMNS[ci] + '): sent ' + JSON.stringify(cut(exp[ci], SAMPLE_MAX)) + ' and the sheet reads ' + JSON.stringify(cut(act[ci], SAMPLE_MAX)) + '.');
              }
            }
            if (rowOk) {
              const jobId = txt(exp[0]);
              if (jobId) {
                if (!verifiedJobIds[key]) verifiedJobIds[key] = {};
                verifiedJobIds[key][jobId] = true;
              }
              lane.wrote += 1;
            }
          }
        }
        // THE OVERWRITE CHECK. The block comparison above cannot catch this on its own: reading back
        // cells this run wrote returns what it wrote, whether or not they landed on top of somebody
        // else rows. Only the COUNT says the tab grew.
        const idsBack = rowsOf(vrs.applications_ids);
        const expectedRows = Number(appIntent.rows_before) + appRows.length;
        if (idsBack.length !== expectedRows) {
          lane.problems.push(appsTab + '!A:A: the tab held ' + appIntent.rows_before + ' row(s) before the write and ' + appRows.length + ' were added, so it should hold ' + expectedRows + '. It holds ' + idsBack.length + '. A count that is short means this run wrote ON TOP of rows that were already there, which reading back the written cells could never show.');
        }
      } else {
        notes.push('lane ' + key + ': no applications row was written, so there was nothing to compare in that tab.');
      }

      // --- the jobs status cells, one addressed cell at a time ---
      const statusCells = Array.isArray(intent.jobs_status) ? intent.jobs_status : [];
      if (statusCells.length) {
        const col = rowsOf(vrs.jobs_status);
        for (const sc of statusCells) {
          lane.checked += 1;
          const rowIdx = Number(sc.sheet_row) - 1;
          const actual = (col[rowIdx] && col[rowIdx][0] !== undefined) ? col[rowIdx][0] : '';
          if (!sameCell(sc.value, actual)) {
            lane.problems.push(txt(sc.range) + ' (job ' + txt(sc.job_id) + '): sent ' + JSON.stringify(cut(sc.value, SAMPLE_MAX)) + ' and the sheet reads ' + JSON.stringify(cut(actual, SAMPLE_MAX)) + '. A status cell that did not land leaves that job in tomorrow queue, and one that landed on the WRONG ROW closes a job nobody wrote.');
          } else {
            if (!verifiedStatusRows[key]) verifiedStatusRows[key] = {};
            verifiedStatusRows[key][txt(sc.job_id)] = true;
          }
        }
      } else if (intent.writable) {
        notes.push('lane ' + key + ': no job status cell was written, so nothing came out of tomorrow queue for this lane.');
      }

      // --- the ledger row ---
      const runsIntent = intent.writer_runs || {};
      if (runsIntent.range) {
        const back = rowsOf(vrs.writer_runs_row);
        const exp = Array.isArray(runsIntent.values) ? runsIntent.values : [];
        const act = back[0] || [];
        if (!back.length) {
          lane.problems.push(txt(runsIntent.range) + ': the ledger row was written and the read back over that exact range returned nothing. Without it the daily cap cannot count today, so tomorrow morning can spend the whole day cap again.');
        } else {
          for (let ci = 0; ci < exp.length; ci += 1) {
            lane.checked += 1;
            if (!sameCell(exp[ci], act[ci])) {
              lane.problems.push(runsTab + '!' + colLetter(ci) + runsIntent.row + ' (' + RUNS_COLUMNS[ci] + '): sent ' + JSON.stringify(cut(exp[ci], SAMPLE_MAX)) + ' and the sheet reads ' + JSON.stringify(cut(act[ci], SAMPLE_MAX)) + '.' + (RUNS_COLUMNS[ci] === 'attempted' ? ' This is the cell the daily cap is counted out of.' : ''));
            }
          }
        }
        const idsBack = rowsOf(vrs.writer_runs_ids);
        const expectedRows = Number(runsIntent.rows_before) + (runsIntent.header_written ? 1 : 0) + 1;
        if (idsBack.length !== expectedRows) {
          lane.problems.push(runsTab + '!A:A: the tab held ' + runsIntent.rows_before + ' row(s) before the write and ' + ((runsIntent.header_written ? 1 : 0) + 1) + ' were added, so it should hold ' + expectedRows + '. It holds ' + idsBack.length + '.');
        }
      } else if (intent.writable) {
        lane.problems.push('NO LEDGER ROW WAS WRITTEN for this lane. The daily cap is counted out of writer_runs, so without today row a second run this morning would read zero attempts and spend the whole cap again.');
      }
    }

    if (lane.problems.length) for (const p of lane.problems) problems.push('lane ' + key + ': ' + p);
    perLane.push(lane);
  }
}

// --- 3. stamp the pairs, and carry everything ----------------------------------
const out = [];
const stats = { pairs: 0, shipped: 0, shipped_rows_verified: 0, shipped_rows_unverified: 0, carried: 0 };

for (const item of inputItems) {
  const raw = (item && item.json) || {};
  if (raw._kind === undefined || raw._kind === null) continue;   // the read back responses
  if (raw._kind === 'sheet_write') continue;                     // consumed, and it carries the whole body
  const j = Object.assign({}, raw);
  j._call_now = false;
  j.needs_convert = false;

  if (j._kind === 'pair') {
    stats.pairs += 1;
    const key = txt(j.lane_key);
    const jobId = txt(j.job_id);
    const rowVerified = !!(verifiedJobIds[key] && verifiedJobIds[key][jobId]);
    const statusVerified = !!(verifiedStatusRows[key] && verifiedStatusRows[key][jobId]);
    j._sheet_row_verified = rowVerified;
    j._sheet_status_verified = statusVerified;
    if (!j._status) {
      stats.shipped += 1;
      if (rowVerified) stats.shipped_rows_verified += 1;
      else stats.shipped_rows_unverified += 1;
    }
  } else {
    stats.carried += 1;
  }
  out.push(j);
}

if (comparable && stats.shipped_rows_unverified > 0) {
  problems.push(stats.shipped_rows_unverified + ' shipped application(s) have documents in Drive and NO verified row in the applications tab. The documents exist and nothing points at them, which is the one outcome that is invisible from the sheet he actually reads.');
}

const verified = comparable && problems.length === 0;

const report = {
  _kind: 'stage_report',
  stage: 'check_sheet_writes',
  verified: verified,
  comparable: comparable,
  counts: stats,
  lanes: perLane,
  problems: problems,
  notes: notes,
  cells_checked: perLane.reduce((n, l) => n + l.checked, 0),
  rule: 'the EXPECTED values come from Build Sheet Writes, which decided them before any write existed, and the ACTUAL values come from a fresh read of the document. A check whose expected value comes from the same place as the actual value cannot fail. This node never throws: it decides and colours, Build Run Report assembles, Push HQ sends, and Assert Run fails the execution afterwards, so the message that explains why is never suppressed by the failure it explains.',
  tolerance: 'Google trims trailing empty cells on the way back, so an absent trailing cell and an empty one are the same thing. That is every single row here, because outcome and last_contact_at are deliberately left empty. Every other difference is a failure.',
  needs_convert: false,
  _call_now: false,
  site_fetch_url: '',
  ad_fetch_url: '',
};

const finalItems = out.map((j) => ({ json: j, pairedItem: { item: 0 } }));
finalItems.push({ json: report, pairedItem: { item: 0 } });
return finalItems;
`;

function renderJsCode() {
  return [
    '// GENERATED at build time from work/36-job-application-writer/nodes/71-check-sheet-writes.js.',
    '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
    'const APP_COLUMNS = ' + JSON.stringify(W.APPLICATIONS_COLUMNS) + ';',
    'const RUNS_COLUMNS = ' + JSON.stringify(W.WRITER_RUNS_COLUMNS) + ';',
    'const SAMPLE_MAX = ' + JSON.stringify(SAMPLE_MAX) + ';',
    LOGIC,
  ].join('\n');
}

W.assertGeneratedSourceIsClean(renderJsCode(), NODE_NAME);

module.exports = {
  name: NODE_NAME,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [17940, 100],
  connectFrom: 'Sheet Write Results',
  notes: 'Compares what each spreadsheet says now against what this run intended, cell by cell, and NAMES the cell on a mismatch. Five comparisons per lane: every cell of every applications row, the applications A column ROW COUNT which is the only thing that can catch an overwrite, every addressed job status cell, every cell of the ledger row, and the writer_runs row count. The expected side comes from Build Sheet Writes and the actual side from a fresh read, because a check whose expected value comes from the same place as the actual value cannot fail. It never throws: it decides and colours, and Assert Run fails the execution three nodes later, after the heartbeat has gone out.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: renderJsCode(),
  },
};
