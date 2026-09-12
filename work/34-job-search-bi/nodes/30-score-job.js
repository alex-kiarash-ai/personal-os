'use strict';
/*
 * 30-score-job.js - "Score Job". One Anthropic Messages call per admitted row. The only node in
 * either lane that spends money.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. THE NODE IS A TRANSPORT. THE PROMPT IS NOT HERE.
 * ---------------------------------------------------------------------------------------------
 * Budget Gate assembles the entire request body, including the system blocks and the cache marker,
 * and puts it on the item as `score_request`. This node stringifies it and POSTs it. That split is
 * deliberate: a prompt built in an n8n expression can only be tested by running it, and running it
 * costs money and needs credits. A prompt built in a Code node is a string that an offline test
 * suite can assert byte for byte, which is what config/test-scoring.js does.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. THE anthropic-version HEADER IS SENT HERE, AND IT HAS TO BE.
 * ---------------------------------------------------------------------------------------------
 * Read out of the n8n source rather than assumed: `AnthropicApi.credentials.ts` (n8n@2.30.3) has an
 * `authenticate()` that sets exactly ONE header, `x-api-key`. The `anthropic-version: 2023-06-01`
 * that appears in that file is inside `test: ICredentialTestRequest`, which is the credential test
 * button's own request and never runs on a node call. So a node that relies on the credential to
 * supply the API version gets a 400 on every single call, forever, and the only clue is the error
 * body. The header is therefore ours to send, and `sendHeaders` must be true or the HTTP node
 * ignores `headerParameters` entirely (HttpRequestV3.node.ts line 502: `if (sendHeaders && ...)`).
 *
 * ---------------------------------------------------------------------------------------------
 * 3. A 4xx ARRIVES AS DATA, NOT AS A FAILURE.
 * ---------------------------------------------------------------------------------------------
 * `neverError` plus `fullResponse` plus `onError: continueRegularOutput` means the item carries
 * `{ statusCode, headers, body }` whatever happened, and Parse Score classifies it. That matters
 * most right now: Anthropic credits are exhausted by Shaheen's own decision (human-action
 * anthropic-api-credits-run89), so the first live run of this node WILL 4xx. It must land as a
 * named degraded verdict with the real status code, not as a zero score and not as a dead run. A
 * zero score would be indistinguishable from a genuinely bad posting and would poison the sheet's
 * sort order permanently.
 *
 * ---------------------------------------------------------------------------------------------
 * 4. NO RETRY, AND IT WOULD NOT WORK EVEN IF IT WERE SET.
 * ---------------------------------------------------------------------------------------------
 * Same reasoning as `11-start-indeed-search.js`: a retried call on a paid endpoint is a second
 * charge, and `/v1/messages` has no idempotency key, so a lost response on a call that actually
 * succeeded server-side bills twice. Separately, `retryOnFail` fires on a node ERROR, and with
 * `neverError: true` there is no node error to fire on, so setting it would read as retry
 * protection while providing none. Recovery from a rate limit is the next scheduled run, which
 * costs nothing because Remove Known re-offers the same rows.
 *
 * ---------------------------------------------------------------------------------------------
 * 5. PACING.
 * ---------------------------------------------------------------------------------------------
 * `batchSize: 1` with `batchInterval: 1500` makes the node sleep 1500 ms before every item after
 * the first (HttpRequestV3.node.ts: `if (itemIndex > 0 && batchSize >= 0 && batchInterval > 0) { if
 * (itemIndex % batchSize === 0) await sleep(batchInterval) }`). At the shipped cap of 20 rows that
 * is about 30 seconds of deliberate waiting per lane, which is cheap insurance on a rate limit
 * nobody has measured from this box, and it also keeps every call inside the five-minute prompt
 * cache window so the CV is paid for once rather than twenty times.
 *
 * ---------------------------------------------------------------------------------------------
 * 6. THE ONE THING THAT CANNOT BE PROVEN FROM HERE.
 * ---------------------------------------------------------------------------------------------
 * The n8n `anthropicApi` credential type carries `allowedHttpRequestDomains` (read live from
 * GET /credentials/schema/anthropicApi on this box: an enum of all / domains / none). If the stored
 * credential has that set to `none`, an HTTP Request node using it throws
 * "This credential is configured to prevent use within an HTTP Request node"
 * (packages/workflow/src/credential-domain-restrictions.ts, getCredentialAllowedDomains). A
 * credential created before that field existed stores nothing, which reads as allow-all, and the
 * field's own default is `all`. So this is very likely fine and it is NOT proven, because proving
 * it needs a live call and credits are out. If the first scored run fails with that exact message,
 * the fix is one dropdown on the credential, not a change to this node.
 */

const { lane } = require('./_lane');
const S = require('./_scoring');

const L = lane();

// Generous, because the wall clock here is one model call and a slow one is not a broken one.
const TIMEOUT_MS = 120000;
const BATCH_SIZE = 1;
const BATCH_INTERVAL_MS = 1500;

(function assertAgainstUpstream() {
  const route = require('./29-score-route.js');
  if (route.name !== 'Score Route') {
    throw new Error('Score Job: node 29 is named ' + JSON.stringify(route.name) + ' and this node hangs off "Score Route" output 0. Rename both in the same edit.');
  }
  if (!L.credentials || !L.credentials.anthropic) {
    throw new Error(
      'Score Job: lane.json has no credentials.anthropic for lane ' + String(L.lane) + '.\n' +
      '  Each lane has its own, by id, in its own config/lane.json. Refused rather than built without\n' +
      '  one: n8n renders a permanently disabled credential picker for a missing id, and the node\n' +
      '  would 401 on every call. Do not paste an id into this file, it is tracked and public.'
    );
  }
  // The price table and the cacheability floor both key on this model, and V6 leg (b) asserts it
  // against meta.model_routing.default. If it is unknown here the budget arithmetic is fiction.
  S.prices(L);
  if (S.MIN_CACHEABLE_TOKENS[L.model] === undefined) {
    throw new Error('Score Job: no cacheable-prefix minimum recorded for ' + JSON.stringify(L.model) + '. See nodes/_scoring.js.');
  }
  const gate = require('./28-budget-gate.js');
  if (String(gate.parameters.jsCode || '').indexOf('score_request') === -1) {
    throw new Error('Score Job: Budget Gate no longer builds score_request, which is the entire body this node posts.');
  }
}());

module.exports = {
  name: 'Score Job',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [4940, 40],
  connectFrom: { node: 'Score Route', outputIndex: 0 },
  // A transport failure has to arrive as DATA so Parse Score can classify it and KEEP the row.
  // Stopping the workflow here would throw away every source report sitting on the carry branch.
  onError: 'continueRegularOutput',
  notes: 'One Anthropic /v1/messages call per admitted row, claude-sonnet-4-6, no extended thinking, max_tokens 1024, one item per batch with a 1500 ms pause. The whole body comes from Budget Gate. A 4xx arrives as data with its real status code rather than as a failure, because credits are deliberately exhausted and a credit error must read as a degraded run, never as a zero score. No retry, on purpose: a retried call on a paid endpoint is a second charge.',
  parameters: {
    method: 'POST',
    url: S.ANTHROPIC_URL,
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'anthropicApi',
    // The credential supplies x-api-key and NOTHING else. See header note 2.
    sendHeaders: true,
    specifyHeaders: 'keypair',
    headerParameters: {
      parameters: [
        { name: 'anthropic-version', value: S.ANTHROPIC_VERSION },
      ],
    },
    sendBody: true,
    specifyBody: 'json',
    // Built in full by Budget Gate. Stringified rather than passed as an object because the n8n
    // json body field takes a string of JSON, and because this way the exact bytes posted are the
    // exact bytes the offline suite asserts.
    jsonBody: '={{ JSON.stringify($json.score_request) }}',
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
  credentials: {
    anthropicApi: { id: L.credentials.anthropic, name: 'Anthropic account' },
  },
};
