'use strict';
/*
 * 33-parse-letter.js - "Parse Letter". Takes the model answer apart and CHANGES NOTHING IN IT.
 *
 * =============================================================================================
 * 1. THERE IS NO SANITISER HERE, AND THAT IS THE WHOLE POINT OF THE NODE.
 * =============================================================================================
 * Every other parse node in this workflow runs its strings through `clean()`, which runs them
 * through `stripDashes()`, which turns an em dash into a comma and an en dash into a hyphen. That
 * is right for a brief, a company line or an objection: those are DATA, and a dash in them is
 * noise.
 *
 * It is wrong here, and the plan says so in as many words: a dash is a FAIL, not a fix. Three
 * reasons, and the third is the one that matters.
 *   The letter is prose that ships under his name. Shaheen, 2026-08-20, verbatim: "you have use
 *     this [en-dash] in both versions PDF and Word, you already have this role, NEVER AGAIN use
 *     it." A rule he has stated twice is not enforced by quietly repairing the violation.
 *   A substitution changes his sentence. Replacing an em dash with a comma produces a sentence the
 *     writer did not write and nobody approved, in a document whose entire design is built around
 *     never letting a model rewrite his words.
 *   AND THE REAL ONE: a repaired dash makes the line SHIP LOOKING CLEAN. The audit passes, the
 *     blind grader sees a tidy letter, and the fact that the writer reached for the character is
 *     invisible to every surface that exists to notice it. Defect 7 measured 2 dash slips in 6 on
 *     a first pass. That number is only knowable because nothing was quietly fixing them.
 *
 * So the extraction below trims whitespace and normalises line endings, and does nothing else.
 * Windows line endings are normalised because paragraph splitting downstream counts blank lines,
 * and a carriage return is not a character anybody chose to write. No other byte is touched.
 *
 * =============================================================================================
 * 2. content[0] IS NOT THE TEXT BLOCK.
 * =============================================================================================
 * `thinking` is omitted from the request, which on these models means adaptive thinking is ON. A
 * thinking block comes back FIRST and with the default display it carries empty text. A
 * content[0].text reader would return an empty string on every call and report every letter as
 * unreadable, forever, with a green run and a zero. The filter is `type === 'text'`, always.
 *
 * =============================================================================================
 * 3. THE SCREENING NOTE NEVER BECOMES PART OF THE LETTER.
 * =============================================================================================
 * The model answers with the letter between two markers and then a screening note after a third.
 * The note names, verbatim, the sentence that answers each objection and the sentence that names
 * the honest gap. It goes to the audit (A18) and to the folder README, and the extraction keeps it
 * in its OWN field so there is no path by which it can reach the page a recruiter reads.
 *
 * The verbatim requirement is what makes it checkable: the audit asserts each named sentence is a
 * real substring of the letter. A model that paraphrases its own answer fails that, which is the
 * intended outcome, because a paraphrase proves nothing about whether the objection was answered.
 *
 * =============================================================================================
 * 4. extractLetter() IS LIFTED BY NODE 38, NOT COPIED.
 * =============================================================================================
 * The rewrite lands at node 38 and has to be taken apart the same way this one is. A second copy of
 * this function is how one of them ends up with a rule the other does not have, so 38 lifts these
 * exact bytes at build time with `_stage2.bakedFunction`. If it is ever renamed or reshaped, that
 * build fails by name rather than the copy quietly going stale.
 */

const LN = require('./_lane');
const S2 = require('./_stage2');

const NODE_NAME = 'Parse Letter';
const N14 = './14-parse-job-brief.js';
const N29 = './29-build-writer-request.js';

const MODEL = LN.STAGE_MODELS.write;
const PRICE = LN.prices(MODEL);

// Read out of the writer rather than restated: two nodes holding two ideas of where a letter starts
// is the same drift class as two copies of a rule.
function readWriterConst(name) {
  const src = String(require(N29).parameters.jsCode || '');
  const re = new RegExp('\\nconst ' + name + ' = (\\"[^\\"]*\\");');
  const m = re.exec(src);
  if (!m) {
    throw new Error(
      'Parse Letter: could not read ' + name + ' out of the generated Build Writer Request source.\n' +
      '  The markers are read rather than restated so the prompt that ASKS for them and the parser that\n' +
      '  LOOKS for them cannot disagree. If the shape changed, fix this reader in the same edit.'
    );
  }
  return JSON.parse(m[1]);
}
const LETTER_OPEN = readWriterConst('LETTER_OPEN');
const LETTER_CLOSE = readWriterConst('LETTER_CLOSE');
const SCREEN_OPEN = readWriterConst('SCREEN_OPEN');

const RAW_ANSWER_MAX = 8000;
const SCREEN_MAX = 2000;
const SCREEN_LINES_MAX = 12;
const SCREEN_SENTENCE_MAX = 400;
const SYSTEMIC_KINDS = ['auth', 'credits', 'rate_limit', 'upstream', 'transport', 'not_found', 'too_large', 'pairing', 'node_did_not_run', 'bad_request'];

// `clean` is DELIBERATELY NOT LIFTED into this node. It calls stripDashes. See header note 1.
const LIFTED = [
  S2.bakedFunction(N14, 'costOf', 'cache_creation_input_tokens'),
  S2.bakedFunction(N14, 'classify', 'invalid_request_error'),
].join('\n');

// Run AFTER the LOGIC template below: it calls renderJsCode(), which reads LOGIC, and a const is in
// its temporal dead zone until its own line runs. The invocation sits under LOGIC.
function assertAgainstUpstream() {
  const merge = require('./32-write-results.js');
  const route = require('./30-write-route.js');
  const call = require('./31-write-letter.js');
  const build = require(N29);
  if (merge.name !== 'Write Results') throw new Error('Parse Letter: node 32 is named ' + JSON.stringify(merge.name) + ' and this node connects from "Write Results".');
  if (route.name !== 'Write Route') throw new Error('Parse Letter: node 30 is named ' + JSON.stringify(route.name) + ' and this node reads $(\'Write Route\') output 0 for the authoritative sent order.');
  if (call.name !== 'Write Letter') throw new Error('Parse Letter: node 31 is named ' + JSON.stringify(call.name) + ' and this node reads $(\'Write Letter\') for the responses.');
  if (build.name !== 'Build Writer Request') throw new Error('Parse Letter: node 29 is named ' + JSON.stringify(build.name) + ' and this node reads $(\'Build Writer Request\') for the independent count of what should have been called.');

  const resp = call.parameters.options && call.parameters.options.response && call.parameters.options.response.response;
  if (!resp || resp.fullResponse !== true || resp.neverError !== true) {
    throw new Error('Parse Letter: Write Letter no longer sets fullResponse AND neverError. This node reads statusCode off the item to tell a credit error, an auth error and a rate limit apart, and on this stage that is the difference between leaving a sheet row at new and burning the day cap on nothing.');
  }
  if (merge.parameters.numberInputs !== 2) {
    throw new Error('Parse Letter: Write Results declares numberInputs ' + JSON.stringify(merge.parameters.numberInputs) + '. This node expects the two-input join.');
  }

  // THE SANITISER MUST NOT BE HERE. Asserted rather than remembered: this is the one node in the
  // workflow whose correctness depends on a function being ABSENT, and an absence is exactly what a
  // future edit adds back without noticing.
  const generated = renderJsCode();
  for (const banned of ['stripDashes', 'function clean(']) {
    if (generated.indexOf(banned) !== -1) {
      throw new Error(
        'Parse Letter: the generated source contains ' + JSON.stringify(banned) + '.\n' +
        '  This node must not carry a dash sanitiser or the cleaner that calls one. A repaired dash makes\n' +
        '  the letter ship LOOKING clean: the audit passes, the blind grader sees tidy prose, and the\n' +
        '  writer reaching for a character his own standing correction forbids is invisible to every\n' +
        '  surface that exists to notice it. A dash is a FAIL here, not a fix.'
      );
    }
  }
  if (generated.indexOf(String.fromCharCode(8212)) !== -1 || generated.indexOf(String.fromCharCode(8211)) !== -1) {
    throw new Error('Parse Letter: the generated source contains an em dash or an en dash. No file in this system carries either character.');
  }

  if (NODE_NAME === 'Build Writer Request') {
    throw new Error('Parse Letter: this node must not be named "Build Writer Request". That name is the voice-sync enrolment key and belongs to the letter writer alone.');
  }
  if (generated.indexOf('SOUL_VOICE') !== -1) {
    throw new Error('Parse Letter: the generated source carries a soul voice marker. This node takes an answer apart; it does not write prose.');
  }
}

const LOGIC = `
// ---------------------------------------------------------------------------
// Parse Letter. Text blocks, marker extraction, NO sanitiser. A dash is a FAIL, not a fix.
// ---------------------------------------------------------------------------
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);

${LIFTED}

function round6(n) { return Math.round(n * 1e6) / 1e6; }

// ---------------------------------------------------------------------------
// THE EXTRACTION. Lifted VERBATIM into Audit Pair Final by _stage2.bakedFunction, so the rewrite
// is taken apart by exactly these bytes rather than by a second copy of this idea.
//
// What it does to the text: normalises CRLF to LF, trims leading and trailing whitespace. That is
// the complete list. No dash substitution, no control character scrub, no whitespace collapse: the
// audit has to see what the model actually wrote, and the blind grader has to read it.
// ---------------------------------------------------------------------------
// THE SENTINEL PHRASE CANNOT BE HOISTED, and that is deliberate on the lift's side rather than a
// limitation. _stage2.bakedFunction() cuts extractLetter out of the GENERATED jsCode and searches
// THE LIFTED BYTES for a phrase, which is what proves the reused function is this rule and not
// another one wearing the same name. A phrase living in a module constant is not in those bytes,
// so hoisting it silently defeats the check. It is written literally inside the function below and
// literally again in the run-report warning; two copies of a sentence is the cheap half of that
// trade. It changed on 2026-09-16 when the screening marker became a second legitimate boundary,
// because the old wording, 'exactly what sits between them', had stopped describing the code.

function extractLetter(answer, openMark, closeMark, screenMark) {
  const raw = String(answer === null || answer === undefined ? '' : answer).split(CR + NL).join(NL).split(CR).join(NL);
  const out = { ok: false, why: null, letter: '', screen_raw: '', screen_lines: [], had_open: false, had_close: false, had_screen: false };
  if (!raw.trim()) {
    out.why = 'the answer carried no text at all';
    return out;
  }
  const a = raw.indexOf(openMark);
  const closeAt = a === -1 ? -1 : raw.indexOf(closeMark, a + openMark.length);
  const screenAt = a === -1 ? -1 : raw.indexOf(screenMark, a + openMark.length);
  out.had_open = a !== -1;
  out.had_close = closeAt !== -1;

  // THE SCREEN MARKER IS A SECOND LEGITIMATE BOUNDARY (added 2026-09-16, measured).
  // Letter-eval execution 5426 had the model open the letter, write it, write the screening note
  // under its own marker, and simply NOT emit the close marker on 2 of 6 cases. Both were refused as
  // unparseable while a perfectly good letter sat in the response. That is a compliance rate no
  // wording fix should be trusted to carry: the run before it was 6 of 6 on the same prompt.
  // This is NOT a relaxation into guessing. The letter still ends at a marker the model actually
  // emitted; the screening note's own opening marker is a boundary by construction, because the note
  // is defined as everything after it and can never be part of the letter. What is dropped is the
  // REDUNDANCY of demanding two markers where one already fixes the edge.
  // The refusal that matters is untouched: an answer with an open marker and NEITHER a close marker
  // nor a screen marker has no boundary at all and is still refused by name.
  let b = closeAt;
  let boundary = 'close';
  if (closeAt === -1 && screenAt !== -1) {
    b = screenAt;
    boundary = 'screen';
  }
  out.boundary = boundary;

  if (a === -1 || b === -1) {
    out.why = 'the answer does not carry a letter boundary. open marker found: ' + (a !== -1) +
      ', close marker found: ' + (closeAt !== -1) + ', screening marker found: ' + (screenAt !== -1) +
      '. The letter is defined as what sits between the open marker and whichever of those two comes next, so nothing is guessed from an answer that has no boundary at all.';
    return out;
  }
  out.letter = raw.slice(a + openMark.length, b).trim();
  if (!out.letter) {
    out.why = boundary === 'close'
      ? 'the two letter markers are there and there is nothing between them'
      : 'the letter marker is followed immediately by the screening marker, so there is no letter between them';
    return out;
  }
  const s = boundary === 'screen' ? screenAt : raw.indexOf(screenMark, b + closeMark.length);
  out.had_screen = s !== -1;
  if (s !== -1) {
    out.screen_raw = raw.slice(s + screenMark.length).trim();
    const lines = out.screen_raw.split(NL);
    for (const line of lines) {
      if (out.screen_lines.length >= SCREEN_LINES_MAX) break;
      const t = line.trim();
      if (!t) continue;
      const m = /^(objection\\s*(\\d+)|gap)\\s*:\\s*(.+)$/i.exec(t);
      if (!m) {
        out.screen_lines.push({ kind: 'unparsed', index: null, sentence: t.slice(0, SCREEN_SENTENCE_MAX) });
        continue;
      }
      const isGap = /^gap$/i.test(m[1]);
      out.screen_lines.push({
        kind: isGap ? 'gap' : 'objection',
        index: isGap ? null : Number(m[2]),
        sentence: m[3].trim().slice(0, SCREEN_SENTENCE_MAX),
      });
    }
  }
  out.ok = true;
  return out;
}

// --- 1. pairing: which pair does which response belong to -----------------------
let called = [];
try {
  called = $('Write Route').all(0).map((i) => i.json);
} catch (e) {
  called = [];
}
let responses = null;
let responsesWhy = null;
try {
  responses = $('Write Letter').all();
} catch (e) {
  responses = null;
  responsesWhy = e.message;
}
let expectedCalls = null;
try {
  expectedCalls = $('Build Writer Request').all().map((i) => i.json).filter((j) => j && j._call_now === true).length;
} catch (e) {
  expectedCalls = null;
}
const carried = $input.all().map((i) => i.json).filter((j) => j && j._kind !== undefined);

let pairing = 'ok';
let pairingWhy = null;
const warnings = [];

if (expectedCalls !== null && called.length !== expectedCalls) {
  pairing = 'mismatch';
  pairingWhy = 'Build Writer Request stamped _call_now true on ' + expectedCalls + ' pair(s) and Write Route sent ' + called.length +
    ' down the paid branch. The route and the stamp have come apart.';
} else if (responses === null) {
  if (called.length > 0) {
    pairing = 'no_responses';
    pairingWhy = 'Write Route sent ' + called.length + ' pair(s) and the Write Letter node produced no run data (' + (responsesWhy || 'unknown') +
      '). The node did not execute. Every pair is kept, marked, and written NOWHERE, so the next run offers the same rows again.';
  }
} else if (responses.length !== called.length) {
  pairing = 'mismatch';
  pairingWhy = 'Write Route sent ' + called.length + ' pair(s) and Write Letter returned ' + responses.length +
    '. Refusing to guess an alignment: one letter attached to another job is a perfectly fluent application to the wrong company, and every count on the sheet would still be right.';
}
if (pairing === 'ok' && responses !== null) {
  for (let i = 0; i < responses.length; i += 1) {
    const pi = responses[i] && responses[i].pairedItem;
    const idx = pi && typeof pi === 'object' && !Array.isArray(pi) ? pi.item : (Array.isArray(pi) && pi.length ? pi[0].item : undefined);
    if (idx !== undefined && Number(idx) !== i) {
      pairing = 'mismatch';
      pairingWhy = 'response ' + i + ' carries pairedItem ' + JSON.stringify(idx) + ', so the responses are not in the order they were sent. Refusing to guess an alignment.';
      break;
    }
  }
}

// --- 2. per pair ---------------------------------------------------------------
const outPairs = [];
const usageTotals = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cost_usd: 0 };
const errorKinds = {};
const statusCodes = {};
const holdKinds = {};
const stats = { attempted: 0, parsed: 0, held: 0, errored: 0, with_screen_note: 0, screen_lines_unparsed: 0 };
let cacheReads = 0;
let cacheWrites = 0;

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
  stats.attempted += 1;

  if (pairing === 'mismatch') { markError(pair, 'pairing', pairingWhy); continue; }
  if (pairing === 'no_responses') { markError(pair, 'node_did_not_run', pairingWhy); continue; }

  const item = responses[i] || {};
  const j = item.json || {};

  if (j.error !== undefined && j.statusCode === undefined) {
    markError(pair, 'transport', 'the letter request never completed: ' + String(typeof j.error === 'string' ? j.error : (j.error && j.error.message) || JSON.stringify(j.error)).slice(0, 240));
    continue;
  }
  const status = Number(j.statusCode);
  const body = j.body;
  if (!isFinite(status)) {
    markError(pair, 'transport', 'the response carried no statusCode. fullResponse is set on Write Letter, so a missing status means the item is not an HTTP response at all.');
    continue;
  }
  statusCodes[String(status)] = (statusCodes[String(status)] || 0) + 1;
  if (status < 200 || status >= 300) {
    const c = classify(status, body);
    markError(pair, c.kind, c.why);
    continue;
  }

  // 2xx. Price it whatever the content turns out to be: the tokens were spent.
  const usage = costOf(body && body.usage);
  usageTotals.input_tokens += usage.input_tokens;
  usageTotals.output_tokens += usage.output_tokens;
  usageTotals.cache_creation_input_tokens += usage.cache_creation_input_tokens;
  usageTotals.cache_read_input_tokens += usage.cache_read_input_tokens;
  usageTotals.cost_usd = round6(usageTotals.cost_usd + usage.cost_usd);
  if (usage.cache_read_input_tokens > 0) cacheReads += 1;
  if (usage.cache_creation_input_tokens > 0) cacheWrites += 1;

  const prev = (pair._cost && typeof pair._cost === 'object') ? pair._cost : { usd: 0, calls: [] };
  const prevCalls = Array.isArray(prev.calls) ? prev.calls : [];
  pair._cost = {
    usd: round6((Number(prev.usd) || 0) + usage.cost_usd),
    calls: prevCalls.concat([{ stage: 'write', model: WRITE_MODEL, usd: usage.cost_usd, usage: usage }]),
  };

  const content = (body && Array.isArray(body.content)) ? body.content : [];
  const textBlocks = content.filter((b) => b && b.type === 'text');
  const stop = (body && body.stop_reason) || 'unknown';
  const answer = textBlocks.map((b) => String(b.text === undefined || b.text === null ? '' : b.text)).join(NL);
  const meta = {
    http_status: status,
    stop_reason: stop,
    usage: usage,
    content_blocks: { total: content.length, text: textBlocks.length, non_text: content.length - textBlocks.length, types: content.map((b) => (b && b.type) || 'unknown') },
  };
  pair._write_response = meta;

  if (!answer.trim()) {
    if (stop === 'max_tokens') {
      markHold(pair, 'letter_truncated', 'the letter hit max_tokens (' + WRITE_MAX_TOKENS + ') before it produced any text at all. On this model an omitted thinking parameter means adaptive thinking is ON, and max_tokens caps thinking and text TOGETHER, so the whole budget went to reasoning. Content blocks seen: ' + JSON.stringify(meta.content_blocks.types));
    } else {
      markHold(pair, 'no_text_block', 'the letter response carried ' + content.length + ' content block(s) and none of them was a text block (types ' + JSON.stringify(meta.content_blocks.types) + ', stop_reason ' + stop + ').');
    }
    continue;
  }

  const ex = extractLetter(answer, LETTER_OPEN, LETTER_CLOSE, SCREEN_OPEN);
  pair.letter_raw = answer.slice(0, RAW_ANSWER_MAX);
  if (!ex.ok) {
    if (stop === 'max_tokens') {
      markHold(pair, 'letter_truncated', 'the letter hit max_tokens (' + WRITE_MAX_TOKENS + ') and the answer is cut off, so ' + ex.why + '. Raise the write row of the intake cost model, which is where this ceiling is read from.');
    } else {
      markHold(pair, 'no_letter_markers', ex.why + ' First 200 characters of the answer: ' + JSON.stringify(answer.slice(0, 200)));
    }
    continue;
  }

  // THE TEXT, AS WRITTEN. Nothing between the model and this field repairs anything.
  pair.letter_text = ex.letter;
  pair.screen_note = {
    present: ex.had_screen,
    raw: ex.screen_raw.slice(0, SCREEN_MAX),
    lines: ex.screen_lines,
    rule: 'each line names, verbatim, a sentence from the letter. Audit Pair checks every one of them is a real substring, which is what makes the note evidence rather than a claim. It goes to the folder README and it NEVER goes into the letter.',
  };
  pair._letter = {
    model: WRITE_MODEL,
    stop_reason: stop,
    chars: ex.letter.length,
    answer_chars: answer.length,
    had_screen_note: ex.had_screen,
    screen_lines: ex.screen_lines.length,
    sanitiser: 'NONE, by design. The extraction normalises line endings and trims the ends and touches nothing else. A repaired dash would make the letter ship looking clean and hide the slip from the audit and from the blind grader, which is exactly the failure the no-sanitiser rule exists to prevent.',
  };
  if (ex.had_screen) stats.with_screen_note += 1;
  for (const l of ex.screen_lines) if (l.kind === 'unparsed') stats.screen_lines_unparsed += 1;
  stats.parsed += 1;
}

// --- 3. everything else passes through untouched --------------------------------
const outCarried = [];
for (const raw of carried) {
  const j = Object.assign({}, raw);
  j._call_now = false;
  outCarried.push(j);
}

// --- 4. the stage report ----------------------------------------------------------
if (pairing === 'mismatch') warnings.push('LETTER PAIRING REFUSED, and no letter was kept because of it: ' + pairingWhy);
if (pairing === 'no_responses') warnings.push('THE LETTER NODE DID NOT RUN: ' + pairingWhy);
if (errorKinds.credits) {
  warnings.push('THE ANTHROPIC ACCOUNT IS OUT OF CREDIT at the letter stage. Every affected row is left at status new and written NOWHERE, so the next run offers the same jobs again. The read and the selection those pairs already paid for are lost, which is the honest cost of stopping here rather than shipping a CV with no letter.');
}
if (errorKinds.auth) {
  warnings.push('THE ANTHROPIC KEY WAS REFUSED at the letter stage. Note that the credential for this workflow is a PROVISIONAL choice: human-action anthropic-credential-36-writer is open.');
}
if (holdKinds.no_letter_markers) {
  warnings.push(holdKinds.no_letter_markers + ' letter(s) came back with NO boundary at all, neither a close marker nor a screening marker, and were HELD. The letter is defined as what sits between the open marker and whichever of those two comes next, so nothing is salvaged from an answer with no boundary: a best guess at where a letter ends is how a screening note ends up in a document a recruiter reads.');
}
if (stats.parsed > 0 && stats.with_screen_note < stats.parsed) {
  warnings.push((stats.parsed - stats.with_screen_note) + ' letter(s) came back with no screening note. The note is what proves each objection was answered, so a pair without one fails A18 at the audit and gets its one rewrite.');
}
if (stats.attempted > 1 && cacheReads === 0 && stats.parsed > 1) {
  warnings.push('THE WRITER PROMPT CACHE NEVER READ. ' + stats.parsed + ' successful call(s) and cache_read_input_tokens was 0 on every one. The system block on this stage is the rubric plus the whole soul voice block and it is identical across both lanes, so every pair paid full price for it. The usual causes are a gap of more than five minutes between calls or a prefix under the model minimum of ' + MIN_CACHE_TOKENS + ' tokens.');
}

const report = {
  _kind: 'stage_report',
  stage: 'parse_letter',
  model: WRITE_MODEL,
  pairing: { state: pairing, why: pairingWhy, sent: called.length, responses: responses === null ? null : responses.length, expected: expectedCalls },
  counts: stats,
  hold_kinds: holdKinds,
  error_kinds: errorKinds,
  http_status_codes: statusCodes,
  markers: { letter_open: LETTER_OPEN, letter_close: LETTER_CLOSE, screen_open: SCREEN_OPEN },
  sanitiser: 'NONE. A dash is a FAIL, not a fix (plan defect 7). The extraction normalises line endings and trims the ends; no other byte of the model answer is touched, so the audit and the blind grader both see what was actually written.',
  cost: {
    actual_usd: usageTotals.cost_usd,
    usage: usageTotals,
    cache: { calls_with_a_cache_read: cacheReads, calls_that_wrote_cache: cacheWrites, of_calls: stats.parsed, model_minimum_tokens: MIN_CACHE_TOKENS },
    prices: { model: WRITE_MODEL, in_per_mtok: PRICE_IN, out_per_mtok: PRICE_OUT, cache_write_mult: CACHE_WRITE_MULT, cache_read_mult: CACHE_READ_MULT },
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

assertAgainstUpstream();

function renderJsCode() {
  return [
    '// GENERATED at build time from work/36-job-application-writer/nodes/33-parse-letter.js.',
    '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
    'const WRITE_MODEL = ' + JSON.stringify(MODEL) + ';',
    'const WRITE_MAX_TOKENS = ' + JSON.stringify(S2.readSourceNumber('./05-build-candidates.js', /\{\s*stage:\s*'write',[^}]*out_tokens:\s*(\d+)\s*\}/, 'the write row of COST_MODEL')) + ';',
    'const MIN_CACHE_TOKENS = ' + JSON.stringify(LN.MIN_CACHEABLE_TOKENS[MODEL]) + ';',
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

module.exports = {
  name: NODE_NAME,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [8060, 100],
  connectFrom: 'Write Results',
  notes: 'Filters content[] for text blocks (mandatory: an omitted thinking parameter means adaptive thinking is ON and a thinking block can come back first carrying empty text), then takes the letter out from between its two markers and the screening note out from after the third. NO SANITISER: line endings are normalised and the ends are trimmed, and nothing else in the model answer is touched, because a repaired dash makes a letter ship looking clean and hides the slip from the audit and from the blind grader. A truncated answer is named as truncated rather than arriving as a mysterious missing marker. Prices the call off real usage and appends it to the pair running cost.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: renderJsCode(),
  },
};
