'use strict';
/*
 * 73-push-hq.js - "Push HQ". The heartbeat, and the ONE named exemption from Verify-after-write.
 *
 * =============================================================================================
 * 1. THE EXEMPTION, STATED PRECISELY, BECAUSE IT IS NARROW AND IT IS THE ONLY ONE IN THIS SEAT.
 * =============================================================================================
 * The root constitution names exactly one carve-out from the Verify-after-write standing order: the
 * heartbeat `run_status` push. `common.sh:hq_push` returns 0 by design and drains the response body
 * without reading it, because A DASHBOARD THAT CANNOT BE REACHED MUST NOT TURN A HEALTHY JOB RED.
 * This node is that push, so it is not read back.
 *
 * The carve-out covers the HEARTBEAT ONLY. Every other external write in this seat reads back and
 * does: the four Drive uploads (Verify Upload plus Check Uploads, by md5) and both spreadsheets
 * (Read Back Sheets plus Check Sheet Writes, cell by cell). Nothing here extends the exemption to
 * them, and those four nodes are what prove it.
 *
 * `onError: continueRegularOutput` is the same rule expressed in n8n: an undeliverable heartbeat is
 * a logged problem, never a failed run. Assert Run still fails the execution afterwards when a SHEET
 * write or a DRIVE upload went missing, which is a different thing entirely.
 *
 * =============================================================================================
 * 2. THE CREDENTIAL HAS A DIRECTION, AND THE WRONG ONE FAILS BY REPORTING SUCCESS.
 * =============================================================================================
 * There are two HQ token credentials on the box with the same header and the same value. One
 * authenticates calls ARRIVING at the HQ webhooks. n8n refuses that one inside an HTTP Request node
 * with "This credential is configured to prevent use within an HTTP Request or GraphQL node", and in
 * #34 that refusal reported SUCCESS twice, executions 5182 and 5240, before anybody noticed: an
 * unauthenticated heartbeat that never lands does not turn anything red, the tile just ages.
 *
 * So this lane uses the OUTGOING credential, by id, out of the gitignored lane file. The id is never
 * written into a tracked file. What IS checkable from here is that the lane file still says which
 * direction it chose, and nodes/_write.js refuses the build if that note has gone.
 *
 * The second half of the guard is at run time and it is in the next node: `fullResponse` plus
 * `neverError` means the item carries a real status code, and `onError: continueRegularOutput` means
 * a node level refusal arrives as an item with an `error` field. Assert Run reads both and says
 * plainly whether the heartbeat landed, WITHOUT ever letting that decide the run. That is the piece
 * #34 was missing when it reported success twice.
 *
 * =============================================================================================
 * 3. FIVE EVENTS IN ONE CALL, AND WHY ONE MALFORMED EVENT WOULD LOSE ALL FIVE.
 * =============================================================================================
 * The contract, read off `Alex HQ - Metrics Ingest (16)` rather than remembered: POST
 * /webhook/alex-push, header auth, body `{events: [...]}`, each event needing `project` and
 * `metric_key`, with optional `value_num`, `value_text`, `headline`, `status` in green|amber|red and
 * `ts`. Anything else in an event is dropped by its Normalize node. The ingest workflow throws on
 * the WHOLE batch when one event is missing a required field, so Build Run Report assembles all five
 * and this node carries no judgement at all.
 *
 * =============================================================================================
 * 4. NO RETRY. A retried heartbeat is a duplicate metric row for one run, and four of the five
 * metrics this pushes are counts.
 */

const W = require('./_write');

const TIMEOUT_MS = 15000;

(function assertAgainstUpstream() {
  const report = require('./72-build-run-report.js');
  if (report.name !== 'Build Run Report') {
    throw new Error('Push HQ: node 72 is named ' + JSON.stringify(report.name) + ' and this node connects from "Build Run Report".');
  }
  const src = String(report.parameters.jsCode || '');
  if (src.indexOf('_hq: hq,') === -1) {
    throw new Error('Push HQ: Build Run Report no longer emits _hq, which is the entire body this node posts. It carries no judgement of its own.');
  }
  // The colour has to be able to go red, or the push is a green light with no off switch.
  if (src.indexOf("if (redReasons.length) colour = 'red';") === -1) {
    throw new Error(
      'Push HQ: Build Run Report no longer forces the colour to red when the run cannot account for its\n' +
      '  writes. A heartbeat that is green whatever happened is not a heartbeat, and between a bad run\n' +
      '  and the next time he opens the spreadsheet it is the only signal that reaches him.'
    );
  }
  // Exactly one item, or this node pushes once per item and every count is duplicated.
  if (src.indexOf('return [{ json: report, pairedItem: { item: 0 } }];') === -1) {
    throw new Error(
      'Push HQ: Build Run Report no longer returns exactly ONE item.\n' +
      '  An HTTP Request node fires once per input item, so anything else here duplicates every metric\n' +
      '  row, and four of the five metrics this pushes are counts.'
    );
  }
  if (src.indexOf('metric_key: metric') === -1 || src.indexOf('project: HQ_SLUG') === -1) {
    throw new Error('Push HQ: Build Run Report no longer builds events carrying project and metric_key. The ingest workflow throws on the whole batch when either is missing, so one malformed event loses all five.');
  }
  // Refuses the build when lane.json has no credentials.hq_token, and when the note that records
  // WHICH DIRECTION was chosen has gone.
  W.hqCredential();
}());

module.exports = {
  name: 'Push HQ',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [18460, 100],
  connectFrom: 'Build Run Report',
  // An undeliverable heartbeat is a logged problem, never a failed run. The one named exemption.
  onError: 'continueRegularOutput',
  notes: 'One POST to the HQ metrics webhook with five events: run_status with the colour and the headline, shipped, held, errors and cost_usd. The body is built entirely by Build Run Report. THIS IS THE ONE NAMED EXEMPTION from Verify-after-write, so it is deliberately not read back and it can never fail the run; every other external write in this seat reads back, and the four nodes that do it are what prove the exemption is narrow. The credential is the OUTGOING HQ token: the incoming one is refused inside an HTTP Request node and that refusal reported SUCCESS twice in #34 before anybody noticed, which is why Assert Run reads this node own status code back and says plainly whether the heartbeat landed.',
  credentials: W.hqCredential(),
  parameters: {
    method: 'POST',
    url: W.HQ_PUSH_URL,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    contentType: 'json',
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json._hq) }}',
    options: {
      timeout: TIMEOUT_MS,
      response: {
        response: {
          fullResponse: true,
          neverError: true,
          responseFormat: 'json',
        },
      },
    },
  },
};
