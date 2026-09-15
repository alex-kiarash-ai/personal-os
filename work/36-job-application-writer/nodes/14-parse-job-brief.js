'use strict';
/*
 * 14-parse-job-brief.js - "Parse Job Brief". The node that turns the recruiter read into a brief,
 * decides which pairs are allowed to become an application, and closes the cap.
 *
 * =============================================================================================
 * 1. content[0] IS NOT THE TEXT BLOCK, AND ON THIS MODEL THAT IS NOT A PRECAUTION.
 * =============================================================================================
 * A documented failure in this repo (root CLAUDE.md, error-log 2026-08-07): adaptive thinking puts
 * a thinking block FIRST, so a `content[0].text` reader returns undefined and every job fails
 * SILENTLY. Both live engines lost every job that way.
 *
 * On the collectors that trap is theoretical, because they send no `thinking` key to
 * claude-sonnet-4-6 and on that model omitting it means thinking is off. HERE IT IS NOT
 * THEORETICAL. Read Job runs claude-opus-5, and on claude-opus-5 omitting `thinking` runs ADAPTIVE
 * thinking: it is on by default. With the default display the thinking block comes back FIRST and
 * carries empty text, so a content[0] reader on this node would return an empty string on every
 * single call and report every posting as unreadable, forever, with a green run and a zero.
 *
 * So the filter is `content.filter(b => b.type === 'text')` and the join of what it finds, and the
 * block types actually seen are recorded on every pair so the next person can see the thinking
 * block rather than take this comment on faith.
 *
 * =============================================================================================
 * 2. THE PAIRING COMES FROM Read Route, AND A MISMATCH REFUSES.
 * =============================================================================================
 * Same rule as the collectors Parse Score and same reason. `$input` is the Merge output and its
 * order is not a contract. $('Read Route').all(0) is: the true-branch items in the order they were
 * sent, lining up one for one with $('Read Job').all(). pairedItem is the second opinion, and Build
 * Read Request supplies a third independent count.
 *
 * A mismatch stamps error:pairing on the whole read batch and applies NO brief to anything. One
 * job brief on another job pair writes a perfect application for the wrong company.
 *
 * =============================================================================================
 * 3. D10, AS AMENDED 2026-09-15. WORK TYPE IS A SCOPE QUESTION, NOT A GLOBAL BLOCK.
 * =============================================================================================
 * The approved D10 blocked "onsite only (outside Sweden)". His instruction of 2026-09-14 night
 * replaced it: "Make it like this Sweden and EMEA (hybrid, onsite, remote), Euorope and UK ( remote
 * only)", then, asked which EMEA markets he meant, "the gulf and non EU europe, and stop dropping
 * them".
 *
 * So a pair is blocked for work type ONLY where the collecting scope is remote only AND the row is
 * demonstrably not remote. Remote EU and Remote UK are the two remote-only scopes: he has no UK
 * right to work, so an onsite London role can never become an application. Sweden, the Gulf and
 * non-EU Europe accept onsite, hybrid and remote alike, so an onsite role in Dubai, Doha, Riyadh,
 * Zurich or Oslo is a CV worth writing and must NOT be blocked.
 *
 * WHERE THE WORK TYPE IS UNSTATED, THE CV IS WRITTEN. Most sources in this pipeline cannot state
 * it, LinkedIn only infers it from the request, and the two newest scopes send no work-type filter
 * by design, so a row from them arrives with work type null. Treating null as onsite would silently
 * block the entire Gulf and non-EU Europe intake while every count upstream looked healthy. The
 * reader is briefed to answer null rather than guess, and null passes.
 *
 * The Swedish-fluent-required block is unchanged. Contract, freelance and below-level seniority
 * still get written, unchanged, and neither is even looked at here.
 *
 * WHAT THE SHEET DOES NOT CARRY, and it changes how this gate is wired. The amendment says to
 * branch on the `_filter.scope` the collector already decided rather than re-deriving geography.
 * That field lives inside the collector workflow; the jobs TAB is fifteen columns and none of them
 * is scope. See the note on collectorScopes() in _lane.js. Build Candidates therefore RECOVERS the
 * scope from the location cell using the collector own token table and precedence order, read out
 * of 20-filter.js at build time, and stamps scope_source recovered_from_location. This gate reads
 * that stamp and never re-derives anything itself, and when the scope could not be recovered at all
 * it does not block: an unresolved scope is an absent fact, and blocking on an absent fact is the
 * exact failure the amendment names.
 *
 * A ROW THAT VIOLATES ITS OWN SCOPE RULE IS A SIGNAL ABOUT THE COLLECTOR. The amendment says the
 * run report should say so rather than silently absorb it, so every work-type block is ALSO counted
 * as a collector signal with the scope and the evidence, because a remote-only scope should not be
 * delivering demonstrably onsite rows in the first place.
 *
 * =============================================================================================
 * 4. D17. A RIGHT-TO-WORK REQUIREMENT IS AN OBJECTION AND NEVER A BLOCK.
 * =============================================================================================
 * His words, 2026-09-14: "I want also to add UK remote positions to the plan". A UK ad that asks
 * for UK right to work is NOT blocked, because he asked for these jobs. The reader records it, it
 * becomes one of the three objections, and the letter opener answers it honestly: Swedish and EU
 * citizen, Stockholm, remote. It never claims UK work rights. If he ever wants that to block
 * instead, it is one settings cell, and this node is where it would read it.
 *
 * =============================================================================================
 * 5. D18. THE UC CONTEXT FLAG.
 * =============================================================================================
 * `uc_context_required` is true when the employer country is not Sweden, and UNKNOWN COUNTS AS
 * OUTSIDE. His reason: a reader who does not know UC AB needs two lines about it, and a reader who
 * does would find them redundant. Unknown counts as outside because the cost is asymmetric: two
 * unnecessary lines for a Swedish reader is a slightly long letter, while a missing introduction
 * for a foreign reader loses the whole point of the strongest fact on the CV.
 *
 * =============================================================================================
 * 6. THE CAP GATE RUNS HERE, AFTER THE VERDICTS. THIS IS DESIGN DEFECT 6.
 * =============================================================================================
 * Intake admitted cap + 2. This is where the real cap closes: the top `cap` ALIVE, non-blocked
 * pairs per lane continue, and the rest are stamped skipped:cap. Running the cap at intake instead
 * would mean a cap consumed by blocked pairs under delivers, and the overshoot would be pointless.
 *
 * The ordering is the one Build Candidates already computed and stamped as `rank`, so the cap gate
 * does not re-sort on its own opinion of what matters.
 *
 * =============================================================================================
 * 7. THE STATUS VOCABULARY, WHICH IS A CONTRACT WITH THE WRITE-BACK HALF.
 * =============================================================================================
 *   error:<kind>     SYSTEMIC. The sheet row is LEFT UNTOUCHED and stays `new`, so the next morning
 *                    offers it again. Nothing is written anywhere. An Anthropic outage must never
 *                    look like a job that was considered and rejected.
 *   blocked:<kind>   a decision about the JOB. The jobs.status cell gets the token, no documents are
 *                    produced, and it is not re-offered.
 *   held:<kind>      a decision to hold for Shaheen. Same as blocked on the sheet, different in
 *                    meaning: the job was fine and this run could not do it properly.
 *   needs_review     the pair needs a human look before anything ships.
 *   skipped:cap      it qualified and lost the cap. D11 is literal: NOT re-written tomorrow. Typing
 *                    `new` back into the cell re-queues it.
 * Only `error:` leaves the row alone. Everything else writes a status cell in the same batch write.
 */

const LN = require('./_lane');

const CAPS = LN.caps().values;
const MODEL = LN.STAGE_MODELS.read;
const PRICE = LN.prices(MODEL);
const SCOPES = LN.collectorScopes();

// The closed schema. A key outside this list is RECORDED and ignored; a required key missing sends
// the pair to needs_review rather than being filled in with a guess.
const SCHEMA_KEYS = [
  'role_title', 'employer', 'employer_country', 'employer_website',
  'work_type', 'work_type_evidence',
  'swedish_required', 'swedish_evidence',
  'right_to_work_country', 'right_to_work_evidence',
  'seniority', 'employment_type',
  'must_have', 'nice_to_have', 'ats_terms',
  'objections', 'quote_line', 'ad_language',
  'injection_detected', 'injection_note',
];
const REQUIRED_KEYS = ['role_title', 'employer', 'work_type', 'swedish_required', 'objections', 'ats_terms'];
const WORK_TYPES = ['remote', 'hybrid', 'onsite'];
// The two work types that are EVIDENCE the row is not remote. Anything else, null included, is not
// evidence and never blocks. See header note 3.
const NOT_REMOTE_WORK_TYPES = ['hybrid', 'onsite'];

// Per-string and per-list caps. The rubric asks for short strings; this is the enforcement, because
// a prompt is a request and a parser is a rule. These values ride into a Drive README and into
// sheet cells, so they are bounded here rather than downstream.
const STR_MAX = 240;
const EVIDENCE_MAX = 400;
const QUOTE_MAX = 400;
const LIST_ITEM_MAX = 120;
const MUST_HAVE_MAX = 8;
const NICE_TO_HAVE_MAX = 8;
const ATS_TERMS_MAX = 12;
const OBJECTIONS_EXPECTED = 3;

// Failure kinds that are about the STAGE rather than about this row. The sheet row is left at `new`
// for every one of them, so the next run re-offers it.
const SYSTEMIC_KINDS = ['auth', 'credits', 'rate_limit', 'upstream', 'transport', 'not_found', 'too_large', 'pairing', 'node_did_not_run', 'bad_request'];

const STATUS_VOCAB = {
  'error:*': 'systemic. The jobs.status cell is LEFT UNTOUCHED and stays new. Nothing is written anywhere.',
  'blocked:*': 'a decision about the job. The jobs.status cell gets the token and no documents are produced.',
  'held:*': 'the job was fine and this run could not do it properly. Status cell written, held for Shaheen.',
  needs_review: 'a human looks before anything ships.',
  'skipped:cap': 'qualified and lost the cap. D11: NOT re-written tomorrow. Typing new back into the cell re-queues it.',
};

(function assertAgainstUpstream() {
  const merge = require('./13-read-results.js');
  const route = require('./11-read-route.js');
  const job = require('./12-read-job.js');
  const build = require('./10-build-read-request.js');
  const candidates = require('./05-build-candidates.js');
  if (merge.name !== 'Read Results') throw new Error('Parse Job Brief: node 13 is named ' + JSON.stringify(merge.name) + ' and this node connects from "Read Results".');
  if (route.name !== 'Read Route') throw new Error('Parse Job Brief: node 11 is named ' + JSON.stringify(route.name) + ' and this node reads $(\'Read Route\') output 0 for the authoritative sent order.');
  if (job.name !== 'Read Job') throw new Error('Parse Job Brief: node 12 is named ' + JSON.stringify(job.name) + ' and this node reads $(\'Read Job\') for the responses.');
  if (build.name !== 'Build Read Request') throw new Error('Parse Job Brief: node 10 is named ' + JSON.stringify(build.name) + ' and this node reads $(\'Build Read Request\') for the independent count of what should have been called.');

  const resp = job.parameters.options && job.parameters.options.response && job.parameters.options.response.response;
  if (!resp || resp.fullResponse !== true || resp.neverError !== true) {
    throw new Error(
      'Parse Job Brief: Read Job no longer sets fullResponse AND neverError. This node reads statusCode\n' +
      '  off the item to tell a credit error, an auth error and a rate limit apart. Without them a 4xx\n' +
      '  either throws or arrives with no status at all, and the run cannot tell "no credits" from "no\n' +
      '  good jobs", which on this lane is the difference between leaving every row at new and burning\n' +
      '  the day cap on nothing.'
    );
  }
  if (merge.parameters.numberInputs !== 2) {
    throw new Error('Parse Job Brief: Read Results declares numberInputs ' + JSON.stringify(merge.parameters.numberInputs) + '. This node expects the two-input join.');
  }

  // The cap gate reads the cap Build Candidates stamped. If that stamp moved, this gate would take
  // the top `undefined` pairs, and Math.min with undefined is NaN, and slice(0, NaN) is EMPTY: the
  // run would ship nothing and report a clean day.
  const cc = String(candidates.parameters.jsCode || '');
  if (cc.indexOf('cap: remaining,') === -1) {
    throw new Error(
      'Parse Job Brief: Build Candidates no longer stamps _cap.cap on a pair, and the REAL cap gate in\n' +
      '  this node takes the top _cap.cap survivors per lane. Without it the gate would slice to NaN,\n' +
      '  ship nothing, and report a clean day. If the stamp legitimately moved, update this exact string.'
    );
  }
  if (cc.indexOf('scope_source: \'recovered_from_location\'') === -1) {
    throw new Error(
      'Parse Job Brief: Build Candidates no longer stamps _scope.scope_source, and the D10 work type\n' +
      '  gate here reads the recovered scope and reports its provenance with every verdict. A verdict\n' +
      '  that cannot say where its scope came from would read as the collector own decision, which is\n' +
      '  precisely what the amendment forbids.'
    );
  }

  // The Swedish flag string is READ from the collector scoring helper rather than typed, because the
  // string in a block reason has to be the same string the rest of the system uses for the same fact.
  if (typeof LN.SWEDISH_FLAG !== 'string' || !LN.SWEDISH_FLAG) {
    throw new Error('Parse Job Brief: the shared SWEDISH_FLAG string did not resolve. The D10 Swedish block names it, and two spellings of the same fact is how a report stops being greppable.');
  }
  // The gate can only fire inside a remote-only scope. If the collector ever has none, the block is
  // dead code and the build says so rather than shipping a gate that cannot fire.
  if (!SCOPES.remote_only.length) {
    throw new Error('Parse Job Brief: the collector declares no remote_only scope, so the amended D10 work type block can never fire. That may be correct and it is not something this build assumes.');
  }
  const dupKinds = SYSTEMIC_KINDS.filter((k, i) => SYSTEMIC_KINDS.indexOf(k) !== i);
  if (dupKinds.length) throw new Error('Parse Job Brief: systemic kind ' + dupKinds[0] + ' is listed twice.');
  for (const k of REQUIRED_KEYS) {
    if (SCHEMA_KEYS.indexOf(k) === -1) throw new Error('Parse Job Brief: ' + k + ' is required and is not in the closed schema, so it could never arrive.');
  }
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// Parse Job Brief. Read the answers, judge the job, close the cap, price the run.
// ---------------------------------------------------------------------------
const NL = String.fromCharCode(10);
const EM_DASH = String.fromCharCode(8212);
const EN_DASH = String.fromCharCode(8211);

// --- text safety -------------------------------------------------------------
// Every string here can end up in a spreadsheet cell and in a Drive README. A cell beginning with
// =, +, - or @ is a FORMULA under USER_ENTERED, and the model just read an attacker controllable
// job ad, so the prefix is stripped here rather than trusted to a write option in a node this one
// does not own.
let formulaPrefixesStripped = 0;
function stripDashes(s) {
  return String(s).split(EM_DASH).join(', ').split(EN_DASH).join('-');
}
function clean(v, cap) {
  if (v === null || v === undefined) return '';
  let out = stripDashes(String(v));
  out = out.replace(/[\\u0000-\\u001F\\u007F]/g, ' ').replace(/[\\u200B-\\u200D\\uFEFF\\u00A0]/g, ' ');
  out = out.replace(/\\s+/g, ' ').trim();
  while (out.length && '=+-@'.indexOf(out.charAt(0)) !== -1) { out = out.slice(1).trim(); formulaPrefixesStripped += 1; }
  if (out.length > cap) out = out.slice(0, cap - 1).trim() + String.fromCharCode(8230);
  return out;
}
function cleanList(v, cap, maxItems) {
  const arr = Array.isArray(v) ? v : (v === null || v === undefined || v === '' ? [] : [v]);
  const out = [];
  for (const raw of arr) {
    if (out.length >= maxItems) break;
    if (raw === null || raw === undefined) continue;
    const c = clean(typeof raw === 'string' ? raw : JSON.stringify(raw), cap);
    if (c) out.push(c);
  }
  return out;
}

// --- JSON out of a text answer ----------------------------------------------
// The rubric asks for a bare object. This tolerates the two things a model does anyway, a fenced
// block and a sentence around it, and never tolerates guessing at a shape.
function extractJson(text) {
  const t = String(text || '').trim();
  if (!t) return { ok: false, why: 'the response carried no text block at all' };
  const tries = [t];
  const fenceOpen = t.indexOf(String.fromCharCode(96, 96, 96));
  if (fenceOpen !== -1) {
    const after = t.indexOf(NL, fenceOpen);
    const fenceClose = t.indexOf(String.fromCharCode(96, 96, 96), fenceOpen + 3);
    if (after !== -1 && fenceClose !== -1 && fenceClose > after) tries.push(t.slice(after + 1, fenceClose).trim());
  }
  const start = t.indexOf('{');
  if (start !== -1) {
    let depth = 0; let inStr = false; let esc = false;
    for (let i = start; i < t.length; i += 1) {
      const ch = t.charAt(i);
      if (inStr) {
        if (esc) esc = false;
        else if (ch === String.fromCharCode(92)) esc = true;
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
  if (status === 401 || status === 403) return { kind: 'auth', why: 'the API key was refused (' + status + '). ' + (msg || errType || 'no message') + ' If the message is about an HTTP Request node rather than about the key, the credential Allowed HTTP Request Domains setting is on None and needs to allow api.anthropic.com.' };
  if (status === 402) return { kind: 'credits', why: 'payment required (402). ' + (msg || 'no message') };
  if (status === 429) return { kind: 'rate_limit', why: 'rate limited (429). ' + (msg || 'no message') };
  if (status >= 500) return { kind: 'upstream', why: 'the API returned ' + status + '. ' + (msg || 'no message') };
  if (status === 413) return { kind: 'too_large', why: 'the request was rejected as too large (413). The ad cap is meant to prevent this, so a 413 means one posting is far past it. ' + (msg || 'no message') };
  if (status === 404) return { kind: 'not_found', why: 'the endpoint or the model was not found (404). ' + (msg || 'no message') };
  if (status === 400) {
    if (looksLikeCredits) {
      return { kind: 'credits', why: 'HTTP 400 invalid_request_error and the message names credit or balance: ' + msg + '. Anthropic reports an exhausted balance as a 400 rather than a 402, so this is an ACCOUNT state and not a bad request. Nothing in this workflow needs changing, the account needs topping up. Every row stays at new.' };
    }
    return { kind: 'bad_request', why: 'HTTP 400 ' + (errType || '') + '. ' + (msg || 'no message') + ' This one is about the request this workflow built, not about the account.' };
  }
  return { kind: 'http_' + status, why: 'HTTP ' + status + '. ' + (msg || errType || 'no message') };
}

// --- 1. the three views of who was called -----------------------------------
let called = [];
try {
  called = $('Read Route').all(0).map((i) => i.json);
} catch (e) {
  called = [];
}
let responses = null;
let responsesWhy = null;
try {
  responses = $('Read Job').all();
} catch (e) {
  responses = null;
  responsesWhy = e.message;
}
let expectedCalls = null;
try {
  expectedCalls = $('Build Read Request').all().map((i) => i.json).filter((j) => j && j._call_now === true).length;
} catch (e) {
  expectedCalls = null;
}
const carried = $input.all().map((i) => i.json).filter((j) => j && j._kind !== undefined);

let pairing = 'ok';
let pairingWhy = null;
const warnings = [];

if (expectedCalls !== null && called.length !== expectedCalls) {
  pairing = 'mismatch';
  pairingWhy = 'Build Read Request stamped _call_now true on ' + expectedCalls + ' item(s) and Read Route sent ' + called.length +
    ' down the paid branch. The route and the stamp have come apart.';
} else if (responses === null) {
  if (called.length > 0) {
    pairing = 'no_responses';
    pairingWhy = 'Read Route sent ' + called.length + ' pair(s) and the Read Job node produced no run data (' + (responsesWhy || 'unknown') +
      '). The node did not execute. Every pair is kept, marked, and written NOWHERE, so the next run offers the same rows again.';
  }
} else if (responses.length !== called.length) {
  pairing = 'mismatch';
  pairingWhy = 'Read Route sent ' + called.length + ' pair(s) and Read Job returned ' + responses.length +
    '. Refusing to guess an alignment: one job brief on another job pair writes a perfect application for the wrong company, and every count on the sheet would still be right.';
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

// --- 2. the brief, per response ---------------------------------------------
const readPairs = [];
const usageTotals = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cost_usd: 0 };
const errorKinds = {};
const statusCodes = {};
const blockCounts = {};
const collectorSignals = [];
const quoteRejections = [];
let cacheReads = 0;
let cacheWrites = 0;
let parsedOk = 0;
let fenced = 0;
let unknownKeysSeen = {};

function markError(pair, kind, why, extra) {
  pair._status = 'error:' + kind;
  pair._status_why = why;
  pair._status_class = SYSTEMIC_KINDS.indexOf(kind) !== -1 ? 'systemic' : 'row';
  pair._sheet_action = 'leave_untouched';
  errorKinds[kind] = (errorKinds[kind] || 0) + 1;
  pair._brief = Object.assign({}, pair._brief, { error: Object.assign({ kind: kind, why: why }, extra || {}) });
}
function markHold(pair, status, why) {
  pair._status = status;
  pair._status_why = why;
  pair._status_class = 'hold';
  pair._sheet_action = 'write_status';
}
function markBlocked(pair, kind, why, evidence) {
  pair._status = 'blocked:' + kind;
  pair._status_why = why;
  pair._status_class = 'blocked';
  pair._sheet_action = 'write_status';
  pair._block = { kind: kind, why: why, evidence: evidence || null };
  blockCounts[kind] = (blockCounts[kind] || 0) + 1;
}

for (let i = 0; i < called.length; i += 1) {
  const pair = Object.assign({}, called[i]);
  readPairs.push(pair);

  if (pairing === 'mismatch') { markError(pair, 'pairing', pairingWhy); continue; }
  if (pairing === 'no_responses') { markError(pair, 'node_did_not_run', pairingWhy); continue; }

  const item = responses[i] || {};
  const j = item.json || {};

  if (j.error !== undefined && j.statusCode === undefined) {
    markError(pair, 'transport', 'the request never completed: ' + String(typeof j.error === 'string' ? j.error : (j.error && j.error.message) || JSON.stringify(j.error)).slice(0, 240));
    continue;
  }
  const status = Number(j.statusCode);
  const body = j.body;
  if (!isFinite(status)) {
    markError(pair, 'transport', 'the response carried no statusCode. fullResponse is set on Read Job, so a missing status means the item is not an HTTP response at all.');
    continue;
  }
  statusCodes[String(status)] = (statusCodes[String(status)] || 0) + 1;
  if (status < 200 || status >= 300) {
    const c = classify(status, body);
    markError(pair, c.kind, c.why, { http_status: status });
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
  pair._cost = { usd: usage.cost_usd, calls: [{ stage: 'read', model: MODEL, usage: usage }] };

  // THE FILTER. content[0] is not the text block, and on this model a thinking block is FIRST and
  // carries empty text by default. See header note 1.
  const content = (body && Array.isArray(body.content)) ? body.content : [];
  const textBlocks = content.filter((b) => b && b.type === 'text');
  const stop = (body && body.stop_reason) || 'unknown';
  pair._brief = {
    http_status: status,
    stop_reason: stop,
    usage: usage,
    content_blocks: { total: content.length, text: textBlocks.length, non_text: content.length - textBlocks.length, types: content.map((b) => (b && b.type) || 'unknown') },
  };
  const text = textBlocks.map((b) => String(b.text === undefined || b.text === null ? '' : b.text)).join(NL).trim();

  if (!text) {
    if (stop === 'max_tokens') {
      markHold(pair, 'held:brief_truncated',
        'the read hit max_tokens (' + READ_MAX_TOKENS + ') before it produced any text at all. On this model an omitted thinking parameter means ADAPTIVE thinking is ON, and max_tokens caps thinking and text TOGETHER, so the whole budget went to reasoning. The fix is one number: caps.read_max_tokens in the lane file, or an explicit low effort. Content blocks seen: ' + JSON.stringify(pair._brief.content_blocks.types));
    } else {
      markHold(pair, 'needs_review',
        'the response carried ' + content.length + ' content block(s) and none of them was a text block (types ' + JSON.stringify(pair._brief.content_blocks.types) + ', stop_reason ' + stop + ').');
    }
    continue;
  }

  const parsed = extractJson(text);
  if (!parsed.ok) {
    if (stop === 'max_tokens') {
      markHold(pair, 'held:brief_truncated',
        'the read hit max_tokens (' + READ_MAX_TOKENS + ') and the JSON is cut off, so it will not parse. On this model an omitted thinking parameter means ADAPTIVE thinking is ON and shares that budget with the text. Raise caps.read_max_tokens or set a lower effort. First 200 characters: ' + JSON.stringify(String(parsed.sample || text).slice(0, 200)));
    } else {
      markHold(pair, 'needs_review', 'the answer would not parse as JSON: ' + parsed.why + '. First 200 characters: ' + JSON.stringify(String(parsed.sample || text).slice(0, 200)));
    }
    continue;
  }
  if (parsed.used_fallback) fenced += 1;
  parsedOk += 1;

  const ans = parsed.value;
  const unknown = Object.keys(ans).filter((k) => SCHEMA_KEYS.indexOf(k) === -1);
  for (const k of unknown) unknownKeysSeen[k] = (unknownKeysSeen[k] || 0) + 1;
  const missing = REQUIRED_KEYS.filter((k) => ans[k] === undefined);
  if (missing.length) {
    markHold(pair, 'needs_review', 'the answer is missing required field(s) ' + JSON.stringify(missing) + '. The schema is closed and a missing field is not filled in with a guess.');
    continue;
  }

  // --- normalise ---
  const flags = [];
  let workType = typeof ans.work_type === 'string' ? ans.work_type.trim().toLowerCase() : null;
  if (workType === '' || workType === 'null' || workType === 'unknown' || workType === 'unclear') workType = null;
  if (workType !== null && WORK_TYPES.indexOf(workType) === -1) {
    flags.push('work_type came back as ' + JSON.stringify(ans.work_type) + ', which is not one of ' + WORK_TYPES.join(', ') + ', so it was read as UNSTATED. Unstated never blocks.');
    workType = null;
  }
  let swedishRequired = ans.swedish_required === true;
  if (typeof ans.swedish_required !== 'boolean') {
    flags.push('swedish_required came back as ' + JSON.stringify(ans.swedish_required) + ', which is not a boolean, so it was read as false. An unanswered question is not a requirement, and blocking on one would drop jobs nobody decided about.');
  }
  const employerCountry = clean(ans.employer_country, STR_MAX) || null;
  const rightToWork = clean(ans.right_to_work_country, STR_MAX) || null;

  // The quote line has to BE in the ad. A quote the model composed is the single most damaging
  // thing that can reach a cover letter, because it reads as evidence of a careful read and is not.
  let quote = clean(ans.quote_line, QUOTE_MAX) || null;
  let quoteOk = null;
  if (quote) {
    const hayRaw = String(pair.ad_text || '');
    const hay = stripDashes(hayRaw).replace(/\\s+/g, ' ').toLowerCase();
    const needle = quote.replace(/\\s+/g, ' ').toLowerCase().replace(/[.,;:!?]+$/, '');
    quoteOk = needle.length > 0 && hay.indexOf(needle) !== -1;
    if (!quoteOk) {
      quoteRejections.push({ job_id: pair.job_id, quote: quote.slice(0, 120) });
      flags.push('quote_line was NOT found in the posting text and was dropped. A quote the model composed reads as evidence of a careful read and is not one.');
      quote = null;
    }
  }

  const objections = [];
  const rawObj = Array.isArray(ans.objections) ? ans.objections : [];
  for (const o of rawObj) {
    if (objections.length >= OBJECTIONS_EXPECTED) break;
    if (!o) continue;
    const text2 = clean(typeof o === 'string' ? o : o.objection, STR_MAX);
    if (!text2) continue;
    objections.push({ objection: text2, evidence: clean(o && o.evidence, EVIDENCE_MAX) || null });
  }
  if (objections.length !== OBJECTIONS_EXPECTED) {
    flags.push('the reader returned ' + objections.length + ' usable objection(s) and the seat asks for exactly ' + OBJECTIONS_EXPECTED + '. Nothing is invented to fill the gap; the selector answers what is there and the README says how many there were.');
  }

  // D17. A right to work requirement is recorded as an objection and NEVER blocks.
  if (rightToWork) {
    const already = objections.some((o) => o.objection.toLowerCase().indexOf('right to work') !== -1 || o.objection.toLowerCase().indexOf('work authorization') !== -1 || o.objection.toLowerCase().indexOf('sponsor') !== -1);
    if (!already && objections.length < OBJECTIONS_EXPECTED + 1) {
      objections.push({
        objection: 'The posting requires existing right to work in ' + rightToWork + ', which he does not hold.',
        evidence: clean(ans.right_to_work_evidence, EVIDENCE_MAX) || null,
      });
    }
  }

  const brief = {
    role_title: clean(ans.role_title, STR_MAX),
    employer: clean(ans.employer, STR_MAX),
    employer_country: employerCountry,
    employer_website: clean(ans.employer_website, STR_MAX) || null,
    work_type: workType,
    work_type_evidence: clean(ans.work_type_evidence, EVIDENCE_MAX) || null,
    swedish_required: swedishRequired,
    swedish_evidence: clean(ans.swedish_evidence, EVIDENCE_MAX) || null,
    right_to_work_country: rightToWork,
    right_to_work_evidence: clean(ans.right_to_work_evidence, EVIDENCE_MAX) || null,
    seniority: clean(ans.seniority, STR_MAX) || null,
    employment_type: clean(ans.employment_type, STR_MAX) || null,
    must_have: cleanList(ans.must_have, LIST_ITEM_MAX, MUST_HAVE_MAX),
    nice_to_have: cleanList(ans.nice_to_have, LIST_ITEM_MAX, NICE_TO_HAVE_MAX),
    ats_terms: cleanList(ans.ats_terms, LIST_ITEM_MAX, ATS_TERMS_MAX),
    objections: objections,
    quote_line: quote,
    quote_verified: quoteOk,
    ad_language: clean(ans.ad_language, STR_MAX) || null,
    injection_detected: ans.injection_detected === true,
    injection_note: clean(ans.injection_note, EVIDENCE_MAX) || null,
    unknown_keys_ignored: unknown,
    flags: flags,
  };
  pair._brief = Object.assign({}, pair._brief, { brief: brief, answer_was_fenced: parsed.used_fallback === true });
  pair.brief = brief;

  // --- D18. The UC context flag. Unknown counts as OUTSIDE Sweden, deliberately. ---
  pair.uc_context_required = !(employerCountry && employerCountry.toLowerCase() === 'sweden');
  pair.uc_context_why = employerCountry
    ? (pair.uc_context_required
      ? 'the employer country is ' + employerCountry + ', so the letter carries two lines introducing UC AB (Enento Group) for a reader who does not know it.'
      : 'the employer is in Sweden, so one line is enough: they know UC.')
    : 'the posting does not state a country, and unknown counts as OUTSIDE Sweden. Two unnecessary lines for a Swedish reader is a slightly long letter; a missing introduction for a foreign reader loses the strongest fact on the CV.';

  // --- D10, as amended. Swedish fluency first, then work type, and NOTHING else blocks. ---
  if (swedishRequired) {
    markBlocked(pair, 'swedish_fluent_required',
      'the posting requires fluent Swedish (' + SWEDISH_FLAG + '), which is the one language requirement that is not negotiable for him. Unchanged by the 2026-09-15 amendment.',
      brief.swedish_evidence);
    continue;
  }

  const rule = pair._scope ? pair._scope.work_type_rule : null;
  const scopeName = pair._scope ? pair._scope.scope : null;
  const notRemote = workType !== null && NOT_REMOTE_WORK_TYPES.indexOf(workType) !== -1;
  pair._work_type_verdict = {
    scope: scopeName,
    scope_source: pair._scope ? pair._scope.scope_source : null,
    rule: rule,
    work_type: workType,
    blocked: false,
    why: null,
  };
  if (rule === 'remote_only' && notRemote) {
    pair._work_type_verdict.blocked = true;
    pair._work_type_verdict.why = scopeName + ' is a remote only scope and the posting states this role is ' + workType + '.';
    markBlocked(pair, 'work_type_outside_scope',
      scopeName + ' is a remote only scope and the posting states this role is ' + workType + '. He has no right to work there, so an onsite or hybrid role in that scope can never become an application. Sweden, the Gulf and non-EU Europe accept all three work types and are never blocked here.',
      brief.work_type_evidence);
    // The same event is a signal about the COLLECTOR: a remote only scope should not be delivering
    // demonstrably non remote rows. The amendment asks for this to be said rather than absorbed.
    collectorSignals.push({
      job_id: pair.job_id,
      lane: pair.lane_key,
      scope: scopeName,
      scope_source: pair._scope ? pair._scope.scope_source : null,
      rule: rule,
      work_type: workType,
      evidence: brief.work_type_evidence,
      what_it_means: 'a row arrived in a remote only scope and the posting itself says it is ' + workType + '. Either the collector work type rule let it through, or the scope recovered from the location cell is not the scope the collector actually assigned. Both are worth a look and neither is visible anywhere else.',
    });
    continue;
  }
  if (rule === null) {
    pair._work_type_verdict.why = 'no scope could be recovered from the location cell, so there is no work type rule to apply and the CV is written. Blocking on an absent fact is what the 2026-09-15 amendment forbids.';
  } else if (rule === 'any') {
    pair._work_type_verdict.why = scopeName + ' accepts onsite, hybrid and remote alike, on his own words of 2026-09-14 and his 2026-06-16 sourcing config before that.';
  } else if (workType === null) {
    pair._work_type_verdict.why = scopeName + ' is remote only and the posting does not state a work type. UNSTATED IS NOT ONSITE: most sources here cannot state it and the two newest scopes send no work type filter at all, so treating null as onsite would silently block a whole intake while every count upstream looked healthy.';
  } else {
    pair._work_type_verdict.why = scopeName + ' is remote only and the posting states remote.';
  }

  // --- injection. It does not block, it holds. ---
  if (brief.injection_detected) {
    markHold(pair, 'needs_review',
      'the reader reports that the posting tried to give it instructions: ' + (brief.injection_note || 'no note recorded') +
      '. The read itself was completed and is on the pair. Nothing is generated until a human has looked at the company.');
    continue;
  }
  if (!brief.ats_terms.length) {
    markHold(pair, 'needs_review', 'the reader returned no ATS terms at all, and the round trip check downstream has nothing to look for in the rendered CV. That is a read that did not work rather than a posting with no requirements.');
    continue;
  }
}

// --- 3. THE CAP GATE, after the verdicts. Design defect 6. ---------------------
// Alive means: a pair, read successfully, not blocked, not held, not errored. The ordering is the
// one Build Candidates computed and stamped, so this gate does not re-sort on its own opinion.
const alive = readPairs.filter((p) => p._kind === 'pair' && !p._status);
const byLane = {};
for (const p of alive) {
  const k = p.lane_key || 'unknown';
  if (!byLane[k]) byLane[k] = [];
  byLane[k].push(p);
}
const capReport = {};
let cappedHere = 0;
for (const k of Object.keys(byLane)) {
  const list = byLane[k].slice().sort((a, b) => (Number(a.rank) || 0) - (Number(b.rank) || 0));
  const cap = (list[0] && list[0]._cap && Number(list[0]._cap.cap));
  if (!isFinite(cap)) {
    warnings.push('lane ' + k + ': no cap was stamped on its pairs, so the cap gate could not close and every survivor continues. That is a build fault rather than a data one.');
    capReport[k] = { cap: null, alive: list.length, continued: list.length, capped: 0 };
    continue;
  }
  const keep = list.slice(0, cap);
  const drop = list.slice(cap);
  for (const p of drop) {
    p._status = 'skipped:cap';
    p._status_class = 'capped';
    p._sheet_action = 'write_status';
    p._status_why = 'it survived the D10 verdicts and ranked below the day cap of ' + cap + ' for this lane. Intake admitted cap plus an overshoot so a cap consumed by blocked pairs would not under deliver; this is where the real cap closes. D11 is literal: it is NOT re-written tomorrow. Typing new back into its status cell re-queues it.';
    cappedHere += 1;
  }
  capReport[k] = { cap: cap, alive: list.length, continued: keep.length, capped: drop.length };
}

// --- 4. the stage report -------------------------------------------------------
const attempted = called.length;
const briefed = readPairs.filter((p) => p._kind === 'pair' && !p._status).length;
const blocked = readPairs.filter((p) => p._status_class === 'blocked').length;
const held = readPairs.filter((p) => p._status_class === 'hold').length;
const errored = readPairs.filter((p) => p._status_class === 'systemic' || p._status_class === 'row').length;

if (pairing === 'mismatch') warnings.push('PAIRING REFUSED, and no brief was applied to any pair because of it: ' + pairingWhy);
if (pairing === 'no_responses') warnings.push('THE READ NODE DID NOT RUN: ' + pairingWhy);
if (errorKinds.credits) {
  warnings.push('THE ANTHROPIC ACCOUNT IS OUT OF CREDIT. Every affected row is left at status new and written NOWHERE, so the next run offers the same jobs again. Nothing in this workflow needs changing.');
}
if (errorKinds.auth) {
  warnings.push('THE ANTHROPIC KEY WAS REFUSED. Check the credential for this workflow. Note that it is a PROVISIONAL choice: Shaheen has not picked one and human-action anthropic-credential-36-writer is open.');
}
if (attempted > 1 && cacheReads === 0 && parsedOk > 1) {
  warnings.push('THE PROMPT CACHE NEVER READ. ' + parsedOk + ' successful call(s) and cache_read_input_tokens was 0 on every one, so the recruiter rubric was paid for at full price each time instead of once. The usual causes are a system block that changed between calls, a gap of more than five minutes between calls, or a prefix under the model minimum of ' + MIN_CACHE_TOKENS + ' tokens. Cost is the only symptom; the briefs are unaffected.');
}
if (quoteRejections.length) {
  warnings.push(quoteRejections.length + ' quote_line(s) were NOT found in the posting and were dropped. A composed quote reads as evidence of a careful read and is not one, which is exactly why it is checked rather than trusted.');
}
if (collectorSignals.length) {
  warnings.push('COLLECTOR SIGNAL: ' + collectorSignals.length + ' row(s) arrived in a remote only scope and the posting itself says the role is onsite or hybrid. The collector should have dropped those, or the scope recovered here is not the one it assigned. This is reported rather than absorbed because nothing else in either system can see it.');
}
if (formulaPrefixesStripped > 0) {
  warnings.push(formulaPrefixesStripped + ' model string(s) began with =, + , - or @ and had it stripped. A cell that starts with one of those is a FORMULA in Google Sheets, and the model had just read an attacker controllable job ad. Worth reading as a possible injection attempt rather than as punctuation.');
}
if (Object.keys(unknownKeysSeen).length) {
  warnings.push('the reader returned key(s) outside the closed schema and they were ignored: ' + JSON.stringify(unknownKeysSeen) + '.');
}

const report = {
  _kind: 'stage_report',
  stage: 'brief',
  model: MODEL,
  pairing: { state: pairing, why: pairingWhy, sent: called.length, responses: responses === null ? null : responses.length, expected: expectedCalls },
  counts: {
    attempted: attempted,
    parsed: parsedOk,
    briefed_and_continuing: briefed,
    blocked: blocked,
    held: held,
    errored: errored,
    capped_here: cappedHere,
    answers_needing_a_fence_strip: fenced,
  },
  blocks_by_kind: blockCounts,
  error_kinds: errorKinds,
  http_status_codes: statusCodes,
  cap_gate: capReport,
  cap_rule: 'intake admitted cap plus an overshoot; the REAL cap closes HERE, after the D10 verdicts, so a cap consumed by blocked pairs does not under deliver.',
  d10: {
    version: 'amended 2026-09-15',
    rule: 'work type is a SCOPE question. A pair is blocked for work type only where the collecting scope is remote only AND the posting says the role is onsite or hybrid. Unstated work type is NOT onsite and never blocks. Sweden, the Gulf and non-EU Europe accept all three work types. The Swedish fluency block is unchanged. Contract, freelance and below-level seniority still get written.',
    remote_only_scopes: REMOTE_ONLY_SCOPES,
    scope_source: 'recovered_from_location. The jobs tab carries no scope column, so the collector own _filter.scope does not reach this workflow; Build Candidates recovers it from the location cell using the collector own token table and precedence order, read out of 20-filter.js at build time.',
    collector_signals: collectorSignals,
  },
  d17: 'a right to work requirement is recorded as one of the objections and NEVER blocks. He asked for these jobs. The letter answers it honestly and never claims work rights he does not hold.',
  d18: 'uc_context_required is true when the employer country is not Sweden, and UNKNOWN COUNTS AS OUTSIDE.',
  quote_rejections: quoteRejections,
  cost: {
    actual_usd: usageTotals.cost_usd,
    usage: usageTotals,
    cache: { calls_with_a_cache_read: cacheReads, calls_that_wrote_cache: cacheWrites, of_calls: parsedOk, model_minimum_tokens: MIN_CACHE_TOKENS },
    prices: { model: MODEL, in_per_mtok: PRICE_IN, out_per_mtok: PRICE_OUT, cache_write_mult: CACHE_WRITE_MULT, cache_read_mult: CACHE_READ_MULT },
  },
  status_vocabulary: STATUS_VOCAB,
  warnings: warnings,
  _call_now: false,
  ad_fetch_url: '',
};

// Every pair, every carried item, then this report. Never an empty array.
const items = readPairs.concat(carried).map((j) => ({ json: j, pairedItem: { item: 0 } }));
items.push({ json: report, pairedItem: { item: 0 } });
return items;
`;

const jsCode = [
  '// GENERATED at build time from work/36-job-application-writer/nodes/14-parse-job-brief.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  'const MODEL = ' + JSON.stringify(MODEL) + ';',
  'const READ_MAX_TOKENS = ' + JSON.stringify(CAPS.read_max_tokens) + ';',
  'const MIN_CACHE_TOKENS = ' + JSON.stringify(LN.MIN_CACHEABLE_TOKENS[MODEL]) + ';',
  'const PRICE_IN = ' + JSON.stringify(PRICE.in_per_mtok) + ';',
  'const PRICE_OUT = ' + JSON.stringify(PRICE.out_per_mtok) + ';',
  'const CACHE_WRITE_MULT = ' + JSON.stringify(PRICE.cache_write_mult) + ';',
  'const CACHE_READ_MULT = ' + JSON.stringify(PRICE.cache_read_mult) + ';',
  'const SCHEMA_KEYS = ' + JSON.stringify(SCHEMA_KEYS) + ';',
  'const REQUIRED_KEYS = ' + JSON.stringify(REQUIRED_KEYS) + ';',
  'const WORK_TYPES = ' + JSON.stringify(WORK_TYPES) + ';',
  'const NOT_REMOTE_WORK_TYPES = ' + JSON.stringify(NOT_REMOTE_WORK_TYPES) + ';',
  'const SYSTEMIC_KINDS = ' + JSON.stringify(SYSTEMIC_KINDS) + ';',
  'const REMOTE_ONLY_SCOPES = ' + JSON.stringify(SCOPES.remote_only) + ';',
  'const SWEDISH_FLAG = ' + JSON.stringify(LN.SWEDISH_FLAG) + ';',
  'const STATUS_VOCAB = ' + JSON.stringify(STATUS_VOCAB) + ';',
  'const STR_MAX = ' + JSON.stringify(STR_MAX) + ';',
  'const EVIDENCE_MAX = ' + JSON.stringify(EVIDENCE_MAX) + ';',
  'const QUOTE_MAX = ' + JSON.stringify(QUOTE_MAX) + ';',
  'const LIST_ITEM_MAX = ' + JSON.stringify(LIST_ITEM_MAX) + ';',
  'const MUST_HAVE_MAX = ' + JSON.stringify(MUST_HAVE_MAX) + ';',
  'const NICE_TO_HAVE_MAX = ' + JSON.stringify(NICE_TO_HAVE_MAX) + ';',
  'const ATS_TERMS_MAX = ' + JSON.stringify(ATS_TERMS_MAX) + ';',
  'const OBJECTIONS_EXPECTED = ' + JSON.stringify(OBJECTIONS_EXPECTED) + ';',
  LOGIC,
].join('\n');

module.exports = {
  name: 'Parse Job Brief',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [3120, 100],
  connectFrom: 'Read Results',
  notes: 'Filters content[] for text blocks (mandatory on claude-opus-5, where an omitted thinking parameter means adaptive thinking is ON and a thinking block comes back first), parses the closed schema, verifies quote_line is a real substring of the ad, applies the amended D10 (work type is a scope question, unstated never blocks, Swedish fluency still blocks), records a right to work requirement as an objection rather than a block per D17, sets uc_context_required per D18 with unknown counting as outside Sweden, holds an injection attempt for review, and then closes the REAL cap gate on the survivors. Prices the run off real usage. A systemic 4xx leaves every affected sheet row untouched at new.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};
