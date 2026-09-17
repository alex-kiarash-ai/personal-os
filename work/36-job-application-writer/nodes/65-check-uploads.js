'use strict';
/*
 * 65-check-uploads.js - "Check Uploads". U1, U2 and U3: the gate that decides whether anything at
 * all is written to a spreadsheet.
 *
 * =============================================================================================
 * 1. THE THREE CHECKS, AND WHAT EACH ONE CATCHES THAT THE OTHERS DO NOT.
 * =============================================================================================
 *   U1  every file of every shipped pair was uploaded AND read back. Catches a file that never
 *       uploaded, a file whose upload returned no id, and a file the download could not fetch.
 *   U2  the md5 of the DOWNLOADED bytes equals the md5 computed at build time. Catches a truncated
 *       upload, an encoding change on the way out, a trailing newline added by a conversion, and a
 *       file that uploaded perfectly into the wrong folder and got the wrong bytes back.
 *   U3  four files present per shipped pair, one of each kind. Catches the half application, which
 *       is the failure that reads exactly like a whole one: a folder with a CV and no cover letter,
 *       written into the applications tab with two links, one of which opens nothing.
 *
 * A pair that fails any of the three is `error:drive`. The class is SYSTEMIC, so the sheet action is
 * leave_untouched: THE FOLDER IS LEFT IN PLACE and nothing at all is written to either spreadsheet.
 * The jobs row stays at `new`, so tomorrow morning offers the same job again.
 *
 * WHY THE FOLDER IS LEFT RATHER THAN CLEANED UP. Deleting is a destructive write, and the thing that
 * would be deleted is the one thing that says what actually happened. The cost of leaving it is that
 * tomorrow's retry creates a SECOND folder with the same name, which Drive permits. That is a
 * readable consequence; a folder this run deleted while it was unsure is not.
 *
 * =============================================================================================
 * 2. THE JOIN, AND WHY IT IS NOT LIST POSITION ALL THE WAY DOWN.
 * =============================================================================================
 * Three flat lists have to become one answer per file, and the worst possible outcome of getting it
 * wrong is invisible: a digest checked against the wrong file passes, and a folder goes out with one
 * company's cover letter in another company's folder, verified.
 *
 * So the first hop is position, cross checked three ways. The sent list is taken from Upload Route
 * output 0 when that still carries the file metadata, and DERIVED from Attach Folder Ids when it
 * does not, because until 2026-09-17 two of four files passed through Text to File and this seat could not prove from
 * a development machine whether that node keeps the item json. When both are available they are
 * compared pair by pair and kind by kind. Every upload response is then checked against the name
 * Google echoed back and against its own pairedItem index. A count that does not match, an order
 * that does not, or one name that does not, refuses the whole batch.
 *
 * The digest is the fourth guard and the strongest, because it is content specific: two README files
 * in two folders are two different documents, so a mapping that swapped them would still fail.
 *
 * The second hop is NOT position. Each download is joined to its upload on the Drive FILE ID, which
 * is a real key: Verify Route selected exactly the upload responses that carried one, so the id on
 * response k is the id that was downloaded. A duplicate id refuses the batch, because two files with
 * one id means the map is not a map.
 *
 * =============================================================================================
 * 3. READING THE BYTES, AND THE ONE ORDERING ASSUMPTION IN THIS SEAT.
 * =============================================================================================
 * getBinaryDataBuffer takes an index into THIS node's own input, not into another node's output. So
 * this node has to know where in its input a given download sits, and the answer comes from Merge
 * append order: input 0 first. That is the only place in this seat that leans on stream order, so it
 * is asserted rather than assumed. The first N items, N being how many responses Verify Upload
 * produced, must each carry either bytes or an error, and NO item after them may carry bytes. Either
 * assertion failing refuses the whole batch.
 *
 * The assertion is only possible because Attach Folder Ids strips the two PDFs off the pair. If a
 * pair still carried its own bytes, "this item has bytes" would no longer mean "this is a download",
 * and a digest read off a pair would pass for the wrong reason.
 *
 * =============================================================================================
 * 4. THE DIGEST IS THE SAME FUNCTION FOUR NODES HAVE NOW USED.
 * =============================================================================================
 * Nodes 44, 49 and 55 all bake the MD5 from nodes/_render.js and this one bakes the same bytes.
 * test-stage-4.js proved that implementation against node crypto on sixteen edge case strings and
 * sixty random buffers, which is the only reason to trust a hand written hash against what Google
 * computes. Two implementations would be two chances to disagree with Drive about a file that
 * uploaded perfectly.
 */

const W = require('./_write');

const NODE_NAME = 'Check Uploads';
const WHY_MAX = 460;

(function assertAgainstUpstream() {
  const route = require('./59-upload-route.js');
  const upload = require('./60-upload-file.js');
  const vroute = require('./62-verify-route.js');
  const verify = require('./63-verify-upload.js');
  const merge = require('./64-verify-results.js');
  const named = [
    [route, 'Upload Route', 'this node reads its output 0 for the SENT order when that still carries the metadata'],
    [upload, 'Upload File', 'this node reads its responses for the file ids'],
    [vroute, 'Verify Route', 'this node reads its output 0 to know which upload each download belongs to'],
    [verify, 'Verify Upload', 'this node reads its responses for the downloaded bytes'],
    [merge, 'Verify Results', 'this node connects from it'],
  ];
  for (const [def, want, why] of named) {
    if (def.name !== want) {
      throw new Error(NODE_NAME + ': a node is named ' + JSON.stringify(def.name) + ' where ' + JSON.stringify(want) + ' was expected, and ' + why + '. The name is the lookup key and a rename here is a rename inside a string literal.');
    }
  }
  const attach = require('./55-attach-folder-ids.js');
  if (attach.name !== 'Attach Folder Ids') {
    throw new Error(NODE_NAME + ': node 55 is named ' + JSON.stringify(attach.name) + ' and this node DERIVES the sent file order from it by that name whenever the routed items no longer carry their metadata.');
  }
  // Convert Route and Files Ready were asserted here until 2026-09-17. They split the file stream on
  // needs_convert and rejoined it, which is what made the derived sent ORDER a two-part thing, and
  // both nodes are deleted with the markdown files they existed for. Upload Route now hangs off
  // Attach Folder Ids directly, so the derived order is simply that node's emission order.
  const uploadRoute = require('./59-upload-route.js');
  if (uploadRoute.connectFrom !== 'Attach Folder Ids') {
    throw new Error(
      NODE_NAME + ': Upload Route now connects from ' + JSON.stringify(uploadRoute.connectFrom) + '.\n' +
      '  The sent order this node derives is the order Attach Folder Ids emits file items in, which only\n' +
      '  holds while nothing sits between the two. A node inserted there can reorder the stream, and a\n' +
      '  wrong order here attributes a PDF to the wrong application with every digest still matching.'
    );
  }
  const acode = String(attach.parameters.jsCode || '');
  for (const [needle, what] of [
    ['expected_md5: txt(f.md5),', 'the digest this node compares the downloaded bytes against'],
    ['kind: kind,', 'which file this is, which is what U3 counts'],
    ['pair_id: pairId,', 'the key every file is grouped back onto'],
  ]) {
    if (acode.indexOf(needle) === -1) {
      throw new Error(NODE_NAME + ': Attach Folder Ids no longer puts ' + JSON.stringify(needle) + ' on a file item, which is ' + what + '.');
    }
  }
  if (acode.indexOf('const FILE_KINDS = ') === -1 && String(attach.parameters.jsCode).indexOf('FILE_KINDS') === -1) {
    throw new Error(NODE_NAME + ': Attach Folder Ids no longer knows the four file kinds, and U3 counts against exactly that list.');
  }
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// Check Uploads. U1 every file read back, U2 every digest equal, U3 four files
// per shipped pair. A failure is error:drive, the folder is LEFT IN PLACE, and
// nothing is written to either spreadsheet.
// ---------------------------------------------------------------------------
function txt(v) { return String(v === null || v === undefined ? '' : v); }
function cut(s, n) { const t = txt(s); return t.length > n ? t.slice(0, n - 3) + '...' : t; }
function errText(e) { return cut(typeof e === 'string' ? e : ((e && e.message) || JSON.stringify(e)), 200); }
function pairedIndexOf(item) {
  const pi = item && item.pairedItem;
  if (pi === undefined || pi === null) return null;
  if (Array.isArray(pi)) return pi.length === 1 && pi[0] && pi[0].item !== undefined ? Number(pi[0].item) : null;
  if (typeof pi === 'object' && pi.item !== undefined) return Number(pi.item);
  if (typeof pi === 'number') return pi;
  return null;
}

return (async () => {

const inputItems = $input.all();
if (!inputItems.length) {
  throw new Error('Check Uploads: Verify Results delivered no items at all. Its input 1 carries every lane report and every stage report and is never empty, so an empty input means the merge did not run.');
}

// --- 1. the four views --------------------------------------------------------
function readNode(name, branch) {
  try {
    return branch === undefined ? $(name).all() : $(name).all(branch);
  } catch (e) {
    return null;
  }
}
const sentItems = readNode('Upload Route', 0);
const uploadItems = readNode('Upload File');
const verifySentItems = readNode('Verify Route', 0);
const verifyItems = readNode('Verify Upload');
const attachItems = readNode('Attach Folder Ids');

const uploads = (uploadItems || []).map((i) => i.json || {});
const verifySent = (verifySentItems || []).map((i) => i.json || {});
const verifies = (verifyItems || []).map((i) => i.json || {});

const warnings = [];
let batch = 'ok';
let batchWhy = null;

// ---------------------------------------------------------------------------
// WHAT WAS SENT, AND WHY IT IS NOT SIMPLY READ OFF THE ROUTE.
//
// Until 2026-09-17 two of the four files in every folder passed through Text to File, and this seat
// could not prove from a development machine whether that node kept the item json or replaced it
// with an empty object. If it replaced it, the metadata this check needs, which application a file
// belongs to, which file it is, and what its digest should be, was not on the routed item at all.
//
// Both markdown files are gone and so is that node. Every routed item now comes straight from
// Attach Folder Ids carrying its own metadata, so the derivation below is no longer a fallback for
// a behaviour nobody could measure: it is a SECOND INDEPENDENT COUNT of the same stream, in that
// node's emission order, and it is kept for exactly that reason. The cross check costs nothing and
// it is the only thing that catches a file attributed to the wrong application.
//
// The derivation is never trusted on its own. When the route DOES still carry the metadata, the two
// are compared pair by pair and kind by kind, and a disagreement refuses the whole batch. And in
// both cases every upload response is checked against the name Google echoed back. A wrong mapping
// that survived all of that would still be caught by the digest: two README files in two folders
// are two different documents, so swapping them makes both md5 comparisons fail.
// ---------------------------------------------------------------------------
const attachFiles = (attachItems || []).map((i) => i.json || {}).filter((j) => j && j._kind === 'file');
// Emission order, with no split: needs_convert went with the markdown files on 2026-09-17.
const derived = attachFiles.slice();
const routed = (sentItems || []).map((i) => i.json || {});
const routeCarriesMetadata = routed.length > 0 && routed.every((j) => j && j.pair_id !== undefined && j.kind !== undefined);
let sent = routeCarriesMetadata ? routed : derived;
let sentSource = routeCarriesMetadata
  ? 'Upload Route output 0, which still carries the file metadata, cross checked against the order derived from Attach Folder Ids'
  : 'DERIVED from Attach Folder Ids, because the routed items do not carry the metadata. Since 2026-09-17 nothing sits between the two nodes and every item should carry it, so this fallback firing at all is itself worth reading as a finding.';

if (attachItems === null) {
  batch = 'refused';
  batchWhy = 'Attach Folder Ids could not be reached from this node, so there is no independent record of which file belongs to which application. Nothing is attributed.';
} else if (routeCarriesMetadata && routed.length !== derived.length) {
  batch = 'refused';
  batchWhy = 'the upload route sent ' + routed.length + ' file(s) and Attach Folder Ids built ' + derived.length + '. Two counts of the same thing that disagree means one of them is describing a different run.';
} else if (routeCarriesMetadata) {
  for (let i = 0; i < routed.length; i += 1) {
    const a = routed[i] || {};
    const b = derived[i] || {};
    if (txt(a.pair_id) !== txt(b.pair_id) || txt(a.kind) !== txt(b.kind)) {
      batch = 'refused';
      batchWhy = 'the upload order and the order derived from Attach Folder Ids disagree at position ' + i + ': the route says ' + txt(a.pair_id) + '/' + txt(a.kind) + ' and the derivation says ' + txt(b.pair_id) + '/' + txt(b.kind) + '. Nothing is attributed, because a digest checked against the wrong file PASSES.';
      break;
    }
  }
}

if (batch === 'ok' && !sent.length) {
  batch = 'nothing_sent';
  batchWhy = 'no file was uploaded this run, which is an ordinary quiet morning.';
} else if (batch === 'ok' && (sentItems === null || uploadItems === null)) {
  batch = 'refused';
  batchWhy = 'the sent order or the upload responses could not be read from this node, so there is no way to know which Drive file belongs to which document.';
} else if (batch === 'ok' && uploads.length !== sent.length) {
  batch = 'refused';
  batchWhy = 'Upload Route sent ' + sent.length + ' file(s) and Upload File returned ' + uploads.length + ' item(s). The responses are a flat list with nothing in them saying which document they are, so a count that does not match makes every attribution a guess.';
}

// --- 2. hop one: position, cross checked twice --------------------------------
if (batch === 'ok') {
  let nameChecked = 0;
  let pairedChecked = 0;
  for (let i = 0; i < uploads.length; i += 1) {
    const u = uploads[i] || {};
    if (u.error !== undefined) continue;   // a failed upload has no name to check
    const wanted = txt(sent[i] && sent[i].filename);
    if (typeof u.name === 'string' && u.name.length) {
      nameChecked += 1;
      if (u.name !== wanted) {
        batch = 'refused';
        batchWhy = 'upload response ' + i + ' is a file Google calls ' + JSON.stringify(cut(u.name, 90)) + ' and position ' + i + ' sent ' + JSON.stringify(cut(wanted, 90)) + '. The responses came back in a different order from the requests. Nothing is attributed: a digest checked against the wrong file PASSES, and a folder then goes out with one company documents inside another company folder, verified.';
        break;
      }
    }
    const pi = pairedIndexOf(uploadItems[i]);
    if (pi !== null) {
      pairedChecked += 1;
      if (pi !== i) {
        batch = 'refused';
        batchWhy = 'upload response ' + i + ' says it came from sent item ' + pi + '. The order is not the order, so nothing is attributed.';
        break;
      }
    }
  }
  if (batch === 'ok' && uploads.length && nameChecked === 0 && pairedChecked === 0) {
    batch = 'refused';
    batchWhy = 'not one upload response carries a name or a pairedItem index, so the only thing joining a Drive file to a document would be list position and nothing can confirm it. Refused rather than guessed.';
  }
}

// --- 3. hop two: the Drive file id, which is a key rather than a position -----
const verifyByFileId = {};
if (batch === 'ok') {
  if (verifySentItems === null || verifyItems === null) {
    if (verifySent.length || verifies.length) {
      batch = 'refused';
      batchWhy = 'the verification branch could not be read from this node, so no download can be attributed to the file it came from.';
    }
  } else if (verifies.length !== verifySent.length) {
    batch = 'refused';
    batchWhy = 'Verify Route sent ' + verifySent.length + ' download request(s) and Verify Upload returned ' + verifies.length + ' item(s). A count that does not match makes every digest comparison a guess.';
  } else {
    for (let k = 0; k < verifySent.length; k += 1) {
      const id = txt(verifySent[k] && verifySent[k].id);
      if (!id) {
        batch = 'refused';
        batchWhy = 'download request ' + k + ' carries no Drive file id, and Verify Route selects on exactly that field, so an empty one means the route and this node disagree about what was sent.';
        break;
      }
      if (verifyByFileId[id] !== undefined) {
        batch = 'refused';
        batchWhy = 'two download requests carry the same Drive file id ' + JSON.stringify(id) + '. Two files with one id means the map is not a map, and every digest after it would be checked against whichever one happened to be last.';
        break;
      }
      verifyByFileId[id] = k;
    }
  }
}

// --- 4. where the bytes are, asserted rather than assumed. See note 3 ---------
const downloadIndex = {};   // verify position k -> index in THIS node input
if (batch === 'ok' && verifies.length) {
  const n = verifies.length;
  let shapeOk = inputItems.length >= n;
  let shapeWhy = shapeOk ? null : 'this node has ' + inputItems.length + ' input item(s) and Verify Upload produced ' + n + ', so the downloads cannot all be in front.';
  if (shapeOk) {
    for (let k = 0; k < n; k += 1) {
      const it = inputItems[k] || {};
      const hasBytes = !!(it.binary && it.binary[BINARY_PROPERTY]);
      const isErr = ((it.json || {}).error !== undefined);
      if (!hasBytes && !isErr) {
        shapeOk = false;
        shapeWhy = 'input item ' + k + ' is neither a downloaded file nor a failed download, so the first ' + n + ' items of this node input are not the Verify Upload responses. Merge append order is the only thing that puts them there and it is asserted rather than assumed, because a digest read off the wrong item is a check that passes for the wrong reason.';
        break;
      }
      if (hasBytes) downloadIndex[k] = k;
    }
  }
  if (shapeOk) {
    for (let k = n; k < inputItems.length; k += 1) {
      const it = inputItems[k] || {};
      if (it.binary && it.binary[BINARY_PROPERTY]) {
        shapeOk = false;
        shapeWhy = 'input item ' + k + ' carries bytes and sits AFTER the ' + n + ' download(s). Attach Folder Ids strips the PDFs off every pair precisely so that an item with bytes here is a download and nothing else, so this means something is carrying bytes that should not be.';
        break;
      }
    }
  }
  if (!shapeOk) {
    batch = 'refused';
    batchWhy = shapeWhy;
  }
}

// --- 5. one answer per file ---------------------------------------------------
const fileResults = [];
if (batch === 'ok') {
  for (let i = 0; i < sent.length; i += 1) {
    const s = sent[i] || {};
    const u = uploads[i] || {};
    const r = {
      index: i,
      pair_id: txt(s.pair_id),
      kind: txt(s.kind),
      filename: txt(s.filename),
      expected_md5: txt(s.expected_md5),
      expected_bytes: isFinite(Number(s.expected_bytes)) ? Number(s.expected_bytes) : null,
      file_id: null,
      uploaded: false,
      read_back: false,
      md5_ok: false,
      downloaded_bytes: null,
      downloaded_md5: null,
      why: null,
    };
    if (u.error !== undefined) {
      r.why = 'the upload failed: ' + errText(u.error);
      fileResults.push(r);
      continue;
    }
    const id = txt(u.id);
    if (!id) {
      r.why = 'the upload returned no Drive file id, so there is nothing to read back and nothing to link to.';
      fileResults.push(r);
      continue;
    }
    r.uploaded = true;
    r.file_id = id;
    r.url = FILE_VIEW_PREFIX + id + FILE_VIEW_SUFFIX;

    const k = verifyByFileId[id];
    if (k === undefined) {
      r.why = 'this file uploaded and was never read back: no download was sent for id ' + id + '. U1 refuses a file nobody looked at, because an upload that returned 200 is the request talking about itself.';
      fileResults.push(r);
      continue;
    }
    const v = verifies[k] || {};
    if (v.error !== undefined) {
      r.why = 'the read back failed: ' + errText(v.error);
      fileResults.push(r);
      continue;
    }
    const at = downloadIndex[k];
    if (at === undefined) {
      r.why = 'the read back returned no bytes for this file. Drive answered without an error and without content, which is not a state this node will treat as a verified upload.';
      fileResults.push(r);
      continue;
    }
    let buf = null;
    let bufWhy = null;
    try {
      buf = await this.helpers.getBinaryDataBuffer(at, BINARY_PROPERTY);
    } catch (e) {
      buf = null;
      bufWhy = errText(e);
    }
    if (!buf || !buf.length) {
      r.why = 'the downloaded file is empty' + (bufWhy ? ' (' + bufWhy + ')' : '') + '. An upload with no binary attached creates an EMPTY file in Drive and returns a perfectly healthy 200, which is exactly what this check exists to catch.';
      fileResults.push(r);
      continue;
    }
    r.read_back = true;
    r.downloaded_bytes = buf.length;
    r.downloaded_md5 = md5Bytes(buf);
    if (!r.expected_md5) {
      r.why = 'this file carries no expected digest, so the bytes that came back cannot be compared to anything. A read back with nothing to compare against is not a verification.';
      fileResults.push(r);
      continue;
    }
    if (r.downloaded_md5 !== r.expected_md5) {
      r.why = 'THE DIGEST DOES NOT MATCH. Expected ' + r.expected_md5 + ' and Drive returned ' + r.downloaded_md5 +
        ' (' + r.downloaded_bytes + ' bytes back, ' + (r.expected_bytes === null ? 'no expected size' : r.expected_bytes + ' expected') + '). ' +
        (r.expected_bytes !== null && r.expected_bytes !== r.downloaded_bytes
          ? 'The size changed too, so something was added or lost on the way out rather than the bytes being reordered.'
          : 'The size is the same, so the content changed rather than being truncated.');
      fileResults.push(r);
      continue;
    }
    r.md5_ok = true;
    fileResults.push(r);
  }
}

// --- 6. one verdict per pair ---------------------------------------------------
const byPair = {};
for (const r of fileResults) {
  if (!r.pair_id) continue;
  if (!byPair[r.pair_id]) byPair[r.pair_id] = [];
  byPair[r.pair_id].push(r);
}

const out = [];
const stats = { pairs: 0, shipped_in: 0, verified: 0, failed: 0, skipped: 0, files_checked: fileResults.length, files_verified: 0, dropped: 0, carried: 0 };
const failures = [];
const checkCounts = { U1: 0, U2: 0, U3: 0 };
for (const r of fileResults) if (r.md5_ok) stats.files_verified += 1;

function markDrive(j, why, failedCheck) {
  j._status = 'error:drive';
  j._status_class = 'systemic';
  j._sheet_action = 'leave_untouched';
  j._status_why = cut(why, WHY_MAX);
  stats.failed += 1;
  if (failedCheck) checkCounts[failedCheck] += 1;
  failures.push({ pair_id: txt(j.pair_id), check: failedCheck || null, why: j._status_why });
}

for (const it of inputItems) {
  const raw = (it && it.json) || {};
  if (raw._kind === undefined || raw._kind === null) {
    // A download, a failed upload, or a Drive resource. All consumed here, none carried on.
    stats.dropped += 1;
    continue;
  }
  const j = Object.assign({}, raw);
  j._call_now = false;

  if (j._kind !== 'pair') {
    stats.carried += 1;
    out.push(j);
    continue;
  }
  stats.pairs += 1;
  if (j._status) {
    stats.skipped += 1;
    out.push(j);
    continue;
  }
  stats.shipped_in += 1;

  if (batch === 'refused') {
    markDrive(j, 'THE UPLOAD PAIRING WAS REFUSED for the whole batch: ' + batchWhy, 'U1');
    out.push(j);
    continue;
  }

  const pairId = txt(j.pair_id);
  const files = byPair[pairId] || [];

  // U3 first, because a short folder makes every other answer about it misleading.
  const kinds = files.map((f) => f.kind);
  const missing = FILE_KINDS.filter((k) => kinds.indexOf(k) === -1);
  const extra = kinds.filter((k) => FILE_KINDS.indexOf(k) === -1);
  if (files.length !== FILE_KINDS.length || missing.length || extra.length) {
    markDrive(j,
      'U3: this application has ' + files.length + ' file(s) where one folder is exactly ' + FILE_KINDS.length +
      (missing.length ? ', missing ' + JSON.stringify(missing) : '') + (extra.length ? ', with unexpected ' + JSON.stringify(extra) : '') +
      '. A folder with three of the four files is a half application, and a half application written into the sheet reads exactly like a whole one.', 'U3');
    out.push(j);
    continue;
  }

  // U1: every one of them uploaded and read back.
  const notReadBack = files.filter((f) => !f.read_back);
  if (notReadBack.length) {
    const first = notReadBack[0];
    markDrive(j, 'U1: ' + notReadBack.length + ' of ' + files.length + ' file(s) could not be read back out of Drive. First: ' + first.kind + ' (' + first.filename + ') ' + first.why, 'U1');
    out.push(j);
    continue;
  }

  // U2: every digest equal.
  const badDigest = files.filter((f) => !f.md5_ok);
  if (badDigest.length) {
    const first = badDigest[0];
    markDrive(j, 'U2: ' + badDigest.length + ' of ' + files.length + ' file(s) came back with the wrong bytes. First: ' + first.kind + ' (' + first.filename + ') ' + first.why, 'U2');
    out.push(j);
    continue;
  }

  const byKind = {};
  for (const f of files) byKind[f.kind] = f;
  j._uploads = {
    folder_id: txt(j.folder_id),
    folder_url: txt(j.folder_url),
    all_verified: true,
    files: FILE_KINDS.map((k) => ({
      kind: k,
      filename: byKind[k].filename,
      file_id: byKind[k].file_id,
      url: byKind[k].url,
      md5: byKind[k].downloaded_md5,
      bytes: byKind[k].downloaded_bytes,
    })),
    rule: 'every file was downloaded from Drive in this same run and its md5 compared against the digest computed before it was uploaded. A 200 from the upload is the request talking about itself.',
  };
  j.cv_ref = byKind.cv.url;
  j.cover_letter_ref = byKind.letter.url;
  j.uploads_verified_at = new Date().toISOString();
  stats.verified += 1;
  out.push(j);
}

// --- 7. the accounting ---------------------------------------------------------
if (batch === 'refused') {
  warnings.push('THE UPLOAD BATCH WAS REFUSED and no file was attributed to any application: ' + batchWhy + ' Every folder created this run is LEFT IN PLACE and nothing is written to either spreadsheet, so every affected job row stays at new.');
}
if (stats.failed > 0) {
  warnings.push(stats.failed + ' pair(s) failed U1, U2 or U3 and are error:drive. Their folders are LEFT IN PLACE rather than deleted, because deleting what says what happened is a destructive write this run is not certain enough to make. Their sheet rows stay at new, so tomorrow offers the same job again and creates a SECOND folder with the same name, which Drive permits.');
}
if (stats.verified > 0) {
  warnings.push(stats.verified + ' application(s) have four files in Drive whose bytes were downloaded again in this run and whose digests match what was built. That is what makes the applications rows about to be written true rather than optimistic.');
}
if (batch === 'ok' && sent.length && stats.files_verified !== stats.files_checked) {
  warnings.push((stats.files_checked - stats.files_verified) + ' of ' + stats.files_checked + ' uploaded file(s) did not verify. Where all four of a folder failed the cause is usually the folder or the credential; where one did, look at that file.');
}

const report = {
  _kind: 'stage_report',
  stage: 'check_uploads',
  counts: stats,
  batch: { state: batch, why: batchWhy, sent: sent.length, uploaded: uploads.length, downloaded: verifies.length, sent_source: sentSource, route_carried_metadata: routeCarriesMetadata },
  failures_by_check: checkCounts,
  failures: failures.slice(0, 12),
  checks_run: 'U1 every file of every shipped pair uploaded AND downloaded again; U2 the md5 of the downloaded bytes equals the digest computed before the upload; U3 exactly four files per shipped pair, one of each kind.',
  classes: 'a failure of any of the three is error:drive, which is SYSTEMIC: the folder is left in place, nothing is written to either spreadsheet, and the jobs row stays at new so tomorrow offers the same job again.',
  join: 'upload responses are paired to the sent order by position, cross checked against the name Google echoed back AND against pairedItem. Downloads are joined to uploads on the Drive FILE ID, which is a key rather than a position.',
  warnings: warnings,
  needs_convert: false,
  _call_now: false,
  site_fetch_url: '',
  ad_fetch_url: '',
};

const finalItems = out.map((j) => ({ json: j, pairedItem: { item: 0 } }));
finalItems.push({ json: report, pairedItem: { item: 0 } });
return finalItems;

})();
`;

function renderJsCode() {
  return [
    '// GENERATED at build time from work/36-job-application-writer/nodes/65-check-uploads.js.',
    '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
    W.MD5_RUNTIME,
    'const FILE_KINDS = ' + JSON.stringify(W.FILE_KINDS) + ';',
    'const BINARY_PROPERTY = ' + JSON.stringify(W.UPLOAD_BINARY_PROPERTY) + ';',
    'const FILE_VIEW_PREFIX = ' + JSON.stringify(W.DRIVE_FILE_VIEW_PREFIX) + ';',
    'const FILE_VIEW_SUFFIX = ' + JSON.stringify(W.DRIVE_FILE_VIEW_SUFFIX) + ';',
    'const WHY_MAX = ' + JSON.stringify(WHY_MAX) + ';',
    LOGIC,
  ].join('\n');
}

W.assertGeneratedSourceIsClean(renderJsCode(), NODE_NAME);

module.exports = {
  name: NODE_NAME,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [16380, 100],
  connectFrom: 'Verify Results',
  notes: 'U1 every file of every shipped pair uploaded and read back, U2 every downloaded digest equal to the one computed before the upload, U3 four files per folder. A failure of any of the three is error:drive, which leaves the FOLDER IN PLACE and writes nothing at all to either spreadsheet, so the jobs row stays at new and tomorrow offers the job again. Upload responses are paired to the sent order by position and cross checked twice; downloads are joined to uploads on the Drive file id, which is a key rather than a position, because a digest checked against the wrong file passes and a folder then goes out with one company documents in another company folder, verified. Returns a promise rather than awaiting at the top level, so build.js assertCodeParses keeps covering it.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: renderJsCode(),
  },
};
