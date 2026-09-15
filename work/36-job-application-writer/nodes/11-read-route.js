'use strict';
/*
 * 11-read-route.js - "Read Route". Output 0: the pairs that get a paid opus-5 call. Output 1:
 * every held pair, every capped pair, every lane report and every stage report.
 *
 * ---------------------------------------------------------------------------------------------
 * ONE BOOLEAN AND NOTHING ELSE.
 * ---------------------------------------------------------------------------------------------
 * Build Read Request stamps `_call_now` on EVERY item it emits, reports included, and it is the one
 * place the decision is made: a live pair with a real ad gets true, and everything else gets false.
 * This node re-derives nothing. All the judgement lives upstream, exactly the way Fetch Route reads
 * only what Build Candidates decided.
 *
 * The condition is a strict boolean test, so an item that somehow arrives without the key ERRORS
 * here rather than quietly taking the carry side. That is wanted: on this route the carry side is
 * free and the true side spends money, so a silent reroute in the other direction would be an
 * unbilled disappearance of work, and in this direction it would be a bill nobody planned.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE ROUTE AND THE MERGE AT ALL, SAID ONCE MORE BECAUSE THIS IS THE EXPENSIVE ONE.
 * ---------------------------------------------------------------------------------------------
 * n8n does not run a node whose input carries no items, and `alwaysOutputData` does not change it.
 * So without this pair of nodes, a morning where both lanes were capped out would skip Read Job,
 * skip Parse Job Brief, and end the branch carrying every lane report and both stage reports with
 * it. On this lane that run is common by design, because the daily cap is counted across re-runs
 * and a second run in one morning is supposed to find nothing left to do.
 */

const CONDITION_ID = 'e3c9f2a4-7d86-4f5a-9c32-0a5e1d4b6c83';

(function assertAgainstUpstream() {
  const build = require('./10-build-read-request.js');
  if (build.name !== 'Build Read Request') {
    throw new Error('Read Route: node 10 is named ' + JSON.stringify(build.name) + ' and this node connects from "Build Read Request". Rename both in the same edit.');
  }
  const code = String(build.parameters.jsCode || '');

  // The flag is set in FOUR places in that node and this checks each by its exact text, not by
  // whether the string appears somewhere. A looser check passes on a file that mentions the field
  // once and never stamps a report with it, which is the single failure that would send every
  // report down the error path under strict validation and lose the run verdict.
  const stamps = [
    ['j._call_now = true;', 'the only place a pair is admitted to the paid call'],
    ['j._call_now = false;', 'the false stamp on a held or capped pair'],
    ['_call_now: false', 'the false stamp on the stage report itself'],
  ];
  for (const [needle, what] of stamps) {
    if (code.indexOf(needle) === -1) {
      throw new Error(
        'Read Route: Build Read Request no longer contains ' + JSON.stringify(needle) + ', which is ' + what + '.\n' +
        '  Under strict type validation an undefined boolean here is an ERROR, not a false, so an item\n' +
        '  missing it fails the route instead of taking the carry side. If the stamp legitimately moved,\n' +
        '  update this exact string in the same edit.'
      );
    }
  }
  if (code.indexOf('read_request') === -1) {
    throw new Error('Read Route: Build Read Request no longer builds read_request, which is the entire body the node on the true side posts. Routing items to it would send an empty request.');
  }
}());

module.exports = {
  name: 'Read Route',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [2340, 100],
  connectFrom: 'Build Read Request',
  notes: 'Output 0 (true): pairs Build Read Request admitted to the paid opus-5 read. Output 1 (false): every held pair, every capped pair, every lane report and every stage report, carried straight to Read Results. Strict boolean, so a missing flag is a loud contract violation rather than a silent reroute.',
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          id: CONDITION_ID,
          leftValue: '={{ $json._call_now }}',
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
};
