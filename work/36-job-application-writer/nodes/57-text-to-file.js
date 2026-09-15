'use strict';
/*
 * 57-text-to-file.js - "Text to File". Turns the README and the saved posting into files Drive can
 * take, on the default `data` property, under the names the folder is meant to hold.
 *
 * =============================================================================================
 * 1. utf8 IS THE WHOLE POINT OF THIS NODE, NOT AN OPTION ON IT.
 * =============================================================================================
 * Build Documents computed the md5 of these two strings over their exact UTF-8 bytes, and Check
 * Uploads compares that digest against the bytes Google Drive hands back. So the encoding is the
 * contract, not a preference. It is stated rather than left to a default for the same reason node
 * 46 states it: a default that moved would not error, it would produce a file whose digest no longer
 * matches, and the failure would surface three nodes later as a Drive read back mismatch on a file
 * that uploaded perfectly.
 *
 * Both documents carry Swedish company names, Swedish cities and his own surname, so this is not a
 * theoretical class of bug on this data.
 *
 * =============================================================================================
 * 2. THE FILE NAME IS READ OFF THE ITEM, AND IT IS THE NAME DRIVE STORES.
 * =============================================================================================
 * `filename` was put on the item by Attach Folder Ids, which read it out of the manifest Check
 * Renders built, which read the two markdown names out of nodes/_render.js. Four nodes, one string,
 * no second copy. This node does not know what a README is called and must not learn.
 *
 * The 2026-08-20 filename law does not reach these two: it governs the CV and the cover letter, the
 * files that travel to a recruiter. README.md and job-ad.md never leave his Drive.
 *
 * =============================================================================================
 * 3. THE OUTPUT PROPERTY IS `data`, THE n8n DEFAULT, AND THAT IS WHY THE PDFs WERE MOVED ONTO IT.
 * =============================================================================================
 * Attach Folder Ids copied each PDF descriptor onto `data` so all four files arrive at the upload in
 * one shape and the upload node can take its default. The staging workflow does exactly this and its
 * Upload node sets no property name at all. One shape, one default, nothing to misspell.
 *
 * =============================================================================================
 * 4. THE HONEST NOTE: THIS SEAT CANNOT PROVE WHAT THIS NODE DOES TO THE ITEM json.
 * =============================================================================================
 * The published n8n documentation for Convert to File does not say whether the output item keeps the
 * input json or replaces it with an empty object, there is no n8n source on this machine to read,
 * and this seat may not call the box. The staging workflow sidesteps the question entirely: after
 * its Text to File node, every later parameter reads `$('Prep for File').item.json...` rather than
 * `$json...`. That is evidence about what its author trusted, not a measurement.
 *
 * So every expression after this node reads the field BOTH ways, its own json first and the paired
 * source item second. If the json survives, the fallback never runs. If it does not, the fallback is
 * the staging workflow's own proven shape. It is in the handover as UNPROVEN rather than assumed
 * away, and seat 8's live drill settles it in one execution by looking at this node's output.
 *
 * The same note applies to `mimeType`: node 46 already records that the documented option list for
 * this operation names only File Name and Encoding, so this seat cannot prove the mime key is read
 * rather than dropped. If it is dropped the file is labelled text/plain. Drive stores the bytes
 * either way and the md5 read back is over the bytes, so nothing this seat checks depends on it.
 */

const RN = require('./_render');

const MIME = 'text/markdown';
const ENCODING = 'utf8';

(function assertAgainstUpstream() {
  const route = require('./56-convert-route.js');
  if (route.name !== 'Convert Route') {
    throw new Error('Text to File: node 56 is named ' + JSON.stringify(route.name) + ' and this node hangs off "Convert Route" output 0. Rename both in the same edit.');
  }
  const attach = require('./55-attach-folder-ids.js');
  const code = String(attach.parameters.jsCode || '');
  if (code.indexOf('filename: txt(f.name),') === -1) {
    throw new Error('Text to File: Attach Folder Ids no longer puts `filename` on a file item, which is the name this node gives the file and the name Drive stores.');
  }
  // The two names themselves live in nodes/_render.js and nowhere else. Read here only to prove the
  // chain still ends where it started.
  for (const n of [RN.README_FILENAME, RN.JOB_AD_FILENAME]) {
    if (typeof n !== 'string' || !/^[A-Za-z0-9._-]+$/.test(n)) {
      throw new Error('Text to File: nodes/_render.js declares a markdown file name of ' + JSON.stringify(n) + ', which is not a plain file name. It becomes a Drive file name and a range in nothing, so the only rule is that it is readable.');
    }
  }
}());

module.exports = {
  name: 'Text to File',
  type: 'n8n-nodes-base.convertToFile',
  typeVersion: 1.1,
  position: [14300, 0],
  connectFrom: { node: 'Convert Route', outputIndex: 0 },
  notes: 'Writes the README and the saved posting into files on the default data property, under the names the manifest carries. utf8 is stated rather than defaulted because the md5 Check Uploads compares against Drive was computed over exactly those bytes, and an encoding that moved under a default would not error: it would produce a file whose digest no longer matches on a document that uploaded perfectly.',
  parameters: {
    operation: 'toText',
    sourceProperty: 'text',
    options: {
      fileName: '={{ $json.filename }}',
      mimeType: MIME,
      encoding: ENCODING,
    },
  },
};
