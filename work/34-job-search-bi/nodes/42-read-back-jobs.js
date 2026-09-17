'use strict';
/*
 * 42-read-back-jobs.js - "Read Back Jobs". Asks Google what is actually in the spreadsheet.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY IT EXISTS: THE VERIFY-AFTER-WRITE STANDING ORDER, AND ITS ONE NAMED EXEMPTION IS NOT THIS.
 * ---------------------------------------------------------------------------------------------
 * The order has exactly one carve-out and it is the HQ heartbeat push, because a dashboard that
 * cannot be reached must not turn a healthy job red. Every DATA write reads back in the same run.
 * The append's own response is the request talking about itself; it counts what the API accepted,
 * not what the document now holds. This node asks the document.
 *
 * The lesson behind the wording is on the record from 2026-09-12: the orchestrator verified Combine
 * by asking the API for a property name that does not exist on that node and reporting the echo as
 * proof, and the test suite asserted the same invented name against the node file that set it. A
 * check whose expected value comes from the same place as the actual value cannot fail. So the
 * expected side here is what Build Rows INTENDED, and the actual side is a fresh read of the sheet.
 * Two independent sources.
 *
 * ---------------------------------------------------------------------------------------------
 * THREE RANGES IN ONE CALL, AND EACH ONE ANSWERS A DIFFERENT QUESTION.
 * ---------------------------------------------------------------------------------------------
 *   <writeTab>!1:1   the header row. Answers "did the row land in the columns it was mapped to".
 *                    It is also the only way to catch the degenerate empty-tab path, where the node
 *                    invents a header out of the item's keys and returns a perfectly healthy 200.
 *   <writeTab>!A:A   the job_id column, and nothing else. Answers "is every id we wrote actually
 *                    there" and "how many rows does the tab hold now". One column rather than the
 *                    whole tab because the tab grows forever and this runs on every single run.
 *   <settingsTab>!A:B  the settings tab. Two jobs: it gives the ROW NUMBER of `last_run_at`, which
 *                    is what makes the next write a single addressed cell rather than a row-matching
 *                    guess, and it gives the OLD value, which is what makes "the cell was preserved"
 *                    a checkable claim on a run that must not advance.
 *
 * ---------------------------------------------------------------------------------------------
 * executeOnce: true, AND WITHOUT IT THIS NODE MAKES HUNDREDS OF CALLS.
 * ---------------------------------------------------------------------------------------------
 * An HTTP Request node runs once per INPUT item. Write Results hands it every written row, every
 * unwritten row and every report, which on a first run is two hundred and more. One batchGet is
 * wanted, not two hundred identical ones, and Google's per-minute read quota is real. Same flag Read
 * Settings and Read Known Jobs already carry, for the same reason.
 *
 * onError: continueRegularOutput, so a failed read-back is DATA. A read-back that throws would kill
 * the run before the ledger row and the HQ push, which is the same mistake as letting the write
 * throw: the run that cannot prove itself is the run that most needs to say so.
 *
 * No retry. A GET is idempotent so a retry would be safe, but n8n retries the whole node and the
 * failure this guards against (a lapsed credential, a renamed tab) is not transient. The recovery is
 * already built: an unverifiable write does not advance the window, so the next run covers it again.
 */

const { lane, googleSheetsCredential } = require('./_lane');
const O = require('./_output');

const L = lane();
const WRITE = O.writeTarget();
const SETTINGS_TAB = L.sheet.settings_tab;

const RANGES = [
  O.a1(WRITE.tab, '1:1'),
  O.a1(WRITE.tab, 'A:A'),
  O.a1(SETTINGS_TAB, 'A:B'),
];
const TIMEOUT_MS = 30000;

(function assertAgainstUpstream() {
  const merge = require('./41-write-results.js');
  if (merge.name !== 'Write Results') throw new Error('Read Back Jobs: node 41 is named ' + JSON.stringify(merge.name) + ' and this node connects from "Write Results".');
  if (!SETTINGS_TAB) throw new Error('Read Back Jobs: lane.json has no sheet.settings_tab, and the last_run_at row number is resolved from that tab rather than guessed.');
  if (!L.sheet.spreadsheet_id) throw new Error('Read Back Jobs: lane.json has no sheet.spreadsheet_id.');
  // The write tab and the read-back tab are ONE constant, resolved once in _output.js. Two copies is
  // how a repoint moves the write and leaves the verification reading the tab nobody wrote to, which
  // would pass green forever.
  const writeNode = require('./40-write-jobs.js');
  const writtenTab = writeNode.parameters.sheetName && writeNode.parameters.sheetName.value;
  if (writtenTab !== WRITE.tab) {
    throw new Error(
      'Read Back Jobs: Write Jobs appends to ' + JSON.stringify(writtenTab) + ' and this node reads back ' + JSON.stringify(WRITE.tab) + '.\n' +
      '  Both resolve from _output.js writeTarget(), so a disagreement means one of them was hand edited. A\n' +
      '  read-back pointed at a tab nobody wrote to passes on every run and proves nothing.'
    );
  }
}());

module.exports = {
  name: 'Read Back Jobs',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [6240, 780],
  connectFrom: 'Write Results',
  // One call for the whole run, not one per row. See the header.
  executeOnce: true,
  onError: 'continueRegularOutput',
  notes: 'One values:batchGet reading the write tab header, the write tab job_id column and the settings tab. Proves the rows actually landed and in the right columns, and supplies the last_run_at row number and its current value so the next write is one addressed cell. executeOnce, or it would fire once per row.',
  credentials: googleSheetsCredential(),
  parameters: {
    method: 'GET',
    url: O.batchGetUrl(L.sheet.spreadsheet_id, RANGES),
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleSheetsOAuth2Api',
    options: {
      timeout: TIMEOUT_MS,
      response: {
        response: {
          // fullResponse so a 4xx arrives with its status code instead of as an unexplained empty
          // body, and neverError so it arrives as data at all. Same pair every other refusal-aware
          // HTTP node in this lane uses.
          fullResponse: true,
          neverError: true,
          responseFormat: 'json',
        },
      },
    },
  },
};
