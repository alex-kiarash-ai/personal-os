'use strict';
/*
 * 46-read-back-writes.js - "Read Back Writes". The second half of Verify-after-write.
 *
 * Two ranges, one call:
 *   <runsTab>!A:I     the whole run ledger. Answers "is the row this run just wrote actually in the
 *                     tab, with this run's exec_id and this run's numbers". Row 1 is the header, so
 *                     the same read also proves the ledger columns are still the nine that were
 *                     provisioned, which is the only check that can catch a hand edit to that tab.
 *   <settingsTab>!A:B the settings tab again. Answers the question the write half cannot: did
 *                     last_run_at end up holding what this run intended. On a run that advanced,
 *                     that is the new timestamp. On a run that did not, it is the OLD value byte for
 *                     byte, which is the preserved-cell check the settings sync already uses live.
 *
 * The runs tab is one row per run, so `A:I` is a few hundred rows a year. Read whole rather than
 * bounded because the row that has to be found is the LAST one, and a bounded range that guessed
 * where the end is would be a check that can miss the row it is looking for.
 *
 * onError: continueRegularOutput. A read-back that throws would kill the run before the HQ push,
 * which is the same mistake as letting the write throw. A read-back that fails is DATA: Check Writes
 * turns it into an explicit UNVERIFIED, HQ goes red, and Assert Writes fails the execution after the
 * report has gone out.
 *
 * executeOnce, so the read happens once whatever the upstream node returns.
 */

const { lane, googleSheetsCredential } = require('./_lane');
const O = require('./_output');

const L = lane();
const RUNS_TAB = L.sheet.run_ledger_tab;
const SETTINGS_TAB = L.sheet.settings_tab;
const LAST_COL = String.fromCharCode('A'.charCodeAt(0) + O.RUNS_COLUMNS.length - 1); // I, for nine

const RANGES = [
  O.a1(RUNS_TAB, 'A:' + LAST_COL),
  O.a1(SETTINGS_TAB, 'A:B'),
];
const TIMEOUT_MS = 30000;

(function assertAgainstUpstream() {
  const upd = require('./45-update-last-run.js');
  if (upd.name !== 'Update Last Run') throw new Error('Read Back Writes: node 45 is named ' + JSON.stringify(upd.name) + ' and this node connects from "Update Last Run".');
  if (!RUNS_TAB || !SETTINGS_TAB) throw new Error('Read Back Writes: lane.json is missing sheet.run_ledger_tab or sheet.settings_tab.');
  if (O.RUNS_COLUMNS.length > 26) throw new Error('Read Back Writes: the runs tab has grown past column Z and the range builder here only does single letters.');
  // Both writes have to be UPSTREAM of this read, or it verifies a state that has not happened yet.
  const wr = require('./44-write-run.js');
  if (wr.connectFrom !== 'Build Run Row') throw new Error('Read Back Writes: Write Run no longer sits between Build Run Row and Update Last Run, so this read may run before the ledger row is written.');
  if (upd.connectFrom !== 'Write Run') throw new Error('Read Back Writes: Update Last Run no longer sits directly after Write Run, so this read may run before the window write.');
}());

module.exports = {
  name: 'Read Back Writes',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [6760, 780],
  connectFrom: 'Update Last Run',
  executeOnce: true,
  onError: 'continueRegularOutput',
  notes: 'One values:batchGet reading the whole runs tab and the settings tab, after both writes. Proves this run\'s ledger row is really there with this run\'s exec_id, that the ledger header is still the nine provisioned columns, and that last_run_at holds the new value on a run that advanced or the OLD value byte for byte on a run that did not.',
  credentials: googleSheetsCredential(),
  parameters: {
    method: 'GET',
    url: O.batchGetUrl(L.sheet.spreadsheet_id, RANGES),
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleSheetsOAuth2Api',
    options: {
      timeout: TIMEOUT_MS,
      response: {
        response: {
          fullResponse: true,
          neverError: true,
          responseFormat: 'json',
        },
      },
    },
  },
};
