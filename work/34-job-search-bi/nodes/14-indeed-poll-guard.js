'use strict';
/*
 * 14-indeed-poll-guard.js - THE MAX LOOPS GUARD. The one node in this lane that can stop a machine
 * from spinning on its own, on a schedule, every weekday, with nobody in the room.
 *
 * WHAT IT IS PROTECTING AGAINST, said plainly. Everything else in this workflow runs once and stops.
 * This branch contains the only CYCLE: Wait 60s -> Fetch Indeed Snapshot -> this node -> Keep
 * Polling? -> Wait 60s. A snapshot that never becomes ready would go round that cycle forever. There
 * is no outer limit to fall back on: `executionTimeout` is not set on this workflow, and n8n's own
 * default is no timeout at all, so nothing above this node would ever stop it. The cap here IS the
 * cap. A weekday cron plus an unbounded loop is how one dead snapshot becomes an execution that is
 * still running on Friday.
 *
 * A SNAPSHOT THAT NEVER BECOMES READY IS A NORMAL OUTCOME, NOT A CRASH. So hitting the cap does not
 * throw and does not silently stop. It emits a DEGRADED verdict that Extract Indeed Jobs turns into
 * a source report carrying `source_down:<source>`, the reason, the snapshot id, both counters and
 * which cap fired. The run keeps every LinkedIn row it already has. The alternative shapes are both
 * worse: throwing takes down a good run over a slow third party, and returning nothing ends the
 * branch and deletes the evidence of the exact failure this node exists to report.
 *
 * WHY THE GUARD SITS BEFORE THE IF AND NOT AFTER IT, which is a deviation from the brief and the
 * most consequential decision in this file. The brief put an IF on "status 200" first, with the
 * guard on its false branch. That shape has a hole with a price on it: an IF that only knows about
 * 200 routes EVERY other status to the loop, including the permanent ones. A lapsed Bright Data
 * account answering 401 "Customer is not active" would be polled once a minute until the cap, so the
 * single failure this branch was specifically asked to survive would cost the full ten minutes and
 * then be reported as a timeout rather than as a dead account. Putting the guard first makes ONE node
 * responsible for reading the status, and it can then separate three things the IF could not:
 *   permanent refusal   -> stop NOW, on the first pass, and say the account is the reason
 *   still building      -> poll again, if the caps allow
 *   ready               -> stop, hand over the rows
 * Keep Polling? then becomes a dumb router on a boolean this node computed, which is also why the
 * cap cannot be bypassed by a routing mistake: there is only one decision and it is made here.
 *
 * THE COUNTERS, AND WHY EACH ONE IS MEASURED THE WAY IT IS.
 *   POLLS comes from $runIndex, which n8n documents as "the sequential index of the current run for
 *   the ongoing node execution", zero based. It is exact and it is per execution, so it cannot leak
 *   between runs. $getWorkflowStaticData was deliberately NOT used for this: it persists ACROSS
 *   executions, so a counter kept there would carry Monday's polls into Tuesday and the cap would
 *   fire early or not at all depending on history.
 *   ELAPSED is measured against run.run_started_at from Plan Queries, which makes it a WHOLE RUN
 *   budget rather than a poll loop budget. That is deliberate and it is the more useful of the two:
 *   the thing that actually matters for an unattended job is total wall clock, and the LinkedIn leg
 *   ahead of it is a known bounded constant of roughly 25 seconds. It is stated here rather than
 *   hidden because it means the Indeed branch gets slightly less than the full elapsed budget.
 * Both caps are checked on every pass and EITHER one ends the loop. Two caps rather than one because
 * they fail differently: the poll cap is exact but assumes each pass costs about a minute, and the
 * elapsed cap still holds if a Wait misbehaves or a fetch hangs to its timeout.
 */

const { sources } = require('./_lane');
const CONTRACT = sources();
const SRC = CONTRACT.sources;

const SOURCE_KEY = 'brightdata_indeed';
const S = SRC[SOURCE_KEY];

// Read back from the real nodes so the report can never quote numbers this lane is not using.
const WAIT_NODE = require('./12-wait-indeed.js');
const FETCH_NODE = require('./13-fetch-indeed-snapshot.js');

// THE CAPS.
// 10 polls x 60 s is ten minutes of waiting for a snapshot that Bright Data normally builds in one
// to five. Generous enough that a slow day is not a false degradation, small enough that a dead
// snapshot costs ten minutes once a day rather than a worker forever.
const MAX_POLLS = 10;
// The whole run budget, measured from Plan Queries' run_started_at. Comfortably above MAX_POLLS
// worth of sleeping plus the LinkedIn leg, so on a normal stall the POLL cap is what fires and this
// one is the backstop for a Wait or a fetch that does not behave.
const MAX_ELAPSED_MS = 12 * 60 * 1000;

// Statuses that mean STOP, with no further polling, because nothing about them improves with time.
const PERMANENT_STATUSES = {
  400: 'bad request, Bright Data rejected the snapshot request itself',
  401: 'unauthorized, the Bright Data credential was refused',
  402: 'payment required, the Bright Data account cannot be billed',
  403: 'forbidden, the account or the dataset is not accessible with this key',
  404: 'no such snapshot, the id was wrong or the snapshot has expired',
  410: 'the snapshot is gone',
  422: 'the request was understood and rejected, usually a malformed input body',
};
// Statuses worth another pass, because they plausibly change within a minute.
const TRANSIENT_STATUSES = {
  429: 'rate limited by Bright Data',
  500: 'Bright Data server error',
  502: 'bad gateway',
  503: 'service unavailable',
  504: 'gateway timeout',
};
// The lapse the contract already records as having happened to this account once. Matched in the
// BODY as well as on the status, because an API is free to answer 200 and say no in the payload,
// and a refusal dressed as a success is the one shape a status check alone cannot catch.
const LAPSE_MARKERS = [
  'customer is not active',
  'account is not active',
  'subscription',
  'insufficient balance',
  'payment',
];

(function assertAgainstContract() {
  if (!S) {
    throw new Error('Indeed Poll Guard: the shared contract has no source called ' + SOURCE_KEY + '. It carries: ' + Object.keys(SRC).join(', '));
  }
  if (!/Customer is not active/i.test(String(S.rate_note || ''))) {
    throw new Error(
      'Indeed Poll Guard: the contract rate_note for ' + SOURCE_KEY + ' no longer mentions the\n' +
      '  "Customer is not active" lapse. This node matches that phrase in the response body to stop\n' +
      '  polling a dead account on the first pass. If the recorded behaviour changed, the marker list\n' +
      '  here changes with it, and if the note was merely tidied away, the evidence for this whole\n' +
      '  branch of the guard went with it.'
    );
  }
  if (!(MAX_POLLS > 0) || !Number.isFinite(MAX_POLLS)) {
    throw new Error('Indeed Poll Guard: MAX_POLLS is ' + MAX_POLLS + '. A poll cap that is not a positive finite number is not a cap, and this is the only thing stopping an unbounded loop.');
  }
  if (!(MAX_ELAPSED_MS > 0) || !Number.isFinite(MAX_ELAPSED_MS)) {
    throw new Error('Indeed Poll Guard: MAX_ELAPSED_MS is ' + MAX_ELAPSED_MS + '. Same reason.');
  }
  // The elapsed cap has to be reachable from the poll cap's own arithmetic, or one of the two is
  // decorative. If the polls could never fit inside the elapsed budget, the poll cap could never
  // fire and the loop's real behaviour would be nothing like what this file says it is.
  const waitMs = WAIT_NODE.parameters.amount * 1000;
  if (WAIT_NODE.parameters.unit !== 'seconds') {
    throw new Error('Indeed Poll Guard: 12-wait-indeed.js is set to ' + WAIT_NODE.parameters.amount + ' ' + WAIT_NODE.parameters.unit + '. This guard converts its own budget assuming seconds.');
  }
  const floorMs = MAX_POLLS * waitMs;
  if (floorMs >= MAX_ELAPSED_MS) {
    throw new Error(
      'Indeed Poll Guard: ' + MAX_POLLS + ' polls at ' + (waitMs / 1000) + ' s each is ' + (floorMs / 1000) + ' s of sleeping alone,\n' +
      '  at or above the ' + (MAX_ELAPSED_MS / 1000) + ' s elapsed cap. The poll cap could then never fire, so one of the two\n' +
      '  caps would be dead code, and a dead guard is indistinguishable from a working one until the day\n' +
      '  it is needed. Raise MAX_ELAPSED_MS or lower MAX_POLLS, deliberately.'
    );
  }
  const fetchTimeout = FETCH_NODE.parameters.options.timeout;
  if (typeof fetchTimeout !== 'number') {
    throw new Error('Indeed Poll Guard: could not read the fetch timeout back out of 13-fetch-indeed-snapshot.js. The report quotes it, so it must be readable.');
  }
}());

// Parsed back out of the fetch node's real url expression rather than re-declared, so the two can
// never disagree about what a missing snapshot id looks like.
const SENTINEL = (function () {
  const m = /'([A-Z0-9-]{10,})'\s*\}\}/.exec(String(FETCH_NODE.parameters.url));
  if (!m) {
    throw new Error('Indeed Poll Guard: could not read the missing-snapshot-id sentinel back out of 13-fetch-indeed-snapshot.js. This node names it as a cause, so it has to come from the node that emits it.');
  }
  return m[1];
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// Indeed Poll Guard. Exactly one item in, exactly one item out, one decision.
// ---------------------------------------------------------------------------
const res = $input.first() ? ($input.first().json || {}) : null;

// $runIndex is zero based and counts THIS node's runs inside THIS execution, so poll 1 is index 0.
// Per execution, which is what makes it safe: a counter in workflow static data would persist across
// runs and carry yesterday's polls into today.
const runIndex = typeof $runIndex === 'number' ? $runIndex : 0;
const polls = runIndex + 1;

// The run clock. Plan Queries stamps it once, at the top of the run.
let runStartedAt = null;
try { runStartedAt = ($('Plan Queries').first().json.run || {}).run_started_at || null; } catch (e) { runStartedAt = null; }
const startedMs = runStartedAt ? Date.parse(runStartedAt) : NaN;
const elapsedMs = Number.isFinite(startedMs) ? (Date.now() - startedMs) : null;

// The trigger response. Read FIRST, before anything about the snapshot, because if the trigger
// itself failed there is no snapshot to be waiting for and the honest diagnosis is the trigger, not
// a missing or expired id. $() returns a node's FIRST run by default, and the trigger runs once.
let trig = null;
let trigReachable = true;
try { trig = $('Start Indeed Search').first().json || {}; } catch (e) { trigReachable = false; trig = {}; }
const trigBody = (trig && typeof trig.body === 'object' && trig.body !== null) ? trig.body : trig;
const trigStatus = typeof trig.statusCode === 'number' ? trig.statusCode : null;
const snapshotId = (trigBody && trigBody.snapshot_id) ? String(trigBody.snapshot_id) : null;

function textOf(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}
function lapseIn(s) {
  const low = String(s).toLowerCase();
  return LAPSE_MARKERS.some(function (m) { return low.indexOf(m) !== -1; });
}
function errOf(o) {
  const e = o && o.error;
  if (e === undefined || e === null || e === false) return null;
  if (typeof e === 'object') return e.message || e.description || e.code || textOf(e).slice(0, 300);
  return String(e);
}

const caps = { max_polls: MAX_POLLS, max_elapsed_ms: MAX_ELAPSED_MS, wait_ms: WAIT_MS, fetch_timeout_ms: FETCH_TIMEOUT_MS };
const capHit = polls >= MAX_POLLS ? 'max_polls'
  : (elapsedMs !== null && elapsedMs >= MAX_ELAPSED_MS) ? 'max_elapsed_ms'
  : null;

// --- the single decision ---------------------------------------------------
// Order matters and it is the point of this node. Permanent failures are recognised BEFORE the caps
// so a dead account exits on pass 1 instead of being polled for ten minutes and then reported as a
// timeout, which would be the right verdict for the wrong reason.
function decide() {
  if (!trigReachable) {
    return { done: true, outcome: 'error', reason: 'cannot reach Start Indeed Search from this node, so there is no way to know which snapshot is being polled. The graph is not the shape this guard was built against.' };
  }
  const trigErr = errOf(trig);
  if (trigErr) {
    return { done: true, outcome: 'trigger_failed', reason: 'the Bright Data trigger never completed: ' + trigErr + '. No scrape was started, so nothing is building and polling cannot help.' };
  }
  if (trigStatus !== null && (trigStatus < 200 || trigStatus >= 300)) {
    const lapse = lapseIn(textOf(trigBody));
    const named = PERMANENT_STATUSES[trigStatus] || TRANSIENT_STATUSES[trigStatus] || ('HTTP ' + trigStatus);
    return {
      done: true,
      outcome: lapse || PERMANENT_STATUSES[trigStatus] ? 'refused' : 'trigger_failed',
      reason: 'the Bright Data trigger answered HTTP ' + trigStatus + ' (' + named + ')' + (lapse ? ' and the body reads as a lapsed or unbillable account' : '') + '. No scrape was started.',
      status_code: trigStatus,
      account_lapsed: lapse,
    };
  }
  if (lapseIn(textOf(trigBody))) {
    return { done: true, outcome: 'refused', reason: 'the Bright Data trigger answered 2xx with a body that reads as a lapsed or unbillable account. A refusal dressed as a success.', status_code: trigStatus, account_lapsed: true };
  }
  if (!snapshotId) {
    return {
      done: true,
      outcome: 'trigger_failed',
      reason: 'the Bright Data trigger returned no snapshot_id, so the poll url was built with the ' + SENTINEL + ' sentinel and cannot resolve to a real snapshot. The trigger response envelope is UNVERIFIED for this dataset: if the id is present under a key other than snapshot_id, that is the first thing to check and it belongs in the contract.',
      status_code: trigStatus,
    };
  }

  // The trigger is fine. Now the snapshot response.
  if (!res) {
    return { done: false, outcome: 'building', reason: 'no response item on this pass at all.' };
  }
  const fetchErr = errOf(res);
  if (fetchErr) {
    // A transport blip inside a ten minute loop is normal. Keep polling if the caps allow it.
    return { done: false, outcome: 'building', reason: 'the snapshot request did not complete on poll ' + polls + ': ' + fetchErr + '. Treated as transient and polled again.' };
  }
  const status = typeof res.statusCode === 'number' ? res.statusCode : null;
  const bodyText = textOf(res.body);

  if (status === null) {
    return { done: true, outcome: 'error', reason: 'the snapshot response carried no status code. With fullResponse on, every real response has one, so this item is not a response.' };
  }
  if (lapseIn(bodyText) && status !== 200) {
    return { done: true, outcome: 'refused', reason: 'HTTP ' + status + ' and the body reads as a lapsed or unbillable Bright Data account. Polling a dead account is how ten minutes get spent on a one line answer.', status_code: status, account_lapsed: true };
  }
  if (PERMANENT_STATUSES[status]) {
    return { done: true, outcome: 'refused', reason: 'HTTP ' + status + ': ' + PERMANENT_STATUSES[status] + '. Nothing about this improves by waiting, so the loop stops here rather than at the cap.', status_code: status, account_lapsed: status === 401 || status === 402 || status === 403 };
  }
  if (status === 200) {
    return { done: true, outcome: 'ready', reason: null, status_code: 200 };
  }
  if (status === 202) {
    return { done: false, outcome: 'building', reason: 'HTTP 202, the snapshot is still building (poll ' + polls + ' of at most ' + MAX_POLLS + ').', status_code: 202 };
  }
  if (TRANSIENT_STATUSES[status]) {
    return { done: false, outcome: 'building', reason: 'HTTP ' + status + ': ' + TRANSIENT_STATUSES[status] + '. Treated as transient and polled again.', status_code: status };
  }
  if (status > 200 && status < 300) {
    return { done: false, outcome: 'building', reason: 'HTTP ' + status + ', an unrecognised 2xx. Read as still building and polled again, which the caps make safe.', status_code: status };
  }
  return { done: false, outcome: 'building', reason: 'HTTP ' + status + ', unrecognised. Polled again rather than guessed at, which the caps make safe.', status_code: status };
}

let verdict = decide();

// --- the caps -------------------------------------------------------------
// Applied ONLY to a verdict that wanted to keep going. A decision that already stopped is never
// overwritten, because "the account is dead" is a better report than "we ran out of polls".
if (!verdict.done && capHit) {
  verdict = {
    done: true,
    outcome: 'timed_out',
    status_code: verdict.status_code === undefined ? null : verdict.status_code,
    reason: 'the snapshot was still not ready after ' + polls + ' poll(s)' +
      (elapsedMs === null ? '' : ' and ' + Math.round(elapsedMs / 1000) + ' s of run time') +
      ', so the ' + (capHit === 'max_polls' ? 'poll cap (' + MAX_POLLS + ')' : 'elapsed cap (' + Math.round(MAX_ELAPSED_MS / 1000) + ' s of total run time)') +
      ' stopped the loop. This is a DEGRADED source, not a crash: a snapshot that never becomes ready is a normal outcome. ' +
      'The last thing it said was: ' + (verdict.reason || 'nothing') +
      ' Snapshot id: ' + (snapshotId || 'none') + '.',
    cap_hit: capHit,
  };
}

const out = {
  poll: {
    source: SOURCE_KEY,
    run_index: runIndex,
    polls: polls,
    done: verdict.done === true,
    // Keep Polling? routes on exactly this boolean and on nothing else.
    continue: verdict.done !== true,
    outcome: verdict.outcome,
    reason: verdict.reason,
    status_code: verdict.status_code === undefined ? null : verdict.status_code,
    account_lapsed: verdict.account_lapsed === true,
    cap_hit: verdict.cap_hit || null,
    snapshot_id: snapshotId,
    trigger_status_code: trigStatus,
    run_started_at: runStartedAt,
    elapsed_ms: elapsedMs,
    caps: caps,
    polls_remaining: Math.max(0, MAX_POLLS - polls),
  },
  // The rows travel on the guard's item, because Extract Indeed Jobs is fed by Keep Polling? and
  // never sees the fetch node directly. Only on a ready snapshot: there is nothing to carry
  // otherwise, and a bounded excerpt is more useful than a truncated payload.
  rows: verdict.outcome === 'ready' ? (res && res.body !== undefined ? res.body : null) : null,
  // Bounded on purpose. Enough to diagnose a refusal or an unexpected envelope from the run report,
  // small enough that a ten minute loop cannot fill an execution log with megabytes of payload.
  raw_excerpt: verdict.outcome === 'ready' ? null : textOf(res && res.body).slice(0, 2000),
};

return [{ json: out }];
`;

const jsCode = [
  '// GENERATED at build time from work/34-job-search-bi/nodes/14-indeed-poll-guard.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  `const SOURCE_KEY = ${JSON.stringify(SOURCE_KEY)};`,
  `const MAX_POLLS = ${JSON.stringify(MAX_POLLS)};`,
  `const MAX_ELAPSED_MS = ${JSON.stringify(MAX_ELAPSED_MS)};`,
  `const WAIT_MS = ${JSON.stringify(WAIT_NODE.parameters.amount * 1000)};`,
  `const FETCH_TIMEOUT_MS = ${JSON.stringify(FETCH_NODE.parameters.options.timeout)};`,
  `const PERMANENT_STATUSES = ${JSON.stringify(PERMANENT_STATUSES)};`,
  `const TRANSIENT_STATUSES = ${JSON.stringify(TRANSIENT_STATUSES)};`,
  `const LAPSE_MARKERS = ${JSON.stringify(LAPSE_MARKERS)};`,
  `const SENTINEL = ${JSON.stringify(SENTINEL)};`,
  LOGIC,
].join('\n');

module.exports = {
  name: 'Indeed Poll Guard',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [2600, 320],
  connectFrom: 'Fetch Indeed Snapshot',
  notes: 'The max-loops guard. Caps the poll loop at ' + MAX_POLLS + ' polls and ' + (MAX_ELAPSED_MS / 60000) + ' minutes of run time, stops a permanent refusal on the first pass instead of polling it, and on hitting a cap emits a DEGRADED verdict rather than throwing or looping. This is the only cycle in the workflow and nothing above this node would ever stop it.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};
