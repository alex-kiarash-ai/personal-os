'use strict';
/*
 * 05-write-letter.js - "Write Letter". Six Anthropic Messages calls, one per case, on
 * claude-sonnet-5.
 *
 * ---------------------------------------------------------------------------------------------
 * THE TRANSPORT IS nodes/31-write-letter.js, DELIBERATELY UNCHANGED.
 * ---------------------------------------------------------------------------------------------
 * Same method, same url, same credential type, same anthropic-version header, same fullResponse
 * plus neverError, same batchSize 1 with a 1500 ms interval, same 120 s timeout, same
 * onError continueRegularOutput. A harness that calls the model differently from the way the lane
 * calls it is measuring a different call. Two of those settings are load bearing and worth naming
 * again rather than trusting to the copy:
 *
 *   sendHeaders MUST be true. n8n's AnthropicApi credential sets exactly one header, x-api-key;
 *   its anthropic-version line lives in the credential TEST request and never runs on a node call.
 *   Without the header every call 400s.
 *
 *   batchSize MUST be 1. n8n sleeps between BATCHES, so any size above 1 fires that many paid calls
 *   back to back with no interval, and drops them outside the five minute ephemeral cache window
 *   together. The system block here is identical across all six cases, which is precisely the shape
 *   prompt caching is for: one cache write and then five reads at a tenth of the input price.
 *
 * ---------------------------------------------------------------------------------------------
 * THE CREDENTIAL IS NOT RESTATED, IT IS READ.
 * ---------------------------------------------------------------------------------------------
 * LN.anthropicCredential() reads credentials.anthropic out of the gitignored config/lane.json, the
 * same id the runtime lane uses. Deliberately not copied into config/lane-letter-eval.json: a
 * second copy of an id is a second thing to keep in step, and an eval pointed at a different
 * account would be measuring a different rate limit, a different spend ceiling and, on a bad day,
 * a different suspension. The account is also where the six calls land, which is the point of the
 * 20 USD workspace ceiling: this harness cannot cost more than the box lets it.
 *
 * WHAT IT COSTS. Six cases at claude-sonnet-5, the same system block cached across all of them and
 * a letter-sized answer each. It is the cheapest stage in the pipeline and it is still real money,
 * which is the whole reason this workflow has no schedule.
 */

const LN = require('../nodes/_lane');

const L = LN.lane();
const MODEL = LN.STAGE_MODELS.write;

const TIMEOUT_MS = 120000;
const BATCH_SIZE = 1;
const BATCH_INTERVAL_MS = 1500;

(function assertAgainstUpstream() {
  const route = require('./04-eval-write-route.js');
  if (route.name !== 'Eval Write Route') {
    throw new Error('Write Letter (eval): node 04 is named ' + JSON.stringify(route.name) + ' and this node hangs off "Eval Write Route" output 0.');
  }

  // The runtime transport is the specification. Anything that drifts here is a difference nobody
  // chose, and the whole claim of this harness is that it calls what the lane calls.
  const runtime = require('../nodes/31-write-letter.js');
  const rp = runtime.parameters || {};
  const pairs = [
    ['method', rp.method, 'POST'],
    ['url', rp.url, LN.ANTHROPIC_URL],
    ['authentication', rp.authentication, 'predefinedCredentialType'],
    ['nodeCredentialType', rp.nodeCredentialType, 'anthropicApi'],
    ['sendHeaders', rp.sendHeaders, true],
    ['specifyBody', rp.specifyBody, 'json'],
  ];
  for (const [what, live, mine] of pairs) {
    if (live !== mine) {
      throw new Error(
        'Write Letter (eval): the runtime transport sets ' + what + ' = ' + JSON.stringify(live) + ' and this node sets ' + JSON.stringify(mine) + '.\n' +
        '  They are the same call on purpose. Change both in the same edit or the eval is measuring a\n' +
        '  different request from the one the lane makes.'
      );
    }
  }
  const rr = ((rp.options || {}).response || {}).response || {};
  if (rr.fullResponse !== true || rr.neverError !== true) {
    throw new Error('Write Letter (eval): the runtime transport no longer sets fullResponse and neverError. A 4xx has to arrive as DATA so a failed call reads as a failed CASE rather than as a dead branch.');
  }
  if (runtime.onError !== 'continueRegularOutput') {
    throw new Error('Write Letter (eval): the runtime transport no longer sets onError continueRegularOutput.');
  }
  if (BATCH_SIZE !== 1) {
    throw new Error('Write Letter (eval): batchSize is ' + BATCH_SIZE + '. n8n sleeps between BATCHES, so anything above 1 sends that many paid calls back to back.');
  }
  if (!L.credentials || !L.credentials.anthropic) {
    throw new Error(
      'Write Letter (eval): config/lane.json has no credentials.anthropic.\n' +
      '  Refused rather than built without one: n8n renders a permanently disabled credential picker for\n' +
      '  a missing id and the node 401s on every call. Do not paste an id into this file, it is tracked\n' +
      '  and the repo is public.'
    );
  }
  LN.prices(MODEL);
}());

module.exports = {
  name: 'Write Letter',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [1040, 0],
  connectFrom: { node: 'Eval Write Route', outputIndex: 0 },
  onError: 'continueRegularOutput',
  notes: 'Six Anthropic /v1/messages calls, claude-sonnet-5, one item per batch with a 1500 ms pause that keeps all six inside the five minute prompt cache window. Transport copied from nodes/31-write-letter.js and asserted against it at build time. Same credential as the runtime lane, read from the gitignored lane file, never restated. A 4xx arrives as data so a failed call reads as a failed case.',
  parameters: {
    method: 'POST',
    url: LN.ANTHROPIC_URL,
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'anthropicApi',
    sendHeaders: true,
    specifyHeaders: 'keypair',
    headerParameters: {
      parameters: [
        { name: 'anthropic-version', value: LN.ANTHROPIC_VERSION },
      ],
    },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.write_request) }}',
    options: {
      timeout: TIMEOUT_MS,
      batching: {
        batch: {
          batchSize: BATCH_SIZE,
          batchInterval: BATCH_INTERVAL_MS,
        },
      },
      response: {
        response: {
          fullResponse: true,
          neverError: true,
          responseFormat: 'json',
        },
      },
    },
  },
  credentials: LN.anthropicCredential(),
};
