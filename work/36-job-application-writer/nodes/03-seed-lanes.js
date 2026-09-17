'use strict';
/*
 * 03-seed-lanes.js - "Seed Lanes". Two items, one per source lane, and the run stamp.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. WHY A CODE NODE AND NOT A SET NODE, AND WHY TWO ITEMS.
 * ---------------------------------------------------------------------------------------------
 * The whole design of #36 is one workflow over TWO spreadsheets. Design defect 1 from the plan
 * review is the reason it cannot be one item: the Google Sheets node resolves `documentId` at item
 * 0 for the entire batch, so a single node pointed at two spreadsheets reads the first one twice
 * and reports a healthy run. The answer is REST plus one item per lane, and this node is where the
 * two items are born. Everything downstream fans out from here.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. THE URL IS BUILT HERE, AT BUILD TIME, NOT IN AN EXPRESSION ON THE HTTP NODE.
 * ---------------------------------------------------------------------------------------------
 * `batch_get_url` is assembled on this machine from the lane file and handed to Read Lane Sheets as
 * a plain string. Three reasons, in order of how much they cost when ignored:
 *   - the ranges are a CONTRACT with Build Candidates, which reads valueRanges BY POSITION. Built
 *     here, the order is one array in one file; built in an expression, it is a string nobody can
 *     test without a live call.
 *   - the spreadsheet ids are lane values. config/lane.json is gitignored and this file is tracked,
 *     so the id never appears in the repo either way, but a url built in an n8n parameter would sit
 *     in the workflow JSON export as well.
 *   - an offline test can assert the exact url. An expression can only be proved by running it.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. THE FIVE RANGES, AND WHAT EACH ONE IS FOR.
 * ---------------------------------------------------------------------------------------------
 *   settings!A:B        the key/value tab. The phase2 switches and caps, and the `lane` cell that
 *                       proves this spreadsheet id belongs to the collector we think it does.
 *   jobs!A:O            the fifteen columns, header row included. The header is asserted before a
 *                       single cell is read.
 *   applications!A:A    the job_id column, and nothing else. It answers "has this job already been
 *                       written" and it is one column because the tab grows forever.
 *   applications!1:1    the header row, asserted the same way. It is also the only way to catch the
 *                       degenerate empty-tab case, where a write invents a header and returns 200.
 *   writer_runs!A:L     today's run rows, which is what makes the daily cap true ACROSS RE-RUNS
 *                       rather than per execution.
 *
 * THE RANGE THAT WILL FAIL ON THE FIRST RUN, said here rather than discovered on the box.
 * `writer_runs` does not exist in either spreadsheet yet (lane.json says so in writing), and a
 * values:batchGet whose ranges name a sheet that does not exist returns 400 for the WHOLE request,
 * not a partial result. So until both tabs are created, this node builds a url that cannot succeed,
 * and that is correct rather than unfortunate: a daily cap that cannot count today is not a cap,
 * and Build Candidates refuses the lane by name (error:writer_runs_missing) instead of reading four
 * good ranges and calling the fifth an empty day.
 *
 * ---------------------------------------------------------------------------------------------
 * 4. THE RUN STAMP, AND WHY THE DATE IS RESOLVED RATHER THAN SLICED.
 * ---------------------------------------------------------------------------------------------
 * `run_date` is the Europe/Stockholm calendar date, resolved through Intl, not the first ten
 * characters of an ISO string. The two differ for two hours every summer evening, and the daily cap
 * is counted by matching this string against the `date` column of writer_runs. A run at 07:15
 * Stockholm is never near the boundary, so this looks like pedantry; a MANUAL re-run at 23:30 in
 * July is, and the manual re-run is exactly the case the daily cap exists to survive.
 */

const { lane, lanes, caps, jobsColumns, WRITER_RUNS_COLUMNS, APPLICATIONS_COLUMNS, a1, batchGetUrl, assertColumnsAgainstSeed } = require('./_lane');

const L = lane();
const LANE_ROWS = lanes();
const CAPS = caps();

// A1 column letter for a 1-based column index. Twenty six is plenty for a fifteen and a twelve
// column tab, and a tab that outgrows it is a schema change, not a formatting problem.
function colLetter(n) {
  if (!Number.isInteger(n) || n < 1 || n > 26) {
    throw new Error('Seed Lanes: a tab with ' + n + ' columns needs a two letter A1 range and this node only builds one letter. That is a schema change and it moves the sheet header too.');
  }
  return String.fromCharCode(64 + n);
}

const JOBS_COLUMNS = jobsColumns();
const JOBS_LAST = colLetter(JOBS_COLUMNS.length);
const RUNS_LAST = colLetter(WRITER_RUNS_COLUMNS.length);

(function assertAgainstUpstream() {
  const manual = require('./01-manual-trigger.js');
  const sched = require('./02-schedule.js');
  if (manual.name !== 'When clicking Test') throw new Error('Seed Lanes: node 01 is named ' + JSON.stringify(manual.name) + ' and this node connects from "When clicking Test". The name is the connection key.');
  if (sched.name !== 'Schedule Trigger') throw new Error('Seed Lanes: node 02 is named ' + JSON.stringify(sched.name) + ' and this node connects from "Schedule Trigger".');

  assertColumnsAgainstSeed();

  // The approved plan named these ranges literally (jobs!A:O, writer_runs!A:L). They are DERIVED
  // here from the column lists so a moved tab moves its own range, and then checked against the
  // expected letters, because a derived range that silently stopped matching would be a change
  // nobody decided to make.
  //
  // jobs IS A:K SINCE 2026-09-17, not the plan's A:O. Shaheen removed apply_url, fit_reasons, lane
  // and excerpt from the jobs tab in both spreadsheets, fifteen columns down to eleven, and both
  // sheet headers moved in that same session. The check is kept rather than deleted: this node
  // reads by position, and the next move should stop the build exactly the way this one did.
  // A:L SINCE THE EVENING OF 2026-09-17. It was A:O by the approved plan, A:K for a few hours that
  // afternoon when Shaheen removed four columns, and A:L once he took `flags` back. The check is
  // kept rather than widened: this node reads by position, and the next move should stop the build
  // exactly the way both of these did.
  if (JOBS_LAST !== 'L') {
    throw new Error(
      'Seed Lanes: the jobs row shape is now ' + JOBS_COLUMNS.length + ' columns, so the range is A:' + JOBS_LAST + ' and twelve columns means A:L.\n' +
      '  That may be right, and it is not something this build decides quietly: both collectors write\n' +
      '  by position and both sheet headers move in the same session.'
    );
  }
  if (RUNS_LAST !== 'L') {
    throw new Error('Seed Lanes: WRITER_RUNS_COLUMNS is now ' + WRITER_RUNS_COLUMNS.length + ' columns, so the range is A:' + RUNS_LAST + ' and the approved plan says writer_runs!A:L. Change the plan note and the write seat in the same edit.');
  }
  if (LANE_ROWS.length !== 2) {
    throw new Error('Seed Lanes: the lane file resolves ' + LANE_ROWS.length + ' source lane(s). This workflow exists to serve both collectors, and every downstream pairing assumes two items in a declared order.');
  }
  const ids = LANE_ROWS.map((l) => l.spreadsheet_id);
  if (ids[0] === ids[1]) {
    throw new Error(
      'Seed Lanes: both source lanes carry the SAME spreadsheet id (' + ids[0] + ').\n' +
      '  The run would read one sheet twice, write two applications rows into it, and report two lanes.\n' +
      '  The settings lane guard in Build Candidates would catch it at run time; catching it here is\n' +
      '  cheaper and it is the kind of copy-paste a lane file invites.'
    );
  }
  if (APPLICATIONS_COLUMNS.indexOf('job_id') !== 0) {
    throw new Error('Seed Lanes: applications column A is ' + JSON.stringify(APPLICATIONS_COLUMNS[0]) + ', not job_id, and the A:A range is read as the already-written job id list.');
  }
}());

// The five ranges, in the order Build Candidates reads valueRanges. Changing the ORDER here is a
// breaking change to that node and it asserts the count on arrival.
const RANGE_PLAN = LANE_ROWS.map((l) => ({
  key: l.key,
  ranges: [
    a1(l.settings_tab, 'A:B'),
    a1(l.jobs_tab, 'A:' + JOBS_LAST),
    a1(l.applications_tab, 'A:A'),
    a1(l.applications_tab, '1:1'),
    a1(l.writer_runs_tab, 'A:' + RUNS_LAST),
  ],
}));
const RANGE_NAMES = ['settings', 'jobs', 'applications_ids', 'applications_header', 'writer_runs'];

const LANES_SEED = LANE_ROWS.map((l, i) => ({
  _kind: 'lane',
  lane_key: l.key,
  source_project: l.source_project,
  source_lane_name: l.source_lane_name,
  label: l.label,
  spreadsheet_id: l.spreadsheet_id,
  jobs_tab: l.jobs_tab,
  applications_tab: l.applications_tab,
  settings_tab: l.settings_tab,
  writer_runs_tab: l.writer_runs_tab,
  drive_parent_folder_id: l.drive_parent_folder_id,
  master_key: l.master_key,
  cv_master_frozen: l.cv_master_frozen,
  ranges: RANGE_PLAN[i].ranges,
  range_names: RANGE_NAMES,
  batch_get_url: batchGetUrl(l.spreadsheet_id, RANGE_PLAN[i].ranges),
}));

const LOGIC = `
// ---------------------------------------------------------------------------
// Seed Lanes. One item per source lane, plus the run stamp every later node reads.
// ---------------------------------------------------------------------------
const runStartedAt = new Date().toISOString();

// The execution id, for the writer_runs ledger and for tying a sheet row back to a run on the box.
let execId = null;
try {
  execId = $execution && $execution.id ? String($execution.id) : null;
} catch (e) {
  execId = null;
}
let execIdSource = execId ? 'n8n execution id' : 'no execution context, so a timestamp stands in';
if (!execId) execId = 'no-exec-' + String(Date.now());

// The Europe/Stockholm calendar date. See header note 4: this is what the daily cap counts on, and
// slicing the ISO string would be the UTC date, which is a different day for two hours every summer
// evening. A failure to resolve it falls back to the ISO date and SAYS so on the item, because a
// daily cap counted against the wrong day is worse when nobody can see which day it used.
let runDate = null;
let runDateSource = 'Intl, timezone ' + TIMEZONE;
try {
  runDate = new Date().toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
} catch (e) {
  runDate = null;
}
if (typeof runDate !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(runDate)) {
  runDate = runStartedAt.slice(0, 10);
  runDateSource = 'FELL BACK to the UTC date: Intl did not return a YYYY-MM-DD for timezone ' + TIMEZONE;
}

const out = [];
for (let i = 0; i < LANES.length; i += 1) {
  const l = LANES[i];
  out.push({
    json: Object.assign({}, l, {
      seq: i + 1,
      of: LANES.length,
      workflow_lane: WORKFLOW_LANE,
      run_started_at: runStartedAt,
      run_date: runDate,
      run_date_source: runDateSource,
      exec_id: execId,
      exec_id_source: execIdSource,
      timezone: TIMEZONE,
      caps: CAPS,
      caps_source: CAPS_SOURCE,
    }),
    pairedItem: { item: 0 },
  });
}

if (!out.length) {
  throw new Error('Seed Lanes: no source lanes were baked into this node, so the run would read nothing and report a healthy zero. That is a build fault, not a data one: rebuild from work/36-job-application-writer/nodes/03-seed-lanes.js.');
}
return out;
`;

const jsCode = [
  '// GENERATED at build time from work/36-job-application-writer/nodes/03-seed-lanes.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  'const LANES = ' + JSON.stringify(LANES_SEED) + ';',
  'const WORKFLOW_LANE = ' + JSON.stringify(String(L.lane)) + ';',
  'const TIMEZONE = ' + JSON.stringify(L.timezone) + ';',
  'const CAPS = ' + JSON.stringify(CAPS.values) + ';',
  'const CAPS_SOURCE = ' + JSON.stringify(CAPS.from) + ';',
  LOGIC,
].join('\n');

module.exports = {
  name: 'Seed Lanes',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [260, 100],
  connectFrom: ['When clicking Test', 'Schedule Trigger'],
  notes: 'Two items, one per source lane, each carrying its spreadsheet id, its four tab names, its Drive parent folder, its CV master key and the exact values:batchGet url for its five ranges. Stamps run_started_at, the Europe/Stockholm run_date the daily cap counts on, and the execution id.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};
