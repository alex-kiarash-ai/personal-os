'use strict';
/*
 * 07-fetch-ad.js - "Fetch Ad". One GET per admitted pair, for the posting itself.
 *
 * Every decision below is carried from 35-get-linkedin-detail.js, which is the node on this box
 * that already does exactly this against exactly these hosts. The reasoning is repeated rather than
 * referenced, because this workflow reads job ads from EIGHT sources and not just LinkedIn, and a
 * reader arriving here should not have to open another project to learn why there is no retry.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. responseFormat text PLUS outputPropertyName body. BOTH, OR THE BODY IS INVISIBLE.
 * ---------------------------------------------------------------------------------------------
 * With responseFormat text, n8n puts the body under `outputPropertyName`, which DEFAULTS TO `data`.
 * A parser written against `body` without this line reads undefined on every single call and
 * reports every posting as having no description, which is indistinguishable from eight job boards
 * all going quiet on the same morning. Naming it `body` also keeps it where the JSON-mode reads in
 * this workflow put theirs, so Attach Ad has one field to look at.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. A REFUSAL IS DATA, NOT A FAILURE.
 * ---------------------------------------------------------------------------------------------
 * fullResponse plus neverError plus onError continueRegularOutput. LinkedIn answers a datacenter IP
 * with 429 or 999 after roughly ten calls by its own documented behaviour, and the Hetzner box IS a
 * datacenter IP. That has to arrive as an item carrying its status code so Attach Ad can classify
 * it as a refusal and fall back to the row excerpt. Thrown, it would kill the run before the lane
 * reports, the capped pairs and the intake report reached the write-back half.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. NO RETRY, AND IT WOULD NOT FIRE EVEN IF IT WERE SET.
 * ---------------------------------------------------------------------------------------------
 * With neverError there is no node error for retryOnFail to fire on, so setting it would READ as
 * retry protection while providing none. And it would be wrong anyway: n8n retries the whole NODE,
 * so three tries over ten pairs is thirty calls at a host that refused the first ten. Retrying into
 * a soft block is how a soft block becomes a hard one. The recovery already exists and is better: a
 * refused fetch falls back to the excerpt, and a pair that could not be read at all is held rather
 * than written badly.
 *
 * ---------------------------------------------------------------------------------------------
 * 4. PACING, AND THE NUMBER IT IS COPIED FROM.
 * ---------------------------------------------------------------------------------------------
 * batchSize 1 with batchInterval 1500 makes the node sleep 1500 ms before every item after the
 * first. At the shipped cap that is at most eighteen seconds of deliberate waiting for the whole
 * run. The interval is asserted below against the collectors LinkedIn detail leg, because these are
 * the SAME box talking to the SAME host, and pacing this leg faster than that one would spend its
 * caution on a second stream LinkedIn counts together with the first.
 *
 * batchSize must be 1 and nothing else: n8n sleeps between BATCHES, so any size above 1 sends that
 * many calls back to back with no interval at all.
 *
 * ---------------------------------------------------------------------------------------------
 * 5. NO CUSTOM HEADERS, ON PURPOSE.
 * ---------------------------------------------------------------------------------------------
 * Every 200 these endpoints have returned to this system came from a default agent. A browser
 * User-Agent is an unmeasured variable, and changing it in the same move as pointing these calls at
 * eight hosts from a datacenter IP would make a 999 unattributable. If the box gets refused, the
 * report says so with the status code, and a UA is then the FIRST single variable to change.
 */

const TIMEOUT_MS = 30000;
const BATCH_SIZE = 1;
const BATCH_INTERVAL_MS = 1500;

(function assertAgainstUpstream() {
  const route = require('./06-fetch-route.js');
  if (route.name !== 'Fetch Route') {
    throw new Error('Fetch Ad: node 06 is named ' + JSON.stringify(route.name) + ' and this node hangs off "Fetch Route" output 0. Rename both in the same edit.');
  }

  // The pacing floor is the collectors own LinkedIn leg, read out of its node file rather than
  // restated. Same box, same host, so the slower of the two sets the floor for both.
  const detail = require('../../34-job-search-bi/nodes/35-get-linkedin-detail.js');
  const theirInterval = detail.parameters.options.batching.batch.batchInterval;
  if (BATCH_INTERVAL_MS < theirInterval) {
    throw new Error(
      'Fetch Ad: batchInterval is ' + BATCH_INTERVAL_MS + ' ms and the collector LinkedIn detail leg paces at ' + theirInterval + ' ms.\n' +
      '  These are the SAME box talking to the SAME host, so the slower one sets the floor. Pacing this\n' +
      '  leg faster would spend that leg caution on a second stream LinkedIn counts together with it.'
    );
  }
  if (BATCH_SIZE !== 1) {
    throw new Error('Fetch Ad: batchSize is ' + BATCH_SIZE + '. n8n sleeps between BATCHES, so any size above 1 sends that many calls back to back with no interval at all.');
  }
}());

module.exports = {
  name: 'Fetch Ad',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [1300, 0],
  connectFrom: { node: 'Fetch Route', outputIndex: 0 },
  onError: 'continueRegularOutput',
  notes: 'One GET per admitted pair, paced 1500 ms apart, text response landed on `body`. Never errors: a 429, a 999 or an authwall arrives as a normal item with its status code and Attach Ad classifies it as a refusal and falls back to the row excerpt, rather than reporting a posting with no description. No retry and no custom headers, both deliberate.',
  parameters: {
    method: 'GET',
    url: '={{ $json.ad_fetch_url }}',
    options: {
      batching: { batch: { batchSize: BATCH_SIZE, batchInterval: BATCH_INTERVAL_MS } },
      timeout: TIMEOUT_MS,
      response: {
        response: {
          fullResponse: true,
          neverError: true,
          responseFormat: 'text',
          outputPropertyName: 'body',
        },
      },
    },
  },
};
