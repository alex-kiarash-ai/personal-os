'use strict';
/*
 * 04-read-lane-sheets.js - "Read Lane Sheets". One values:batchGet per source lane.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. WHY REST AND NOT THE GOOGLE SHEETS NODE. THIS IS DESIGN DEFECT 1 AND IT IS NOT A PREFERENCE.
 * ---------------------------------------------------------------------------------------------
 * The Sheets node resolves `documentId` at item 0 and uses it for the whole batch. Two lanes, two
 * spreadsheets, one node: it would read the FIRST spreadsheet twice, return 200, and report two
 * lanes. Nothing downstream could tell that apart from two identical sheets, and the second lane
 * would quietly become a duplicate of the first, all the way to two Drive folders.
 *
 * So the read is raw REST, and the credential rides as `nodeCredentialType: googleSheetsOAuth2Api`,
 * which is the same OAuth credential the collectors use, by id, reused and never recreated.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. NOT executeOnce, AND THAT IS THE OPPOSITE OF #34's READ NODES.
 * ---------------------------------------------------------------------------------------------
 * Every read node in #34 carries `executeOnce: true`, because it is handed hundreds of items and
 * wants ONE call. This node is handed exactly two items and wants exactly TWO calls, one per lane.
 * Setting executeOnce here would read the BI spreadsheet and never read the AI one, and the run
 * would look like a morning with no AI jobs. The count is asserted on arrival in Build Candidates
 * for that reason: two lanes in, two responses out, or the batch refuses to pair.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. A 4xx ARRIVES AS DATA. IT HAS TO, BECAUSE THE FIRST RUN WILL PRODUCE ONE.
 * ---------------------------------------------------------------------------------------------
 * `fullResponse` plus `neverError` plus `onError: continueRegularOutput` means the item carries
 * { statusCode, headers, body } whatever happened. That is load bearing on day one: the
 * `writer_runs` tab does not exist in either spreadsheet yet, and Google fails a batchGet whose
 * ranges name a missing sheet with a 400 for the entire request. Build Candidates reads that status
 * code, recognises the range in the message and refuses the lane BY NAME. Without fullResponse the
 * same failure would arrive as an unexplained empty body and the lane would look like a quiet day.
 *
 * NO RETRY. A GET is idempotent so a retry would be safe, and it would buy nothing: the failures
 * this node actually sees are a missing tab, a lapsed credential and a renamed sheet, none of which
 * is transient. The recovery already exists and is better, because a lane that cannot be read
 * writes nothing, stamps nothing, and is re-offered whole by the next morning run.
 */

const { lane, lanes, googleSheetsCredential } = require('./_lane');

const L = lane();
const LANE_ROWS = lanes();
const TIMEOUT_MS = 30000;

(function assertAgainstUpstream() {
  const seed = require('./03-seed-lanes.js');
  if (seed.name !== 'Seed Lanes') {
    throw new Error('Read Lane Sheets: node 03 is named ' + JSON.stringify(seed.name) + ' and this node connects from "Seed Lanes". The name is the connection key.');
  }
  // The url is built at BUILD time by Seed Lanes and read off the item here. If that node stopped
  // baking the field, this node would send a request to the literal string "undefined" and the
  // error would name Google rather than the node that actually broke.
  const code = String(seed.parameters.jsCode || '');
  if (code.indexOf('batch_get_url') === -1) {
    throw new Error(
      'Read Lane Sheets: Seed Lanes no longer carries batch_get_url, which is the entire url this node\n' +
      '  requests. The five ranges and their ORDER are a contract with Build Candidates, so they are\n' +
      '  assembled in one place and quoted in one place.'
    );
  }
  if (seed.parameters.mode !== 'runOnceForAllItems') {
    throw new Error('Read Lane Sheets: Seed Lanes is not in runOnceForAllItems mode, so the two lane items may not arrive as one batch in a declared order.');
  }
  if (LANE_ROWS.length < 2) {
    throw new Error('Read Lane Sheets: fewer than two source lanes resolved, and this node is deliberately NOT executeOnce because it must fire once per lane.');
  }
  if (!L.credentials || !L.credentials.google_sheets) {
    throw new Error('Read Lane Sheets: lane.json has no credentials.google_sheets. Refused rather than built without one: n8n renders a disabled credential picker for a missing id and the node 401s on every call.');
  }
}());

module.exports = {
  name: 'Read Lane Sheets',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [520, 100],
  connectFrom: 'Seed Lanes',
  // A refused read has to arrive as DATA so Build Candidates can name the lane and the reason.
  // Stopping the workflow here would take the other lane down with it.
  onError: 'continueRegularOutput',
  notes: 'One values:batchGet per source lane, five ranges each: settings A:B, jobs A:O, applications A:A, applications 1:1, writer_runs A:L. Deliberately NOT executeOnce, because two lanes means two spreadsheets and two calls. A 4xx arrives as data with its real status code, which is how the missing writer_runs tab is reported by name instead of as an empty day.',
  credentials: googleSheetsCredential(),
  parameters: {
    method: 'GET',
    url: '={{ $json.batch_get_url }}',
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
