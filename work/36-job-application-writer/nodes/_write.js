'use strict';
/*
 * _write.js - seat 7's build-time helper for runtime nodes 52 to 74, the write back half.
 *
 * The leading underscore keeps it out of build.js's node glob (/^\d+-.+\.js$/), the same convention
 * as _lane.js, _master.js, _stage2.js and _render.js. The n8n box never calls any of this: it runs
 * on this machine and its output is baked into node parameters.
 *
 * =============================================================================================
 * WHAT THIS SEAT IS, IN ONE SENTENCE.
 * =============================================================================================
 * Everything before node 52 produced bytes. This half puts them in Shaheen's Drive and writes the
 * rows he reads on his phone in the morning, and every single external write it makes is read back
 * in the same run. "It returned 200" is not verification: that sentence is in the root constitution
 * because a PUT once dropped a live workflow's active flag, returned 200, and nobody noticed for a
 * day. The ONE named exemption is the HQ run_status heartbeat, and it is named in node 73 and
 * nowhere else.
 *
 * =============================================================================================
 * 1. WHAT IS READ RATHER THAN RESTATED, AND WHY EACH ONE IS READ.
 * =============================================================================================
 *   nodes/_lane.js                            a1(), batchGetUrl(), APPLICATIONS_COLUMNS,
 *     WRITER_RUNS_COLUMNS, jobsColumns(), the credentials by id. Seat 3 declared the twelve
 *     writer_runs columns THERE and asked this seat either to honour the list or to change it in
 *     that one place. It is honoured; see note 4.
 *   work/34-job-search-bi/nodes/_output.js    batchUpdateUrl(). The Sheets REST url shapes are a
 *     platform fact the collector lane already owns and proves on live runs, and a second copy is
 *     how one lane learns a query parameter the other does not have.
 *   nodes/_render.js                          the MD5 runtime, baked as the SAME BYTES node 44 and
 *     node 49 carry, and assertGeneratedSourceIsClean(). Seat 6 proved that MD5 against node crypto
 *     on sixteen edge case strings and sixty random buffers precisely so this seat could compare
 *     its digests against what Google Drive reports back. A second implementation would be a second
 *     chance to disagree with Drive about a file that uploaded perfectly.
 *   nodes/51-check-renders.js                 the two binary property names and the four file
 *     manifest, read out of that node's generated code. Seat 6 owns what a shipped pair carries.
 *
 * =============================================================================================
 * 2. THE VOCABULARIES THIS SEAT DEFINES, BECAUSE NOBODY ELSE DID.
 * =============================================================================================
 * The applications tab exists in both spreadsheets with thirteen columns and zero rows. No
 * vocabulary was ever recorded for `channel` or `status`, and `cv_ref` and `cover_letter_ref` had
 * no defined referent. They are defined below, once, and every value this workflow can write is in
 * these tables. A column whose vocabulary lives in a comment is a column whose vocabulary drifts.
 *
 * THE JOBS TAB `status` COLUMN IS DIFFERENT and the difference is the whole queue. Today it holds
 * exactly one value, `new`, written by the collectors. Node 05 admits a row only when it reads
 * `new`, so writing ANY other value takes the row out of tomorrow's queue, and typing `new` back
 * into the cell by hand puts it back. That is out of the box item 4, the zero code phone override,
 * and it is the reason every value this seat writes into that column is a value that is not `new`
 * and never can be.
 *
 * The values are the workflow's OWN `_status` tokens, verbatim, rather than a translation of them.
 * A translation table would be a second vocabulary to keep in step with the first, and the tokens
 * are already the words every node in this workflow speaks: needs_review, blocked:<kind>,
 * skipped:cap, held:<kind>. A shipped pair has no `_status` at all, so it gets the one word this
 * seat adds, `written`, which means the CV and the letter exist in Drive and were read back.
 *
 * =============================================================================================
 * 3. THE SHIP PREDICATE IS DEFINED ONCE AND CHECKED AGAINST ITS OWN EXPRESSION.
 * =============================================================================================
 * The approved plan says node 52 routes on `outcome === 'ship'`. No node upstream stamps a field
 * called `outcome`: seat 6 stamps `_status` and leaves it absent on a pair that shipped. This seat
 * cannot edit an earlier seat's node file, so the predicate is DERIVED, and it is derived in two
 * places that must agree: an n8n expression inside the IF, and outcomeOf() inside five Code nodes.
 *
 * Two derivations of one rule is exactly what this project refuses everywhere else, so it is not
 * left on trust: assertShipExpressionAgrees() below EXECUTES the expression bytes that ship, over a
 * table of synthetic items, and fails the build if the two ever disagree on one of them.
 *
 * =============================================================================================
 * 4. THE writer_runs COLUMN LIST, FINAL.
 * =============================================================================================
 *   date, run_started_at, exec_id, lane, attempted, shipped, held, blocked, skipped_cap, errors,
 *   cost_usd, note
 * Twelve columns, A to L, ONE ROW PER LANE PER RUN. `lane` holds the COLLECTOR PROJECT NUMBER as a
 * string ("34" or "35"), not the lane key, because node 05 counts today's attempts by matching that
 * cell against String(source_project) and a cap that cannot count today is not a cap.
 *
 * `attempted` counts pairs ADMITTED TO THE READER, not pairs shipped, so a bad morning cannot spend
 * the day cap twice. The five count columns after it do NOT sum to `attempted`, by design:
 * skipped_cap includes the qualifiers intake never admitted at all.
 *
 * =============================================================================================
 * 5. PRIVACY. This file is TRACKED and the repo is PUBLIC. It carries no spreadsheet id, no Drive
 * folder id, no credential id and no personal data. It carries the CODE that reads those out of the
 * gitignored lane file at build time, the same way every other node file in this project does.
 */

const fs = require('fs');
const path = require('path');

const LN = require('./_lane');
const RN = require('./_render');

const REPO = LN.REPO;
const OUTPUT_HELPER_FILE = path.join(REPO, 'work', '34-job-search-bi', 'nodes', '_output.js');

function rel(p) { return path.relative(REPO, p).replace(/\\/g, '/'); }

// ---------------------------------------------------------------------------------------------
// SHEETS AND DRIVE URL SHAPES.
//
// batchUpdateUrl is READ out of the collector lane's helper rather than written again here. a1()
// and batchGetUrl() already arrive through _lane.js for the same reason. The Drive shapes below
// have no such owner in this repo, so they are written here, once, with the note that matters:
// `alt=media` is what turns a metadata GET into the FILE BYTES, and without it the read back would
// compare the md5 of a JSON metadata document against the md5 of a PDF and fail every time.
// ---------------------------------------------------------------------------------------------
const OUT = require(OUTPUT_HELPER_FILE);
if (typeof OUT.batchUpdateUrl !== 'function') {
  throw new Error(
    '#36 _write.js: ' + rel(OUTPUT_HELPER_FILE) + ' no longer exports batchUpdateUrl().\n' +
    '  The Sheets REST url shapes are read from there so the collector lane and this one cannot hold\n' +
    '  two different copies of them. Do not paste a url template in here to make this pass.'
  );
}
const batchUpdateUrl = OUT.batchUpdateUrl;

const DRIVE_FILES_BASE = 'https://www.googleapis.com/drive/v3/files/';
function driveMediaUrlExpr(idExpr) { return DRIVE_FILES_BASE + '{{ ' + idExpr + ' }}?alt=media'; }
const DRIVE_FILE_VIEW_PREFIX = 'https://drive.google.com/file/d/';
const DRIVE_FILE_VIEW_SUFFIX = '/view';
const DRIVE_FOLDER_PREFIX = 'https://drive.google.com/drive/folders/';

// ---------------------------------------------------------------------------------------------
// COLUMN ARITHMETIC. A1 column letters, for a sheet nobody will ever grow past Z, written to cope
// anyway: a range built as `applications!A2:{1}2` with a bad letter is a range Google accepts and
// fills with the wrong nine cells.
// ---------------------------------------------------------------------------------------------
function colLetter(index) {
  if (!Number.isInteger(index) || index < 0 || index > 701) {
    throw new Error('#36 _write.js: colLetter(' + JSON.stringify(index) + ') is outside the range this helper covers (0 to 701, A to ZZ).');
  }
  let n = index;
  let s = '';
  while (true) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return s;
}

const APPLICATIONS_COLUMNS = LN.APPLICATIONS_COLUMNS.slice();
const WRITER_RUNS_COLUMNS = LN.WRITER_RUNS_COLUMNS.slice();
const APPLICATIONS_LAST_COL = colLetter(APPLICATIONS_COLUMNS.length - 1);
const WRITER_RUNS_LAST_COL = colLetter(WRITER_RUNS_COLUMNS.length - 1);

function jobsStatusColumn() {
  const cols = LN.jobsColumns();
  const i = cols.indexOf('status');
  if (i === -1) {
    throw new Error(
      '#36 _write.js: the shared row shape has no `status` column, so there is no cell to take a job\n' +
      '  out of tomorrow morning queue. Node 05 admits a row only when that cell reads `new`, so a\n' +
      '  jobs tab without it would re-offer every job this workflow has ever written, every day.'
    );
  }
  return { index: i, letter: colLetter(i), columns: cols };
}

// ---------------------------------------------------------------------------------------------
// THE VOCABULARIES. See header note 2.
// ---------------------------------------------------------------------------------------------

// applications.status - the life of one application. This workflow writes the first two and NEVER
// the rest: everything past `ready` is a human editing a cell, or a phase that does not exist yet.
const APPLICATION_STATUS = {
  ready: 'the CV and the cover letter are built, uploaded and read back byte for byte in Drive. Nothing has been sent: sending is his, always.',
  needs_review: 'the pipeline produced something and refused to ship it. The WHY is no longer in the row: the notes column went in the 2026-09-17 trim, so the reason lives in that run writer_runs note and in the execution, and this token is all the sheet says.',
};
const APPLICATION_STATUS_RESERVED = {
  sent: 'he submitted it. Written by hand, or by a phase that does not exist yet.',
  interview: 'it turned into a conversation.',
  rejected: 'they said no.',
  withdrawn: 'he pulled it.',
};

// applications.channel - how this application reaches the employer. The column answers one question
// a person actually asks six weeks later: did a machine send this, or am I about to?
const APPLICATION_CHANNEL = {
  manual: 'the documents are in a Drive folder and he submits them himself. This is the ONLY value this workflow writes for a shipped row, and it is the honest one: nothing in this system has ever sent an application and D3 did not ask it to.',
  none: 'nothing was produced to submit. Every held row.',
};
const APPLICATION_CHANNEL_RESERVED = {
  email: 'a phase that emails an application writes this.',
  portal: 'a phase that submits through a company portal writes this.',
  referral: 'it went in through a person.',
};

// applications.outcome - REMOVED from the tab on 2026-09-17, with last_contact_at and notes. It was
// deliberately written EMPTY here (the human's column, and an outcome written before there is one is
// a fiction that reads exactly like a fact), and Shaheen removed the empty columns rather than
// filling them. The vocabulary below is kept as the record of what the column meant: nothing writes
// it, node 66 still reports it as reserved, and that is the trail back if it ever returns.
const APPLICATION_OUTCOME_RESERVED = ['offer', 'rejected', 'no_reply', 'withdrawn'];

// cv_ref and cover_letter_ref - the referent, which had none.
//
// A Drive FILE URL, not a bare id. Both columns are read on a phone, six weeks after the fact, next
// to a company name, and a tappable link is the difference between finding the document and
// pasting a 33 character string into a search box. The id is still recoverable by eye: it is the
// span between /d/ and /view.
//
// A held row leaves both EMPTY, because nothing was uploaded and a link to a file that does not
// exist is worse than a blank cell.
function driveFileRef(id) { return DRIVE_FILE_VIEW_PREFIX + String(id) + DRIVE_FILE_VIEW_SUFFIX; }
function driveFolderRef(id) { return DRIVE_FOLDER_PREFIX + String(id); }

// jobs.status - the queue. See header note 2 for why the values are the workflow's own tokens.
const JOBS_STATUS_SHIPPED = 'written';

// ---------------------------------------------------------------------------------------------
// THE SHIP PREDICATE. See header note 3.
//
// outcomeOf() is baked into the Code nodes. SHIP_EXPRESSION is baked into node 52. They are checked
// against each other by executing BOTH, here, at build time.
// ---------------------------------------------------------------------------------------------
function outcomeOf(j) {
  if (!j || j._kind !== 'pair') return 'not_a_pair';
  var s = j._status;
  if (s === null || s === undefined || s === '') return 'ship';
  s = String(s);
  if (s.indexOf('error:') === 0) return 'error';
  if (s.indexOf('blocked:') === 0) return 'blocked';
  if (s === 'skipped:cap') return 'capped';
  return 'hold';
}

const SHIP_EXPRESSION_BODY = '$json._kind === "pair" && !$json._status ? "ship" : "no"';
const SHIP_EXPRESSION = '={{ ' + SHIP_EXPRESSION_BODY + ' }}';
const SHIP_VALUE = 'ship';

// The table both derivations are run over. Every shape that actually travels this workflow, plus
// the two shapes that would silently break a naive predicate: a pair whose _status is the empty
// string, and a report that carries no _status key at all.
const SHIP_FIXTURES = [
  { _kind: 'pair', _status: null },
  { _kind: 'pair', _status: undefined },
  { _kind: 'pair' },
  { _kind: 'pair', _status: '' },
  { _kind: 'pair', _status: 'needs_review' },
  { _kind: 'pair', _status: 'held:no_ad_text' },
  { _kind: 'pair', _status: 'held:brief_truncated' },
  { _kind: 'pair', _status: 'blocked:swedish_fluent_required' },
  { _kind: 'pair', _status: 'blocked:work_type_outside_scope' },
  { _kind: 'pair', _status: 'skipped:cap' },
  { _kind: 'pair', _status: 'error:render' },
  { _kind: 'pair', _status: 'error:transport' },
  { _kind: 'lane_report', state: 'ok' },
  { _kind: 'stage_report', stage: 'check_renders' },
  { _kind: 'file', filename: 'README.md' },
  {},
];

function evalShipExpression(json) {
  const inner = SHIP_EXPRESSION.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
  // eslint-disable-next-line no-new-func
  const fn = new Function('$json', '"use strict"; return (' + inner + ');');
  return fn(json);
}

function assertShipExpressionAgrees() {
  const disagreements = [];
  for (const f of SHIP_FIXTURES) {
    const viaExpr = evalShipExpression(f) === SHIP_VALUE;
    const viaCode = outcomeOf(f) === 'ship';
    if (viaExpr !== viaCode) {
      disagreements.push(JSON.stringify(f) + ': the route says ' + (viaExpr ? 'SHIP' : 'not ship') + ' and outcomeOf() says ' + (viaCode ? 'SHIP' : 'not ship'));
    }
  }
  if (disagreements.length) {
    throw new Error(
      '#36 _write.js: the Folder Route expression and outcomeOf() disagree about what ships.\n' +
      '  - ' + disagreements.join('\n  - ') + '\n' +
      '  The approved plan routes node 52 on `outcome === ship` and nothing upstream stamps a field\n' +
      '  called outcome, so the predicate is derived twice: once as an n8n expression inside the IF and\n' +
      '  once as code inside the nodes after it. Two derivations of one rule is what this project\n' +
      '  refuses everywhere else, so they are executed against each other here instead of trusted.\n' +
      '  Fix BOTH in the same edit.'
    );
  }
  return { checked: SHIP_FIXTURES.length };
}

// ---------------------------------------------------------------------------------------------
// THE EXPRESSION THAT SURVIVES A NODE REPLACING AN ITEM JSON.
//
// THE PROBLEM, STATED RATHER THAN GUESSED AT. Three node types in this seat REPLACE the item they
// are handed: Google Drive (folder create and upload) returns the Drive resource, and the HTTP
// Request node returns the response. The staging workflow (v1GbDYganOz9EGpM) carries a whole node
// called Prep for File whose only job is to put the context back after Create Folder, and its
// Upload node reads `$('Prep for File').item.json.filename` rather than `$json.filename` for
// exactly that reason. That is the proven shape and it is lifted here rather than reinvented.
//
// convertToFile is the one this seat CANNOT settle from here. The published n8n documentation for
// Convert to File does not say whether the output item keeps the input json or replaces it with an
// empty object, there is no n8n source on this machine to read, and this seat may not call the box.
// The staging workflow avoids the question by never reading `$json` after its Text to File node,
// which is evidence about what its author trusted and not a measurement.
//
// So every expression in this seat that reads a field after one of those nodes reads it BOTH ways:
// the field itself when it is there, and the paired source item when it is not. If the json
// survives, the fallback never runs. If it does not, the fallback is the staging workflow's own
// shape. Both have to fail for the expression to fail, and that residual is in the handover as
// UNPROVEN rather than assumed away.
// ---------------------------------------------------------------------------------------------
function fallbackExpr(field, sourceNode) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(field)) {
    throw new Error('#36 _write.js: fallbackExpr(' + JSON.stringify(field) + ') is not a plain identifier, and the expression addresses it with dot notation.');
  }
  if (typeof sourceNode !== 'string' || !sourceNode) {
    throw new Error('#36 _write.js: fallbackExpr needs the NAME of the node that last held the item json, because that name is the connection key the fallback resolves through.');
  }
  if (sourceNode.indexOf("'") !== -1 || sourceNode.indexOf('"') !== -1) {
    throw new Error('#36 _write.js: the node name ' + JSON.stringify(sourceNode) + ' carries a quote, and it is being embedded in an expression string.');
  }
  return '={{ $json.' + field + ' !== undefined ? $json.' + field + ' : $("' + sourceNode + '").item.json.' + field + ' }}';
}

// ---------------------------------------------------------------------------------------------
// WHAT A SHIPPED PAIR CARRIES, READ OUT OF SEAT 6 RATHER THAN ASSUMED.
//
// Seat 6 owns the shape of a shipped pair and stated it in a handover. A handover is a sentence;
// this is the check. If Check Renders stops attaching the two binaries under these names, or stops
// building the four file manifest, the upload half would carry on emitting file items with no bytes
// in them and Drive would accept four empty files with four healthy 200s.
// ---------------------------------------------------------------------------------------------
const CV_BINARY_PROPERTY = 'cv_pdf';
const LETTER_BINARY_PROPERTY = 'letter_pdf';
const UPLOAD_BINARY_PROPERTY = 'data';

function assertShippedPairShape() {
  const file = path.join(__dirname, '51-check-renders.js');
  const def = require(file);
  if (def.name !== 'Check Renders') {
    throw new Error('#36 _write.js: node 51 is named ' + JSON.stringify(def.name) + ' and this whole seat hangs off "Check Renders". The name is the connection key.');
  }
  const src = String((def.parameters && def.parameters.jsCode) || '');
  const needles = [
    ['binary.cv_pdf = Object.assign(', 'the CV binary, attached under the property this seat uploads from'],
    ['binary.letter_pdf = Object.assign(', 'the cover letter binary, same'],
    ["binary_property: 'cv_pdf'", 'the manifest entry naming where the CV bytes are'],
    ["binary_property: 'letter_pdf'", 'the manifest entry naming where the letter bytes are'],
    ['out.push({ json: j, binary: binary });', 'the one line that puts bytes on a shipped pair at all'],
    ["j._sheet_action = 'leave_untouched';", 'the systemic class, which is what makes a render failure leave the sheet row at new'],
    ["j._sheet_action = 'write_status';", 'the hold class, which is what makes a document verdict close the row'],
  ];
  for (const [needle, what] of needles) {
    if (src.indexOf(needle) === -1) {
      throw new Error(
        '#36 _write.js: Check Renders no longer contains ' + JSON.stringify(needle) + ', which is ' + what + '.\n' +
        '  Seat 6 owns the shape of a shipped pair and this seat reads it rather than assuming it. If the\n' +
        '  shape legitimately moved, change this needle in the same edit. Do NOT loosen the check: an\n' +
        '  upload half that cannot find the bytes uploads four empty files and gets four healthy 200s.'
      );
    }
  }
  return true;
}

// The four files of one folder, in upload order. Order is not cosmetic: node 65 asserts FOUR files
// per shipped pair (U3) and the run report lists them, so a stable order is what makes a partial
// folder readable at a glance.
// TWO SINCE 2026-09-17, was four. Shaheen: when the workflow prints the CV and the cover letter it
// should not produce any md file. So README.md and job-ad.md are not built, not converted, not
// uploaded and not verified, and the three nodes that existed only to turn a string into a file
// (Convert Route, Text to File, Files Ready) are deleted rather than left routing nothing.
//
// WHAT THAT COSTS, and it is not nothing: README.md was the audit record that made an unattended
// application reviewable six weeks later (D12, D15) - what was selected and why, the one sentence on
// the CV that is not his own writing, both audit verdicts, the blind grade, the cost. job-ad.md was
// the posting saved verbatim, for the day the posting is gone. Both now live only in the n8n
// execution, which ages out. The folder holds the two documents and nothing about how they were made.
const FILE_KINDS = ['cv', 'letter'];

// ---------------------------------------------------------------------------------------------
// THE MD5 RUNTIME, the same bytes nodes 44 and 49 carry. See header note 1.
// ---------------------------------------------------------------------------------------------
const MD5_RUNTIME = RN.MD5_RUNTIME;

// ---------------------------------------------------------------------------------------------
// CREDENTIALS. By id, from the gitignored lane file, reused and never recreated.
//
// THE HQ CREDENTIAL HAS A DIRECTION AND THAT IS NOT A DETAIL. The token that authenticates calls
// ARRIVING at the HQ webhooks cannot be used INSIDE an HTTP Request node: n8n refuses it with "This
// credential is configured to prevent use within an HTTP Request or GraphQL node". In #34 that
// refusal reported SUCCESS twice (executions 5182 and 5240) before anybody caught it, because a
// heartbeat that never lands does not turn anything red, it just ages. So this lane uses the
// OUTGOING credential, and node 73 reads the failure back off its own item and says so in the run
// summary rather than leaving the dashboard to age in silence.
// ---------------------------------------------------------------------------------------------
const HQ_PUSH_URL = OUT.HQ_PUSH_URL;
if (typeof HQ_PUSH_URL !== 'string' || HQ_PUSH_URL.indexOf('/webhook/') === -1) {
  throw new Error('#36 _write.js: ' + rel(OUTPUT_HELPER_FILE) + ' no longer exports a usable HQ_PUSH_URL. It is read rather than typed so the two lanes cannot push to different webhooks.');
}

function hqCredential() {
  const id = LN.credentialId('hq_token',
    'It is the n8n credential "Alex HQ Token (outgoing)" (httpHeaderAuth, header X-Alex-Token).\n' +
    '  It is DELIBERATELY NOT the credential that authenticates calls ARRIVING at the HQ webhooks:\n' +
    '  n8n refuses a webhook auth credential inside an HTTP Request node, and that refusal reported\n' +
    '  SUCCESS twice in #34 before anybody noticed the dashboard had stopped moving.');
  const note = (LN.lane().credentials || {}).hq_token_note;
  if (typeof note !== 'string' || note.toLowerCase().indexOf('outgoing') === -1) {
    throw new Error(
      '#36 _write.js: lane.json credentials.hq_token_note no longer says which DIRECTION that credential\n' +
      '  is for. The id alone cannot be checked from here and the wrong one fails by reporting success,\n' +
      '  so the note is the only record of which of the two was chosen and why.'
    );
  }
  return { httpHeaderAuth: { id, name: 'Alex HQ Token (outgoing)' } };
}

// The HQ project slug, read out of the REGISTRY rather than typed, exactly as the collector lane
// does. #36 has no manifest row yet (orchestrator carry-over 1), and that is a stated condition
// rather than a defect: the row cannot be added until seat 8 writes the workflow id and seat 9
// writes the CLAUDE.md that V12 reads. So this falls back to the lane file's own name and SAYS so
// on the item, so a fallback is never mistaken for a declaration.
function hqProject() {
  const L = LN.lane();
  const manifestFile = path.join(REPO, 'system', 'manifest.json');
  if (!fs.existsSync(manifestFile)) {
    return { slug: L.name, declared: false, why: 'system/manifest.json is missing' };
  }
  const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const row = (m.projects || []).find((p) => Number(p.num) === Number(L.lane));
  if (!row) {
    return { slug: L.name, declared: false, why: 'the registry has no row for #' + L.lane + ' yet, which is orchestrator carry-over 1 and not a fault of this seat' };
  }
  return { slug: row.hq_project || row.name, declared: row.hq_project !== null && row.hq_project !== undefined, why: null };
}

// ---------------------------------------------------------------------------------------------
// A last pass over any generated source this seat ships. Two characters and one marker, the same
// three refusals seat 6 wrote, reused rather than copied.
// ---------------------------------------------------------------------------------------------
const assertGeneratedSourceIsClean = RN.assertGeneratedSourceIsClean;

// Run the cross checks that have no natural home in a single node.
assertShipExpressionAgrees();

module.exports = {
  REPO, rel,
  colLetter,
  APPLICATIONS_COLUMNS, WRITER_RUNS_COLUMNS,
  APPLICATIONS_LAST_COL, WRITER_RUNS_LAST_COL,
  jobsStatusColumn,
  APPLICATION_STATUS, APPLICATION_STATUS_RESERVED,
  APPLICATION_CHANNEL, APPLICATION_CHANNEL_RESERVED,
  APPLICATION_OUTCOME_RESERVED,
  JOBS_STATUS_SHIPPED,
  driveFileRef, driveFolderRef,
  DRIVE_FILE_VIEW_PREFIX, DRIVE_FILE_VIEW_SUFFIX, DRIVE_FOLDER_PREFIX,
  DRIVE_FILES_BASE, driveMediaUrlExpr,
  batchUpdateUrl,
  a1: LN.a1, batchGetUrl: LN.batchGetUrl,
  outcomeOf, SHIP_EXPRESSION, SHIP_EXPRESSION_BODY, SHIP_VALUE, SHIP_FIXTURES,
  evalShipExpression, assertShipExpressionAgrees,
  fallbackExpr,
  CV_BINARY_PROPERTY, LETTER_BINARY_PROPERTY, UPLOAD_BINARY_PROPERTY, FILE_KINDS,
  assertShippedPairShape,
  MD5_RUNTIME,
  hqCredential, hqProject, HQ_PUSH_URL,
  googleDriveCredential: LN.googleDriveCredential,
  googleSheetsCredential: LN.googleSheetsCredential,
  assertGeneratedSourceIsClean,
};
