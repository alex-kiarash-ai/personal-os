'use strict';
/*
 * 56-convert-route.js - "Convert Route". Output 0: the two markdown files, which are strings and
 * have to become files. Output 1: everything else, including the two PDFs, which are already files.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY TWO OF THE FOUR FILES TAKE A DIFFERENT PATH.
 * ---------------------------------------------------------------------------------------------
 * A job folder is four files and they arrive in two shapes. The CV and the cover letter came back
 * from Gotenberg as bytes and have been bytes ever since, so they go straight to the upload. The
 * README and the saved posting are STRINGS on the pair, written by Build Documents, and Google Drive
 * uploads binary. One node turns them into files and only they need it.
 *
 * ---------------------------------------------------------------------------------------------
 * THE CONDITION IS A BOOLEAN THE NODE BEFORE IT STAMPS, WHICH IS THE CONVENTION EVERYWHERE EXCEPT
 * FOLDER ROUTE.
 * ---------------------------------------------------------------------------------------------
 * Attach Folder Ids stamps `needs_convert` on EVERY item it emits, including the pairs, the lane
 * reports and its own stage report, precisely so this route can be strict. Under strict validation
 * an item arriving with no `needs_convert` is an ERROR rather than a false, and that is wanted: an
 * item nobody stamped is an item nobody built, and routing it quietly to the carry side would hide
 * that. The build assertion below is what stops the stamp and the route drifting apart.
 *
 * ---------------------------------------------------------------------------------------------
 * AN EMPTY TRUE SIDE IS ORDINARY.
 * ---------------------------------------------------------------------------------------------
 * A morning with nothing to ship produces no file items at all, so Text to File is skipped and
 * Files Ready still runs on its input 1. Same reason the route and the merge exist at every other
 * stage of this workflow.
 */

const CONDITION_ID = '3a8f5d21-97c4-4e60-b1d8-6c02f4a9e735';

(function assertAgainstUpstream() {
  const attach = require('./55-attach-folder-ids.js');
  if (attach.name !== 'Attach Folder Ids') {
    throw new Error('Convert Route: node 55 is named ' + JSON.stringify(attach.name) + ' and this node connects from "Attach Folder Ids". Rename both in the same edit.');
  }
  const code = String(attach.parameters.jsCode || '');

  // Every stamp checked by its exact text, on BOTH sides. A looser check passes on a file that
  // mentions the field once and never stamps a carried item with it, which is the one failure that
  // would send every pair down the error path under strict validation.
  const stamps = [
    ['j.needs_convert = false;', 'the false boolean on every pair and every carried item'],
    ['needs_convert: !isPdf,', 'the boolean on a file item, true for the two markdown files only'],
    ['needs_convert: false,', 'the false boolean on the stage report itself'],
  ];
  for (const [needle, what] of stamps) {
    if (code.indexOf(needle) === -1) {
      throw new Error(
        'Convert Route: Attach Folder Ids no longer contains ' + JSON.stringify(needle) + ', which is ' + what + '.\n' +
        '  Under strict type validation a missing field here is an ERROR rather than a false, so an item\n' +
        '  without it fails the route instead of taking the carry side, and the run loses its reports.\n' +
        '  If the stamp legitimately moved, update this exact string in the same edit.'
      );
    }
  }
  // The field the node on the true side converts into a file. A markdown item without it would be
  // turned into an empty file, which Drive accepts and returns 200 for, and whose md5 would then
  // fail the read back for a reason nobody could read.
  if (code.indexOf('item.json.text = texts[kind];') === -1) {
    throw new Error('Convert Route: Attach Folder Ids no longer puts `text` on the two markdown file items, which is the entire string the node on the true side turns into a file.');
  }
}());

module.exports = {
  name: 'Convert Route',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [14040, 100],
  connectFrom: 'Attach Folder Ids',
  notes: 'Output 0 (true): the README and the saved posting, which are strings on the item and have to become files before Drive can take them. Output 1 (false): the two PDFs, which are already bytes, plus every pair, every lane report and every stage report. Strict validation, so an item with no needs_convert is a loud contract violation rather than a silent reroute; Attach Folder Ids stamps that boolean on every item it emits for exactly that reason.',
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          id: CONDITION_ID,
          leftValue: '={{ $json.needs_convert }}',
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
};
