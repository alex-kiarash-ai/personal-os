'use strict';
/*
 * 35-rewrite-route.js - "Rewrite Route". Output 0: the letters that get their ONE reasoned rewrite.
 * Output 1: everything else, which on this route includes the letters that PASSED.
 *
 * ---------------------------------------------------------------------------------------------
 * THIS IS THE ONE ROUTE WHERE THE FALSE SIDE CARRIES GOOD NEWS.
 * ---------------------------------------------------------------------------------------------
 * On every other route, `_call_now: false` means held, blocked, capped or already broken. Here it
 * mostly means the letter passed A1 to A18 on the first pass and needs nothing. Those pairs travel
 * the carry branch with their audit attached and Audit Pair Final leaves them exactly as they are.
 *
 * The true side is the rewrite, and it fires ONLY on a letter-scope failure. A CV failure never
 * reaches it: Audit Pair holds those, because a CV is verbatim master by construction and asking a
 * model to try again would produce a second CV with the same assembler fault and a green report.
 *
 * ---------------------------------------------------------------------------------------------
 * ONE ATTEMPT, AND THE ROUTE IS NOT WHERE THAT IS ENFORCED.
 * ---------------------------------------------------------------------------------------------
 * The graph is acyclic: there is no edge from Audit Pair Final back to here, so a second rewrite is
 * not something this node has to refuse, it is something the shape makes impossible. That is
 * deliberate. A retry budget held in a counter is a budget somebody can raise; a graph with no loop
 * in it is a budget nobody can raise by accident.
 */

const CONDITION_ID = 'd7a3e610-95c4-4b28-8f16-2b9d0c7ae541';

(function assertAgainstUpstream() {
  const audit = require('./34-audit-pair.js');
  if (audit.name !== 'Audit Pair') {
    throw new Error('Rewrite Route: node 34 is named ' + JSON.stringify(audit.name) + ' and this node connects from "Audit Pair". Rename both in the same edit.');
  }
  const code = String(audit.parameters.jsCode || '');

  const stamps = [
    ['j._call_now = true;', 'the only place a pair is admitted to the paid rewrite'],
    ['j._call_now = false;', 'the false stamp on a passing letter, a held pair and every carried report'],
    ['_call_now: false,', 'the false stamp on the stage report itself'],
  ];
  for (const [needle, what] of stamps) {
    if (code.indexOf(needle) === -1) {
      throw new Error(
        'Rewrite Route: Audit Pair no longer contains ' + JSON.stringify(needle) + ', which is ' + what + '.\n' +
        '  Under strict type validation an undefined boolean here is an ERROR, not a false, so an item\n' +
        '  missing it fails the route instead of taking the carry side.'
      );
    }
  }
  if (code.indexOf('j.rewrite_request = req;') === -1) {
    throw new Error('Rewrite Route: Audit Pair no longer builds rewrite_request, which is the entire body the node on the true side posts. Routing items to it would send the literal string "undefined".');
  }
  // The CV hold must happen BEFORE this route, or a CV fault becomes a paid call that cannot fix it.
  if (code.indexOf('if (result.failed_cv.length) {') === -1) {
    throw new Error(
      'Rewrite Route: Audit Pair no longer holds a pair whose CV failed. That branch has to sit upstream\n' +
      '  of this route: a CV failure means the assembler is wrong or a master changed under a pinned id,\n' +
      '  and a rewrite would return a second CV with the same fault and a clean looking report.'
    );
  }
}());

module.exports = {
  name: 'Rewrite Route',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [8580, 100],
  connectFrom: 'Audit Pair',
  notes: 'Output 0 (true): the letters that failed a letter scope check and get their ONE reasoned rewrite on claude-sonnet-5. Output 1 (false): the letters that PASSED the audit, every pair held on a CV check, every earlier hold and every report. A CV failure never reaches the true side, by design. There is no edge back from Audit Pair Final, so one attempt is a property of the graph rather than of a counter somebody can raise.',
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
