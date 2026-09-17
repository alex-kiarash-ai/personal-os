'use strict';
/*
 * 20-research-route.js - "Research Route". Output 0: the companies that get a paid sonnet call.
 * Output 1: every pair, every unreadable company, every lane report and every stage report.
 *
 * ---------------------------------------------------------------------------------------------
 * ONE BOOLEAN AND NOTHING ELSE.
 * ---------------------------------------------------------------------------------------------
 * Build Research Request stamps `_call_now` on EVERY item it emits, and it is the one place the
 * decision is made: a company whose page was actually readable gets true, and everything else,
 * pairs included, gets false. This node re-derives nothing.
 *
 * The condition is a strict boolean test, so an item that somehow arrives without the key ERRORS
 * here rather than quietly taking the carry side. On this route the carry side is free and the true
 * side spends money, so a silent reroute one way is an unbilled disappearance of work and the other
 * way is a bill nobody planned.
 *
 * ---------------------------------------------------------------------------------------------
 * THE ROUTE AND THE MERGE EXIST BECAUSE AN EMPTY TRUE SIDE IS THE NORMAL CASE HERE.
 * ---------------------------------------------------------------------------------------------
 * n8n does not run a node whose input carries no items, and `alwaysOutputData` does not change it.
 * Most mornings no company site is readable at all: the recruiter reader answers employer_website
 * with null far more often than not, the apply url usually points at a board the denylist refuses,
 * and a corporate homepage frequently answers a datacenter IP with a 403. Without this pair of nodes
 * that entirely ordinary run would skip Research Company, skip Parse Research, and end the branch
 * carrying every pair on it, which is every application the run was going to write.
 */

const CONDITION_ID = 'b6d82e17-4a35-4c90-a7e8-51f2c6b03d49';

(function assertAgainstUpstream() {
  const build = require('./19-build-research-request.js');
  if (build.name !== 'Build Research Request') {
    throw new Error('Research Route: node 19 is named ' + JSON.stringify(build.name) + ' and this node connects from "Build Research Request". Rename both in the same edit.');
  }
  const code = String(build.parameters.jsCode || '');

  // The flag is set in four places in that node and each is checked by its exact text. A looser
  // check passes on a file that mentions the field once and never stamps a carried pair with it,
  // which is the single failure that would send every application down the error path under strict
  // validation and lose the whole run.
  const stamps = [
    ['site._call_now = true;', 'the only place a company is admitted to the paid call'],
    ['site._call_now = false;', 'the false stamp on an unreadable company'],
    ['j._call_now = false;', 'the false stamp on every pair and every carried report'],
    ['_call_now: false,', 'the false stamp on the stage report itself'],
  ];
  for (const [needle, what] of stamps) {
    if (code.indexOf(needle) === -1) {
      throw new Error(
        'Research Route: Build Research Request no longer contains ' + JSON.stringify(needle) + ', which is ' + what + '.\n' +
        '  Under strict type validation an undefined boolean here is an ERROR, not a false, so an item\n' +
        '  missing it fails the route instead of taking the carry side. If the stamp legitimately moved,\n' +
        '  update this exact string in the same edit.'
      );
    }
  }
  if (code.indexOf('research_request') === -1) {
    throw new Error('Research Route: Build Research Request no longer builds research_request, which is the entire body the node on the true side posts. Routing items to it would send the literal string "undefined".');
  }
  // `unusable()` is the one function that can turn a routed company back into a carried one. If it
  // ever stopped clearing the flag, an unreadable page would be sent to a paid model with an empty
  // request body.
  if (code.indexOf('function unusable(') === -1) {
    throw new Error('Research Route: Build Research Request no longer declares unusable(), which is the single place an unreadable company has its _call_now cleared. Without it a 403 page would be routed to a paid call.');
  }
}());

module.exports = {
  name: 'Research Route',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [4680, 100],
  connectFrom: 'Build Research Request',
  notes: 'Output 0 (true): the companies whose page was actually readable and which Build Research Request admitted to the paid claude-sonnet-4-6 call. Output 1 (false): every pair, every unreadable company, every lane report and every stage report, carried straight to Research Results. Strict boolean, so a missing flag is a loud contract violation rather than a silent reroute. An empty true side is the ordinary case on this stage.',
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
