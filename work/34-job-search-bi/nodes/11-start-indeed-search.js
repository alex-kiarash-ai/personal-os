'use strict';
/*
 * 11-start-indeed-search.js - ONE POST that starts a paid Bright Data scrape. Never fails the run.
 *
 * This is the only node in either lane that SPENDS MONEY, and it is the only node whose request has
 * never been observed working. Both facts shape every setting below.
 *
 * IT RUNS ONCE, AND THAT IS LOAD BEARING. Build Indeed Request folded every planned Indeed unit into
 * a single item, so this node fires exactly one trigger no matter how many search terms are
 * configured. If a future edit ever lets more than one item reach this node, this becomes one paid
 * scrape per item. The guard for that is upstream, in Build Indeed Request, which returns exactly one
 * item and throws if the units disagree about the endpoint.
 *
 * neverError + fullResponse, for the same reason as the LinkedIn collector and one more. A lapsed
 * Bright Data account answers with a real HTTP status and a real body ("Customer is not active" has
 * already happened once to this account, which is why the contract carries it as a rate_note). With
 * neverError off, that arrives as an exception string and the status has to be scraped out of a
 * message, which is how a dead account gets rounded down to "something went wrong" and then polled
 * against for ten minutes. With it on, the status is data, and Indeed Poll Guard reads it on the
 * first pass and stops.
 *
 * onError continueRegularOutput. A dead Indeed leg must not take the LinkedIn rows down with it. The
 * whole lane's contract is that a failing source is reported, not thrown.
 *
 * NO RETRY, and the reason is sharper here than it was for LinkedIn. A retried POST to a trigger
 * endpoint is not a repeated read, it is a SECOND PAID SCRAPE. n8n retries the NODE, so maxTries 3
 * would mean up to three snapshots billed for one run, and with neverError on, a refusal is a normal
 * item that would never have triggered a retry anyway. The only thing retry could fire on is a
 * transport failure, and the recovery for that is already built and is strictly better: last_run_at
 * only advances on a clean run, so a degraded run leaves the window open and the next run re-covers
 * it. A transient blip costs hours of latency. A retried trigger costs money, twice.
 *
 * THE CREDENTIAL IS ATTACHED BY ID AND THE KEY IS NOWHERE IN THIS REPO. That is not a convention
 * here, it is the whole reason the Stage C probe could not run: `GET /api/v1/credentials/<id>` on the
 * live box returns metadata with no data field, and system/credentials-ledger.json records the key as
 * living in the n8n credential and nowhere else. A Code node could not have made this call either:
 * `this.helpers.httpRequestWithAuthentication` is deny listed in the task runner sandbox, so the only
 * way to send an authenticated request from inside n8n without typing a secret into a tracked file is
 * an HTTP Request node with a credential id. That is why this branch is built out of HTTP nodes and a
 * Wait loop rather than one self-contained Code node.
 *
 * The generic header auth binding below (`genericCredentialType` + `genericAuthType: httpHeaderAuth`
 * + a `httpHeaderAuth` credentials key) is not a guess: it is the shape this box already uses, read
 * back off the live workflow list as a platform fact. A wrong spelling there would send the request
 * with NO Authorization header, and Bright Data would answer 401, which this lane would then report
 * as a lapsed account. The report would be wrong and the account would be fine.
 */

const { lane, sources } = require('./_lane');
const SRC = sources().sources;
const L = lane();

const SOURCE_KEY = 'brightdata_indeed';
const S = SRC[SOURCE_KEY];

const TIMEOUT_MS = 60000;

(function assertAgainstContract() {
  if (!S) {
    throw new Error('Start Indeed Search: the shared contract has no source called ' + SOURCE_KEY + '. It carries: ' + Object.keys(SRC).join(', '));
  }
  if (!/^POST/.test(String(S.method))) {
    throw new Error(
      'Start Indeed Search: the contract says ' + SOURCE_KEY + ' is a "' + S.method + '" and this node hardcodes POST\n' +
      '  for the trigger leg. The trigger is the billed call. A verb change here is not a config detail.'
    );
  }
  if (!/api\.brightdata\.com/.test(String(S.endpoint))) {
    throw new Error('Start Indeed Search: the contract endpoint for ' + SOURCE_KEY + ' is no longer a Bright Data url (' + S.endpoint + '). The credential attached here is a Bright Data key and must not be sent anywhere else.');
  }
  if (!/^n8n header auth credential /.test(String(S.auth))) {
    throw new Error(
      'Start Indeed Search: the contract auth note for ' + SOURCE_KEY + ' is "' + S.auth + '".\n' +
      '  This node attaches a generic header auth credential by id. If the source moved to another auth\n' +
      '  scheme, the request would go out unauthenticated, come back 401, and be reported as a lapsed\n' +
      '  account. A wrong diagnosis on a paid source is worse than a loud failure.'
    );
  }
  const credId = (L.credentials || {}).brightdata_header_auth;
  if (!credId) {
    throw new Error(
      'Start Indeed Search: lane #' + L.lane + "'s config/lane.json has no credentials.brightdata_header_auth id.\n" +
      '  The Bright Data key is never inlined: nodes/ is tracked and this repo is PUBLIC, so the ID lives in\n' +
      "  the lane file (config/ is gitignored) and the KEY itself lives only inside n8n's credential store.\n" +
      '  THIS IS THE KNOWN BLOCKER ON PORTING STAGE C TO #35. The BI lane file carries this id and the AI\n' +
      '  lane file does not, so unlike Stages A and B the Indeed branch is NOT a byte-identical copy. Decide\n' +
      '  it deliberately rather than by copying: either the AI lane is allowed to spend on the same Bright\n' +
      '  Data account, in which case add the same id to work/35-job-search-ai/config/lane.json, or it is not,\n' +
      '  in which case the AI lane ships without node files 09 to 16 and its plan never emits an Indeed unit.\n' +
      '  Failing here is correct: the alternative is an AI lane that builds green and 401s on a paid source.'
    );
  }
  if (!/^[A-Za-z0-9]{8,}$/.test(String(credId))) {
    throw new Error('Start Indeed Search: lane.json credentials.brightdata_header_auth is ' + JSON.stringify(credId) + ', which is not an n8n credential id. This field takes an ID, never a key.');
  }
}());

module.exports = {
  name: 'Start Indeed Search',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [1820, 320],
  connectFrom: 'Build Indeed Request',
  onError: 'continueRegularOutput',
  notes: 'ONE POST that starts a paid Bright Data scrape and returns a snapshot_id. Never errors and is never retried: a retried trigger is a second billed scrape, and a refusal has to arrive as data so the poll guard can tell a lapsed account from a snapshot that is still building.',
  parameters: {
    method: 'POST',
    // Assembled upstream, in Build Indeed Request, from the contract. Rebuilding it here would put
    // the endpoint in two places.
    url: '={{ $json.trigger_url }}',
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    // The body is an ARRAY of input objects, which is what limit_per_input means: the cap is applied
    // per input, so the endpoint expects a list. JSON.stringify rather than an object expression
    // because the top level is an array and n8n's json body field takes a string of JSON.
    jsonBody: '={{ JSON.stringify($json.trigger_body) }}',
    options: {
      timeout: TIMEOUT_MS,
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
    httpHeaderAuth: { id: L.credentials.brightdata_header_auth, name: 'Bright Data Header Auth' },
  },
};
