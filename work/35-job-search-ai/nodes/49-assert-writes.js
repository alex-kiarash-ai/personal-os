'use strict';
/*
 * 49-assert-writes.js - "Assert Writes". The terminal node, and the only one in this lane that is
 * allowed to fail the execution on purpose.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY IT IS A SEPARATE NODE AND WHY IT IS LAST.
 * ---------------------------------------------------------------------------------------------
 * The Verify-after-write standing order says a mismatch hard-fails OR logs RED. This stage does
 * both, and the ORDER is the whole reason there are two nodes: Check Writes decides and colours,
 * Push HQ sends, and only then does this node throw. Throwing inside Check Writes would suppress the
 * exact message that says why, which is the failure this lane keeps refusing.
 *
 * What throwing buys that a red heartbeat does not:
 *   - the shared error workflow QlGy1BFzdKF852uR fires, which is how this box surfaces a failure;
 *   - the n8n execution list stops reading `success` on a run whose window write went missing. That
 *     is not hypothetical here. Execution 5154 was `status: success` while silently discarding 748
 *     job rows, and the whole reason this lane carries reports at all is that a green tick proved
 *     nothing.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IT DOES *NOT* FAIL ON, WHICH IS AS DELIBERATE AS WHAT IT DOES.
 * ---------------------------------------------------------------------------------------------
 * It throws on WRITE INTEGRITY only: a ledger row that is not in the tab, a ledger cell that says
 * something other than what was sent, a window cell that did not move when it should have or moved
 * when it must not have, or a read-back that could not run at all.
 *
 * It does NOT throw on a source being down, on scoring being down, on a bitten cap, on a truncated
 * page loop or on a run that wrote nothing. Every one of those is a REPORTED state: it is in the
 * ledger row, in the verdict, in the note and in the HQ colour, and the window is held so the next
 * run covers it. Failing the execution on them would turn the ordinary condition of this lane, which
 * today is scoring being down because the Anthropic account is deliberately empty, into a red
 * execution every weekday morning, and a red that is always on is a red nobody reads.
 *
 * It also does not throw on an undeliverable HQ push. That is the one named exemption.
 */

const { lane } = require('./_lane');
const L = lane();

(function assertAgainstUpstream() {
  const push = require('./48-push-hq.js');
  if (push.name !== 'Push HQ') throw new Error('Assert Writes: node 48 is named ' + JSON.stringify(push.name) + ' and this node connects from "Push HQ".');
  // THE ORDER IS THE POINT. If this node ever ends up before the push, a failed write would stop the
  // run before the only message that reports it.
  if (push.connectFrom !== 'Check Writes') {
    throw new Error('Assert Writes: Push HQ no longer sits between Check Writes and this node. This node throws, so anything downstream of it never runs, and the push has to have already gone out.');
  }
  if (push.onError !== 'continueRegularOutput') {
    throw new Error('Assert Writes: Push HQ no longer sets onError continueRegularOutput, so an unreachable dashboard would stop the run before this node and the failure would be invisible in a different way.');
  }
  const chk = require('./47-check-writes.js');
  const src = (chk.parameters && chk.parameters.jsCode) || '';
  if (src.indexOf('verified: problems.length === 0 && check.read_back_ok') === -1) {
    throw new Error('Assert Writes: Check Writes no longer emits a `verified` boolean, which is the single thing this node reads.');
  }
  if (src.indexOf('return [{ json: out') === -1) {
    throw new Error('Assert Writes: Check Writes no longer returns a single item.');
  }
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// Assert Writes. Fail the execution on a write that cannot be proved, and only then.
// ---------------------------------------------------------------------------
let chk;
try {
  chk = $('Check Writes').first().json;
} catch (e) {
  throw new Error('Assert Writes: cannot reach Check Writes (' + e.message + '). That node is the only thing that knows whether the two writes landed, so its absence is itself an unverified run.');
}

const problems = Array.isArray(chk.problems) ? chk.problems : [];
const report = chk._report || {};
const runRow = chk._run_row || {};

// Push HQ is read only to say whether the heartbeat got out. It NEVER decides this node's outcome:
// an undeliverable dashboard is the one named exemption from Verify-after-write and must not turn a
// healthy job red.
let hqDelivered = null;
let hqStatusCode = null;
try {
  const p = ($('Push HQ').first().json) || {};
  hqStatusCode = isFinite(Number(p.statusCode)) ? Number(p.statusCode) : null;
  hqDelivered = hqStatusCode !== null && hqStatusCode >= 200 && hqStatusCode < 300;
} catch (e) { hqDelivered = null; }

const summary = {
  _kind: 'run_summary',
  lane: LANE_NUMBER,
  verdict: runRow.verdict || null,
  status_tokens: report.status_tokens || [],
  run: {
    date: runRow.date || null,
    exec_id: runRow.exec_id || null,
    searched: runRow.searched,
    filtered: runRow.filtered,
    new: runRow.new,
    scored: runRow.scored,
    cost_usd: runRow.cost_usd,
    note: runRow.note || null,
  },
  writes_verified: chk.verified === true,
  write_problems: problems,
  write_notes: Array.isArray(chk.notes) ? chk.notes : [],
  window: report.advance || null,
  sources: report.sources || null,
  hq: {
    status: chk._hq_status || null,
    delivered: hqDelivered,
    http_status: hqStatusCode,
    exemption: 'the heartbeat is the ONE named exemption from Verify-after-write. An undeliverable push is a logged problem and never a failed run; it is recorded here and it never reaches the throw below.',
  },
  report: report,
};

if (!hqDelivered) {
  summary.warnings = ['THE HQ PUSH DID NOT LAND' + (hqStatusCode === null ? ' (no status code came back)' : ' (HTTP ' + hqStatusCode + ')') + '. The run itself is unaffected and this is deliberate. The run row in the sheet is the durable record; the dashboard tile will simply age.'];
}

if (chk.verified !== true) {
  // Everything above is already out: the ledger row is written, the HQ push has been sent and
  // coloured red, and this summary is in the run data. NOW fail, so the shared error workflow fires
  // and the execution stops reading success.
  throw new Error(
    'Job Search BI: THE SHEET WRITES COULD NOT BE VERIFIED and the run is failed on purpose.\\n' +
    problems.map((p, i) => '  ' + (i + 1) + '. ' + p).join('\\n') + '\\n' +
    '  Everything else already happened: the ledger row was written before this check, the HQ push has\\n' +
    '  gone out RED, and the full report is on the Check Writes node. last_run_at ' +
    (report.advance && report.advance.decision ? 'was told to advance' : 'was deliberately held') + ', so ' +
    (report.advance && report.advance.decision
      ? 'confirm the settings cell by hand before the next run.'
      : 'the next run covers the same window and nothing is lost.')
  );
}

return [{ json: summary, pairedItem: { item: 0 } }];
`;

const jsCode = [
  '// GENERATED at build time from work/34-job-search-bi/nodes/49-assert-writes.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  `const LANE_NUMBER = ${JSON.stringify(String(L.lane))};`,
  LOGIC,
].join('\n');

module.exports = {
  name: 'Assert Writes',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [7150, 780],
  connectFrom: 'Push HQ',
  notes: 'The terminal node. Emits the run summary, and throws when a sheet write could not be proved, so the shared error workflow fires and the execution stops reading success. It runs AFTER the HQ push on purpose: throwing earlier would suppress the message that explains why. It never throws on a down source, a bitten cap or an undeliverable heartbeat, all of which are reported states.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};
