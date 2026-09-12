'use strict';
/*
 * 35-get-linkedin-detail.js - "Get LinkedIn Detail". One paced GET per new LinkedIn row that
 * survived dedupe. Never fails the run.
 *
 * WHAT IT FETCHES, measured live 2026-09-12 from this machine's residential IP:
 *   GET https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4462976291
 *   HTTP 200, 75,677 bytes, 0.36 s, text/html, no authwall marker, no challenge.
 *   The description is in div.show-more-less-html__markup and the criteria list in
 *   ul.description__job-criteria-list. Both present, both parsed by 37-attach-detail.js.
 * The source contract said 22 KB and the Stage C probe measured 49,605 bytes; this one is 75,677.
 * The size varies with the length of the posting and is not a stable fact, which is now written
 * into the contract instead of a number that reads as one.
 *
 * WHY THIS IS A SEPARATE HTTP NODE AND NOT A REUSE OF `Search LinkedIn`. Different url shape,
 * different response shape, different parser, and above all a different CALL BUDGET: the page guard
 * on 07 counts search calls and this leg is counted by `Detail Gate`, which owns the whole-run
 * total across both. Two legs sharing one node would make the two counts one number and neither
 * could be capped on its own.
 *
 * PACING, and what it costs. batchSize 1 with batchInterval 1500 makes n8n sleep 1500 ms before
 * every item after the first (measured in the node's own source: it sleeps when
 * `itemIndex > 0 && itemIndex % batchSize === 0`). The shipped budget admits at most 10 rows, so
 * that is 9 sleeps, about 13.5 s, plus the requests themselves at roughly 0.4 s each. Budget about
 * 17 seconds of wall clock for a full detail leg. That is the whole price of not hammering a source
 * that can lock this box out, and the interval matches `07-search-linkedin.js` exactly because the
 * two legs are the same IP talking to the same host.
 *
 * THE FOUR SETTINGS THAT MAKE A REFUSAL VISIBLE, identical to 07 and load-bearing for the same
 * reasons. A 429 or a 999 is a REFUSED SOURCE, never an empty description:
 *   neverError            a non-2xx arrives as a normal item carrying its real statusCode instead
 *                         of as an exception whose status has to be scraped out of a message.
 *   fullResponse          the item carries statusCode, statusMessage and headers. Without it a
 *                         999-go-away and a 200-with-a-short-body are indistinguishable, and they
 *                         mean opposite things: one is a blocked box and the other is a thin ad.
 *   responseFormat text   this endpoint returns an HTML fragment.
 *   outputPropertyName    'body', EXPLICITLY. With fullResponse and a text format, n8n puts the
 *                         body under `outputPropertyName`, which defaults to `data`
 *                         (HttpRequestV3, the responseFormat === 'text' branch). A parser written
 *                         against json.body without this line reads undefined on every call and
 *                         reports every posting as having no description, which is exactly the
 *                         symptom this whole stage exists to remove.
 *   onError               continueRegularOutput. Call 4 dying must not throw away calls 1 to 3, and
 *                         must not take the carry branch's source reports down with it.
 *
 * RETRY IS OFF, same decision as 07 and for the same measured reasons. With neverError a refusal is
 * a normal item, so a retry could only ever fire on a genuine transport failure; n8n retries the
 * NODE rather than the failing item, so maxTries 3 over 10 planned calls is a worst case of 30
 * detail calls against a documented threshold of about ten; and the recovery it would buy already
 * exists and is better, because a degraded run does not advance last_run_at and the next run
 * re-covers the window. Retrying into a soft block is how a soft block becomes a hard one.
 *
 * NO CUSTOM HEADERS, same decision as 07. Every 200 this lane has seen came from curl's default
 * agent, including this endpoint's two probes. A browser User-Agent is an unmeasured variable and
 * changing it in the same move as putting these calls on a datacenter IP would make a 999
 * unattributable. If the box gets refused, the report says so with the status code and a UA is then
 * the FIRST single variable to change.
 *
 * NO JINA FALLBACK, AND THAT IS A DECISION RATHER THAN AN OMISSION. The dispatch documented a chain
 * that falls back to https://r.jina.ai/https://www.linkedin.com/jobs/view/{id} on a 429 or a 999,
 * and told me to build it only if it were clean to do so. It is not, for four reasons and any one
 * of them is enough:
 *   1. IT HIDES THE SIGNAL THIS LANE MOST NEEDS. D20, whether the Hetzner box gets blocked, is the
 *      single largest open unknown here. A fallback that quietly succeeds means the run reports ok
 *      while the box is being refused, and nobody learns it until the fallback breaks too.
 *   2. IT IS A NEW OUTBOUND CHANNEL. Every posting would travel to a third party's servers. The
 *      root constitution's Outbound Channels rule says a new channel needs a row in that list and a
 *      log, and that is Shaheen's call to make, not a build dispatch's.
 *   3. IT DOES NOT REDUCE THE LOAD ON LINKEDIN, it moves it to Jina's IP, and it ADDS calls: a
 *      refused run would make its LinkedIn calls and then up to the same number again.
 *   4. IT IS A SECOND PARSER. The Reader returns markdown of the public /jobs/view page, not this
 *      guest fragment, so it needs its own selectors, its own sample, and its own markup-change
 *      failure mode. The dispatch's own words are not to half-build a three-way chain.
 * So this node degrades honestly instead: a refusal is classified as `refused`, every row is still
 * scored, and the run report names the status code. The fallback becomes the right build the day
 * the box is actually refused AND Shaheen approves the outbound channel, and the card says so.
 * The optional Jina probe was not spent either: the decision does not turn on a measurement, and
 * one fewer unmeasured third party was touched from this machine.
 */

const { sources } = require('./_lane');
const SRC = sources().sources;

const SOURCE_KEY = 'linkedin_guest_detail';
const SEARCH_NODE = require('./07-search-linkedin.js');

// Pacing. Read back by 33-detail-gate.js at BUILD time so the run report quotes the real numbers
// rather than a copy that can drift.
const BATCH_SIZE = 1;
const BATCH_INTERVAL_MS = 1500;
const TIMEOUT_MS = 30000;

(function assertAgainstContract() {
  const s = SRC[SOURCE_KEY];
  if (!s) {
    throw new Error('Get LinkedIn Detail: the shared contract has no source called ' + SOURCE_KEY + '. It carries: ' + Object.keys(SRC).join(', '));
  }
  if (s.method !== 'GET') {
    throw new Error('Get LinkedIn Detail: the contract says ' + SOURCE_KEY + ' is a ' + s.method + ' and this node sends a GET.');
  }
  if (s.response_type !== 'html_fragment') {
    throw new Error(
      'Get LinkedIn Detail: the contract now calls ' + SOURCE_KEY + ' a ' + s.response_type + ', not an html_fragment.\n' +
      '  This node asks for responseFormat text and 37-attach-detail.js parses HTML. If the surface became\n' +
      '  JSON, both change together or the extractor reports every posting as markup_changed against a\n' +
      '  source that is working fine.'
    );
  }
  if (s.auth !== 'none') {
    throw new Error('Get LinkedIn Detail: the contract says ' + SOURCE_KEY + ' now needs auth (' + s.auth + '), and this node attaches no credential. A 401 would be reported as a refusal and the IP would take the blame.');
  }
  // The floor is the search leg's own interval, because both legs are the same IP talking to the
  // same host. A detail leg pacing faster than the search leg would undo the search leg's pacing.
  const searchInterval = SEARCH_NODE.parameters.options.batching.batch.batchInterval;
  if (BATCH_INTERVAL_MS < searchInterval) {
    throw new Error(
      'Get LinkedIn Detail: batchInterval is ' + BATCH_INTERVAL_MS + ' ms and Search LinkedIn paces at ' + searchInterval + ' ms.\n' +
      '  These two legs are the SAME IP talking to the SAME host, so the slower one sets the floor. Pacing\n' +
      '  this leg faster would spend the search leg\'s caution on a second stream LinkedIn counts together.'
    );
  }
  if (BATCH_SIZE !== 1) {
    throw new Error('Get LinkedIn Detail: batchSize is ' + BATCH_SIZE + '. n8n sleeps between BATCHES, so any size above 1 sends that many calls back to back with no interval at all.');
  }
}());

module.exports = {
  name: 'Get LinkedIn Detail',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [4460, 380],
  connectFrom: { node: 'Detail Route', outputIndex: 0 },
  onError: 'continueRegularOutput',
  notes: 'One GET per new LinkedIn row, paced ' + BATCH_INTERVAL_MS + ' ms apart, at most as many as Detail Gate admitted under the whole-run LinkedIn budget. Never errors: a 429 or a 999 arrives as a normal item with its status code and is classified by Attach Detail as a REFUSAL, never as a posting with no description.',
  parameters: {
    url: '={{ $json.detail_url }}',
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

/*
 * 33-detail-gate.js reads the pacing numbers back out of the exported object above, at BUILD time,
 * so the run report quotes what this node is actually configured to do. There is deliberately no
 * extra key holding a second copy: build.js refuses any top-level key outside its allowlist, and a
 * helper value smuggled in beside the node definition is exactly the shape it refuses.
 */
