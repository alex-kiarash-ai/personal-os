'use strict';
/*
 * 04-eval-write-route.js - "Eval Write Route". Output 0: the six cases that get a paid call.
 * Output 1: anything the prose node declined to call for.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY A ROUTE IN AN EIGHT NODE HARNESS.
 * ---------------------------------------------------------------------------------------------
 * The prose node emits one item per input PLUS its own stage report, and the report carries
 * `_call_now: false` and no `write_request`. Wiring the HTTP node straight to it would POST the
 * literal string "undefined" as a seventh paid call, get a 400, and the eval would then be six
 * letters and one mystery.
 *
 * It also preserves the thing that makes this a copy of the runtime path and not a lookalike: in
 * #36 the money is gated on a boolean the prose node stamps, nowhere else. The same boolean gates
 * it here, read with the same strict type validation, so a case the prose node HELD (a missing
 * voice block, an unusable lane key) shows up as a case that never ran rather than as a pass.
 *
 * Strict boolean on purpose: an item arriving without the key ERRORS here instead of quietly taking
 * the carry side, which is the one behaviour that would let a silently-held case read as green.
 */

const CONDITION_ID = 'c7e41d90-5b28-4a6f-8e13-2d6c90ab74f1';

(function assertAgainstUpstream() {
  const build = require('./03-build-writer-request.js');
  if (build.name !== 'Build Writer Request') {
    throw new Error('Eval Write Route: node 03 is named ' + JSON.stringify(build.name) + ' and this node connects from "Build Writer Request".');
  }
  const code = String(build.parameters.jsCode || '');
  for (const [needle, what] of [
    ['j._call_now = true;', 'the only place a case is admitted to the paid letter call'],
    ['_call_now: false,', 'the false stamp on the stage report, which must not reach the HTTP node'],
    ['write_request', 'the body the node on the true side posts'],
  ]) {
    if (code.indexOf(needle) === -1) {
      throw new Error('Eval Write Route: the prose node no longer contains ' + JSON.stringify(needle) + ', which is ' + what + '.');
    }
  }
}());

module.exports = {
  name: 'Eval Write Route',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [780, 0],
  connectFrom: 'Build Writer Request',
  notes: 'Output 0 (true): the cases the prose node admitted to the paid claude-sonnet-5 call. Output 1 (false): the stage report and any case the prose node held, which is deliberately a dead end here so a held case shows as a case that never ran rather than as a pass. Strict boolean.',
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
