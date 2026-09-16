'use strict';
/*
 * 38-audit-pair-final.js - "Audit Pair Final". Takes the rewrite apart with the SAME extractor and
 * judges it with the SAME scan. A failure here is the end of the line: needs_review, with reasons.
 *
 * =============================================================================================
 * 1. THE SAME SCAN MEANS THE SAME BYTES, NOT THE SAME INTENTION.
 * =============================================================================================
 * The seat brief asks for a shared template rather than a second copy, and the honest way to do that
 * on a box that cannot require a file is to LIFT the source at build time:
 *
 *   extractLetter()  lifted out of 33-parse-letter.js       the marker extraction, sanitiser free
 *   sentenceBounds() lifted out of 34-audit-pair.js         the sentence a hit sits in
 *   negatedAround()  lifted out of 34-audit-pair.js         is that hit a claim or a denial of one
 *   numberSources()  lifted out of 34-audit-pair.js         which text on a pair licenses a figure
 *   numberAllowlist() lifted out of 34-audit-pair.js        that text turned into token to label
 *   auditPair()      lifted out of 34-audit-pair.js         A1 to A18
 *   AUDIT_CFG        the exact baked line out of 34         the approved figures, the derived
 *                                                           identity, the ceiling, the filenames
 *
 * The voice rules and the number tokeniser are DERIVED here from the same functions node 34 derives
 * them from, and then asserted to be byte identical to what node 34 actually baked. Two independent
 * derivations that are proved equal is a stronger guarantee than one copy, because the assertion
 * fails loudly the day the two stop agreeing.
 *
 * If any of those lifts or assertions fails, this build stops by name. That is the point: a second
 * pass that is quietly more lenient than the first would let through exactly the letters the first
 * pass exists to catch, and the run would look healthier than it is.
 *
 * =============================================================================================
 * 2. THERE IS NO SECOND REWRITE, AND THE GRAPH IS WHY.
 * =============================================================================================
 * One reasoned rewrite (defect 7). There is no edge from this node back to Rewrite Route, so a
 * second attempt is not refused by a counter here, it is impossible in the shape. A budget held in a
 * counter is a budget somebody raises; a graph with no loop is not.
 *
 * A pair that still fails after its rewrite goes to needs_review carrying BOTH audits, so a human
 * can see what was wrong, what was asked for, and what came back. That is the difference between a
 * hold somebody can act on and a hold somebody has to reconstruct.
 *
 * =============================================================================================
 * 3. MOST PAIRS PASS THROUGH THIS NODE UNTOUCHED, AND THAT IS THE HEALTHY STATE.
 * =============================================================================================
 * A letter that passed at node 34 arrives on the carry branch with its audit already attached. It is
 * not re-scanned, because re-scanning identical text with identical rules can only produce the same
 * answer or a bug. It is passed through exactly as it is.
 */

const path = require('path');

const LN = require('./_lane');
const S2 = require('./_stage2');
const VR = require(path.join(S2.REPO, 'scripts', 'lib', 'voice-rules.js'));

const NODE_NAME = 'Audit Pair Final';
const N14 = './14-parse-job-brief.js';
const N33 = './33-parse-letter.js';
const N34 = './34-audit-pair.js';

const MODEL = LN.STAGE_MODELS.rewrite;
const PRICE = LN.prices(MODEL);

const SYSTEMIC_KINDS = ['auth', 'credits', 'rate_limit', 'upstream', 'transport', 'not_found', 'too_large', 'pairing', 'node_did_not_run', 'bad_request'];

// ---------------------------------------------------------------------------------------------
// LIFTING A WHOLE BAKED CONSTANT LINE out of another node's GENERATED source.
//
// bakedFunction() does this for functions. AUDIT_CFG is a one line constant carrying the approved
// figures, the identity derived from the masters, the one page ceiling and the two filenames, and
// re-deriving it here would mean a second copy of every derivation in node 34. The line is a single
// line by construction (asciiJson emits no newlines), so the cut is unambiguous.
// ---------------------------------------------------------------------------------------------
// A sentinel the caller passes instead of a node file when the source is already in hand (this
// node's own rendered blocks, which are not on disk yet at the moment they need comparing).
const N38_SELF_MARKER = '<this node own rendered source>';

function bakedConstLine(nodeRelFile, name, proofNeedle, sourceOverride) {
  const src = sourceOverride !== undefined && sourceOverride !== null
    ? String(sourceOverride)
    : String((require(nodeRelFile).parameters || {}).jsCode || '');
  const marker = '\nconst ' + name + ' = ';
  const at = src.indexOf(marker);
  if (at === -1) {
    throw new Error(
      'Audit Pair Final: ' + nodeRelFile + ' no longer bakes a constant called ' + JSON.stringify(name) + '.\n' +
      '  It is LIFTED rather than re-derived so the first pass and the final pass cannot hold two\n' +
      '  different ideas of what an approved figure, a ceiling or a filename is. If it legitimately\n' +
      '  moved, decide where it lives now and change both ends in the same edit.'
    );
  }
  const end = src.indexOf('\n', at + 1);
  const line = src.slice(at + 1, end === -1 ? src.length : end);
  if (proofNeedle && line.indexOf(proofNeedle) === -1) {
    throw new Error('Audit Pair Final: the ' + name + ' line lifted out of ' + nodeRelFile + ' no longer contains ' + JSON.stringify(proofNeedle) + ', so it is not the constant this node meant to reuse.');
  }
  try { new Function(line); } catch (e) {
    throw new Error('Audit Pair Final: the lifted ' + name + ' line does not parse on its own (' + e.message + '). The cut is wrong, not the source.');
  }
  return line;
}

const AUDIT_CFG_LINE = bakedConstLine(N34, 'AUDIT_CFG', 'approved_numbers');

// Derived here, then PROVED identical to what node 34 baked. See header note 1.
const VOICE_RUNTIME = VR.renderRuntimeSource();
function bakedVoiceFunction(name, proofNeedle) {
  const fn = VR[name];
  if (typeof fn !== 'function') {
    throw new Error('Audit Pair Final: scripts/lib/voice-rules.js no longer exports ' + name + '().');
  }
  const src = fn.toString();
  if (src.indexOf(proofNeedle) === -1) {
    throw new Error('Audit Pair Final: voice-rules.js ' + name + '() no longer contains ' + JSON.stringify(proofNeedle) + '.');
  }
  return 'function ' + name + src.slice(src.indexOf('(')) + ';';
}
const NUMBER_RUNTIME = [
  bakedVoiceFunction('normalise', '\\u2018'),
  bakedVoiceFunction('wordCount', 'split(/\\s+/).length'),
  bakedVoiceFunction('extractNumbers', 'thousands separators'),
].join('\n');

// sentenceBounds(), negatedAround(), numberSources() and numberAllowlist() used to live INSIDE
// auditPair(), so lifting the scan carried them along for free. All four were hoisted to column zero
// in node 34 on 2026-09-16 so the LETTER EVAL could lift them too and stop re-implementing the claim
// rule against voice-rules.js and the A8 source list against its own two-entry copy, which is how
// the eval and the lane genuinely diverged twice. The cost of that hoist is this: auditPair() now
// calls FOUR free names, and they have to be lifted BY NAME alongside it or the final pass throws a
// ReferenceError on the first letter that mentions a banned technology or carries a figure. Named
// here so the coupling is written down rather than discovered in an execution log.
const LIFTED = [
  S2.bakedFunction(N14, 'costOf', 'cache_creation_input_tokens'),
  S2.bakedFunction(N14, 'classify', 'invalid_request_error'),
  S2.bakedFunction(N33, 'extractLetter', 'The letter is defined as what sits between the open marker and whichever of those two comes next'),
  S2.bakedFunction(N34, 'sentenceBounds', 'declared locally rather than read off'),
  S2.bakedFunction(N34, 'negatedAround', 'ONE implementation, two behaviours'),
  S2.bakedFunction(N34, 'numberSources', 'THE SINGLE DEFINITION of which text'),
  S2.bakedFunction(N34, 'numberAllowlist', 'One token to one PROVENANCE LABEL'),
  S2.bakedFunction(N34, 'auditPair', 'a CV failure is NEVER rewritten'),
].join('\n');

function readWriterConst(name) {
  const src = String(require('./29-build-writer-request.js').parameters.jsCode || '');
  const m = new RegExp('\\nconst ' + name + ' = (\\"[^\\"]*\\");').exec(src);
  if (!m) throw new Error('Audit Pair Final: could not read ' + name + ' out of the generated Build Writer Request source.');
  return JSON.parse(m[1]);
}
const LETTER_OPEN = readWriterConst('LETTER_OPEN');
const LETTER_CLOSE = readWriterConst('LETTER_CLOSE');
const SCREEN_OPEN = readWriterConst('SCREEN_OPEN');

const RAW_ANSWER_MAX = 8000;
const SCREEN_MAX = 2000;
const SCREEN_LINES_MAX = 12;
const SCREEN_SENTENCE_MAX = 400;

function assertAgainstUpstream() {
  const merge = require('./37-rewrite-results.js');
  const route = require('./35-rewrite-route.js');
  const call = require('./36-rewrite-letter.js');
  const audit = require(N34);
  if (merge.name !== 'Rewrite Results') throw new Error('Audit Pair Final: node 37 is named ' + JSON.stringify(merge.name) + ' and this node connects from "Rewrite Results".');
  if (route.name !== 'Rewrite Route') throw new Error('Audit Pair Final: node 35 is named ' + JSON.stringify(route.name) + ' and this node reads $(\'Rewrite Route\') output 0 for the authoritative sent order.');
  if (call.name !== 'Rewrite Letter') throw new Error('Audit Pair Final: node 36 is named ' + JSON.stringify(call.name) + ' and this node reads $(\'Rewrite Letter\') for the responses.');
  if (audit.name !== 'Audit Pair') throw new Error('Audit Pair Final: node 34 is named ' + JSON.stringify(audit.name) + ' and this node lifts auditPair() and AUDIT_CFG out of it.');

  const resp = call.parameters.options && call.parameters.options.response && call.parameters.options.response.response;
  if (!resp || resp.fullResponse !== true || resp.neverError !== true) {
    throw new Error('Audit Pair Final: Rewrite Letter no longer sets fullResponse AND neverError, so a 4xx would arrive with no status code.');
  }
  if (merge.parameters.numberInputs !== 2) {
    throw new Error('Audit Pair Final: Rewrite Results declares numberInputs ' + JSON.stringify(merge.parameters.numberInputs) + '. This node expects the two-input join.');
  }

  // THE SAME BYTES, RULE BY RULE. Two independent derivations, each compared to the exact LINE node
  // 34 baked.
  //
  // The first version of this check asked whether node 34's source CONTAINED this node's rendered
  // block, and a substring test is not an equality test: a node 34 that baked
  // `renderRuntimeSource() + something` still contains it, so the check passed on a mutation that
  // had genuinely drifted the two. The offline suite caught that by mutating node 34 and getting a
  // green. Comparing the individual constant lines is exact for the thing that matters, which is the
  // RULES: what an AI tell is, what a dash is, which pronouns are forbidden, which claims are banned
  // and where the word band sits.
  const auditSrc = String(audit.parameters.jsCode || '');
  for (const name of ['VOICE_RULES_SHA', 'TELLS', 'PRONOUN_RE', 'DASH_RE', 'CLAIMS', 'BAND']) {
    const mine = bakedConstLine(N38_SELF_MARKER, name, null, VOICE_RUNTIME + '\n' + NUMBER_RUNTIME);
    const theirs = bakedConstLine(N34, name, null, auditSrc);
    if (mine !== theirs) {
      throw new Error(
        'Audit Pair Final: the baked rule ' + name + ' is NOT byte identical to the one Audit Pair baked.\n' +
        '  The final pass would then be more lenient or more strict than the first, which means a letter\n' +
        '  can fail a check its rewrite was never told about, or pass one the first pass enforced.\n' +
        '  here:  ' + mine.slice(0, 120) + '\n' +
        '  there: ' + theirs.slice(0, 120) + '\n' +
        '  Both nodes build this from scripts/lib/voice-rules.js renderRuntimeSource(), so a difference\n' +
        '  means one of them is stale or one of them is post processing it: rebuild both in the same run.'
      );
    }
  }
  if (auditSrc.indexOf(NUMBER_RUNTIME) === -1) {
    throw new Error('Audit Pair Final: the number tokeniser this node bakes is not byte identical to the one Audit Pair baked, so A8 could accept a figure on one pass and refuse it on the other.');
  }
  if (auditSrc.indexOf(AUDIT_CFG_LINE) === -1) {
    throw new Error('Audit Pair Final: the lifted AUDIT_CFG line is not present in the Audit Pair source it was lifted from. The cut is wrong.');
  }

  // The sanitiser must still be absent from the extractor being lifted.
  const parseSrc = String(require(N33).parameters.jsCode || '');
  if (parseSrc.indexOf('stripDashes') !== -1) {
    throw new Error('Audit Pair Final: Parse Letter has acquired a dash sanitiser, and this node lifts its extractor. A repaired dash would make a rewritten letter ship looking clean and hide the slip from the blind grader.');
  }

  const generated = renderJsCode();
  if (generated.indexOf(String.fromCharCode(8212)) !== -1 || generated.indexOf(String.fromCharCode(8211)) !== -1) {
    throw new Error('Audit Pair Final: the generated source contains an em dash or an en dash, which is the exact character this node exists to refuse.');
  }
  if (NODE_NAME === 'Build Writer Request') {
    throw new Error('Audit Pair Final: this node must not be named "Build Writer Request". That name is the voice-sync enrolment key and belongs to the letter writer alone.');
  }
  if (generated.indexOf('SOUL_VOICE_START') !== -1) {
    throw new Error('Audit Pair Final: the generated source carries a soul voice block. This node checks prose against rules; it does not write any.');
  }
}

const LOGIC = `
// ---------------------------------------------------------------------------
// Audit Pair Final. Same extractor, same scan, no second rewrite.
// ---------------------------------------------------------------------------
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);

${LIFTED}

function round6(n) { return Math.round(n * 1e6) / 1e6; }

// --- 1. pairing -----------------------------------------------------------------
let called = [];
try {
  called = $('Rewrite Route').all(0).map((i) => i.json);
} catch (e) {
  called = [];
}
let responses = null;
let responsesWhy = null;
try {
  responses = $('Rewrite Letter').all();
} catch (e) {
  responses = null;
  responsesWhy = e.message;
}
const carried = $input.all().map((i) => i.json).filter((j) => j && j._kind !== undefined);

let pairing = 'ok';
let pairingWhy = null;
const warnings = [];

if (responses === null) {
  if (called.length > 0) {
    pairing = 'no_responses';
    pairingWhy = 'Rewrite Route sent ' + called.length + ' pair(s) and the Rewrite Letter node produced no run data (' + (responsesWhy || 'unknown') +
      '). The node did not execute, so every affected pair keeps its first draft and its first audit and is written NOWHERE.';
  }
} else if (responses.length !== called.length) {
  pairing = 'mismatch';
  pairingWhy = 'Rewrite Route sent ' + called.length + ' pair(s) and Rewrite Letter returned ' + responses.length +
    '. Refusing to guess an alignment: one rewritten letter attached to another job is a fluent application to the wrong company.';
}
if (pairing === 'ok' && responses !== null) {
  for (let i = 0; i < responses.length; i += 1) {
    const pi = responses[i] && responses[i].pairedItem;
    const idx = pi && typeof pi === 'object' && !Array.isArray(pi) ? pi.item : (Array.isArray(pi) && pi.length ? pi[0].item : undefined);
    if (idx !== undefined && Number(idx) !== i) {
      pairing = 'mismatch';
      pairingWhy = 'response ' + i + ' carries pairedItem ' + JSON.stringify(idx) + ', so the responses are not in the order they were sent.';
      break;
    }
  }
}

// --- 2. the rewritten pairs -----------------------------------------------------
const outPairs = [];
const usageTotals = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cost_usd: 0 };
const errorKinds = {};
const statusCodes = {};
const holdKinds = {};
const failCounts = {};
const stats = { rewritten: 0, fixed: 0, still_failing: 0, errored: 0, held: 0, passed_first_time: 0, carried: 0 };
let cacheReads = 0;

function markError(pair, kind, why) {
  pair._status = 'error:' + kind;
  pair._status_why = why;
  pair._status_class = SYSTEMIC_KINDS.indexOf(kind) !== -1 ? 'systemic' : 'row';
  pair._sheet_action = 'leave_untouched';
  errorKinds[kind] = (errorKinds[kind] || 0) + 1;
  stats.errored += 1;
}
function markHold(pair, kind, why) {
  pair._status = 'needs_review';
  pair._status_why = why;
  pair._status_class = 'hold';
  pair._sheet_action = 'write_status';
  holdKinds[kind] = (holdKinds[kind] || 0) + 1;
  stats.held += 1;
}

for (let i = 0; i < called.length; i += 1) {
  const pair = Object.assign({}, called[i]);
  outPairs.push(pair);
  stats.rewritten += 1;
  pair.letter_audit_first = pair.letter_audit || null;

  // FALSE FIRST, ON EVERY PATH. The pair arrived with _call_now true, because that is what routed
  // it to the rewrite. Nothing after this node routes on a rewrite, so leaving the stale true would
  // be an item claiming it is owed a paid call it can no longer receive. Build Grade Request
  // re-derives the flag from _status anyway, which is why this was not a live leak, but an item that
  // says the wrong thing about itself is how the next reader builds the wrong route.
  pair._call_now = false;

  if (pairing === 'mismatch') { markError(pair, 'pairing', pairingWhy); continue; }
  if (pairing === 'no_responses') { markError(pair, 'node_did_not_run', pairingWhy); continue; }

  const item = responses[i] || {};
  const j = item.json || {};

  if (j.error !== undefined && j.statusCode === undefined) {
    markError(pair, 'transport', 'the rewrite request never completed: ' + String(typeof j.error === 'string' ? j.error : (j.error && j.error.message) || JSON.stringify(j.error)).slice(0, 240));
    continue;
  }
  const status = Number(j.statusCode);
  const body = j.body;
  if (!isFinite(status)) {
    markError(pair, 'transport', 'the response carried no statusCode. fullResponse is set on Rewrite Letter, so a missing status means the item is not an HTTP response at all.');
    continue;
  }
  statusCodes[String(status)] = (statusCodes[String(status)] || 0) + 1;
  if (status < 200 || status >= 300) {
    const c = classify(status, body);
    markError(pair, c.kind, c.why);
    continue;
  }

  const usage = costOf(body && body.usage);
  usageTotals.input_tokens += usage.input_tokens;
  usageTotals.output_tokens += usage.output_tokens;
  usageTotals.cache_creation_input_tokens += usage.cache_creation_input_tokens;
  usageTotals.cache_read_input_tokens += usage.cache_read_input_tokens;
  usageTotals.cost_usd = round6(usageTotals.cost_usd + usage.cost_usd);
  if (usage.cache_read_input_tokens > 0) cacheReads += 1;

  const prev = (pair._cost && typeof pair._cost === 'object') ? pair._cost : { usd: 0, calls: [] };
  const prevCalls = Array.isArray(prev.calls) ? prev.calls : [];
  pair._cost = {
    usd: round6((Number(prev.usd) || 0) + usage.cost_usd),
    calls: prevCalls.concat([{ stage: 'rewrite', model: REWRITE_MODEL, usd: usage.cost_usd, usage: usage }]),
  };

  const content = (body && Array.isArray(body.content)) ? body.content : [];
  const textBlocks = content.filter((b) => b && b.type === 'text');
  const stop = (body && body.stop_reason) || 'unknown';
  const answer = textBlocks.map((b) => String(b.text === undefined || b.text === null ? '' : b.text)).join(NL);
  pair._rewrite_response = {
    http_status: status,
    stop_reason: stop,
    usage: usage,
    content_blocks: { total: content.length, text: textBlocks.length, types: content.map((b) => (b && b.type) || 'unknown') },
  };

  const first = pair.letter_audit_first || { failed_letter: [] };
  const firstFailed = Array.isArray(first.failed_letter) ? first.failed_letter : [];

  if (!answer.trim()) {
    markHold(pair, 'rewrite_no_text', 'the rewrite came back with no text block (stop_reason ' + stop + '). The first draft failed ' + firstFailed.join(', ') + ' and it is kept on the pair, unrepaired, so a human can see exactly what was wrong.');
    continue;
  }

  const ex = extractLetter(answer, LETTER_OPEN, LETTER_CLOSE, SCREEN_OPEN);
  if (!ex.ok) {
    markHold(pair, 'rewrite_no_markers', 'the rewrite ' + ex.why + ' The first draft failed ' + firstFailed.join(', ') + '. Nothing is salvaged from an answer with no boundary.');
    continue;
  }

  // The rewritten letter REPLACES the draft. The first audit stays on the pair beside it.
  pair.letter_raw = answer.slice(0, RAW_ANSWER_MAX);
  pair.letter_text = ex.letter;
  pair.screen_note = {
    present: ex.had_screen,
    raw: ex.screen_raw.slice(0, SCREEN_MAX),
    lines: ex.screen_lines,
    rule: 'each line names, verbatim, a sentence from the letter. The audit checks every one of them is a real substring.',
  };

  const result = auditPair(pair, 'final');
  pair.letter_audit = result;
  for (const id of result.failed_cv.concat(result.failed_letter)) failCounts[id] = (failCounts[id] || 0) + 1;

  if (result.pass) {
    stats.fixed += 1;
    continue;
  }

  stats.still_failing += 1;
  const allFailed = result.failed_cv.concat(result.failed_letter);
  markHold(pair, 'audit_failed_after_rewrite',
    'the letter still fails ' + allFailed.length + ' deterministic check(s) after its ONE reasoned rewrite: ' + allFailed.join(', ') +
    '. The first draft failed ' + (firstFailed.length ? firstFailed.join(', ') : 'nothing on the letter scope') +
    '. Both audits are on the pair, so what was wrong, what was asked for and what came back can all be read without reconstructing any of it. There is no second rewrite by design: the graph has no edge back to the rewrite branch. First reason now: ' +
    (result.checks.filter((c) => c.id === allFailed[0])[0] || {}).why);
}

// --- 3. everything else passes through untouched --------------------------------
// A letter that PASSED at Audit Pair arrives here with its audit attached and is not re-scanned:
// running identical rules over identical text can only return the same answer or a bug.
const outCarried = [];
for (const raw of carried) {
  const j = Object.assign({}, raw);
  j._call_now = false;
  if (j._kind === 'pair' && !j._status && j.letter_audit && j._rewrite_attempted === false) stats.passed_first_time += 1;
  else stats.carried += 1;
  outCarried.push(j);
}

// --- 4. the stage report ----------------------------------------------------------
if (pairing === 'mismatch') warnings.push('REWRITE PAIRING REFUSED: ' + pairingWhy);
if (pairing === 'no_responses') warnings.push('THE REWRITE NODE DID NOT RUN: ' + pairingWhy);
if (stats.still_failing > 0) {
  warnings.push(stats.still_failing + ' letter(s) still failed after their one reasoned rewrite and are HELD. There is no second attempt by design, and nothing was repaired silently on the way through, so what sits in needs_review is exactly what the model produced.');
}
if (stats.rewritten > 0 && stats.fixed === stats.rewritten) {
  warnings.push('every rewritten letter passed on the second pass, which is what the rewrite exists for: the writer eval measured two dash slips in six on a first pass, and holding those instead of asking once would have been the cost.');
}

const report = {
  _kind: 'stage_report',
  stage: 'audit_pair_final',
  model: REWRITE_MODEL,
  pairing: { state: pairing, why: pairingWhy, sent: called.length, responses: responses === null ? null : responses.length },
  counts: stats,
  failures_by_check: failCounts,
  hold_kinds: holdKinds,
  error_kinds: errorKinds,
  http_status_codes: statusCodes,
  voice_rules_sha: VOICE_RULES_SHA,
  shared_template: 'extractLetter() is lifted out of Parse Letter and auditPair() with its AUDIT_CFG line out of Audit Pair, at build time, as the same bytes. A second pass that was quietly more lenient than the first would let through exactly the letters the first pass exists to catch.',
  one_rewrite_rule: 'there is no edge from this node back to the rewrite branch, so one attempt is a property of the graph rather than of a counter somebody can raise.',
  cost: {
    actual_usd: usageTotals.cost_usd,
    usage: usageTotals,
    cache: { calls_with_a_cache_read: cacheReads, of_calls: stats.rewritten },
    prices: { model: REWRITE_MODEL, in_per_mtok: PRICE_IN, out_per_mtok: PRICE_OUT, cache_write_mult: CACHE_WRITE_MULT, cache_read_mult: CACHE_READ_MULT },
  },
  warnings: warnings,
  _call_now: false,
  site_fetch_url: '',
  ad_fetch_url: '',
};

const items = outPairs.concat(outCarried).map((j) => ({ json: j, pairedItem: { item: 0 } }));
items.push({ json: report, pairedItem: { item: 0 } });
return items;
`;

function renderJsCode() {
  return [
    '// GENERATED at build time from work/36-job-application-writer/nodes/38-audit-pair-final.js.',
    '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
    VOICE_RUNTIME,
    NUMBER_RUNTIME,
    AUDIT_CFG_LINE,
    'const REWRITE_MODEL = ' + JSON.stringify(MODEL) + ';',
    'const PRICE_IN = ' + JSON.stringify(PRICE.in_per_mtok) + ';',
    'const PRICE_OUT = ' + JSON.stringify(PRICE.out_per_mtok) + ';',
    'const CACHE_WRITE_MULT = ' + JSON.stringify(PRICE.cache_write_mult) + ';',
    'const CACHE_READ_MULT = ' + JSON.stringify(PRICE.cache_read_mult) + ';',
    'const LETTER_OPEN = ' + JSON.stringify(LETTER_OPEN) + ';',
    'const LETTER_CLOSE = ' + JSON.stringify(LETTER_CLOSE) + ';',
    'const SCREEN_OPEN = ' + JSON.stringify(SCREEN_OPEN) + ';',
    'const RAW_ANSWER_MAX = ' + JSON.stringify(RAW_ANSWER_MAX) + ';',
    'const SCREEN_MAX = ' + JSON.stringify(SCREEN_MAX) + ';',
    'const SCREEN_LINES_MAX = ' + JSON.stringify(SCREEN_LINES_MAX) + ';',
    'const SCREEN_SENTENCE_MAX = ' + JSON.stringify(SCREEN_SENTENCE_MAX) + ';',
    'const SYSTEMIC_KINDS = ' + JSON.stringify(SYSTEMIC_KINDS) + ';',
    LOGIC,
  ].join('\n');
}

assertAgainstUpstream();

module.exports = {
  name: NODE_NAME,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [9360, 100],
  connectFrom: 'Rewrite Results',
  notes: 'Takes the rewrite apart with extractLetter() LIFTED out of Parse Letter and judges it with auditPair() and the AUDIT_CFG line LIFTED out of Audit Pair, so the final pass and the first pass are the same bytes rather than the same intention. A letter that passed first time arrives on the carry branch and is not re-scanned. A letter that still fails goes to needs_review carrying BOTH audits, and there is no second rewrite: the graph has no edge back to the rewrite branch.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: renderJsCode(),
  },
};
