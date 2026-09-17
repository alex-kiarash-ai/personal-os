'use strict';
/*
 * 51-check-renders.js - "Check Renders". R1 to R6, the last gate before a file reaches his Drive.
 *
 * =============================================================================================
 * 1. WHAT THIS NODE IS FOR, IN ONE SENTENCE.
 * =============================================================================================
 * Every check before this one read the text the system BUILT. This one reads the text a recruiter
 * will actually get, out of the PDF, and refuses anything that does not survive the round trip.
 *
 * =============================================================================================
 * 2. TWO KINDS OF FAILURE, AND THEY GET DIFFERENT SHEET ACTIONS. THIS IS A REAL DECISION.
 * =============================================================================================
 * The seat brief says a render failure is `error:render`, SYSTEMIC, the sheet row stays `new` and
 * nothing is written. That is exactly right for a render that FAILED, and this node applies it to
 * every failure of the render PATH: nothing came back, the two page counts disagree, the text layer
 * is unreadable, a term that is on the CV did not survive into the PDF, a dash appeared in the
 * extracted text. In every one of those the document is not the problem, the pipeline is, and
 * leaving the row at `new` means tomorrow morning offers the job again once the pipeline is fixed.
 *
 * A CV THAT RENDERED PERFECTLY AND IS TWO PAGES LONG IS NOT A RENDER FAILURE. D13 makes one page a
 * hard refuse, the assembler already dropped his own sentences trying to fit, and the honest answer
 * is that this application needs a person. That is `needs_review`, a HOLD, and the status is
 * written. Calling it systemic would leave the row at `new`, and tomorrow the run would pay for the
 * same read, the same research, the same selection, the same letter and the same blind grade, to
 * produce the same over long CV and refuse it again, every day, forever.
 *
 * The distinction in one line: a failure of the MACHINE leaves the row open, a verdict on the
 * DOCUMENT closes it with a reason.
 *
 * =============================================================================================
 * 3. WHY R2 COUNTS PAGES TWICE AND TREATS A DISAGREEMENT AS A FAILURE.
 * =============================================================================================
 * The render safety law, locked 2026-07-18 after a CV shipped with its last lines cut off: verify by
 * a page count assertion AND by looking at the rendered pages, never by the PDF text layer alone,
 * because CLIPPED TEXT STILL EXTRACTS. A page that hid what did not fit reports one page and parses
 * perfectly while a third of it is painted nowhere.
 *
 * So R2 holds two numbers that were arrived at independently: a regex over the raw bytes for the
 * `/Type /Page` dictionaries, and the `numpages` the PDF parser reported. If they disagree, this
 * node does not pick a winner. A page count two methods cannot confirm is not a measurement, and a
 * document is not shipped on one.
 *
 * =============================================================================================
 * 4. R5 IS THE ROUND TRIP, AND IT IS SPLIT INTO TWO DIFFERENT QUESTIONS ON PURPOSE.
 * =============================================================================================
 * D7 asks that the terms an applicant tracking system greps for appear in the EXTRACTED CV text. A
 * naive reading of that fails every honest CV, because the CV is verbatim master and the selector
 * can only choose from sentences he has already written. Demanding that every term in the posting
 * appear would be demanding keyword stuffing that the design makes impossible by construction.
 *
 * So the check asks the question that is actually answerable. Of the terms that ARE on the assembled
 * CV, every one must also be in the extracted text. That is a true round trip: a term in cv_text and
 * missing from the PDF means the RENDER lost it, which is a machine failure.
 *
 * And the vacuous case is refused rather than passed. If NOT ONE of the posting terms is on the CV,
 * the round trip has nothing to test, and a green R5 over an empty set is exactly the kind of guard
 * that passes because it tested nothing. That is a hold: a CV carrying none of the words the
 * screener searches for is an application a person should look at before it goes out.
 *
 * =============================================================================================
 * 5. THE DASH RULE COMES FROM THE SAME FILE A1 USES, NOT FROM A SECOND COPY.
 * =============================================================================================
 * scripts/lib/voice-rules.js renders its own runtime source and that whole block is baked here. Only
 * DASH_RE is used, and the rest arrives with it because the renderer emits one block: taking the
 * block whole is what guarantees R6 and A1 mean the same thing by the word dash. The sha travels
 * into the run report so the render report and the audit report can be compared without opening
 * either node.
 *
 * The handover from seat 5 is worth restating because it decides where to look when R6 fires: the
 * letter is deliberately NOT sanitised on the way in, so if a dash appears in the extracted text and
 * A1 passed, the character was introduced somewhere between the pair and the PDF, which is this
 * seat's path and nobody else's.
 *
 * =============================================================================================
 * 6. THE SHIPPING FILE NAME IS APPLIED HERE, AT THE LAST POSSIBLE MOMENT, FROM THE PAIR.
 * =============================================================================================
 * The binary that comes back from Gotenberg is named whatever Gotenberg called it. The name a
 * recruiter sees is the law (Shaheen, 2026-08-20), it was validated against the regex in
 * scripts/outputs-ledger.js by node 34 and stamped on the pair, and it is applied to the binary
 * descriptor HERE so exactly one node in this workflow decides what a shipped file is called.
 *
 * A held pair gets its measurements and no bytes. Carrying two PDFs that will never be uploaded to
 * the end of a run buys nothing and makes every later item twice the size.
 */

const path = require('path');

const LN = require('./_lane');
const S2 = require('./_stage2');
const RN = require('./_render');
const VR = require(path.join(S2.REPO, 'scripts', 'lib', 'voice-rules.js'));

const NODE_NAME = 'Check Renders';

const VOICE_RUNTIME = VR.renderRuntimeSource();

// His name, per master, READ out of the AUDIT_CFG that node 34 baked rather than derived a second
// time. That node already derives it from the masters, already refuses a lane where the derivation
// came back null, and R4 asserts the same string A4 asserts. Deriving it again here would be a
// second definition of who this document is by.
const AUDIT_CFG = LN.readBakedConst(path.join(__dirname, '34-audit-pair.js'), 'AUDIT_CFG', '{');

// The floor under R1. Measured rather than picked: a local Chromium print of a nearly empty page
// came out at 21542 bytes and a real one page CV at 35 to 45 kB. Anything under a kilobyte is not a
// rendered document. It is a WARNING and not a failure, because R2 catches a non PDF anyway (its
// byte scan finds no page dictionary and the two counts then disagree) and a hard floor on bytes is
// the kind of number that starts failing honest documents the day a font changes.
const LOW_BYTES_WARN = 1000;

// How much of a source line has to survive to prove the document made it onto the page. Squashed
// characters, so punctuation and spacing artefacts in the extracted text do not count.
const LINE_PROOF_MIN = 12;
const LINE_PROOF_MAX = 120;

function assertAgainstUpstream() {
  const merge = require('./50-render-results.js');
  const measure = require('./49-measure-pdf.js');
  const audit = require('./34-audit-pair.js');
  const build = require('./44-build-documents.js');
  if (merge.name !== 'Render Results') {
    throw new Error('Check Renders: node 50 is named ' + JSON.stringify(merge.name) + ' and this node connects from "Render Results".');
  }

  const mc = String(measure.parameters.jsCode || '');
  for (const needle of ['r.pages_bytes = pagesBytes;', 'r.pages_numpages = pagesNum;', 'r.pages_agree = agree;', 'r.pdf_text = ', 'r.pdf_bytes = buf.length;', 'r.pdf_md5 = md5Bytes(buf);']) {
    if (mc.indexOf(needle) === -1) {
      throw new Error(
        'Check Renders: Measure PDF no longer stamps ' + JSON.stringify(needle) + '.\n' +
        '  Every one of R1 to R6 reads one of those fields. A check whose input field stopped being\n' +
        '  written does not fail, it reports N/A or green over undefined, which is the failure mode this\n' +
        '  whole project keeps naming.'
      );
    }
  }
  if (mc.indexOf('PAGE_RE_SOURCE') === -1) {
    throw new Error('Check Renders: Measure PDF no longer carries the byte level page regex, so R2 would have only one page count and the render safety law says one is not enough.');
  }

  const ac = String(audit.parameters.jsCode || '');
  if (ac.indexOf('j._filenames = {') === -1) {
    throw new Error('Check Renders: Audit Pair no longer stamps _filenames, and this node applies those names to the shipped binaries rather than holding a third copy of the filename law.');
  }
  const bc = String(build.parameters.jsCode || '');
  if (bc.indexOf('j.pair_id = pairId;') === -1) {
    throw new Error('Check Renders: Build Documents no longer stamps pair_id on the pair, which is how a measured PDF finds the application it belongs to.');
  }

  // The rules engine, baked from its own renderer. R6 uses DASH_RE by name.
  if (typeof VOICE_RUNTIME !== 'string' || VOICE_RUNTIME.indexOf('const DASH_RE') === -1 || VOICE_RUNTIME.indexOf('VOICE_RULES_SHA') === -1) {
    throw new Error('Check Renders: voice-rules.js renderRuntimeSource() no longer declares DASH_RE or VOICE_RULES_SHA. R6 exists to refuse exactly the two characters that file defines, and a second copy of that definition here is how A1 and R6 drift apart.');
  }

  // The derived identity, checked here rather than assumed. A null name would make R4 assert nothing
  // and report green on a PDF of somebody else CV.
  const ids = (AUDIT_CFG && AUDIT_CFG.identity) || null;
  if (!ids || !Object.keys(ids).length) {
    throw new Error('Check Renders: could not read the derived identity out of the AUDIT_CFG baked into node 34. R4 asserts his name is in the extracted text and a missing expectation would make that check vacuous.');
  }
  for (const key of Object.keys(ids)) {
    if (!ids[key] || !ids[key].name) {
      throw new Error('Check Renders: the ' + key + ' lane has no derived name in node 34 AUDIT_CFG, so R4 would have nothing to look for in that lane PDFs and would pass on any document at all.');
    }
  }
  if (!AUDIT_CFG.filenames || !AUDIT_CFG.filenames.cv || !AUDIT_CFG.filenames.letter) {
    throw new Error('Check Renders: node 34 AUDIT_CFG carries no filenames, and this node cross checks the names it reads off each pair against the ones that node validated.');
  }

  const generated = renderJsCode();
  RN.assertGeneratedSourceIsClean(generated, NODE_NAME);
}

const LOGIC = `
// ---------------------------------------------------------------------------
// Check Renders. R1 to R6 over the text that came back out of the PDF.
// ---------------------------------------------------------------------------
const NL = String.fromCharCode(10);

// Comparison normaliser for anything read out of a PDF text layer. NFKC first, because a font
// ligature comes back as a single codepoint and fi is not the same string as U+FB01; then letters
// and digits only, because the extracted text carries its own spacing, its own line breaks and none
// of the markdown the source text is written in. Two texts that squash to the same thing are the
// same words in the same order, which is exactly the question every check below is asking.
function squash(s) {
  return String(s === undefined || s === null ? '' : s).normalize('NFKC').toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu, '');
}
// The same normalisation but KEEPING word boundaries, for matching against SOURCE text.
//
// The two are used in different directions on purpose. squash() is for the EXTRACTED side, where a
// PDF text layer inserts its own spacing and line breaks and a boundary aware match would report a
// term missing that is plainly on the page. words() is for the SOURCE side, where there are no
// artefacts and precision costs nothing, and where squash() alone would say the term Rust is on a
// CV that only ever says trusted. Tolerant where the noise is, exact where it is not.
function words(s) {
  return ' ' + String(s === undefined || s === null ? '' : s).normalize('NFKC').toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu, ' ').trim() + ' ';
}
function hasTerm(sourceText, term) {
  const t = words(term).trim();
  if (!t) return false;
  return words(sourceText).indexOf(' ' + t + ' ') !== -1;
}
function flat(s) {
  return String(s === undefined || s === null ? '' : s).replace(/\\s+/g, ' ').trim();
}
function nonEmptyLines(text) {
  return String(text === undefined || text === null ? '' : text).split(NL).map((l) => l.trim()).filter((l) => l.length > 0);
}
// The longest line with enough substance to prove anything, and the last such line. Both are used to
// prove the document reached the page: the longest one is also the most distinguishing, which is
// what makes it a check against a PDF landing on the wrong application.
function proofLines(text) {
  const lines = nonEmptyLines(text);
  let longest = null;
  let last = null;
  for (const l of lines) {
    const q = squash(l);
    if (q.length < LINE_PROOF_MIN) continue;
    if (!longest || q.length > squash(longest).length) longest = l;
    last = l;
  }
  return { longest: longest, last: last };
}
function hitsOf(text, re) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ what: m[0], at: m.index });
    if (m[0].length === 0) re.lastIndex += 1;
    if (out.length >= 20) break;
  }
  return out;
}
function quoteAround(text, at, len) {
  const from = Math.max(0, at - 50);
  const to = Math.min(text.length, at + len + 50);
  return flat(text.slice(from, to));
}

// ---------------------------------------------------------------------------
// THE SCAN. R1 to R6 over one pair and its two documents.
//
// Every check returns a class as well as a verdict, because the two classes mean different things
// to the sheet: MACHINE leaves the row at new so tomorrow offers the job again, DOCUMENT writes a
// status so the job is not paid for a second time to be refused a second time.
// ---------------------------------------------------------------------------
function checkRenders(pair, docs) {
  const checks = [];
  const key = String(pair.master_key || '');
  const ident = (IDENTITY || {})[key] || {};
  const name = ident.name || null;
  const brief = pair.brief || {};

  function add(id, scope, status, cls, why, hits) {
    checks.push({ id: id, scope: scope, status: status, class: status === 'FAIL' ? cls : null, why: why, hits: (hits || []).slice(0, 10) });
  }
  function verdict(id, scope, ok, cls, whyOk, whyBad, hits) {
    add(id, scope, ok ? 'PASS' : 'FAIL', cls, ok ? whyOk : whyBad, hits);
  }

  const cv = docs.cv || null;
  const letter = docs.letter || null;

  // --- R1. Both PDFs rendered, non zero bytes. ---
  const missing = [];
  if (!cv) missing.push('cv');
  if (!letter) missing.push('letter');
  const bad = [];
  for (const [label, d] of [['cv', cv], ['letter', letter]]) {
    if (!d) continue;
    if (d.render_state !== 'measured') bad.push({ what: label, why: d.render_state + ': ' + flat(d.render_why).slice(0, 220) });
    else if (!(Number(d.pdf_bytes) > 0)) bad.push({ what: label, why: 'rendered to ' + JSON.stringify(d.pdf_bytes) + ' bytes' });
  }
  const r1ok = missing.length === 0 && bad.length === 0;
  verdict('R1', 'both', r1ok, 'machine',
    'both documents rendered: the CV at ' + (cv ? cv.pdf_bytes : 0) + ' bytes and the letter at ' + (letter ? letter.pdf_bytes : 0) + ' bytes',
    (missing.length ? 'no render came back for: ' + missing.join(', ') + '. ' : '') +
      (bad.length ? bad.map((b) => b.what + ' ' + b.why).join(' | ') : '') +
      ' A render that did not happen is a failure of the machine and never a verdict on the application, so the sheet row stays at new and tomorrow offers this job again.',
    missing.map((m) => ({ what: m })).concat(bad));

  if (!r1ok) {
    // Nothing after this can be measured on a document that is not there. Reporting five more
    // failures over the same missing file would bury the one reason somebody needs.
    return summarise(checks, 'R1 failed, so R2 to R6 were not run: there is no rendered document to measure.');
  }

  const lowBytes = [];
  for (const [label, d] of [['cv', cv], ['letter', letter]]) if (Number(d.pdf_bytes) < LOW_BYTES_WARN) lowBytes.push(label + ' at ' + d.pdf_bytes + ' bytes');

  // --- R2 and R3. The page count, asserted two independent ways, and they must agree. ---
  function pageCheck(id, label, d, expected) {
    const b = d.pages_bytes;
    const n = d.pages_numpages;
    if (b === null || b === undefined || n === null || n === undefined) {
      add(id, label, 'FAIL', 'machine',
        'the ' + label + ' page count could not be taken both ways: the byte scan said ' + JSON.stringify(b) + ' and the pdf parser said ' + JSON.stringify(n) +
        '. The render safety law forbids trusting one of them alone, because a page that hid what did not fit reports one page and extracts perfectly while part of it is painted nowhere.',
        [{ what: 'pages_bytes', value: b }, { what: 'pages_numpages', value: n }]);
      return false;
    }
    if (b !== n) {
      add(id, label, 'FAIL', 'machine',
        'THE TWO PAGE COUNTS DISAGREE on the ' + label + ': the byte scan for page dictionaries says ' + b + ' and the pdf parser says ' + n + '. ' +
        'This is refused rather than resolved. If the byte scan says zero while the parser looks healthy, the PDF writer has started compressing its object dictionaries and the byte method needs REPLACING, not loosening.',
        [{ what: 'pages_bytes', value: b }, { what: 'pages_numpages', value: n }]);
      return false;
    }
    if (b !== expected) {
      add(id, label, 'FAIL', 'document',
        'the ' + label + ' is ' + b + ' page(s) and it has to be ' + expected + ', counted the same by both methods. ' +
        (label === 'cv'
          ? 'D13 makes one page a HARD REFUSE. Assemble CV already dropped blocks off his own drop order trying to fit, so by the time it reaches here the only honest answer is that this application needs a person. It is held with a reason rather than left open, because leaving it open would buy the same five model calls again tomorrow to refuse the same CV again.'
          : 'A letter is bounded at 280 words upstream, so a letter over one page means the render is laying it out differently from what was measured.'),
        [{ what: 'pages', value: b }]);
      return false;
    }
    add(id, label, 'PASS', null, 'exactly ' + b + ' page, counted two independent ways and agreed: a regex for the page dictionaries over the raw bytes, and the pdf parser own numpages', []);
    return true;
  }
  pageCheck('R2', 'cv', cv, 1);
  pageCheck('R3', 'letter', letter, 1);

  // --- R4. The text layer parses, carries his name, and carries the document. ---
  const r4legs = [];
  function leg(id, status, why) { r4legs.push({ leg: id, status: status, why: why }); }
  for (const [label, d, source] of [['cv', cv, pair.cv_text], ['letter', letter, pair.letter_text]]) {
    const text = String(d.pdf_text === undefined || d.pdf_text === null ? '' : d.pdf_text);
    if (!text.length) {
      leg(label + '.text', 'FAIL', 'the ' + label + ' PDF has NO TEXT LAYER. It looks perfect to a human and it is invisible to every applicant tracking system there is.');
      continue;
    }
    leg(label + '.text', 'PASS', text.length + ' characters of extracted text');
    const q = squash(text);
    leg(label + '.name', !name ? 'N/A' : (q.indexOf(squash(name)) !== -1 ? 'PASS' : 'FAIL'),
      !name ? 'no name could be derived from the master, so there is nothing to assert' : 'the extracted ' + label + ' text carries ' + JSON.stringify(name));
    const p = proofLines(source);
    const longest = p.longest ? squash(p.longest).slice(0, LINE_PROOF_MAX) : null;
    const last = p.last ? squash(p.last).slice(0, LINE_PROOF_MAX) : null;
    leg(label + '.body', !longest ? 'N/A' : (q.indexOf(longest) !== -1 ? 'PASS' : 'FAIL'),
      !longest ? 'no line of the source is long enough to prove anything with' : 'the longest line of the source survived into the PDF, which is also the check that this PDF is THIS application and not another one');
    leg(label + '.tail', !last ? 'N/A' : (q.indexOf(last) !== -1 ? 'PASS' : 'FAIL'),
      !last ? 'no last line of the source is long enough to prove anything with' : 'the last line of the source survived into the PDF, so nothing was lost off the end');
  }
  const r4bad = r4legs.filter((l) => l.status === 'FAIL');
  verdict('R4', 'both', r4bad.length === 0, 'machine',
    'both text layers parse, both carry his name, and the longest and last lines of both sources came back out of the PDFs (' + r4legs.filter((l) => l.status === 'PASS').length + ' legs checked, ' + r4legs.filter((l) => l.status === 'N/A').length + ' not assertable)',
    r4bad.length + ' leg(s) failed: ' + r4bad.map((l) => l.leg).join(', ') + '. Text that went into the render and did not come out of it is the render path losing content, never the writing.',
    r4legs);

  // --- R5. The D7 round trip. See header note 4 for why it is two questions. ---
  const terms = Array.isArray(brief.ats_terms) ? brief.ats_terms.filter((t) => typeof t === 'string' && t.trim()) : [];
  const cvExtract = squash(cv.pdf_text);
  const onCv = terms.filter((t) => hasTerm(pair.cv_text, t));
  const lost = onCv.filter((t) => cvExtract.indexOf(squash(t)) === -1);
  if (!terms.length) {
    add('R5', 'cv', 'FAIL', 'document',
      'the posting brief carries no ATS terms at all, so the round trip has nothing to look for. Parse Job Brief holds a pair for exactly this, so a pair arriving here without them went round a path nobody built.', []);
  } else if (!onCv.length) {
    add('R5', 'cv', 'FAIL', 'document',
      'NOT ONE of the ' + terms.length + ' term(s) the reader said an applicant tracking system would grep for is on the assembled CV: ' + JSON.stringify(terms.slice(0, 12)) +
      '. The round trip cannot be tested over an empty set, and a green check over nothing is worse than no check. This is held for a person rather than reported as a machine failure: the CV is verbatim master by construction, so the answer is either a different selection or a job his masters genuinely do not speak to.',
      terms.slice(0, 12).map((t) => ({ what: t })));
  } else {
    verdict('R5', 'cv', lost.length === 0, 'machine',
      onCv.length + ' of ' + terms.length + ' posting term(s) are on the CV and every one of them came back out of the PDF: ' + JSON.stringify(onCv.slice(0, 12)),
      lost.length + ' term(s) are on the assembled CV and are NOT in the extracted PDF text: ' + JSON.stringify(lost) +
      '. The words went in and did not come out, so this is the render path losing content rather than a bad selection. A CV a screener cannot grep is a CV that was never read.',
      lost.map((t) => ({ what: t })));
  }

  // --- R6. Zero dashes survive, in either extracted text. ---
  const dashHits = [];
  for (const [label, d] of [['cv', cv], ['letter', letter]]) {
    const text = String(d.pdf_text || '');
    for (const h of hitsOf(text, DASH_RE)) {
      dashHits.push({ what: label, character: h.what.charCodeAt(0), quote: quoteAround(text, h.at, 1) });
    }
  }
  verdict('R6', 'both', dashHits.length === 0, 'machine',
    'no en dash and no em dash survived into either extracted text, checked with the same DASH_RE that A1 uses, out of scripts/lib/voice-rules.js',
    dashHits.length + ' dash character(s) are in the extracted text: ' + dashHits.map((h) => h.what + ' ' + JSON.stringify(h.quote.slice(0, 80))).join(' | ') +
    '. Shaheen, 2026-08-20: NEVER AGAIN, both characters. The letter is deliberately not sanitised on the way in, so if A1 passed this pair the character was introduced between the pair and the PDF, which is the render path and nothing else.',
    dashHits);

  return summarise(checks, null, lowBytes);
}

function summarise(checks, note, lowBytes) {
  const failed = checks.filter((c) => c.status === 'FAIL');
  const machine = failed.filter((c) => c.class === 'machine');
  const document = failed.filter((c) => c.class === 'document');
  return {
    pass: failed.length === 0,
    checks: checks,
    failed: failed.map((c) => c.id),
    failed_machine: machine.map((c) => c.id),
    failed_document: document.map((c) => c.id),
    note: note || null,
    low_bytes: lowBytes && lowBytes.length ? lowBytes : null,
    voice_rules_sha: VOICE_RULES_SHA,
    rule: 'a failure of the render PATH leaves the sheet row at new, because a machine that was broken is never a verdict on an application. A verdict on the DOCUMENT, which is a CV that rendered perfectly and is two pages long, writes a status, because leaving it open would buy the same five model calls again tomorrow to refuse the same CV again.',
  };
}

// --- the run ---------------------------------------------------------------------
const inputItems = $input.all();
if (!inputItems.length) {
  throw new Error('Check Renders: Render Results delivered no items at all. Build Documents emits at least its own stage report on every path and it is carried down the false side of Render Route, so an empty input means the merge did not run.');
}

const pairs = [];
const carried = [];
const renderItems = [];
for (const it of inputItems) {
  const j = it.json || {};
  if (j._kind === 'render') { renderItems.push({ json: j, binary: it.binary }); continue; }
  if (j._kind === 'pair') { pairs.push({ json: Object.assign({}, j), binary: it.binary }); continue; }
  carried.push(Object.assign({}, j));
}

// Group the renders by the application they belong to. A duplicate is refused rather than resolved:
// two CVs for one job means one of them is somebody else document.
const byPair = {};
const orphans = [];
const duplicates = [];
for (const r of renderItems) {
  const id = String(r.json.pair_id || '');
  const doc = String(r.json.doc || '');
  if (!id || (doc !== 'cv' && doc !== 'letter')) { orphans.push({ pair_id: id, doc: doc, why: 'the render item carries no usable pair_id and doc' }); continue; }
  if (!byPair[id]) byPair[id] = {};
  if (byPair[id][doc]) { duplicates.push({ pair_id: id, doc: doc }); continue; }
  byPair[id][doc] = r;
}

const out = [];
const stats = { pairs: 0, shipped: 0, held_document: 0, error_machine: 0, skipped: 0, documents_checked: 0 };
const skipReasons = {};
const failCounts = {};
const warnings = [];
const seenPairIds = {};

function markMachine(j, why) {
  j._status = 'error:render';
  j._status_class = 'systemic';
  j._sheet_action = 'leave_untouched';
  j._status_why = why;
  j._call_now = false;
  stats.error_machine += 1;
}
function markDocument(j, why) {
  j._status = 'needs_review';
  j._status_class = 'hold';
  j._sheet_action = 'write_status';
  j._status_why = why;
  j._call_now = false;
  stats.held_document += 1;
}

for (const p of pairs) {
  const j = p.json;
  j._call_now = false;

  if (j._kind !== 'pair') { out.push({ json: j }); continue; }
  stats.pairs += 1;
  if (j._status) {
    stats.skipped += 1;
    skipReasons[j._status] = (skipReasons[j._status] || 0) + 1;
    out.push({ json: j });
    continue;
  }
  if (j._ready_to_ship !== true) {
    markMachine(j, 'the pair reached the last gate with no status and no _ready_to_ship flag, so nothing upstream decided it should ship and nothing here will decide for it.');
    out.push({ json: j });
    continue;
  }

  const id = String(j.pair_id || '');
  seenPairIds[id] = true;
  const docs = byPair[id] || {};
  const cvR = docs.cv ? docs.cv.json : null;
  const letterR = docs.letter ? docs.letter.json : null;
  if (cvR) stats.documents_checked += 1;
  if (letterR) stats.documents_checked += 1;

  const result = checkRenders(j, { cv: cvR, letter: letterR });
  j.render_check = result;
  for (const cid of result.failed) failCounts[cid] = (failCounts[cid] || 0) + 1;

  // The measurements stay on the pair whatever the verdict, so a refusal can be read afterwards
  // without opening an execution.
  j.cv_render = cvR ? { bytes: cvR.pdf_bytes, md5: cvR.pdf_md5, pages_bytes: cvR.pages_bytes, pages_numpages: cvR.pages_numpages, text_chars: cvR.pdf_text_chars, state: cvR.render_state, info: cvR.pdf_info || null } : null;
  j.letter_render = letterR ? { bytes: letterR.pdf_bytes, md5: letterR.pdf_md5, pages_bytes: letterR.pages_bytes, pages_numpages: letterR.pages_numpages, text_chars: letterR.pdf_text_chars, state: letterR.render_state, info: letterR.pdf_info || null } : null;

  if (!result.pass) {
    const first = result.checks.filter((c) => c.id === result.failed[0])[0] || {};
    const why = 'the rendered documents failed ' + result.failed.length + ' check(s): ' + result.failed.join(', ') + '. ' + first.why;
    if (result.failed_machine.length) markMachine(j, why);
    else markDocument(j, why);
    out.push({ json: j });
    continue;
  }

  // PASS. Attach the two PDFs under names seat 7 can address, and apply the shipping file name from
  // the pair at the last possible moment. See header note 6.
  const fn = j._filenames || {};
  const binary = {};
  binary.cv_pdf = Object.assign({}, docs.cv.binary && docs.cv.binary[BINARY_PROPERTY] ? docs.cv.binary[BINARY_PROPERTY] : {}, {
    fileName: fn.cv, fileExtension: 'pdf', mimeType: 'application/pdf',
  });
  binary.letter_pdf = Object.assign({}, docs.letter.binary && docs.letter.binary[BINARY_PROPERTY] ? docs.letter.binary[BINARY_PROPERTY] : {}, {
    fileName: fn.letter, fileExtension: 'pdf', mimeType: 'application/pdf',
  });
  j._documents = Object.assign({}, j._documents || {}, {
    files: [
      { name: fn.cv, kind: 'cv', from: 'render', binary_property: 'cv_pdf', md5: cvR.pdf_md5, bytes: cvR.pdf_bytes },
      { name: fn.letter, kind: 'letter', from: 'render', binary_property: 'letter_pdf', md5: letterR.pdf_md5, bytes: letterR.pdf_bytes },
    ],
    upload_note: 'TWO files, one folder, since 2026-09-17: README.md and job-ad.md were removed on Shaheen instruction and both PDFs are all that is left. They are on the binary properties named above and their digests are over the exact bytes measured here. Upload both unchanged and read both back: a byte added on the way out changes a digest and the read back then fails on a file that uploaded perfectly.',
  });
  stats.shipped += 1;
  out.push({ json: j, binary: binary });
}

// --- renders nobody claimed ----------------------------------------------------
for (const id of Object.keys(byPair)) {
  if (seenPairIds[id]) continue;
  for (const doc of Object.keys(byPair[id])) orphans.push({ pair_id: id, doc: doc, why: 'a document was rendered for an application that is not in this stream' });
}

if (orphans.length) {
  warnings.push(orphans.length + ' rendered document(s) could not be matched to an application in this run: ' + JSON.stringify(orphans.slice(0, 6)) + '. Nothing was uploaded for them. A PDF with no application is a rendering nobody asked for, and attaching it to the nearest pair is how a cover letter reaches the wrong company.');
}
if (duplicates.length) {
  warnings.push(duplicates.length + ' duplicate render(s) arrived for an application that already had that document: ' + JSON.stringify(duplicates.slice(0, 6)) + '. The first was kept and the rest refused, because two CVs for one job means one of them belongs to a different job.');
}
if (stats.error_machine > 0) {
  warnings.push(stats.error_machine + ' pair(s) failed the render path and are SYSTEMIC: their sheet rows stay at new, so tomorrow morning offers those jobs again once the path is fixed. Every one of them had already been paid for through the blind grade, which is why the render is the one call in this workflow that retries.');
}
if (stats.held_document > 0) {
  warnings.push(stats.held_document + ' pair(s) rendered cleanly and were refused on the DOCUMENT: a CV that does not fit one page is D13, a hard refuse, and a CV carrying none of the terms the screener greps for needs a person. Their statuses are written rather than left open, so the same five model calls are not spent again tomorrow to reach the same refusal.');
}
if (stats.shipped > 0) {
  warnings.push(stats.shipped + ' pair(s) passed R1 to R6 and carry their PDFs. Nothing here proved the documents LOOK right, only that they measure right: the page count was taken two ways and agreed, the text came back out, the screener terms survived and no dash did.');
}

const report = {
  _kind: 'stage_report',
  stage: 'check_renders',
  counts: stats,
  failures_by_check: failCounts,
  skipped_by_status: skipReasons,
  orphan_renders: orphans.slice(0, 12),
  duplicate_renders: duplicates.slice(0, 12),
  checks_run: 'R1 both PDFs rendered with non zero bytes; R2 the CV is exactly one page, counted two independent ways that must agree; R3 the letter is one page, the same way; R4 both text layers parse, carry his name and carry the longest and last lines of their source; R5 every posting term that is on the CV survived into the extracted PDF text, and the case where NO term is on the CV is refused rather than passed over an empty set; R6 zero en dashes and zero em dashes survived into either extracted text.',
  classes: 'a failure of the render PATH is error:render, systemic, and the sheet row stays at new. A verdict on the DOCUMENT is needs_review and the status is written. The difference matters because a systemic mark on a deterministic refusal would buy the same five model calls again every morning to reach the same answer.',
  voice_rules_sha: VOICE_RULES_SHA,
  warnings: warnings,
  _call_now: false,
  site_fetch_url: '',
  ad_fetch_url: '',
};

const finalItems = out.map((o) => (o.binary ? { json: o.json, binary: o.binary, pairedItem: { item: 0 } } : { json: o.json, pairedItem: { item: 0 } }));
for (const c of carried) finalItems.push({ json: c, pairedItem: { item: 0 } });
finalItems.push({ json: report, pairedItem: { item: 0 } });
return finalItems;
`;

function renderJsCode() {
  return [
    '// GENERATED at build time from work/36-job-application-writer/nodes/51-check-renders.js.',
    '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
    VOICE_RUNTIME,
    'const IDENTITY = ' + JSON.stringify(AUDIT_CFG.identity) + ';',
    'const BINARY_PROPERTY = ' + JSON.stringify('data') + ';',
    'const README_FILENAME = ' + JSON.stringify(RN.README_FILENAME) + ';',
    'const JOB_AD_FILENAME = ' + JSON.stringify(RN.JOB_AD_FILENAME) + ';',
    'const LOW_BYTES_WARN = ' + JSON.stringify(LOW_BYTES_WARN) + ';',
    'const LINE_PROOF_MIN = ' + JSON.stringify(LINE_PROOF_MIN) + ';',
    'const LINE_PROOF_MAX = ' + JSON.stringify(LINE_PROOF_MAX) + ';',
    LOGIC,
  ].join('\n');
}

assertAgainstUpstream();

module.exports = {
  name: NODE_NAME,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [12740, 100],
  connectFrom: 'Render Results',
  notes: 'R1 to R6, the last gate before a file reaches his Drive. Maps each measured PDF back to its application by pair_id and doc, refusing a duplicate and never attaching an orphan. R2 asserts the CV page count TWO independent ways and treats a disagreement as a failure rather than picking a winner, because the render safety law says a count from the text layer alone cannot be trusted: clipped text still extracts. A failure of the render PATH is systemic and leaves the sheet row at new so tomorrow offers the job again; a CV that rendered perfectly and is two pages long is a verdict on the DOCUMENT, is held with a written status, and is not paid for a second time tomorrow to be refused a second time. A passing pair gets its two PDFs attached under the shipping names the pair carries, applied here at the last possible moment so exactly one node decides what a recruiter sees a file called.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: renderJsCode(),
  },
};
