'use strict';
/*
 * 25-select-route.js - "Select Route". Output 0: the pairs that get a paid opus-5 selection call.
 * Output 1: every held pair, every blocked pair, every capped pair and every report.
 *
 * ---------------------------------------------------------------------------------------------
 * ONE BOOLEAN AND NOTHING ELSE.
 * ---------------------------------------------------------------------------------------------
 * Build Select Request stamps `_call_now` on EVERY item it emits, reports included, and it is the
 * one place the decision is made: a live pair whose lane master was actually baked into this
 * workflow gets true, and everything else gets false. This node re-derives nothing.
 *
 * The condition is a strict boolean test, so an item that somehow arrives without the key ERRORS
 * here rather than quietly taking the carry side. On this route the carry side is free and the true
 * side is the second most expensive call in the chain.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE ROUTE AND THE MERGE, ON THE STAGE WHERE IT MATTERS MOST.
 * ---------------------------------------------------------------------------------------------
 * n8n does not run a node whose input carries no items. Every stage before this one can legitimately
 * produce a run with no live pairs at all: both lanes capped out, both lanes refused at the sheet,
 * every qualifier already written, every posting blocked on Swedish fluency, an Anthropic outage at
 * the reader. In a straight chain any one of those would skip the selector, skip Assemble CV, and
 * end the branch carrying every lane report, every blocked pair and five stage reports with it.
 *
 * On this lane that is not a rare shape. The daily cap is counted across re-runs precisely so that a
 * second run in one morning finds nothing left to do, and a run that finds nothing to do still has
 * to reach the write-back half to say so.
 */

const CONDITION_ID = 'c4e05b93-8d17-4a26-bf39-2e7a1d5c8046';

(function assertAgainstUpstream() {
  const build = require('./24-build-select-request.js');
  if (build.name !== 'Build Select Request') {
    throw new Error('Select Route: node 24 is named ' + JSON.stringify(build.name) + ' and this node connects from "Build Select Request". Rename both in the same edit.');
  }
  const code = String(build.parameters.jsCode || '');

  // Each stamp checked by its exact text. A looser check passes on a file that mentions the field
  // once and never stamps a report with it, which is the single failure that would send every report
  // down the error path under strict validation and lose the run verdict.
  const stamps = [
    ['j._call_now = true;', 'the only place a pair is admitted to the paid selection call'],
    ['j._call_now = false;', 'the false stamp on a held, blocked or capped pair and on every carried report'],
    ['_call_now: false,', 'the false stamp on the stage report itself'],
  ];
  for (const [needle, what] of stamps) {
    if (code.indexOf(needle) === -1) {
      throw new Error(
        'Select Route: Build Select Request no longer contains ' + JSON.stringify(needle) + ', which is ' + what + '.\n' +
        '  Under strict type validation an undefined boolean here is an ERROR, not a false, so an item\n' +
        '  missing it fails the route instead of taking the carry side. If the stamp legitimately moved,\n' +
        '  update this exact string in the same edit.'
      );
    }
  }
  if (code.indexOf('select_request') === -1) {
    throw new Error('Select Route: Build Select Request no longer builds select_request, which is the entire body the node on the true side posts. Routing items to it would send the literal string "undefined".');
  }
  // The system block is the whole master. A pair routed to the paid call without one would ask a
  // model to choose ids out of a document it was never shown, and every id it invented would then
  // fail to resolve and hold the pair. Expensive, and silent until the hold count is read.
  if (code.indexOf('const system = SELECT_SYSTEM[key];') === -1) {
    throw new Error('Select Route: Build Select Request no longer looks the per lane system block up by master_key. A pair with no system block must never reach the paid call.');
  }
}());

module.exports = {
  name: 'Select Route',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [5980, 100],
  connectFrom: 'Build Select Request',
  notes: 'Output 0 (true): live pairs Build Select Request admitted to the paid claude-opus-5 selection. Output 1 (false): every held, blocked and capped pair, every lane report and every stage report, carried straight to Select Results. Strict boolean, so a missing flag is a loud contract violation rather than a silent reroute.',
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
