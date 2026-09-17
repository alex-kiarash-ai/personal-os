'use strict';
/*
 * 39-write-route.js - "Write Route". One boolean, no judgement of its own.
 *
 * Output 0 (true):  the rows Build Rows decided are safe to write.
 * Output 1 (false): every job row that is NOT being written, every source report, every stage
 *                   report. It is never empty, and that is load-bearing.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY AN IF AND A MERGE AROUND A SINGLE WRITE, WHICH IS THREE NODES WHERE THE DISPATCH DREW ONE.
 * ---------------------------------------------------------------------------------------------
 * n8n does not run a node whose input carries no items. The engine's condition is
 * `taskDataMain.filter((data) => data.length).length !== 0` in workflow-execute.ts and
 * `alwaysOutputData` does not change it, because that flag applies to a node that RAN.
 *
 * A run with nothing to write is ORDINARY on this lane, not an edge case. Three ways to get one on
 * any given Tuesday: nothing new survived the window (Remove Known measured the BI lane at 7 rows
 * after the title rules and 1 after the window), the sheet read was refused so every row is held
 * back, or scoring is down and every failure is systemic. The third is happening on every run today,
 * because the Anthropic account is deliberately empty.
 *
 * Hung straight off Build Rows, a Google Sheets node on a run with zero rows would be skipped, and
 * with it Build Run Row, Write Run, Update Last Run and Push HQ. The run that most needs a ledger
 * row and an HQ colour would produce neither, and the n8n execution would read `success`.
 *
 * That failure has now cost this workflow real data three times: Combine dropped 748 rows and six
 * source reports on 2026-09-11, the scoring chain would have dropped every report on 2026-09-12, and
 * the detail chain would have dropped twelve items on a quiet day. It is the same measurement each
 * time, which is why the dispatch named it non-negotiable and why the shape here is a copy of the
 * one already live twice: an IF, the write on the true branch, and a Merge that appends the carry
 * branch back. An empty input to a Merge in append mode appends nothing and truncates nothing.
 *
 * `typeValidation: strict`, matching Score Route and Detail Route rather than the two older IF nodes
 * on this box that use `loose`. Under loose, an item with no `_write_now` coerces to false and lands
 * quietly on the carry branch. Build Rows stamps that boolean on every single item it emits, so a
 * missing one is an upstream contract break and should stop the run rather than be rerouted.
 */

const BUILD_ROWS = require('./38-build-rows.js');

// A stable id. n8n generates one in the editor; a build that generated a fresh uuid every time would
// make every rebuild look like a changed node in the read-back diff.
const CONDITION_ID = 'c1f4a980-3b62-4d7e-9a05-8e7c2d1f4b63';

(function assertAgainstUpstream() {
  if (BUILD_ROWS.name !== 'Build Rows') {
    throw new Error('Write Route: node 38 is named ' + JSON.stringify(BUILD_ROWS.name) + ' and this node connects from "Build Rows".');
  }
  const src = (BUILD_ROWS.parameters && BUILD_ROWS.parameters.jsCode) || '';
  // The routing field is read from the upstream node's GENERATED code, so the two cannot drift.
  // Every emitted item has to carry it: the writable rows set it true, the carry items false, and
  // the stage report false on its own literal.
  if (!/row\._write_now\s*=\s*true/.test(src)) {
    throw new Error('Write Route: Build Rows no longer stamps `_write_now = true` on a writable row, and this IF routes on exactly that field under strict type validation.');
  }
  if (!/_write_now:\s*false/.test(src)) {
    throw new Error('Write Route: Build Rows no longer stamps `_write_now: false` on the carry items. Under strict validation an item with no boolean there stops the run, which would take every source report with it.');
  }
}());

module.exports = {
  name: 'Write Route',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [5850, 780],
  connectFrom: 'Build Rows',
  notes: 'Output 0 (true): the rows to append to the jobs tab. Output 1 (false): every unwritten row and every report, carried straight to Write Results so the run still reports on a day with nothing to write. Strict type validation: a missing _write_now is an upstream contract break, not a reroute.',
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          id: CONDITION_ID,
          leftValue: '={{ $json._write_now }}',
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
};
