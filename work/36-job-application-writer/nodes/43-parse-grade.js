'use strict';
/*
 * 43-parse-grade.js - "Parse Grade". Five verdicts in, a shipping decision out.
 *
 * =============================================================================================
 * 1. D16, AND IT IS THE STRICTEST RULE IN THE WORKFLOW.
 * =============================================================================================
 * Shaheen's decision, verbatim from the plan: "Grader FAIL holds the pair. Not uploaded. It sits in
 * needs_review with the reasons, raises a waiting-on-you row, shows in the brief. Shaheen ships or
 * rewrites. Nothing that failed the voice check reaches Drive unattended."
 *
 * So a FAIL holds. And so does an UNPARSEABLE answer, a truncated answer, a missing criterion, a
 * verdict this parser does not recognise, and a grading call that never completed. Every one of
 * those is a voice check that did not happen, and D16 is about what reaches Drive unattended rather
 * than about what a model managed to say. Treating an unreadable grade as a pass would satisfy the
 * letter of the rule and break the whole point of it.
 *
 * That is deliberately the conservative direction. The cost of being wrong this way is a pair
 * sitting in needs_review that a human glances at and ships. The cost of being wrong the other way
 * is a letter going out under his name that nothing checked.
 *
 * =============================================================================================
 * 2. THE VERDICT IS RECOMPUTED, NOT TRUSTED.
 * =============================================================================================
 * The grader returns five criterion verdicts AND a top level one. The top level one is not believed:
 * it is recomputed from the five and compared. A model that returns four PASS, one FAIL and a top
 * level PASS has contradicted itself, and the recomputed answer is the one that decides, with the
 * contradiction recorded. Trusting a summary field over the detail it summarises is how a grader
 * quietly stops grading.
 *
 * =============================================================================================
 * 3. EVIDENCE IS CLEANED WITHOUT TOUCHING A DASH.
 * =============================================================================================
 * The evidence strings are model output that ends up in the folder README a human reads, so they get
 * the usual control character and formula prefix scrub. They do NOT get the dash sanitiser: a
 * grader's evidence for a PV1 failure will very often BE the dash it found, and replacing it would
 * turn "here is the character" into "here is a comma" in the one sentence that has to name it.
 * `clean()` from node 14 is therefore not lifted here, and a local scrubber is used instead.
 */

const LN = require('./_lane');
const S2 = require('./_stage2');

const NODE_NAME = 'Parse Grade';
const N14 = './14-parse-job-brief.js';
const N39 = './39-build-grade-request.js';

const MODEL = LN.STAGE_MODELS.grade;
const PRICE = LN.prices(MODEL);

const PV_IDS = ['PV1', 'PV2', 'PV3', 'PV4', 'PV5'];
const EVIDENCE_MAX = 400;
const RAW_ANSWER_MAX = 4000;
const SYSTEMIC_KINDS = ['auth', 'credits', 'rate_limit', 'upstream', 'transport', 'not_found', 'too_large', 'pairing', 'node_did_not_run', 'bad_request'];

// `clean` is deliberately NOT lifted: it calls stripDashes, and a grader quoting the dash it found
// is the one string in this workflow where the character is the evidence. See header note 3.
const LIFTED = [
  S2.bakedFunction(N14, 'extractJson', 'no JSON object could be parsed'),
  S2.bakedFunction(N14, 'costOf', 'cache_creation_input_tokens'),
  S2.bakedFunction(N14, 'classify', 'invalid_request_error'),
].join('\n');

function assertAgainstUpstream() {
  const merge = require('./42-grade-results.js');
  const route = require('./40-grade-route.js');
  const call = require('./41-grade-letter.js');
  const build = require(N39);
  if (merge.name !== 'Grade Results') throw new Error('Parse Grade: node 42 is named ' + JSON.stringify(merge.name) + ' and this node connects from "Grade Results".');
  if (route.name !== 'Grade Route') throw new Error('Parse Grade: node 40 is named ' + JSON.stringify(route.name) + ' and this node reads $(\'Grade Route\') output 0 for the authoritative sent order.');
  if (call.name !== 'Grade Letter') throw new Error('Parse Grade: node 41 is named ' + JSON.stringify(call.name) + ' and this node reads $(\'Grade Letter\') for the responses.');
  if (build.name !== 'Build Grade Request') throw new Error('Parse Grade: node 39 is named ' + JSON.stringify(build.name) + '.');

  const resp = call.parameters.options && call.parameters.options.response && call.parameters.options.response.response;
  if (!resp || resp.fullResponse !== true || resp.neverError !== true) {
    throw new Error('Parse Grade: Grade Letter no longer sets fullResponse AND neverError, so a 4xx would arrive with no status code.');
  }
  if (merge.parameters.numberInputs !== 2) {
    throw new Error('Parse Grade: Grade Results declares numberInputs ' + JSON.stringify(merge.parameters.numberInputs) + '. This node expects the two-input join.');
  }

  // The five ids are the contract between the prompt and this parser. A parser expecting one the
  // prompt never asks for would hold every pair, forever, and the reason would read as a grader
  // problem rather than as a contract problem.
  const bc = String(build.parameters.jsCode || '');
  const asked = /const PV_IDS = (\[[^\]]*\]);/.exec(bc);
  if (!asked) {
    throw new Error('Parse Grade: Build Grade Request no longer bakes a PV_IDS list, which is the contract between what the prompt asks for and what this parser demands.');
  }
  if (JSON.parse(asked[1]).join(',') !== PV_IDS.join(',')) {
    throw new Error('Parse Grade: Build Grade Request asks for ' + asked[1] + ' and this parser demands ' + JSON.stringify(PV_IDS) + '. A parser expecting a criterion the prompt never asks for would hold every pair forever and the reason would look like a grader fault.');
  }

  const generated = renderJsCode();
  if (generated.indexOf('stripDashes') !== -1) {
    throw new Error(
      'Parse Grade: the generated source contains a dash sanitiser.\n' +
      '  A PV1 failure is very often evidenced by quoting the character that was found, and substituting\n' +
      '  it turns the one sentence that has to name the problem into a sentence that does not.'
    );
  }
  if (generated.indexOf(String.fromCharCode(8212)) !== -1 || generated.indexOf(String.fromCharCode(8211)) !== -1) {
    throw new Error('Parse Grade: the generated source contains an em dash or an en dash.');
  }
  if (NODE_NAME === 'Build Writer Request') {
    throw new Error('Parse Grade: this node must not be named "Build Writer Request". That name is the voice-sync enrolment key and belongs to the letter writer alone.');
  }
  if (generated.indexOf('SOUL_VOICE') !== -1) {
    throw new Error('Parse Grade: the generated source carries a soul voice marker. This node reads a verdict; it does not write prose.');
  }
}

const LOGIC = `
// ---------------------------------------------------------------------------
// Parse Grade. FAIL or unreadable means needs_review (D16). Nothing unchecked reaches Drive.
// ---------------------------------------------------------------------------
const NL = String.fromCharCode(10);

${LIFTED}

function round6(n) { return Math.round(n * 1e6) / 1e6; }

// The scrub, WITHOUT the dash sanitiser. Control characters and a leading formula prefix out,
// whitespace collapsed, length capped. Every other byte, the two dash characters included, survives
// because the grader quoting one is the evidence for the check that found it.
function scrub(v, cap) {
  if (v === null || v === undefined) return '';
  let out = String(v)
    .replace(/[\\u0000-\\u001F\\u007F]/g, ' ')
    .replace(/[\\u200B-\\u200D\\uFEFF\\u00A0]/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
  while (out.length && '=+@'.indexOf(out.charAt(0)) !== -1) out = out.slice(1).trim();
  if (out.length > cap) out = out.slice(0, cap - 1).trim() + String.fromCharCode(8230);
  return out;
}

function readVerdict(v) {
  const s = String(v === null || v === undefined ? '' : v).trim().toUpperCase();
  if (s === 'PASS') return 'PASS';
  if (s === 'FAIL') return 'FAIL';
  return null;
}

// --- 1. pairing -----------------------------------------------------------------
let called = [];
try {
  called = $('Grade Route').all(0).map((i) => i.json);
} catch (e) {
  called = [];
}
let responses = null;
let responsesWhy = null;
try {
  responses = $('Grade Letter').all();
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
    pairingWhy = 'Grade Route sent ' + called.length + ' pair(s) and the Grade Letter node produced no run data (' + (responsesWhy || 'unknown') +
      '). The node did not execute, so no letter was graded and D16 holds every one of them.';
  }
} else if (responses.length !== called.length) {
  pairing = 'mismatch';
  pairingWhy = 'Grade Route sent ' + called.length + ' pair(s) and Grade Letter returned ' + responses.length +
    '. Refusing to guess an alignment: one letter graded under another letter verdict is exactly the failure a blind grader exists to prevent.';
}
if (pairing === 'ok' && responses !== null) {
  for (let i = 0; i < responses.length; i += 1) {
    const pi = responses[i] && responses[i].pairedItem;
    const idx = pi && typeof pi === 'object' && !Array.isArray(pi) ? pi.item : (Array.isArray(pi) && pi.length ? pi[0].item : undefined);
    if (idx !== undefined && Number(idx) !== i) {
      pairing = 'mismatch';
      pairingWhy = 'response ' + i + ' carries pairedItem ' + JSON.stringify(idx) + ', so the grades are not in the order the letters were sent.';
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
const failsByCriterion = {};
const stats = { graded: 0, passed: 0, failed: 0, unreadable: 0, errored: 0, contradictions: 0, ready_to_ship: 0 };
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
}

for (let i = 0; i < called.length; i += 1) {
  const pair = Object.assign({}, called[i]);
  outPairs.push(pair);
  stats.graded += 1;

  if (pairing === 'mismatch') { markError(pair, 'pairing', pairingWhy); continue; }
  if (pairing === 'no_responses') { markError(pair, 'node_did_not_run', pairingWhy); continue; }

  const item = responses[i] || {};
  const j = item.json || {};

  if (j.error !== undefined && j.statusCode === undefined) {
    markError(pair, 'transport', 'the grading request never completed: ' + String(typeof j.error === 'string' ? j.error : (j.error && j.error.message) || JSON.stringify(j.error)).slice(0, 240));
    continue;
  }
  const status = Number(j.statusCode);
  const body = j.body;
  if (!isFinite(status)) {
    markError(pair, 'transport', 'the response carried no statusCode. fullResponse is set on Grade Letter, so a missing status means the item is not an HTTP response at all.');
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
    calls: prevCalls.concat([{ stage: 'grade', model: GRADE_MODEL, usd: usage.cost_usd, usage: usage }]),
  };

  const content = (body && Array.isArray(body.content)) ? body.content : [];
  const textBlocks = content.filter((b) => b && b.type === 'text');
  const stop = (body && body.stop_reason) || 'unknown';
  const text = textBlocks.map((b) => String(b.text === undefined || b.text === null ? '' : b.text)).join(NL).trim();

  pair._grade_response = {
    http_status: status,
    stop_reason: stop,
    usage: usage,
    content_blocks: { total: content.length, text: textBlocks.length, types: content.map((b) => (b && b.type) || 'unknown') },
  };

  // D16 applied to every unreadable shape. See header note 1.
  if (!text) {
    stats.unreadable += 1;
    pair.letter_grade = { verdict: 'UNREADABLE', why: 'the grading response carried no text block (stop_reason ' + stop + ')' };
    markHold(pair, 'grade_unreadable', 'the blind grader returned no readable answer (' + (stop === 'max_tokens' ? 'it hit max_tokens before writing anything' : 'no text block, stop_reason ' + stop) + '). D16 holds the pair: an ungraded letter and a failed letter are treated the same, because a call that never returned is a voice check that did not happen.');
    continue;
  }

  const parsed = extractJson(text);
  if (!parsed.ok) {
    stats.unreadable += 1;
    pair.letter_grade = { verdict: 'UNREADABLE', why: parsed.why, sample: scrub(String(parsed.sample || text).slice(0, 200), 240) };
    markHold(pair, 'grade_unparseable', 'the blind grader answer would not parse as JSON: ' + parsed.why + '. D16 holds the pair rather than guessing at a verdict from prose. First 200 characters: ' + JSON.stringify(String(parsed.sample || text).slice(0, 200)));
    continue;
  }

  const ans = parsed.value;
  const criteria = {};
  const missing = [];
  const unreadableVerdicts = [];
  for (const id of PV_IDS) {
    const raw = ans[id];
    if (raw === undefined || raw === null) { missing.push(id); continue; }
    const v = readVerdict(typeof raw === 'object' ? raw.verdict : raw);
    const evidence = scrub(typeof raw === 'object' ? raw.evidence : '', EVIDENCE_MAX);
    if (!v) { unreadableVerdicts.push(id); continue; }
    criteria[id] = { verdict: v, evidence: evidence || null };
  }

  if (missing.length || unreadableVerdicts.length) {
    stats.unreadable += 1;
    pair.letter_grade = { verdict: 'UNREADABLE', criteria: criteria, missing: missing, unreadable_verdicts: unreadableVerdicts };
    markHold(pair, 'grade_incomplete',
      'the blind grader answer is incomplete: ' + (missing.length ? 'missing ' + missing.join(', ') : '') +
      (missing.length && unreadableVerdicts.length ? '; ' : '') +
      (unreadableVerdicts.length ? 'unrecognised verdict on ' + unreadableVerdicts.join(', ') : '') +
      '. The five criteria are the whole contract of this stage and a partial answer is not a pass. D16 holds the pair.');
    continue;
  }

  // The top level verdict is RECOMPUTED. See header note 2.
  const failedCriteria = PV_IDS.filter((id) => criteria[id].verdict === 'FAIL');
  const computed = failedCriteria.length ? 'FAIL' : 'PASS';
  const claimed = readVerdict(ans.verdict);
  const contradiction = claimed && claimed !== computed;
  if (contradiction) stats.contradictions += 1;

  pair.letter_grade = {
    verdict: computed,
    claimed_verdict: claimed,
    contradiction: !!contradiction,
    criteria: criteria,
    failed: failedCriteria,
    rubric_source: 'work/23-self-review/close-out-grader/rubric.md, voice criteria, baked verbatim at build time',
    blind: 'the grader saw the letter and the rubric. It did not see the posting, the CV, the screening note, the audit result or any of the writer reasoning.',
    rule: 'D16. A FAIL holds the pair: not uploaded, sitting in needs_review with the reasons. The top level verdict is recomputed from the five criteria rather than believed, because trusting a summary field over the detail it summarises is how a grader quietly stops grading.',
  };
  for (const id of failedCriteria) failsByCriterion[id] = (failsByCriterion[id] || 0) + 1;

  if (computed === 'FAIL') {
    stats.failed += 1;
    const detail = failedCriteria.map((id) => id + ': ' + (criteria[id].evidence || 'no evidence given')).join(' | ');
    markHold(pair, 'grade_failed',
      'the blind grader failed the letter on ' + failedCriteria.join(', ') + '. ' + detail +
      '. D16: nothing that failed the voice check reaches Drive unattended. The CV and the letter are both on the pair, so shipping it by hand after a read is one decision rather than a rebuild.' +
      (contradiction ? ' Note that the grader own top level verdict said ' + claimed + ', which contradicts its own criteria; the recomputed verdict is the one that decides.' : ''));
    continue;
  }

  stats.passed += 1;
  stats.ready_to_ship += 1;
  pair._ready_to_ship = true;
  pair._call_now = false;
}

// --- 3. everything else passes through untouched --------------------------------
const outCarried = [];
for (const raw of carried) {
  const j = Object.assign({}, raw);
  j._call_now = false;
  outCarried.push(j);
}

// --- 4. the stage report ----------------------------------------------------------
if (pairing === 'mismatch') warnings.push('GRADE PAIRING REFUSED: ' + pairingWhy);
if (pairing === 'no_responses') warnings.push('THE GRADING NODE DID NOT RUN: ' + pairingWhy);
if (stats.failed > 0) {
  warnings.push(stats.failed + ' letter(s) FAILED the blind grade and are held, not uploaded (D16). The failing criteria are ' + JSON.stringify(failsByCriterion) + '. PV5, his words rather than generic English, is the load bearing one: the others are its symptoms.');
}
if (stats.unreadable > 0) {
  warnings.push(stats.unreadable + ' grading answer(s) could not be read and those pairs are held. An ungraded letter is treated exactly like a failed one, because D16 is about what reaches Drive unattended rather than about what a model managed to say.');
}
if (stats.contradictions > 0) {
  warnings.push(stats.contradictions + ' grading answer(s) carried a top level verdict that contradicted their own five criteria. The recomputed verdict decided in every case. Worth watching: a grader that summarises itself wrongly is one that may be answering from habit.');
}
if (stats.graded > 1 && cacheReads === 0 && stats.graded - stats.errored > 1) {
  warnings.push('THE GRADER PROMPT CACHE NEVER READ. The rubric block is identical for every pair and sits just above this model minimum cacheable prefix, so a zero here means the margin was thinner than the estimate or the calls fell outside the five minute window. It is the cheapest stage in the chain, so this is a note rather than an alarm.');
}

const report = {
  _kind: 'stage_report',
  stage: 'parse_grade',
  model: GRADE_MODEL,
  pairing: { state: pairing, why: pairingWhy, sent: called.length, responses: responses === null ? null : responses.length },
  counts: stats,
  fails_by_criterion: failsByCriterion,
  hold_kinds: holdKinds,
  error_kinds: errorKinds,
  http_status_codes: statusCodes,
  criteria: PV_IDS,
  rule: 'D16. A FAIL holds the pair. So does an unparseable answer, a truncated answer, a missing criterion, an unrecognised verdict and a call that never completed, because every one of those is a voice check that did not happen. The conservative direction is deliberate: being wrong this way costs a glance, being wrong the other way ships a letter under his name that nothing checked.',
  verdict_rule: 'the top level verdict is recomputed from the five criteria and the grader own summary field is recorded but never trusted.',
  cost: {
    actual_usd: usageTotals.cost_usd,
    usage: usageTotals,
    cache: { calls_with_a_cache_read: cacheReads, of_calls: stats.graded },
    prices: { model: GRADE_MODEL, in_per_mtok: PRICE_IN, out_per_mtok: PRICE_OUT, cache_write_mult: CACHE_WRITE_MULT, cache_read_mult: CACHE_READ_MULT },
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
    '// GENERATED at build time from work/36-job-application-writer/nodes/43-parse-grade.js.',
    '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
    'const GRADE_MODEL = ' + JSON.stringify(MODEL) + ';',
    'const PRICE_IN = ' + JSON.stringify(PRICE.in_per_mtok) + ';',
    'const PRICE_OUT = ' + JSON.stringify(PRICE.out_per_mtok) + ';',
    'const CACHE_WRITE_MULT = ' + JSON.stringify(PRICE.cache_write_mult) + ';',
    'const CACHE_READ_MULT = ' + JSON.stringify(PRICE.cache_read_mult) + ';',
    'const PV_IDS = ' + JSON.stringify(PV_IDS) + ';',
    'const EVIDENCE_MAX = ' + JSON.stringify(EVIDENCE_MAX) + ';',
    'const RAW_ANSWER_MAX = ' + JSON.stringify(RAW_ANSWER_MAX) + ';',
    'const SYSTEMIC_KINDS = ' + JSON.stringify(SYSTEMIC_KINDS) + ';',
    LOGIC,
  ].join('\n');
}

assertAgainstUpstream();

module.exports = {
  name: NODE_NAME,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [10660, 100],
  connectFrom: 'Grade Results',
  notes: 'Reads the five criterion verdicts and RECOMPUTES the top level one rather than believing the grader own summary field. D16 in full: a FAIL holds the pair, and so does an unparseable answer, a truncated answer, a missing criterion, an unrecognised verdict and a call that never completed, because every one of those is a voice check that did not happen and D16 is about what reaches Drive unattended. Evidence strings are scrubbed of control characters but NOT of dashes: a PV1 failure is usually evidenced by quoting the character that was found. A passing pair is stamped _ready_to_ship, which is what the render and upload half reads.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: renderJsCode(),
  },
};
