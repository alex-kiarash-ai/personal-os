'use strict';
/*
 * 36-rewrite-letter.js - "Rewrite Letter". The ONE reasoned rewrite. Same transport, same model,
 * same system block, one more pair of turns on the conversation.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS CALL EXISTS AT ALL (design defect 7 from the plan review).
 * ---------------------------------------------------------------------------------------------
 * The first draft of the design had no rewrite: an audit failure held the pair. The plan review
 * killed that with a measurement rather than an opinion. The Writer Voice Eval's own history
 * recorded 2 dash slips in 6 on a FIRST pass, and this lane is unattended at a cap of ten pairs a
 * day, so a hold-on-first-failure design produces roughly three pairs a day sitting in a queue
 * waiting for a human, for a class of fault a model fixes in one turn when it is told what it did.
 *
 * The other half of defect 7 is the half that is easy to get wrong: NO SILENT SANITISER. Substituting
 * the dash instead of asking for the rewrite would make the letter ship looking clean, and the voice
 * slip would be invisible to the audit, to the blind grader and to anyone reading the folder later.
 * The cost of doing it properly is this call. It is mostly output tokens, because the system block
 * is already in the cache from the first pass.
 *
 * ---------------------------------------------------------------------------------------------
 * THE SAME REQUEST OBJECT, WHICH IS WHAT MAKES THE CACHE PAY AND THE FEEDBACK MEAN ANYTHING.
 * ---------------------------------------------------------------------------------------------
 * Audit Pair builds the body by taking the pair's own write_request, appending the draft as an
 * assistant turn and the failed checks as a second user turn. Same system block, byte for byte, so
 * the cached prefix still matches; same first user turn, so the model is not asked to write a letter
 * for a job it can no longer see; and the draft is its own answer rather than a summary of it.
 *
 * ---------------------------------------------------------------------------------------------
 * EVERYTHING ELSE IS 31-write-letter.js, DELIBERATELY UNCHANGED.
 * ---------------------------------------------------------------------------------------------
 * fullResponse plus neverError plus onError continueRegularOutput, so a failure arrives as data and
 * the sheet row stays at new. No retry, because a retried paid call is a second charge and there is
 * no idempotency key. batchSize 1 with a 1500 ms interval, for the rate limit and the cache window.
 * The anthropic-version header is sent by this node, because the n8n credential only sets x-api-key.
 */

const LN = require('./_lane');

const L = LN.lane();
const MODEL = LN.STAGE_MODELS.rewrite;

const TIMEOUT_MS = 120000;
const BATCH_SIZE = 1;
const BATCH_INTERVAL_MS = 1500;

(function assertAgainstUpstream() {
  const route = require('./35-rewrite-route.js');
  const audit = require('./34-audit-pair.js');
  const first = require('./31-write-letter.js');
  if (route.name !== 'Rewrite Route') {
    throw new Error('Rewrite Letter: node 35 is named ' + JSON.stringify(route.name) + ' and this node hangs off "Rewrite Route" output 0. Rename both in the same edit.');
  }
  const code = String(audit.parameters.jsCode || '');
  if (code.indexOf('j.rewrite_request = req;') === -1) {
    throw new Error('Rewrite Letter: Audit Pair no longer builds rewrite_request, which is the entire body this node posts. It would send the literal string "undefined".');
  }
  if (code.indexOf('system: req.system,') === -1) {
    throw new Error(
      'Rewrite Letter: Audit Pair no longer reuses the ORIGINAL system block for the rewrite.\n' +
      '  Two costs if it stops: the cached prefix no longer matches, so this call pays full price for the\n' +
      '  rubric and the whole voice block again, and the rewrite is judged against a different brief from\n' +
      '  the one the draft was written to.'
    );
  }
  if (MODEL !== LN.STAGE_MODELS.write) {
    throw new Error('Rewrite Letter: this node is pinned to ' + MODEL + ' and the first pass to ' + LN.STAGE_MODELS.write + '. The plan says same transport, same model: this is the same writer being shown its own draft and the reasons it failed, not a second opinion from a different one.');
  }
  if (first.parameters.url !== LN.ANTHROPIC_URL) {
    throw new Error('Rewrite Letter: Write Letter now posts to ' + JSON.stringify(first.parameters.url) + ' and this node to ' + JSON.stringify(LN.ANTHROPIC_URL) + '. The six Anthropic calls in this workflow are deliberately the same node with different bodies.');
  }
  if (!L.credentials || !L.credentials.anthropic) {
    throw new Error('Rewrite Letter: lane.json has no credentials.anthropic. Refused rather than built without one: n8n renders a permanently disabled credential picker for a missing id and the node 401s on every call.');
  }
  LN.prices(MODEL);
  if (BATCH_SIZE !== 1) {
    throw new Error('Rewrite Letter: batchSize is ' + BATCH_SIZE + '. n8n sleeps between BATCHES, so any size above 1 sends that many paid calls back to back with no interval at all.');
  }
}());

module.exports = {
  name: 'Rewrite Letter',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [8840, 0],
  connectFrom: { node: 'Rewrite Route', outputIndex: 0 },
  onError: 'continueRegularOutput',
  notes: 'The ONE reasoned rewrite (plan defect 7). Same transport, same claude-sonnet-5, and the body is the ORIGINAL request object with the draft appended as an assistant turn and the failed checks named in a second user turn, so the cached system block still matches and the model is looking at its own answer rather than a summary of it. A 4xx arrives as data and leaves the sheet row at new. No retry: a retried paid call is a second charge.',
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
    jsonBody: '={{ JSON.stringify($json.rewrite_request) }}',
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
