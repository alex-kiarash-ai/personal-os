'use strict';
/*
 * 40-write-jobs.js - "Write Jobs". Appends the new rows to the jobs tab. The only node in this lane
 * that adds a row to the sheet Shaheen opens in the morning.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. IT POINTS AT A TEST TAB, ON PURPOSE, AND THE REPOINT IS ONE DELETED LINE.
 * ---------------------------------------------------------------------------------------------
 * `sheet.jobs_write_tab` in config/lane.json is `jobs_test` today, so the first live write lands
 * where a mistake costs nothing. Delete that ONE key and run `build.js --rebuild` and the write
 * falls back to `sheet.tab`, the real jobs tab. Nothing else moves.
 *
 * While the key is present the lane REFUSES to advance last_run_at, and that is not decoration: a
 * window that moved past rows written only to a test tab would lose them permanently the moment the
 * write is repointed, and every run would still look green. Build Run Row owns that condition.
 *
 * **THE TAB DOES NOT EXIST YET.** Read live 2026-09-12 through the Drive MCP: the BI spreadsheet has
 * exactly four tabs, settings / jobs / runs / applications. Creating it is a WRITE and this seat is
 * forbidden one, so it is handed over as a named prerequisite rather than assumed. It has to be
 * created WITH the header row, and the cheapest correct way is to duplicate the `jobs` tab and
 * rename the copy, because `jobs` holds its header and no data. See note 3 for what happens if it is
 * created blank instead, which is worse than it looks.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. defineBelow, NOT autoMapInputData, AND IT IS A SAFETY CHOICE.
 * ---------------------------------------------------------------------------------------------
 * Measured in packages/nodes-base/nodes/Google/Sheet/v2/actions/sheet/commonDescription.ts at
 * n8n@2.30.3: with `autoMapInputData`, every input key that does not match a column goes through
 * `handlingExtraData`, whose default is `insertInNewColumn`. Pointed at a live sheet that silently
 * ADDS a column per unmatched key. `defineBelow` never looks at an unmatched key at all.
 *
 * `columns.schema` is REQUIRED here, not cosmetic. On typeVersion >= 4.4 with defineBelow,
 * append.operation.ts throws when the schema is missing or empty, and then runs
 * `checkForSchemaChanges(node, liveHeaderRow, schema)`, which throws when a declared column is absent
 * from the sheet's real header. So the schema buys a free guard: a renamed or deleted column in
 * Shaheen's sheet fails the WRITE, loudly, instead of putting a row in the wrong columns. Both the
 * schema and the value map are generated from the contract's `shared_row_shape`, so they cannot
 * drift from what Build Rows produces or from what the collectors fill.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. cellFormat: RAW IS LOAD-BEARING, AND THE DEFAULT IS THE DANGEROUS ONE.
 * ---------------------------------------------------------------------------------------------
 * `cellFormatDefault(nodeVersion)` returns `USER_ENTERED` for anything at or above 4.1, and this
 * node is 4.5. Under USER_ENTERED a cell that begins `=`, `+`, `-` or `@` is a live FORMULA. The
 * `excerpt` column is up to 1200 characters of a job ad written by a stranger, and `title` and
 * `company` come off the same page. So RAW is set explicitly rather than left to a default that
 * points the wrong way. Build Rows strips the prefix as well; two layers, because the option is not
 * mine to guarantee once someone opens the node in the editor.
 *
 * RAW also keeps `fit_score` a real number so the sheet sorts on it, and keeps every timestamp the
 * exact text it was written as, which is what Remove Known reads back on the next run.
 *
 * **THE DEGENERATE PATH, worth knowing before it bites.** `execute()` reads the target range first
 * and, if the tab comes back EMPTY, reassigns `dataMode = 'autoMapInputData'` and skips the schema
 * check. So a `jobs_test` created as a blank tab makes the node invent a header out of the first
 * item's keys. Build Rows keeps a writable item to the eleven real column names plus `_write_now`
 * precisely so that path would produce a header that is recognisably eleven twelfths right, and
 * the header read-back in Build Run Row fails the run on the twelfth.
 *
 * ---------------------------------------------------------------------------------------------
 * 4. onError: continueRegularOutput, AND NO RETRY.
 * ---------------------------------------------------------------------------------------------
 * A failed write has to arrive as DATA. Throwing here would kill the run before the ledger row and
 * the HQ push, so the one run where a human most needs to be told would tell nobody. Build Run Row
 * classifies the error item, refuses to advance the window, writes the run row anyway and pushes RED.
 *
 * No retry: n8n retries the whole NODE, so a retry on a partially successful append would write the
 * successful rows a second time. An append is not idempotent and there is no key to make it one. The
 * recovery is already built and is strictly better: last_run_at does not advance, so the next run
 * re-collects the same window and Remove Known deduplicates whatever did land.
 */

const { lane, sources, googleSheetsCredential } = require('./_lane');
const O = require('./_output');

const L = lane();
const CONTRACT = sources();
const ROW_SHAPE = CONTRACT.shared_row_shape;
const WRITE = O.writeTarget();

(function assertAgainstUpstream() {
  const route = require('./39-write-route.js');
  if (route.name !== 'Write Route') {
    throw new Error('Write Jobs: node 39 is named ' + JSON.stringify(route.name) + ' and this node hangs off its true branch.');
  }
  const build = require('./38-build-rows.js');
  const src = (build.parameters && build.parameters.jsCode) || '';
  // The value map addresses each column by name off the item. Build Rows has to be putting them
  // at the TOP LEVEL of a writable row, not nested, or every mapped cell resolves to undefined and
  // the append writes eleven empty columns with a 200.
  //
  // The regex widened on 2026-09-17. Build Rows used to write every column through one `cell()` call;
  // found_at and posted_at now go through `cell(dateOnly(...))` because Shaheen asked for a date and
  // not a timestamp, so the loop body is a branch rather than a single expression. What this check is
  // actually for is the TOP-LEVEL assignment `row[col] = `, and that is what it now matches.
  if (!/for \(const col of ROW_SHAPE\) \{[\s\S]{0,400}?row\[col\] = /.test(src)) {
    throw new Error(
      'Write Jobs: Build Rows no longer places the eleven columns at the top level of a writable row.\n' +
      '  This node maps each cell with $json["<column>"], so a nested row would append eleven blank\n' +
      '  columns and return a perfectly healthy 200.'
    );
  }
  if (!L.sheet.spreadsheet_id) throw new Error('Write Jobs: lane.json has no sheet.spreadsheet_id.');
  O.assertTabsAgainstSeed(ROW_SHAPE);
}());

module.exports = {
  name: 'Write Jobs',
  type: 'n8n-nodes-base.googleSheets',
  typeVersion: 4.5,
  position: [5980, 680],
  connectFrom: { node: 'Write Route', outputIndex: 0 },
  // A failed write is DATA, so the run still writes its ledger row and still pushes HQ. See note 4.
  onError: 'continueRegularOutput',
  notes: 'Appends the new job rows to the jobs tab, one API call for the whole batch. defineBelow so an unmatched key can never add a column to Shaheen\'s sheet, columns.schema so a renamed column fails the write instead of shifting it, cellFormat RAW so a job ad that starts with = is text and not a formula. Points at a TEST tab until the repoint. Never retried: an append is not idempotent.',
  credentials: googleSheetsCredential(),
  parameters: {
    operation: 'append',
    documentId: { __rl: true, value: L.sheet.spreadsheet_id, mode: 'id' },
    sheetName: { __rl: true, value: WRITE.tab, mode: 'name' },
    columns: {
      mappingMode: 'defineBelow',
      value: O.mapperValues(ROW_SHAPE),
      // Required on 4.4+ with defineBelow, and checked against the live header row on every run.
      schema: O.mapperSchema(ROW_SHAPE),
    },
    options: {
      // See note 3. The default at this typeVersion is USER_ENTERED, which makes an attacker
      // controllable excerpt beginning with '=' a live formula in his spreadsheet.
      cellFormat: 'RAW',
    },
  },
};
