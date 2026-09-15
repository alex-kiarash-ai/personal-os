'use strict';
/*
 * 52-folder-route.js - "Folder Route". Output 0: the pairs that are going to Drive. Output 1:
 * everything else, carried straight to Folder Results.
 *
 * =============================================================================================
 * 1. ONLY A SHIPPED PAIR GETS A FOLDER, AND THAT IS THE WHOLE JOB OF THIS NODE.
 * =============================================================================================
 * Held, blocked, capped and errored pairs travel to the end of the run carrying their reasons,
 * because the run report and the sheet rows are built out of them. None of them has a document.
 * Creating a folder for one would put an empty folder dated today, named after a real company, into
 * the place he looks for finished applications, and a folder that is empty is indistinguishable
 * from a folder whose upload failed.
 *
 * =============================================================================================
 * 2. THE PREDICATE IS DERIVED, NOT STAMPED, AND THAT IS A DEVIATION WORTH NAMING.
 * =============================================================================================
 * Every other route in this workflow tests a boolean the node before it stamped, so the stamp and
 * the route can be checked against each other and a drift fails the build. This one cannot.
 *
 * The approved plan says this node routes on `outcome === 'ship'`. Nothing upstream stamps a field
 * called `outcome`: Check Renders leaves `_status` absent on a pair that passed R1 to R6 and stamps
 * it on every pair that did not, and it sets `_call_now` to false on EVERY item, including the ones
 * that ship. Check Renders belongs to seat 6 and this seat may not edit it.
 *
 * So the predicate is derived in two places: as the expression below, and as outcomeOf() inside the
 * five Code nodes after it. Two derivations of one rule is exactly what this project refuses
 * everywhere else, so nodes/_write.js does not leave it on trust: assertShipExpressionAgrees()
 * EXECUTES the expression bytes that ship, over sixteen synthetic items covering every shape that
 * travels this workflow, and fails this build if the two ever disagree on one of them.
 *
 * =============================================================================================
 * 3. typeValidation strict, AND WHY IT IS SAFE ON AN EXPRESSION THAT COMPUTES ITS OWN LEFT SIDE.
 * =============================================================================================
 * Strict validation turns a missing field into an ERROR rather than a false. That is wanted
 * everywhere in this workflow and it is the reason the other routes test `_kind`, which every item
 * carries. This one tests a computed string, so it can never be missing: the conditional returns
 * "ship" or "no" for any item at all, including an item with no keys. The strictness still buys
 * something real, which is why it is set rather than dropped: if the expression is ever edited into
 * something that can return a number or a null, the node fails loudly instead of routing quietly.
 *
 * =============================================================================================
 * 4. AN EMPTY TRUE SIDE IS ORDINARY AND IS NOT A PROBLEM HERE.
 * =============================================================================================
 * A morning where nothing ships is common: both lanes capped out, every letter held by the blind
 * grade, an Anthropic outage at the reader. n8n does not run a node with no input, so Create Folder
 * is simply skipped, and Folder Results still runs because its input 1 is never empty. That is the
 * sixth time this workflow has needed a route and a merge for that reason and it is the reason both
 * are here.
 */

const W = require('./_write');

const CONDITION_ID = 'f61c9a37-42d8-4e15-b7a0-5d3e8c216f94';

(function assertAgainstUpstream() {
  W.assertShippedPairShape();
  W.assertShipExpressionAgrees();

  const check = require('./51-check-renders.js');
  const src = String(check.parameters.jsCode || '');

  // The two stamps this route depends on NOT being there, and the one it depends on being there.
  // A looser check would pass on a file that mentions the field and never stamps it.
  if (src.indexOf('j._call_now = false;') === -1) {
    throw new Error(
      'Folder Route: Check Renders no longer sets _call_now to false on every pair.\n' +
      '  This route deliberately does NOT test that boolean, because it is false on a shipped pair too.\n' +
      '  If that ever changes, this node should go back to the one boolean convention the rest of the\n' +
      '  workflow uses, and the note in this file explaining why it cannot should go with it.'
    );
  }
  if (src.indexOf("out.push({ json: j, binary: binary });") === -1) {
    throw new Error('Folder Route: Check Renders no longer emits a passing pair carrying its two PDFs, so the true side of this route would carry pairs with no bytes and the upload would create four empty files with four healthy 200s.');
  }
  // A pair that Check Renders held or failed MUST carry a _status, or it would take the true side of
  // this route and be given a folder it has no documents for.
  for (const needle of ["j._status = 'error:render';", "j._status = 'needs_review';"]) {
    if (src.indexOf(needle) === -1) {
      throw new Error(
        'Folder Route: Check Renders no longer stamps ' + JSON.stringify(needle) + '.\n' +
        '  The absence of _status is what this route reads as "this pair shipped". A refused pair that\n' +
        '  carried no status would be read as a shipped one, get a folder, and reach the upload with no\n' +
        '  documents attached.'
      );
    }
  }
}());

module.exports = {
  name: 'Folder Route',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [13000, 100],
  connectFrom: 'Check Renders',
  notes: 'Output 0 (true): the pairs that passed R1 to R6 and carry both PDFs, which are the only pairs that get a Drive folder. Output 1 (false): every held, blocked, capped and errored pair, every lane report and every stage report, carried straight to Folder Results. The predicate is DERIVED rather than read off a stamp, because Check Renders marks a shipped pair by the ABSENCE of a status and sets _call_now false on everything; nodes/_write.js executes this exact expression against outcomeOf() over sixteen synthetic items at build time so the two derivations cannot drift.',
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          id: CONDITION_ID,
          leftValue: W.SHIP_EXPRESSION,
          rightValue: W.SHIP_VALUE,
          operator: { type: 'string', operation: 'equals' },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
};
