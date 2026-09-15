'use strict';
/*
 * 60-upload-file.js - "Upload File". One Drive upload per file. Four calls per shipped folder.
 *
 * =============================================================================================
 * 1. THE SHAPE IS THE STAGING WORKFLOW'S, LIFTED RATHER THAN REINVENTED.
 * =============================================================================================
 * The only worked Drive write on this box outside the retired engines is v1GbDYganOz9EGpM, and its
 * Upload node is four parameters: a name expression read from the node that held the context, a
 * driveId of My Drive, a folderId read the same way, and no binary property at all, which takes the
 * default `data`. Every one of those choices is copied here, and the one that looks like an omission
 * is the most deliberate: NOT setting the binary property name means there is no parameter name to
 * misspell, and n8n drops an unknown parameter on save without a word. Attach Folder Ids is what
 * makes that possible, by copying both PDF descriptors onto `data` so all four files arrive in one
 * shape.
 *
 * =============================================================================================
 * 2. BOTH READ EXPRESSIONS FALL BACK, FOR THE REASON UPLOAD ROUTE STATES.
 * =============================================================================================
 * Two of the four files came through Text to File and this seat cannot prove from here whether that
 * node keeps the item json. So `name` and `folderId` read the field off the item first and off the
 * paired source item second. If the json survives, the fallback never runs. If it does not, the
 * fallback is exactly what the staging workflow does, and it is the only thing that would work.
 *
 * A FOLDER ID THAT RESOLVES TO NOTHING IS THE FAILURE THIS GUARDS AGAINST, and it is not a loud one:
 * an upload with no folder id does not error, it puts the file in the ROOT of My Drive and returns
 * 200. Attach Folder Ids already refuses a pair whose folder id came back empty for exactly that
 * reason; this is the second half of the same guard, one node later, on the parameter itself.
 *
 * =============================================================================================
 * 3. NO RETRY, AND UNLIKE THE FOLDER THE REASON IS NOT IDEMPOTENCY ALONE.
 * =============================================================================================
 * Drive permits two files with the same name in the same folder, so a retry after a timeout that
 * actually succeeded leaves a folder with five files, two of them called the same thing, and Check
 * Uploads would see five where it asserts four and refuse the pair. That refusal is correct and it
 * is also a whole application lost to a transient socket error.
 *
 * The recovery without a retry is better: the failed upload arrives as data, Check Uploads marks
 * that pair error:drive, the folder is LEFT IN PLACE and nothing is written to either sheet, so the
 * jobs row stays at `new` and tomorrow morning offers the same job again. One morning, not one
 * ambiguous folder.
 *
 * =============================================================================================
 * 4. onError: continueRegularOutput, SO ONE REFUSED UPLOAD COSTS ONE PAIR AND NOT THE RUN.
 * =============================================================================================
 * By the time a file reaches this node its pair has been paid for through a read on the largest
 * model in the chain, a research call, a selection, a letter, possibly a rewrite, a blind grade and
 * two renders. Every other pair in the run has been paid for too, and so has the run row that makes
 * tomorrow's daily cap true. A quota error on one file must not take all of that with it.
 */

const W = require('./_write');

(function assertAgainstUpstream() {
  const route = require('./59-upload-route.js');
  if (route.name !== 'Upload Route') {
    throw new Error('Upload File: node 59 is named ' + JSON.stringify(route.name) + ' and this node hangs off "Upload Route" output 0. Rename both in the same edit.');
  }
  const attach = require('./55-attach-folder-ids.js');
  if (attach.name !== 'Attach Folder Ids') {
    throw new Error('Upload File: node 55 is named ' + JSON.stringify(attach.name) + ' and both parameters below resolve through that exact name inside an expression string, which nothing else would catch on a rename.');
  }
  const code = String(attach.parameters.jsCode || '');
  for (const [needle, what] of [
    ['folder_id: folderId,', 'the folder every file of one application goes into'],
    ['filename: txt(f.name),', 'the name Drive stores'],
    ['item.binary[UPLOAD_PROPERTY] = bin[txt(f.binary_property)];', 'the line that puts the PDF bytes on the default property this node uploads from'],
  ]) {
    if (code.indexOf(needle) === -1) {
      throw new Error(
        'Upload File: Attach Folder Ids no longer contains ' + JSON.stringify(needle) + ', which is ' + what + '.\n' +
        '  This node sets no binary property name on purpose, so that it takes the n8n default and there is\n' +
        '  no parameter name to misspell. That only works while all four files arrive on that one property.'
      );
    }
  }
  // The property the default resolves to. Stated here so a change to it fails the build of the node
  // that depends on the default rather than producing an empty file with a healthy 200.
  if (W.UPLOAD_BINARY_PROPERTY !== 'data') {
    throw new Error(
      'Upload File: nodes/_write.js now says the upload property is ' + JSON.stringify(W.UPLOAD_BINARY_PROPERTY) + '.\n' +
      '  This node deliberately sets no property name and takes the n8n default, which is `data`. If the\n' +
      '  files really do arrive on another property, that name has to be set here, and the parameter name\n' +
      '  that sets it is the one thing this seat could not verify from a development machine.'
    );
  }
  const convert = require('./57-text-to-file.js');
  if (convert.parameters.options.encoding !== 'utf8') {
    throw new Error('Upload File: Text to File no longer writes utf8, and the md5 the read back compares against was computed over UTF-8 bytes.');
  }
}());

module.exports = {
  name: 'Upload File',
  type: 'n8n-nodes-base.googleDrive',
  typeVersion: 3,
  position: [15080, 0],
  connectFrom: { node: 'Upload Route', outputIndex: 0 },
  // One refused upload costs one pair, never the run. See note 4.
  onError: 'continueRegularOutput',
  notes: 'One upload per file, four per shipped folder, in the staging workflow proven shape: the name and the folder read from the node that held the context, and NO binary property name at all so the n8n default is used and there is no parameter name to misspell. Never retried: Drive permits two files with the same name in one folder, so a retry after a timeout that actually succeeded leaves five files where Check Uploads asserts four. A refused upload arrives as data and costs exactly one pair, whose folder is left in place and whose sheet row stays at new so tomorrow offers the job again.',
  credentials: W.googleDriveCredential(),
  parameters: {
    name: W.fallbackExpr('filename', 'Attach Folder Ids'),
    driveId: { __rl: true, value: 'My Drive', mode: 'list', cachedResultName: 'My Drive' },
    folderId: { __rl: true, value: W.fallbackExpr('folder_id', 'Attach Folder Ids'), mode: 'id' },
    options: {},
  },
};
