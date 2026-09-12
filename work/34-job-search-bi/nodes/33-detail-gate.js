'use strict';
/*
 * 33-detail-gate.js - "Detail Gate". Decides which rows get a LinkedIn detail fetch, and owns the
 * whole-run LinkedIn call budget.
 *
 * WHERE IT SITS. The file number is 33 only because 01 to 32 were taken; the numbers stopped being
 * wiring order at 23 and nodes/README.md says so. Its place in the graph is between `Remove Known`
 * (22) and `Budget Gate` (28):
 *
 *   Remove Known -> Detail Gate -> Detail Route
 *                                    [out0 true]  -> Get LinkedIn Detail -> Detail Results [in 0]
 *                                    [out1 false] -----------------------> Detail Results [in 1]
 *                                                                          Detail Results -> Attach Detail -> Budget Gate
 *
 * ---------------------------------------------------------------------------------------------
 * 1. WHY THIS STAGE EXISTS AT ALL, in one measurement.
 * ---------------------------------------------------------------------------------------------
 * Execution 5154: 0 of 200 LinkedIn rows carried a description and 748 of 748 board rows did. The
 * guest SEARCH endpoint returns cards, and a card has no description on it, so
 * `08-extract-linkedin.js` sets `excerpt: null` deliberately. Since the keep list was narrowed on
 * 2026-09-12 the six free boards contribute ZERO rows to the BI lane, so every job in that lane
 * would be scored on its title alone. `source_linkedin_guest_detail` has been switched ON in
 * both settings tabs since provisioning, Plan Queries has carried `detail_enrichment_enabled: true`
 * and the endpoint since Stage A, and no node called it. This is that node.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. THE CALL BUDGET, WHICH IS THE HARD PART, AND WHY A PER-STAGE CAP IS NOT ENOUGH.
 * ---------------------------------------------------------------------------------------------
 * The search leg and this leg hit the SAME host from the SAME IP, and LinkedIn counts the sum.
 * Measured today: the base search plan is 10 calls on the live BI sheet and 11 after the pending
 * seed sync; adaptive paging can take that to the `linkedin_max_calls_per_run` ceiling of 20; the
 * per-run row cap is 20, so a naive detail fetch adds up to 20 more. That is about 40 LinkedIn
 * calls in one run, against a documented soft threshold of roughly ten for a datacenter IP (D20)
 * and exactly ONE measured data point of 20 calls from the box with no refusal, no 429 and no 999
 * (execution 5154, verdict ok).
 *
 * So there are TWO caps here and the second one is the real one:
 *   linkedin_detail_max_calls_per_run  the per-stage cap, default 10.
 *   linkedin_total_max_calls_per_run   the WHOLE-RUN budget across search plus paging plus detail,
 *                                      default 25. The detail leg gets what the search leg did not
 *                                      spend, and never more.
 * Worst case per run on the shipped defaults is therefore 25 LinkedIn calls, which is the one
 * number anyone has measured (20) plus a deliberate margin. That number is on the card because it
 * is the number Shaheen carries the risk on.
 *
 * HOW MANY CALLS THE SEARCH LEG ACTUALLY MADE is read off the LinkedIn `source_report`, which is in
 * this stream: `calls_made`, written by `08-extract-linkedin.js` from the page guard's own count.
 * If that report is missing or carries no usable number, this node assumes the search leg spent its
 * FULL ceiling. That is the safe direction and it is stated in the report rather than inferred: a
 * budget that guesses low on missing evidence is a budget that spends money it does not have.
 *
 * A CAP A HUMAN CAN EDIT NEEDS A CAP A HUMAN CANNOT, which is the fourth rule in nodes/README.md.
 * Both caps read from the settings tab, then lane.json, then the shipped default, so Shaheen can
 * tune them from his phone. That makes them hand editable, and 9999 on a weekday cron with nobody
 * in the room is an unbounded fetch against the only free source of Swedish jobs in this lane. So
 * each is CLAMPED in code to a number no settings cell can raise, and the clamp is named in the run
 * report whenever it bites.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. A ROW WITH NO DESCRIPTION IS STILL SCORED. NOTHING IS EVER DROPPED HERE.
 * ---------------------------------------------------------------------------------------------
 * Shaheen on the old engines: "the jobs were very few and I believe it was way more than that but
 * for some reason the jobs were filtered out". Every item this node receives is emitted, with a
 * `detail_status` saying what happened and a `detail_reason` saying why in a sentence. The budget
 * takes a DESCRIPTION away from a row, never the row.
 *
 * The consequence that has to be said out loud, because it is the real cost of the cap: a row
 * written this run is known next run and `Remove Known` deletes it, so a row the budget refused is
 * scored on its title once and never enriched. That is why the total budget is spent search-first
 * and detail-second in `Remove Known`'s newest-first order, and why a truncated detail leg is
 * reported as a truncation rather than as a quiet day. Holding those rows back instead was
 * considered and refused: the dispatch says explicitly that a missing description degrades a score
 * and does not remove a job, and stalling the window would not bring the rows back anyway, because
 * Remove Known removes what has already been written.
 *
 * ---------------------------------------------------------------------------------------------
 * 4. THE STREAM CONTRACT.
 * ---------------------------------------------------------------------------------------------
 * IN: everything Remove Known emitted. Job rows, up to eight `source_report` items and two
 * `stage_report` items.
 * OUT: every one of those, untouched except for `_detail_now` plus `detail_status` and
 * `detail_reason` on the job rows, and NOTHING ELSE. This node does not write `excerpt`; that is
 * `Attach Detail`'s job, after the fetch.
 *
 * `_detail_now` is a boolean on EVERY item, reports included, because `Detail Route` reads it under
 * strict type validation and an undefined there is an error rather than a false. Exactly the shape
 * `28-budget-gate.js` uses for `_score_now`, for exactly the same reason.
 */

const { lane, sources } = require('./_lane');

const L = lane();
const CONTRACT = sources();
const SOURCE_KEY = 'linkedin_guest_detail';
const SEARCH_KEY = 'linkedin_guest_search';
const S = CONTRACT.sources[SOURCE_KEY];

// THE CLAMPS. Not configurable, on purpose. These are the numbers past which no settings cell can
// take this lane. 60 matches the search guard's own hard clamp, so the TOTAL clamp is the binding
// one under maximum abuse: search 60 and detail 30 still cannot produce more than 60 calls.
const HARD_MAX_DETAIL_CALLS = 30;
const HARD_MAX_TOTAL_CALLS = 60;

(function assertAgainstContract() {
  if (!S) {
    throw new Error('Detail Gate: the shared contract has no source called ' + SOURCE_KEY + '. It carries: ' + Object.keys(CONTRACT.sources).join(', '));
  }
  if (S.method !== 'GET') {
    throw new Error('Detail Gate: the contract says ' + SOURCE_KEY + ' is a ' + S.method + ' and this stage builds a GET. A collector that sends the wrong verb to a source that blocks fast is not a config detail.');
  }
  if (S.auth !== 'none') {
    throw new Error('Detail Gate: the contract says ' + SOURCE_KEY + ' now needs auth (' + S.auth + '), and no credential is attached anywhere in this stage. An unauthenticated call to an authenticated endpoint returns 401, which this lane would report as a refusal and blame the IP for.');
  }
  if (!/\{job_id\}/.test(S.endpoint)) {
    throw new Error('Detail Gate: the ' + SOURCE_KEY + ' endpoint template has no {job_id} placeholder, so there is nothing to substitute the posting id into: ' + S.endpoint);
  }
  // The id this stage substitutes is the SEARCH id with its prefix removed, and the contract says
  // both sources share one id. If that ever stops being true, the url would be built from the wrong
  // number and every fetch would 404 against a real posting that exists.
  const searchRule = CONTRACT.sources[SEARCH_KEY] && CONTRACT.sources[SEARCH_KEY].dedup_id_rule;
  if (!searchRule || !/li-/.test(searchRule)) {
    throw new Error('Detail Gate: ' + SEARCH_KEY + ' dedup_id_rule is ' + JSON.stringify(searchRule) + '. This stage strips that prefix off a row job_id to recover the numeric posting id.');
  }
  if (!/same id as linkedin_guest_search/.test(String(S.dedup_id_rule))) {
    throw new Error('Detail Gate: the contract no longer says ' + SOURCE_KEY + ' shares its id with ' + SEARCH_KEY + '. This stage builds the detail url out of the SEARCH row id, so if the two ids diverged every fetch would ask for the wrong posting and get a plausible answer.');
  }

  // The node this one reads its rows from, by name, asserted rather than remembered.
  const removeKnown = require('./22-remove-known.js');
  if (removeKnown.name !== 'Remove Known') {
    throw new Error('Detail Gate: node 22 is named ' + JSON.stringify(removeKnown.name) + ' and this node connects from "Remove Known". Node names are the wiring key; rename both in the same edit.');
  }
  // THE EMPTY-INPUT TRAP, third sighting in this workflow (Combine, then the scoring chain). n8n
  // skips a node whose input carries no items and alwaysOutputData does not change it, so this
  // whole branch is alive only because Remove Known emits its own stage report unconditionally.
  // That is checked here rather than remembered, because if it ever became conditional this stage
  // would vanish on a quiet day and take every source report with it.
  const rkCode = String(removeKnown.parameters.jsCode || '');
  if (rkCode.indexOf('return rows.concat(carried, [{ json: report') === -1) {
    throw new Error(
      'Detail Gate: 22-remove-known.js no longer ends with an UNCONDITIONAL report on its return.\n' +
      '  n8n skips a node whose input has no items, so this entire branch runs only because Remove\n' +
      '  Known always emits at least one item. If it can now return an empty array, a run with no new\n' +
      '  jobs would skip this stage, skip Budget Gate, and lose every source report with them.'
    );
  }
  // The row cap upstream is sized by THIS stage's budget since 2026-09-12, and this stage checks the
  // two agree at run time. That check is only a check while Remove Known actually publishes the
  // number; without the block it would silently pass on every run.
  if (rkCode.indexOf('coupling: {') === -1 || rkCode.indexOf('detail_budget: detailBudget,') === -1) {
    throw new Error(
      'Detail Gate: 22-remove-known.js no longer publishes cap.coupling.detail_budget.\n' +
      '  That node caps how many rows the run keeps by the budget THIS node computes, and this node\n' +
      '  cross-checks the two at run time. With the block gone the cross-check has nothing to compare\n' +
      '  against, so it would report agreement on every run including the runs where the two have\n' +
      '  drifted apart, which is worse than not checking at all.'
    );
  }
  const parseSettings = require('./04-parse-settings.js');
  if (parseSettings.name !== 'Parse Settings') {
    throw new Error('Detail Gate: node 04 is named ' + JSON.stringify(parseSettings.name) + ' and this node reads $(\'Parse Settings\') for the source switch. Rename both in the same edit.');
  }
  const planQueries = require('./05-plan-queries.js');
  if (planQueries.name !== 'Plan Queries') {
    throw new Error('Detail Gate: node 05 is named ' + JSON.stringify(planQueries.name) + ' and this node reads $(\'Plan Queries\') for the resolved caps. Rename both in the same edit.');
  }
  // The caps have to exist in the schema as OPTIONAL numbers, or a settings row for one would be
  // rejected as an unknown key and the tuning path this node advertises would not exist.
  const { settingsSchema } = require('./_lane');
  const SC = settingsSchema();
  for (const k of ['linkedin_detail_max_calls_per_run', 'linkedin_total_max_calls_per_run', 'linkedin_max_calls_per_run']) {
    if (SC.optional_number.indexOf(k) === -1) {
      throw new Error('Detail Gate: ' + k + ' is not an optional number in the settings schema, so Parse Settings would refuse a row for it as an unknown key and this node would never see a tuned value.');
    }
  }
  if (SC.switch.indexOf('source_' + SOURCE_KEY) === -1) {
    throw new Error('Detail Gate: source_' + SOURCE_KEY + ' is not a switch in the settings schema. It is the off button for this whole stage and it must decode to a real boolean.');
  }
  // The row shape must still carry the field this stage exists to fill.
  if (CONTRACT.shared_row_shape.indexOf('excerpt') === -1) {
    throw new Error('Detail Gate: the shared row shape no longer carries an excerpt column. This whole stage exists to fill it.');
  }
  if (!(HARD_MAX_DETAIL_CALLS > 0) || !(HARD_MAX_TOTAL_CALLS > 0)) {
    throw new Error('Detail Gate: a clamp is not a positive number. These are the only bounds a hand edited settings cell cannot raise.');
  }
  // A total clamp below the search guard's own clamp would be a lie: the search leg can spend past
  // it before this node ever runs, and this node cannot un-spend a call.
  const searchGuard = require('./23-linkedin-page-guard.js');
  const m = /const HARD_MAX_CALLS = (\d+);/.exec(String(searchGuard.parameters.jsCode || ''));
  if (!m) {
    throw new Error('Detail Gate: could not read HARD_MAX_CALLS out of 23-linkedin-page-guard.js. The whole-run budget is only meaningful if the search leg has a bound of its own, and this node refuses to state a total it cannot honour.');
  }
  if (HARD_MAX_TOTAL_CALLS < Number(m[1])) {
    throw new Error(
      'Detail Gate: the total clamp is ' + HARD_MAX_TOTAL_CALLS + ' and the search guard clamps itself to ' + m[1] + '.\n' +
      '  A total below the search leg\'s own bound cannot be honoured: the search calls are already spent\n' +
      '  by the time this node runs, so the total would be reported as exceeded on every run and would\n' +
      '  never actually restrain anything. Raise this clamp or lower that one, deliberately.'
    );
  }
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// Detail Gate. Which rows get a LinkedIn detail fetch, under a whole-run
// LinkedIn call budget that spans search, paging and detail.
// ---------------------------------------------------------------------------
const all = $input.all().map(function (i) { return i.json; });

// --- 1. the switch ----------------------------------------------------------
// A settings read that fails does NOT kill the branch. Throwing here would end the run and take
// every source report with it, which is the one thing a broken run most needs to keep. Instead the
// stage reports itself unavailable, makes zero calls, and every row travels on unenriched.
let switchOn = null;
let configProblem = null;
try {
  const cfgItems = $('Parse Settings').all().map(function (i) { return i.json; });
  const cfg = {};
  for (const c of cfgItems) if (c && typeof c === 'object') Object.assign(cfg, c);
  const v = cfg['source_' + SOURCE_KEY];
  if (typeof v !== 'boolean') {
    configProblem = 'source_' + SOURCE_KEY + ' decoded to ' + JSON.stringify(v) + ', not a boolean. The off switch for a rate limited source has to be a real boolean.';
  } else {
    switchOn = v;
  }
} catch (e) {
  configProblem = 'cannot reach Parse Settings (' + e.message + '), so the source switch for this stage is unknown.';
}

// --- 2. the caps, clamped ---------------------------------------------------
// Resolved by Plan Queries from the settings tab, then lane.json, then the shipped default, and
// carried on run.paging. Read from there and from nowhere else, so a cap is decided in one place
// and quoted in one place.
const clamped = [];
let capsIn = {};
let capSrc = {};
let searchCeiling = null;
try {
  const planned = $('Plan Queries').all().map(function (i) { return i.json; });
  const runBlock = (planned[0] && planned[0].run) || {};
  const P = runBlock.paging || {};
  capsIn = P.caps || {};
  capSrc = P.caps_source || {};
  if (typeof capsIn.linkedin_max_calls_per_run === 'number') searchCeiling = capsIn.linkedin_max_calls_per_run;
} catch (e) {
  if (!configProblem) configProblem = 'cannot reach Plan Queries (' + e.message + '), so the resolved call caps for this run are unknown.';
}

function cap(name, hard, fallback) {
  let v = capsIn[name];
  let from = capSrc[name] || 'missing';
  if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v < 1) {
    clamped.push({ cap: name, was: v === undefined ? null : v, now: fallback, why: 'not a whole number of 1 or more, so the shipped fallback in the gate applies' });
    v = fallback;
    from = 'fallback in the gate';
  }
  if (v > hard) {
    clamped.push({ cap: name, was: v, now: hard, why: 'above the hard clamp in 33-detail-gate.js, which no settings cell can raise' });
    v = hard;
    from = from + ', clamped';
  }
  return { value: v, from: from };
}
const detailCap = cap('linkedin_detail_max_calls_per_run', HARD_MAX_DETAIL_CALLS, DEFAULT_DETAIL_CALLS);
const totalCap = cap('linkedin_total_max_calls_per_run', HARD_MAX_TOTAL_CALLS, DEFAULT_TOTAL_CALLS);

// --- 3. what the search leg already spent ------------------------------------
// Read off the LinkedIn source_report, which is in this stream. A MISSING number is treated as the
// FULL search ceiling, never as zero: a budget that guesses low on missing evidence spends calls it
// does not have, and the whole point of a total is that it is a total.
let searchCalls = null;
let searchCallsFrom = null;
const searchReport = all.filter(function (j) { return j && j._kind === 'source_report' && j.source === SEARCH_KEY; })[0] || null;
if (searchReport && typeof searchReport.calls_made === 'number' && isFinite(searchReport.calls_made) && searchReport.calls_made >= 0) {
  searchCalls = searchReport.calls_made;
  searchCallsFrom = 'the ' + SEARCH_KEY + ' source_report';
} else if (searchReport && searchReport.verdict === 'disabled') {
  searchCalls = 0;
  searchCallsFrom = 'the ' + SEARCH_KEY + ' source is switched off, so its leg cost zero calls';
} else {
  searchCalls = (typeof searchCeiling === 'number' && searchCeiling > 0) ? searchCeiling : totalCap.value;
  searchCallsFrom = 'ASSUMED: no usable calls_made on a ' + SEARCH_KEY + ' source_report, so the search leg is priced at its full ceiling (' + searchCalls + '). Assuming zero here would let this stage spend a budget that was already gone.';
}

const remainingTotal = Math.max(0, totalCap.value - searchCalls);
const detailBudget = Math.min(detailCap.value, remainingTotal);

// --- 3b. the cross-check against the node that sized the row cap ------------
// Since 2026-09-12 Remove Known caps its row count by THIS number, computed independently from the
// same three inputs. Two nodes computing the same budget is a drift risk, so they are compared here
// rather than trusted: if they disagree, the run kept a number of rows that does not match the
// number of descriptions this stage can buy, which is exactly the starve the coupling exists to
// remove and it would otherwise be invisible. Comparing beats reading its value, because a bug in
// either node then has to be a bug in BOTH to pass silently.
let couplingMismatch = null;
const rkReport = all.filter(function (j) { return j && j._kind === 'stage_report' && j.stage === 'remove_known'; })[0] || null;
const rkCoupling = (rkReport && rkReport.cap && rkReport.cap.coupling) || null;
if (rkCoupling && typeof rkCoupling.detail_budget === 'number' && rkCoupling.detail_budget !== detailBudget) {
  couplingMismatch = {
    remove_known_detail_budget: rkCoupling.detail_budget,
    this_stage_detail_budget: detailBudget,
    remove_known_search_calls: rkCoupling.search_calls_already_made,
    this_stage_search_calls: searchCalls,
    remove_known_total: rkCoupling.whole_run_linkedin_calls,
    this_stage_total: totalCap.value,
    remove_known_per_stage: rkCoupling.per_stage_cap,
    this_stage_per_stage: detailCap.value,
  };
}
// A MISSING block is a different thing from a wrong number and is treated differently. The build
// refuses a Remove Known that does not publish one, so at run time an absent block means this stage
// is looking at a stream that did not come through the built graph. It is said out loud and it does
// NOT degrade the verdict, because nothing about this run's own work is wrong.
const couplingUnchecked = rkCoupling ? null
  : (rkReport ? 'the remove_known stage report carried no cap.coupling block' : 'no remove_known stage report reached this stage at all');

// --- 4. the decision ---------------------------------------------------------
function idOf(row) {
  const raw = String(row.job_id === null || row.job_id === undefined ? '' : row.job_id).trim();
  if (!raw) return null;
  if (raw.indexOf(ID_PREFIX) !== 0) return null;
  const numeric = raw.slice(ID_PREFIX.length);
  // The endpoint takes a numeric posting id. Anything else is not one, and asking for it would
  // return a plausible page for a different job or a 404 that reads as a dead posting.
  if (!/^[0-9]+$/.test(numeric)) return null;
  return numeric;
}
function detailUrl(id) {
  return ENDPOINT.replace('{job_id}', encodeURIComponent(id));
}

const jobs = [];
const carried = [];
for (const j of all) {
  if (j && j._kind === 'job') jobs.push(j);
  else carried.push(j);
}

let admitted = 0;
let stoppedByStageCap = 0;
let stoppedByTotal = 0;
let notLinkedin = 0;
let alreadyHave = 0;
let badId = 0;
let disabledCount = 0;
let unavailable = 0;
const perSource = {};
// The fetch-branch items, built alongside the rows. See the comment where they are pushed: the ROW
// never goes down the fetch branch, because an HTTP node replaces its input item with its response.
const requests = [];

const stamped = jobs.map(function (job, idx) {
  const out = Object.assign({}, job);
  const src = String(job.source || 'unknown');
  perSource[src] = perSource[src] || { seen: 0, fetching: 0 };
  perSource[src].seen += 1;

  let status;
  let reason;
  let url = null;
  let numericId = null;

  if (src !== SEARCH_KEY) {
    status = 'not_applicable';
    reason = 'this row came from ' + src + ', which publishes its own description. The LinkedIn detail endpoint only knows about LinkedIn postings.';
    notLinkedin += 1;
  } else if (String(job.excerpt === null || job.excerpt === undefined ? '' : job.excerpt).trim() !== '') {
    status = 'not_applicable';
    reason = 'this row already carries a description, so there is nothing to enrich. Worth noticing rather than ignoring: the guest SEARCH endpoint has never produced one, so this means the card markup changed in our favour.';
    alreadyHave += 1;
  } else if (configProblem !== null) {
    status = 'error';
    reason = 'the detail stage could not read its own configuration, so no call was made: ' + configProblem + ' The row is scored on its title and nothing is lost.';
    unavailable += 1;
  } else if (switchOn !== true) {
    status = 'disabled';
    reason = 'source_' + SOURCE_KEY + ' is off in the settings tab. This is a setting, not a fault: the row is collected and scored, it just carries no description.';
    disabledCount += 1;
  } else if ((numericId = idOf(job)) === null) {
    status = 'error';
    reason = 'the row job_id is ' + JSON.stringify(job.job_id) + ', which does not carry the ' + JSON.stringify(ID_PREFIX) + ' prefix followed by a numeric posting id, so no detail url can be built for it. That points at the collector, not at the posting.';
    badId += 1;
  } else if (admitted >= detailBudget) {
    status = 'budget';
    const which = (detailCap.value <= remainingTotal)
      ? 'linkedin_detail_max_calls_per_run is ' + detailCap.value + ' and it was already spent'
      : 'the whole-run LinkedIn budget is ' + totalCap.value + ' calls, the search leg already spent ' + searchCalls + ', so only ' + remainingTotal + ' were left for this stage and they are spent';
    reason = which + '. The row is scored on its title. It will NOT come back for a description on a later run, because it is written this run and Remove Known deletes it as known next run, so this line is the honest cost of the cap rather than a deferral.';
    if (detailCap.value <= remainingTotal) stoppedByStageCap += 1; else stoppedByTotal += 1;
  } else {
    status = 'pending';
    reason = null;
    url = detailUrl(numericId);
    admitted += 1;
    perSource[src].fetching += 1;
  }

  const willFetch = status === 'pending';
  // THE ROW ALWAYS TRAVELS THE CARRY BRANCH, EVEN WHEN IT IS BEING FETCHED, and this is the
  // load-bearing decision in the whole stage. An n8n HTTP node emits { body, headers, statusCode,
  // statusMessage } and DROPS every input field, so a row routed into the fetch branch does not
  // come out of the other side: it is replaced by its own response. The first build of this node
  // sent admitted rows down the true branch and they simply vanished, which is a silent row loss
  // and is the exact class this lane keeps refusing.
  // So an admitted row produces TWO items: the row itself with _detail_now false, and a separate
  // REQUEST item carrying only the url and the job_id. The request is pure scaffolding, it is the
  // only thing the HTTP node ever sees, and it is the only thing that can be lost by a dead call.
  // The consequence worth stating: Attach Detail can now attach nothing at all and still emit every
  // row, because the rows never depended on the fetch branch surviving.
  out._detail_now = false;
  out.detail_status = status;
  out.detail_reason = reason;
  if (willFetch) {
    requests.push({
      _kind: 'detail_request',
      _detail_now: true,
      detail_url: url,
      job_id: job.job_id,
      seq: admitted - 1,
    });
  }
  return out;
});

// --- 5. the stage report -----------------------------------------------------
const warnings = [];
let statusToken = null;
let verdict = 'ok';

if (configProblem !== null) {
  verdict = 'down';
  statusToken = 'stage_down:linkedin_detail_config';
  warnings.push(
    'THE DETAIL STAGE COULD NOT READ ITS OWN CONFIGURATION, so it made ZERO calls: ' + configProblem +
    ' Every LinkedIn row is scored on its title alone. Nothing is lost and nothing was called, but a run ' +
    'with no descriptions is not the same as a run where the descriptions were empty.'
  );
} else if (switchOn !== true) {
  verdict = 'disabled';
  statusToken = null;
  warnings.push(
    'source_' + SOURCE_KEY + ' is OFF in the settings tab, so ' + disabledCount + ' LinkedIn row(s) are scored on ' +
    'title, company and location alone. This is a setting, not a fault. Turn it on in the settings tab to enrich again.'
  );
}
if (stoppedByStageCap > 0 || stoppedByTotal > 0) {
  verdict = verdict === 'ok' ? 'degraded' : verdict;
  warnings.push(
    'THE LINKEDIN CALL BUDGET BIT: ' + (stoppedByStageCap + stoppedByTotal) + ' row(s) go to the scorer with no description. ' +
    'The search leg spent ' + searchCalls + ' call(s) (' + searchCallsFrom + '), the whole-run budget is ' + totalCap.value +
    ' and the per-stage cap is ' + detailCap.value + ', so this stage could make ' + detailBudget + '. ' +
    'These rows are written and scored, and they will not be enriched later: Remove Known deletes them as known ' +
    'next run. Raise linkedin_total_max_calls_per_run in the settings tab if the risk of a LinkedIn refusal is ' +
    'worth taking, and read the D20 note in the source contract first, because nobody has measured this box past ' +
    '20 calls in a run.'
  );
}
if (couplingMismatch !== null) {
  verdict = verdict === 'ok' ? 'degraded' : verdict;
  statusToken = statusToken || 'stage_drift:linkedin_detail_budget';
  warnings.push(
    'THE ROW CAP AND THIS STAGE DISAGREE ABOUT THE LINKEDIN DETAIL BUDGET: ' + JSON.stringify(couplingMismatch) + '. ' +
    'Remove Known caps how many rows the run keeps by exactly this number, so a disagreement means the run kept a ' +
    'count of rows that does not match the count of descriptions this stage can buy. Both nodes compute it from the ' +
    'same three inputs (the two caps on the plan and calls_made on the search source_report), so they can only differ ' +
    'if one of them changed, or if one of them read a different stream. Nothing is lost this run: every row is still ' +
    'emitted and the budget still binds. What is lost is the guarantee that a kept row can be described.'
  );
}
if (couplingUnchecked !== null) {
  warnings.push(
    'THE ROW CAP WAS NOT CROSS-CHECKED AGAINST THIS BUDGET: ' + couplingUnchecked + '. Remove Known is supposed to cap ' +
    'how many rows the run keeps by the ' + detailBudget + ' description(s) this stage can buy, and to publish the ' +
    'arithmetic so it can be compared here. The build refuses a Remove Known that does not, so seeing this at run time ' +
    'means this stage is reading a stream that did not come through the built graph. Nothing about this run is wrong; ' +
    'the guarantee that a kept row can be described is simply unproven on it.'
  );
}
if (searchCallsFrom && searchCallsFrom.indexOf('ASSUMED') === 0) {
  warnings.push(
    'NO USABLE calls_made REACHED THIS NODE from the ' + SEARCH_KEY + ' source_report, so the search leg was priced at ' +
    searchCalls + ' calls, which is its ceiling. That is deliberate and it is the safe direction, but it means the ' +
    'whole-run budget was spent against a guess. The usual cause is the LinkedIn branch not running at all; the ' +
    'report to read is the collector one, not this line.'
  );
}
if (badId > 0) {
  warnings.push(badId + ' LinkedIn row(s) carry a job_id this stage could not turn into a posting id. That is a collector problem, not a posting problem, and the ids are in the per-row detail_reason.');
}
if (alreadyHave > 0) {
  warnings.push(alreadyHave + ' LinkedIn row(s) ALREADY carried a description before this stage. The guest search endpoint has never produced one, so either the card markup changed or something else is writing that field. Worth a look, and no calls were spent on them.');
}
if (jobs.length === 0) {
  warnings.push('no job rows reached this stage. That is a normal quiet day, and it is also what a broken collector looks like, so read the collector reports rather than this line.');
}

const report = {
  _kind: 'stage_report',
  stage: 'linkedin_detail_gate',
  lane: LANE_NUMBER,
  verdict: verdict,
  status_token: statusToken,
  source: SOURCE_KEY,
  switch_on: switchOn,
  config_problem: configProblem,
  jobs_in: jobs.length,
  reports_passed_through: carried.length,
  admitted_for_fetch: admitted,
  by_status: stamped.reduce(function (acc, j) { acc[j.detail_status] = (acc[j.detail_status] || 0) + 1; return acc; }, {}),
  budget: {
    whole_run_linkedin_calls: totalCap.value,
    whole_run_from: totalCap.from,
    per_stage_cap: detailCap.value,
    per_stage_from: detailCap.from,
    search_calls_already_made: searchCalls,
    search_calls_source: searchCallsFrom,
    left_for_this_stage: detailBudget,
    stopped_by_stage_cap: stoppedByStageCap,
    stopped_by_whole_run_total: stoppedByTotal,
    hard_clamp_detail_calls: HARD_MAX_DETAIL_CALLS,
    hard_clamp_total_calls: HARD_MAX_TOTAL_CALLS,
    clamped: clamped,
    worst_case_linkedin_calls_this_run: searchCalls + admitted,
    row_cap_agrees: couplingUnchecked !== null ? null : couplingMismatch === null,
    row_cap_mismatch: couplingMismatch,
    row_cap_unchecked: couplingUnchecked,
    why_a_total: 'the search leg and this leg hit the same host from the same IP and LinkedIn counts the sum, so a per-stage cap that lets the total run away is not a cap.',
  },
  rows: {
    linkedin_rows: perSource[SEARCH_KEY] ? perSource[SEARCH_KEY].seen : 0,
    other_source_rows: notLinkedin,
    already_had_a_description: alreadyHave,
    unusable_job_id: badId,
    per_source: perSource,
  },
  pacing: {
    batch_size: BATCH_SIZE,
    batch_interval_ms: BATCH_INTERVAL_MS,
    estimated_sleep_seconds: Math.max(0, admitted - 1) * BATCH_INTERVAL_MS / 1000,
  },
  warnings: warnings,
};

// Reports go LAST and they ALWAYS go, including on a run that fetched nothing, which is the run
// that most needs explaining. Returning [] here would end the branch and delete every source
// report with it. _detail_now is false on every row and every report, so Detail Route sends the
// whole stream down the carry side and ONLY the request items take the fetch branch.
const jobItems = stamped.map(function (j) { return { json: j, pairedItem: { item: 0 } }; });
const requestItems = requests.map(function (r) { return { json: r, pairedItem: { item: 0 } }; });
const carriedItems = carried.map(function (j) { return { json: Object.assign({}, j, { _detail_now: false }), pairedItem: { item: 0 } }; });
return jobItems.concat(requestItems, carriedItems, [{ json: Object.assign({}, report, { _detail_now: false }), pairedItem: { item: 0 } }]);
`;

// The HTTP node's pacing, read back out of the node that actually carries it so the report quotes
// what is configured rather than a second copy that can drift. Same rule 08 already applies to 07.
const HTTP = require('./35-get-linkedin-detail.js');
const HTTP_BATCH = HTTP.parameters.options.batching.batch;

const { pagingDefaults } = require('./_lane');
const PD = pagingDefaults().values;

const jsCode = [
  '// GENERATED at build time from work/34-job-search-bi/nodes/33-detail-gate.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  `const SOURCE_KEY = ${JSON.stringify(SOURCE_KEY)};`,
  `const SEARCH_KEY = ${JSON.stringify(SEARCH_KEY)};`,
  `const ENDPOINT = ${JSON.stringify(S.endpoint)};`,
  `const ID_PREFIX = ${JSON.stringify(CONTRACT.sources[SEARCH_KEY].dedup_id_rule.slice(0, CONTRACT.sources[SEARCH_KEY].dedup_id_rule.indexOf('-') + 1))};`,
  `const HARD_MAX_DETAIL_CALLS = ${JSON.stringify(HARD_MAX_DETAIL_CALLS)};`,
  `const HARD_MAX_TOTAL_CALLS = ${JSON.stringify(HARD_MAX_TOTAL_CALLS)};`,
  `const DEFAULT_DETAIL_CALLS = ${JSON.stringify(PD.linkedin_detail_max_calls_per_run)};`,
  `const DEFAULT_TOTAL_CALLS = ${JSON.stringify(PD.linkedin_total_max_calls_per_run)};`,
  `const BATCH_SIZE = ${JSON.stringify(HTTP_BATCH.batchSize)};`,
  `const BATCH_INTERVAL_MS = ${JSON.stringify(HTTP_BATCH.batchInterval)};`,
  `const LANE_NUMBER = ${JSON.stringify(String(L.lane))};`,
  LOGIC,
].join('\n');

module.exports = {
  name: 'Detail Gate',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [4200, 380],
  connectFrom: 'Remove Known',
  notes:
    'Decides which rows get a LinkedIn detail fetch, under TWO caps: a per-stage cap and a WHOLE-RUN ' +
    'LinkedIn budget that spans search, paging and detail, because both legs hit the same host from the ' +
    'same IP. Both read from the settings tab, then lane.json, then the shipped default, and both are ' +
    'clamped in code to a number no settings cell can raise. Drops nothing: a row the budget refuses is ' +
    'stamped budget and scored on its title.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};
