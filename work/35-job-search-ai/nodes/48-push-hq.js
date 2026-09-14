'use strict';
/*
 * 48-push-hq.js - "Push HQ". The heartbeat, and the ONE named exemption from Verify-after-write.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. THE EXEMPTION, STATED PRECISELY, BECAUSE IT IS NARROW.
 * ---------------------------------------------------------------------------------------------
 * The root constitution names exactly one carve-out from the Verify-after-write standing order: the
 * heartbeat `run_status` push. `common.sh:hq_push` returns 0 by design and drains the response body
 * without reading it, because a dashboard that cannot be reached must not turn a healthy job red.
 * This node is that push, so it is not read back.
 *
 * The carve-out covers the HEARTBEAT ONLY. Every other external write in this lane reads back and
 * does: the jobs append (Read Back Jobs), the ledger append and the window cell (Read Back Writes).
 * Nothing here extends the exemption to them, and the two read-back nodes are what prove it.
 *
 * `onError: continueRegularOutput` is the same rule expressed in n8n: an undeliverable heartbeat is
 * a logged problem, never a failed run. Assert Writes still fails the execution afterwards if a
 * SHEET write went missing, which is a different thing entirely.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. FIVE METRICS IN ONE CALL.
 * ---------------------------------------------------------------------------------------------
 * The dispatch asked for searched, new, scored and cost_usd. `run_status` is the fifth and it is not
 * optional: Close-Out A4 requires an HQ run_status push per run and #34's own Close-Out Extra (b)
 * says "One run_status push per run". The ingest endpoint takes them all in one body.
 *
 * The contract, read live off `Alex HQ - Metrics Ingest (16)` rather than remembered: POST
 * /webhook/alex-push, header auth, body `{events: [...]}` (a bare array and a single object are also
 * accepted), each event needing `project` and `metric_key`, with optional `value_num`, `value_text`,
 * `headline`, `status` in green|amber|red, and `ts`. Anything else in an event is dropped by its
 * Normalize node. The whole body is built by Build Run Row and recoloured by Check Writes; this node
 * carries no judgement.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. THE CREDENTIAL, AND WHY THE TOKEN IS NOT IN THIS FILE.
 * ---------------------------------------------------------------------------------------------
 * `httpHeaderAuth` by credential id, the same n8n credential ("Alex HQ Token") every HQ webhook on
 * the box authenticates incoming requests with, so the header name and its value stay inside n8n and
 * never reach this repo. The id comes from the gitignored lane file, like every other credential id
 * in this lane. Same shape `11-start-indeed-search.js` uses for Bright Data.
 *
 * ---------------------------------------------------------------------------------------------
 * 4. THE PROJECT SLUG IS NULL IN THE REGISTRY TODAY, AND THAT IS RECORDED RATHER THAN PATCHED.
 * ---------------------------------------------------------------------------------------------
 * `system/manifest.json` has `hq_project: null` for #34 and #35. That is the registry saying no slug
 * is declared, not "do not push": #31 and #32 are LIVE with the same null. `_output.js` falls back to
 * the manifest NAME, so the metric rows land in the `alex_metrics` data table under a stable key
 * either way, and the run report says which of the two it used so a fallback is never mistaken for a
 * declaration. Whether the Automation Health board renders a tile for an undeclared slug cannot be
 * checked from this machine, because the alex-hq repo is not here. That is the same absence the
 * dated V8 waiver names, and it is in the handoff as unproven rather than assumed either way.
 *
 * No retry. A retried heartbeat is a duplicate metric row for one run, and the metric this lane
 * pushes is a count.
 */

const O = require('./_output');

const TIMEOUT_MS = 15000;

(function assertAgainstUpstream() {
  const chk = require('./47-check-writes.js');
  if (chk.name !== 'Check Writes') throw new Error('Push HQ: node 47 is named ' + JSON.stringify(chk.name) + ' and this node connects from "Check Writes".');
  const src = (chk.parameters && chk.parameters.jsCode) || '';
  if (src.indexOf('_hq: hq,') === -1) {
    throw new Error('Push HQ: Check Writes no longer emits _hq, which is the entire body this node posts. It contains no judgement of its own.');
  }
  // The colour has to be able to go red here, or the push is a green light with no off switch.
  if (src.indexOf("if (problems.length) status = 'red';") === -1) {
    throw new Error(
      'Push HQ: Check Writes no longer forces the HQ status to red when a write could not be verified.\n' +
      '  A heartbeat that is green whatever happened is not a heartbeat, and it is the only signal that\n' +
      '  reaches Shaheen between a bad run and the next time he opens the sheet.'
    );
  }
  const brr = require('./43-build-run-row.js');
  const bsrc = (brr.parameters && brr.parameters.jsCode) || '';
  // Every event needs project and metric_key or the ingest workflow throws on the whole batch.
  if (bsrc.indexOf('metric_key:') === -1 || bsrc.indexOf('project: HQ_SLUG') === -1) {
    throw new Error('Push HQ: Build Run Row no longer builds events carrying project and metric_key. The ingest workflow (Alex HQ - Metrics Ingest) throws on the whole batch when either is missing, so one malformed event loses all five.');
  }
  O.hqCredential(); // refuses the build when lane.json has no credentials.hq_token, with the #35 note
}());

module.exports = {
  name: 'Push HQ',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [7020, 780],
  connectFrom: 'Check Writes',
  // An undeliverable heartbeat is a logged problem, never a failed run. Root constitution, the one
  // named exemption from Verify-after-write, and it covers this node and nothing else in the lane.
  onError: 'continueRegularOutput',
  notes: 'One POST to the HQ metrics webhook with five events: run_status, searched, new, scored, cost_usd. The body is built by Build Run Row and recoloured red by Check Writes if a sheet write could not be verified. This is the heartbeat, the one named exemption from Verify-after-write, so it is deliberately not read back and it can never fail the run.',
  credentials: O.hqCredential(),
  parameters: {
    method: 'POST',
    url: O.HQ_PUSH_URL,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    contentType: 'json',
    specifyBody: 'json',
    jsonBody: "={{ JSON.stringify($('Check Writes').first().json._hq) }}",
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
