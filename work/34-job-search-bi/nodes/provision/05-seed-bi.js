'use strict';
/*
 * 05-seed-bi.js - writes the settings rows and all three header rows into the BI spreadsheet.
 *
 * WHY THIS IS AN HTTP REQUEST AND NOT A GOOGLE SHEETS APPEND NODE. This is the one place I stepped
 * away from the brief's "Google Sheets nodes", so the reason is written down rather than assumed.
 *
 * 1. The Sheets node's append, in Map Automatically mode, derives the header row from the keys of
 *    the FIRST input item when row 1 is empty, and then writes that item as a data row as well.
 *    Three of the four tabs need a header and no data. Append would leave a phantom blank record in
 *    jobs, runs and applications, and every later read would carry it.
 * 2. This is one call for one spreadsheet. Four append nodes would be four chances to leave a half
 *    seeded sheet that looks finished, which is the failure nobody catches because the tabs are all
 *    there.
 * 3. It is the same credential. predefinedCredentialType borrows googleSheetsOAuth2Api by id,
 *    UhK77WK48hRv85bo, exactly as the Sheets nodes do. No new credential, no new scope: n8n's Google
 *    Sheets OAuth2 credential already carries the spreadsheets scope that values:batchUpdate needs.
 *
 * The spreadsheet id is read through an explicit named-node reference rather than $json, so an extra
 * node inserted upstream later cannot silently change which id gets written to. If the reference
 * ever returns undefined the URL becomes .../undefined/values:batchUpdate and Google answers 404,
 * which is a loud failure on a one-shot run and is the right one.
 *
 * typeVersion 4.2 confirmed against the live box: 31 HTTP Request nodes there, all v4.2.
 */

const { GOOGLE_SHEETS_CREDENTIAL } = require('./_seed');

module.exports = {
  name: 'Seed BI Tabs',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [680, 100],
  connectFrom: 'Create BI Spreadsheet',
  credentials: GOOGLE_SHEETS_CREDENTIAL,
  parameters: {
    method: 'POST',
    url: "=https://sheets.googleapis.com/v4/spreadsheets/{{ $('Create BI Spreadsheet').first().json.spreadsheetId }}/values:batchUpdate",
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleSheetsOAuth2Api',
    sendBody: true,
    contentType: 'json',
    specifyBody: 'json',
    jsonBody: "={{ JSON.stringify($('Build Seed Payload').first().json.bi.batchBody) }}",
    options: {},
  },
};
