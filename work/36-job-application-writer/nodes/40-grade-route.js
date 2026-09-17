'use strict';
/*
 * 40-grade-route.js - "Grade Route". Output 0: the pairs that get graded. Output 1: everything else.
 *
 * ---------------------------------------------------------------------------------------------
 * ONLY A LETTER THAT ALREADY PASSED THE DETERMINISTIC AUDIT IS WORTH GRADING.
 * ---------------------------------------------------------------------------------------------
 * Build Grade Request stamps `_call_now` on every item and it is the one place the decision is made.
 * A pair that is already held, blocked, capped or errored takes the carry side, which means this
 * lane never pays a model to give a considered opinion on a letter a regex already refused.
 *
 * Strict boolean, so an item arriving without the key ERRORS rather than quietly taking a side.
 */

const CONDITION_ID = 'a2f45d18-6e93-4c07-bb21-0d8e5f37c9a4';

(function assertAgainstUpstream() {
  const build = require('./39-build-grade-request.js');
  if (build.name !== 'Build Grade Request') {
    throw new Error('Grade Route: node 39 is named ' + JSON.stringify(build.name) + ' and this node connects from "Build Grade Request". Rename both in the same edit.');
  }
  const code = String(build.parameters.jsCode || '');
  const stamps = [
    ['j._call_now = true;', 'the only place a pair is admitted to the paid grading call'],
    ['j._call_now = false;', 'the false stamp on a held pair and on every carried report'],
    ['_call_now: false,', 'the false stamp on the stage report itself'],
  ];
  for (const [needle, what] of stamps) {
    if (code.indexOf(needle) === -1) {
      throw new Error('Grade Route: Build Grade Request no longer contains ' + JSON.stringify(needle) + ', which is ' + what + '. Under strict type validation an undefined boolean here is an ERROR rather than a false.');
    }
  }
  if (code.indexOf('grade_request') === -1) {
    throw new Error('Grade Route: Build Grade Request no longer builds grade_request, which is the entire body the node on the true side posts.');
  }
}());

module.exports = {
  name: 'Grade Route',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [9880, 100],
  connectFrom: 'Build Grade Request',
  notes: 'Output 0 (true): the letters that passed the deterministic audit and get the blind grade on claude-sonnet-4-6. Output 1 (false): every held, blocked, capped and errored pair and every report. This lane never pays a model for an opinion on a letter a deterministic check already refused.',
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
