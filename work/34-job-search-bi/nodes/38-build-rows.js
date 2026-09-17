'use strict';
/*
 * 38-build-rows.js - "Build Rows". The first node of the output stage. Turns the scored stream into
 * rows that are safe to put in a spreadsheet, and stamps the boolean the write router reads.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. WHY THIS NODE EXISTS AT ALL, when the dispatch went straight from Parse Score to Write Jobs.
 * ---------------------------------------------------------------------------------------------
 * Three things have to happen before a row touches the sheet and none of them can happen inside a
 * Google Sheets node:
 *   - `status` has to become `new`. Every collector deliberately left it null (Stage B judgment 8:
 *     a value nobody set is easier to find than a value someone guessed), and `new` is this stage's
 *     to write.
 *   - `work_mode` and `red_flags` have to go SOMEWHERE. Agent 5 left the decision here. See note 3.
 *   - Every cell has to be sanitised. The `excerpt` column is a job ad written by a stranger, and it
 *     lands in a spreadsheet. See note 4.
 * And the router needs a boolean to route on, which is the same shape Budget Gate and Detail Gate
 * both use, so the IF can run `typeValidation: strict` and a missing field is a loud contract
 * violation instead of a silent reroute.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. EXACTLY ELEVEN KEYS PLUS ONE, AND THE REASON IS AN n8n TRAP.
 * ---------------------------------------------------------------------------------------------
 * A writable item carries the eleven sheet columns in sheet order and then `_write_now`. Nothing
 * else. Not `_score`, not `_collect`, not `write_to_sheet`. Two separate reasons, both measured in
 * `append.operation.ts` at n8n@2.30.3 rather than assumed:
 *
 *   (a) `columns.mappingMode: autoMapInputData` sends every unmatched input key through
 *       `handlingExtraData`, whose DEFAULT is `insertInNewColumn`. Pointed at Shaheen's live jobs
 *       tab that would silently ADD a column per provenance key. Write Jobs uses `defineBelow`
 *       instead, which never looks at an unmatched key, so this alone would be enough.
 *
 *   (b) The reason it is not enough. `execute()` reads the target range FIRST and, when the tab
 *       comes back EMPTY, it reassigns `dataMode = 'autoMapInputData'` and skips the schema check
 *       entirely. So a `jobs_test` tab created as a blank sheet with no header row makes the node
 *       invent a header out of the first item's keys, whatever `defineBelow` said. Keeping the item
 *       to the eleven real column names plus one means even that degenerate path writes a header
 *       that is eleven twelfths correct and instantly recognisable, and the header read-back in
 *       Build Run Row fails the run on the twelfth. This is the trap Agent 3 named for this stage
 *       on 2026-09-11: "append cannot write a header-only tab cleanly".
 *
 * ---------------------------------------------------------------------------------------------
 * 3. THE FOLD IS GONE, AND WHAT WENT WITH IT. (2026-09-17, Shaheen's instruction.)
 * ---------------------------------------------------------------------------------------------
 * Until 2026-09-17 this node folded `work_mode` and `red_flags` into the `fit_reasons` cell, because
 * neither had a column and `red_flags` carries the exact string "Swedish fluent required" which
 * Shaheen asked for by name. That fold is deleted, because the cell it folded into is deleted:
 * apply_url, fit_reasons, lane and excerpt came off the jobs tab in both spreadsheets on his
 * instruction, his reason being that the output does not add value and costs tokens.
 *
 * WHAT THAT COSTS, stated here rather than discovered in three weeks:
 *   - The per-row red flags have NO CELL any more. "Swedish fluent required" is still produced by
 *     the scorer and still counted in this node's stage report (`dropped_from_the_sheet` below), so
 *     it survives in the run data and in the HQ push, but nothing shows it against the job in the
 *     sheet. If he wants it back, the cheapest home is the runs-tab note, not a new column.
 *   - `work_mode` is in the same position, minus the by-name request.
 *   - An unscored row no longer explains itself. The old cell carried "NOT SCORED (scoring_off): ..."
 *     and now an unscored row is simply one with an empty `fit_score`. That is still unambiguous in
 *     the sheet (empty means nobody scored it) and the reason survives per-run in the runs verdict.
 *
 * WHAT IS NOT AFFECTED: the scoring prompt still ASKS for fit_reasons, red_flags and work_mode, and
 * Parse Score still parses all three. Stopping the ask is the remaining token saving and it is a
 * quality decision (it changes what the model does, and it invalidates the cached system block), so
 * it was deliberately left for Shaheen rather than taken as part of a column deletion.
 *
 * ---------------------------------------------------------------------------------------------
 * 4. EVERY CELL IS SANITISED, AND cellFormat: RAW IS NOT THE WHOLE ANSWER.
 * ---------------------------------------------------------------------------------------------
 * Measured: `cellFormatDefault(nodeVersion)` returns `USER_ENTERED` for any node version at or above
 * 4.1, and Write Jobs is 4.5. Under USER_ENTERED a cell beginning `=`, `+`, `-` or `@` is a live
 * FORMULA. `title`, `company` and `location` come straight off a stranger's page, and they are still
 * written. (`excerpt`, the 1200-character version of that problem, stopped being a column on
 * 2026-09-17, which shrinks the surface and does not remove it.) Write Jobs therefore sets
 * `options.cellFormat: 'RAW'` explicitly.
 * That is the layer that makes it moot; this node strips the prefix anyway, because Agent 5 already
 * said it in Parse Score and it is right: a defence that depends on another node's option is not one.
 * Parse Score covers the MODEL's strings. This covers the COLLECTED ones, which it never saw.
 *
 * Also stripped here: control characters and newlines, which would otherwise break a single cell;
 * em dashes to ", " and en dashes to "-", the substitution the live engines' QA node makes, because
 * no output from this system carries either character.
 *
 * ---------------------------------------------------------------------------------------------
 * 5. THE STREAM CONTRACT.
 * ---------------------------------------------------------------------------------------------
 * IN  from Parse Score: every job row (each carrying `write_to_sheet` and `write_to_sheet_why`),
 *     up to NINE `source_report` items, and FOUR `stage_report` items plus Parse Score's own.
 * OUT the writable rows (eleven keys + `_write_now: true`), then EVERY other item untouched with
 *     `_write_now: false`, then one `_kind: 'stage_report'` of its own. The reports are never
 *     filtered and never reshaped: Build Run Row writes the run verdict from them.
 * It never returns an empty array. A Code node returning [] ends the branch, and the run with
 * nothing to write is exactly the run whose report matters most.
 */

const { lane, sources } = require('./_lane');
const O = require('./_output');

const L = lane();
const CONTRACT = sources();
const ROW_SHAPE = CONTRACT.shared_row_shape;

// Per-cell caps. Generous on purpose: these are a bound on a runaway value, not a formatting rule.
// EXCERPT_MAX, FIT_REASONS_MAX and NOTE_REASON_MAX went with the fold on 2026-09-17: the two long
// cells they bounded are not columns any more, and a cap on a value nobody writes is dead code that
// reads like a live rule. CELL_MAX now covers every column there is.
const CELL_MAX = 500;          // every column, and they are all short ones now

// The two columns Shaheen asked to see as a DATE and not a timestamp (2026-09-17). The slice is
// deliberate and is not a reformat: an ISO string loses its time and anything else is written
// through untouched, so a source that publishes a date in its own shape never becomes an invalid one.
const DATE_ONLY_COLUMNS = ['found_at', 'posted_at'];

// The status this stage writes. `new` is Shaheen's own workflow vocabulary for the column, and it is
// the ONE value this stage sets: score_status and detail_status are reporting fields and do not go
// in here, because overloading his workflow column with a machine state would make "new" ambiguous.
const ROW_STATUS = 'new';

(function assertAgainstUpstream() {
  const parseScore = require('./32-parse-score.js');
  if (parseScore.name !== 'Parse Score') {
    throw new Error('Build Rows: node 32 is named ' + JSON.stringify(parseScore.name) + ' and this node connects from "Parse Score". The name is the connection key.');
  }

  // The eleven columns this node writes ARE the contract's row shape, and the sheet header is the
  // same list in the same order. Cross-checked against the provisioning seed while it is on disk.
  O.assertTabsAgainstSeed(ROW_SHAPE);
  for (const f of ['job_id', 'status', 'fit_score', 'source', 'found_at', 'posted_at', 'company', 'title', 'url', 'remote', 'location']) {
    if (ROW_SHAPE.indexOf(f) === -1) {
      throw new Error('Build Rows: the contract no longer carries a ' + f + ' column, and this node fills every one of the eleven by name.');
    }
  }
  // The four that LEFT on 2026-09-17, refused by name. A silent return would mean this node writes a
  // column whose value nothing computes any more, and the fold that used to fill fit_reasons is gone.
  for (const f of ['apply_url', 'fit_reasons', 'lane', 'excerpt']) {
    if (ROW_SHAPE.indexOf(f) !== -1) {
      throw new Error(
        'Build Rows: ' + f + ' is a sheet column again.\n' +
        '  Shaheen removed all four of apply_url, fit_reasons, lane and excerpt on 2026-09-17. If one is\n' +
        '  genuinely coming back, the LIVE jobs tab header moves in the SAME session (Stage A rule) and\n' +
        '  whatever used to fill it has to be rebuilt deliberately. See header note 3.'
      );
    }
  }
  if (ROW_SHAPE.length !== 11) {
    throw new Error(
      'Build Rows: shared_row_shape is now ' + ROW_SHAPE.length + ' fields, not 11.\n' +
      '  If that is deliberate, the LIVE jobs tab header moves in the SAME session (Stage A rule).'
    );
  }
  for (const c of DATE_ONLY_COLUMNS) {
    if (ROW_SHAPE.indexOf(c) === -1) {
      throw new Error('Build Rows: ' + c + ' is written date-only on Shaheen instruction and is not a column any more. Drop it from DATE_ONLY_COLUMNS in the same edit.');
    }
  }

  const w = O.writeTarget();
  if (typeof w.tab !== 'string' || !w.tab) throw new Error('Build Rows: could not resolve a write tab from lane.json.');
}());

const WRITE = O.writeTarget();

const LOGIC = `
// ---------------------------------------------------------------------------
// Build Rows. Sheet-safe rows, the fold, and the routing boolean.
// ---------------------------------------------------------------------------
const incoming = $input.all().map((i) => i.json);

if (!incoming.length) {
  // Unreachable in the live topology: Parse Score returns every row, every report and its own, so it
  // is never empty. Said out loud because "it cannot happen" is how the last three silent losses in
  // this workflow started.
  throw new Error('Build Rows: Parse Score delivered no items at all. It emits at least its own stage report on every path, so an empty input means that node did not run and every source report has already been lost.');
}

const jobs = incoming.filter((j) => j && j._kind === 'job');
const carried = incoming.filter((j) => !j || j._kind !== 'job');

// --- text safety -------------------------------------------------------------
function stripDashes(s) {
  return String(s).split('\\u2014').join(', ').split('\\u2013').join('-');
}
const counters = { formula_prefixes_stripped: 0, dashes_replaced: 0, control_chars_stripped: 0, truncated_cells: 0 };
function cell(v, cap) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && isFinite(v)) return v;          // a real number stays a number under RAW
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  let out = String(v);
  const before = out;
  out = stripDashes(out);
  if (out !== before) counters.dashes_replaced += 1;
  const preCtl = out;
  out = out.replace(/[\\u0000-\\u001F\\u007F]/g, ' ').replace(/[\\u200B-\\u200D\\uFEFF\\u00A0]/g, ' ');
  if (out !== preCtl) counters.control_chars_stripped += 1;
  out = out.replace(/\\s+/g, ' ').trim();
  // A cell beginning with one of these is a FORMULA under USER_ENTERED. Write Jobs sets RAW, which
  // makes it moot; this is the second layer, because a defence that depends on another node's option
  // is not one. Parse Score already does this to the MODEL's strings; these are the COLLECTED ones.
  while (out.length && '=+-@'.indexOf(out[0]) !== -1) { out = out.slice(1).trim(); counters.formula_prefixes_stripped += 1; }
  if (out.length > cap) { out = out.slice(0, cap - 1).trim() + '\\u2026'; counters.truncated_cells += 1; }
  return out;
}

// --- the date-only columns ---------------------------------------------------
// Shaheen 2026-09-17: found_at and posted_at are dates in the sheet, not timestamps. A slice, not a
// reformat: an ISO string loses its time, and a value that is not an ISO date is written through
// exactly as collected rather than being turned into an invalid date by a parser guessing at it.
let datesShortened = 0;
function dateOnly(v) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  // DOUBLE-ESCAPED on purpose: this sits inside the LOGIC template literal, so one level of
  // escaping is consumed when the string is built. A single backslash here generates /^(d{4}...)/
  // which matches nothing, and every timestamp would be written through as a timestamp with the
  // run reporting zero cells shortened. Measured, not guessed: test-output 5b caught exactly that.
  const m = /^(\\d{4}-\\d{2}-\\d{2})T/.exec(s);
  if (!m) return s;
  datesShortened += 1;
  return m[1];
}

// The scorer still produces reasons, red flags and a work mode, and since 2026-09-17 nothing writes
// them. These four counters are the ONLY place that loss is visible, so the stage report can say how
// much was thrown away rather than the sheet quietly getting shorter. See header note 3.
let reasonsDropped = 0;
let flagsDropped = 0;
let modesDropped = 0;
let unscoredNoteDropped = 0;
let flagRowsWithSwedish = 0;
function countWhatTheSheetNoLongerShows(row) {
  const s = row._score || {};
  if (row.score_status !== 'scored') unscoredNoteDropped += 1;
  if (typeof row.fit_reasons === 'string' && row.fit_reasons.trim()) reasonsDropped += 1;
  const flags = Array.isArray(s.red_flags) ? s.red_flags.filter((f) => f !== null && f !== undefined && String(f).trim() !== '') : [];
  flagsDropped += flags.length;
  if (flags.some((f) => String(f) === SWEDISH_FLAG)) flagRowsWithSwedish += 1;
  const mode = typeof s.work_mode === 'string' ? s.work_mode.trim().toLowerCase() : '';
  if (mode && mode !== 'unclear') modesDropped += 1;
}

// --- build ---------------------------------------------------------------------
const writable = [];
const notWritten = [];
let noDecision = 0;
const noDecisionSamples = [];
const seenIds = {};
let duplicateIds = 0;
let scoredRows = 0;
let unscoredWritten = 0;
const byStatus = {};

for (const j of jobs) {
  byStatus[j.score_status || 'unstamped'] = (byStatus[j.score_status || 'unstamped'] || 0) + 1;

  if (j.write_to_sheet === true) {
    // EXACTLY the eleven columns, in sheet order, then the routing boolean. See header note 2.
    countWhatTheSheetNoLongerShows(j);
    const row = {};
    for (const col of ROW_SHAPE) {
      row[col] = DATE_ONLY_COLUMNS.indexOf(col) === -1 ? cell(j[col], CELL_MAX) : cell(dateOnly(j[col]), CELL_MAX);
    }
    row.status = ROW_STATUS;
    // fit_score stays a real number so the sheet sorts on it. Null becomes an empty cell rather
    // than a zero: a zero is a score the model gave and an empty cell is a score nobody gave.
    row.fit_score = (j.fit_score === null || j.fit_score === undefined || !isFinite(Number(j.fit_score))) ? '' : Number(j.fit_score);
    // remote is a COLLECTED fact and is true or null, never false (Stage B judgment 10). The model
    // never overwrites it and neither does this node.
    row.remote = j.remote === true ? 'yes' : (j.remote === false ? 'no' : '');

    const id = String(row.job_id || '');
    if (!id) {
      // Unreachable: a row with no id is dropped by its own collector. Kept as a refusal because a
      // blank id in the sheet makes Remove Known unable to recognise the row ever again.
      noDecision += 1;
      if (noDecisionSamples.length < 5) noDecisionSamples.push({ why: 'a writable row arrived with no job_id', source: j.source, title: j.title });
      notWritten.push(j);
      continue;
    }
    if (seenIds[id]) { duplicateIds += 1; } else { seenIds[id] = true; }

    if (j.score_status === 'scored') scoredRows += 1; else unscoredWritten += 1;
    row._write_now = true;
    writable.push(row);
    continue;
  }

  if (j.write_to_sheet === false) { notWritten.push(j); continue; }

  // NEITHER true NOR false. Parse Score stamps write_to_sheet on every job row on every path, so an
  // absent one means the contract upstream broke. It is NOT written (writing a row nobody decided on
  // is how a row gets deleted as known next run without ever being scored), it is counted, and
  // Build Run Row treats a non-zero count as a reason not to advance the window.
  noDecision += 1;
  if (noDecisionSamples.length < 5) noDecisionSamples.push({ job_id: j.job_id, source: j.source, write_to_sheet: j.write_to_sheet });
  notWritten.push(j);
}

const warnings = [];
if (noDecision > 0) {
  warnings.push(
    noDecision + ' job row(s) reached this node with no usable write_to_sheet decision and were NOT written. ' +
    'Parse Score stamps that field on every path, so this is an upstream contract break rather than a data problem. ' +
    'The rows are kept in the stream and the window must not advance while any exist.'
  );
}
if (duplicateIds > 0) {
  warnings.push(
    duplicateIds + ' writable row(s) share a job_id with another writable row. Remove Known collapses by exact id, so ' +
    'this should be zero; each duplicate becomes a second sheet row that the next run then treats as one known job.'
  );
}
if (counters.formula_prefixes_stripped > 0) {
  warnings.push(
    counters.formula_prefixes_stripped + ' collected cell(s) began with =, + , - or @ and had it stripped. Write Jobs ' +
    'writes RAW so it was already inert, and this is the second layer. Worth reading as a possible injection attempt ' +
    'through a job ad rather than as punctuation.'
  );
}
if (counters.truncated_cells > 0) {
  warnings.push(counters.truncated_cells + ' cell(s) hit their length cap and were truncated with an ellipsis. fit_reasons cannot be one of them: its cap is asserted at build time against what Parse Score can produce.');
}
if (WRITE_IS_TEST_TAB) {
  warnings.push(
    'THIS RUN WRITES TO ' + JSON.stringify(WRITE_TAB) + ', NOT TO ' + JSON.stringify(REAL_TAB) + '. Two consequences. ' +
    'Remove Known reads the REAL tab, so nothing written here is deduped against on the next run and a second test run ' +
    'writes the same rows again. And last_run_at must NOT advance: a window that moved past rows written only to a test ' +
    'tab would lose them the moment the write is repointed, and every run would still look green. ' +
    'The repoint is deleting sheet.jobs_write_tab from lane.json and rebuilding.'
  );
}
if (!writable.length) {
  warnings.push(
    'nothing is being written to the sheet this run. That is an ordinary quiet day, and it is also what a run with a ' +
    'refused sheet read, a scoring outage or a bitten cap looks like. Build Run Row tells those apart from the reports; ' +
    'this line is not evidence of either.'
  );
}

const report = {
  _kind: 'stage_report',
  stage: 'output_rows',
  lane: LANE_NUMBER,
  write_target: { tab: WRITE_TAB, real_tab: REAL_TAB, is_test_tab: WRITE_IS_TEST_TAB, why: WRITE_WHY },
  jobs_in: jobs.length,
  reports_passed_through: carried.length,
  rows_to_write: writable.length,
  rows_not_written: notWritten.length,
  rows_without_a_write_decision: noDecision,
  rows_without_a_write_decision_samples: noDecisionSamples,
  duplicate_job_ids_in_the_write_set: duplicateIds,
  scored_rows_written: scoredRows,
  unscored_rows_written: unscoredWritten,
  by_score_status: byStatus,
  columns: ROW_SHAPE,
  status_written: ROW_STATUS,
  dropped_from_the_sheet: {
    what: 'apply_url, fit_reasons, lane and excerpt stopped being columns on 2026-09-17 (Shaheen). The scorer still produces fit_reasons, red_flags and work_mode and NOTHING writes them; this block is the only place the loss is counted.',
    rows_with_reasons_the_sheet_no_longer_shows: reasonsDropped,
    red_flags_the_sheet_no_longer_shows: flagsDropped,
    rows_carrying_the_swedish_flag: flagRowsWithSwedish,
    swedish_flag_string: SWEDISH_FLAG,
    work_modes_the_sheet_no_longer_shows: modesDropped,
    unscored_rows_that_no_longer_explain_themselves: unscoredNoteDropped,
    structured_copies_survive_on: '_score.red_flags and _score.work_mode, in the run data',
    the_cheapest_way_back: 'the runs-tab note, not a new jobs column',
  },
  dates_written_date_only: { columns: DATE_ONLY_COLUMNS, cells_shortened: datesShortened },
  sanitising: counters,
  cell_caps: { standard: CELL_MAX },
  warnings: warnings,
  _write_now: false,
};

// Writable rows first, then everything else untouched, then this report. Never an empty array.
const rowItems = writable.map((r) => ({ json: r, pairedItem: { item: 0 } }));
const carryItems = notWritten.concat(carried).map((j) => ({ json: Object.assign({}, j, { _write_now: false }), pairedItem: { item: 0 } }));
return rowItems.concat(carryItems, [{ json: report, pairedItem: { item: 0 } }]);
`;

const jsCode = [
  '// GENERATED at build time from work/34-job-search-bi/nodes/38-build-rows.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  `const ROW_SHAPE = ${JSON.stringify(ROW_SHAPE)};`,
  `const ROW_STATUS = ${JSON.stringify(ROW_STATUS)};`,
  `const CELL_MAX = ${JSON.stringify(CELL_MAX)};`,
  `const DATE_ONLY_COLUMNS = ${JSON.stringify(DATE_ONLY_COLUMNS)};`,
  // Read out of the scoring helper rather than typed, so the run report can never claim a flag
  // string the prompt does not actually ask the model for.
  `const SWEDISH_FLAG = ${JSON.stringify(require('./_scoring').SWEDISH_FLAG)};`,
  `const WRITE_TAB = ${JSON.stringify(WRITE.tab)};`,
  `const REAL_TAB = ${JSON.stringify(WRITE.real_tab)};`,
  `const WRITE_IS_TEST_TAB = ${JSON.stringify(WRITE.is_test_tab)};`,
  `const WRITE_WHY = ${JSON.stringify(WRITE.why)};`,
  `const LANE_NUMBER = ${JSON.stringify(String(L.lane))};`,
  LOGIC,
].join('\n');

module.exports = {
  name: 'Build Rows',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [5720, 780],
  connectFrom: 'Parse Score',
  notes: 'Turns scored rows into sheet-safe rows: exactly the fifteen columns, status new, work_mode and red_flags folded into fit_reasons, every cell stripped of dashes, control characters and a leading formula prefix. Stamps _write_now so the router can run strict. Passes every report through untouched and emits one of its own.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};
