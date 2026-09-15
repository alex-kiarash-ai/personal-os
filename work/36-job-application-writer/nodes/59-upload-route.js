'use strict';
/*
 * 59-upload-route.js - "Upload Route". Output 0: the four files of every shipped folder. Output 1:
 * every pair, every lane report and every stage report, carried straight to Upload Results.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. THE CONDITION READS THE FIELD TWO WAYS, AND THAT IS NOT BELT AND BRACES FOR ITS OWN SAKE.
 * ---------------------------------------------------------------------------------------------
 * Two of the four files on the true side came through Text to File, and this seat cannot prove from
 * here what that node does to an item json. The published n8n documentation for Convert to File does
 * not say whether the output keeps the input json or replaces it with an empty object, there is no
 * n8n source on this machine to read, and this seat may not call the box. The staging workflow
 * (v1GbDYganOz9EGpM) never reads `$json` after its own Text to File node, which is evidence about
 * what its author trusted rather than a measurement.
 *
 * Under strict validation a missing `_kind` is an ERROR, not a false. So if the json is replaced and
 * this route read `$json._kind` alone, the two markdown files would not be routed to the upload:
 * they would fail the node, and with an IF node that stops the run.
 *
 * So the expression reads `_kind` off the item when it is there, and off the paired source item when
 * it is not. `$('Attach Folder Ids').item` is the staging workflow's own shape, the same one its
 * Upload node uses for the file name. If the json survives, the fallback never runs. If it does not,
 * the fallback is what routes the markdown files. Both have to fail for this node to fail, and that
 * residual is in the handover as UNPROVEN until seat 8's live drill.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. WHY `_kind` AND NOT `_call_now`.
 * ---------------------------------------------------------------------------------------------
 * Same reason Render Route gives one stage earlier: the true side carries a DIFFERENT KIND of item
 * rather than a subset of the same one. Every pair takes the carry side by definition, so a route on
 * a boolean would be testing "is this not a pair" the long way round and the thing actually being
 * routed would not be named anywhere in the node. Attach Folder Ids stamps `_call_now` as exactly
 * this predicate anyway, and the build assertion below is what stops the two drifting.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. AN EMPTY TRUE SIDE IS ORDINARY. n8n does not run a node with no input, so a morning with
 * nothing to ship skips Upload File and Upload Results still runs on its input 1, which is the sixth
 * time this workflow has needed exactly that.
 */

const W = require('./_write');

const CONDITION_ID = '8e47b012-5cd9-4a63-98f1-2b70e6a4d381';

(function assertAgainstUpstream() {
  const ready = require('./58-files-ready.js');
  if (ready.name !== 'Files Ready') {
    throw new Error('Upload Route: node 58 is named ' + JSON.stringify(ready.name) + ' and this node connects from "Files Ready". Rename both in the same edit.');
  }
  const attach = require('./55-attach-folder-ids.js');
  if (attach.name !== 'Attach Folder Ids') {
    throw new Error('Upload Route: node 55 is named ' + JSON.stringify(attach.name) + ' and the fallback half of this condition resolves through that exact name. A rename here is a rename in an expression string, which nothing else would catch.');
  }
  const code = String(attach.parameters.jsCode || '');
  const stamps = [
    ["_kind: 'file',", 'the kind this route sends down output 0'],
    ['_call_now: true,', 'the true boolean on a file item, which must mean the same thing as this route'],
    ['j._call_now = false;', 'the false boolean on every pair and every carried item'],
    ['_call_now: false,', 'the false boolean on the stage report itself'],
  ];
  for (const [needle, what] of stamps) {
    if (code.indexOf(needle) === -1) {
      throw new Error(
        'Upload Route: Attach Folder Ids no longer contains ' + JSON.stringify(needle) + ', which is ' + what + '.\n' +
        '  If the stamp legitimately moved, update this exact string in the same edit.'
      );
    }
  }
  // The expression names the node. Built from one helper so the shape is identical everywhere it is
  // used, and asserted here so a rename cannot leave a dead node name inside a string literal.
  const expr = W.fallbackExpr('_kind', 'Attach Folder Ids');
  if (expr.indexOf('$("Attach Folder Ids").item.json._kind') === -1) {
    throw new Error('Upload Route: the fallback expression no longer resolves through Attach Folder Ids, and the two markdown files depend on it when Text to File replaces their json.');
  }
}());

module.exports = {
  name: 'Upload Route',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [14820, 100],
  connectFrom: 'Files Ready',
  notes: 'Output 0 (true): the four files of every shipped folder, two PDFs and two markdown. Output 1 (false): every pair, every lane report and every stage report. The condition reads _kind off the item AND off the paired source item, because two of the four files came through Text to File and this seat cannot prove from here whether that node keeps the item json; if it does the fallback never runs, and if it does not the fallback is the staging workflow own proven shape. Strict validation, so a computed left side that ever stops being a string fails loudly rather than routing quietly.',
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          id: CONDITION_ID,
          leftValue: W.fallbackExpr('_kind', 'Attach Folder Ids'),
          rightValue: 'file',
          operator: { type: 'string', operation: 'equals' },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
};
