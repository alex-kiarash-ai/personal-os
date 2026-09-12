'use strict';
/*
 * 03-read-bi.js - reads the BI settings tab BEFORE anything is written.
 *
 * This read is not a formality. Three separate things depend on it and none of them can be done
 * without it:
 *   1. The ROW ADDRESS of every key. The sync writes cell by cell (settings!B12), never the whole
 *      tab, and it can only do that because it knows which row each key sits on. A whole-tab write
 *      is what would clobber last_run_at and any hand-added row.
 *   2. The BEFORE value of every key, which is what makes the run report able to say old -> new
 *      instead of just "written".
 *   3. The preserved set. Every key on this sheet that is NOT in the target allowlist is expected to
 *      come back UNCHANGED in the read-back, and that expectation is built from this read.
 *
 * batchGet with a single range rather than the simpler values/{range} form, because batchGet is the
 * shape this lane has already proven against this API (provisioner execution 5147, both sheets read
 * back cell by cell). A:B and not A1:B40, so the range cannot be shorter than the tab.
 *
 * The spreadsheet id and the tab name are read through a named-node reference rather than typed
 * here: this file is tracked and the repo is public, and an id in a node file is an id on GitHub.
 * If the reference ever returns undefined the URL becomes .../undefined/values:batchGet and Google
 * answers 404, which is a loud failure rather than a read of the wrong document.
 *
 * typeVersion 4.2, the value every httpRequest node on this box carries.
 */

const { GOOGLE_SHEETS_CREDENTIAL } = require('./_sync');

module.exports = {
  name: 'Read BI Settings',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [440, 100],
  connectFrom: 'Build Target Settings',
  credentials: GOOGLE_SHEETS_CREDENTIAL,
  parameters: {
    method: 'GET',
    url: "=https://sheets.googleapis.com/v4/spreadsheets/{{ $('Build Target Settings').first().json.lanes.bi.spreadsheet_id }}/values:batchGet?ranges={{ encodeURIComponent($('Build Target Settings').first().json.lanes.bi.tab + '!A:B') }}&majorDimension=ROWS",
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleSheetsOAuth2Api',
    options: {},
  },
};
