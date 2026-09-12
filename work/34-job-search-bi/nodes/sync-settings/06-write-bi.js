'use strict';
/*
 * 06-write-bi.js - applies the BI plan, one API call, cell by cell.
 *
 * WHY HTTP AND NOT A GOOGLE SHEETS NODE. The Sheets node's update operations are row oriented: they
 * match a row by a lookup column and rewrite the whole row, or they append. Neither can say "set
 * exactly cell B12 and cell B17 and touch nothing else", which is the entire requirement here.
 * values:batchUpdate takes a list of individual ranges, which is precisely the shape of the plan.
 *
 * It is also ONE call for the whole lane, so the BI settings tab either takes every cell or takes
 * none. Twenty six separate update nodes would be twenty six chances to leave the tab half synced,
 * which is the state nobody can detect by looking at it.
 *
 * valueInputOption RAW, carried in the body the plan node built. Not USER_ENTERED: that would parse
 * a leading '=' as a formula and coerce types per cell, and this tab has to read back as the text it
 * was written as. The provisioner wrote these cells RAW and Stage A's decoder was proved against
 * that, so anything else would change the contract without saying so.
 *
 * Same credential as everything else in this lane, borrowed by id through predefinedCredentialType.
 * No new credential, no new scope: the Google Sheets OAuth2 credential already carries the
 * spreadsheets scope values:batchUpdate needs, which is proven, not assumed, by the provisioner
 * having used this exact call successfully (execution 5147).
 *
 * NO onError HERE. A failed write must fail the run. The report node is the only thing that decides
 * this sync succeeded, and it must never be reached on a broken write, because its job is to assert
 * a read-back and a read-back of a failed write is a comparison against nothing.
 */

const { GOOGLE_SHEETS_CREDENTIAL } = require('./_sync');

module.exports = {
  name: 'Write BI Settings',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [1100, 100],
  connectFrom: 'Plan Changes',
  credentials: GOOGLE_SHEETS_CREDENTIAL,
  parameters: {
    method: 'POST',
    url: "=https://sheets.googleapis.com/v4/spreadsheets/{{ $('Build Target Settings').first().json.lanes.bi.spreadsheet_id }}/values:batchUpdate",
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleSheetsOAuth2Api',
    sendBody: true,
    contentType: 'json',
    specifyBody: 'json',
    jsonBody: "={{ JSON.stringify($('Plan Changes').first().json.bi.body) }}",
    options: {},
  },
};
