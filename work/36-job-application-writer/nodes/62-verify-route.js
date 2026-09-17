'use strict';
/*
 * 62-verify-route.js - "Verify Route". Output 0: the files Drive says it stored, which are the only
 * things there is anything to verify about. Output 1: everything else.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. THE CONDITION IS THE DRIVE FILE ID, AND THAT IS A STATED DEVIATION FROM THE PLAN ROW.
 * ---------------------------------------------------------------------------------------------
 * The reconstructed plan row for this node reads `_kind === 'file' && file_id`. Neither field is on
 * the item and neither can be: Upload File REPLACES the item it is given with the Drive resource, so
 * what arrives here is `{ id, name, mimeType, ... }` with no `_kind`, no pair, no expected digest,
 * and no field called `file_id` anywhere in the workflow. The row was reconstructed, not approved
 * text, and it assumed a node that preserves its input. The staging workflow carries a whole node
 * called Prep for File because that assumption is false.
 *
 * So the predicate is the honest version of the same intent: an item carrying a Drive file id is a
 * file that was uploaded, and nothing else in this stream can carry one. Pairs carry `job_id` and
 * `pair_id`; lane reports and stage reports carry neither; a failed upload arrives with an `error`
 * field and no id at all, and takes the carry side, which is right because there is nothing stored
 * to read back.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. THE EXPRESSION IS TOTAL, WHICH IS WHAT MAKES STRICT VALIDATION SAFE HERE.
 * ---------------------------------------------------------------------------------------------
 * Strict validation turns a missing field into an ERROR rather than a false. A bare `$json.id`
 * tested for notEmpty would therefore fail the node on every pair and every report in the stream.
 * The conditional below returns a string for any item at all, including one with no keys, so the
 * strictness costs nothing and still buys something real: if the expression is ever edited into
 * something that can return a number or a null, the node fails loudly instead of routing quietly.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. THE REAL CHECK IS NOT HERE. It is in Check Uploads, which pairs every response back to the file
 * it was asked for, by the order Upload Route sent them, cross checked against the name Google
 * echoed back, and joins the verification to the upload on the Drive file id, which is a key rather
 * than a position. This route only decides what is worth a GET.
 */

const CONDITION_ID = 'c92f4a6b-1e38-4d75-8a04-3f6b2c95e017';

(function assertAgainstUpstream() {
  const results = require('./61-upload-results.js');
  const upload = require('./60-upload-file.js');
  if (results.name !== 'Upload Results') {
    throw new Error('Verify Route: node 61 is named ' + JSON.stringify(results.name) + ' and this node connects from "Upload Results". Rename both in the same edit.');
  }
  if (upload.type !== 'n8n-nodes-base.googleDrive') {
    throw new Error('Verify Route: node 60 is no longer the Google Drive node, and this route reads the `id` that node returns. If the upload moved to raw REST, the id may sit somewhere else in the response and this condition has to move with it.');
  }
  if (upload.onError !== 'continueRegularOutput') {
    throw new Error('Verify Route: Upload File no longer continues on error, so a failed upload would stop the run rather than arriving here with an error field and no id, which is what makes this route able to tell the two apart.');
  }
}());

module.exports = {
  name: 'Verify Route',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [15600, 100],
  connectFrom: 'Upload Results',
  notes: 'Output 0 (true): every item carrying a Drive file id, which is every file Drive says it stored. Output 1 (false): every pair, every report, and every upload that failed and arrived with an error field instead of an id. The plan row for this node named _kind and file_id; neither exists on the item because the Drive node replaces what it is given, so the predicate is the honest version of the same intent and the deviation is written down in the file. The expression is total, so strict validation never errors on a pair.',
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          id: CONDITION_ID,
          leftValue: '={{ $json.id === undefined || $json.id === null ? "" : String($json.id) }}',
          rightValue: '',
          operator: { type: 'string', operation: 'notEmpty', singleValue: true },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
};
