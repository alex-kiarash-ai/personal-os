'use strict';
/*
 * 69-read-back-sheets.js - "Read Back Sheets". Asks each spreadsheet what it actually holds now.
 *
 * =============================================================================================
 * 1. WHY IT EXISTS: THE VERIFY-AFTER-WRITE STANDING ORDER.
 * =============================================================================================
 * The batchUpdate response is the request talking about itself: it reports how many cells the API
 * accepted, not what the document now says. "It returned 200" is not verification. This node asks
 * the document, over the EXACT ranges that were just written, so the comparison one node later is
 * cell by cell rather than count against count.
 *
 * The EXPECTED side and the ACTUAL side come from different places on purpose. The expected values
 * are what Build Sheet Writes intended, decided before any write existed. The actual values are this
 * fresh read. On 2026-09-12 this relay recorded the sharpest lesson it has: a node was "verified" by
 * asking the API for a property that does not exist on it and reporting the echo as proof, and the
 * test suite asserted the same invented property against the file that set it. A check whose
 * expected value comes from the same place as the actual value cannot fail.
 *
 * =============================================================================================
 * 2. IT SITS ON THE WRITE BRANCH, BEFORE THE JOIN, AND THAT IS A STATED CHANGE FROM THE PLAN ROW.
 * =============================================================================================
 * The reconstructed plan put the merge at 69 and this read at 70, which would have fed this node the
 * JOINED stream: two write responses plus every pair and every report. An HTTP Request node fires
 * once per input item, so that shape makes one call per pair and per report, each with a url this
 * node would have to find on an item that does not carry one.
 *
 * The three nodes are the same three nodes with the same names and the same types; only the order of
 * two of them changed, so the graph is a straight chain, write then read then join. That also
 * removes a real hazard: with the read back hanging off the write as a PARALLEL branch, nothing in
 * the engine guarantees it runs before the node that checks it, and a check that cannot find its
 * read back would report an unverified run on a run that verified perfectly.
 *
 * Node 62 to 74 are the orchestrator's reconstruction of a table the plan display truncated, not
 * Shaheen's approved text, and this is the one place in this seat where following the reconstruction
 * literally would not have worked.
 *
 * =============================================================================================
 * 3. THE URL COMES OFF THE ITEM THAT BUILT IT, THROUGH A STRAIGHT CHAIN.
 * =============================================================================================
 * Write Sheets replaces the item with the API response, so the read back url is no longer on it.
 * `$('Build Sheet Writes').item` resolves through the paired item back to the request, across an IF
 * and an HTTP node, both of which map one input item to one output item. That is the shortest and
 * most reliable form of the lookup, and it is the same shape the staging workflow uses for its own
 * Drive upload parameters.
 *
 * =============================================================================================
 * 4. NOT executeOnce, AND NO RETRY.
 * =============================================================================================
 * Two lanes, two spreadsheets, two calls. executeOnce would read the Power BI sheet back twice and
 * never look at the AI one, and both lanes would be reported against the same document.
 *
 * No retry: a GET is idempotent so a retry would be safe, and n8n retries the whole node, so one
 * would re-read both lanes to fix one. The failures here are a lapsed credential or a renamed tab,
 * neither of which is transient, and the recovery is already correct: a write that cannot be proved
 * makes the run report RED and Assert Run fail the execution, which is exactly what should happen.
 */

const W = require('./_write');

const TIMEOUT_MS = 45000;

(function assertAgainstUpstream() {
  const write = require('./68-write-sheets.js');
  const build = require('./66-build-sheet-writes.js');
  if (write.name !== 'Write Sheets') {
    throw new Error('Read Back Sheets: node 68 is named ' + JSON.stringify(write.name) + ' and this node connects from "Write Sheets", one call per lane, on the same branch.');
  }
  if (build.name !== 'Build Sheet Writes') {
    throw new Error('Read Back Sheets: node 66 is named ' + JSON.stringify(build.name) + ' and this node url resolves through that exact name inside an expression string, which nothing else would catch on a rename.');
  }
  if (write.parameters.method !== 'POST') {
    throw new Error('Read Back Sheets: Write Sheets is no longer a POST, so this node may no longer be reading back what that node wrote.');
  }
  const code = String(build.parameters.jsCode || '');
  if (code.indexOf('read_back_url: URLS.base') === -1) {
    throw new Error('Read Back Sheets: Build Sheet Writes no longer builds a read_back_url, which is the entire request this node sends. The ranges in it are the EXACT ranges that were written, which is what makes the comparison cell by cell rather than count against count.');
  }
  if (code.indexOf('read_back_range_names: readBack.map((r) => r.name),') === -1) {
    throw new Error(
      'Read Back Sheets: Build Sheet Writes no longer declares the NAMES of its read back ranges.\n' +
      '  Check Sheet Writes reads the returned valueRanges BY POSITION, and a list whose order nobody\n' +
      '  declared is a list whose order can change without a single error.'
    );
  }
  W.googleSheetsCredential();
}());

module.exports = {
  name: 'Read Back Sheets',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [17420, 0],
  connectFrom: 'Write Sheets',
  onError: 'continueRegularOutput',
  notes: 'One values:batchGet per lane, over the EXACT ranges that were just written plus the two column reads that prove an append rather than an overwrite. The Verify-after-write standing order: a batchUpdate response counts what the API accepted, this asks the document. It sits on the write branch BEFORE the join, which is a stated change from the reconstructed plan row: fed the joined stream it would fire once per pair and per report, and as a parallel branch nothing would guarantee it ran before the node that checks it. The url comes off the request that built it through a straight chain of one to one nodes.',
  credentials: W.googleSheetsCredential(),
  parameters: {
    method: 'GET',
    url: "={{ $('Build Sheet Writes').item.json.read_back_url }}",
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleSheetsOAuth2Api',
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
};
