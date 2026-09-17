'use strict';
/*
 * 34-detail-route.js - "Detail Route". Output 0: the rows getting a LinkedIn detail fetch.
 * Output 1: everything else, which is every unenriched job row, every source report and every
 * stage report.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS NODE EXISTS, because the dispatch asked for TWO nodes and this is one of three extra.
 * ---------------------------------------------------------------------------------------------
 * The dispatch specified `Get LinkedIn Detail` and `Attach Detail`. Measured against how n8n
 * actually executes, that pair cannot survive the ordinary case, and the dispatch itself names the
 * reason as non-negotiable 3.
 *
 * n8n does not run a node whose input carries no items. The engine's condition is
 * `taskDataMain.filter((data) => data.length).length !== 0` (packages/core/src/execution-engine/
 * workflow-execute.ts) and `alwaysOutputData` does not change it: that flag makes a node that RAN
 * and produced nothing emit an empty item, and a node that never ran emits nothing at all.
 *
 * So a bare `Remove Known -> Get LinkedIn Detail -> Attach Detail -> Budget Gate` chain dies on any
 * run where nothing needs a detail fetch, and that is not an edge case. Three ordinary ways to hit
 * it: every surviving row is a board row, `source_linkedin_guest_detail` is switched off, or the
 * day is quiet. Remove Known's own measurement is that the title rules take the BI lane to 7 rows
 * and the window takes it to 1. When that chain dies it takes every source report and both upstream
 * stage reports with it, which is exactly what execution 5154 did through Combine.
 *
 * The alternatives were weighed and rejected:
 *   - wiring the carry side into Attach Detail's single input alongside the HTTP node: two branches
 *     into one input makes the Code node RUN TWICE, once per branch, each run seeing only its own
 *     items. That is the trap 19-combine.js records from execution 5065;
 *   - having Attach Detail read the carried stream back with $('Detail Gate') and taking only the
 *     HTTP wire: identical failure, because Attach Detail still never RUNS when the HTTP node is
 *     skipped. A node cannot read anything back if it does not execute;
 *   - a sentinel request to keep the branch alive: that is a real call to a rate limited source to
 *     work around a scheduler, which is a trick and not a design.
 * An IF and a Merge cost two simple nodes and keep every decision in one place. It is the same
 * shape `29-score-route.js` uses for scoring and the same shape `24-more-linkedin-pages.js` uses
 * for paging, and `assertDeclaredInputs` in build.js now catches the Merge hazard at build time.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY IT READS A BOOLEAN AND NOTHING ELSE.
 * ---------------------------------------------------------------------------------------------
 * Detail Gate sets `_detail_now` on EVERY item, reports included. The condition is a strict boolean
 * test, so an item that somehow arrives without the key errors here rather than quietly taking the
 * carry side and making a broken run look like a quiet one. All the judgement, including both caps,
 * lives in Detail Gate; this node re-derives nothing.
 */

// A fixed literal, not a generated uuid: build.js supports --rebuild, and a fresh id per build
// would make the PUT body differ from the live workflow every time, so the read-back diff would
// show permanent churn and stop being a signal.
const CONDITION_ID = 'b1f6c308-47ad-4e92-9d21-8c3ba05e7f14';

const FIELD = '_detail_now';

(function assertAgainstUpstream() {
  const gate = require('./33-detail-gate.js');
  if (gate.name !== 'Detail Gate') {
    throw new Error('Detail Route: node 33 is named ' + JSON.stringify(gate.name) + ' and this node connects from "Detail Gate". Rename both in the same edit.');
  }
  // The flag is set in THREE places and this checks all three by their exact text, not by whether
  // the string appears anywhere. A looser check passes on a file that mentions the field and never
  // stamps anything with it.
  //
  // NOTE WHAT TRUE MEANS HERE, because it is not what it looks like. The true side carries REQUEST
  // items, never job rows. An n8n HTTP node replaces its input item with its response, so a row
  // routed into the fetch branch does not come out of the other side. Detail Gate therefore emits
  // an admitted row TWICE: the row itself with _detail_now false, and a separate scaffolding item
  // with _detail_now true carrying only the url and the job_id. Every row and every report goes
  // down the carry side, which is why nothing in this stage can lose a row to a dead call.
  const code = String(gate.parameters.jsCode || '');
  const REQUEST_STAMP = '_detail_now: true,';
  const ROW_STAMP = 'out._detail_now = false;';
  const CARRY_STAMP = '_detail_now: false';
  if (code.indexOf(REQUEST_STAMP) === -1) {
    throw new Error(
      'Detail Route: Detail Gate no longer emits an item carrying ' + JSON.stringify(REQUEST_STAMP) + ', which is\n' +
      '  the fetch REQUEST and the only thing that may take the true side. Without it nothing is ever\n' +
      '  fetched, no description is ever attached, and the run looks like a lane with the detail switch\n' +
      '  off rather than like a stage that stopped working.'
    );
  }
  if (code.indexOf(ROW_STAMP) === -1) {
    throw new Error(
      'Detail Route: Detail Gate no longer sets ' + JSON.stringify(ROW_STAMP) + ' on the job rows.\n' +
      '  A job row that takes the TRUE side is handed to an HTTP node, which replaces it with its own\n' +
      '  response, and the row is gone with no error anywhere. Rows travel the carry side. Always.'
    );
  }
  if (code.indexOf(CARRY_STAMP) === -1) {
    throw new Error(
      'Detail Route: Detail Gate no longer sets ' + JSON.stringify(CARRY_STAMP) + ' on the carried items.\n' +
      '  Under strict type validation an undefined boolean is an ERROR here, not a false, so every source\n' +
      '  report would fail the route and the run would lose its verdict.'
    );
  }
  // The clamps are what a hand edited settings cell cannot raise. If they went away this branch
  // would have no bound that survives the sheet, and it is a weekday cron with nobody in the room.
  if (code.indexOf('HARD_MAX_DETAIL_CALLS') === -1 || code.indexOf('HARD_MAX_TOTAL_CALLS') === -1) {
    throw new Error('Detail Route: Detail Gate no longer carries its hard clamps. The configurable caps are a convenience; the clamps are the only bound a hand edited settings cell cannot raise, and this node is the edge that would spray calls at LinkedIn without them.');
  }
}());

module.exports = {
  name: 'Detail Route',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [4330, 380],
  connectFrom: 'Detail Gate',
  notes: 'Output 0 (true): the fetch REQUESTS Detail Gate admitted, which carry only a url and a job id. Output 1 (false): EVERY job row, every source report and every stage report. Rows never take the true side, because an HTTP node replaces its input item with its response and the row would be gone. Output 0 is empty on an ordinary quiet day, which is exactly why the Merge exists.',
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          id: CONDITION_ID,
          leftValue: '={{ $json._detail_now }}',
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
};
