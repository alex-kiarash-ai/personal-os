'use strict';
/*
 * 67-sheet-write-route.js - "Sheet Write Route". Output 0: the two per lane write requests. Output
 * 1: every pair, every lane report and every stage report, carried to Sheet Write Results.
 *
 * ---------------------------------------------------------------------------------------------
 * THE TRUE SIDE IS ALWAYS EXACTLY TWO ITEMS, AND THAT IS THE MECHANISM, NOT A COINCIDENCE.
 * ---------------------------------------------------------------------------------------------
 * Build Sheet Writes emits ONE request per lane on every run, including a run where that lane has
 * nothing to write, in which case the request carries an empty `data` array. That is a legal
 * batchUpdate that changes nothing.
 *
 * It exists so this branch is never empty. n8n does not run a node whose input carries no items, so
 * an empty true side here would skip the write, the read back, the check, the run report and the
 * heartbeat, and the run would finish having written nothing and said nothing about why. Every other
 * stage of this workflow solves that with a merge; this one also solves it by making the call
 * unconditional, because the decision about whether to write anything belongs in code where an
 * offline suite can reach it rather than in a branch nobody can exercise.
 *
 * ---------------------------------------------------------------------------------------------
 * `_kind`, NOT `_call_now`, FOR THE REASON RENDER ROUTE AND UPLOAD ROUTE BOTH GIVE.
 * ---------------------------------------------------------------------------------------------
 * The true side carries a DIFFERENT KIND of item rather than a subset of the same one. Build Sheet
 * Writes stamps `_call_now` as exactly this predicate anyway, so the two can be checked against each
 * other, and the build assertion below is what stops them drifting.
 *
 * Strict validation, so an item arriving with no `_kind` is a loud contract violation rather than a
 * silent reroute. Every item in this stream carries one: Check Uploads drops anything that does not.
 */

const CONDITION_ID = '5b0d7f93-6a21-4c88-9e34-1f8c25a7b60e';

(function assertAgainstUpstream() {
  const build = require('./66-build-sheet-writes.js');
  if (build.name !== 'Build Sheet Writes') {
    throw new Error('Sheet Write Route: node 66 is named ' + JSON.stringify(build.name) + ' and this node connects from "Build Sheet Writes". Rename both in the same edit.');
  }
  const code = String(build.parameters.jsCode || '');
  const stamps = [
    ["_kind: 'sheet_write',", 'the kind this route sends down output 0'],
    ['_call_now: true,', 'the true boolean on a write request, which must mean the same thing as this route'],
    ['j._call_now = false;', 'the false boolean on every pair and every carried item'],
    ['_call_now: false,', 'the false boolean on the stage report itself'],
  ];
  for (const [needle, what] of stamps) {
    if (code.indexOf(needle) === -1) {
      throw new Error(
        'Sheet Write Route: Build Sheet Writes no longer contains ' + JSON.stringify(needle) + ', which is ' + what + '.\n' +
        '  Under strict type validation a missing field here is an ERROR rather than a false, so an item\n' +
        '  without it fails the route instead of taking the carry side, and the run loses its reports.'
      );
    }
  }
  // The unconditional call is the whole mechanism. If the empty-data branch ever disappears, a
  // morning with nothing to write would skip this entire half of the workflow.
  if (code.indexOf("batch_update_body: { valueInputOption: 'RAW', data: data },") === -1) {
    throw new Error(
      'Sheet Write Route: Build Sheet Writes no longer always attaches a batchUpdate body to every lane.\n' +
      '  A lane with nothing to write sends an EMPTY data array, which is a legal call that changes\n' +
      '  nothing and is what keeps this branch from ever being empty. Without it, a quiet morning would\n' +
      '  skip the write, the read back, the check, the run report and the heartbeat in one go.'
    );
  }
  if (code.indexOf('writes.push(item);') === -1) {
    throw new Error('Sheet Write Route: Build Sheet Writes no longer emits one write request per lane, and this route sends exactly those items to the only node that writes to a spreadsheet.');
  }
}());

module.exports = {
  name: 'Sheet Write Route',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [16900, 100],
  connectFrom: 'Build Sheet Writes',
  notes: 'Output 0 (true): one values:batchUpdate request per lane, always exactly two, because a lane with nothing to write still sends an empty data array. Output 1 (false): every pair, every lane report and every stage report. The unconditional true side is the mechanism that keeps the write, the read back, the check, the run report and the heartbeat running on a morning that produced nothing.',
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          id: CONDITION_ID,
          leftValue: '={{ $json._kind }}',
          rightValue: 'sheet_write',
          operator: { type: 'string', operation: 'equals' },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
};
