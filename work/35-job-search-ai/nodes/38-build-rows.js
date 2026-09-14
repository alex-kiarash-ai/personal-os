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
 * 2. EXACTLY FIFTEEN KEYS PLUS ONE, AND THE REASON IS AN n8n TRAP.
 * ---------------------------------------------------------------------------------------------
 * A writable item carries the fifteen sheet columns in sheet order and then `_write_now`. Nothing
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
 *       to the fifteen real column names plus one means even that degenerate path writes a header
 *       that is fifteen sixteenths correct and instantly recognisable, and the header read-back in
 *       Build Run Row fails the run on the sixteenth. This is the trap Agent 3 named for this stage
 *       on 2026-09-11: "append cannot write a header-only tab cleanly".
 *
 * ---------------------------------------------------------------------------------------------
 * 3. work_mode AND red_flags: FOLDED INTO fit_reasons, NOT GIVEN COLUMNS. The decision and the cost.
 * ---------------------------------------------------------------------------------------------
 * Agent 5 handed this over with three options: add columns, fold, or drop. Dropping is out, because
 * `red_flags` carries the exact string "Swedish fluent required" which Shaheen asked for by name.
 *
 * ADDING COLUMNS WAS REJECTED, and the reason is not effort, it is that it cannot be done from here
 * without a human step that would silently half-land:
 *   - `shared_row_shape` is fifteen fields and it is asserted, in that order, by the LinkedIn, the
 *     Indeed and the board collectors, by Remove Known, and by the provisioner's own read-back.
 *     Growing it moves sources.json, seed.json and every one of those guards.
 *   - The LIVE sheet header would have to move in the same breath. The provisioner that wrote it was
 *     deleted on 2026-09-11, so that is a hand edit by Shaheen, and he already has hand edits queued.
 *   - If the sheet header does NOT move, `checkForSchemaChanges` throws on every run (loud, fine) or,
 *     with auto-mapping, the two new keys silently become two new columns nobody chose.
 *   A schema change that needs a human step in the middle is a schema change that half-lands, and
 *   this stage is not the place to spend that.
 *
 * SO THEY ARE FOLDED, into the cell Shaheen already reads for the model's opinion:
 *     <reasons>; FLAGS: Swedish fluent required; seniority above his level; MODE: hybrid
 * `FLAGS:` and `MODE:` are uppercase and inline so the cell is greppable and reads as one sentence
 * on a phone. `MODE:` is omitted when the model said `unclear`, because "unclear" is not information.
 * The structured versions survive untouched on `_score.red_flags` and `_score.work_mode` in the run
 * data, so nothing is lost, it is only not a column.
 *
 * TRUNCATION IS MADE STRUCTURALLY IMPOSSIBLE rather than hoped about. The cap below is asserted at
 * build time against Parse Score's OWN constants, read out of its generated code, so the day someone
 * raises REASONS_MAX or FLAG_MAX_CHARS past what this cell can hold, THIS BUILD fails instead of the
 * flag quietly falling off the end.
 *
 * THE PATH BACK IS ONE SESSION, and it is written down so it stays cheap: add the two fields to
 * `shared_row_shape`, add them to every collector's null set, add the two columns to the live sheet
 * header, and delete the fold. The card says so too.
 *
 * ---------------------------------------------------------------------------------------------
 * 4. EVERY CELL IS SANITISED, AND cellFormat: RAW IS NOT THE WHOLE ANSWER.
 * ---------------------------------------------------------------------------------------------
 * Measured: `cellFormatDefault(nodeVersion)` returns `USER_ENTERED` for any node version at or above
 * 4.1, and Write Jobs is 4.5. Under USER_ENTERED a cell beginning `=`, `+`, `-` or `@` is a live
 * FORMULA. `excerpt` is up to 1200 characters of a job ad written by a stranger, and `title` and
 * `company` come off the same page. Write Jobs therefore sets `options.cellFormat: 'RAW'` explicitly.
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
 * OUT the writable rows (fifteen keys + `_write_now: true`), then EVERY other item untouched with
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
const CELL_MAX = 500;          // every short column
const EXCERPT_MAX = 1500;      // above the detail collector's 1200 and the boards' 400
const FIT_REASONS_MAX = 1500;  // asserted below against what Parse Score can actually produce
const NOTE_REASON_MAX = 220;   // the "NOT SCORED (...)" explanation on a written unscored row

// The status this stage writes. `new` is Shaheen's own workflow vocabulary for the column, and it is
// the ONE value this stage sets: score_status and detail_status are reporting fields and do not go
// in here, because overloading his workflow column with a machine state would make "new" ambiguous.
const ROW_STATUS = 'new';

(function assertAgainstUpstream() {
  const parseScore = require('./32-parse-score.js');
  if (parseScore.name !== 'Parse Score') {
    throw new Error('Build Rows: node 32 is named ' + JSON.stringify(parseScore.name) + ' and this node connects from "Parse Score". The name is the connection key.');
  }

  // The fold cap, checked against the numbers Parse Score actually enforces, read out of its
  // GENERATED code rather than restated. Worst case is every reason at its cap, every flag at its
  // cap, both labels, and the separators between them.
  const reasonMax = O.constFromNode(parseScore, 'REASON_MAX_CHARS');
  const reasonsMax = O.constFromNode(parseScore, 'REASONS_MAX');
  const flagMax = O.constFromNode(parseScore, 'FLAG_MAX_CHARS');
  const flagsMax = O.constFromNode(parseScore, 'FLAGS_MAX');
  const worst = (reasonMax * reasonsMax) + ((reasonsMax - 1) * 2)
    + 2 + 'FLAGS: '.length + (flagMax * flagsMax) + ((flagsMax - 1) * 2)
    + 2 + 'MODE: '.length + 16;
  if (FIT_REASONS_MAX < worst) {
    throw new Error(
      'Build Rows: FIT_REASONS_MAX is ' + FIT_REASONS_MAX + ' and Parse Score can produce up to ' + worst + ' characters\n' +
      '  (' + reasonsMax + ' reasons at ' + reasonMax + ' + ' + flagsMax + ' flags at ' + flagMax + ' + the labels).\n' +
      '  red_flags carries "Swedish fluent required", which Shaheen asked for by name, so a fold that can\n' +
      '  truncate is a fold that can drop it. Raise the cap or lower Parse Score, in the same edit.'
    );
  }

  // The fifteen columns this node writes ARE the contract's row shape, and the sheet header is the
  // same list in the same order. Cross-checked against the provisioning seed while it is on disk.
  O.assertTabsAgainstSeed(ROW_SHAPE);
  for (const f of ['job_id', 'status', 'fit_score', 'fit_reasons', 'excerpt', 'lane', 'source', 'found_at', 'posted_at', 'company', 'title', 'url', 'apply_url', 'remote', 'location']) {
    if (ROW_SHAPE.indexOf(f) === -1) {
      throw new Error('Build Rows: the contract no longer carries a ' + f + ' column, and this node fills every one of the fifteen by name.');
    }
  }
  if (ROW_SHAPE.length !== 15) {
    throw new Error(
      'Build Rows: shared_row_shape is now ' + ROW_SHAPE.length + ' fields, not 15.\n' +
      '  If that is deliberate, the LIVE jobs tab header moves in the SAME session (Stage A rule), and the\n' +
      '  work_mode / red_flags fold in this node is probably what should have grown instead. See header note 3.'
    );
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

// --- the fold ----------------------------------------------------------------
// work_mode and red_flags have no column. See header note 3. Nothing is dropped and nothing can be
// truncated: the cap is asserted at build time against Parse Score's own limits.
let foldedFlags = 0;
let foldedModes = 0;
let flagRowsWithSwedish = 0;
function fitReasonsCell(row) {
  const s = row._score || {};
  const parts = [];

  if (row.score_status !== 'scored') {
    const kind = row.score_error_kind ? '/' + row.score_error_kind : '';
    const why = cell(row.score_error || row.write_to_sheet_why || '', NOTE_REASON_MAX);
    // An unscored row with an empty score AND an empty reason is invisible in the sheet. This is the
    // one thing that makes it legible: the row is here, it has no number, and this is why.
    parts.push('NOT SCORED (' + String(row.score_status || 'unknown') + kind + ')' + (why ? ': ' + why : ''));
  }

  const reasons = typeof row.fit_reasons === 'string' && row.fit_reasons.trim() ? row.fit_reasons.trim() : '';
  if (reasons) parts.push(reasons);

  const flags = Array.isArray(s.red_flags) ? s.red_flags.filter((f) => f !== null && f !== undefined && String(f).trim() !== '') : [];
  if (flags.length) {
    foldedFlags += flags.length;
    if (flags.some((f) => String(f) === SWEDISH_FLAG)) flagRowsWithSwedish += 1;
    parts.push('FLAGS: ' + flags.map((f) => String(f).trim()).join('; '));
  }

  const mode = typeof s.work_mode === 'string' ? s.work_mode.trim().toLowerCase() : '';
  // 'unclear' is the model saying it could not tell, which is not information worth a cell.
  if (mode && mode !== 'unclear') { foldedModes += 1; parts.push('MODE: ' + mode); }

  return cell(parts.join('; '), FIT_REASONS_MAX);
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
    // EXACTLY the fifteen columns, in sheet order, then the routing boolean. See header note 2.
    const row = {};
    for (const col of ROW_SHAPE) row[col] = cell(j[col], col === 'excerpt' ? EXCERPT_MAX : CELL_MAX);
    row.status = ROW_STATUS;
    row.fit_reasons = fitReasonsCell(j);
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
  fold: {
    what: 'work_mode and red_flags have no column in shared_row_shape, so they are folded into fit_reasons as "FLAGS: ..." and "MODE: ..."',
    red_flags_folded: foldedFlags,
    rows_carrying_the_swedish_flag: flagRowsWithSwedish,
    swedish_flag_string: SWEDISH_FLAG,
    work_modes_folded: foldedModes,
    work_mode_unclear_omitted: true,
    structured_copies_survive_on: '_score.red_flags and _score.work_mode, in the run data',
    the_path_back: 'add both to shared_row_shape, add them to every collector null set, move the LIVE jobs tab header in the same session, delete the fold',
  },
  sanitising: counters,
  cell_caps: { standard: CELL_MAX, excerpt: EXCERPT_MAX, fit_reasons: FIT_REASONS_MAX },
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
  `const EXCERPT_MAX = ${JSON.stringify(EXCERPT_MAX)};`,
  `const FIT_REASONS_MAX = ${JSON.stringify(FIT_REASONS_MAX)};`,
  `const NOTE_REASON_MAX = ${JSON.stringify(NOTE_REASON_MAX)};`,
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
