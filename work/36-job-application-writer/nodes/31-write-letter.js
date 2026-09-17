'use strict';
/*
 * 31-write-letter.js - "Write Letter". One Anthropic Messages call per live pair, on
 * claude-sonnet-5, producing the cover letter and its screening note.
 *
 * The transport is 26-select-cv-blocks.js verbatim: same shape, same options, same reasoning, one
 * body field different. Six nodes in this workflow talk to Anthropic and they are deliberately the
 * same node with different bodies, because the day one of them differs in a way nobody chose is the
 * day a whole class of failure arrives on one stage and not on the others.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. THE anthropic-version HEADER IS OURS TO SEND, AND WITHOUT IT EVERY CALL 400s.
 * ---------------------------------------------------------------------------------------------
 * n8n's AnthropicApi credential sets exactly ONE header, x-api-key. Its anthropic-version line sits
 * inside the credential TEST request and never runs on a node call. `sendHeaders` must be true or
 * the HTTP node ignores headerParameters entirely.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. A 4xx ARRIVES AS DATA, AND ON THIS STAGE THE ROW MUST STAY AT new.
 * ---------------------------------------------------------------------------------------------
 * fullResponse plus neverError plus onError continueRegularOutput. By the time a pair reaches this
 * node the run has already paid for a read, possibly a research call, and a selection on the
 * largest model in the chain. If the letter call fails for a systemic reason, that pair must be
 * left UNWRITTEN and its sheet row must stay at `new`, so tomorrow morning offers it again. An
 * Anthropic outage must never look like a job that was considered and rejected.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. NO RETRY, AND IT WOULD NOT FIRE EVEN IF IT WERE SET.
 * ---------------------------------------------------------------------------------------------
 * A retried call on a paid endpoint is a second charge, and /v1/messages has no idempotency key.
 * Separately, retryOnFail fires on a node ERROR, and with neverError there is no node error to fire
 * on, so setting it would read as retry protection while providing none. The workflow's answer to a
 * bad first letter is the ONE reasoned rewrite at node 36, which is a different call with different
 * input, not a retry of this one.
 *
 * ---------------------------------------------------------------------------------------------
 * 4. PACING, AND THE CACHE WINDOW.
 * ---------------------------------------------------------------------------------------------
 * batchSize 1 with batchInterval 1500 sleeps 1500 ms before every item after the first. The system
 * block here is the rubric plus the whole soul voice block and it is identical for every pair on
 * BOTH lanes, so keeping the calls inside the five minute ephemeral window is one cache write and
 * then reads at a tenth of the input price. batchSize must be 1 and nothing else: n8n sleeps
 * between BATCHES, so any size above 1 sends that many paid calls back to back with no interval.
 *
 * ---------------------------------------------------------------------------------------------
 * 5. THINKING IS NOT SENT, AND max_tokens CAPS THINKING AND TEXT TOGETHER.
 * ---------------------------------------------------------------------------------------------
 * The approved plan omits `thinking` in v1 and it is built exactly as written. Two consequences,
 * both built downstream in Parse Letter: the content[] text-block filter is REQUIRED rather than
 * precautionary, because a thinking block can come back first carrying empty text; and a truncated
 * letter is classified by name rather than arriving as a mysterious missing end marker.
 *
 * ---------------------------------------------------------------------------------------------
 * 6. THE CREDENTIAL, AND THE DECISION THAT IS NOT MINE.
 * ---------------------------------------------------------------------------------------------
 * The id comes from config/lane.json, which carries a PROVISIONAL fallback: Shaheen has not chosen
 * a credential for this workflow and human-action anthropic-credential-36-writer is open.
 */

const LN = require('./_lane');

const L = LN.lane();
const MODEL = LN.STAGE_MODELS.write;

const TIMEOUT_MS = 120000;
const BATCH_SIZE = 1;
const BATCH_INTERVAL_MS = 1500;

(function assertAgainstUpstream() {
  const route = require('./30-write-route.js');
  const build = require('./29-build-writer-request.js');
  if (route.name !== 'Write Route') {
    throw new Error('Write Letter: node 30 is named ' + JSON.stringify(route.name) + ' and this node hangs off "Write Route" output 0. Rename both in the same edit.');
  }
  if (String(build.parameters.jsCode || '').indexOf('write_request') === -1) {
    throw new Error('Write Letter: Build Writer Request no longer builds write_request, which is the entire body this node posts. It would send the literal string "undefined".');
  }
  if (!L.credentials || !L.credentials.anthropic) {
    throw new Error(
      'Write Letter: lane.json has no credentials.anthropic.\n' +
      '  Refused rather than built without one: n8n renders a permanently disabled credential picker for\n' +
      '  a missing id and the node 401s on every call. Do not paste an id into this file, it is tracked\n' +
      '  and the repo is public.'
    );
  }
  LN.prices(MODEL);
  if (LN.MIN_CACHEABLE_TOKENS[MODEL] === undefined) {
    throw new Error('Write Letter: no cacheable-prefix minimum recorded for ' + JSON.stringify(MODEL) + '. See _lane.js.');
  }
  if (BATCH_SIZE !== 1) {
    throw new Error('Write Letter: batchSize is ' + BATCH_SIZE + '. n8n sleeps between BATCHES, so any size above 1 sends that many paid calls back to back with no interval at all, and drops them outside the five minute cache window together.');
  }
}());

module.exports = {
  name: 'Write Letter',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [7540, 0],
  connectFrom: { node: 'Write Route', outputIndex: 0 },
  onError: 'continueRegularOutput',
  notes: 'One Anthropic /v1/messages call per live pair, claude-sonnet-5, one item per batch with a 1500 ms pause that also keeps every call inside the five minute prompt cache window. The whole body comes from Build Writer Request and its system block carries the recruiter lens plus the soul voice block. A 4xx arrives as data with its real status code, because a failed letter must leave the sheet row at new rather than reading as a job that was considered and rejected. No retry, on purpose: a retried paid call is a second charge, and the answer to a bad letter is the one reasoned rewrite downstream, not a repeat of this call.',
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
