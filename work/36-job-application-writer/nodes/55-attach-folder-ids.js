'use strict';
/*
 * 55-attach-folder-ids.js - "Attach Folder Ids". The staging workflow's Prep for File bridge, in an
 * N item version, and the node that turns one pair into the four files of one folder.
 *
 * =============================================================================================
 * 1. WHAT IT IS A COPY OF, AND WHY IT IS A COPY RATHER THAN AN INVENTION.
 * =============================================================================================
 * The only worked Drive write on this box outside the retired engines is the Building Alex staging
 * workflow, v1GbDYganOz9EGpM. Its Create Folder step replaces the item, so it carries a node called
 * Prep for File whose whole body is five lines:
 *
 *     const b = $('Build post.txt').first().json;
 *     const folder = $('Create Folder').first().json;
 *     const folderId = folder.id;
 *     if (!folderId) { throw new Error('Create Folder returned no folder id.'); }
 *     return [{ json: { ...b, folder_id: folderId, folder_link: '...' + folderId } }];
 *
 * Two things in there are the whole lesson. The context is read from the node that HELD it, by name,
 * rather than from the stream, because the stream no longer has it. And a missing id THROWS rather
 * than travelling on as undefined, because a Drive upload into folder `undefined` succeeds: it lands
 * in the root of My Drive and returns 200.
 *
 * This node does the same two things for N pairs at once. It does NOT throw, and that difference is
 * deliberate: the staging workflow stages one episode and a throw costs one episode, while this one
 * carries every pair, every lane report and every stage report of a whole morning, and a throw here
 * would lose the run row that makes tomorrow's daily cap true. So the refusal is per pair.
 *
 * =============================================================================================
 * 2. THE PAIRING, AND THE WORST THING THIS SEAT COULD DO.
 * =============================================================================================
 * The responses coming back from Create Folder are a flat list and nothing in them says which
 * application they belong to. Attaching the wrong folder id to a pair does not produce an error: it
 * produces a cover letter for one company sitting in a folder named after another, uploaded
 * successfully, verified successfully by md5, and written into the applications tab with a link
 * that opens the wrong document. Every check after this point would pass.
 *
 * So the order is READ from Folder Route output 0, exactly the way Measure PDF reads Render Route,
 * and it is cross checked before one id is attributed:
 *
 *   what Folder Route sent   equals   what Create Folder returned      (count)
 *   every response `name`    equals   the folder_name it was asked for (Google echoes it back)
 *   every response pairedItem index   equals   its position in the list
 *
 * The name check is the strong one, because it is Google telling us what it actually stored. The
 * pairedItem check is the belt. At least ONE of the two has to be available or the whole batch is
 * refused: a pairing nothing can confirm is not a pairing, and this is the one place in the workflow
 * where being wrong is invisible.
 *
 * =============================================================================================
 * 3. THE FOUR FILES, AND WHY THE PDF BYTES MOVE TO `data`.
 * =============================================================================================
 * Check Renders attaches the two PDFs under `cv_pdf` and `letter_pdf`, with their shipping names and
 * their mime type already set. This node copies each descriptor, UNCHANGED, onto its own file item
 * under the property `data`. Nothing about the file changes: not the name, not the mime type, not
 * one byte. What changes is which key it sits under on a new item.
 *
 * WHY. The Google Drive upload node takes its bytes from one binary property, and the staging
 * workflow's proven Upload node does not set that parameter at all: it takes the default, `data`,
 * which is also what Text to File produces. Setting a per item property name instead would mean
 * relying on a parameter name this seat cannot verify from here, and n8n drops an unknown parameter
 * on save without a word. Copying the descriptor is the move Check Renders itself already makes in
 * the other direction (it copies `data` to `cv_pdf`), so the mechanism is proven inside this very
 * workflow. Each item records which property it came from, so the trail is readable.
 *
 * The two markdown files travel as STRINGS with `needs_convert` true, and Text to File turns them
 * into the same `data` property two nodes later. Their digests were computed by Build Documents over
 * the exact UTF-8 bytes of those strings, so the strings are passed through untouched: a trailing
 * newline added on the way out changes the digest and the read back then fails on a file that
 * uploaded perfectly.
 *
 * =============================================================================================
 * 4. THE PAIR LOSES ITS BYTES HERE, ON PURPOSE.
 * =============================================================================================
 * The two PDFs now live on the file items. Carrying a second copy on the pair through nineteen more
 * nodes buys nothing and makes every item in the run twice the size. Check Renders makes the same
 * call in the other direction, and says so: a held pair gets its measurements and no bytes.
 *
 * =============================================================================================
 * 5. WHAT ARRIVES HERE, ON EACH OF THREE MERGE INPUTS, AND WHAT IS DROPPED.
 * =============================================================================================
 * Folder Results has THREE inputs and the reason is written out in that file. The short version:
 * Create Folder replaces the item it is given, so the shipped pairs do not come out of it. They are
 * wired into the merge a second time, straight off Folder Route output 0, so they arrive here
 * carrying their two PDFs. The first version of this node did not have them and lost every shipped
 * application in the run while creating the folders perfectly; test-stage-5.js caught it on its
 * first run.
 *
 * So the stream holds three shapes and each is recognised by what it IS rather than by position:
 *   a pair with no `_status`      a shipped application, with its bytes. Given a folder id here.
 *   any other item with a `_kind` a held or blocked pair, a lane report, a stage report. Carried.
 *   an item with NO `_kind`       a Drive folder resource. CONSUMED, never carried on: it has no
 *                                 `_kind`, so a strict route downstream would error on it, and an
 *                                 item carrying an id and nothing else is exactly the shape the
 *                                 upload route has to be able to ignore.
 * The number dropped is asserted against the number of folders requested. A count that does not
 * match is reported rather than absorbed.
 *
 * The SENT ORDER is still read from `$('Folder Route').all(0)`, because a cross check has to come
 * from somewhere independent of the stream it is checking.
 */

const W = require('./_write');
const RN = require('./_render');

const NODE_NAME = 'Attach Folder Ids';

// Every string this node puts in front of a person is capped, because two of them come from a job
// posting written by a stranger.
const WHY_MAX = 400;

(function assertAgainstUpstream() {
  W.assertShippedPairShape();

  const route = require('./52-folder-route.js');
  const create = require('./53-create-folder.js');
  const merge = require('./54-folder-results.js');
  if (route.name !== 'Folder Route') throw new Error(NODE_NAME + ': node 52 is named ' + JSON.stringify(route.name) + ' and this node reads its output 0 by that name.');
  if (create.name !== 'Create Folder') throw new Error(NODE_NAME + ': node 53 is named ' + JSON.stringify(create.name) + ' and this node reads its responses by that name.');
  if (merge.name !== 'Folder Results') throw new Error(NODE_NAME + ': node 54 is named ' + JSON.stringify(merge.name) + ' and this node connects from it.');
  if (create.onError !== 'continueRegularOutput') {
    throw new Error(
      NODE_NAME + ': Create Folder no longer continues on error.\n' +
      '  Without it one Drive permission failure stops the workflow here, and every held pair carrying a\n' +
      '  reason a person needs to read, every lane report and the run row that makes tomorrow daily cap\n' +
      '  true all die with it.'
    );
  }
  if (create.retryOnFail) {
    throw new Error(
      NODE_NAME + ': Create Folder now retries. Drive permits two folders with the same name in the same\n' +
      '  parent, so a retry after a timeout that actually succeeded leaves one application with two\n' +
      '  folders, one of them empty, and the pairing in this node cannot tell them apart.'
    );
  }

  const build = require('./44-build-documents.js');
  const bsrc = String(build.parameters.jsCode || '');
  for (const [needle, what] of [
    ['j.readme_md = readme;', 'the README markdown, which this node hands to Text to File'],
    ['j.job_ad_md = jobAd;', 'the saved posting, same'],
    ['j.readme_md5 = md5Utf8(readme);', 'the digest the Drive read back is compared against'],
    ['j.job_ad_md5 = docs.job_ad_md5;', 'the same for the posting'],
    ['j.pair_id = pairId;', 'the id every pairing in this seat joins on'],
  ]) {
    if (bsrc.indexOf(needle) === -1) {
      throw new Error(NODE_NAME + ': Build Documents no longer contains ' + JSON.stringify(needle) + ', which is ' + what + '.');
    }
  }

  const check = require('./51-check-renders.js');
  if (String(check.parameters.jsCode || '').indexOf(RN.MD5_RUNTIME) !== -1) {
    // Not an error. Stated so the next reader knows the digests being compared here and the digests
    // computed at render time come from the same bytes of the same function.
    void 0;
  }
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// Attach Folder Ids. The Prep for File bridge, N pairs at a time, plus the four
// file items of one job folder.
// ---------------------------------------------------------------------------
function txt(v) { return String(v === null || v === undefined ? '' : v); }
function cut(s, n) { const t = txt(s); return t.length > n ? t.slice(0, n - 3) + '...' : t; }

// --- 1. the three views ------------------------------------------------------
let sent = null;
try {
  sent = $('Folder Route').all(0).map((i) => i.json);
} catch (e) {
  sent = null;
}
if (sent === null) sent = [];

let responses = null;
let responseItems = [];
try {
  responseItems = $('Create Folder').all();
  responses = responseItems.map((i) => i.json || {});
} catch (e) {
  responses = null;
}

const inputItems = $input.all();
if (!inputItems.length) {
  throw new Error('Attach Folder Ids: Folder Results delivered no items at all. Its input 1 carries every lane report and every stage report and is never empty, so an empty input means the merge did not run.');
}

const warnings = [];
let pairing = 'ok';
let pairingWhy = null;

if (sent.length === 0) {
  // An ordinary quiet morning. Nothing shipped, so Create Folder was skipped by the engine.
  pairing = 'nothing_sent';
  pairingWhy = 'no pair passed R1 to R6 this run, so no folder was asked for.';
} else if (responses === null) {
  pairing = 'mismatch';
  pairingWhy = 'Create Folder could not be reached from this node, so there is no way to know which folder belongs to which application. Nothing is attributed.';
} else if (responses.length !== sent.length) {
  pairing = 'mismatch';
  pairingWhy = 'Folder Route sent ' + sent.length + ' folder request(s) and Create Folder returned ' + responses.length + ' item(s). The responses are a flat list with nothing in them saying which application they belong to, so a count that does not match makes every attribution a guess.';
} else {
  // The two cross checks. At least one has to be available, or the pairing is unconfirmable.
  let nameChecked = 0;
  let pairedChecked = 0;
  for (let i = 0; i < responses.length; i += 1) {
    const r = responses[i] || {};
    const wanted = txt(sent[i] && sent[i].folder_name);
    if (typeof r.name === 'string' && r.name.length) {
      nameChecked += 1;
      if (r.name !== wanted) {
        pairing = 'mismatch';
        pairingWhy = 'response ' + i + ' is a folder Google calls ' + JSON.stringify(cut(r.name, 120)) + ' and position ' + i + ' asked for ' + JSON.stringify(cut(wanted, 120)) + '. The responses came back in a different order from the requests, or one of them is somebody else folder. Nothing is attributed: attaching the wrong folder id puts a cover letter for one company in a folder named after another, and every check after this point would pass.';
        break;
      }
    }
    const pi = responseItems[i] && responseItems[i].pairedItem;
    const piIndex = pi && typeof pi === 'object' && !Array.isArray(pi) ? pi.item : (Array.isArray(pi) && pi.length === 1 ? pi[0].item : undefined);
    if (piIndex !== undefined && piIndex !== null) {
      pairedChecked += 1;
      if (Number(piIndex) !== i) {
        pairing = 'mismatch';
        pairingWhy = 'response ' + i + ' says it came from sent item ' + piIndex + '. The order is not the order, so nothing is attributed.';
        break;
      }
    }
  }
  if (pairing === 'ok' && nameChecked === 0 && pairedChecked === 0) {
    pairing = 'mismatch';
    pairingWhy = 'not one Create Folder response carries a name or a pairedItem index, so the only thing joining a folder to an application would be list position and nothing can confirm it. Refused rather than guessed: this is the one place in this workflow where being wrong is invisible.';
  }
  if (pairing === 'ok') {
    if (nameChecked < responses.length) warnings.push((responses.length - nameChecked) + ' Create Folder response(s) carried no name, so those were paired on position and pairedItem alone.');
  }
}

// --- 2. the pairs -------------------------------------------------------------
const sentIndexById = {};
for (let i = 0; i < sent.length; i += 1) {
  const id = txt(sent[i] && sent[i].pair_id);
  if (!id) continue;
  if (sentIndexById[id] !== undefined) {
    pairing = 'mismatch';
    pairingWhy = 'two shipped pairs carry the same pair_id ' + JSON.stringify(id) + '. That id is the join key for every pairing in the write back half, so a duplicate makes all of them ambiguous.';
    break;
  }
  sentIndexById[id] = i;
}

const out = [];
const fileItems = [];
const stats = { pairs: 0, shipped: 0, folders: 0, failed: 0, skipped: 0, files: 0, drive_resources_dropped: 0, carried: 0, unclaimed_shipped: 0 };
const failures = [];
const folders = [];

// The three shapes on the merged stream. See header note 5.
const shippedItems = [];
const carriedItems = [];
for (const it of inputItems) {
  const raw = (it && it.json) || {};
  if (raw._kind === undefined || raw._kind === null) { stats.drive_resources_dropped += 1; continue; }
  if (raw._kind === 'pair' && !raw._status) { shippedItems.push(it); continue; }
  carriedItems.push(it);
}
const shippedByPairId = {};
for (const it of shippedItems) {
  const id = txt(it.json.pair_id);
  if (id && shippedByPairId[id] === undefined) shippedByPairId[id] = it;
}

function markDrive(j, why) {
  j._status = 'error:drive';
  j._status_class = 'systemic';
  j._sheet_action = 'leave_untouched';
  j._status_why = cut(why, WHY_MAX);
  stats.failed += 1;
  failures.push({ pair_id: txt(j.pair_id), why: j._status_why });
}

// Everything that did not ship travels on untouched apart from the two routing flags.
for (const it of carriedItems) {
  const j = Object.assign({}, (it && it.json) || {});
  j.needs_convert = false;
  j._call_now = false;
  if (j._kind === 'pair') { stats.pairs += 1; stats.skipped += 1; } else { stats.carried += 1; }
  out.push({ json: j });
}

// The shipped applications, walked in the order Folder Route SENT them rather than the order the
// merge happened to produce, so the folder responses line up with the thing they were asked for.
for (let si = 0; si < sent.length; si += 1) {
  const pairId = txt(sent[si] && sent[si].pair_id);
  const it = pairId ? shippedByPairId[pairId] : undefined;
  if (it === undefined) {
    stats.unclaimed_shipped += 1;
    continue;
  }
  delete shippedByPairId[pairId];
  const j = Object.assign({}, it.json);
  j.needs_convert = false;
  j._call_now = false;
  stats.pairs += 1;
  stats.shipped += 1;

  const idx = si;

  if (pairing === 'mismatch') {
    markDrive(j, 'THE FOLDER PAIRING WAS REFUSED for the whole batch: ' + pairingWhy);
    out.push({ json: j });
    continue;
  }
  const resp = (responses && responses[idx]) || {};
  if (resp.error !== undefined) {
    const msg = txt(typeof resp.error === 'string' ? resp.error : (resp.error && resp.error.message) || JSON.stringify(resp.error));
    markDrive(j, 'Drive refused to create the folder (' + cut(msg, 240) + '). The sheet row is LEFT AT new, so tomorrow morning offers this job again once the cause is fixed.');
    out.push({ json: j });
    continue;
  }
  const folderId = txt(resp.id);
  if (!folderId) {
    // The staging workflow's exact refusal, and the reason it throws there: an upload into folder
    // folder undefined does not fail, it lands in the root of My Drive and returns 200.
    markDrive(j, 'Create Folder returned no folder id. An upload with no folder id does not fail: it puts the documents in the root of My Drive and returns 200, which is why this is refused here rather than carried on as an undefined.');
    out.push({ json: j });
    continue;
  }

  const docs = (j._documents && typeof j._documents === 'object') ? j._documents : null;
  const manifest = docs && Array.isArray(docs.files) ? docs.files : null;
  if (!manifest || manifest.length !== FILE_KINDS.length) {
    markDrive(j, 'the pair carries ' + (manifest ? manifest.length : 'no') + ' file manifest entr(ies) and one job folder is exactly ' + FILE_KINDS.length + ' files (' + FILE_KINDS.join(', ') + '). Check Renders builds that manifest, so a pair here without it went round a path nobody built.');
    out.push({ json: j });
    continue;
  }

  const byKind = {};
  for (const f of manifest) byKind[txt(f.kind)] = f;
  const missingKinds = FILE_KINDS.filter((k) => !byKind[k]);
  if (missingKinds.length) {
    markDrive(j, 'the file manifest is missing ' + JSON.stringify(missingKinds) + '. A folder with three of the four files is a half application, and a half application that is written into the sheet reads exactly like a whole one.');
    out.push({ json: j });
    continue;
  }

  // The two markdown strings, and the digest check that costs nothing. Recomputing here with the
  // same function over the same string can only disagree if the STRING changed since Build
  // Documents, which is the one thing worth catching.
  const texts = { readme: txt(j.readme_md), job_ad: txt(j.job_ad_md) };
  let textProblem = null;
  for (const kind of ['readme', 'job_ad']) {
    const s = texts[kind];
    if (!s.length) { textProblem = 'the pair carries no ' + kind + ' text, so there is nothing to upload as ' + txt(byKind[kind].name) + '.'; break; }
    const stamped = txt(byKind[kind].md5);
    const now = md5Utf8(s);
    if (stamped && now !== stamped) {
      textProblem = 'the ' + kind + ' digest changed between Build Documents and here: it was ' + stamped + ' and the text on this pair now hashes to ' + now + '. Something rewrote the string in flight, and uploading it would put a file in Drive that no digest on this pair describes.';
      break;
    }
  }
  if (textProblem) {
    markDrive(j, textProblem);
    out.push({ json: j });
    continue;
  }

  // The two PDF descriptors, copied UNCHANGED onto their own items under the data property. See note 3.
  const bin = (it && it.binary) || {};
  const missingBytes = [];
  for (const kind of ['cv', 'letter']) {
    const prop = txt(byKind[kind].binary_property);
    if (!prop || !bin[prop]) missingBytes.push(kind + ' (' + (prop || 'no property named') + ')');
  }
  if (missingBytes.length) {
    markDrive(j, 'the pair carries no bytes for ' + missingBytes.join(' and ') + '. Check Renders attaches both PDFs to a passing pair, and an upload with no binary creates an EMPTY file in Drive and returns a perfectly healthy 200.');
    out.push({ json: j });
    continue;
  }

  const folderUrl = FOLDER_PREFIX + folderId;
  j.folder_id = folderId;
  j.folder_url = folderUrl;
  j.folder_created_at = new Date().toISOString();
  j._folder = {
    id: folderId,
    name: txt(resp.name) || txt(j.folder_name),
    parent: txt(j.drive_parent_folder_id),
    url: folderUrl,
    paired_by: 'Folder Route output 0 order, cross checked against the name Google echoed back and against pairedItem',
  };
  stats.folders += 1;
  folders.push({ pair_id: pairId, folder_id: folderId, name: txt(j.folder_name) });

  // The pair travels on WITHOUT its bytes. See note 4.
  out.push({ json: j });

  const common = {
    _kind: 'file',
    _status: null,
    _call_now: true,
    pair_id: pairId,
    lane_key: txt(j.lane_key),
    source_project: j.source_project,
    job_id: txt(j.job_id),
    company: txt(j.company),
    folder_id: folderId,
    folder_url: folderUrl,
    run_started_at: txt(j.run_started_at),
    exec_id: txt(j.exec_id),
  };
  for (let k = 0; k < FILE_KINDS.length; k += 1) {
    const kind = FILE_KINDS[k];
    const f = byKind[kind];
    const isPdf = kind === 'cv' || kind === 'letter';
    const item = {
      json: Object.assign({}, common, {
        kind: kind,
        file_seq: k + 1,
        filename: txt(f.name),
        expected_md5: txt(f.md5),
        expected_bytes: isPdf ? (isFinite(Number(f.bytes)) ? Number(f.bytes) : null) : utf8Bytes(texts[kind]).length,
        needs_convert: !isPdf,
        source_binary_property: isPdf ? txt(f.binary_property) : null,
      }),
    };
    if (isPdf) {
      item.binary = {};
      item.binary[UPLOAD_PROPERTY] = bin[txt(f.binary_property)];
    } else {
      item.json.text = texts[kind];
    }
    fileItems.push(item);
    stats.files += 1;
  }
}

// --- 3. the accounting --------------------------------------------------------
if (pairing === 'mismatch') {
  warnings.push('THE FOLDER PAIRING WAS REFUSED and no folder id was attached to any application: ' + pairingWhy + ' Every folder that was created is LEFT IN PLACE, empty, and every affected sheet row stays at new.');
}
if (stats.unclaimed_shipped > 0) {
  warnings.push(stats.unclaimed_shipped + ' shipped pair(s) were sent to Create Folder and did NOT arrive back on the merge. Folder Results wires Folder Route output 0 into input 2 precisely so they do, and without that wire a whole morning of applications leaves no trace while the folders are created perfectly. Check that Folder Results still declares three inputs.');
}
if (stats.drive_resources_dropped !== sent.length && sent.length) {
  warnings.push('THE DRIVE RESOURCE COUNT DOES NOT ADD UP: ' + stats.drive_resources_dropped + ' item(s) with no _kind were dropped from the stream and ' + sent.length + ' folder(s) were asked for. An item with no _kind is either a Create Folder response or something nobody built, and the second case would reach the upload route as an item nothing can describe.');
}
if (stats.files !== stats.folders * FILE_KINDS.length) {
  warnings.push('THE FILE COUNT DOES NOT MATCH THE FOLDER COUNT: ' + stats.folders + ' folder(s) and ' + stats.files + ' file item(s). Four files per folder is the contract Check Uploads asserts as U3, and a folder that is short one file is a half application that reads like a whole one.');
}
if (stats.failed > 0) {
  warnings.push(stats.failed + ' shipped pair(s) were marked error:drive. Their folders, where one was created, are LEFT IN PLACE rather than deleted: deleting a folder this run is not certain about is a destructive write, and the cost of leaving it is one empty folder. Their sheet rows stay at new, so tomorrow offers the same job again and creates a SECOND folder with the same name, which Drive permits.');
}

const report = {
  _kind: 'stage_report',
  stage: 'attach_folder_ids',
  counts: stats,
  pairing: { state: pairing, why: pairingWhy, sent: sent.length, responses: responses === null ? null : responses.length },
  folders: folders.slice(0, 24),
  failures: failures.slice(0, 12),
  files_per_folder: FILE_KINDS,
  rule: 'the folder id is read from the node that HELD the context rather than from the stream, because Create Folder replaces the item it is given. An upload into folder undefined does not fail: it lands in the root of My Drive and returns 200.',
  warnings: warnings,
  needs_convert: false,
  _call_now: false,
  site_fetch_url: '',
  ad_fetch_url: '',
};

const finalItems = out.map((o) => ({ json: o.json, pairedItem: { item: 0 } }));
for (const f of fileItems) finalItems.push({ json: f.json, binary: f.binary, pairedItem: { item: 0 } });
finalItems.push({ json: report, pairedItem: { item: 0 } });
return finalItems;
`;

function renderJsCode() {
  return [
    '// GENERATED at build time from work/36-job-application-writer/nodes/55-attach-folder-ids.js.',
    '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
    W.MD5_RUNTIME,
    'const FILE_KINDS = ' + JSON.stringify(W.FILE_KINDS) + ';',
    'const UPLOAD_PROPERTY = ' + JSON.stringify(W.UPLOAD_BINARY_PROPERTY) + ';',
    'const FOLDER_PREFIX = ' + JSON.stringify(W.DRIVE_FOLDER_PREFIX) + ';',
    'const WHY_MAX = ' + JSON.stringify(WHY_MAX) + ';',
    LOGIC,
  ].join('\n');
}

W.assertGeneratedSourceIsClean(renderJsCode(), NODE_NAME);

module.exports = {
  name: NODE_NAME,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [13780, 100],
  connectFrom: 'Folder Results',
  notes: 'The staging workflow Prep for File bridge in an N item version. Reads the sent order from Folder Route output 0 and the folder resources from Create Folder by NAME, because Create Folder replaces the item it is given, then pairs them by position and cross checks BOTH against the name Google echoed back and against pairedItem, refusing the whole batch when neither is available. A missing folder id is refused per pair rather than carried on, because an upload into folder undefined lands in the root of My Drive and returns 200. Emits the pair without its bytes plus FOUR file items: the two PDFs with their descriptors copied unchanged onto the default data property, and the two markdown files as strings marked needs_convert.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: renderJsCode(),
  },
};
