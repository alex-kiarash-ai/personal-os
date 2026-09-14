'use strict';
/*
 * 32-parse-score.js - "Parse Score". Turns Anthropic responses into `fit_score` and `fit_reasons`,
 * classifies every failure, prices the run off real usage, and hands Stage F one stream.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. THE ONE RULE ABOVE THE OTHERS: A FAILURE COSTS A NUMBER, NEVER A ROW.
 * ---------------------------------------------------------------------------------------------
 * Every path through this node keeps the row. A 4xx, a malformed answer, a truncated answer, a
 * response that never arrived, a count that does not line up: all of them stamp `score_status` and
 * a named `score_error_kind` and pass the row on. There is no branch here that returns fewer job
 * rows than it received. That is the structural answer to the thing Shaheen said broke the old
 * engines, that jobs "were filtered out" by a score that was wrong.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. content[0] IS NOT THE TEXT BLOCK. FILTER BY TYPE, ALWAYS.
 * ---------------------------------------------------------------------------------------------
 * A documented failure in this repo (root CLAUDE.md, error-log 2026-08-07): adaptive thinking puts
 * a thinking block FIRST, so a `content[0].text` reader returns undefined and every job fails
 * SILENTLY. This node filters `content[]` for `type === 'text'` and joins what it finds.
 *
 * The request deliberately sends no `thinking` key, which on claude-sonnet-4-6 means thinking is
 * off. The filter is here anyway and that is the point: a silent failure mode must not depend on a
 * setting staying off. Someone will switch models, or turn thinking on to see if scores improve,
 * and this node has to still work the next morning.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. WHY THE PAIRING COMES FROM Budget Gate AND NOT FROM $input.
 * ---------------------------------------------------------------------------------------------
 * `$input` here is the Merge output: responses and carried rows in whatever order the append
 * produced. An HTTP Request node does not carry its input fields through, so a response on its own
 * cannot say which job it belongs to.
 *
 * So the authority is `$('Budget Gate').all()`: the complete, ordered list of every item that
 * entered the scoring stage, including the ones that were never called. The rows admitted for
 * scoring, in that order, line up one for one with `$('Score Job').all()`, because an IF preserves
 * relative order and the HTTP node emits exactly one item per input item in order. `pairedItem` is
 * used as a cross-check where the node set it.
 *
 * If the two lengths disagree, this node does NOT guess an alignment. It marks every admitted row
 * `pairing_mismatch` and keeps all of them, because a wrong alignment would put one job's score on
 * another job's row, which is worse than no score and completely invisible on the sheet.
 *
 * ---------------------------------------------------------------------------------------------
 * 4. WHAT STAGE F SHOULD WRITE, AND THE HOLE THIS CLOSES.
 * ---------------------------------------------------------------------------------------------
 * A row written to the jobs tab is a row Remove Known deletes as "known" on the next run. So a row
 * written UNSCORED because of a temporary outage is a row that never gets scored, ever. It would
 * sit in Shaheen's sheet with an empty fit_score forever and nothing anywhere would say why.
 *
 * The report therefore splits the unscored rows in two, and Stage F acts on the split:
 *   HELD BACK   the failure is about the STAGE, not the row: no credits, bad key, rate limit, an
 *               upstream 5xx, a response that never came, a cost cap that bit. Do not write these
 *               and do not advance last_run_at. The next run re-collects the same window and scores
 *               them. This reuses the self-healing property Remove Known already relies on for its
 *               own cap, and it is the same shape.
 *   WRITTEN     the failure is about the ROW, or was deliberate: the model answered and the answer
 *               would not parse, the row has no title and no company, or scoring is switched off.
 *               Write these with an empty fit_score and a visible score_status. Holding them back
 *               would stall the window forever waiting for a row that will never succeed.
 *
 * ---------------------------------------------------------------------------------------------
 * 5. THE MODEL'S WORDS LAND IN A SPREADSHEET, SO THEY ARE SANITISED.
 * ---------------------------------------------------------------------------------------------
 * `fit_reasons` is a column in Shaheen's sheet, and its content is written by a model that just
 * read an attacker-controllable job ad. Three things happen to every string before it goes in:
 *   - control characters are stripped and the length is capped, per string and per list;
 *   - a leading =, +, - or @ is stripped, because a cell starting with one of those is a FORMULA in
 *     Google Sheets under USER_ENTERED. Stage F should write RAW, which stores it as text, but this
 *     node does not own Stage F and a defence that depends on another node's option is not one;
 *   - em dashes become ", " and en dashes become "-", the same substitution the live engines' QA
 *     node makes, because no output from this system carries either character.
 */

const { lane, settingsSchema } = require('./_lane');
const S = require('./_scoring');

const L = lane();
const PRICE = S.prices(L);

// Per-string and per-list caps. The prompt asks for 1 to 4 reasons under 140 characters; these are
// the enforcement, because a prompt is a request and a parser is a rule.
const REASON_MAX_CHARS = 200;
const FLAG_MAX_CHARS = 80;
const REASONS_MAX = 4;
const FLAGS_MAX = 4;

// Failure kinds that are about the STAGE. Every row would fail the same way, so holding them back
// and retrying next run is right. See header note 4.
const SYSTEMIC_KINDS = [
  'auth', 'credits', 'rate_limit', 'upstream', 'transport', 'not_found',
  'node_did_not_run', 'pairing_mismatch', 'too_large',
];
// Failure kinds that are about THIS ROW. Retrying forever would stall the window.
const ROW_KINDS = ['parse', 'schema', 'truncated', 'empty_text', 'bad_request'];

(function assertAgainstUpstream() {
  const merge = require('./31-score-results.js');
  const gate = require('./28-budget-gate.js');
  const job = require('./30-score-job.js');
  if (merge.name !== 'Score Results') throw new Error('Parse Score: node 31 is named ' + JSON.stringify(merge.name) + ' and this node connects from "Score Results".');
  if (gate.name !== 'Budget Gate') throw new Error('Parse Score: node 28 is named ' + JSON.stringify(gate.name) + ' and this node reads $(\'Budget Gate\') for the authoritative row order.');
  if (job.name !== 'Score Job') throw new Error('Parse Score: node 30 is named ' + JSON.stringify(job.name) + ' and this node reads $(\'Score Job\') for the responses.');

  // fullResponse is what makes a 4xx readable as data instead of invisible. Without it the status
  // code is gone and a credit error becomes an unexplained empty body.
  const resp = job.parameters.options && job.parameters.options.response && job.parameters.options.response.response;
  if (!resp || resp.fullResponse !== true || resp.neverError !== true) {
    throw new Error(
      'Parse Score: Score Job no longer sets fullResponse AND neverError. This node reads statusCode\n' +
      '  off the item to classify a credit error, an auth error and a rate limit apart from each\n' +
      '  other. Without them a 4xx either throws or arrives with no status at all, and the run cannot\n' +
      '  tell "no credits" from "no good jobs".'
    );
  }
  if (merge.parameters.numberInputs !== 2) {
    throw new Error('Parse Score: Score Results declares numberInputs ' + JSON.stringify(merge.parameters.numberInputs) + '. This node expects the two-input join.');
  }
  const SC = settingsSchema();
  if (SC.text.indexOf('score_scale') === -1) throw new Error('Parse Score: score_scale is no longer a text key in the settings schema, and the clamp reads it.');
  if (SC.number.indexOf('score_threshold') === -1) throw new Error('Parse Score: score_threshold is no longer a number in the settings schema.');

  const kinds = SYSTEMIC_KINDS.concat(ROW_KINDS);
  const dupe = kinds.find((k, i) => kinds.indexOf(k) !== i);
  if (dupe) throw new Error('Parse Score: failure kind ' + dupe + ' is listed as both systemic and row-level. Each kind decides whether a row is held back or written, so it can only be one.');
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// Parse Score. Read the answers, keep every row, price the run, report honestly.
// ---------------------------------------------------------------------------

// The authority on what entered this stage and in what order. $input is the Merge output and its
// order is not a contract; this is.
let gate;
try {
  gate = $('Budget Gate').all().map((i) => i.json);
} catch (e) {
  throw new Error('Parse Score: cannot reach Budget Gate (' + e.message + '). Every row and every report in this stage came from there, and without it this node has nothing to pass on.');
}

const gateJobs = gate.filter((j) => j && j._kind === 'job');
const carried = gate.filter((j) => j && j._kind !== 'job');
const admitted = gateJobs.filter((j) => j._score_now === true);

// The responses. The node is SKIPPED entirely when nothing was admitted, and that is normal, so a
// reference error here is information rather than a fault.
let responses = null;
let responseError = null;
try {
  responses = $('Score Job').all();
} catch (e) {
  responses = null;
  responseError = e.message;
}

// --- text helpers ------------------------------------------------------------
function stripDashes(s) {
  // The same substitution the live engines' QA node makes. No output from this system carries
  // either character, and the model is asked not to produce them; this is the enforcement.
  return String(s).split('\\u2014').join(', ').split('\\u2013').join('-');
}
function clean(s, cap) {
  let out = stripDashes(s === null || s === undefined ? '' : String(s));
  // Control characters, including the newlines and tabs that would break a single sheet cell.
  out = out.replace(/[\\u0000-\\u001F\\u007F]/g, ' ');
  out = out.replace(/\\s+/g, ' ').trim();
  // A cell beginning with one of these is a FORMULA in Google Sheets under USER_ENTERED. The model
  // just read an attacker-controllable job ad, so this is stripped here rather than trusted to a
  // write option in a node this one does not own.
  let stripped = 0;
  while (out.length && '=+-@'.indexOf(out[0]) !== -1) { out = out.slice(1).trim(); stripped += 1; }
  if (out.length > cap) out = out.slice(0, cap - 1).trim() + '\\u2026';
  return { text: out, formula_prefix_stripped: stripped };
}
function cleanList(v, cap, maxItems) {
  const arr = Array.isArray(v) ? v : (v === null || v === undefined || v === '' ? [] : [v]);
  let stripped = 0;
  const out = [];
  for (const raw of arr) {
    if (out.length >= maxItems) break;
    if (raw === null || raw === undefined) continue;
    const c = clean(typeof raw === 'string' ? raw : JSON.stringify(raw), cap);
    stripped += c.formula_prefix_stripped;
    if (c.text) out.push(c.text);
  }
  return { list: out, was_array: Array.isArray(v), dropped: Math.max(0, arr.length - out.length), formula_prefix_stripped: stripped };
}

// --- JSON out of a text answer ----------------------------------------------
// The prompt asks for a bare object. This tolerates the two things a model does anyway: a fenced
// block, and a sentence before or after. It never tolerates guessing at a shape.
function extractJson(text) {
  const t = String(text || '').trim();
  if (!t) return { ok: false, why: 'the response carried no text block at all' };
  const tries = [];
  tries.push(t);
  const fence = t.match(/\\\\\\\\\(?:json)?\\s*([\\s\\S]*?)\\\\\\\\\/i);
  if (fence) tries.push(fence[1].trim());
  // The first balanced { ... } in the string, scanned with string awareness so a brace inside a
  // quoted reason cannot end the object early.
  const start = t.indexOf('{');
  if (start !== -1) {
    let depth = 0; let inStr = false; let esc = false;
    for (let i = start; i < t.length; i += 1) {
      const ch = t[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) { tries.push(t.slice(start, i + 1)); break; }
      }
    }
  }
  for (const candidate of tries) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ok: true, value: parsed, used_fallback: candidate !== t };
      }
    } catch (e) { /* try the next shape */ }
  }
  return { ok: false, why: 'no JSON object could be parsed out of the response text', sample: t.slice(0, 200) };
}

// --- the score scale ---------------------------------------------------------
// Same regex Parse Settings validates score_threshold with, so the two can never disagree about
// what "0-100" means.
function scaleOf(raw) {
  const m = /^\\s*(-?\\d+(?:\\.\\d+)?)\\s*-\\s*(-?\\d+(?:\\.\\d+)?)\\s*$/.exec(String(raw || ''));
  if (!m) return null;
  return { lo: Number(m[1]), hi: Number(m[2]) };
}

// --- usage into money --------------------------------------------------------
function costOf(usage) {
  const u = usage || {};
  const inTok = Number(u.input_tokens) || 0;
  const outTok = Number(u.output_tokens) || 0;
  const cw = Number(u.cache_creation_input_tokens) || 0;
  const cr = Number(u.cache_read_input_tokens) || 0;
  const usd =
    (inTok / 1e6) * PRICE_IN +
    (cw / 1e6) * PRICE_IN * CACHE_WRITE_MULT +
    (cr / 1e6) * PRICE_IN * CACHE_READ_MULT +
    (outTok / 1e6) * PRICE_OUT;
  return {
    input_tokens: inTok,
    output_tokens: outTok,
    cache_creation_input_tokens: cw,
    cache_read_input_tokens: cr,
    cost_usd: Math.round(usd * 1e6) / 1e6,
  };
}

// --- classify a non-2xx ------------------------------------------------------
function classify(status, body) {
  const errType = (body && body.error && body.error.type) ? String(body.error.type) : '';
  const msg = (body && body.error && body.error.message) ? String(body.error.message) : '';
  const looksLikeCredits = /credit|balance|quota|insufficient|billing/i.test(msg);
  if (status === 401 || status === 403) return { kind: 'auth', why: 'the API key was refused (' + status + '). ' + (msg || errType || 'no message') };
  if (status === 402) return { kind: 'credits', why: 'payment required (402). ' + (msg || 'no message') };
  if (status === 429) return { kind: 'rate_limit', why: 'rate limited (429). ' + (msg || 'no message') };
  if (status >= 500) return { kind: 'upstream', why: 'the API returned ' + status + '. ' + (msg || 'no message') };
  if (status === 413) return { kind: 'too_large', why: 'the request was rejected as too large (413). ' + (msg || 'no message') };
  if (status === 404) return { kind: 'not_found', why: 'the endpoint or the model was not found (404). ' + (msg || 'no message') };
  if (status === 400) {
    if (looksLikeCredits) {
      return {
        kind: 'credits',
        why: 'HTTP 400 invalid_request_error and the message names credit or balance: ' + msg +
          '. Anthropic reports an exhausted balance as a 400 rather than a 402, so this is an ACCOUNT ' +
          'state and not a bad request. Nothing in this workflow needs changing; the account needs topping up.',
      };
    }
    return { kind: 'bad_request', why: 'HTTP 400 ' + (errType || '') + '. ' + (msg || 'no message') + ' This one is about the request this node built, not about the account.' };
  }
  return { kind: 'http_' + status, why: 'HTTP ' + status + '. ' + (msg || errType || 'no message') };
}

// --- 1. pair the responses to the rows --------------------------------------
const perRow = new Map();
let pairing = 'ok';
let pairingWhy = null;

if (admitted.length === 0) {
  pairing = 'nothing_admitted';
  pairingWhy = 'no row was admitted for scoring, so there is nothing to pair. That is scoring switched off, a quiet day, or a budget that refused to spend, and Budget Gate says which.';
} else if (responses === null) {
  pairing = 'no_responses';
  pairingWhy = 'Budget Gate admitted ' + admitted.length + ' row(s) but the Score Job node produced no run data (' +
    (responseError || 'unknown') + '). The node did not execute. Every admitted row is kept and marked, and none of them is written, so the next run tries again.';
} else if (responses.length !== admitted.length) {
  pairing = 'mismatch';
  pairingWhy = 'Budget Gate admitted ' + admitted.length + ' row(s) and Score Job returned ' + responses.length +
    '. Refusing to guess an alignment: a wrong one puts one job\\'s score on another job\\'s row, which is worse than no score and invisible on the sheet.';
}

// pairedItem cross-check, where the HTTP node set it. Position is the primary and this is the
// second opinion; a disagreement downgrades the whole batch rather than silently trusting one.
if (pairing === 'ok') {
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

// --- 2. read each answer ------------------------------------------------------
let scoredOk = 0;
const errorKinds = {};
const statusCodes = {};
const usageTotals = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cost_usd: 0 };
let cacheReads = 0;
let cacheWrites = 0;
let clamped = 0;
let coercedWorkMode = 0;
let formulaPrefixesStripped = 0;
let fencedAnswers = 0;
const errorSamples = [];

function markError(row, kind, why, extra) {
  row.score_status = 'score_error';
  row.score_error_kind = kind;
  row.score_error = why;
  row.fit_score = null;
  row.fit_reasons = '';
  errorKinds[kind] = (errorKinds[kind] || 0) + 1;
  if (errorSamples.length < 5) errorSamples.push({ job_id: row.job_id, kind: kind, why: String(why).slice(0, 240) });
  row._score = Object.assign({}, row._score, { error: Object.assign({ kind: kind, why: why }, extra || {}) });
}

for (let i = 0; i < admitted.length; i += 1) {
  const src = admitted[i];
  const row = Object.assign({}, src);
  perRow.set(src.job_id === null || src.job_id === undefined ? '__idx' + i : String(src.job_id) + '#' + i, row);

  if (pairing === 'no_responses') { markError(row, 'node_did_not_run', pairingWhy); continue; }
  if (pairing === 'mismatch') { markError(row, 'pairing_mismatch', pairingWhy); continue; }

  const item = responses[i] || {};
  const j = item.json || {};

  // An n8n error item, from onError continueRegularOutput on a transport failure.
  if (j.error !== undefined && j.statusCode === undefined) {
    markError(row, 'transport', 'the request never completed: ' + String(typeof j.error === 'string' ? j.error : (j.error && j.error.message) || JSON.stringify(j.error)).slice(0, 240));
    continue;
  }

  const status = Number(j.statusCode);
  const body = j.body;
  if (!isFinite(status)) {
    markError(row, 'transport', 'the response carried no statusCode. fullResponse is set on Score Job, so a missing status means the item is not an HTTP response at all.');
    continue;
  }
  statusCodes[String(status)] = (statusCodes[String(status)] || 0) + 1;

  if (status < 200 || status >= 300) {
    const c = classify(status, body);
    markError(row, c.kind, c.why, { http_status: status });
    row._score.error.http_status = status;
    continue;
  }

  // 2xx. Price it whatever the content turns out to be: the tokens were spent.
  const usage = costOf(body && body.usage);
  usageTotals.input_tokens += usage.input_tokens;
  usageTotals.output_tokens += usage.output_tokens;
  usageTotals.cache_creation_input_tokens += usage.cache_creation_input_tokens;
  usageTotals.cache_read_input_tokens += usage.cache_read_input_tokens;
  usageTotals.cost_usd = Math.round((usageTotals.cost_usd + usage.cost_usd) * 1e6) / 1e6;
  if (usage.cache_read_input_tokens > 0) cacheReads += 1;
  if (usage.cache_creation_input_tokens > 0) cacheWrites += 1;
  row.cost_usd = usage.cost_usd;
  row._score = Object.assign({}, row._score, { usage: usage, http_status: status, stop_reason: (body && body.stop_reason) || null });

  // THE FILTER. content[0] is not the text block. See header note 2.
  const content = (body && Array.isArray(body.content)) ? body.content : [];
  const textBlocks = content.filter((b) => b && b.type === 'text');
  const nonText = content.length - textBlocks.length;
  row._score.content_blocks = { total: content.length, text: textBlocks.length, non_text: nonText, types: content.map((b) => (b && b.type) || 'unknown') };
  const text = textBlocks.map((b) => String(b.text === undefined || b.text === null ? '' : b.text)).join('\\n').trim();

  if (!text) {
    const stop = (body && body.stop_reason) || 'unknown';
    markError(row, 'empty_text', 'the response carried ' + content.length + ' content block(s) and none of them was a text block (types: ' +
      JSON.stringify(row._score.content_blocks.types) + ', stop_reason ' + stop + ').', { http_status: status });
    continue;
  }

  const parsed = extractJson(text);
  if (!parsed.ok) {
    const stop = (body && body.stop_reason) || 'unknown';
    const kind = stop === 'max_tokens' ? 'truncated' : 'parse';
    markError(row, kind,
      (kind === 'truncated'
        ? 'the answer hit max_tokens and the JSON is cut off, so it will not parse. '
        : '') + parsed.why + '. First 200 characters: ' + JSON.stringify(String(parsed.sample || text).slice(0, 200)),
      { http_status: status });
    continue;
  }
  if (parsed.used_fallback) fencedAnswers += 1;

  const ans = parsed.value;
  const raw = Number(ans.fit_score);
  if (!isFinite(raw)) {
    markError(row, 'schema', 'fit_score came back as ' + JSON.stringify(ans.fit_score) + ', which is not a number. The score is the point of the call, so this row is kept with no score rather than with a made-up one.', { http_status: status });
    continue;
  }

  const sc = scaleOf((src._score && src._score.budget && src._score.budget.score_scale) || DEFAULT_SCALE) || { lo: 0, hi: 100 };
  let score = Math.round(raw);
  let wasClamped = false;
  if (score < sc.lo) { score = sc.lo; wasClamped = true; }
  if (score > sc.hi) { score = sc.hi; wasClamped = true; }
  if (wasClamped) clamped += 1;

  const reasons = cleanList(ans.fit_reasons, REASON_MAX_CHARS, REASONS_MAX);
  const flags = cleanList(ans.red_flags, FLAG_MAX_CHARS, FLAGS_MAX);
  formulaPrefixesStripped += reasons.formula_prefix_stripped + flags.formula_prefix_stripped;

  let workMode = typeof ans.work_mode === 'string' ? ans.work_mode.trim().toLowerCase() : '';
  let workModeCoerced = false;
  if (WORK_MODES.indexOf(workMode) === -1) { workMode = 'unclear'; workModeCoerced = true; coercedWorkMode += 1; }

  // The model REPORTS the language; this node decides what it means. The mapping is deliberately NOT
  // a vocabulary check, and the first version of it was, which is the bug this comment exists for.
  // The rubric asks for "other", but a model naming the actual language ("german", "polish") is at
  // least as likely, and coercing every unrecognised string to 'unknown' made those KEPT, silently
  // re-creating the exact problem the gate was built to fix. So: an ABSENT or unreadable answer is
  // 'unknown' and is kept, because that is a fact about the answer. A NAMED language that is not one
  // he reads is 'other' and is dropped, whatever name it arrives under.
  const AD_ALLOWED = ['english', 'swedish', 'arabic'];
  const rawLang = typeof ans.posting_language === 'string' ? ans.posting_language.trim().toLowerCase() : '';
  let postingLanguage;
  if (rawLang === '' || rawLang === 'unknown') postingLanguage = 'unknown';
  else if (AD_ALLOWED.indexOf(rawLang) !== -1) postingLanguage = rawLang;
  else postingLanguage = 'other';
  const postingLanguageRaw = rawLang;

  const extraKeys = Object.keys(ans).filter((k) => ['fit_score', 'fit_reasons', 'work_mode', 'red_flags', 'posting_language'].indexOf(k) === -1);

  const threshold = (src._score && src._score.budget && src._score.budget.score_threshold);
  row.score_status = 'scored';
  row.score_error_kind = null;
  row.score_error = null;
  row.fit_score = score;
  // A STRING, because fit_reasons is one cell in the jobs tab. The array survives on _score for
  // anything that wants the structure.
  row.fit_reasons = reasons.list.join('; ');
  row._score = Object.assign({}, row._score, {
    fit_score_raw: raw,
    clamped: wasClamped,
    scale: sc,
    fit_reasons: reasons.list,
    red_flags: flags.list,
    work_mode: workMode,
    work_mode_coerced: workModeCoerced,
    posting_language: postingLanguage,
    posting_language_reported: postingLanguageRaw,
    ad_language_allowed: ALLOWED_AD_LANGUAGES.indexOf(postingLanguage) !== -1 || postingLanguage === 'unknown',
    extra_keys_ignored: extraKeys,
    // THE THRESHOLD MARKS. IT NEVER DELETES. Nothing downstream may read this as a filter.
    above_threshold: isFinite(Number(threshold)) ? score >= Number(threshold) : null,
    threshold: isFinite(Number(threshold)) ? Number(threshold) : null,
    threshold_rule: 'the threshold MARKS a row and sets sort order. It never removes one. Every scored row reaches the sheet whatever it scored.',
    answer_was_fenced_or_wrapped: parsed.used_fallback === true,
  });
  scoredOk += 1;
}

// --- 3. put the stream back together -----------------------------------------
const admittedOut = [];
for (const row of perRow.values()) admittedOut.push(row);

const notAdmitted = gateJobs.filter((j) => j._score_now !== true).map((j) => Object.assign({}, j));
const allJobs = admittedOut.concat(notAdmitted);

// --- 4. what Stage F should do with each row ---------------------------------
function holdBack(row) {
  if (row.score_status === 'scored') return false;
  if (row.score_status === 'budget_hit') return true;         // written nowhere, must come back
  if (row.score_status === 'scoring_unavailable') return true; // the settings read failed, retry
  if (row.score_status === 'score_error') return SYSTEMIC_KINDS.indexOf(row.score_error_kind) !== -1;
  return false; // scoring_off and no_content are deliberate or permanent: write them, visibly
}
let held = 0;
for (const row of allJobs) {
  const hb = holdBack(row);
  row.write_to_sheet = !hb;
  row.write_to_sheet_why = hb
    ? 'HELD BACK. ' + (row.score_status === 'budget_hit'
      ? 'The per-run budget refused this row, so it was never scored and is written nowhere. Advancing last_run_at would lose it permanently.'
      : 'The failure is about the scoring stage rather than about this row (' + (row.score_error_kind || row.score_status) + '), so writing it now would make Remove Known delete it as known next run and it would never be scored at all.')
    : (row.score_status === 'scored'
      ? 'scored, write it'
      : 'write it unscored and visibly: ' + (row.score_error_kind ? 'the model answered and the answer would not parse (' + row.score_error_kind + '), which will not fix itself by waiting' : row.score_status));
  if (hb) held += 1;
}

// --- 4b. the ad-language gate, AFTER the write decisions and deliberately outside held --------
// A row the model reports as written in a language Shaheen cannot read is dropped: not written, and
// not held. Dropping is permanent by design, so it must not touch held, which exists to stop the
// window advancing past rows that still have to come back. unknown is kept, because the only way a
// row goes unknown is that our own detail budget never fetched its description.
let languageDropped = 0;
const languageDroppedBy = {};
for (const row of allJobs) {
  if (row.score_status !== 'scored') continue;          // never drop a row nobody read
  const lang = (row._score && row._score.posting_language) || 'unknown';
  if (lang === 'unknown') continue;                      // Shaheen 2026-09-14: keep, do not guess
  if (ALLOWED_AD_LANGUAGES.indexOf(lang) !== -1) continue;
  // The DECISION normalises a named language to 'other'. What Shaheen READS must not: a row saying
  // it was dropped for being written in 'other' tells him nothing, and the whole point of this gate
  // is that he can see why a job he might have wanted never reached him. So the reason and the
  // counts use the language the model actually named, and fall back to the normalised value only
  // when there was no name to use.
  const shown = (row._score && row._score.posting_language_reported) || lang;
  row.write_to_sheet = false;
  row.write_to_sheet_why = 'DROPPED: the posting is written in ' + shown + ', which is not one of '
    + ALLOWED_AD_LANGUAGES.join(', ') + '. He cannot work in it, so the skills fit does not matter. '
    + 'This is a permanent drop and it does NOT hold the window: the row is not coming back.';
  row.score_status = 'dropped_language';
  languageDropped += 1;
  languageDroppedBy[shown] = (languageDroppedBy[shown] || 0) + 1;
}

// --- 5. the stage report ------------------------------------------------------
const gateReport = carried.find((j) => j && j._kind === 'stage_report' && j.stage === 'score_budget') || null;
const removeKnownReport = carried.find((j) => j && j._kind === 'stage_report' && j.stage === 'remove_known') || null;

const warnings = [];
let verdict = 'ok';
let statusToken = null;
let httpStatusSeen = null;

const attempted = admitted.length;
const failed = attempted - scoredOk;
const systemicKindsSeen = Object.keys(errorKinds).filter((k) => SYSTEMIC_KINDS.indexOf(k) !== -1);
const dominantKind = Object.keys(errorKinds).sort((a, b) => errorKinds[b] - errorKinds[a])[0] || null;
const statusList = Object.keys(statusCodes).filter((s) => Number(s) < 200 || Number(s) >= 300);
if (statusList.length) httpStatusSeen = Number(statusList.sort((a, b) => statusCodes[b] - statusCodes[a])[0]);

if (attempted > 0 && scoredOk === 0) {
  verdict = 'down';
  statusToken = 'scoring_down:' + (dominantKind || 'unknown') + (httpStatusSeen ? ':' + httpStatusSeen : '');
  warnings.push(
    'SCORING IS DOWN. ' + attempted + ' row(s) were sent and NONE came back with a usable score. ' +
    'Dominant failure: ' + dominantKind + (httpStatusSeen ? ' (HTTP ' + httpStatusSeen + ')' : '') + '. ' +
    (errorSamples.length ? 'First reason: ' + errorSamples[0].why + ' ' : '') +
    'This is a DEGRADED run, not a run with no good jobs. No job row is written and last_run_at must ' +
    'not advance, so the next run re-collects the same window and scores it.'
  );
} else if (failed > 0) {
  verdict = 'degraded';
  statusToken = 'scoring_degraded:' + (dominantKind || 'unknown');
  warnings.push(
    failed + ' of ' + attempted + ' scored row(s) failed (' + JSON.stringify(errorKinds) + '). The rest scored ' +
    'normally. Rows whose failure is about the stage are held back for the next run; rows whose answer ' +
    'simply would not parse are written unscored so they stay visible.'
  );
}
if (errorKinds.credits) {
  warnings.push(
    'THE ANTHROPIC ACCOUNT IS OUT OF CREDIT. This is expected right now and it is Shaheen\\'s own ' +
    'decision: human-action anthropic-api-credits-run89 has been open since 2026-08-08 and he tops up ' +
    'after this build is finished. Nothing in this workflow needs changing. Everything except the score ' +
    'ran normally, and the rows are held for the next run rather than written blank.'
  );
}
if (errorKinds.auth) {
  warnings.push('THE ANTHROPIC KEY WAS REFUSED. Check the n8n credential for this lane. If the message is about an HTTP Request node rather than about the key, the credential\\'s "Allowed HTTP Request Domains" setting is on "None" and needs to be "All" or to list api.anthropic.com.');
}
if (pairing === 'mismatch') {
  warnings.push('PAIRING MISMATCH, and no score was applied to any row because of it: ' + pairingWhy + ' Every row is kept and held back.');
}
if (attempted > 1 && cacheReads === 0 && scoredOk > 1) {
  warnings.push(
    'THE PROMPT CACHE NEVER READ. ' + scoredOk + ' successful call(s) and cache_read_input_tokens was 0 on ' +
    'every one, so the CV was paid for at full price each time instead of once. The usual causes are a ' +
    'system block that changed between calls, a gap of more than five minutes between calls, or a prefix ' +
    'under the model minimum. Cost is the only symptom; the scores are unaffected.'
  );
}
if (clamped > 0) warnings.push(clamped + ' score(s) came back outside the declared scale and were clamped. A model that regularly overshoots the scale is a prompt problem, not a data problem.');
if (formulaPrefixesStripped > 0) {
  warnings.push(
    formulaPrefixesStripped + ' model string(s) began with =, +, - or @ and had it stripped. A cell that starts ' +
    'with one of those is a FORMULA in Google Sheets. This is worth reading as a possible injection attempt ' +
    'through a job ad, not just as punctuation.'
  );
}
if (errorKinds.parse || errorKinds.schema) {
  warnings.push((errorKinds.parse || 0) + ' answer(s) would not parse and ' + (errorKinds.schema || 0) + ' had the wrong shape. These rows are written unscored and visible, because waiting will not fix them.');
}

const rkSafe = removeKnownReport ? removeKnownReport.advance_last_run_at_safe === true : false;
const advanceSafe = rkSafe && held === 0 && verdict !== 'down';

const report = {
  _kind: 'stage_report',
  stage: 'score',
  lane: LANE_NUMBER,
  verdict: verdict,
  status_token: statusToken,
  model: MODEL,
  http_status_seen: httpStatusSeen,
  counts: {
    jobs_in: gateJobs.length,
    admitted: attempted,
    scored: scoredOk,
    failed: failed,
    by_status: allJobs.reduce((acc, j) => { acc[j.score_status] = (acc[j.score_status] || 0) + 1; return acc; }, {}),
    error_kinds: errorKinds,
    http_status_codes: statusCodes,
    error_samples: errorSamples,
  },
  pairing: { state: pairing, why: pairingWhy, admitted: attempted, responses: responses === null ? null : responses.length },
  threshold: {
    value: gateReport && gateReport.budget ? gateReport.budget.score_threshold : null,
    scale: gateReport && gateReport.budget ? gateReport.budget.score_scale : null,
    above: allJobs.filter((j) => j._score && j._score.above_threshold === true).length,
    below: allJobs.filter((j) => j._score && j._score.above_threshold === false).length,
    rule: 'THE THRESHOLD MARKS, IT NEVER DELETES. It sets sort order and nothing else. Every row here reaches the sheet on its own merits, and a wrong score costs a place in a list rather than a job.',
  },
  cost: {
    actual_usd: usageTotals.cost_usd,
    estimated_usd: gateReport && gateReport.cost_estimate ? gateReport.cost_estimate.est_total_usd : null,
    cap_usd: gateReport && gateReport.budget ? gateReport.budget.max_cost_per_run_usd : null,
    usage: usageTotals,
    cache: { calls_with_a_cache_read: cacheReads, calls_that_wrote_cache: cacheWrites, of_calls: scoredOk },
    prices: { in_per_mtok: PRICE_IN, out_per_mtok: PRICE_OUT, cache_write_mult: CACHE_WRITE_MULT, cache_read_mult: CACHE_READ_MULT },
  },
  quality: {
    clamped: clamped,
    work_mode_coerced: coercedWorkMode,
    answers_needing_a_fence_or_wrapper_strip: fencedAnswers,
    formula_prefixes_stripped: formulaPrefixesStripped,
  },
  ad_language: {
    allowed: ALLOWED_AD_LANGUAGES,
    dropped: languageDropped,
    dropped_by_language: languageDroppedBy,
    kept_unknown: allJobs.filter((j) => j._score && j._score.posting_language === 'unknown').length,
    rule: 'the model REPORTS the language, this node DECIDES. A drop is permanent and is deliberately NOT counted in rows_held_back, because held exists to stop last_run_at advancing past rows that must come back and a dropped row never comes back. unknown is KEPT: it means our own detail budget never fetched a description, which is a fact about the run and not about the job.',
  },
  for_stage_f: {
    rows_to_write: allJobs.filter((j) => j.write_to_sheet).length,
    rows_held_back: held,
    hold_back_rule: 'a row whose failure is about the SCORING STAGE is held back so the next run can score it. A row whose own answer would not parse is written unscored so it stays visible. A held-back row is written NOWHERE, so last_run_at must not advance while any exist.',
    advance_last_run_at_safe: advanceSafe,
    advance_last_run_at_why: !rkSafe
      ? 'Remove Known already said no: ' + ((removeKnownReport && removeKnownReport.advance_last_run_at_why) || 'its report did not reach this node')
      : (held > 0
        ? held + ' row(s) are held back and written nowhere. Advancing the window would lose them permanently.'
        : (verdict === 'down'
          ? 'scoring is down, so nothing was scored and the window has not really been covered'
          : 'every row was scored or deliberately written unscored, so the window is genuinely covered')),
    columns_without_a_home: {
      work_mode: 'the model returns it and shared_row_shape has no column for it. It rides on _score.work_mode. The row DOES have a collector-derived remote field and this node deliberately never overwrites it: a model read must not replace a collected fact.',
      red_flags: 'same. On _score.red_flags. If Stage F wants these in the sheet, the row shape grows a column and the jobs tab header changes in the SAME session, per the Stage A handoff.',
    },
  },
  warnings: warnings,
};

// --- 6. out. Every job row, every report, then this one. Never an empty array. -
// _score_now was only ever a routing field for Score Route and it must not reach the sheet.
function strip(j) { const o = Object.assign({}, j); delete o._score_now; return o; }
const jobItems = allJobs.map((j) => ({ json: strip(j), pairedItem: { item: 0 } }));
const carriedItems = carried.map((j) => ({ json: strip(j), pairedItem: { item: 0 } }));
return jobItems.concat(carriedItems, [{ json: report, pairedItem: { item: 0 } }]);
`;

// THE AD-LANGUAGE GATE (Shaheen, 2026-09-14). He can read English, Swedish and Arabic. A posting
// published in any other language is not a job he can take, however well it scores on skills: the
// first scored run returned ten strong in-lane roles and the three he opened were in languages he
// does not speak. The MODEL only REPORTS the language; this node decides. That split is deliberate
// and it is the same one the rest of the lane uses: a model that both judged and dropped could be
// argued out of the drop by the posting itself.
//
// NOT counted in `held`, and that is the load-bearing detail. `held` blocks last_run_at from
// advancing because a held row must come back next run. A language drop is PERMANENT, so counting
// it as held would hold the window open forever on rows we never intend to fetch again.
//
// `unknown` is KEPT (Shaheen's call, same day). A row is unknown when the description never arrived
// because our own LinkedIn detail budget ran out. That is a fact about this run, not about the job,
// and dropping on it would bin real Swedish and English roles silently.
const ALLOWED_AD_LANGUAGES = ['english', 'swedish', 'arabic'];

const jsCode = [
  '// GENERATED at build time from work/34-job-search-bi/nodes/32-parse-score.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  `const MODEL = ${JSON.stringify(L.model)};`,
  `const PRICE_IN = ${JSON.stringify(PRICE.in_per_mtok)};`,
  `const PRICE_OUT = ${JSON.stringify(PRICE.out_per_mtok)};`,
  `const CACHE_WRITE_MULT = ${JSON.stringify(PRICE.cache_write_mult)};`,
  `const CACHE_READ_MULT = ${JSON.stringify(PRICE.cache_read_mult)};`,
  `const WORK_MODES = ${JSON.stringify(S.WORK_MODES)};`,
  `const ALLOWED_AD_LANGUAGES = ${JSON.stringify(ALLOWED_AD_LANGUAGES)};`,
  `const SYSTEMIC_KINDS = ${JSON.stringify(SYSTEMIC_KINDS)};`,
  `const REASON_MAX_CHARS = ${JSON.stringify(REASON_MAX_CHARS)};`,
  `const FLAG_MAX_CHARS = ${JSON.stringify(FLAG_MAX_CHARS)};`,
  `const REASONS_MAX = ${JSON.stringify(REASONS_MAX)};`,
  `const FLAGS_MAX = ${JSON.stringify(FLAGS_MAX)};`,
  `const DEFAULT_SCALE = ${JSON.stringify('0-100')};`,
  `const LANE_NUMBER = ${JSON.stringify(String(L.lane))};`,
  LOGIC,
].join('\n');

module.exports = {
  name: 'Parse Score',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [5460, 160],
  connectFrom: 'Score Results',
  notes: 'Filters content[] for text blocks, parses the JSON, clamps to the declared scale, prices the run off real usage, and classifies every failure by kind. Keeps every row on every path: a 4xx, a bad answer or a missing response costs a number, never a job. Tells Stage F which rows to write and which to hold for the next run.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};
