'use strict';
/*
 * 17-fetch-company-site.js - "Fetch Company Site". One GET per company, for the employer's own page.
 *
 * Every decision is the one 07-fetch-ad.js already made and proved, with one number different, and
 * the reasoning is repeated rather than referenced because a reader arriving at this node should not
 * have to open another file to learn why there is no retry.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. responseFormat text PLUS outputPropertyName body. BOTH, OR THE BODY IS INVISIBLE.
 * ---------------------------------------------------------------------------------------------
 * With responseFormat text, n8n puts the body under `outputPropertyName`, which DEFAULTS TO `data`.
 * A reader written against `body` without this line gets undefined on every call and reports every
 * company as having no readable site, which is indistinguishable from a morning of board-hosted
 * postings. Naming it `body` also puts it where the ad fetch puts its own, so Build Research Request
 * has one field to look at rather than two.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. A REFUSAL IS DATA, NOT A FAILURE, AND HERE THAT IS ALMOST THE NORMAL CASE.
 * ---------------------------------------------------------------------------------------------
 * fullResponse plus neverError plus onError continueRegularOutput. A corporate homepage is behind a
 * CDN more often than a job ad is, and a datacenter IP asking for one gets a 403, a challenge page
 * or a redirect loop routinely. Every one of those has to arrive as an ITEM carrying its status code
 * so Build Research Request can decide there is nothing to research and spend nothing. Thrown, it
 * would kill the run before the pairs, the lane reports and three stage reports reached the write
 * back half, over a company website.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. NO RETRY, AND IT WOULD NOT FIRE EVEN IF IT WERE SET.
 * ---------------------------------------------------------------------------------------------
 * With neverError there is no node error for retryOnFail to fire on, so setting it would READ as
 * retry protection while providing none. It would also be wrong on its own terms: n8n retries the
 * whole NODE, so three tries over six companies is eighteen requests to hosts that refused the first
 * six. The recovery already exists and is better: no site text means no hook, and D6 says a letter
 * with no hook is the correct outcome rather than a failure.
 *
 * ---------------------------------------------------------------------------------------------
 * 4. THE TIMEOUT IS 20000 AND THE PLAN CHOSE IT.
 * ---------------------------------------------------------------------------------------------
 * The approved plan pins it: "GET text, 1,500 ms pacing, timeout 20000". Ten seconds shorter than
 * the ad fetch, and the difference is the right way round. A job ad that loads slowly is still the
 * material the whole run is about; a company homepage that loads slowly is a nice-to-have, and
 * making the run wait thirty seconds for a marketing site is spending the run's wall clock on the
 * least load-bearing call in it.
 *
 * ---------------------------------------------------------------------------------------------
 * 5. PACING, AND WHY IT IS HERE EVEN THOUGH EVERY CALL GOES TO A DIFFERENT HOST.
 * ---------------------------------------------------------------------------------------------
 * batchSize 1 with batchInterval 1500 sleeps 1500 ms before every item after the first. Unlike the
 * ad fetch these calls are spread across different companies, so no single host is being paced. It
 * is kept anyway for two reasons: the box makes one outbound identity for every one of these lanes
 * and a burst of simultaneous requests from a datacenter IP is exactly the shape a CDN scores as a
 * crawler, and at a cap of ten pairs the whole cost is at most fifteen seconds of waiting.
 *
 * batchSize must be 1 and nothing else: n8n sleeps between BATCHES, so any size above 1 sends that
 * many calls back to back with no interval at all.
 *
 * ---------------------------------------------------------------------------------------------
 * 6. NO CUSTOM HEADERS AND NO REDIRECT LIMIT CHANGE, ON PURPOSE.
 * ---------------------------------------------------------------------------------------------
 * A browser User-Agent is an unmeasured variable. If corporate sites refuse the box, the report says
 * so with the status code, and a UA is then the FIRST single variable to change rather than one of
 * two things that changed together.
 */

const TIMEOUT_MS = 20000;
const BATCH_SIZE = 1;
const BATCH_INTERVAL_MS = 1500;

(function assertAgainstUpstream() {
  const route = require('./16-site-route.js');
  if (route.name !== 'Site Route') {
    throw new Error('Fetch Company Site: node 16 is named ' + JSON.stringify(route.name) + ' and this node hangs off "Site Route" output 0. Rename both in the same edit.');
  }

  // The pacing floor is the collectors own LinkedIn detail leg, read out of its node file rather
  // than restated. Same box, and a slower neighbour on the same machine sets the floor for a lane
  // that is not load bearing.
  const detail = require('../../34-job-search-bi/nodes/35-get-linkedin-detail.js');
  const theirInterval = detail.parameters.options.batching.batch.batchInterval;
  if (BATCH_INTERVAL_MS < theirInterval) {
    throw new Error(
      'Fetch Company Site: batchInterval is ' + BATCH_INTERVAL_MS + ' ms and the collector detail leg paces at ' + theirInterval + ' ms.\n' +
      '  This is the least load bearing call in the workflow and it must not be the fastest one on the box.'
    );
  }
  if (BATCH_SIZE !== 1) {
    throw new Error('Fetch Company Site: batchSize is ' + BATCH_SIZE + '. n8n sleeps between BATCHES, so any size above 1 sends that many calls back to back with no interval at all.');
  }
  // The approved plan pins the timeout. A seat that quietly widens a number the plan chose is worse
  // than one that says so, so this refuses rather than drifts.
  if (TIMEOUT_MS !== 20000) {
    throw new Error('Fetch Company Site: the approved plan pins timeout 20000 for this node and this build sets ' + TIMEOUT_MS + '. Change the plan, or change this back.');
  }
}());

module.exports = {
  name: 'Fetch Company Site',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [3900, 0],
  connectFrom: { node: 'Site Route', outputIndex: 0 },
  onError: 'continueRegularOutput',
  notes: 'One GET per company, paced 1500 ms apart, timeout 20000, text response landed on `body`. Never errors: a 403, a challenge page or a dead host arrives as a normal item with its status code and Build Research Request treats it as nothing to research and spends nothing. No retry and no custom headers, both deliberate.',
  parameters: {
    method: 'GET',
    url: '={{ $json.site_fetch_url }}',
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
