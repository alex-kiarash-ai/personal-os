'use strict';
/*
 * 13-fetch-indeed-snapshot.js - one GET per poll. Free, unbilled, and never fails the run.
 *
 * WHAT MAKES THIS NODE CHEAP. The trigger is what costs money; reading a snapshot is not billed. So
 * the poll loop's real budget is wall clock and nothing else, which is exactly what Indeed Poll Guard
 * caps. This matters because it says where the danger actually is: not in polling too often, but in
 * polling FOREVER on a schedule with nobody watching.
 *
 * fullResponse IS THE WHOLE MECHANISM HERE, not a nicety. This endpoint answers 202 while the
 * snapshot is still building and 200 with rows when it is ready, and both are 2xx. A body only node
 * cannot tell them apart without guessing from the payload shape, which for an unprobed dataset is a
 * guess on top of a guess. With fullResponse the status code is data, and "still building" and
 * "finished" stop being an inference.
 *
 * neverError, so that 401, 403, 404 and 5xx also arrive as data. The case this is really for is the
 * one the contract already records as having happened to this account once: a lapse answering
 * "Customer is not active". That has to reach the guard as a readable status and body on the FIRST
 * pass, because the guard's job is to tell a permanent refusal (stop now) from a snapshot that is
 * still building (poll again). With neverError off it would arrive as an exception message, the
 * status would have to be scraped out of a string, and the likely outcome is a dead account being
 * polled against until the cap, which is ten wasted minutes and a misleading report.
 *
 * responseFormat json, NAMED rather than left to autodetect, and the body therefore lands on
 * `json.body`. This is the mirror image of the trap Stage B documented on the LinkedIn collector:
 * there, fullResponse plus responseFormat TEXT puts the body under `outputPropertyName` (which is why
 * that node sets it to 'body' explicitly). Here the format is json, and the json branch keeps the
 * body on `body` with headers, statusCode and statusMessage beside it. The two nodes read the same
 * way on purpose, by different routes, and the guard asserts the shape it actually receives rather
 * than trusting either explanation.
 *
 * onError continueRegularOutput. A transport failure mid-loop is a normal event over ten minutes of
 * polling, and it must arrive as an item the guard can count rather than as a thrown run.
 *
 * NO RETRY. n8n retries the NODE, and the node is already inside a retry loop with a cap on it. Two
 * nested retry mechanisms would multiply, and the outer one is the one with the budget.
 *
 * THE SNAPSHOT ID COMES FROM THE TRIGGER RESPONSE, WITH A SENTINEL. The expression reaches back to
 * Start Indeed Search rather than threading the id through the loop, because $() returns a node's
 * FIRST run by default and the trigger only ever runs once, while the loop nodes run many times. The
 * envelope has never been observed, so the expression tries `body.snapshot_id` then a bare
 * `snapshot_id`, and falls back to a LOUD sentinel string rather than the word "undefined". A URL
 * carrying the sentinel 4xxs harmlessly and the guard names the trigger as the cause; a URL carrying
 * "undefined" would look like a real id that had expired, which is a different and wrong diagnosis.
 */

const { lane, sources } = require('./_lane');
const SRC = sources().sources;
const L = lane();

const SOURCE_KEY = 'brightdata_indeed';
const S = SRC[SOURCE_KEY];

const TIMEOUT_MS = 60000;
// Not an id. A deliberately unmistakable string, so a missing snapshot id is legible in the url, in
// the Bright Data error body, and in the run report, instead of looking like an expired snapshot.
const MISSING_ID_SENTINEL = 'NO-SNAPSHOT-ID-FROM-TRIGGER';

(function assertAgainstContract() {
  if (!S) {
    throw new Error('Fetch Indeed Snapshot: the shared contract has no source called ' + SOURCE_KEY + '. It carries: ' + Object.keys(SRC).join(', '));
  }
  if (typeof S.poll_endpoint !== 'string' || !S.poll_endpoint) {
    throw new Error('Fetch Indeed Snapshot: the contract has no poll_endpoint for ' + SOURCE_KEY + '. The whole poll loop exists to call it.');
  }
  if (!/\{snapshot_id\}/.test(S.poll_endpoint)) {
    throw new Error(
      'Fetch Indeed Snapshot: the contract poll_endpoint is "' + S.poll_endpoint + '" and carries no\n' +
      '  {snapshot_id} placeholder. This node substitutes exactly that one placeholder. An endpoint that\n' +
      '  changed shape would otherwise be requested verbatim, once a minute, until the cap.'
    );
  }
  if (!/format=json/.test(S.poll_endpoint)) {
    throw new Error('Fetch Indeed Snapshot: the contract poll_endpoint no longer asks for format=json (' + S.poll_endpoint + '), but this node sets responseFormat json and the extractor parses rows out of a json body.');
  }
  if (!/api\.brightdata\.com/.test(String(S.poll_endpoint))) {
    throw new Error('Fetch Indeed Snapshot: the contract poll_endpoint is not a Bright Data url (' + S.poll_endpoint + '). The credential attached here is a Bright Data key and must not be sent anywhere else.');
  }
  if (!(L.credentials || {}).brightdata_header_auth) {
    throw new Error('Fetch Indeed Snapshot: lane #' + L.lane + " config/lane.json has no credentials.brightdata_header_auth id. See 11-start-indeed-search.js for the #35 port note.");
  }
}());

// The url, built from the contract template at BUILD time with the id left as an n8n expression.
const URL_EXPR = '=' + S.poll_endpoint.replace(
  '{snapshot_id}',
  "{{ (($('Start Indeed Search').first().json.body || $('Start Indeed Search').first().json || {}).snapshot_id) || '" + MISSING_ID_SENTINEL + "' }}"
);

module.exports = {
  name: 'Fetch Indeed Snapshot',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [2340, 320],
  connectFrom: 'Wait 60s',
  onError: 'continueRegularOutput',
  notes: 'One unbilled GET per poll. 202 means the snapshot is still building, 200 means it is ready, and both are 2xx, which is why fullResponse is on: without the status code those two are indistinguishable.',
  parameters: {
    method: 'GET',
    url: URL_EXPR,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
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
  credentials: {
    httpHeaderAuth: { id: L.credentials.brightdata_header_auth, name: 'Bright Data Header Auth' },
  },
};

/*
 * 14-indeed-poll-guard.js reads the timeout and the sentinel back out of the exported object above,
 * at BUILD time, so its report quotes what this node is actually configured to do. There is
 * deliberately no extra top-level key holding a second copy: build.js refuses any top-level key
 * outside its allowlist, and a helper value smuggled in beside the node definition is exactly the
 * shape it refuses. The real parameters are the one source of truth, which is the point. Same rule
 * 07-search-linkedin.js states for its pacing numbers.
 */
