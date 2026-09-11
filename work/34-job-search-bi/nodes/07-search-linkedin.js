'use strict';
/*
 * 07-search-linkedin.js - one paced GET per planned LinkedIn search. Never fails the run.
 *
 * THE NUMBER THIS NODE EXISTS TO SURVIVE. Plan Queries emits 12 LinkedIn calls for this lane and
 * 14 for #35, against a documented threshold of roughly ten pages before a datacenter IP starts
 * getting HTTP 429 or 999, and the n8n box IS a datacenter IP. Stage A refused to trim search
 * terms to fit under that number, because collecting less and saying nothing is the failure this
 * whole lane is built to avoid. So the consequence lands here: pace the calls, and make a refusal
 * look different from a quiet day.
 *
 * PACING, and what it actually costs. batchSize 1 with batchInterval 1500 makes n8n sleep 1500 ms
 * before every item after the first (measured in the node's own source: it sleeps when
 * `itemIndex > 0 && itemIndex % batchSize === 0`). So 12 calls means 11 sleeps, about 16.5 s, plus
 * the requests themselves, which the one live probe returned in 0.51 s. Budget roughly 22 to 25
 * seconds of wall clock for the LinkedIn leg of a BI run, and about 26 to 29 for #35's 14 calls.
 * That is the whole price of not hammering a source that can lock this box out.
 *
 * THE FOUR SETTINGS THAT MAKE A REFUSAL VISIBLE, and they only work together:
 *   neverError            a non-2xx stops being an exception and arrives as a normal item carrying
 *                         its real statusCode. Without it a 429 becomes an error string and the
 *                         status has to be scraped out of a message, which is exactly how a
 *                         refusal gets rounded down to "something went wrong".
 *   fullResponse          the item carries statusCode, statusMessage and headers, not just a body.
 *                         A body-only node cannot tell 200-with-no-jobs from 999-go-away, and
 *                         those two produce the same row count and mean opposite things.
 *   responseFormat text   this endpoint returns an HTML fragment. Autodetect would land on text
 *                         anyway for text/html, but naming it means a future content-type change
 *                         cannot silently switch the parser's input from a string to an object.
 *   onError               continueRegularOutput. Call 8 dying must not throw away calls 1 to 7.
 *
 * WHERE THE BODY LANDS, because this one is a trap. With fullResponse AND a text response format,
 * n8n does NOT put the body on `json.body` by default: it puts it under `outputPropertyName`,
 * which defaults to `data`. Verified in the node's own source (HttpRequestV3, the responseFormat
 * === 'text' branch: `returnItem[outputPropertyName] = toText(response[property])` for the body,
 * while headers, statusCode and statusMessage keep their own names). So outputPropertyName is set
 * to 'body' EXPLICITLY here, which makes the item `{ body, headers, statusCode, statusMessage }`
 * and makes it read the same way as the JSON branch. An extractor written against `json.body`
 * without this line would read undefined on every single call and report twelve empty results.
 *
 * RETRY IS DELIBERATELY OFF (orchestrator, 2026-09-11). The brief asked for retry 3 and this node
 * had it. Removed after measuring the cost both ways.
 *   - With neverError, a 429 or 999 is a NORMAL item, so a refusal never triggers a retry anyway.
 *     Retry could only ever fire on a genuine transport failure.
 *   - n8n retries the NODE, not the failing item, so maxTries 3 over 12 planned calls is a worst
 *     case of 36 LinkedIn calls in one run, against a documented threshold of about 10 before a
 *     datacenter IP starts getting refused. maxTries 2 still allows 24.
 *   - The recovery it would buy is already built elsewhere and is strictly better: last_run_at only
 *     advances on a clean run, so a failed or degraded run leaves the window open and the NEXT run
 *     re-covers the same period. A transient blip costs a few hours of latency, not a lost job.
 * Retrying into a soft block is how a soft block becomes a hard one, and the thing being protected
 * is the only free source of Swedish jobs in this lane.
 *
 * NO CUSTOM HEADERS, AND THAT IS A DECISION. The obvious move is a browser User-Agent, and it is
 * not made here. Every 200 this lane has ever seen came from curl's default agent from a
 * residential IP (Agent 1's probe, and the one live capture behind config/samples/). A browser UA
 * is an unmeasured variable, and changing it in the same move as putting the calls on a new IP
 * would make a 999 unattributable: nobody could say whether the box was blocked or the header was.
 * So v1 ships the measured request. If the box gets 999, the extractor says so with the status
 * code, and a UA is then the FIRST single variable to change, with the answer readable from the
 * next run report. Same reason Accept-Language is absent: it can change the language of returned
 * titles and nobody has measured that against the Swedish queries.
 *
 * The URL is taken from the item because Plan Queries already assembled it, encoded it, and
 * dropped the params it deliberately omits. Rebuilding it here would be a second place for the
 * endpoint to live. The method is hardcoded GET rather than read from the item, and asserted
 * against the contract at build time: an expression that resolved to POST would silently change
 * what this node does to a source that bills nothing and blocks fast.
 */

const { sources } = require('./_lane');
const SRC = sources().sources;

const SOURCE_KEY = 'linkedin_guest_search';

// Pacing. Read by 08-extract-linkedin.js at BUILD time so the run report quotes the real numbers
// rather than a copy that can drift. Change them here and the report follows.
const BATCH_SIZE = 1;
const BATCH_INTERVAL_MS = 1500;
const TIMEOUT_MS = 30000;
const MAX_TRIES = 3;
const WAIT_BETWEEN_TRIES_MS = 5000; // n8n clamps this to 5000, so this is the maximum available

(function assertAgainstContract() {
  const s = SRC[SOURCE_KEY];
  if (!s) {
    throw new Error('Search LinkedIn: the shared contract has no source called ' + SOURCE_KEY + '. It carries: ' + Object.keys(SRC).join(', '));
  }
  if (s.method !== 'GET') {
    throw new Error(
      'Search LinkedIn: the contract says ' + SOURCE_KEY + ' is a ' + s.method + ' and this node hardcodes GET.\n' +
      '  A collector that sends the wrong verb to a source that blocks fast is not a config detail.'
    );
  }
  if (s.response_type !== 'html_fragment') {
    throw new Error(
      'Search LinkedIn: the contract now calls ' + SOURCE_KEY + ' a ' + s.response_type + ', not an html_fragment.\n' +
      '  This node asks for responseFormat text and 08-extract-linkedin.js parses HTML cards. If the\n' +
      '  surface became JSON, both change together or the extractor reports twelve changed-markup\n' +
      '  failures against a source that is working fine.'
    );
  }
  if (s.auth !== 'none') {
    throw new Error(
      'Search LinkedIn: the contract says ' + SOURCE_KEY + ' now needs auth (' + s.auth + '), and this node\n' +
      '  attaches no credential. An unauthenticated call to an authenticated endpoint returns 401, which\n' +
      '  this lane would report as a refusal. Wire the credential, or the report will blame the IP.'
    );
  }
  if (BATCH_INTERVAL_MS < 1500) {
    throw new Error('Search LinkedIn: batchInterval is ' + BATCH_INTERVAL_MS + ' ms. The floor for this source is 1500.');
  }
}());

module.exports = {
  name: 'Search LinkedIn',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [1300, 0],
  connectFrom: 'LinkedIn Units Only',
  outputIndex: 0,
  onError: 'continueRegularOutput',
  notes: 'One GET per planned LinkedIn search, paced ' + BATCH_INTERVAL_MS + ' ms apart. Never errors: a 429 or a 999 arrives as a normal item with its status code and is classified by the next node as a refusal, not as an empty result.',
  parameters: {
    url: '={{ $json.url }}',
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
 * 08-extract-linkedin.js reads the pacing numbers back out of the exported object above, at BUILD
 * time, so the run report quotes what this node is actually configured to do. There is deliberately
 * no extra key holding a second copy: build.js refuses any top-level key outside its allowlist, and
 * a helper value smuggled in beside the node definition is exactly the shape it refuses. The real
 * parameters are the one source of truth, which is the point.
 */

