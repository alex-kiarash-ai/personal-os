'use strict';
/*
 * 21-read-known-jobs.js - "Read Known Jobs". Reads the lane's `jobs` tab so the next node can drop
 * everything Shaheen has already been shown.
 *
 * Shape copied from 03-read-settings.js, which was taken off the live box rather than from memory:
 * googleSheets typeVersion 4.5, resource and operation left at their defaults (sheet / read, which
 * is how all 23 googleSheets nodes on this box are stored), documentId as a resource locator in
 * `id` mode, sheetName as a resource locator in `name` mode, options empty. The tab's header row is
 * the contract's shared_row_shape, written from that same list at provisioning time, so each output
 * item arrives as one already-seen job with those fifteen keys.
 *
 * THREE NODE-LEVEL FLAGS, AND EACH ONE IS LOAD BEARING.
 *
 * executeOnce: true. A Google Sheets node runs once per INPUT item. Filter hands this node every
 * surviving job plus every source report, so without this flag the same tab would be read and
 * billed once per item, producing N identical copies of the same known list and N times the quota.
 *
 * alwaysOutputData: true. This is what makes an EMPTY sheet distinguishable from a failed read. A
 * read that legitimately returns nothing (the first run, where the tab holds only its header)
 * produces zero items, and zero items out of a node means the branch ends: Remove Known would never
 * run, and the source reports would die with it. With the flag, an empty read emits one empty item,
 * which Remove Known reads as "the sheet is genuinely empty, proceed".
 *
 * onError: continueRegularOutput. The failure this protects against is the expensive one. If the
 * credential lapses, the tab is renamed, or Google rate-limits, the default behaviour stops the
 * workflow, which throws away every source report and every collected row in the same instant. With
 * this flag the failure arrives as an item carrying `error`, Remove Known sees it, emits ZERO job
 * rows and a degraded verdict, and the reports still reach Stage F. The rule it protects is the one
 * that matters most here: a failed read must NEVER be read as "the sheet is empty", because that
 * would re-write every job he has already seen.
 *
 * WHAT THIS NODE DOES NOT DO, and it is deliberate: it does not bound the read. The tab grows by at
 * most max_scored_per_run rows a run, so it is small for a long time, but it grows forever and this
 * node reads all of it every run. When that starts to matter the fix is a bounded range or a
 * separate index tab, not a smaller filter, and Remove Known reports the row count every run so the
 * growth is visible before it is a problem.
 *
 * The spreadsheet id and the credential id are READ from config/lane.json, never typed here. This
 * folder is tracked and the repo is PUBLIC; config/ is gitignored. See nodes/_lane.js.
 */

const { lane, sources, googleSheetsCredential } = require('./_lane');
const L = lane();
const CONTRACT = sources();

(function assertAgainstContract() {
  if (!L.sheet.tab) {
    throw new Error('Read Known Jobs: lane.json has no sheet.tab, and this node reads the jobs tab by name. Do not guess it.');
  }
  if (L.sheet.tab === L.sheet.settings_tab) {
    throw new Error(
      'Read Known Jobs: lane.json points sheet.tab at the SAME tab as sheet.settings_tab (' + L.sheet.tab + ').\n' +
      '  This node would then read key/value config rows, find no job_id on any of them, and Remove\n' +
      '  Known would refuse the run. Failing at build time is cheaper than failing at 06:30.'
    );
  }
  if (!Array.isArray(CONTRACT.shared_row_shape) || CONTRACT.shared_row_shape[0] !== 'job_id') {
    throw new Error(
      'Read Known Jobs: the contract\'s shared_row_shape no longer starts with job_id. The jobs tab\n' +
      '  header was written from that list, and Remove Known identifies a real sheet row by the\n' +
      '  presence of job_id. If the column moved or was renamed, both have to move together.'
    );
  }
}());

module.exports = {
  name: 'Read Known Jobs',
  type: 'n8n-nodes-base.googleSheets',
  typeVersion: 4.5,
  position: [3900, 160],
  connectFrom: 'Filter',
  executeOnce: true,
  alwaysOutputData: true,
  onError: 'continueRegularOutput',
  notes: 'Reads the whole jobs tab once per run. alwaysOutputData is what lets the next node tell an empty sheet from a failed read; onError keeps a failed read from killing the run and losing every source report.',
  credentials: googleSheetsCredential(),
  parameters: {
    documentId: { __rl: true, value: L.sheet.spreadsheet_id, mode: 'id' },
    sheetName: { __rl: true, value: L.sheet.tab, mode: 'name' },
    options: {},
  },
};
