'use strict';
/*
 * 16-site-route.js - "Site Route". Output 0: the one-per-company site items that get fetched.
 * Output 1: every pair, every lane report and every stage report, carried straight to Site Results.
 *
 * ---------------------------------------------------------------------------------------------
 * THE CONDITION IS `_kind`, NOT `_call_now`, AND THE PLAN SAYS SO.
 * ---------------------------------------------------------------------------------------------
 * The approved plan names this route literally: `_kind === 'site'`. It is the right test here for a
 * reason the other two routes do not have: this is the only stage whose true side carries a
 * DIFFERENT KIND OF ITEM rather than a subset of the same one. Every pair takes the carry side by
 * definition, so a route on a boolean would be testing "is this not a pair" the long way round.
 *
 * `_call_now` is stamped by Plan Research as exactly this predicate anyway, so the rest of the
 * pipeline keeps its one-boolean convention and the two can be checked against each other. The
 * build assertion below is what stops them drifting: if the stamp and this route ever stopped
 * meaning the same thing, a pair could be routed into an HTTP node whose url expression reads a
 * field it does not carry.
 *
 * ---------------------------------------------------------------------------------------------
 * typeValidation: strict, AND WHY IT IS SAFE.
 * ---------------------------------------------------------------------------------------------
 * Under strict validation an item arriving with no `_kind` at all is an ERROR rather than a false.
 * That is wanted, and it is already true of every item in this workflow: Build Candidates stamps
 * `_kind` on pairs, lane reports and its own stage report, and every Code node since has carried it
 * through. An item without one would be an item nobody built, and routing it quietly to the carry
 * side would hide that.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE ROUTE AND THE MERGE EXIST AT ALL, for the third time in this workflow.
 * ---------------------------------------------------------------------------------------------
 * n8n does not run a node whose input carries no items, and `alwaysOutputData` does not change it.
 * A morning where no company has a readable site is ORDINARY here, not exceptional: most postings
 * are board-hosted and the reader answers employer_website with null far more often than not. In a
 * straight chain that run would skip Fetch Company Site, skip Build Research Request, and end the
 * branch carrying every pair and every report with it.
 */

const CONDITION_ID = 'a7f31c05-2e94-4b7d-8f16-3c0d9a5e6b24';

(function assertAgainstUpstream() {
  const plan = require('./15-plan-research.js');
  if (plan.name !== 'Plan Research') {
    throw new Error('Site Route: node 15 is named ' + JSON.stringify(plan.name) + ' and this node connects from "Plan Research". Rename both in the same edit.');
  }
  const code = String(plan.parameters.jsCode || '');

  // Every stamp checked by its exact text, on BOTH sides. A looser check passes on a file that
  // mentions the field once and never stamps a carried item with it, which is the one failure that
  // would send every pair down the error path under strict validation.
  const stamps = [
    ["_kind: 'site'", 'the kind this route sends down output 0'],
    ["j.site_fetch_url = '';", 'the empty site url on every item that is NOT fetched'],
    ['j._call_now = false;', 'the false boolean on every item that is NOT fetched'],
    ['_call_now: true,', 'the true boolean on a site item, which must mean the same thing as this route'],
  ];
  for (const [needle, what] of stamps) {
    if (code.indexOf(needle) === -1) {
      throw new Error(
        'Site Route: Plan Research no longer contains ' + JSON.stringify(needle) + ', which is ' + what + '.\n' +
        '  Under strict type validation a missing field here is an ERROR rather than a false, so an item\n' +
        '  without it fails the route instead of taking the carry side, and the run loses its reports.\n' +
        '  If the stamp legitimately moved, update this exact string in the same edit.'
      );
    }
  }
  // The url the node on the true side posts to. A site item without it would send a GET to the
  // literal string "undefined".
  if (code.indexOf('site_fetch_url: c.site_url,') === -1) {
    throw new Error('Site Route: Plan Research no longer puts site_fetch_url on its site items, which is the entire url the node on the true side fetches.');
  }
}());

module.exports = {
  name: 'Site Route',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [3640, 100],
  connectFrom: 'Plan Research',
  notes: 'Output 0 (true): the one-per-company site items Plan Research built. Output 1 (false): every pair alive or dead, every lane report and every stage report, carried straight to Site Results. Strict validation, so an item with no _kind is a loud contract violation rather than a silent reroute.',
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          id: CONDITION_ID,
          leftValue: '={{ $json._kind }}',
          rightValue: 'site',
          operator: { type: 'string', operation: 'equals' },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
};
