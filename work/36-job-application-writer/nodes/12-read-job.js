'use strict';
/*
 * 12-read-job.js - "Read Job". One Anthropic Messages call per admitted pair, on claude-opus-5.
 *
 * The transport is 30-score-job.js VERBATIM. Same shape, same options, same reasoning, one model
 * and one body field different. That is deliberate: this is the only node in #36 that talks to
 * Anthropic in stage one, it costs the most of any call in the chain, and the shape it copies has
 * already survived real runs on this box.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. THE anthropic-version HEADER IS OURS TO SEND, AND WITHOUT IT EVERY CALL 400s.
 * ---------------------------------------------------------------------------------------------
 * Read out of the n8n source rather than assumed: AnthropicApi.credentials.ts has an authenticate()
 * that sets exactly ONE header, x-api-key. The anthropic-version line that appears in that file is
 * inside `test: ICredentialTestRequest`, which is the credential test button own request and never
 * runs on a node call. So a node relying on the credential to supply the API version gets a 400 on
 * every single call, forever, and the only clue is the error body.
 *
 * `sendHeaders` must be true or the HTTP node ignores headerParameters entirely
 * (HttpRequestV3.node.ts: `if (sendHeaders && ...)`).
 *
 * ---------------------------------------------------------------------------------------------
 * 2. A 4xx ARRIVES AS DATA, NOT AS A FAILURE.
 * ---------------------------------------------------------------------------------------------
 * fullResponse plus neverError plus onError continueRegularOutput means the item carries
 * { statusCode, headers, body } whatever happened, and Parse Job Brief classifies it. That matters
 * here more than it did on the collectors: an Anthropic credit error has to leave every row at
 * status `new` so the next morning re-offers it, and it must never be written back as a job that
 * was considered and rejected. A thrown call would also take every lane report and both earlier
 * stage reports down with it.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. NO RETRY, AND IT WOULD NOT FIRE EVEN IF IT WERE SET.
 * ---------------------------------------------------------------------------------------------
 * A retried call on a paid endpoint is a second charge, and /v1/messages has no idempotency key, so
 * a lost response on a call that actually succeeded server-side bills twice. Separately,
 * `retryOnFail` fires on a node ERROR, and with neverError there is no node error to fire on, so
 * setting it would read as retry protection while providing none. Recovery from a rate limit is the
 * next scheduled run, which costs nothing extra because every unwritten row is still `new`.
 *
 * ---------------------------------------------------------------------------------------------
 * 4. PACING, AND THE SECOND REASON FOR IT.
 * ---------------------------------------------------------------------------------------------
 * batchSize 1 with batchInterval 1500 sleeps 1500 ms before every item after the first. At the
 * shipped cap of ten pairs plus two overshoot that is eighteen seconds of deliberate waiting per
 * run. The rate limit is the obvious reason. The second one is the cache: it keeps every call
 * inside the five minute ephemeral window, so the recruiter rubric is written once and read eleven
 * times rather than paid for twelve times at full price.
 *
 * ---------------------------------------------------------------------------------------------
 * 5. THE CREDENTIAL, AND THE DECISION THAT IS NOT MINE.
 * ---------------------------------------------------------------------------------------------
 * The id comes from config/lane.json, which currently carries a PROVISIONAL fallback: Shaheen has
 * not chosen a credential for this workflow and human-action anthropic-credential-36-writer is open.
 * Whatever he picks, the id changes in that file and nowhere else, and this node is rebuilt.
 */

const LN = require('./_lane');

const L = LN.lane();
const MODEL = LN.STAGE_MODELS.read;

// Generous, because the wall clock here is one model call on the largest model in the chain, with
// adaptive thinking on, and a slow call is not a broken one.
const TIMEOUT_MS = 120000;
const BATCH_SIZE = 1;
const BATCH_INTERVAL_MS = 1500;

(function assertAgainstUpstream() {
  const route = require('./11-read-route.js');
  const build = require('./10-build-read-request.js');
  if (route.name !== 'Read Route') {
    throw new Error('Read Job: node 11 is named ' + JSON.stringify(route.name) + ' and this node hangs off "Read Route" output 0. Rename both in the same edit.');
  }
  if (String(build.parameters.jsCode || '').indexOf('read_request') === -1) {
    throw new Error('Read Job: Build Read Request no longer builds read_request, which is the entire body this node posts. It would send the literal string "undefined".');
  }
  if (!L.credentials || !L.credentials.anthropic) {
    throw new Error(
      'Read Job: lane.json has no credentials.anthropic.\n' +
      '  Refused rather than built without one: n8n renders a permanently disabled credential picker for\n' +
      '  a missing id and the node 401s on every call. Do not paste an id into this file, it is tracked\n' +
      '  and the repo is public.'
    );
  }
  // The price table has to know this model or the cost report and the intake cost guard are both
  // fiction. V6 leg (a2) asserts the live pin against meta.model_routing separately.
  LN.prices(MODEL);
  if (LN.MIN_CACHEABLE_TOKENS[MODEL] === undefined) {
    throw new Error('Read Job: no cacheable-prefix minimum recorded for ' + JSON.stringify(MODEL) + '. See _lane.js.');
  }
  if (BATCH_SIZE !== 1) {
    throw new Error('Read Job: batchSize is ' + BATCH_SIZE + '. n8n sleeps between BATCHES, so any size above 1 sends that many paid calls back to back with no interval at all.');
  }
}());

module.exports = {
  name: 'Read Job',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [2600, 0],
  connectFrom: { node: 'Read Route', outputIndex: 0 },
  // A transport failure has to arrive as DATA so Parse Job Brief can classify it and leave the
  // sheet row untouched. Stopping the workflow here would throw away every report upstream of it.
  onError: 'continueRegularOutput',
  notes: 'One Anthropic /v1/messages call per admitted pair, claude-opus-5, max_tokens 2048, one item per batch with a 1500 ms pause that also keeps every call inside the five minute prompt cache window. The whole body comes from Build Read Request. A 4xx arrives as data with its real status code, because a credit error must leave every row at status new rather than reading as a job that was considered and rejected. No retry, on purpose: a retried call on a paid endpoint is a second charge.',
  parameters: {
    method: 'POST',
    url: LN.ANTHROPIC_URL,
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'anthropicApi',
    // The credential supplies x-api-key and NOTHING else. See header note 1.
    sendHeaders: true,
    specifyHeaders: 'keypair',
    headerParameters: {
      parameters: [
        { name: 'anthropic-version', value: LN.ANTHROPIC_VERSION },
      ],
    },
    sendBody: true,
    specifyBody: 'json',
    // Built in full by Build Read Request. Stringified rather than passed as an object because the
    // n8n json body field takes a string of JSON, and because this way the exact bytes posted are
    // the exact bytes the offline suite asserts.
    jsonBody: '={{ JSON.stringify($json.read_request) }}',
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
