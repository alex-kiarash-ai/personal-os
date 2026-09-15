'use strict';
/*
 * 68-write-sheets.js - "Write Sheets". One values:batchUpdate per lane. The only node in this
 * workflow that changes a spreadsheet.
 *
 * =============================================================================================
 * 1. RAW REST, NOT THE GOOGLE SHEETS NODE. DESIGN DEFECT 1, AND IT IS MECHANICAL.
 * =============================================================================================
 * The Sheets node resolves `documentId` at ITEM ZERO and uses it for the whole batch. Two lanes,
 * two spreadsheets, one node: the AI Automation rows would be written into the Power BI spreadsheet,
 * with a 200 and a report saying two lanes were written. Nothing downstream could tell that apart
 * from a morning where both lanes found the same jobs.
 *
 * It also cannot say "write these exact cells and touch nothing else". Its update operation matches
 * a row by a lookup column and rewrites that row, and when nothing matches it is a SILENT no-op that
 * returns success. `values:batchUpdate` addresses exact ranges, which is the shape of the
 * requirement: an appended block at a computed range, one addressed status cell per job, and one
 * ledger row.
 *
 * Node 04 reached the same conclusion for the read. This is the write half.
 *
 * =============================================================================================
 * 2. THE BODY IS BUILT ELSEWHERE AND THIS NODE HOLDS NO JUDGEMENT.
 * =============================================================================================
 * Both the url and the whole request come off the item Build Sheet Writes produced. That is
 * deliberate: the decision about what a spreadsheet is about to say is the most consequential one in
 * this seat, and it belongs in a Code node an offline suite can run, not in an expression nobody can
 * exercise. The same split #34 uses for its window write, and for the same stated reason.
 *
 * =============================================================================================
 * 3. NOT executeOnce, WHICH IS THE OPPOSITE OF EVERY WRITE NODE IN THE COLLECTOR LANE.
 * =============================================================================================
 * #34's writes carry `executeOnce: true`, because they are handed hundreds of items and want one
 * call. This node is handed exactly two and wants exactly TWO calls, one per spreadsheet. Setting
 * executeOnce here would write the Power BI lane and never write the AI one, and the run would look
 * like a morning where the AI lane had nothing to say. Node 71 asserts the count on arrival for
 * exactly that reason.
 *
 * =============================================================================================
 * 4. NO RETRY, AND HERE THE USUAL ARGUMENT DOES NOT APPLY, SO A DIFFERENT ONE IS WRITTEN DOWN.
 * =============================================================================================
 * Elsewhere the argument is that the call is not idempotent. This one IS: every range is computed
 * before the call and writing the same values to the same ranges twice leaves the sheet identical.
 *
 * The reason there is still no retry is that n8n retries the whole NODE, so a retry to fix one lane
 * would re-send both, and the failures this node actually sees are a lapsed credential, a renamed
 * tab and a range the sheet does not have, none of which is transient. The recovery already exists
 * and is better: a lane whose write failed has written no status cells, so every one of its job rows
 * is still `new` and tomorrow morning offers them again.
 *
 * =============================================================================================
 * 5. onError: continueRegularOutput, SO A REFUSED WRITE ARRIVES AS DATA.
 * =============================================================================================
 * A write that throws would kill the run before the read back that proves what landed, before the
 * run report, and before the heartbeat. The one run where a human most needs to be told would tell
 * nobody. `fullResponse` plus `neverError` means the item carries a real status code either way, and
 * Check Sheet Writes classifies it by that code and pushes RED.
 */

const W = require('./_write');

const TIMEOUT_MS = 60000;

(function assertAgainstUpstream() {
  const route = require('./67-sheet-write-route.js');
  const build = require('./66-build-sheet-writes.js');
  if (route.name !== 'Sheet Write Route') {
    throw new Error('Write Sheets: node 67 is named ' + JSON.stringify(route.name) + ' and this node hangs off "Sheet Write Route" output 0. Rename both in the same edit.');
  }
  if (build.name !== 'Build Sheet Writes') {
    throw new Error('Write Sheets: node 66 is named ' + JSON.stringify(build.name) + ' and this node sends the body that node builds.');
  }
  const code = String(build.parameters.jsCode || '');
  for (const [needle, what] of [
    ['batch_update_url: URLS.base', 'the per lane url, which is why this cannot be the Sheets node'],
    ["valueInputOption: 'RAW'", 'the option that keeps a company name beginning with an equals sign from becoming a live formula in his spreadsheet'],
  ]) {
    if (code.indexOf(needle) === -1) {
      throw new Error('Write Sheets: Build Sheet Writes no longer contains ' + JSON.stringify(needle) + ', which is ' + what + '.');
    }
  }
  W.googleSheetsCredential();
}());

module.exports = {
  name: 'Write Sheets',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [17160, 0],
  connectFrom: { node: 'Sheet Write Route', outputIndex: 0 },
  // A refused write is DATA, so the run still reads back, still reports and still pushes. See note 5.
  onError: 'continueRegularOutput',
  notes: 'One values:batchUpdate per lane, raw REST because the Google Sheets node resolves documentId at item zero and two lanes means two spreadsheets. Deliberately NOT executeOnce: it is handed two items and wants two calls, and executeOnce would write one lane and silently skip the other. The url and the whole body come off the item Build Sheet Writes produced, so this node holds no judgement. Never retried, because n8n retries the whole node and would re-send both lanes to fix one, and the failures here are a lapsed credential or a renamed tab, neither of which is transient. A refused write arrives as data with its real status code so the run still reads back, still reports and still pushes RED.',
  credentials: W.googleSheetsCredential(),
  parameters: {
    method: 'POST',
    url: '={{ $json.batch_update_url }}',
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleSheetsOAuth2Api',
    sendBody: true,
    contentType: 'json',
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.batch_update_body) }}',
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
