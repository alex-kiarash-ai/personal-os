'use strict';
/*
 * 21-research-company.js - "Research Company". One Anthropic Messages call per readable company, on
 * claude-sonnet-4-6.
 *
 * The transport is 12-read-job.js verbatim: same shape, same options, same reasoning, one model, one
 * body field and one timeout different. That is deliberate. Four nodes in this workflow talk to
 * Anthropic and the day one of them differs in a way nobody chose is the day a class of failure
 * arrives on one stage and not on the others.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. THE anthropic-version HEADER IS OURS TO SEND, AND WITHOUT IT EVERY CALL 400s.
 * ---------------------------------------------------------------------------------------------
 * Read out of the n8n source rather than assumed: AnthropicApi.credentials.ts has an authenticate()
 * that sets exactly ONE header, x-api-key. The anthropic-version line that appears in that file sits
 * inside `test: ICredentialTestRequest`, which is the credential test button's own request and never
 * runs on a node call. A node relying on the credential to supply the API version gets a 400 on
 * every single call, forever, and the only clue is the error body.
 *
 * `sendHeaders` must be true or the HTTP node ignores headerParameters entirely
 * (HttpRequestV3.node.ts: `if (sendHeaders && ...)`).
 *
 * ---------------------------------------------------------------------------------------------
 * 2. A 4xx ARRIVES AS DATA, NOT AS A FAILURE.
 * ---------------------------------------------------------------------------------------------
 * fullResponse plus neverError plus onError continueRegularOutput means the item carries
 * { statusCode, headers, body } whatever happened, and Parse Research classifies it. The stake here
 * is different from the reader's and worth stating: a failed research call must cost a HOOK and
 * nothing more. Thrown, it would take every pair, every lane report and four stage reports down with
 * it, and a morning's applications would be lost to a company website.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. NO RETRY, AND IT WOULD NOT FIRE EVEN IF IT WERE SET.
 * ---------------------------------------------------------------------------------------------
 * A retried call on a paid endpoint is a second charge, and /v1/messages has no idempotency key, so
 * a lost response on a call that actually succeeded server-side bills twice. Separately, retryOnFail
 * fires on a node ERROR, and with neverError there is no node error to fire on, so setting it would
 * read as retry protection while providing none. Recovery from a rate limit is the next scheduled
 * run, which costs nothing extra because nothing has been written yet.
 *
 * ---------------------------------------------------------------------------------------------
 * 4. THE TIMEOUT STAYS GENEROUS EVEN THOUGH THIS IS THE CHEAP MODEL.
 * ---------------------------------------------------------------------------------------------
 * 120000, the same as the reader, and the argument is not "a slow call is not a broken one". It is
 * that a timeout on a PAID call throws away money that has already been spent: the tokens are
 * charged server-side whether or not this box waits for the answer. Timing out early converts a
 * successful, billed call into a transport error and a lost hook. The company fetch one node earlier
 * is capped at 20 seconds precisely because that one costs nothing to abandon.
 *
 * ---------------------------------------------------------------------------------------------
 * 5. PACING, AND THE SECOND REASON FOR IT.
 * ---------------------------------------------------------------------------------------------
 * batchSize 1 with batchInterval 1500 sleeps 1500 ms before every item after the first. The rate
 * limit is the obvious reason. The second is the cache: it keeps the calls inside the five minute
 * ephemeral window so the researcher rubric is written once and read after that, which is the whole
 * reason the breakpoint is there.
 *
 * ---------------------------------------------------------------------------------------------
 * 6. THE CREDENTIAL, AND THE DECISION THAT IS NOT MINE.
 * ---------------------------------------------------------------------------------------------
 * The id comes from config/lane.json, which carries a PROVISIONAL fallback: Shaheen has not chosen a
 * credential for this workflow and human-action anthropic-credential-36-writer is open. Whatever he
 * picks, the id changes in that file and nowhere else, and this node is rebuilt.
 */

const LN = require('./_lane');

const L = LN.lane();
const MODEL = LN.STAGE_MODELS.research;

const TIMEOUT_MS = 120000;
const BATCH_SIZE = 1;
const BATCH_INTERVAL_MS = 1500;

(function assertAgainstUpstream() {
  const route = require('./20-research-route.js');
  const build = require('./19-build-research-request.js');
  if (route.name !== 'Research Route') {
    throw new Error('Research Company: node 20 is named ' + JSON.stringify(route.name) + ' and this node hangs off "Research Route" output 0. Rename both in the same edit.');
  }
  if (String(build.parameters.jsCode || '').indexOf('research_request') === -1) {
    throw new Error('Research Company: Build Research Request no longer builds research_request, which is the entire body this node posts. It would send the literal string "undefined".');
  }
  if (!L.credentials || !L.credentials.anthropic) {
    throw new Error(
      'Research Company: lane.json has no credentials.anthropic.\n' +
      '  Refused rather than built without one: n8n renders a permanently disabled credential picker for\n' +
      '  a missing id and the node 401s on every call. Do not paste an id into this file, it is tracked\n' +
      '  and the repo is public.'
    );
  }
  // The price table has to know this model or the cost report and the intake cost guard are both
  // fiction. V6 leg (a2) asserts the live pin against meta.model_routing separately.
  LN.prices(MODEL);
  if (LN.MIN_CACHEABLE_TOKENS[MODEL] === undefined) {
    throw new Error('Research Company: no cacheable-prefix minimum recorded for ' + JSON.stringify(MODEL) + '. See _lane.js.');
  }
  if (BATCH_SIZE !== 1) {
    throw new Error('Research Company: batchSize is ' + BATCH_SIZE + '. n8n sleeps between BATCHES, so any size above 1 sends that many paid calls back to back with no interval at all, and drops them outside the cache window together.');
  }
  // This stage is the cheap one and it must stay the cheap one. If the routing contract ever pinned
  // it to a reasoning model, the intake cost guard would still be pricing it at sonnet rates.
  if (MODEL === LN.STAGE_MODELS.read || MODEL === LN.STAGE_MODELS.select) {
    throw new Error('Research Company: the research stage is pinned to ' + MODEL + ', the same model as a reasoning stage. The intake cost guard prices research separately and would understate every run.');
  }
}());

module.exports = {
  name: 'Research Company',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [4940, 0],
  connectFrom: { node: 'Research Route', outputIndex: 0 },
  // A transport failure has to arrive as DATA so Parse Research can classify it and leave every pair
  // alone. Stopping the workflow here would throw away the whole morning over a company website.
  onError: 'continueRegularOutput',
  notes: 'One Anthropic /v1/messages call per readable company, claude-sonnet-4-6, one item per batch with a 1500 ms pause that also keeps every call inside the five minute prompt cache window. The whole body comes from Build Research Request. A 4xx arrives as data with its real status code, because a failed research call must cost a hook and nothing else. No retry, on purpose: a retried call on a paid endpoint is a second charge.',
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
    // Built in full by Build Research Request. Stringified rather than passed as an object because
    // the n8n json body field takes a string of JSON, and because this way the exact bytes posted
    // are the exact bytes the offline suite asserts.
    jsonBody: '={{ JSON.stringify($json.research_request) }}',
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
