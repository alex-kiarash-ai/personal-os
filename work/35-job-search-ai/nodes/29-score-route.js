'use strict';
/*
 * 29-score-route.js - "Score Route". Output 0: the rows that get a paid call. Output 1: everything
 * else, which is every unscored job row, every source report and every stage report.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS NODE EXISTS, because the dispatch asked for three nodes and this is one of two extra.
 * ---------------------------------------------------------------------------------------------
 * The dispatch specified Budget Gate, Score Job, Parse Score, chained. Measured against how n8n
 * actually executes, that chain cannot survive the ordinary case.
 *
 * n8n does not run a node whose input carries no items. The engine's own condition is
 * `taskDataMain.filter((data) => data.length).length !== 0` (packages/core/src/execution-engine/
 * workflow-execute.ts), and `alwaysOutputData` does not change it: that flag makes a node that RAN
 * and produced nothing emit an empty item, and a node that never ran emits nothing at all. This is
 * the same engine behaviour 22-remove-known.js already documents from the other side.
 *
 * So in a three-node chain, a run with nothing to score skips Score Job, which skips Parse Score,
 * which ends the branch and takes every source report and both stage reports with it. That is the
 * exact failure the Combine bug caused on 2026-09-11, and a run with nothing to score is not an
 * edge case: Remove Known's own measurement is that the title rules take the BI lane to 7 rows and
 * the window takes it to 1, so a day with zero new jobs is a normal Tuesday. The run that refuses
 * the sheet read is also a zero-score run, and it is the run whose report matters most.
 *
 * The alternatives were weighed and rejected:
 *   - a sentinel item routed through the HTTP node anyway: it would make a real request to keep a
 *     branch alive, and pointing a credentialed request at a bogus host to avoid paying for it is
 *     a trick, not a design;
 *   - wiring the carry side into Parse Score's single input alongside Score Job: two branches into
 *     one input makes the node RUN TWICE, once per branch, each run seeing only its own items. That
 *     is the trap 19-combine.js records from execution 5065;
 *   - letting Budget Gate emit only scorable rows and having Stage F merge the rest: the
 *     budget_hit stamp then has to be recomputed in Stage F, and a decision made in two places is
 *     the class of bug this relay has found three times already.
 * An IF and a Merge cost two simple nodes and keep every decision in one place. That is the trade.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY IT READS A BOOLEAN AND NOTHING ELSE.
 * ---------------------------------------------------------------------------------------------
 * Budget Gate sets `_score_now` on EVERY item, reports included. The condition is a strict boolean
 * test, so an item that somehow arrives without the key errors here rather than quietly taking the
 * carry side. All the judgement lives in Budget Gate; this node re-derives nothing, exactly the way
 * `More LinkedIn Pages?` reads only the boolean the page guard computed.
 */

const CONDITION_ID = '5d3a7f21-9c48-4b06-8e57-2f1b6a94c0d3';

(function assertAgainstUpstream() {
  const gate = require('./28-budget-gate.js');
  if (gate.name !== 'Budget Gate') {
    throw new Error('Score Route: node 28 is named ' + JSON.stringify(gate.name) + ' and this node connects from "Budget Gate". Rename both in the same edit.');
  }
  // The flag is set in TWO places and this checks BOTH by their exact text, not by whether the
  // string appears anywhere. A looser check passes on a file that mentions the field once and never
  // stamps a job with it, which is the single failure that would send every row down the carry side
  // and make every run look like a quiet day. The test suite proves this guard fires by renaming
  // exactly the job assignment and leaving the report one alone.
  const code = String(gate.parameters.jsCode || '');
  const JOB_STAMP = 'out._score_now = willScore;';
  const CARRY_STAMP = '_score_now: false';
  if (code.indexOf(JOB_STAMP) === -1) {
    throw new Error(
      'Score Route: Budget Gate no longer contains ' + JSON.stringify(JOB_STAMP) + ', which is where a\n' +
      '  JOB row gets the only field this node routes on. Without it every row takes the carry side,\n' +
      '  nothing is ever scored, and the run looks like a quiet day rather than a broken one.\n' +
      '  If the stamp legitimately moved, update this exact string in the same edit.'
    );
  }
  if (code.indexOf(CARRY_STAMP) === -1) {
    throw new Error(
      'Score Route: Budget Gate no longer sets ' + JSON.stringify(CARRY_STAMP) + ' on the carried items.\n' +
      '  Under strict type validation an undefined boolean is an ERROR here, not a false, so every\n' +
      '  source report would fail the route and the run would lose its verdict.'
    );
  }
}());

module.exports = {
  name: 'Score Route',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [4680, 160],
  connectFrom: 'Budget Gate',
  notes: 'Output 0 (true): rows Budget Gate admitted for a paid call. Output 1 (false): every unscored job row, every source report and every stage report, carried straight to Score Results. Nothing is dropped on either side.',
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          id: CONDITION_ID,
          leftValue: '={{ $json._score_now }}',
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
};
