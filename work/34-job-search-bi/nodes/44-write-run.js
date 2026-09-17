'use strict';
/*
 * 44-write-run.js - "Write Run". One row in the run ledger, every run, whatever happened.
 *
 * ---------------------------------------------------------------------------------------------
 * IT IS WRITTEN BEFORE last_run_at MOVES, AND THAT ORDER IS THE DECISION.
 * ---------------------------------------------------------------------------------------------
 * The run row is the telemetry, and telemetry matters most on the run that went wrong. Written
 * after the window write it would be the first thing lost when that write throws, so it goes first.
 * The cost of that order is stated rather than hidden: this row records the advance DECISION and
 * cannot record whether the advance WRITE landed. Check Writes catches that a beat later and it
 * reaches a human through HQ and through a thrown error, not through this row.
 *
 * ---------------------------------------------------------------------------------------------
 * NINE COLUMNS, MAPPED BY NAME, RAW.
 * ---------------------------------------------------------------------------------------------
 * `defineBelow` for the same reason Write Jobs uses it: with auto-mapping, the `_report`, `_hq` and
 * `_last_run_body` keys riding on the item would each go through `handlingExtraData`, whose default
 * is `insertInNewColumn`, and add columns to the ledger nobody chose. `columns.schema` is required
 * on 4.4+ with defineBelow and gives the free `checkForSchemaChanges` guard against a renamed column.
 *
 * `cellFormat: RAW`, so `note` is text. It is the one free-text column in this lane, it is assembled
 * from source names and model output, and under the node's default of USER_ENTERED a note that
 * happened to start with a minus sign would be a formula. Build Run Row strips the prefix as well.
 *
 * `onError: continueRegularOutput`. A failed ledger write must not stop the run before the HQ push,
 * which would leave a bad run with no ledger row AND no dashboard colour. Check Writes reads the
 * ledger back and turns a missing row into RED and then into a thrown error.
 *
 * No retry: append is not idempotent, and a retried ledger write is a duplicate row for one run.
 */

const { lane, googleSheetsCredential } = require('./_lane');
const O = require('./_output');

const L = lane();
const RUNS_TAB = L.sheet.run_ledger_tab;

(function assertAgainstUpstream() {
  const brr = require('./43-build-run-row.js');
  if (brr.name !== 'Build Run Row') throw new Error('Write Run: node 43 is named ' + JSON.stringify(brr.name) + ' and this node connects from "Build Run Row".');
  if (!RUNS_TAB) throw new Error('Write Run: lane.json has no sheet.run_ledger_tab.');

  // EXACTLY ONE ITEM has to come out of Build Run Row. This node appends once per input item, and
  // so do the two after it, so a second item would be a second ledger row, a second window write and
  // a second HQ push for one run.
  const src = (brr.parameters && brr.parameters.jsCode) || '';
  if (!/return \[\{\s*\n\s*json: Object\.assign\(\{\}, runRow,/.test(src)) {
    throw new Error(
      'Write Run: Build Run Row no longer returns a single-item array.\n' +
      '  Every node from here to Push HQ runs once per input item, so a second item is a second ledger\n' +
      '  row, a second last_run_at write and a second HQ push for one run.'
    );
  }
  // The nine columns this node maps have to be the nine the row builder produced.
  for (const c of O.RUNS_COLUMNS) {
    if (src.indexOf('\n  ' + c + ':') === -1 && src.indexOf('\n  ' + c + ': ') === -1) {
      throw new Error('Write Run: Build Run Row\'s runRow object no longer carries a ' + JSON.stringify(c) + ' key, and this node maps that column by name. An unmapped column writes an empty cell and returns 200.');
    }
  }
}());

module.exports = {
  name: 'Write Run',
  type: 'n8n-nodes-base.googleSheets',
  typeVersion: 4.5,
  position: [6500, 780],
  connectFrom: 'Build Run Row',
  onError: 'continueRegularOutput',
  notes: 'Appends one row to the runs tab: date, exec_id, searched, filtered, new, scored, verdict, note, cost_usd. Written BEFORE last_run_at moves, so a failing window write cannot take the ledger row with it. defineBelow so the provenance keys riding on the item can never add a column, RAW so the note is text.',
  credentials: googleSheetsCredential(),
  parameters: {
    operation: 'append',
    documentId: { __rl: true, value: L.sheet.spreadsheet_id, mode: 'id' },
    sheetName: { __rl: true, value: RUNS_TAB, mode: 'name' },
    columns: {
      mappingMode: 'defineBelow',
      value: O.mapperValues(O.RUNS_COLUMNS),
      schema: O.mapperSchema(O.RUNS_COLUMNS),
    },
    options: {
      cellFormat: 'RAW',
    },
  },
};
