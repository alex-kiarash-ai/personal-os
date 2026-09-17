'use strict';
/*
 * 72-build-run-report.js - "Build Run Report". One item: what this morning actually did, what it
 * cost, and what colour the dashboard should be.
 *
 * =============================================================================================
 * 1. ONE ITEM, AND THAT IS A WIRING FACT RATHER THAN A STYLE CHOICE.
 * =============================================================================================
 * The next node is an HTTP Request, and an HTTP Request node fires once per INPUT item. Emitting
 * every pair and every stage report here would push the heartbeat once per pair, which is a
 * duplicate metric row per application for a metric that is a COUNT. So this node folds the whole
 * run into a single item, the same shape #34 uses for its own run row.
 *
 * Nothing is lost by it. Every pair, every lane report and every stage report is still in the
 * execution data of the node that produced it, and Assert Run reaches the two that matter by name.
 *
 * =============================================================================================
 * 2. THE COLOUR RULES, WRITTEN DOWN, BECAUSE A RED THAT IS ALWAYS ON IS A RED NOBODY READS.
 * =============================================================================================
 *   RED     a sheet write could not be verified, or a pair has documents in Drive that could not be
 *           read back, or a lane was refused outright. All three mean the run cannot account for
 *           what it did.
 *   AMBER   something failed that is not a write integrity problem: a reader that timed out, a
 *           render that died, a lane whose spreadsheet could not be written to.
 *   GREEN   everything else, INCLUDING a morning that shipped nothing at all. Both lanes capped out,
 *           every qualifier already written, every letter held by the blind grade: those are the
 *           system working, and colouring them amber would make amber the normal state of the tile.
 *
 * A HOLD IS NOT AMBER. D16 sends a letter that fails the blind grade to needs_review on purpose, and
 * a morning where one of three letters is held is a morning where the gate did its job. It is in the
 * counts and in the headline, where he can see it, and it does not change the colour.
 *
 * =============================================================================================
 * 3. THE COST IS REPORTED PER PAIR AND IN TOTAL, AND IT IS THE REAL NUMBER, NOT THE ESTIMATE.
 * =============================================================================================
 * Build Candidates refused work up front on a PESSIMISTIC estimate that prices every call at full
 * input price with no cache credit, so the guard can only ever refuse too early. This is the other
 * end: every parse node appended its actual usage to the pair, so the figure here is what the
 * account was actually billed, per application and for the morning. The two are reported side by
 * side because the gap between them is the only way to see whether the guard is too tight.
 */

const W = require('./_write');

const NODE_NAME = 'Build Run Report';
const WARNINGS_PER_STAGE = 6;
const HEADLINE_MAX = 220;

(function assertAgainstUpstream() {
  const check = require('./71-check-sheet-writes.js');
  if (check.name !== 'Check Sheet Writes') {
    throw new Error(NODE_NAME + ': node 71 is named ' + JSON.stringify(check.name) + ' and this node connects from it.');
  }
  const csrc = String(check.parameters.jsCode || '');
  for (const [needle, what] of [
    ['verified: verified,', 'the single boolean that decides whether this run can account for its writes'],
    ['j._sheet_row_verified = rowVerified;', 'the per pair flag Assert Run fails the execution on'],
  ]) {
    if (csrc.indexOf(needle) === -1) {
      throw new Error(NODE_NAME + ': Check Sheet Writes no longer emits ' + JSON.stringify(needle) + ', which is ' + what + '.');
    }
  }
  const up = require('./65-check-uploads.js');
  if (String(up.parameters.jsCode || '').indexOf('all_verified: true,') === -1) {
    throw new Error(NODE_NAME + ': Check Uploads no longer stamps all_verified on a pair whose four files were downloaded again and matched, and this node counts on that to tell a verified application from an optimistic one.');
  }
  // The HQ contract. Every event needs a project and a metric_key or the ingest workflow throws on
  // the WHOLE batch, so one malformed event would lose all five.
  const hq = W.hqProject();
  if (!hq.slug) {
    throw new Error(NODE_NAME + ': no HQ project slug could be resolved. It is read out of system/manifest.json and falls back to the lane file name, so an empty one means both are missing.');
  }
}());

const HQ = W.hqProject();

const LOGIC = `
// ---------------------------------------------------------------------------
// Build Run Report. One item: the morning, its cost, and the dashboard colour.
// ---------------------------------------------------------------------------
function txt(v) { return String(v === null || v === undefined ? '' : v); }
function cut(s, n) { const t = txt(s); return t.length > n ? t.slice(0, n - 3) + '...' : t; }
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function round6(n) { return Math.round(n * 1e6) / 1e6; }

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

const inputItems = $input.all();
if (!inputItems.length) {
  throw new Error('Build Run Report: Check Sheet Writes delivered no items at all. It emits at least its own stage report on every path, so an empty input means that node did not run.');
}

// --- 1. sort the stream --------------------------------------------------------
const pairs = [];
const laneReports = [];
const stageReports = [];
for (const it of inputItems) {
  const j = (it && it.json) || {};
  if (j._kind === 'pair') pairs.push(j);
  else if (j._kind === 'lane_report') laneReports.push(j);
  else if (j._kind === 'stage_report') stageReports.push(j);
}

let sheetCheck = null;
for (const s of stageReports) if (s.stage === 'check_sheet_writes') sheetCheck = s;
let uploadCheck = null;
for (const s of stageReports) if (s.stage === 'check_uploads') uploadCheck = s;

// --- 2. counts by outcome ------------------------------------------------------
const outcomes = { ship: 0, hold: 0, blocked: 0, capped: 0, error: 0 };
const byStatus = {};
const byLane = {};
const costPerPair = [];
let costTotal = 0;
let uploadsVerified = 0;
let rowsVerified = 0;

for (const p of pairs) {
  const o = outcomeOf(p);
  if (outcomes[o] !== undefined) outcomes[o] += 1;
  const st = txt(p._status) || 'shipped';
  byStatus[st] = (byStatus[st] || 0) + 1;

  const key = txt(p.lane_key) || 'unknown';
  if (!byLane[key]) byLane[key] = { lane: key, source_project: p.source_project === undefined ? null : p.source_project, label: txt(p.label), ship: 0, hold: 0, blocked: 0, capped: 0, error: 0, cost_usd: 0, attempted: null };
  if (byLane[key][o] !== undefined) byLane[key][o] += 1;

  const usd = num(p._cost && p._cost.usd);
  costTotal += usd;
  byLane[key].cost_usd = round6(byLane[key].cost_usd + usd);
  const calls = (p._cost && Array.isArray(p._cost.calls)) ? p._cost.calls : [];
  costPerPair.push({
    pair_id: txt(p.pair_id) || txt(p.lane_key) + ':' + txt(p.job_id),
    lane: key,
    job_id: txt(p.job_id),
    company: cut(p.company, 80),
    outcome: o,
    status: txt(p._status) || null,
    usd: round6(usd),
    calls: calls.map((c) => ({ stage: txt(c && c.stage), model: txt(c && c.model) })),
  });

  if (o === 'ship') {
    if (p._uploads && p._uploads.all_verified === true) uploadsVerified += 1;
    if (p._sheet_row_verified === true) rowsVerified += 1;
  }
}
costTotal = round6(costTotal);

for (const lr of laneReports) {
  const key = txt(lr.lane_key);
  if (!byLane[key]) byLane[key] = { lane: key, source_project: lr.source_project === undefined ? null : lr.source_project, label: txt(lr.label), ship: 0, hold: 0, blocked: 0, capped: 0, error: 0, cost_usd: 0, attempted: null };
  byLane[key].state = txt(lr.state);
  byLane[key].why = cut(lr.why, 300);
  if (lr.admitted !== undefined) byLane[key].attempted = num(lr.admitted);
  if (lr.daily_cap !== undefined) byLane[key].daily_cap = num(lr.daily_cap);
  if (lr.attempted_today !== undefined) byLane[key].attempted_before_this_run = num(lr.attempted_today);
  if (lr.cost_estimate_usd !== undefined) byLane[key].cost_estimate_usd = num(lr.cost_estimate_usd);
}

// --- 3. the colour. See note 2 ---------------------------------------------------
const redReasons = [];
const amberReasons = [];

const writesVerified = sheetCheck ? sheetCheck.verified === true : false;
if (!sheetCheck) {
  redReasons.push('no sheet write check ran at all, so nothing this run wrote to a spreadsheet can be accounted for.');
} else if (!writesVerified) {
  const first = Array.isArray(sheetCheck.problems) && sheetCheck.problems.length ? cut(sheetCheck.problems[0], 240) : 'no reason recorded';
  redReasons.push('a spreadsheet write could not be verified: ' + first);
}

const driveFailures = pairs.filter((p) => txt(p._status) === 'error:drive');
if (driveFailures.length) {
  redReasons.push(driveFailures.length + ' application(s) have a Drive folder that could not be proved. The folders are left in place, nothing was written to either sheet, and their job rows stay at new.');
}
const shippedUnrowed = outcomes.ship - rowsVerified;
if (shippedUnrowed > 0) {
  redReasons.push(shippedUnrowed + ' shipped application(s) have documents in Drive and no verified row in the applications tab, which is the one outcome that is invisible from the sheet he actually reads.');
}
const refusedLanes = laneReports.filter((lr) => txt(lr.state).indexOf('error:') === 0);
if (refusedLanes.length) {
  redReasons.push(refusedLanes.length + ' lane(s) were refused outright (' + refusedLanes.map((l) => txt(l.lane_key) + ' ' + txt(l.state)).join(', ') + '), so nothing was read and nothing was written for them.');
}

const otherErrors = pairs.filter((p) => outcomeOf(p) === 'error' && txt(p._status) !== 'error:drive');
if (otherErrors.length) {
  const kinds = {};
  for (const p of otherErrors) kinds[txt(p._status)] = (kinds[txt(p._status)] || 0) + 1;
  amberReasons.push(otherErrors.length + ' pair(s) failed on the way through: ' + JSON.stringify(kinds) + '. Their job rows are left at new, so tomorrow offers them again.');
}
const unwritableLanes = (sheetCheck && Array.isArray(sheetCheck.lanes)) ? sheetCheck.lanes.filter((l) => l.writable === false) : [];
if (unwritableLanes.length) {
  amberReasons.push(unwritableLanes.length + ' lane(s) could not be written to at all, so their job rows are untouched and the next run covers them.');
}

let colour = 'green';
if (redReasons.length) colour = 'red';
else if (amberReasons.length) colour = 'amber';

// --- 4. the headline -------------------------------------------------------------
const headlineParts = [];
headlineParts.push(outcomes.ship + ' shipped');
if (outcomes.hold) headlineParts.push(outcomes.hold + ' held');
if (outcomes.blocked) headlineParts.push(outcomes.blocked + ' blocked');
if (outcomes.capped) headlineParts.push(outcomes.capped + ' capped');
if (outcomes.error) headlineParts.push(outcomes.error + ' error(s)');
headlineParts.push('$' + costTotal.toFixed(4));
if (colour === 'red') headlineParts.push('UNVERIFIED: ' + cut(redReasons[0], 120));
else if (colour === 'amber') headlineParts.push(cut(amberReasons[0], 120));
else if (!outcomes.ship) headlineParts.push('a quiet morning, which is the system working rather than a fault');
const headline = cut(headlineParts.join(', '), HEADLINE_MAX);

// --- 5. the stages, compact ------------------------------------------------------
const stages = stageReports.map((s) => ({
  stage: txt(s.stage),
  counts: s.counts === undefined ? null : s.counts,
  warnings: Array.isArray(s.warnings) ? s.warnings.slice(0, WARNINGS_PER_STAGE).map((w) => cut(w, 300)) : [],
  warnings_total: Array.isArray(s.warnings) ? s.warnings.length : 0,
}));

// --- 6. the HQ body. Five events, one call, built here and sent by the next node --
const ts = new Date().toISOString();
function event(metric, valueNum, valueText, status) {
  const e = { project: HQ_SLUG, metric_key: metric, ts: ts };
  if (valueNum !== null && valueNum !== undefined) e.value_num = valueNum;
  if (valueText !== null && valueText !== undefined) e.value_text = valueText;
  if (status) e.status = status;
  return e;
}
const hq = {
  events: [
    Object.assign(event('run_status', null, colour === 'green' ? 'ok' : (colour === 'amber' ? 'degraded' : 'unverified'), colour), { headline: headline }),
    event('shipped', outcomes.ship, null, null),
    event('held', outcomes.hold, null, null),
    event('errors', outcomes.error, null, null),
    event('cost_usd', costTotal, null, null),
  ],
};

const report = {
  _kind: 'run_report',
  lane: WORKFLOW_LANE,
  run: {
    date: txt(laneReports.length ? laneReports[0].run_date : (pairs.length ? pairs[0].run_date : '')),
    run_started_at: txt(laneReports.length ? laneReports[0].run_started_at : (pairs.length ? pairs[0].run_started_at : '')),
    exec_id: txt(laneReports.length ? laneReports[0].exec_id : (pairs.length ? pairs[0].exec_id : '')),
    finished_at: ts,
  },
  outcomes: outcomes,
  by_status: byStatus,
  lanes: Object.keys(byLane).map((k) => byLane[k]),
  cost: {
    total_usd: costTotal,
    per_pair: costPerPair,
    note: 'this is what the account was actually billed, taken from the usage every parse node appended to its pair. The per lane cost_estimate_usd next to it is the PESSIMISTIC figure the intake guard refused work on, which prices every call at full input price with no cache credit. The gap between the two is the only way to see whether the guard is too tight.',
  },
  uploads: {
    shipped: outcomes.ship,
    verified: uploadsVerified,
    check: uploadCheck ? { counts: uploadCheck.counts, failures_by_check: uploadCheck.failures_by_check, batch: uploadCheck.batch } : null,
  },
  writes: {
    verified: writesVerified,
    rows_verified: rowsVerified,
    cells_checked: sheetCheck ? sheetCheck.cells_checked : null,
    problems: sheetCheck && Array.isArray(sheetCheck.problems) ? sheetCheck.problems.slice(0, 20) : [],
    lanes: sheetCheck && Array.isArray(sheetCheck.lanes) ? sheetCheck.lanes : [],
  },
  stages: stages,
  status: colour,
  headline: headline,
  red_reasons: redReasons,
  amber_reasons: amberReasons,
  colour_rule: 'RED when the run cannot account for what it did: an unverified sheet write, a Drive folder that could not be proved, a shipped application with no row, or a refused lane. AMBER when something failed that is not a write integrity problem. GREEN otherwise, including a morning that shipped nothing, because both lanes capping out or every letter being held by the blind grade is the system working. A HOLD is never amber: D16 holds a letter that fails the blind grade on purpose.',
  _hq: hq,
  _hq_slug_declared: HQ_DECLARED,
  _hq_slug_note: HQ_NOTE,
  needs_convert: false,
  _call_now: false,
  site_fetch_url: '',
  ad_fetch_url: '',
};

return [{ json: report, pairedItem: { item: 0 } }];
`;

function renderJsCode() {
  return [
    '// GENERATED at build time from work/36-job-application-writer/nodes/72-build-run-report.js.',
    '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
    'const WORKFLOW_LANE = ' + JSON.stringify(String(require('./_lane').lane().lane)) + ';',
    'const HQ_SLUG = ' + JSON.stringify(HQ.slug) + ';',
    'const HQ_DECLARED = ' + JSON.stringify(HQ.declared) + ';',
    'const HQ_NOTE = ' + JSON.stringify(HQ.declared
      ? 'the slug is declared in system/manifest.json for this project.'
      : 'the registry has no row for this project yet, so the slug FALLS BACK to the lane file name. That is orchestrator carry-over 1 and not a fault of this run: the manifest row cannot be added until the workflow id exists and the project CLAUDE.md is written. Recorded here so a fallback is never mistaken for a declaration. Reason: ' + String(HQ.why || 'not stated')) + ';',
    'const WARNINGS_PER_STAGE = ' + JSON.stringify(WARNINGS_PER_STAGE) + ';',
    'const HEADLINE_MAX = ' + JSON.stringify(HEADLINE_MAX) + ';',
    LOGIC,
  ].join('\n');
}

W.assertGeneratedSourceIsClean(renderJsCode(), NODE_NAME);

module.exports = {
  name: NODE_NAME,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [18200, 100],
  connectFrom: 'Check Sheet Writes',
  notes: 'Folds the whole morning into ONE item: counts by outcome, the real cost per pair and in total next to the pessimistic estimate the intake guard refused work on, every stage report in compact form, and the HQ body. One item is a wiring fact rather than a style choice: the next node is an HTTP Request and would otherwise push the heartbeat once per pair, which is a duplicate metric row for a metric that is a count. RED when the run cannot account for what it did, AMBER when something else failed, GREEN otherwise including a morning that shipped nothing. A hold is never amber, because D16 holds a letter that fails the blind grade on purpose.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: renderJsCode(),
  },
};
