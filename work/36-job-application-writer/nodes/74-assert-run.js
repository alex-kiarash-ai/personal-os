'use strict';
/*
 * 74-assert-run.js - "Assert Run". The terminal node, and the only one in this workflow allowed to
 * fail the execution on purpose.
 *
 * =============================================================================================
 * 1. A RUN THAT CANNOT PROVE ITS WRITES IS A FAILED RUN, NOT A QUIET ONE.
 * =============================================================================================
 * The Verify-after-write standing order says a mismatch hard fails OR logs RED. This seat does both,
 * and the ORDER is the whole reason this is a separate node at the end: Check Sheet Writes decides
 * and colours, Build Run Report assembles, Push HQ sends, and only then does this node throw.
 * Throwing any earlier would suppress the exact message that says why, which is the failure this
 * workflow keeps refusing.
 *
 * What throwing buys that a red heartbeat does not:
 *   - the shared error workflow QlGy1BFzdKF852uR fires, which is how this box surfaces a failure;
 *   - the n8n execution list stops reading `success` on a run whose application rows went missing.
 *     That is not hypothetical. On #34, execution 5154 was status success while silently discarding
 *     748 job rows, and the whole reason these workflows carry reports at all is that a green tick
 *     proved nothing.
 *
 * =============================================================================================
 * 2. WHAT IT FAILS ON, WHICH IS NARROW ON PURPOSE.
 * =============================================================================================
 *   a shipped application whose four files could not be read back out of Drive;
 *   a shipped application with no verified row in the applications tab;
 *   a spreadsheet write this run could not prove, cell by cell;
 *   a check that could not run at all, which is an unverified run rather than a clean one.
 *
 * All four are the same sentence in different words: documents exist and the record of them cannot
 * be trusted. A shipped application with no row is the worst of them, because the documents are
 * sitting in Drive and the only surface he reads does not know they are there.
 *
 * =============================================================================================
 * 3. WHAT IT DOES *NOT* FAIL ON, WHICH IS AS DELIBERATE AS WHAT IT DOES.
 * =============================================================================================
 * A held letter. A blocked job. A capped job. A reader that timed out. A lane with nothing to do. A
 * morning that shipped nothing at all. Every one of those is a REPORTED state: it is in the run
 * report, in the writer_runs ledger row, in the HQ colour and in the jobs status cell, and the ones
 * that should be retried leave their rows at `new` so tomorrow covers them.
 *
 * Failing the execution on them would turn the ordinary condition of this workflow into a red every
 * weekday morning, and a red that is always on is a red nobody reads. That is the same call the
 * collector lane makes about its own down-source days, and for the same reason.
 *
 * It also never fails on an undeliverable HQ push. That is the one named exemption, and this node
 * REPORTS whether the heartbeat landed precisely so the #34 failure mode, a wrong-direction
 * credential silently reporting success, is visible in the run data without ever colouring the run.
 */

const W = require('./_write');

const NODE_NAME = 'Assert Run';

(function assertAgainstUpstream() {
  const push = require('./73-push-hq.js');
  const report = require('./72-build-run-report.js');
  const check = require('./71-check-sheet-writes.js');
  if (push.name !== 'Push HQ') throw new Error(NODE_NAME + ': node 73 is named ' + JSON.stringify(push.name) + ' and this node connects from "Push HQ".');
  if (report.name !== 'Build Run Report') throw new Error(NODE_NAME + ': node 72 is named ' + JSON.stringify(report.name) + ' and this node reads it by name.');
  if (check.name !== 'Check Sheet Writes') throw new Error(NODE_NAME + ': node 71 is named ' + JSON.stringify(check.name) + ' and this node reads the per pair verdicts by name.');

  // THE ORDER IS THE POINT. If this node ever ends up before the push, a failed write would stop the
  // run before the only message that reports it.
  if (push.connectFrom !== 'Build Run Report') {
    throw new Error(
      NODE_NAME + ': Push HQ no longer sits between Build Run Report and this node.\n' +
      '  This node THROWS, so anything downstream of it never runs, and the heartbeat has to have\n' +
      '  already gone out. The order is decide, assemble, send, then fail.'
    );
  }
  if (push.onError !== 'continueRegularOutput') {
    throw new Error(NODE_NAME + ': Push HQ no longer sets onError continueRegularOutput, so an unreachable dashboard would stop the run before this node and the failure would be invisible in a different way.');
  }
  if (push.retryOnFail) {
    throw new Error(NODE_NAME + ': Push HQ now retries, and a retried heartbeat is a duplicate metric row for one run on four metrics that are counts.');
  }
  const csrc = String(check.parameters.jsCode || '');
  if (csrc.indexOf('j._sheet_row_verified = rowVerified;') === -1) {
    throw new Error(NODE_NAME + ': Check Sheet Writes no longer stamps the per pair row verdict, which is the single thing this node fails the execution on.');
  }
  if (csrc.indexOf('verified: verified,') === -1) {
    throw new Error(NODE_NAME + ': Check Sheet Writes no longer emits a `verified` boolean.');
  }
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// Assert Run. Fail the execution on a write that cannot be proved, and only then.
// ---------------------------------------------------------------------------
function txt(v) { return String(v === null || v === undefined ? '' : v); }
function cut(s, n) { const t = txt(s); return t.length > n ? t.slice(0, n - 3) + '...' : t; }
const NL = String.fromCharCode(10);

let report;
try {
  report = $('Build Run Report').first().json;
} catch (e) {
  throw new Error('Assert Run: cannot reach Build Run Report (' + (e && e.message ? e.message : String(e)) + '). That node holds the whole account of this run, and a run with no account of itself is exactly the thing this node exists to fail.');
}

// The per pair verdicts, read from the node that made them rather than from the report, so the two
// can disagree loudly instead of one quoting the other.
let pairs = [];
let pairsReadable = true;
try {
  pairs = $('Check Sheet Writes').all().map((i) => i.json || {}).filter((j) => j && j._kind === 'pair');
} catch (e) {
  pairsReadable = false;
  pairs = [];
}

const shipped = pairs.filter((p) => !p._status);
const noUpload = shipped.filter((p) => !(p._uploads && p._uploads.all_verified === true));
const noRow = shipped.filter((p) => p._sheet_row_verified !== true);
const driveFailed = pairs.filter((p) => txt(p._status) === 'error:drive');

const problems = [];
if (!pairsReadable) {
  problems.push('the per pair verdicts could not be read from Check Sheet Writes, so this node cannot tell a verified application from an unverified one. That is an unverified run.');
}
if (report.writes && report.writes.verified !== true) {
  const first = Array.isArray(report.writes.problems) && report.writes.problems.length ? cut(report.writes.problems[0], 300) : 'no reason recorded';
  problems.push('A SPREADSHEET WRITE COULD NOT BE VERIFIED: ' + first);
}
for (const p of noUpload) {
  problems.push('application ' + txt(p.pair_id) + ' (' + cut(p.company, 60) + ') shipped and its four Drive files were NOT all read back and matched.');
}
for (const p of noRow) {
  problems.push('application ' + txt(p.pair_id) + ' (' + cut(p.company, 60) + ') shipped and has NO verified row in the applications tab. The documents are in Drive and the only surface he reads does not know they are there.');
}

// The heartbeat is read ONLY to say whether it got out. It never decides this node outcome: an
// undeliverable dashboard is the one named exemption from Verify-after-write.
let hqDelivered = null;
let hqStatus = null;
let hqError = null;
try {
  const p = ($('Push HQ').first().json) || {};
  hqStatus = isFinite(Number(p.statusCode)) ? Number(p.statusCode) : null;
  hqError = p.error === undefined ? null : cut(typeof p.error === 'string' ? p.error : ((p.error && p.error.message) || JSON.stringify(p.error)), 240);
  hqDelivered = hqStatus !== null && hqStatus >= 200 && hqStatus < 300;
} catch (e) {
  hqDelivered = null;
}

const warnings = [];
if (hqDelivered !== true) {
  let why = hqStatus === null ? (hqError ? 'the node itself refused the call: ' + hqError : 'no status code came back') : 'HTTP ' + hqStatus;
  if (hqError && hqError.indexOf('prevent use within an HTTP Request') !== -1) {
    why += '. THAT IS THE WRONG CREDENTIAL DIRECTION: the token that authenticates calls ARRIVING at the HQ webhooks cannot be used inside an HTTP Request node. It is the failure that reported success twice in the collector lane before anybody noticed. The fix is the outgoing credential in config/lane.json credentials.hq_token.';
  }
  warnings.push('THE HQ PUSH DID NOT LAND (' + why + '). The run itself is unaffected and that is deliberate: a dashboard that cannot be reached must not turn a healthy job red. The writer_runs ledger row and the applications rows are the durable record; the dashboard tile will simply age.');
}
if (driveFailed.length) {
  warnings.push(driveFailed.length + ' application(s) were marked error:drive. Their folders are left in place, nothing was written to either sheet for them, and their job rows stay at new so tomorrow offers the same jobs again.');
}

const summary = {
  _kind: 'run_summary',
  lane: WORKFLOW_LANE,
  status: txt(report.status),
  headline: txt(report.headline),
  run: report.run || null,
  outcomes: report.outcomes || null,
  by_status: report.by_status || null,
  lanes: report.lanes || null,
  cost_usd: report.cost ? report.cost.total_usd : null,
  uploads: report.uploads || null,
  writes: report.writes || null,
  shipped_total: shipped.length,
  shipped_with_verified_uploads: shipped.length - noUpload.length,
  shipped_with_verified_rows: shipped.length - noRow.length,
  verified: problems.length === 0,
  problems: problems,
  warnings: warnings,
  hq: {
    delivered: hqDelivered,
    http_status: hqStatus,
    error: hqError,
    exemption: 'the heartbeat is the ONE named exemption from Verify-after-write. An undeliverable push is a logged problem and never a failed run; it is recorded here and it never reaches the throw below.',
  },
  red_reasons: report.red_reasons || [],
  amber_reasons: report.amber_reasons || [],
  what_this_node_does_not_fail_on: 'a held letter, a blocked job, a capped job, a reader that timed out, a lane with nothing to do, a morning that shipped nothing, and an undeliverable heartbeat. Every one of those is a reported state, and the ones worth retrying leave their job rows at new so tomorrow covers them. A red that is always on is a red nobody reads.',
};

if (problems.length) {
  // Everything above is already out: the folders exist, the sheet rows that did land are written,
  // the HQ push has gone out coloured, and this summary is in the run data. NOW fail, so the shared
  // error workflow fires and the execution stops reading success.
  throw new Error(
    'Job Application Writer: THIS RUN CANNOT PROVE ITS WRITES and it is failed on purpose.' + NL +
    problems.map((p, i) => '  ' + (i + 1) + '. ' + p).join(NL) + NL +
    '  Everything else already happened: the HQ push went out ' + txt(report.status).toUpperCase() +
    ', the run report is on the Build Run Report node, and every job row this run could not account for is still new, so tomorrow morning offers it again.' + NL +
    '  ' + shipped.length + ' application(s) shipped, ' + (shipped.length - noUpload.length) + ' with verified uploads and ' + (shipped.length - noRow.length) + ' with verified rows.'
  );
}

return [{ json: summary, pairedItem: { item: 0 } }];
`;

function renderJsCode() {
  return [
    '// GENERATED at build time from work/36-job-application-writer/nodes/74-assert-run.js.',
    '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
    'const WORKFLOW_LANE = ' + JSON.stringify(String(require('./_lane').lane().lane)) + ';',
    LOGIC,
  ].join('\n');
}

W.assertGeneratedSourceIsClean(renderJsCode(), NODE_NAME);

module.exports = {
  name: NODE_NAME,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [18720, 100],
  connectFrom: 'Push HQ',
  notes: 'The terminal node. Emits the run summary, and THROWS when a shipped application lacks a verified Drive upload or a verified applications row, or when a spreadsheet write could not be proved cell by cell. A run that cannot prove its writes is a failed run, not a quiet one: throwing fires the shared error workflow and stops the execution list reading success, which is what #34 execution 5154 did while discarding 748 rows. It runs AFTER the HQ push on purpose, because throwing earlier would suppress the message that explains why. It never throws on a held letter, a blocked or capped job, a quiet morning or an undeliverable heartbeat, and it reports whether that heartbeat landed so the wrong-credential-direction failure is visible without ever colouring the run.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: renderJsCode(),
  },
};
