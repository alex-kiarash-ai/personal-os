'use strict';
/*
 * 26-select-cv-blocks.js - "Select CV Blocks". One Anthropic Messages call per live pair, on
 * claude-opus-5, asking which blocks of the frozen master go on the page.
 *
 * The transport is 12-read-job.js verbatim: same shape, same options, same reasoning, one body field
 * different. Four nodes in this workflow talk to Anthropic and they are deliberately the same node
 * with different bodies, because the day one of them differs in a way nobody chose is the day a
 * whole class of failure arrives on one stage and not on the others.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. THE anthropic-version HEADER IS OURS TO SEND, AND WITHOUT IT EVERY CALL 400s.
 * ---------------------------------------------------------------------------------------------
 * Read out of the n8n source rather than assumed: AnthropicApi.credentials.ts has an authenticate()
 * that sets exactly ONE header, x-api-key. The anthropic-version line in that file sits inside
 * `test: ICredentialTestRequest`, which is the credential test button's own request and never runs
 * on a node call. A node relying on the credential to supply the API version gets a 400 on every
 * call, forever, and the only clue is the error body.
 *
 * `sendHeaders` must be true or the HTTP node ignores headerParameters entirely
 * (HttpRequestV3.node.ts: `if (sendHeaders && ...)`).
 *
 * ---------------------------------------------------------------------------------------------
 * 2. A 4xx ARRIVES AS DATA, AND ON THIS STAGE THE ROW MUST STAY AT new.
 * ---------------------------------------------------------------------------------------------
 * fullResponse plus neverError plus onError continueRegularOutput. By the time a pair reaches this
 * node the run has already spent an opus-5 read on it and possibly a research call. If the selection
 * call fails for a systemic reason, that pair must be left UNWRITTEN and its sheet row must stay at
 * `new`, so tomorrow morning offers it again. An Anthropic outage must never look like a job that
 * was considered and rejected, and it must certainly never look like a job that shipped a CV with
 * half a selection on it.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. NO RETRY, AND IT WOULD NOT FIRE EVEN IF IT WERE SET.
 * ---------------------------------------------------------------------------------------------
 * A retried call on a paid endpoint is a second charge, and /v1/messages has no idempotency key, so
 * a lost response on a call that actually succeeded server-side bills twice. This is the second most
 * expensive call in the chain and it carries the largest input in the workflow, the whole master, so
 * a silent double charge here is the most costly one available. Separately, retryOnFail fires on a
 * node ERROR, and with neverError there is no node error to fire on, so setting it would read as
 * retry protection while providing none.
 *
 * ---------------------------------------------------------------------------------------------
 * 4. PACING, AND THE CACHE REASON WHICH IS THE BIG ONE HERE.
 * ---------------------------------------------------------------------------------------------
 * batchSize 1 with batchInterval 1500 sleeps 1500 ms before every item after the first. The rate
 * limit is the obvious reason and it is the smaller one. The system block on this stage is the
 * entire master, and it is identical for every pair on the same lane, so keeping the calls inside the
 * five minute ephemeral window is the difference between one cache write and nine cheap reads, and
 * ten full price copies of his CV. At the shipped cap that pause costs at most eighteen seconds and
 * saves most of the input bill for this stage.
 *
 * batchSize must be 1 and nothing else: n8n sleeps between BATCHES, so any size above 1 sends that
 * many paid calls back to back with no interval at all.
 *
 * ---------------------------------------------------------------------------------------------
 * 5. THINKING IS NOT SENT, AND ON THIS MODEL THAT MEANS IT IS ON.
 * ---------------------------------------------------------------------------------------------
 * The approved plan omits `thinking` in v1 and it is built exactly as written. On claude-opus-5 that
 * means ADAPTIVE thinking, which is on by default, unlike Opus 4.8 and 4.7 where omitting it meant
 * no thinking. `budget_tokens` is removed on this model and returns a 400, so there is no separate
 * thinking ceiling to set. max_tokens caps thinking and text TOGETHER.
 *
 * Two consequences, both built downstream in Assemble CV: the content[] text-block filter is
 * REQUIRED rather than precautionary, because a thinking block comes back first and carries empty
 * text with the default display; and a truncated selection is classified by name rather than
 * arriving as a mysterious parse failure. Selection is also the one call in this chain where
 * thinking is worth its tokens: choosing twenty of forty blocks against three objections and a
 * character budget is the reasoning task in the whole pipeline.
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
const MODEL = LN.STAGE_MODELS.select;

// Generous, because the wall clock here is one call on the largest model in the chain, with adaptive
// thinking on and the whole master as input. A timeout on a PAID call throws away money that has
// already been spent server-side, so the cost of waiting is far below the cost of giving up.
const TIMEOUT_MS = 120000;
const BATCH_SIZE = 1;
const BATCH_INTERVAL_MS = 1500;

(function assertAgainstUpstream() {
  const route = require('./25-select-route.js');
  const build = require('./24-build-select-request.js');
  if (route.name !== 'Select Route') {
    throw new Error('Select CV Blocks: node 25 is named ' + JSON.stringify(route.name) + ' and this node hangs off "Select Route" output 0. Rename both in the same edit.');
  }
  if (String(build.parameters.jsCode || '').indexOf('select_request') === -1) {
    throw new Error('Select CV Blocks: Build Select Request no longer builds select_request, which is the entire body this node posts. It would send the literal string "undefined".');
  }
  if (!L.credentials || !L.credentials.anthropic) {
    throw new Error(
      'Select CV Blocks: lane.json has no credentials.anthropic.\n' +
      '  Refused rather than built without one: n8n renders a permanently disabled credential picker for\n' +
      '  a missing id and the node 401s on every call. Do not paste an id into this file, it is tracked\n' +
      '  and the repo is public.'
    );
  }
  LN.prices(MODEL);
  if (LN.MIN_CACHEABLE_TOKENS[MODEL] === undefined) {
    throw new Error('Select CV Blocks: no cacheable-prefix minimum recorded for ' + JSON.stringify(MODEL) + '. See _lane.js.');
  }
  if (BATCH_SIZE !== 1) {
    throw new Error('Select CV Blocks: batchSize is ' + BATCH_SIZE + '. n8n sleeps between BATCHES, so any size above 1 sends that many paid calls back to back with no interval at all, and drops them outside the five minute cache window together, which on this stage means paying full price for a copy of his whole CV per pair.');
  }
}());

module.exports = {
  name: 'Select CV Blocks',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [6240, 0],
  connectFrom: { node: 'Select Route', outputIndex: 0 },
  // A transport failure has to arrive as DATA so Assemble CV can classify it and leave the sheet row
  // at new. Stopping the workflow here would throw away every report upstream of it and leave pairs
  // the run had already paid to read.
  onError: 'continueRegularOutput',
  notes: 'One Anthropic /v1/messages call per live pair, claude-opus-5, one item per batch with a 1500 ms pause that also keeps every call inside the five minute prompt cache window. The whole body comes from Build Select Request and its system block is that lane entire master. A 4xx arrives as data with its real status code, because a failed selection must leave the sheet row at new rather than reading as a job that was considered and rejected. No retry, on purpose: this is the largest input in the workflow and a retried paid call is a second charge.',
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
    // Built in full by Build Select Request. Stringified rather than passed as an object because the
    // n8n json body field takes a string of JSON, and because this way the exact bytes posted are the
    // exact bytes the offline suite asserts.
    jsonBody: '={{ JSON.stringify($json.select_request) }}',
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
