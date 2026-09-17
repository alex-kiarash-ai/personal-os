'use strict';
/*
 * 47-check-writes.js - "Check Writes". The comparator for the two writes Build Run Row could not
 * verify, because they had not happened yet when it ran.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. THE EXPECTED SIDE AND THE ACTUAL SIDE COME FROM DIFFERENT PLACES, WHICH IS THE WHOLE POINT.
 * ---------------------------------------------------------------------------------------------
 * On 2026-09-12 this session recorded the sharpest lesson in the relay: a Combine node was
 * "verified" by asking the n8n API for a property name that does not exist on that node, and the
 * echo was reported as proof. The test suite made the identical mistake from the other side,
 * asserting the invented name against the node file that set it. **A check whose expected value
 * comes from the same place as the actual value cannot fail.**
 *
 * So here: the EXPECTED values come from Build Run Row, which built the ledger row and the window
 * body before either write existed. The ACTUAL values come from a fresh read of the spreadsheet.
 * Two independent sources. If Build Run Row is unreachable this node reports UNVERIFIED and does not
 * fall back to comparing the read against itself.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. IT NEVER THROWS. Assert Writes does, one node later, AFTER the push.
 * ---------------------------------------------------------------------------------------------
 * The Verify-after-write order says hard-fail OR log RED. This stage does both, in the order that
 * keeps the report: this node decides and colours, Push HQ sends, and Assert Writes then fails the
 * execution so the shared error workflow fires and the n8n run list does not read `success` on a run
 * whose window write went missing. Throwing here instead would suppress the very message that says
 * so, which is the failure mode the whole lane is arranged against.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. THE PRESERVED-CELL CHECK IS AS IMPORTANT AS THE WRITTEN ONE.
 * ---------------------------------------------------------------------------------------------
 * On a run that must NOT advance, the interesting question is not "did the write land", it is "did
 * anything touch that cell". The empty-data batchUpdate is supposed to change nothing, so
 * last_run_at must read back byte for byte equal to what Read Back Jobs saw before the write. A
 * mismatch there means the window moved on a run that had not covered it, which is the single
 * failure this stage exists to make impossible.
 *
 * One real Sheets behaviour the comparison has to allow, and only one: TRAILING EMPTY CELLS ARE
 * TRIMMED on the way back, so a row written as ['last_run_at',''] comes home as ['last_run_at'] with
 * length 1. An empty cell and an absent second cell are the same thing, and both live sheets carry
 * an empty last_run_at today, which is exactly the cell this check is about. Every other difference
 * is a failure.
 */

const O = require('./_output');
const { lane } = require('./_lane');

const L = lane();

(function assertAgainstUpstream() {
  const read = require('./46-read-back-writes.js');
  if (read.name !== 'Read Back Writes') throw new Error('Check Writes: node 46 is named ' + JSON.stringify(read.name) + ' and this node connects from "Read Back Writes".');
  const resp = read.parameters.options && read.parameters.options.response && read.parameters.options.response.response;
  if (!resp || resp.fullResponse !== true || resp.neverError !== true) {
    throw new Error('Check Writes: Read Back Writes no longer sets fullResponse AND neverError, and this node reads statusCode off the item to tell a refused read from an empty tab.');
  }
  const brr = require('./43-build-run-row.js');
  const src = (brr.parameters && brr.parameters.jsCode) || '';
  for (const f of ['_last_run_expected', '_hq', '_advance', '_report']) {
    if (src.indexOf(f + ':') === -1) {
      throw new Error('Check Writes: Build Run Row no longer emits ' + JSON.stringify(f) + '. That is the EXPECTED side of this comparison, and without an independent expected side the check compares the read to itself and can never fail.');
    }
  }
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// Check Writes. Did the ledger row and the window write actually land.
// ---------------------------------------------------------------------------
let intended;
try {
  intended = $('Build Run Row').first().json;
} catch (e) {
  throw new Error('Check Writes: cannot reach Build Run Row (' + e.message + '). It holds the EXPECTED side of every comparison below, and comparing the sheet against itself is not a check.');
}
const report = intended._report || {};
const runRow = {};
for (const c of RUNS_COLUMNS) runRow[c] = intended[c];

const back = ($input.all()[0] || {}).json || {};
const problems = [];
const notes = [];

function rangeTab(r) { const s = String(r || ''); const i = s.indexOf('!'); return (i === -1 ? s : s.slice(0, i)).replace(/^'/, '').replace(/'$/, '').split("''").join("'"); }
function txt(v) { return String(v === null || v === undefined ? '' : v); }

const check = {
  read_back_ok: false,
  http_status: null,
  why: null,
  ledger: { header_ok: null, row_found: false, row_number: null, mismatched_cells: [], rows_in_tab: 0 },
  last_run: { expected: txt(intended._last_run_expected), actual: null, advanced: intended._advance === true, preserved: null, matches: null, row: intended._last_run_row },
};

if (back.error !== undefined && back.statusCode === undefined) {
  check.why = 'the read-back request never completed: ' + txt(typeof back.error === 'string' ? back.error : (back.error && back.error.message) || JSON.stringify(back.error)).slice(0, 240);
} else if (!isFinite(Number(back.statusCode))) {
  check.why = 'the read-back carried no statusCode. fullResponse is set upstream, so a missing status means the item is not an HTTP response at all.';
} else {
  check.http_status = Number(back.statusCode);
  const body = back.body || {};
  if (check.http_status < 200 || check.http_status >= 300) {
    const msg = (body && body.error && body.error.message) ? String(body.error.message) : '';
    check.why = 'the read-back returned HTTP ' + check.http_status + '. ' + (msg || 'no message');
  } else if (!Array.isArray(body.valueRanges) || body.valueRanges.length < 2) {
    check.why = 'the read-back returned ' + ((body.valueRanges || []).length) + ' valueRange(s) and two were requested.';
  } else {
    // Matched by TAB NAME. The two ranges are on different tabs here, so a name is enough and the
    // index is not trusted: the API normalises a range on the way back.
    const runsVR = body.valueRanges.find((vr) => rangeTab(vr.range) === RUNS_TAB);
    const settingsVR = body.valueRanges.find((vr) => rangeTab(vr.range) === SETTINGS_TAB);
    if (!runsVR || !settingsVR) {
      check.why = 'the read-back came home with ranges this node could not match: ' + JSON.stringify(body.valueRanges.map((v) => v.range));
    } else {
      check.read_back_ok = true;

      // --- the ledger ---------------------------------------------------------
      const rows = runsVR.values || [];
      const header = (rows[0] || []).map((c) => txt(c).trim());
      check.ledger.rows_in_tab = Math.max(0, rows.length - 1);
      check.ledger.header_ok = header.length >= RUNS_COLUMNS.length && RUNS_COLUMNS.every((c, i) => header[i] === c);
      if (!check.ledger.header_ok) {
        problems.push('THE RUNS TAB HEADER IS NOT THE NINE PROVISIONED COLUMNS. Live: ' + JSON.stringify(header) + '. Expected to start with: ' + JSON.stringify(RUNS_COLUMNS) + '. Every ledger cell is written by column NAME, so this run\\'s row is in columns nobody meant.');
      }

      // Find this run's row by exec_id, falling back to the date stamp when the execution id could
      // not be read. Searched from the BOTTOM, because an append lands at the end and a re-run of the
      // same execution would otherwise match its older row.
      const idCol = RUNS_COLUMNS.indexOf('exec_id');
      const dateCol = RUNS_COLUMNS.indexOf('date');
      const wantId = txt(runRow.exec_id);
      const wantDate = txt(runRow.date);
      let found = null;
      for (let i = rows.length - 1; i >= 1; i -= 1) {
        const r = rows[i] || [];
        const okId = wantId !== '' && txt(r[idCol]) === wantId;
        const okDate = wantId === '' && wantDate !== '' && txt(r[dateCol]) === wantDate;
        if (okId || okDate) { found = { row: i + 1, cells: r }; break; }
      }
      if (!found) {
        problems.push('THE LEDGER ROW FOR THIS RUN IS NOT IN THE RUNS TAB. Looked for exec_id ' + JSON.stringify(wantId) + (wantId === '' ? ' (empty, so it fell back to the date ' + JSON.stringify(wantDate) + ')' : '') + ' in ' + check.ledger.rows_in_tab + ' data row(s). The append returned without writing, or it wrote somewhere else.');
      } else {
        check.ledger.row_found = true;
        check.ledger.row_number = found.row;
        // Cell by cell against what Build Run Row built. Numbers are compared as numbers, because a
        // RAW write of 12 comes back as the number 12 and as the string "12" from some clients.
        for (let c = 0; c < RUNS_COLUMNS.length; c += 1) {
          const col = RUNS_COLUMNS[c];
          const want = runRow[col];
          const got = found.cells[c];
          let same;
          if (typeof want === 'number') same = isFinite(Number(got)) && Math.abs(Number(got) - want) < 1e-9;
          else same = txt(got) === txt(want);
          if (!same) check.ledger.mismatched_cells.push({ column: col, wrote: want, sheet: got === undefined ? null : got });
        }
        if (check.ledger.mismatched_cells.length) {
          problems.push('THE LEDGER ROW LANDED WITH ' + check.ledger.mismatched_cells.length + ' CELL(S) DIFFERENT FROM WHAT WAS SENT: ' + JSON.stringify(check.ledger.mismatched_cells.slice(0, 4)) + '. A row that says something other than what the run reported is worse than no row.');
        }
      }

      // --- last_run_at ---------------------------------------------------------
      const srows = settingsVR.values || [];
      let actual = null;
      let rowNo = null;
      for (let i = 1; i < srows.length; i += 1) {
        const k = txt((srows[i] || [])[0]).trim();
        if (k === 'last_run_at') {
          rowNo = i + 1;
          // Trailing empty cells are TRIMMED by the API, so an absent second cell IS an empty value.
          // This is the one tolerance, and it is the exact cell it matters on: both live sheets carry
          // an empty last_run_at today.
          actual = txt((srows[i] || [])[1]);
          break;
        }
      }
      check.last_run.actual = actual;
      if (rowNo === null) {
        problems.push('THE settings TAB NO LONGER HAS A last_run_at ROW. That is the whole search window: an absent row means the next run reads an empty value and re-collects ' + FIRST_RUN_HOURS_LABEL + '.');
      } else {
        if (check.last_run.row !== null && rowNo !== check.last_run.row) {
          problems.push('THE last_run_at ROW MOVED during this run: it was row ' + check.last_run.row + ' before the write and is row ' + rowNo + ' now. The write was addressed at the old row number, so it landed on whatever is there instead.');
        }
        check.last_run.matches = actual === check.last_run.expected;
        check.last_run.preserved = !check.last_run.advanced && check.last_run.matches;
        if (!check.last_run.matches) {
          problems.push(check.last_run.advanced
            ? 'THE WINDOW WRITE DID NOT LAND. last_run_at should now be ' + JSON.stringify(check.last_run.expected) + ' and it reads ' + JSON.stringify(actual) + '. The run collected and wrote its rows, and the next run will cover the same window again, which is safe but means the lane is not moving forward.'
            : 'THE WINDOW MOVED ON A RUN THAT WAS NOT ALLOWED TO MOVE IT. last_run_at should still be ' + JSON.stringify(check.last_run.expected) + ' and it reads ' + JSON.stringify(actual) + '. This is the failure the whole advance rule exists to prevent: everything in the gap between those two values is now outside the next window and nothing will ever collect it. Set that cell back by hand before the next run.');
        } else if (check.last_run.preserved) {
          notes.push('last_run_at PRESERVED at ' + JSON.stringify(actual) + ' (' + (report.advance && report.advance.blocked_by ? report.advance.blocked_by.join('; ') : 'held') + ')');
        } else {
          notes.push('last_run_at ADVANCED to ' + JSON.stringify(actual));
        }
      }
    }
  }
}

if (!check.read_back_ok) {
  problems.push('THE WRITES COULD NOT BE VERIFIED AT ALL: ' + (check.why || 'unknown') + '. The ledger row and the window write may or may not have landed; nothing here can say which.');
}

// THE JOBS WRITE, FOLDED IN, AND THIS NODE IS WHERE IT HAS TO LAND.
// Build Run Row verified the jobs append against its own read-back and put the answer in the report,
// but nothing downstream acted on it: the verified flag covered the ledger row and the window cell
// only, so a run whose job rows never reached the sheet ended green in n8n with a red heartbeat and
// no thrown error. Found by the offline suite before it shipped, which is the whole reason section
// 12 of that suite drives a failing append end to end. The flag now means all THREE writes, which is
// what its name always claimed.
const rb = report.read_back || null;
const intendedRows = report.counts ? Number(report.counts.intended_to_write) || 0 : 0;
check.jobs = { intended: intendedRows, verified: rb ? rb.ok === true : null, found: rb ? rb.ids_found : null, why: rb ? rb.why : 'the output report did not reach this node' };
if (!rb) {
  problems.push('THE JOBS WRITE CANNOT BE JUDGED: the output stage report did not reach this node, so nothing here knows whether the job rows landed.');
} else if (rb.ok !== true) {
  problems.push('THE JOBS WRITE WAS NOT CONFIRMED IN THE SHEET. ' + (rb.why || 'unknown') + ' ' + intendedRows + ' row(s) were sent. The window is held, so the next run covers the same window and nothing is lost.');
}

// The append/update responses, read only to explain a failure. They are not the authority: a 200
// from a write is the request talking about itself.
function outcomeOf(nodeName) {
  try {
    const items = $(nodeName).all();
    const j = (items[0] && items[0].json) || {};
    if (j.error !== undefined && j.error !== null && j.statusCode === undefined) return { ran: true, error: txt(typeof j.error === 'string' ? j.error : (j.error && j.error.message) || JSON.stringify(j.error)).slice(0, 240), status: null };
    return { ran: true, error: null, status: isFinite(Number(j.statusCode)) ? Number(j.statusCode) : null, items: items.length };
  } catch (e) { return { ran: false, error: null, status: null }; }
}
check.write_run = outcomeOf('Write Run');
check.update_last_run = outcomeOf('Update Last Run');

// --- the final colour ---------------------------------------------------------
const hq = JSON.parse(JSON.stringify(intended._hq || { events: [] }));
let status = intended._hq_status || 'green';
if (problems.length) status = 'red';
if (status !== (intended._hq_status || 'green')) {
  for (const e of hq.events) {
    e.status = status;
    if (e.metric_key === 'run_status') {
      e.value_num = 0;
      e.value_text = 'write_failed';
      e.headline = ('write not verified: ' + problems[0]).slice(0, 120);
    }
  }
}

const out = {
  _kind: 'write_check',
  lane: LANE_NUMBER,
  verified: problems.length === 0 && check.read_back_ok,
  problems: problems,
  notes: notes,
  check: check,
  // Carried forward so Push HQ and Assert Writes read one item and never reach back past this node.
  _hq: hq,
  _hq_status: status,
  _run_row: runRow,
  _report: report,
};

return [{ json: out, pairedItem: { item: 0 } }];
`;

const jsCode = [
  '// GENERATED at build time from work/34-job-search-bi/nodes/47-check-writes.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  `const RUNS_COLUMNS = ${JSON.stringify(O.RUNS_COLUMNS)};`,
  `const RUNS_TAB = ${JSON.stringify(L.sheet.run_ledger_tab)};`,
  `const SETTINGS_TAB = ${JSON.stringify(L.sheet.settings_tab)};`,
  `const FIRST_RUN_HOURS_LABEL = ${JSON.stringify('the whole first_run_window_hours backfill')};`,
  `const LANE_NUMBER = ${JSON.stringify(String(L.lane))};`,
  LOGIC,
].join('\n');

module.exports = {
  name: 'Check Writes',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [6890, 780],
  connectFrom: 'Read Back Writes',
  notes: 'Compares what Build Run Row SENT against what the spreadsheet now HOLDS: the ledger row cell by cell, and last_run_at against the new value on a run that advanced or the old value byte for byte on a run that did not. Two independent sources, never the read against itself. It colours the HQ push and never throws; Assert Writes throws one node later, after the push has gone out.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};
