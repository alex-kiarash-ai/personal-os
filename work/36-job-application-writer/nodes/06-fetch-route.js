'use strict';
/*
 * 06-fetch-route.js - "Fetch Route". Output 0: the pairs that get an ad fetched. Output 1:
 * everything else, which is every capped pair, every pair whose url failed the guard, every lane
 * report and the intake stage report.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE ROUTE AND THE MERGE EXIST AT ALL.
 * ---------------------------------------------------------------------------------------------
 * n8n does not run a node whose input carries no items. The engine condition is
 * `taskDataMain.filter((data) => data.length).length !== 0`, and `alwaysOutputData` does not change
 * it: that flag makes a node that RAN and produced nothing emit an empty item, and a node that
 * never ran emits nothing at all.
 *
 * So in a straight chain, a run with nothing to fetch would skip Fetch Ad, which would skip Attach
 * Ad, which would end the branch and take every lane report and the intake report with it. A run
 * with nothing to fetch is not an edge case here: a morning where both lanes are capped out, or
 * where the writer_runs tab does not exist yet, is exactly the run whose report matters most.
 *
 * The Route plus the Merge cost two simple nodes and keep every decision in Build Candidates.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY TWO CONDITIONS AND NOT ONE BOOLEAN, WHICH IS WHAT THE CONVENTION ASKS FOR.
 * ---------------------------------------------------------------------------------------------
 * The approved plan names this route literally: `_kind === 'pair' && ad_fetch_url`. Both halves are
 * kept, because they refuse different things. `_kind` keeps reports out of the HTTP node; the url
 * test keeps out a pair whose url failed the guard, which is the case the guard exists to create.
 *
 * `_call_now` is ALSO stamped on every item by Build Candidates, as exactly this predicate, so the
 * rest of the pipeline keeps its one-boolean convention and Attach Ad can count what should have
 * been called without re-deriving anything. The build assertion below is what stops the two from
 * drifting: if the stamp and this route ever stopped meaning the same thing, the count in the
 * report would be right and the routing would be wrong, and nothing at run time would say so.
 *
 * ---------------------------------------------------------------------------------------------
 * typeValidation: strict, AND WHY THAT IS SAFE HERE.
 * ---------------------------------------------------------------------------------------------
 * Under strict validation an item arriving without `ad_fetch_url` is an ERROR, not a false. That is
 * wanted: it makes a missing field a loud contract violation instead of a silent reroute. Build
 * Candidates therefore stamps `ad_fetch_url` (empty string when there is none) and `_kind` on EVERY
 * item it emits, reports included, and the assertion below checks both stamps by their exact text.
 */

const CONDITION_KIND = 'c1a7f0e2-5b64-4d38-9a10-7e3c8b2d4f61';
const CONDITION_URL = 'd2b8e1f3-6c75-4e49-8b21-9f4d0c3e5a72';

(function assertAgainstUpstream() {
  const build = require('./05-build-candidates.js');
  if (build.name !== 'Build Candidates') {
    throw new Error('Fetch Route: node 05 is named ' + JSON.stringify(build.name) + ' and this node connects from "Build Candidates". Rename both in the same edit.');
  }
  const code = String(build.parameters.jsCode || '');

  // Both stamps, by their exact text, on BOTH kinds of item. A looser check passes on a file that
  // merely mentions the field once and never stamps a report with it, which is the one failure that
  // would send every lane report down the error path under strict validation and lose the run
  // verdict on a morning when the verdict is the only output.
  const stamps = [
    ['ad_fetch_url: \'\'', 'the empty ad_fetch_url on the items that are NOT fetched'],
    ['_call_now: false', 'the false _call_now on the items that are NOT called'],
    ['p._call_now = p.ad_fetch_url !== \'\'', 'the one place the routing predicate is computed for a live pair'],
  ];
  for (const [needle, what] of stamps) {
    if (code.indexOf(needle) === -1) {
      throw new Error(
        'Fetch Route: Build Candidates no longer contains ' + JSON.stringify(needle) + ', which is ' + what + '.\n' +
        '  Under strict type validation an undefined field here is an ERROR rather than a false, so an\n' +
        '  item missing it fails the route instead of taking the carry side, and the run loses its\n' +
        '  reports. If the stamp legitimately moved, update this exact string in the same edit.'
      );
    }
  }
  // The route and the stamp have to mean the SAME thing. This is the pair of facts that keeps them
  // honest: the stamp is computed from ad_fetch_url, and this route tests ad_fetch_url.
  if (code.indexOf('_kind: \'pair\'') === -1) {
    throw new Error('Fetch Route: Build Candidates no longer stamps _kind pair on a candidate, and this route sends exactly that value down output 0.');
  }
}());

module.exports = {
  name: 'Fetch Route',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [1040, 100],
  connectFrom: 'Build Candidates',
  notes: 'Output 0 (true): pairs that have a guarded ad url. Output 1 (false): capped pairs, pairs whose url failed the guard, every lane report and the intake stage report, carried straight to Fetch Results. Nothing is dropped on either side.',
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          id: CONDITION_KIND,
          leftValue: '={{ $json._kind }}',
          rightValue: 'pair',
          operator: { type: 'string', operation: 'equals' },
        },
        {
          id: CONDITION_URL,
          leftValue: '={{ $json.ad_fetch_url }}',
          rightValue: '',
          operator: { type: 'string', operation: 'notEmpty', singleValue: true },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
};
