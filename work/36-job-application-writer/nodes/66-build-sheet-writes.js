'use strict';
/*
 * 66-build-sheet-writes.js - "Build Sheet Writes". One request per LANE, never one per pair, and the
 * only node in this workflow that decides what a spreadsheet is about to say.
 *
 * =============================================================================================
 * 1. THE GOOGLE SHEETS NODE IS NOT USED. THIS IS DESIGN DEFECT 1 AND IT IS NOT A PREFERENCE.
 * =============================================================================================
 * The Sheets node resolves `documentId` at ITEM ZERO and uses it for the whole batch. Two lanes,
 * two spreadsheets, one node: it would write the Power BI applications into the Power BI sheet and
 * then write the AI Automation applications into the Power BI sheet as well, return 200, and report
 * two lanes. Nothing downstream could tell that apart from a morning where the AI lane happened to
 * find the same jobs.
 *
 * Node 04 already reached the same conclusion for the READ. This is the write half of it: raw REST
 * `values:batchUpdate`, one call per lane, with the credential riding as
 * `nodeCredentialType: googleSheetsOAuth2Api`.
 *
 * =============================================================================================
 * 2. ONE CALL PER LANE, AND IT IS ALWAYS MADE, EVEN WHEN THERE IS NOTHING TO WRITE.
 * =============================================================================================
 * A batchUpdate with an EMPTY `data` array is a legal call that changes nothing. That is the
 * mechanism #34 uses for its window write and it is used here for the same reason: it means this
 * node always emits exactly two items, Write Sheets always fires twice, Read Back Sheets always
 * fires twice, and the decision about whether to write anything stays in CODE, where an offline
 * suite can reach it, rather than in an IF whose branch nobody can exercise.
 *
 * Without it, a morning where both lanes wrote nothing would skip the write, the read back, the
 * check, the run report and the heartbeat, and the run would end having said nothing at all.
 *
 * =============================================================================================
 * 3. THE THREE WRITES, AND WHAT EACH ONE IS FOR.
 * =============================================================================================
 *   applications   an appended block of rows, addressed by A1 range. One row per application that
 *                  EXISTS: every shipped pair, and every held pair that actually produced a letter.
 *                  A hold gets a row with the full letter text in `notes`, because out of the box
 *                  item 3 says a hold has to be readable on a phone without opening anything.
 *   jobs!<col>N    one addressed cell per pair, taking that job out of tomorrow morning's queue.
 *                  Node 05 admits a row only when its status cell reads `new`, so writing any other
 *                  value closes it and typing `new` back by hand re-queues it. That is the zero code
 *                  phone override and every value written here is a value that is not `new`.
 *   writer_runs    ONE row per lane per run: the ledger that makes the daily cap true across
 *                  re-runs. Twelve columns, declared by seat 3 in nodes/_lane.js and honoured here.
 *
 * WHY A BATCH UPDATE AND NOT AN APPEND. `values:append` exists and would find the free row by
 * itself. It is a SECOND endpoint, which would make this two calls per lane instead of one, and it
 * cannot be combined with the addressed cell writes. More to the point, an append cannot be read
 * back against a range this node knows, and the whole of node 71 is a cell by cell comparison
 * against ranges named here. The free row is computed instead, from the applications A column this
 * run already read, and the read back proves it: the tab has to hold exactly the rows it held before
 * plus the ones written, or the check goes RED.
 *
 * =============================================================================================
 * 4. cellFormat IS RAW AND THAT IS LOAD BEARING.
 * =============================================================================================
 * Under USER_ENTERED a cell beginning `=`, `+`, `-` or `@` is a live FORMULA. `company`, `title` and
 * `url` came off a job posting written by a stranger, and `notes` can carry a whole cover letter. So
 * RAW is set explicitly, and every free text cell ALSO has the prefix stripped, because a defence
 * that depends on another node's option is not a defence. The collector lane makes both moves for
 * the same reason on the same class of data.
 *
 * RAW also keeps every timestamp the exact text it was written as, which is what the cell by cell
 * read back compares against.
 *
 * =============================================================================================
 * 5. THE HEADER THIS NODE IS ALLOWED TO WRITE, AND THE ONE IT REFUSES TO WORK AROUND.
 * =============================================================================================
 * writer_runs is a new tab. If it exists and is EMPTY, this node writes the twelve column header
 * with the first run row, because a tab whose columns nobody declared is a tab the next run reads by
 * position on faith.
 *
 * If it exists with a header that DISAGREES with the declared twelve, the run row for that lane is
 * REFUSED and the run reports RED. A ledger row written into the wrong columns is worse than no
 * ledger row: node 05 reads `attempted` by position, so a shifted column silently gives tomorrow
 * either an unlimited day or no day at all. The applications rows and the status cells still go,
 * because their headers were asserted by node 05 before a single cell was read and because
 * documents that exist in Drive with no record anywhere is the worse failure.
 */

const LN = require('./_lane');
const W = require('./_write');

const NODE_NAME = 'Build Sheet Writes';

// Caps. Every one bounds a string that lands in a spreadsheet cell, and two of them come from a job
// posting written by a stranger. Sheets allows 50000 characters in a cell; these are far under it.
const CELL_MAX = 500;
const URL_MAX = 900;
const NOTES_MAX = 20000;
const RUN_NOTE_MAX = 900;
const WHY_MAX = 300;

const JOBS_STATUS = W.jobsStatusColumn();

// ---------------------------------------------------------------------------------------------
// THE TWO SHEETS URL SHAPES, DERIVED FROM THE HELPER RATHER THAN RETYPED.
//
// The runtime has to build a url per lane, so it cannot just call batchUpdateUrl(): that function
// lives on this machine. The alternative everyone reaches for is to write the url out again inside
// the generated code, and then there are two copies of a platform fact that the collector lane
// already owns and proves on live runs.
//
// So the shapes are PROBED here with sentinel values, taken apart, and the pieces are baked. The
// round trip below is the check: reassembling the pieces with the same sentinels has to reproduce
// exactly what the helper returned, character for character. If work/34-job-search-bi/nodes/_output.js
// ever changes its query string, this build fails rather than shipping a second, stale copy.
// ---------------------------------------------------------------------------------------------
const URL_SHAPES = (function deriveUrlShapes() {
  const ID = 'SPREADSHEETIDSENTINEL';
  const R1 = 'RANGESENTINELONE';
  const R2 = 'RANGESENTINELTWO';

  const bu = W.batchUpdateUrl(ID);
  const buParts = bu.split(ID);
  if (buParts.length !== 2) {
    throw new Error(NODE_NAME + ': batchUpdateUrl() no longer puts the spreadsheet id in exactly one place (' + bu + '), so the url cannot be split into a prefix and a suffix for the runtime.');
  }

  const bg = W.batchGetUrl(ID, [R1, R2]);
  const bgParts = bg.split(ID);
  if (bgParts.length !== 2 || bgParts[0] !== buParts[0]) {
    throw new Error(NODE_NAME + ': batchGetUrl() and batchUpdateUrl() no longer share a base (' + bg + ' against ' + bu + ').');
  }
  const q = bgParts[1].indexOf('?');
  if (q === -1) {
    throw new Error(NODE_NAME + ': batchGetUrl() no longer carries a query string, and the runtime builds one range parameter per read back range.');
  }
  const path = bgParts[1].slice(0, q);
  const query = bgParts[1].slice(q + 1);
  const firstAt = query.indexOf(R1);
  if (firstAt === -1) {
    throw new Error(NODE_NAME + ': batchGetUrl() did not put the range sentinel in its query string, so the range parameter name cannot be derived.');
  }
  const rangeParam = query.slice(0, firstAt);
  const secondAt = query.indexOf(R2);
  if (secondAt === -1 || query.slice(firstAt + R1.length, secondAt) !== '&' + rangeParam) {
    throw new Error(NODE_NAME + ': batchGetUrl() no longer joins its ranges with &' + rangeParam + ', so the runtime cannot build the same url.');
  }
  const tail = query.slice(secondAt + R2.length);

  const shapes = { base: buParts[0], batch_update_path: buParts[1], batch_get_path: path, range_param: rangeParam, batch_get_tail: tail };

  // The round trip. This is the whole point of deriving rather than retyping.
  const rebuiltUpdate = shapes.base + ID + shapes.batch_update_path;
  const rebuiltGet = shapes.base + ID + shapes.batch_get_path + '?' + [R1, R2].map((r) => shapes.range_param + r).join('&') + shapes.batch_get_tail;
  if (rebuiltUpdate !== bu || rebuiltGet !== bg) {
    throw new Error(
      NODE_NAME + ': the derived Sheets url shapes do not reproduce the helper output.\n' +
      '  batchUpdate wanted ' + bu + '\n' +
      '  and rebuilt      ' + rebuiltUpdate + '\n' +
      '  batchGet    wanted ' + bg + '\n' +
      '  and rebuilt      ' + rebuiltGet + '\n' +
      '  The pieces are baked into the runtime, so a derivation that does not round trip would ship a\n' +
      '  url that is almost right, which Google answers with a 400 that names nothing useful.'
    );
  }
  return shapes;
}());

(function assertAgainstUpstream() {
  const check = require('./65-check-uploads.js');
  if (check.name !== 'Check Uploads') {
    throw new Error(NODE_NAME + ': node 65 is named ' + JSON.stringify(check.name) + ' and this node connects from "Check Uploads". Rename both in the same edit.');
  }
  const csrc = String(check.parameters.jsCode || '');
  for (const [needle, what] of [
    ['j.cv_ref = byKind.cv.url;', 'the Drive link this node writes into the cv_ref column'],
    ['j.cover_letter_ref = byKind.letter.url;', 'the same for the cover letter'],
    ['all_verified: true,', 'the flag that says all four files were downloaded again and their digests matched'],
    ["j._sheet_action = 'leave_untouched';", 'the systemic class, which is what makes an unverified upload write NOTHING at all'],
  ]) {
    if (csrc.indexOf(needle) === -1) {
      throw new Error(NODE_NAME + ': Check Uploads no longer contains ' + JSON.stringify(needle) + ', which is ' + what + '.');
    }
  }

  // The two reads this node depends on, by name.
  const seed = require('./03-seed-lanes.js');
  const read = require('./04-read-lane-sheets.js');
  if (seed.name !== 'Seed Lanes') throw new Error(NODE_NAME + ': node 03 is named ' + JSON.stringify(seed.name) + ' and this node reads the lane list by that name.');
  if (read.name !== 'Read Lane Sheets') throw new Error(NODE_NAME + ': node 04 is named ' + JSON.stringify(read.name) + ' and this node reads the current row counts out of that node own response.');
  const resp = read.parameters.options.response.response;
  if (resp.fullResponse !== true || resp.neverError !== true) {
    throw new Error(NODE_NAME + ': Read Lane Sheets no longer sets fullResponse AND neverError, and this node reads statusCode and body off those items to tell a refused lane from an empty one.');
  }
  if (String(seed.parameters.jsCode || '').indexOf('run_date: runDate,') === -1) {
    throw new Error(NODE_NAME + ': Seed Lanes no longer stamps run_date, which is the Europe/Stockholm calendar date the daily cap counts on and the date written into both the applications row and the ledger row.');
  }

  // The column contracts. Seat 3 declared writer_runs in nodes/_lane.js and asked this seat either to
  // honour the list or to change it THERE. It is honoured.
  LN.assertColumnsAgainstSeed();
  if (W.WRITER_RUNS_COLUMNS.length !== 12 || W.WRITER_RUNS_COLUMNS[0] !== 'date' || W.WRITER_RUNS_COLUMNS[3] !== 'lane' || W.WRITER_RUNS_COLUMNS[4] !== 'attempted') {
    throw new Error(
      NODE_NAME + ': the writer_runs column list is ' + JSON.stringify(W.WRITER_RUNS_COLUMNS) + '.\n' +
      '  Node 05 counts today attempted pairs by matching the `date` and `lane` cells and summing\n' +
      '  `attempted` BY POSITION, and node 03 builds the A:L range from the length. Changing this list\n' +
      '  moves all three, and it moves the tab in both live spreadsheets, which is a human step.'
    );
  }
  if (W.APPLICATIONS_COLUMNS.length !== 13 || W.APPLICATIONS_COLUMNS[0] !== 'job_id') {
    throw new Error(NODE_NAME + ': the applications column list is ' + JSON.stringify(W.APPLICATIONS_COLUMNS) + '. job_id has to be column A, because that column is what node 05 reads as the already written set.');
  }
  if (JOBS_STATUS.letter !== 'M') {
    // Not wrong in itself, but it is the one address in this seat that is computed from a contract
    // that lives in another project, so a move is worth failing on rather than absorbing.
    throw new Error(
      NODE_NAME + ': the jobs tab status column is now ' + JSON.stringify(JOBS_STATUS.letter) + ' rather than M.\n' +
      '  That means the shared row shape in work/34-job-search-bi/config/sources.json moved, which moves\n' +
      '  both collectors, both sheet headers and every guard that asserts fifteen columns. Confirm the\n' +
      '  live header before letting this workflow write an addressed cell at the new letter.'
    );
  }
}());

// The vocabularies, baked so the runtime cannot invent a value that is not in the table.
const VOCAB = {
  application_status: Object.keys(W.APPLICATION_STATUS),
  application_status_reserved: Object.keys(W.APPLICATION_STATUS_RESERVED),
  channel: Object.keys(W.APPLICATION_CHANNEL),
  channel_reserved: Object.keys(W.APPLICATION_CHANNEL_RESERVED),
  outcome_reserved: W.APPLICATION_OUTCOME_RESERVED,
  jobs_status_shipped: W.JOBS_STATUS_SHIPPED,
};

const LOGIC = `
// ---------------------------------------------------------------------------
// Build Sheet Writes. One values:batchUpdate body per LANE, always, even when
// there is nothing in it.
// ---------------------------------------------------------------------------
function txt(v) { return String(v === null || v === undefined ? '' : v); }
function cut(s, n) { const t = txt(s); return t.length > n ? t.slice(0, n - 3) + '...' : t; }
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function rowsOf(vr) { return (vr && Array.isArray(vr.values)) ? vr.values : []; }
function norm(s) { return txt(s).trim().toLowerCase(); }
const NL = String.fromCharCode(10);

// A1 quoting, the same rule nodes 03 and 04 use. Every tab in both spreadsheets is a bare word
// today, so this is insurance rather than a fix.
function a1(tab, ref) {
  const t = txt(tab);
  const safe = /^[A-Za-z0-9_]+$/.test(t) ? t : "'" + t.split("'").join("''") + "'";
  return safe + '!' + ref;
}

// A spreadsheet cell. RAW makes a leading = harmless; stripping it as well is the second layer,
// because a defence that depends on another node option is not a defence.
function cell(v, cap) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && isFinite(v)) return v;
  let out = String(v);
  out = out.split(String.fromCharCode(8212)).join(', ').split(String.fromCharCode(8211)).join('-');
  out = out.replace(/[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]/g, ' ');
  out = out.replace(/[\\u200B-\\u200D\\uFEFF\\u00A0]/g, ' ');
  while (out.length && '=+-@'.indexOf(out[0]) !== -1) out = out.slice(1);
  out = out.replace(/[ \\t]+/g, ' ').trim();
  if (out.length > cap) out = out.slice(0, cap - 1).trim() + String.fromCharCode(8230);
  return out;
}
// The same, for a block of prose that has to keep its line breaks.
function block(v, cap) {
  let out = txt(v);
  out = out.split(String.fromCharCode(8212)).join(', ').split(String.fromCharCode(8211)).join('-');
  out = out.replace(/\\r/g, '');
  out = out.replace(/[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]/g, ' ');
  while (out.length && '=+-@'.indexOf(out[0]) !== -1) out = out.slice(1);
  out = out.trim();
  if (out.length > cap) out = out.slice(0, cap - 1).trim() + String.fromCharCode(8230);
  return out;
}

function outcomeOf(j) {
  if (!j || j._kind !== 'pair') return 'not_a_pair';
  var s = j._status;
  if (s === null || s === undefined || s === '') return 'ship';
  s = String(s);
  if (s.indexOf('error:') === 0) return 'error';
  if (s.indexOf('blocked:') === 0) return 'blocked';
  if (s === 'skipped:cap') return 'capped';
  return 'hold';
}

// --- 1. the lanes and their current row counts --------------------------------
const inputItems = $input.all();
if (!inputItems.length) {
  throw new Error('Build Sheet Writes: Check Uploads delivered no items at all. It emits at least its own stage report on every path, so an empty input means that node did not run.');
}

let laneSeeds = [];
try {
  laneSeeds = $('Seed Lanes').all().map((i) => i.json);
} catch (e) {
  laneSeeds = [];
}
if (!laneSeeds.length) {
  throw new Error('Build Sheet Writes: Seed Lanes could not be reached, so this node does not know which spreadsheets this run is about. Every write below is addressed to a specific document and there is nothing to address.');
}

let sheetReads = null;
try {
  sheetReads = $('Read Lane Sheets').all().map((i) => i.json || {});
} catch (e) {
  sheetReads = null;
}

// --- 2. the pairs, grouped by lane ---------------------------------------------
const byLane = {};
for (const s of laneSeeds) byLane[txt(s.lane_key)] = { seed: s, pairs: [] };
const orphanPairs = [];
for (const it of inputItems) {
  const j = (it && it.json) || {};
  if (j._kind !== 'pair') continue;
  const k = txt(j.lane_key);
  if (byLane[k]) byLane[k].pairs.push(j);
  else orphanPairs.push(txt(j.pair_id) || txt(j.job_id));
}

// The lane reports, for the attempted count. See the note on attempted in nodes/_write.js: it is
// what makes the day cap true across re-runs, so it is read from the node that DECIDED it rather
// than recounted from the pairs that survived.
const laneReportByKey = {};
for (const it of inputItems) {
  const j = (it && it.json) || {};
  if (j._kind !== 'lane_report') continue;
  laneReportByKey[txt(j.lane_key)] = j;
}

// --- 3. one body per lane -------------------------------------------------------
const writes = [];
const warnings = [];
const perLane = [];

for (let li = 0; li < laneSeeds.length; li += 1) {
  const seed = laneSeeds[li];
  const key = txt(seed.lane_key);
  const pairs = (byLane[key] && byLane[key].pairs) || [];
  const report = laneReportByKey[key] || null;
  const problems = [];
  const notes = [];

  // --- 3a. what the sheet holds right now, read at the start of THIS run -------
  const resp = sheetReads ? (sheetReads[li] || {}) : {};
  const status = Number(resp.statusCode);
  const vrs = (resp.body && Array.isArray(resp.body.valueRanges)) ? resp.body.valueRanges : null;
  let readable = sheetReads !== null && isFinite(status) && status >= 200 && status < 300 && vrs && vrs.length === 5;
  if (!readable) {
    problems.push('the sheet read for this lane did not come back usable (' + (isFinite(status) ? 'HTTP ' + status : 'no status code') + '), so nothing is written to it. Every job row in it stays at new and the next run offers them again.');
  }

  const appsCol = readable ? rowsOf(vrs[2]) : [];
  const runsRows = readable ? rowsOf(vrs[4]) : [];
  const appsRowsBefore = appsCol.length;
  const runsRowsBefore = runsRows.length;

  let appsStart = appsRowsBefore + 1;
  if (readable && appsRowsBefore === 0) {
    // Node 05 already asserted the applications HEADER out of range 3, so the tab has one. An empty
    // A column with a header present means column A itself is blank, which is not a shape this
    // workflow writes; the first data row is still row 2.
    appsStart = 2;
    notes.push('the applications A column came back empty while the header row is present, so the first row written is row 2. Column A is job_id and this workflow never writes a blank one, so an empty A column means somebody cleared it by hand.');
  }

  // --- 3b. the writer_runs header ---------------------------------------------
  let runsWritable = readable;
  let runsHeaderWrite = null;
  let runsRow = runsRowsBefore + 1;
  if (readable) {
    if (runsRowsBefore === 0) {
      runsHeaderWrite = { range: a1(seed.writer_runs_tab, 'A1:' + RUNS_LAST_COL + '1'), values: [RUNS_COLUMNS.slice()] };
      runsRow = 2;
      notes.push('the writer_runs tab is empty, so the twelve column header is written with the first run row. A tab whose columns nobody declared is a tab the next run reads by position on faith.');
    } else {
      const header = runsRows[0] || [];
      let headerOk = header.length === RUNS_COLUMNS.length;
      if (headerOk) {
        for (let c = 0; c < RUNS_COLUMNS.length; c += 1) {
          if (norm(header[c]) !== norm(RUNS_COLUMNS[c])) { headerOk = false; break; }
        }
      }
      if (!headerOk) {
        runsWritable = false;
        problems.push('THE writer_runs HEADER DOES NOT MATCH. It reads ' + JSON.stringify(header.slice(0, 14)) + ' and this run writes ' + JSON.stringify(RUNS_COLUMNS) + '. The run row is REFUSED rather than written into the wrong columns, because node 05 reads attempted BY POSITION and a shifted column silently gives tomorrow either an unlimited day or no day at all. The applications rows and the status cells still go: their headers were asserted before a single cell was read, and documents sitting in Drive with no record anywhere is the worse failure.');
      }
    }
  }

  // --- 3c. the rows ------------------------------------------------------------
  const appRows = [];
  const appJobIds = [];
  const statusCells = [];
  const counts = { attempted: 0, shipped: 0, held: 0, blocked: 0, skipped_cap: 0, errors: 0, rows: 0, status_cells: 0, no_sheet_row: 0, defaulted_action: 0 };
  let costUsd = 0;

  for (const p of pairs) {
    const outcome = outcomeOf(p);
    if (outcome === 'ship') counts.shipped += 1;
    else if (outcome === 'hold') counts.held += 1;
    else if (outcome === 'blocked') counts.blocked += 1;
    else if (outcome === 'capped') counts.skipped_cap += 1;
    else if (outcome === 'error') counts.errors += 1;
    costUsd += num(p._cost && p._cost.usd);

    // The sheet action. error:* is leave_untouched, everything else closes the job row. An intake
    // capped pair arrives with no _sheet_action at all, because node 05 stamps the status without
    // one, so the default is stated here and COUNTED rather than applied in silence.
    let action = txt(p._sheet_action);
    if (!action) {
      action = outcome === 'error' ? 'leave_untouched' : 'write_status';
      if (outcome !== 'not_a_pair') counts.defaulted_action += 1;
    }

    if (!readable) continue;

    if (action === 'write_status') {
      const sheetRow = Number(p.sheet_row);
      if (!isFinite(sheetRow) || sheetRow < 2) {
        counts.no_sheet_row += 1;
      } else {
        const value = outcome === 'ship' ? SHIPPED_STATUS : cell(p._status, 120);
        statusCells.push({
          range: a1(seed.jobs_tab, STATUS_COL + sheetRow),
          sheet_row: sheetRow,
          job_id: txt(p.job_id),
          value: value,
        });
        counts.status_cells += 1;
      }
    }

    // The applications row. One per application that EXISTS: a shipped pair, and a held pair that
    // actually produced a letter somebody can read.
    const letter = txt(p.letter_text);
    const wantsRow = outcome === 'ship' || (outcome === 'hold' && letter.length > 0);
    if (!wantsRow) continue;

    const shipped = outcome === 'ship';
    const noteParts = [];
    if (shipped) {
      noteParts.push('Folder: ' + cut(txt(p.folder_url), URL_MAX));
      const grade = (p._grade && typeof p._grade === 'object') ? p._grade : null;
      if (grade && grade.verdict) noteParts.push('Blind grade: ' + cell(grade.verdict, 120));
      const rc = (p.render_check && typeof p.render_check === 'object') ? p.render_check : null;
      if (rc && rc.pass === true) noteParts.push('R1 to R6 passed and all four files were downloaded from Drive again and matched their digests.');
    } else {
      noteParts.push('HELD (' + cell(p._status, 80) + '): ' + cell(p._status_why, 600));
      noteParts.push('Nothing was uploaded, so there is no link. The letter as written is below, so this row can be read on a phone without opening anything.');
      noteParts.push('--- the cover letter as written ---');
      noteParts.push(letter);
    }

    const rowObj = {
      job_id: cell(p.job_id, 120),
      applied_at: cell(seed.run_date, 40),
      lane: cell(String(seed.source_project), 20),
      company: cell(p.company, CELL_MAX),
      title: cell(p.title, CELL_MAX),
      url: cut(cell(p.url, URL_MAX), URL_MAX),
      channel: shipped ? CHANNEL_MANUAL : CHANNEL_NONE,
      cv_ref: shipped ? cut(txt(p.cv_ref), URL_MAX) : '',
      cover_letter_ref: shipped ? cut(txt(p.cover_letter_ref), URL_MAX) : '',
      status: shipped ? STATUS_READY : STATUS_NEEDS_REVIEW,
      last_contact_at: '',
      outcome: '',
      notes: block(noteParts.join(NL + NL), NOTES_MAX),
    };
    const row = [];
    for (const c of APP_COLUMNS) row.push(rowObj[c] === undefined ? '' : rowObj[c]);
    appRows.push(row);
    appJobIds.push(rowObj.job_id);
    counts.rows += 1;
  }

  counts.attempted = report && isFinite(Number(report.admitted)) ? Number(report.admitted) : null;
  let attemptedSource = 'the lane report admitted count, which is what node 05 let into the reader';
  if (counts.attempted === null) {
    // The honest fallback: pairs that actually reached the reader and cost money.
    let read = 0;
    for (const p of pairs) {
      const calls = (p._cost && Array.isArray(p._cost.calls)) ? p._cost.calls : [];
      if (calls.some((c) => c && c.stage === 'read')) read += 1;
    }
    counts.attempted = read;
    attemptedSource = 'a FALLBACK: no lane report was found, so this counts pairs that actually reached the reader. It under reports a lane that was refused before the reader ran, which is the safe direction for a cap.';
    notes.push('the attempted count for this lane is a fallback. ' + attemptedSource);
  }

  // --- 3d. the ledger row -------------------------------------------------------
  const runNoteParts = [];
  runNoteParts.push(counts.shipped + ' shipped, ' + counts.held + ' held, ' + counts.blocked + ' blocked, ' + counts.skipped_cap + ' capped, ' + counts.errors + ' error(s)');
  if (counts.rows) runNoteParts.push(counts.rows + ' applications row(s) written');
  if (counts.status_cells) runNoteParts.push(counts.status_cells + ' job status cell(s) closed');
  if (counts.no_sheet_row) runNoteParts.push(counts.no_sheet_row + ' pair(s) had no sheet row number and their job rows stay at new');
  if (counts.defaulted_action) runNoteParts.push(counts.defaulted_action + ' pair(s) arrived with no sheet action and took the default');
  for (const p of problems) runNoteParts.push(p);

  const runValues = {
    date: cell(seed.run_date, 40),
    run_started_at: cell(seed.run_started_at, 60),
    exec_id: cell(seed.exec_id, 60),
    lane: cell(String(seed.source_project), 20),
    attempted: counts.attempted,
    shipped: counts.shipped,
    held: counts.held,
    blocked: counts.blocked,
    skipped_cap: counts.skipped_cap,
    errors: counts.errors,
    cost_usd: Math.round(costUsd * 1e6) / 1e6,
    note: cell(runNoteParts.join('. '), RUN_NOTE_MAX),
  };
  const runRow = [];
  for (const c of RUNS_COLUMNS) runRow.push(runValues[c] === undefined ? '' : runValues[c]);

  // --- 3e. the request ----------------------------------------------------------
  const data = [];
  const readBack = [];
  let appsRange = null;
  let runsRange = null;

  if (readable && appRows.length) {
    appsRange = a1(seed.applications_tab, 'A' + appsStart + ':' + APP_LAST_COL + (appsStart + appRows.length - 1));
    data.push({ range: appsRange, majorDimension: 'ROWS', values: appRows });
  }
  if (readable) {
    for (const sc of statusCells) data.push({ range: sc.range, majorDimension: 'ROWS', values: [[sc.value]] });
  }
  if (readable && runsWritable) {
    if (runsHeaderWrite) data.push({ range: runsHeaderWrite.range, majorDimension: 'ROWS', values: runsHeaderWrite.values });
    runsRange = a1(seed.writer_runs_tab, 'A' + runsRow + ':' + RUNS_LAST_COL + runsRow);
    data.push({ range: runsRange, majorDimension: 'ROWS', values: [runRow] });
  }

  // The read back ranges, in a DECLARED order that node 71 reads by position. Each one answers a
  // different question and the two column reads are what prove an append rather than an overwrite.
  if (appsRange) readBack.push({ name: 'applications_rows', range: appsRange });
  readBack.push({ name: 'applications_ids', range: a1(seed.applications_tab, 'A:A') });
  if (readable) readBack.push({ name: 'jobs_status', range: a1(seed.jobs_tab, STATUS_COL + ':' + STATUS_COL) });
  if (runsRange) readBack.push({ name: 'writer_runs_row', range: runsRange });
  if (readable && runsWritable) readBack.push({ name: 'writer_runs_ids', range: a1(seed.writer_runs_tab, 'A:A') });

  if (readable && !data.length) notes.push('nothing to write for this lane. The call is still made, with an empty data array, so every node after it runs.');

  const item = {
    _kind: 'sheet_write',
    _call_now: true,
    needs_convert: false,
    lane_key: key,
    source_project: seed.source_project,
    label: txt(seed.label),
    spreadsheet_id: txt(seed.spreadsheet_id),
    run_date: txt(seed.run_date),
    run_started_at: txt(seed.run_started_at),
    exec_id: txt(seed.exec_id),
    batch_update_url: URLS.base + txt(seed.spreadsheet_id) + URLS.batch_update_path,
    // UNFORMATTED_VALUE is added to the derived shape rather than being part of it, and it is the
    // difference between a verification and a guess. The batchGet DEFAULT is FORMATTED_VALUE, which
    // returns every cell as the string the UI would show, under the spreadsheet LOCALE: the cost
    // number 0.284531 can come back as a string with a comma for a decimal point, and the cell by
    // cell comparison would fail on a ledger row that was written perfectly. The collector lane read
    // does not need this because it reads text columns and coerces with Number(); this one compares
    // what it sent, character for character.
    read_back_url: URLS.base + txt(seed.spreadsheet_id) + URLS.batch_get_path + '?' + readBack.map((r) => URLS.range_param + encodeURIComponent(r.range)).join('&') + URLS.batch_get_tail + '&valueRenderOption=UNFORMATTED_VALUE',
    batch_update_body: { valueInputOption: 'RAW', data: data },
    read_back_range_names: readBack.map((r) => r.name),
    read_back_ranges: readBack.map((r) => r.range),
    _intent: {
      writable: readable,
      runs_writable: runsWritable,
      applications: {
        tab: txt(seed.applications_tab),
        range: appsRange,
        start_row: appRows.length ? appsStart : null,
        rows_before: appsRowsBefore,
        rows: appRows,
        job_ids: appJobIds,
      },
      jobs_status: statusCells,
      writer_runs: {
        tab: txt(seed.writer_runs_tab),
        range: runsRange,
        row: runsWritable ? runsRow : null,
        rows_before: runsRowsBefore,
        values: runRow,
        header_written: !!runsHeaderWrite,
        header_range: runsHeaderWrite ? runsHeaderWrite.range : null,
        header_values: runsHeaderWrite ? runsHeaderWrite.values[0] : null,
      },
      counts: counts,
      cost_usd: runValues.cost_usd,
      attempted_source: attemptedSource,
      problems: problems,
      notes: notes,
      vocab: VOCAB,
      rule: 'one values:batchUpdate per LANE. The Sheets node is not used because it resolves documentId at item zero and would write both lanes into the first spreadsheet with a healthy 200. A lane with nothing to write still sends an EMPTY data array, which is a legal call that changes nothing, so the write, the read back, the check, the report and the heartbeat all run on every run.',
    },
    site_fetch_url: '',
    ad_fetch_url: '',
  };
  writes.push(item);
  perLane.push({ lane: key, writable: readable, ranges: data.length, rows: appRows.length, status_cells: statusCells.length, runs_row: runsWritable ? runsRow : null, problems: problems.length });

  if (problems.length) for (const p of problems) warnings.push('lane ' + key + ': ' + cut(p, WHY_MAX));
}

// --- 4. carry everything else ----------------------------------------------------
const out = [];
let carried = 0;
for (const it of inputItems) {
  const raw = (it && it.json) || {};
  if (raw._kind === undefined || raw._kind === null) continue;
  const j = Object.assign({}, raw);
  j._call_now = false;
  j.needs_convert = false;
  out.push(j);
  carried += 1;
}

if (orphanPairs.length) {
  warnings.push(orphanPairs.length + ' pair(s) carry a lane_key that is not one of this run lanes (' + JSON.stringify(orphanPairs.slice(0, 6)) + '). Nothing is written for them, because every write below is addressed to a specific spreadsheet and there is no spreadsheet for a lane nobody seeded.');
}
if (writes.length !== laneSeeds.length) {
  warnings.push('THE LANE COUNT DOES NOT MATCH: ' + laneSeeds.length + ' lane(s) were seeded and ' + writes.length + ' write request(s) were built. One request per lane, always, is what makes the write, the read back and the check run on every run.');
}

const report = {
  _kind: 'stage_report',
  stage: 'build_sheet_writes',
  lanes: perLane,
  requests: writes.length,
  carried: carried,
  vocab: VOCAB,
  vocab_note: 'applications.status is ready or needs_review and nothing else is written by this workflow. applications.channel is manual on a shipped row and none on a held one: nothing in this system has ever sent an application. applications.outcome is left EMPTY on purpose, because an outcome written before there is one reads exactly like a fact. cv_ref and cover_letter_ref are Drive FILE urls, tappable on a phone, with the file id between /d/ and /view. The jobs status cell takes the pair own status token, or the word written when it shipped, and typing new back into it re-queues that job for the next morning.',
  warnings: warnings,
  needs_convert: false,
  _call_now: false,
  site_fetch_url: '',
  ad_fetch_url: '',
};

const finalItems = out.map((j) => ({ json: j, pairedItem: { item: 0 } }));
for (const w of writes) finalItems.push({ json: w, pairedItem: { item: 0 } });
finalItems.push({ json: report, pairedItem: { item: 0 } });
return finalItems;
`;

function renderJsCode() {
  return [
    '// GENERATED at build time from work/36-job-application-writer/nodes/66-build-sheet-writes.js.',
    '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
    'const APP_COLUMNS = ' + JSON.stringify(W.APPLICATIONS_COLUMNS) + ';',
    'const APP_LAST_COL = ' + JSON.stringify(W.APPLICATIONS_LAST_COL) + ';',
    'const RUNS_COLUMNS = ' + JSON.stringify(W.WRITER_RUNS_COLUMNS) + ';',
    'const RUNS_LAST_COL = ' + JSON.stringify(W.WRITER_RUNS_LAST_COL) + ';',
    'const STATUS_COL = ' + JSON.stringify(JOBS_STATUS.letter) + ';',
    'const SHIPPED_STATUS = ' + JSON.stringify(W.JOBS_STATUS_SHIPPED) + ';',
    'const STATUS_READY = ' + JSON.stringify('ready') + ';',
    'const STATUS_NEEDS_REVIEW = ' + JSON.stringify('needs_review') + ';',
    'const CHANNEL_MANUAL = ' + JSON.stringify('manual') + ';',
    'const CHANNEL_NONE = ' + JSON.stringify('none') + ';',
    'const URLS = ' + JSON.stringify(URL_SHAPES) + ';',
    'const CELL_MAX = ' + JSON.stringify(CELL_MAX) + ';',
    'const URL_MAX = ' + JSON.stringify(URL_MAX) + ';',
    'const NOTES_MAX = ' + JSON.stringify(NOTES_MAX) + ';',
    'const RUN_NOTE_MAX = ' + JSON.stringify(RUN_NOTE_MAX) + ';',
    'const WHY_MAX = ' + JSON.stringify(WHY_MAX) + ';',
    'const VOCAB = ' + JSON.stringify(VOCAB) + ';',
    LOGIC,
  ].join('\n');
}

W.assertGeneratedSourceIsClean(renderJsCode(), NODE_NAME);

module.exports = {
  name: NODE_NAME,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [16640, 100],
  connectFrom: 'Check Uploads',
  notes: 'Builds ONE values:batchUpdate body per LANE, never one per pair: the applications rows addressed by A1 range, one addressed cell per job status, and the twelve column writer_runs ledger row. The Google Sheets NODE IS NOT USED, because it resolves documentId at item zero and would write both lanes into the first spreadsheet with a healthy 200. A lane with nothing to write still sends an empty data array, which is a legal call that changes nothing and keeps the write, the read back, the check, the run report and the heartbeat unconditional. valueInputOption RAW, and every free text cell also has a leading formula character stripped, because company, title and the whole cover letter come from outside this machine.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: renderJsCode(),
  },
};
