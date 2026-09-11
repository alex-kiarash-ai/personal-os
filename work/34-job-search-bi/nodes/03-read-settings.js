'use strict';
/*
 * 03-read-settings.js - read the lane's settings tab.
 *
 * The settings tab is the RUN TIME source of truth. seed.json was only the source at PROVISION
 * time, and the provisioner has been deleted. Shaheen edits cells in this tab from his phone and
 * the next run picks them up, which is the whole design, and it is also why 04-parse-settings.js
 * validates everything this node hands it.
 *
 * Shape, taken from the live box rather than from memory (read-only GET over all 19 workflows,
 * 2026-09-11): googleSheets typeVersion 4.5, resource and operation both left at their defaults
 * (sheet / read, which is how all 23 googleSheets nodes on this box are stored), documentId as a
 * resource locator in `id` mode, sheetName as a resource locator in `name` mode, options empty.
 * The header row is `key,value`, so each output item arrives as { key, value } and the header
 * itself is not emitted.
 *
 * executeOnce: true. This node has two upstream triggers, and either way it receives exactly one
 * item today, so the flag changes nothing about the current graph. It is set because it is the
 * cheap insurance against the thing that bites later: the moment anything upstream emits more than
 * one item, a Google Sheets node runs once PER input item, and the settings tab would be read and
 * billed N times to produce N identical copies of one config. build.js forwards node level fields
 * through an allowlist, so this actually lands on the box rather than being silently dropped.
 *
 * The spreadsheet id and the credential id are READ from config/lane.json, never typed here. This
 * folder is tracked and the repo is PUBLIC; config/ is gitignored. See nodes/_lane.js.
 */

const { lane, googleSheetsCredential } = require('./_lane');
const L = lane();

module.exports = {
  name: 'Read Settings',
  type: 'n8n-nodes-base.googleSheets',
  typeVersion: 4.5,
  position: [260, 100],
  connectFrom: ['When clicking Test', 'Schedule Trigger'],
  executeOnce: true,
  notes: 'Reads the settings tab, key/value. Hand editable by design, which is why the next node validates every cell.',
  credentials: googleSheetsCredential(),
  parameters: {
    documentId: { __rl: true, value: L.sheet.spreadsheet_id, mode: 'id' },
    sheetName: { __rl: true, value: L.sheet.settings_tab, mode: 'name' },
    options: {},
  },
};
