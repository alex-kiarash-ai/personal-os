'use strict';
/*
 * 43-build-run-row.js - "Build Run Row". The node that decides what this run WAS.
 *
 * It verifies the jobs write against a fresh read of the sheet, derives the run verdict from the
 * reports rather than from row counts, decides whether the search window may move, builds the nine
 * cell run-ledger row, builds the addressed one-cell write for last_run_at, and builds the HQ
 * payload. It emits EXACTLY ONE item, because everything after it writes once per input item.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. THE VERDICT IS DERIVED FROM THE REPORTS, NEVER FROM ROW COUNTS.
 * ---------------------------------------------------------------------------------------------
 * Zero rows written is the same number on a quiet Tuesday, on a run where LinkedIn refused every
 * call, on a run where the sheet read failed, and on a run where scoring is down and every row is
 * held back. Only the reports tell those apart, which is why eight stages upstream emit one.
 *
 * THE PRECEDENCE, and it is declared in _output.js so a test can pin it:
 *     source_down:<name> > scoring_down > budget_hit > degraded:<name> > no_new_jobs > ok
 * A single column has to choose one, so EVERY applicable token is also carried in full on the
 * report and in the note. The ranking orders the headline; it never hides a finding.
 *
 * `source_down` is ranked first deliberately. LinkedIn is the entire Sweden channel for this lane
 * and whether the Hetzner box gets refused is the largest open unknown in it. Ranked below
 * `scoring_down` it would be invisible for as long as the Anthropic account stays empty, which is
 * every run today.
 *
 * `degraded:<name>` is the ONE token that is not in the dispatch's closed list, and the reason is a
 * measurement rather than a preference. Collectors emit five verdicts, ok / degraded / down /
 * disabled / idle, and the dispatch's list has no slot for the second. It is not an edge case: the
 * first real run truncates its 168 hour backfill on the LinkedIn call ceiling by design, and a
 * cap-truncated board reports degraded. Printing `ok` on that run would be the ledger's first lie.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. SWITCHED OFF IS NOT RAN AND FOUND NOTHING.
 * ---------------------------------------------------------------------------------------------
 * `disabled_sources` is read from Plan Queries, which is where the dispatch says it lives, and
 * cross-checked against the `verdict: disabled` reports the Filter node synthesises for exactly this
 * purpose. A source in that list contributed zero calls and zero rows BY DECISION and can never be
 * counted as down or degraded, whatever anything else says. `brightdata_indeed` is off in both lanes
 * and would otherwise read as a dead source on every single run.
 *
 * `idle` is its own thing again: the detail source reports it when nothing was ASKED of it, which is
 * what a day with no new LinkedIn rows looks like. Not down, not degraded, not disabled.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. last_run_at MOVES ONLY ON A CLEAN RUN, AND CLEAN IS AN AND OF FIVE THINGS.
 * ---------------------------------------------------------------------------------------------
 * Get this wrong and the lane loses jobs forever while every run stays green. The two the dispatch
 * named, and three more, each with the measurement behind it:
 *
 *   (1) `score.for_stage_f.advance_last_run_at_safe`. Read, never re-derived: Agent 5 already ANDs
 *       Remove Known's own verdict (a refused sheet read or a bitten cap), nothing held back at the
 *       scoring stage, and scoring not being down. Re-deriving it here would be a second copy of a
 *       rule that already has an owner.
 *   (2) No source reported `down` or `degraded`. The recovery design behind it: the LinkedIn
 *       collector has no retry, on purpose, because retrying into a soft block is how it becomes a
 *       hard one. What replaces the retry is the window staying open so the next run re-covers it.
 *       Remove Known dedupes the overlap, so a duplicate fetch costs latency and nothing else.
 *   (3) NOT truncated. Agent 4 flagged this on 2026-09-12 and deliberately did not wire it: a run
 *       that stopped following full pages has not covered its window, whatever it collected. Read
 *       off `paging.truncated`, which both page guards already set.
 *   (4) The jobs write is VERIFIED. Mine, and it is obvious once stated: if the append failed, or
 *       the read-back cannot show the ids in the tab, the rows are not in the sheet and the window
 *       was not covered. "It returned 200" is not verification.
 *   (5) The write tab is the REAL jobs tab. Mine, and it is the one nobody would think of. While
 *       `sheet.jobs_write_tab` points at `jobs_test`, advancing would move the window past rows that
 *       exist only in a scratch tab. Repoint the write and those jobs are gone, and every run in
 *       between reported success.
 *
 * A single false blocks the advance and the report says WHICH, in one sentence, by name.
 *
 * ---------------------------------------------------------------------------------------------
 * 4. THE last_run_at WRITE IS AN ADDRESSED CELL, AND A NO-OP IS A REAL CALL WITH AN EMPTY BODY.
 * ---------------------------------------------------------------------------------------------
 * The dispatch said "Google Sheets update of settings.last_run_at". Measured, that node is the wrong
 * instrument twice over. Its update operation matches a row by a lookup column and rewrites the row,
 * and when nothing matches it is a SILENT no-op that returns success. And it cannot be skipped on a
 * run that must not advance without another IF and another Merge, because n8n skips a node with no
 * input.
 *
 * So the write is a `values:batchUpdate`, the same call the provisioner and the settings sync both
 * use live, addressed at `settings!B<row>` where <row> came out of the read-back in THIS run. Two
 * things fall out of that. The row number is verified rather than matched, so a renamed key fails
 * here with a name instead of no-oping in the sheet. And a run that must not advance sends
 * `{valueInputOption: RAW, data: []}`, which is a legal call that writes nothing at all, so the node
 * always has exactly one item, always runs, and the whole decision lives in code an offline suite
 * can exercise instead of in an IF condition it cannot.
 *
 * The value written is the run's START time, not its finish. `window_end` is `run_started_at` by
 * Plan Queries' own definition, so anything posted while the run was in flight is inside the NEXT
 * window rather than lost between two.
 *
 * ---------------------------------------------------------------------------------------------
 * 5. WHAT `new` MEANS IN THE LEDGER, WHICH IS NOT WHAT THE STAGE E HANDOFF SAID.
 * ---------------------------------------------------------------------------------------------
 * Agent 4 mapped `new` to `remove_known.rows_out`. That is the number of rows that SURVIVED, and on
 * a scoring outage it is twenty while the sheet gained nothing. `new` here is the number of rows the
 * read-back can actually find in the tab, because reconciling the runs tab against the jobs tab is
 * the only reason the runs tab exists, and a `new` that counts rows nobody wrote makes the two
 * disagree forever. `rows_out` and the held-back count are both in the note, so nothing is lost.
 */

const { lane, sources } = require('./_lane');
const O = require('./_output');

const L = lane();
const CONTRACT = sources();
const WRITE = O.writeTarget();
const HQ = O.hqProject();

const NOTE_MAX = 900;

(function assertAgainstUpstream() {
  const read = require('./42-read-back-jobs.js');
  if (read.name !== 'Read Back Jobs') throw new Error('Build Run Row: node 42 is named ' + JSON.stringify(read.name) + ' and this node connects from "Read Back Jobs".');
  if (read.executeOnce !== true) {
    throw new Error('Build Run Row: Read Back Jobs no longer sets executeOnce, so it fires once per row and this node would receive hundreds of identical read-backs.');
  }
  const resp = read.parameters.options && read.parameters.options.response && read.parameters.options.response.response;
  if (!resp || resp.fullResponse !== true || resp.neverError !== true) {
    throw new Error('Build Run Row: Read Back Jobs no longer sets fullResponse AND neverError. This node reads statusCode off the item to tell a refused read-back from an empty tab, and without them a 4xx either throws or arrives with no status at all.');
  }
  for (const f of ['38-build-rows.js', '32-parse-score.js', '22-remove-known.js', '20-filter.js', '05-plan-queries.js']) {
    require('./' + f);
  }
  if (require('./38-build-rows.js').name !== 'Build Rows') throw new Error('Build Run Row: node 38 must be named "Build Rows"; this node reads $(\'Build Rows\') for the authoritative stream.');
  if (require('./05-plan-queries.js').name !== 'Plan Queries') throw new Error('Build Run Row: node 05 must be named "Plan Queries"; this node reads disabled_sources from it, which is how switched off is told apart from ran and found nothing.');
  if (require('./32-parse-score.js').name !== 'Parse Score') throw new Error('Build Run Row: node 32 must be named "Parse Score"; this node cross-checks the run cost against the per-row costs there.');

  // The stage names this node keys on are string literals in five other nodes. Read them out of the
  // generated code so a renamed stage fails HERE rather than arriving as an undefined report and
  // quietly producing a verdict of `ok`.
  const stages = {
    'filter': '20-filter.js',
    'remove_known': '22-remove-known.js',
    'score': '32-parse-score.js',
    'score_budget': '28-budget-gate.js',
    'output_rows': '38-build-rows.js',
  };
  for (const [stage, file] of Object.entries(stages)) {
    const src = (require('./' + file).parameters || {}).jsCode || '';
    if (src.indexOf("stage: '" + stage + "'") === -1) {
      throw new Error(
        'Build Run Row: ' + file + ' no longer emits a stage report named ' + JSON.stringify(stage) + '.\n' +
        '  This node finds every report by that exact string. A stage rename that is not made here too\n' +
        '  produces a run verdict built from a missing report, which reads as a clean run.'
      );
    }
  }

  // The advance flag is READ, not re-derived. Assert the field it is read from still exists.
  const scoreSrc = (require('./32-parse-score.js').parameters || {}).jsCode || '';
  if (scoreSrc.indexOf('advance_last_run_at_safe: advanceSafe') === -1) {
    throw new Error('Build Run Row: Parse Score no longer computes for_stage_f.advance_last_run_at_safe. That flag already ANDs Remove Known\'s verdict, the held-back count and the scoring verdict, and this node reads it rather than keeping a second copy of the rule.');
  }
  const rkSrc = (require('./22-remove-known.js').parameters || {}).jsCode || '';
  if (rkSrc.indexOf('advance_last_run_at_safe:') === -1) {
    throw new Error('Build Run Row: Remove Known no longer emits advance_last_run_at_safe.');
  }

  if (!L.sheet.settings_tab) throw new Error('Build Run Row: lane.json has no sheet.settings_tab; the last_run_at cell is addressed inside that tab.');
  if (O.RUNS_COLUMNS.length !== 9) throw new Error('Build Run Row: RUNS_COLUMNS is ' + O.RUNS_COLUMNS.length + ' columns, and the provisioned runs tab has nine.');
  O.assertTabsAgainstSeed(CONTRACT.shared_row_shape);
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// Build Run Row. Verify, decide, and say what the run was, in one item.
// ---------------------------------------------------------------------------

// --- 0. the stream, from the node that built it -------------------------------
let stream;
try {
  stream = $('Build Rows').all().map((i) => i.json);
} catch (e) {
  throw new Error('Build Run Row: cannot reach Build Rows (' + e.message + '). Every job row and every report in this run came from there, and without it this node has nothing to report on.');
}

const intendedRows = stream.filter((j) => j && j._write_now === true);
const sourceReports = stream.filter((j) => j && j._kind === 'source_report');
const stageReports = stream.filter((j) => j && j._kind === 'stage_report');
const byStage = {};
for (const r of stageReports) byStage[r.stage] = r;

const filterR = byStage.filter || null;
const removeKnownR = byStage.remove_known || null;
const scoreR = byStage.score || null;
const budgetR = byStage.score_budget || null;
const rowsR = byStage.output_rows || null;
const detailGateR = byStage.linkedin_detail_gate || null;

const missingReports = [];
if (!filterR) missingReports.push('filter');
if (!removeKnownR) missingReports.push('remove_known');
if (!scoreR) missingReports.push('score');
if (!rowsR) missingReports.push('output_rows');

const runStartedAt = (filterR && filterR.run_started_at) || (removeKnownR && removeKnownR.run_started_at) || null;

let execId = null;
try { execId = String($execution.id); } catch (e) { execId = null; }

// --- 1. what is actually in the sheet -----------------------------------------
const back = ($input.all()[0] || {}).json || {};
const readBack = {
  ok: false,
  why: null,
  http_status: null,
  header: null,
  header_matches: null,
  ids_in_tab: 0,
  data_rows: 0,
  ids_found: 0,
  ids_missing: [],
  settings_rows: 0,
  last_run_row: null,
  last_run_current: null,
};

function rangeTab(r) { const s = String(r || ''); const i = s.indexOf('!'); return (i === -1 ? s : s.slice(0, i)).replace(/^'/, '').replace(/'$/, '').split("''").join("'"); }
function rangeRef(r) { const s = String(r || ''); const i = s.indexOf('!'); return i === -1 ? '' : s.slice(i + 1); }

if (back.error !== undefined && back.statusCode === undefined) {
  readBack.why = 'the read-back request never completed: ' + String(typeof back.error === 'string' ? back.error : (back.error && back.error.message) || JSON.stringify(back.error)).slice(0, 240);
} else if (!isFinite(Number(back.statusCode))) {
  readBack.why = 'the read-back carried no statusCode. fullResponse is set on Read Back Jobs, so a missing status means the item is not an HTTP response at all.';
} else {
  readBack.http_status = Number(back.statusCode);
  const body = back.body || {};
  if (readBack.http_status < 200 || readBack.http_status >= 300) {
    const msg = (body && body.error && body.error.message) ? String(body.error.message) : '';
    readBack.why = 'the read-back returned HTTP ' + readBack.http_status + '. ' + (msg || 'no message') +
      (/Unable to parse range|not found/i.test(msg)
        ? ' THE TAB ' + JSON.stringify(WRITE_TAB) + ' PROBABLY DOES NOT EXIST. Create it by duplicating the ' + JSON.stringify(REAL_TAB) + ' tab and renaming the copy, so it arrives WITH its header row.'
        : '');
  } else if (!Array.isArray(body.valueRanges) || body.valueRanges.length < 3) {
    readBack.why = 'the read-back returned ' + ((body.valueRanges || []).length) + ' valueRange(s) and three were requested. Nothing can be compared, so nothing is confirmed.';
  } else {
    // MATCHING THE RANGES BACK, and it is not by index alone.
    //
    // The provisioner's Report node learned in review that batchGet normalises a range on the way
    // back (settings!A:B comes home as settings!A1:B31) and paired by TAB NAME instead of by index.
    // That is not enough here: TWO of the three ranges are on the SAME tab. So the tab picks the
    // candidates, the order the API returned them picks between the two, and a SHAPE check confirms
    // it rather than trusting the order. A header read is at most one row; a whole-column read is at
    // most one cell wide. If the shape check disagrees with the order, the order loses.
    const settingsVR = body.valueRanges.find((vr) => rangeTab(vr.range) === SETTINGS_TAB);
    const onWriteTab = body.valueRanges.filter((vr) => rangeTab(vr.range) === WRITE_TAB);
    const looksLikeHeader = (vr) => !vr.values || vr.values.length <= 1;
    const looksLikeColumn = (vr) => !vr.values || vr.values.every((r) => !r || r.length <= 1);
    let headerVR = onWriteTab[0] || null;
    let idsVR = onWriteTab[1] || null;
    if (headerVR && idsVR && !looksLikeHeader(headerVR) && looksLikeHeader(idsVR)) {
      const t = headerVR; headerVR = idsVR; idsVR = t;
    }
    if (headerVR && idsVR && !looksLikeColumn(idsVR) && looksLikeColumn(headerVR) && !looksLikeHeader(idsVR)) {
      const t = headerVR; headerVR = idsVR; idsVR = t;
    }

    if (!headerVR || !idsVR || !settingsVR) {
      readBack.why = 'the read-back came home with ranges this node could not match to the three it asked for: ' + JSON.stringify(body.valueRanges.map((v) => v.range)) +
        '. Expected two on ' + JSON.stringify(WRITE_TAB) + ' and one on ' + JSON.stringify(SETTINGS_TAB) + '.';
    } else if (!looksLikeColumn(idsVR)) {
      readBack.why = 'the job_id range came home ' + Math.max.apply(null, [0].concat((idsVR.values || []).map((r) => (r || []).length))) + ' cells wide and it was requested as one column (' + JSON.stringify(idsVR.range) + '). Counting ids out of the wrong range would confirm a write that never happened.';
    } else {
      const header = (headerVR.values && headerVR.values[0]) || [];
      readBack.header = header.map((c) => String(c === null || c === undefined ? '' : c).trim());
      readBack.header_matches = readBack.header.length === ROW_SHAPE.length && ROW_SHAPE.every((c, i) => readBack.header[i] === c);

      const col = (idsVR.values || []);
      readBack.data_rows = Math.max(0, col.length - 1);
      const present = {};
      for (let i = 1; i < col.length; i += 1) {
        const v = String((col[i] || [])[0] === undefined || (col[i] || [])[0] === null ? '' : (col[i] || [])[0]).trim();
        if (v) { present[v] = true; readBack.ids_in_tab += 1; }
      }
      const missing = [];
      for (const r of intendedRows) {
        const id = String(r.job_id === null || r.job_id === undefined ? '' : r.job_id).trim();
        if (id && present[id]) readBack.ids_found += 1;
        else if (id) missing.push(id);
      }
      readBack.ids_missing = missing.slice(0, 10);

      const srows = settingsVR.values || [];
      readBack.settings_rows = srows.length;
      for (let i = 1; i < srows.length; i += 1) {
        const k = String((srows[i] || [])[0] === undefined || (srows[i] || [])[0] === null ? '' : (srows[i] || [])[0]).trim();
        if (k === 'last_run_at') {
          readBack.last_run_row = i + 1;   // 1-based sheet row, header is row 1
          readBack.last_run_current = String((srows[i] || [])[1] === undefined || (srows[i] || [])[1] === null ? '' : (srows[i] || [])[1]);
          break;
        }
      }

      if (!readBack.header_matches) {
        readBack.why = 'the ' + WRITE_TAB + ' header is ' + JSON.stringify(readBack.header) + ' and the contract row shape is ' + JSON.stringify(ROW_SHAPE) +
          '. Every cell was mapped by column NAME, so a header that does not match means the rows are not in the columns they were written for.' +
          (readBack.header.indexOf('_write_now') !== -1
            ? ' The stray _write_now column is the signature of an EMPTY target tab: the append node falls back to auto-mapping when the tab has no header and invents one from the item keys.'
            : '');
      } else if (missing.length) {
        readBack.why = missing.length + ' of ' + intendedRows.length + ' row(s) were written and cannot be found in ' + WRITE_TAB + ' by job_id. First few: ' + JSON.stringify(readBack.ids_missing) + '.';
      } else {
        readBack.ok = true;
      }
    }
  }
}

// A write is only CONFIRMED when the read-back worked AND found every id.
const writeConfirmed = readBack.ok && readBack.ids_found === intendedRows.length;
const rowsWritten = writeConfirmed ? readBack.ids_found : (readBack.ok ? readBack.ids_found : 0);

// The append node's own outcome, read only to classify the failure. It is NOT the authority on
// whether the rows landed; the sheet is.
let appendErrors = 0;
let appendFirstError = null;
let appendItems = null;
try {
  const w = $('Write Jobs').all();
  appendItems = w.length;
  for (const it of w) {
    const j = (it && it.json) || {};
    if (j.error !== undefined && j.error !== null) {
      appendErrors += 1;
      if (!appendFirstError) appendFirstError = String(typeof j.error === 'string' ? j.error : (j.error && j.error.message) || JSON.stringify(j.error)).slice(0, 300);
    }
  }
} catch (e) {
  // Skipped entirely on a run with nothing to write. That is the normal quiet day, not a fault.
  appendItems = null;
}

// --- 2. sources: off, idle, degraded, down ------------------------------------
let plannedDisabled = [];
let disabledFrom = 'Plan Queries';
try {
  const pq = $('Plan Queries').first().json;
  plannedDisabled = ((pq.run && pq.run.plan && pq.run.plan.disabled_sources) || []).map((d) => d.source);
} catch (e) {
  plannedDisabled = (filterR && filterR.disabled_sources) || [];
  disabledFrom = 'the Filter stage report (Plan Queries was unreachable: ' + e.message.slice(0, 80) + ')';
}
const disabledSet = {};
for (const s of plannedDisabled) disabledSet[s] = true;

// Cross-check: the synthesised disabled reports must agree with the plan. A disagreement means one
// of the two lists moved, and the consequence is that a switched-off source reads as a dead one.
const synthesisedDisabled = sourceReports.filter((r) => r.verdict === 'disabled').map((r) => r.source).sort();
const plannedSorted = plannedDisabled.slice().sort();
const disabledAgree = JSON.stringify(synthesisedDisabled) === JSON.stringify(plannedSorted);

const perSource = {};
const down = [];
const degraded = [];
const idle = [];
for (const r of sourceReports) {
  const key = String(r.source || 'unknown');
  perSource[key] = { verdict: r.verdict, rows: r.rows_emitted === undefined ? null : r.rows_emitted, calls: r.calls_made === undefined ? null : r.calls_made, status_token: r.status_token || null };
  if (disabledSet[key] || r.verdict === 'disabled') { perSource[key].verdict = 'disabled'; continue; }
  if (r.verdict === 'down') down.push(key);
  else if (r.verdict === 'degraded') degraded.push(key);
  else if (r.verdict === 'idle') idle.push(key);
}
down.sort();
degraded.sort();

// Truncation. Both page guards set paging.truncated; the LinkedIn one puts it on the source report
// and the board one puts it on the shared stage block, so both places are read.
const truncatedSources = [];
for (const r of sourceReports) {
  const p = r.paging || (r.stage && r.stage.paging) || null;
  if (p && p.truncated === true && truncatedSources.indexOf(String(r.source)) === -1) truncatedSources.push(String(r.source));
}
truncatedSources.sort();

// --- 3. the counts ------------------------------------------------------------
const searched = filterR && filterR.counts ? Number(filterR.counts.jobs_in) : null;
const filtered = filterR && filterR.counts ? Number(filterR.counts.kept) : null;
const rowsOut = removeKnownR ? Number(removeKnownR.rows_out) : null;
const scored = scoreR && scoreR.counts ? Number(scoreR.counts.scored) : 0;
const heldBack = scoreR && scoreR.for_stage_f ? Number(scoreR.for_stage_f.rows_held_back) : 0;
const capBit = !!(removeKnownR && removeKnownR.cap && removeKnownR.cap.bit);
const cappedRows = removeKnownR && removeKnownR.cap ? Number(removeKnownR.cap.dropped_by_cap) || 0 : 0;

// THE EFFECTIVE CAP AND WHY IT IS WHAT IT IS (2026-09-12). Since Remove Known couples the row cap to
// what the LinkedIn detail budget can describe, the number of rows a run keeps can be BELOW
// max_scored_per_run for a reason that is nowhere on the row unless it is put there. Shaheen must
// never see a smaller number with no reason attached, so the cap, the ceiling, the binding limit and
// the count deferred for want of a description all go in the note, not just in a report nobody opens.
const rkCap = (removeKnownR && removeKnownR.cap) || null;
const capMax = rkCap && isFinite(Number(rkCap.max_scored_per_run)) ? Number(rkCap.max_scored_per_run) : null;
const capEffective = rkCap && isFinite(Number(rkCap.effective_cap)) ? Number(rkCap.effective_cap) : null;
const capFrom = rkCap && rkCap.effective_cap_from ? String(rkCap.effective_cap_from) : null;
const capCut = capMax !== null && capEffective !== null && capEffective < capMax;
const deferredNoDescription = rkCap && isFinite(Number(rkCap.dropped_for_no_description)) ? Number(rkCap.dropped_for_no_description) : 0;
// The other half of the same trade, from the other end of the run: pages the guard did not ask for
// because the run already held more supply than it could keep. Unlike a capped row these are NOT
// deferred, so the count belongs on the row next to the one that is.
let pagesSkippedOnDemand = 0;
for (const r of sourceReports) {
  const p = r.paging || (r.stage && r.stage.paging) || null;
  if (p && p.demand && isFinite(Number(p.demand.pages_not_followed_on_demand))) {
    pagesSkippedOnDemand += Number(p.demand.pages_not_followed_on_demand);
  }
}
const costCapRows = budgetR && budgetR.budget ? Number(budgetR.budget.stopped_by_cost) || 0 : 0;
const countCapRows = budgetR && budgetR.budget ? Number(budgetR.budget.stopped_by_count) || 0 : 0;
const noDecisionRows = rowsR ? Number(rowsR.rows_without_a_write_decision) || 0 : 0;

// Cost. The score report is the authority (it prices off real usage); the per-row sum is an
// independent second derivation, and a check that cannot run says so rather than passing.
const costActual = scoreR && scoreR.cost && isFinite(Number(scoreR.cost.actual_usd)) ? Number(scoreR.cost.actual_usd) : 0;
let costFromRows = null;
try {
  costFromRows = Math.round($('Parse Score').all()
    .map((i) => i.json)
    .filter((j) => j && j._kind === 'job' && isFinite(Number(j.cost_usd)))
    .reduce((a, j) => a + Number(j.cost_usd), 0) * 1e6) / 1e6;
} catch (e) { costFromRows = null; }
const costAgrees = costFromRows === null ? null : Math.abs(costFromRows - costActual) < 1e-6;

// --- 4. the verdict -----------------------------------------------------------
const tokens = [];
if (down.length) for (const s of down) tokens.push('source_down:' + s);
if (scoreR && scoreR.verdict === 'down') tokens.push('scoring_down');
if (capBit || costCapRows > 0 || countCapRows > 0) tokens.push('budget_hit');
if (degraded.length) for (const s of degraded) tokens.push('degraded:' + s);

let verdict;
if (down.length) verdict = 'source_down:' + down[0];
else if (scoreR && scoreR.verdict === 'down') verdict = 'scoring_down';
else if (capBit || costCapRows > 0 || countCapRows > 0) verdict = 'budget_hit';
else if (degraded.length) verdict = 'degraded:' + degraded[0];
else if (rowsWritten === 0 && heldBack === 0 && noDecisionRows === 0) verdict = 'no_new_jobs';
else verdict = 'ok';
if (!tokens.length) tokens.push(verdict);

// A write that did not land outranks every one of them, because nothing else in the row is true if
// the rows are not in the sheet.
if (!writeConfirmed && intendedRows.length > 0) {
  tokens.unshift('write_failed');
  verdict = 'write_failed';
}

// --- 5. may the window move? --------------------------------------------------
const scoreSafe = !!(scoreR && scoreR.for_stage_f && scoreR.for_stage_f.advance_last_run_at_safe === true);
const noUnclean = down.length === 0 && degraded.length === 0;
const noTruncation = truncatedSources.length === 0;
const writeOk = intendedRows.length === 0 ? readBack.ok : writeConfirmed;
const realTab = !WRITE_IS_TEST_TAB;
const noStrays = noDecisionRows === 0;
const haveStamp = !!runStartedAt;
const haveRow = readBack.last_run_row !== null;

const advanceChecks = [
  { name: 'the scoring stage says it is safe', pass: scoreSafe, why: scoreR && scoreR.for_stage_f ? String(scoreR.for_stage_f.advance_last_run_at_why || '') : 'the score stage report did not reach this node' },
  { name: 'no source reported down or degraded', pass: noUnclean, why: noUnclean ? 'every source that ran delivered, and the rest were switched off or idle' : 'down: [' + down.join(', ') + '] degraded: [' + degraded.join(', ') + ']. A degraded source has not covered its window and the next run has to re-cover it, which is what this lane has instead of a retry.' },
  { name: 'no source was truncated', pass: noTruncation, why: noTruncation ? 'every full page that came back was followed' : 'truncated: [' + truncatedSources.join(', ') + ']. A run that stopped following full pages has not covered its window whatever it collected.' },
  { name: 'the jobs write is verified in the sheet', pass: writeOk, why: writeOk ? (intendedRows.length ? readBack.ids_found + ' of ' + intendedRows.length + ' id(s) read back out of ' + WRITE_TAB : 'nothing was written and the read-back is clean') : (readBack.why || 'the read-back could not confirm the rows') },
  { name: 'every job row had a write decision', pass: noStrays, why: noStrays ? 'Parse Score stamped write_to_sheet on all of them' : noDecisionRows + ' row(s) arrived with no write_to_sheet and were written nowhere' },
  { name: 'the write went to the real jobs tab', pass: realTab, why: realTab ? 'sheet.jobs_write_tab is not set, so the write went to ' + REAL_TAB : 'this run wrote to ' + WRITE_TAB + ', a TEST tab. Moving the window past rows that exist only there would lose them permanently the moment the write is repointed, and every run in between would look green.' },
  { name: 'the run start timestamp is known', pass: haveStamp, why: haveStamp ? runStartedAt : 'no stage report carried run_started_at, and the window can only move to a time this run actually knows' },
  { name: 'the last_run_at row was located in the settings tab', pass: haveRow, why: haveRow ? 'settings row ' + readBack.last_run_row : 'no row in the settings tab has the key last_run_at. Refusing to invent one: the only value available means re-collect 168 hours.' },
];
const advance = advanceChecks.every((c) => c.pass);
const blockedBy = advanceChecks.filter((c) => !c.pass).map((c) => c.name);

// --- 6. the one-cell write, or a real no-op -----------------------------------
// A batchUpdate with an empty data array is a legal call that changes nothing, so the write node
// always has exactly one item and always runs, and the decision stays in code.
const lastRunBody = advance
  ? { valueInputOption: 'RAW', data: [{ range: A1(SETTINGS_TAB, 'B' + readBack.last_run_row), majorDimension: 'ROWS', values: [[runStartedAt]] }] }
  : { valueInputOption: 'RAW', data: [] };

// --- 7. the note --------------------------------------------------------------
const noteParts = [];
noteParts.push(tokens.join(' '));
noteParts.push('wrote ' + rowsWritten + '/' + intendedRows.length + ' to ' + WRITE_TAB + (WRITE_IS_TEST_TAB ? ' (TEST TAB)' : '') + (writeConfirmed ? ' verified' : (intendedRows.length ? ' UNVERIFIED' : '')));
if (rowsOut !== null) noteParts.push('survived ' + rowsOut);
if (heldBack) noteParts.push('held ' + heldBack);
if (cappedRows) noteParts.push('cap dropped ' + cappedRows);
if (capCut) noteParts.push('cap ' + capEffective + '/' + capMax + ' (' + capFrom + ')');
if (deferredNoDescription) noteParts.push('deferred for no description ' + deferredNoDescription);
if (pagesSkippedOnDemand) noteParts.push('pages skipped on demand ' + pagesSkippedOnDemand);
if (costCapRows) noteParts.push('cost cap ' + costCapRows);
if (noDecisionRows) noteParts.push('no write decision ' + noDecisionRows);
noteParts.push('scored ' + scored + '/' + (scoreR && scoreR.counts ? scoreR.counts.admitted : 0));
const srcBits = Object.keys(perSource).sort().map((k) => k + '=' + perSource[k].verdict);
if (srcBits.length) noteParts.push(srcBits.join(' '));
if (truncatedSources.length) noteParts.push('truncated ' + truncatedSources.join(','));
noteParts.push('last_run_at ' + (advance ? 'ADVANCED to ' + runStartedAt : 'HELD (' + blockedBy.join('; ') + ')'));
let note = noteParts.join(' | ').replace(/[\\u0000-\\u001F\\u007F]/g, ' ').replace(/\\s+/g, ' ').trim();
while (note.length && '=+-@'.indexOf(note[0]) !== -1) note = note.slice(1).trim();
if (note.length > NOTE_MAX) note = note.slice(0, NOTE_MAX - 1) + '\\u2026';

// --- 8. the run ledger row ----------------------------------------------------
const runRow = {
  date: runStartedAt || new Date().toISOString(),
  exec_id: execId === null ? '' : execId,
  searched: searched === null ? '' : searched,
  filtered: filtered === null ? '' : filtered,
  new: rowsWritten,
  scored: scored,
  verdict: verdict,
  note: note,
  cost_usd: costActual,
};

// --- 9. HQ ---------------------------------------------------------------------
// GREEN only when the run is genuinely clean. #34's Close-Out Extra (b) says a source that failed
// silently is AMBER; Agent 5's handoff says a run that collected 200 jobs and scored none must never
// be GREEN. Both are satisfied by tying the colour to the verdict rather than to the row count.
let hqStatus = 'green';
if (verdict === 'write_failed' || verdict.indexOf('source_down:') === 0 || verdict === 'scoring_down' || missingReports.length) hqStatus = 'red';
else if (verdict === 'budget_hit' || verdict.indexOf('degraded:') === 0 || !advance || !disabledAgree || costAgrees === false) hqStatus = 'amber';

const headline = (verdict + ': ' + rowsWritten + ' new, ' + scored + ' scored' + (advance ? '' : ', window held')).slice(0, 120);
const hq = {
  events: [
    { project: HQ_SLUG, metric_key: 'run_status', value_num: hqStatus === 'green' ? 1 : 0, value_text: verdict, headline: headline, status: hqStatus },
    { project: HQ_SLUG, metric_key: 'searched', value_num: searched === null ? null : searched, headline: 'postings collected this run', status: hqStatus },
    { project: HQ_SLUG, metric_key: 'new', value_num: rowsWritten, value_text: WRITE_IS_TEST_TAB ? 'written to a TEST tab' : '', headline: 'new rows written to the jobs tab', status: hqStatus },
    { project: HQ_SLUG, metric_key: 'scored', value_num: scored, headline: 'rows the scorer returned a number for', status: hqStatus },
    { project: HQ_SLUG, metric_key: 'cost_usd', value_num: costActual, headline: 'Anthropic spend this run', status: hqStatus },
  ],
};

// --- 10. the stage report -------------------------------------------------------
const warnings = [];
if (missingReports.length) {
  warnings.push(
    'THE RUN VERDICT WAS BUILT WITH ' + missingReports.length + ' STAGE REPORT(S) MISSING: ' + missingReports.join(', ') + '. ' +
    'Every one of them is emitted unconditionally by its own node, so an absent one means that node did not run and the ' +
    'counts below are partial. This is RED, not a caveat.'
  );
}
if (!writeConfirmed && intendedRows.length > 0) {
  warnings.push('THE JOBS WRITE IS NOT CONFIRMED. ' + (readBack.why || 'unknown') + (appendFirstError ? ' The append node also reported: ' + appendFirstError : '') + ' The window is held, so nothing is lost: the next run covers the same window.');
}
if (appendErrors > 0) warnings.push(appendErrors + ' error item(s) came back from the append itself. First: ' + appendFirstError);
if (!disabledAgree) {
  warnings.push(
    'THE TWO DISABLED-SOURCE LISTS DISAGREE. Plan Queries says [' + plannedSorted.join(', ') + '] and the synthesised reports say [' + synthesisedDisabled.join(', ') + ']. ' +
    'They exist to tell a switched-off source apart from one that ran and found nothing, so a disagreement means one of those two readings is wrong on this run.'
  );
}
if (costAgrees === false) {
  warnings.push('the run cost from the score report (' + costActual + ') and the sum of the per-row costs (' + costFromRows + ') disagree. Two independent derivations of the same number, so one of them is wrong.');
}
if (costFromRows === null) warnings.push('the per-row cost cross-check could not run: Parse Score was unreachable from here. The reported cost is the score report\\'s figure alone.');
if (WRITE_IS_TEST_TAB) {
  warnings.push(
    'THIS RUN WROTE TO ' + WRITE_TAB + ', NOT ' + REAL_TAB + ', so last_run_at is held whatever else happened. Repoint by deleting ' +
    'sheet.jobs_write_tab from config/lane.json and running build.js --rebuild. Until then the real jobs tab is untouched and Remove ' +
    'Known has nothing to dedupe against, so a second test run writes the same rows again.'
  );
}
if (capCut) {
  warnings.push(
    'THIS RUN KEPT AT MOST ' + capEffective + ' ROW(S), NOT THE ' + capMax + ' IN max_scored_per_run, and the binding limit was ' +
    capFrom + '. The row cap is the lesser of that ceiling and what the LinkedIn detail budget can describe, because a row ' +
    'kept with no description is scored on its title once and never enriched, while a row held back is collected properly ' +
    'next run. ' + (deferredNoDescription ? deferredNoDescription + ' row(s) were deferred for exactly that reason and the window is held, so none of them is lost. ' : '') +
    'Full arithmetic is in the remove_known report under cap.coupling.'
  );
}
if (pagesSkippedOnDemand) {
  warnings.push(
    pagesSkippedOnDemand + ' full LinkedIn page(s) were NOT asked for because the run already held more unique postings than ' +
    'it could keep and describe. Unlike a capped row these are not deferred: nothing comes back for them once the window ' +
    'advances. That is the price of spending the shared LinkedIn budget on descriptions instead of on volume, and it is ' +
    'here so it can be argued with rather than discovered. Lower linkedin_page_demand_multiple to page more.'
  );
}
if (idle.length) warnings.push('idle source(s): ' + idle.join(', ') + '. Nothing was asked of them this run, which is not the same as finding nothing and not the same as being switched off.');
if (verdict === 'no_new_jobs') warnings.push('no new rows and nothing wrong anywhere: a genuinely quiet run. Every source that ran delivered, nothing was held back, and the window advanced.');

const report = {
  _kind: 'stage_report',
  stage: 'output',
  lane: LANE_NUMBER,
  verdict: verdict,
  status_tokens: tokens,
  verdict_precedence: VERDICT_PRECEDENCE,
  verdict_rule: 'derived from the reports, never from row counts. One column has to choose, so the highest precedence token is the verdict and every applicable token is in status_tokens and in the note.',
  run_started_at: runStartedAt,
  exec_id: execId,
  write_target: { tab: WRITE_TAB, real_tab: REAL_TAB, is_test_tab: WRITE_IS_TEST_TAB },
  read_back: readBack,
  append: { items: appendItems, error_items: appendErrors, first_error: appendFirstError, note: 'the append response is the request talking about itself. The read_back block is the authority on what the sheet holds.' },
  counts: {
    searched: searched,
    filtered: filtered,
    survived_dedupe_and_cap: rowsOut,
    intended_to_write: intendedRows.length,
    written_and_verified: rowsWritten,
    held_back_by_scoring: heldBack,
    dropped_by_row_cap: cappedRows,
    row_cap: capEffective,
    row_cap_ceiling: capMax,
    row_cap_from: capFrom,
    row_cap_was_cut: capCut,
    deferred_for_no_description: deferredNoDescription,
    pages_not_followed_on_demand: pagesSkippedOnDemand,
    unscored_by_cost_cap: costCapRows,
    unscored_by_count_cap: countCapRows,
    without_a_write_decision: noDecisionRows,
    scored: scored,
    admitted_to_scorer: scoreR && scoreR.counts ? scoreR.counts.admitted : null,
  },
  sources: {
    per_source: perSource,
    down: down,
    degraded: degraded,
    idle: idle,
    disabled: plannedSorted,
    disabled_read_from: disabledFrom,
    disabled_lists_agree: disabledAgree,
    rule: 'a source in the disabled list was switched off and cost zero calls. It is NEVER down and never degraded, and that distinction is the reason several stages emit a report at all.',
  },
  truncated_sources: truncatedSources,
  cost: { actual_usd: costActual, from_per_row_sum: costFromRows, agrees: costAgrees, estimated_usd: budgetR && budgetR.cost_estimate ? budgetR.cost_estimate.est_total_usd : null, cap_usd: budgetR && budgetR.budget ? budgetR.budget.max_cost_per_run_usd : null },
  advance: {
    decision: advance,
    blocked_by: blockedBy,
    checks: advanceChecks,
    new_value: advance ? runStartedAt : null,
    current_value: readBack.last_run_current,
    settings_row: readBack.last_run_row,
    rule: 'an AND of every check above. The window moves only on a run that genuinely covered it, because a window that moves past work nobody did loses that work forever and every run still looks green.',
    value_rule: 'the value is the run START time, which is window_end by Plan Queries\\' own definition, so a job posted while the run was in flight lands in the next window rather than between two.',
  },
  detail: detailGateR ? { admitted: detailGateR.admitted_for_fetch, verdict: detailGateR.verdict } : null,
  hq: { project: HQ_SLUG, slug_declared_in_manifest: HQ_SLUG_DECLARED, status: hqStatus, events: hq.events.length },
  run_row: runRow,
  warnings: warnings,
};

// ONE item. Everything downstream of this node writes once per input item, so a second item would
// be a second ledger row and a second HQ push.
return [{
  json: Object.assign({}, runRow, {
    _kind: 'run_row',
    _report: report,
    _advance: advance,
    _last_run_body: lastRunBody,
    _last_run_expected: advance ? runStartedAt : readBack.last_run_current,
    _last_run_row: readBack.last_run_row,
    _hq: hq,
    _hq_status: hqStatus,
  }),
  pairedItem: { item: 0 },
}];
`;

const jsCode = [
  '// GENERATED at build time from work/34-job-search-bi/nodes/43-build-run-row.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  `const ROW_SHAPE = ${JSON.stringify(CONTRACT.shared_row_shape)};`,
  `const RUNS_COLUMNS = ${JSON.stringify(O.RUNS_COLUMNS)};`,
  `const VERDICT_PRECEDENCE = ${JSON.stringify(O.VERDICT_PRECEDENCE)};`,
  `const WRITE_TAB = ${JSON.stringify(WRITE.tab)};`,
  `const REAL_TAB = ${JSON.stringify(WRITE.real_tab)};`,
  `const WRITE_IS_TEST_TAB = ${JSON.stringify(WRITE.is_test_tab)};`,
  `const SETTINGS_TAB = ${JSON.stringify(L.sheet.settings_tab)};`,
  `const HQ_SLUG = ${JSON.stringify(HQ.slug)};`,
  `const HQ_SLUG_DECLARED = ${JSON.stringify(HQ.declared)};`,
  `const NOTE_MAX = ${JSON.stringify(NOTE_MAX)};`,
  `const LANE_NUMBER = ${JSON.stringify(String(L.lane))};`,
  // The A1 quoting rule, one copy, shared with _output.js's build-time version by construction.
  'function A1(tab, ref) { var safe = /^[A-Za-z0-9_]+$/.test(tab) ? tab : "\'" + String(tab).split("\'").join("\'\'") + "\'"; return safe + "!" + ref; }',
  LOGIC,
].join('\n');

module.exports = {
  name: 'Build Run Row',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [6370, 780],
  connectFrom: 'Read Back Jobs',
  notes: 'Verifies the jobs write against a fresh read of the sheet, derives the run verdict from the reports rather than from row counts, decides whether last_run_at may move (an AND of eight checks including a test tab and a truncated source), and builds the nine cell ledger row, the addressed one cell last_run_at write and the HQ payload. Emits exactly one item.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};
