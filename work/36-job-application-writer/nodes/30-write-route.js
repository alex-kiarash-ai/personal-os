'use strict';
/*
 * 30-write-route.js - "Write Route". Output 0: the pairs that get a paid letter call.
 * Output 1: every held pair, every blocked pair, every capped pair and every report.
 *
 * ---------------------------------------------------------------------------------------------
 * ONE BOOLEAN AND NOTHING ELSE, AND HERE IT CARRIES THE VOICE GATE.
 * ---------------------------------------------------------------------------------------------
 * Build Writer Request stamps `_call_now` on EVERY item it emits, reports included, and it is the
 * one place the decision is made. This node re-derives nothing.
 *
 * What makes this route different from the other three is what the false side now includes: a pair
 * whose writer node lost its soul voice block. That pair is already held, already carries its
 * reason, and takes the carry side before a single token is spent. The alternative, a workflow
 * that notices the missing block AFTER paying for a letter written in generic English, would be a
 * check that costs money to fail.
 *
 * Strict boolean, so an item that somehow arrives without the key ERRORS here rather than quietly
 * taking the carry side.
 */

const CONDITION_ID = 'b1c8f204-3a67-4f1e-9d52-7c0e1a6b48d3';

(function assertAgainstUpstream() {
  const build = require('./29-build-writer-request.js');
  if (build.name !== 'Build Writer Request') {
    throw new Error('Write Route: node 29 is named ' + JSON.stringify(build.name) + ' and this node connects from "Build Writer Request". That name is also the voice sync enrolment key, so it is not free to change.');
  }
  const code = String(build.parameters.jsCode || '');

  const stamps = [
    ['j._call_now = true;', 'the only place a pair is admitted to the paid letter call'],
    ['j._call_now = false;', 'the false stamp on a held, blocked or capped pair and on every carried report'],
    ['_call_now: false,', 'the false stamp on the stage report itself'],
  ];
  for (const [needle, what] of stamps) {
    if (code.indexOf(needle) === -1) {
      throw new Error(
        'Write Route: Build Writer Request no longer contains ' + JSON.stringify(needle) + ', which is ' + what + '.\n' +
        '  Under strict type validation an undefined boolean here is an ERROR, not a false, so an item\n' +
        '  missing it fails the route instead of taking the carry side.'
      );
    }
  }
  if (code.indexOf('write_request') === -1) {
    throw new Error('Write Route: Build Writer Request no longer builds write_request, which is the entire body the node on the true side posts. Routing items to it would send the literal string "undefined".');
  }
  // The fail-closed voice gate has to sit UPSTREAM of the money, not downstream of it.
  if (code.indexOf('if (!VOICE_BLOCK_PRESENT) {') === -1) {
    throw new Error(
      'Write Route: Build Writer Request no longer holds a pair when the soul voice block is missing.\n' +
      '  That gate belongs before this route, not after the call: a letter written without his voice is\n' +
      '  the one failure in this workflow that every count on the sheet reports as healthy, and paying\n' +
      '  for it first buys nothing.'
    );
  }
}());

module.exports = {
  name: 'Write Route',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [7280, 100],
  connectFrom: 'Build Writer Request',
  notes: 'Output 0 (true): live pairs Build Writer Request admitted to the paid claude-sonnet-5 letter call. Output 1 (false): every held, blocked and capped pair, every pair whose writer node had no soul voice block, every lane report and every stage report, carried straight to Write Results. Strict boolean, so a missing flag is a loud contract violation rather than a silent reroute.',
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
