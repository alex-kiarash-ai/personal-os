'use strict';
/*
 * 17-fetch-board.js - one paced GET per enabled board. Six different hosts, six different rate
 * policies, and none of them may fail the run.
 *
 * WHERE IT HANGS. Off `Indeed Units Only` output 1, which Stage C left deliberately unwired and
 * counted. Output 1 is "everything that is neither LinkedIn nor Indeed", which after two routers is
 * exactly the board units. So this node needs no third router: the two upstream IFs already did the
 * splitting, and the six board units are what is left.
 *
 * WHAT ONE ITEM IS. One planned board unit, carrying a url Plan Queries already assembled, encoded
 * and stripped of the params it deliberately omits. The url is taken from the item rather than
 * rebuilt here, for the same reason the LinkedIn collector takes it: rebuilding is a second place
 * for the endpoint to live, and two places drift.
 *
 * PACING, AND THE HONEST LIMIT OF WHAT PACING BUYS. The strictest policies in the contract are
 * Remotive's "a maximum of about 4 calls per day" and Jobicy's "a few polls a day, not more". Those
 * are DAILY budgets, and a batchInterval cannot enforce a daily budget: it only spaces calls inside
 * one run. What actually keeps this lane inside both numbers is the call COUNT, which is exactly one
 * per host per run (every board is a whole feed or a single page, never a paging loop), against a
 * weekday 06:30 schedule. One run a day, one call per host, is 1 of Remotive's 4 and 1 of Jobicy's
 * few. That is the real compliance argument and it is worth writing down, because someone who later
 * adds a retry, a second daily run, or a paging loop to a board will be spending a budget that the
 * interval below does not protect.
 *
 * So what the 2000 ms interval IS for: these are six small free services on six different hosts, the
 * payloads run to 2 MB (Arbeitnow) and 800 KB (Jobicy), and arriving as six simultaneous requests
 * buys nothing. Five sleeps, ten seconds, on an unattended job. It is also the floor asserted at
 * build time, so a future edit cannot quietly make this lane a burst.
 *
 * WHY responseFormat json AND fullResponse, and the second job fullResponse is doing here.
 *   The obvious job is the one the LinkedIn and Indeed collectors already rely on: a non-2xx has to
 *   arrive as DATA carrying its real status code, or a refusal gets rounded down to "no jobs". Two
 *   of these six boards state outright that they suspend or terminate access for misuse, so the one
 *   thing this node must never do is report a 429 as a quiet day.
 *   The second job is specific to this stage and it is a trap. TWO of the six boards answer with a
 *   BARE JSON ARRAY (RemoteOK, Working Nomads). n8n's HTTP Request node, given a json response
 *   format and NO fullResponse, splits an array response into one n8n item per element. That would
 *   turn six calls into roughly 400 items, each one a single job object with no status code, no url
 *   and nothing to say which board it came from, and the extractor would be handed a stream it
 *   cannot correlate. With fullResponse on, the body sits under `body` inside a wrapper object, the
 *   wrapper is not an array, and one call stays one item.
 *   That explanation is not trusted on its own: 18-extract-board-jobs.js DETECTS the split case at
 *   runtime (two response items pointing at the same planned unit) and reports it by name, because
 *   an assertion about someone else's node is a belief until the run proves it.
 *
 * onError continueRegularOutput. Six independent feeds means six independent ways to fail, and
 * partial success is the normal case. Board four dying must not throw away boards one to three, nor
 * the LinkedIn rows already collected upstream in the same execution.
 *
 * NO RETRY, and here the reason is stronger than it was for LinkedIn. n8n retries the NODE, not the
 * failing item, so one retry over six planned calls is twelve calls: a second call to every board
 * including the five that just answered fine. Against Remotive's 4-per-day that single retry spends
 * half the day's budget on boards that did not need it. The recovery a retry would buy is already
 * built and is strictly better: last_run_at only advances on a clean run, so a degraded run leaves
 * the window open and the next run re-covers it.
 *
 * NO CUSTOM HEADERS. Same decision as the LinkedIn collector and the same reason: every 200 these
 * six have given this lane came from curl's default agent, so shipping the measured request keeps a
 * future refusal attributable to the address rather than to an unmeasured header.
 *
 * Endpoints, methods, response types and auth all come from the shared contract at
 * config/sources.json and are asserted against it below. Nothing about the outside world is typed
 * into this file.
 */

const fs = require('fs');
const path = require('path');
const { sources } = require('./_lane');
const SRC = sources().sources;

// Pacing. Read back at BUILD time by 18-extract-board-jobs.js so the run report quotes what this
// node is actually configured to do, never a second copy that can drift.
const BATCH_SIZE = 1;
const BATCH_INTERVAL_MS = 2000;
const BATCH_INTERVAL_FLOOR_MS = 1500;
const TIMEOUT_MS = 45000;

// Which sources this node fetches. READ from the generated code of 05-plan-queries.js rather than
// declared here, so there is exactly one place in this lane that decides what a "board" is. Plan
// Queries already fails its own build when the contract gains or renames a source, so the chain is:
// contract changes -> Plan Queries refuses until it is classified -> BOARD_KEYS moves -> this node
// and the extractor follow automatically, and the extractor refuses until the new board has a mapper.
const BOARD_KEYS = (function readBoardKeys() {
  const file = path.join(__dirname, '05-plan-queries.js');
  const code = require(file).parameters.jsCode;
  const m = /const BOARD_KEYS = (\[[^\]]*\]);/.exec(code);
  if (!m) {
    throw new Error(
      'Fetch Board: could not read BOARD_KEYS out of 05-plan-queries.js.\n' +
      '  That line is how this stage learns which sources are boards. If the generator stopped\n' +
      '  emitting it, declaring a local copy here would be the wrong fix: two lists is how a board\n' +
      '  gets planned and never collected, or collected and never planned.'
    );
  }
  const keys = JSON.parse(m[1]);
  if (!Array.isArray(keys) || !keys.length) throw new Error('Fetch Board: BOARD_KEYS in 05-plan-queries.js is empty.');
  return keys;
}());

(function assertAgainstContract() {
  for (const key of BOARD_KEYS) {
    const s = SRC[key];
    if (!s) {
      throw new Error('Fetch Board: Plan Queries plans a board called ' + key + ' and the shared contract has no such source. It carries: ' + Object.keys(SRC).join(', '));
    }
    if (s.method !== 'GET') {
      throw new Error(
        'Fetch Board: the contract says ' + key + ' is a ' + s.method + ' and this node hardcodes GET.\n' +
        '  A collector that sends the wrong verb to a free service that can suspend access is not a\n' +
        '  config detail. Change the node deliberately, or fix the contract.'
      );
    }
    if (s.response_type !== 'json') {
      throw new Error(
        'Fetch Board: the contract now calls ' + key + ' a ' + s.response_type + ', not json.\n' +
        '  This node asks for responseFormat json and 18-extract-board-jobs.js walks a parsed\n' +
        '  envelope. If that surface became HTML, both change together, or the extractor reports a\n' +
        '  changed shape against a board that is working perfectly.'
      );
    }
    if (s.auth !== 'none') {
      throw new Error(
        'Fetch Board: the contract says ' + key + ' now needs auth (' + s.auth + '), and this node\n' +
        '  attaches no credential. An unauthenticated call to an authenticated endpoint returns 401,\n' +
        '  which this lane reports as a refusal, so the run report would blame the address instead of\n' +
        '  the missing credential.'
      );
    }
    if (!s.rate_note) {
      throw new Error('Fetch Board: the contract has no rate_note for ' + key + '. The pacing decision in this node is argued from those notes, so a board without one has not been thought about.');
    }
  }
  if (BATCH_INTERVAL_MS < BATCH_INTERVAL_FLOOR_MS) {
    throw new Error('Fetch Board: batchInterval is ' + BATCH_INTERVAL_MS + ' ms, below the ' + BATCH_INTERVAL_FLOOR_MS + ' ms floor for these six sources.');
  }
  // The two boards whose terms name a DAILY number. One call per host per run is what keeps this
  // lane inside them, so anything that multiplies calls per run has to be a deliberate decision.
  for (const key of ['remotive', 'jobicy']) {
    if (BOARD_KEYS.includes(key) && !/day/i.test(SRC[key].rate_note)) {
      throw new Error(
        'Fetch Board: the contract rate_note for ' + key + ' no longer mentions a daily limit.\n' +
        '  This node argues its no-retry and one-call-per-host design from exactly that. If the policy\n' +
        '  changed, re-argue the pacing rather than leaving a stale justification in the comments.'
      );
    }
  }
  if (!fs.existsSync(path.join(__dirname, '05-plan-queries.js'))) {
    throw new Error('Fetch Board: 05-plan-queries.js is missing, and this node reads the board list from it.');
  }
}());

module.exports = {
  name: 'Fetch Board',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [1560, 480],
  connectFrom: 'Indeed Units Only',
  outputIndex: 1,
  onError: 'continueRegularOutput',
  notes:
    'One GET per enabled board, paced ' + BATCH_INTERVAL_MS + ' ms apart, one call per host per run. ' +
    'Never errors: a 429 or a 403 arrives as a normal item with its status code and is classified by ' +
    'the next node as a refusal, never as an empty feed. fullResponse also keeps a bare array response ' +
    'as ONE item instead of letting n8n split it into one item per job.',
  parameters: {
    url: '={{ $json.url }}',
    options: {
      batching: { batch: { batchSize: BATCH_SIZE, batchInterval: BATCH_INTERVAL_MS } },
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
};

/*
 * 18-extract-board-jobs.js reads the pacing numbers and the board list back out of this file at
 * BUILD time, so the run report quotes what is actually configured. There is deliberately no extra
 * top-level key holding a second copy: build.js refuses any top-level key outside its allowlist, and
 * a helper value smuggled in beside the node definition is exactly the shape it refuses. Same rule
 * 07-search-linkedin.js and 13-fetch-indeed-snapshot.js state for their own numbers.
 */
