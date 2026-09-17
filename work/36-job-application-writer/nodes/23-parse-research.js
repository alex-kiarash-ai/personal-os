'use strict';
/*
 * 23-parse-research.js - "Parse Research". Verifies the hook against the page it claims to come
 * from, fans the answer out to every pair at that company, and splits the cost across them.
 *
 * =============================================================================================
 * 1. THE HOOK IS PROVED TWICE OR IT IS NULL. THIS IS D6 AND IT IS THE POINT OF THE STAGE.
 * =============================================================================================
 * D6, in the plan's own words: read the employer's own site, find ONE real verifiable hook, REFUSE
 * TO INVENT ONE. A quoted sentence is the single most persuasive thing a cover letter can carry,
 * because it reads as evidence that the applicant actually looked. An invented one is therefore the
 * single most damaging thing it can carry: it reads as that same evidence and is a lie, and the
 * person best placed to notice is the person who wrote the sentence it was supposed to be.
 *
 * So a hook survives two independent checks or it becomes null with the reason recorded:
 *
 *   THE SUBSTRING CHECK. hook.quote must appear in the page text this run actually fetched, after
 *   the same normalisation the ad-side quote check uses: dashes stripped, whitespace collapsed,
 *   lowercased, trailing sentence punctuation dropped from the needle. One definition of "is this
 *   quote in that text", asserted against Parse Job Brief at build time, because an allowlist and a
 *   checker that disagree about what a match is will fail honest quotes and pass invented ones.
 *
 *   THE HOST CHECK. hook.url's host must be the host this run fetched. A model that answers with a
 *   url it remembers rather than the one it was given is a model quoting from memory, and the quote
 *   that arrives with it cannot be trusted even if it happens to appear in the page. Compared after
 *   lowercasing and dropping a leading www., which is the same host by any reading; anything else is
 *   a different site.
 *
 * BOTH checks always run and BOTH reasons are recorded, even when the first one already failed. A
 * report that stops at the first failure cannot tell "the model paraphrased" from "the model
 * answered about a different company", and those want different fixes.
 *
 * =============================================================================================
 * 2. banned_facts, AND THE REFERENCE BUILD THAT PUT IT HERE.
 * =============================================================================================
 * The BJAK build of 2026-09-12 found that nearly every attractive fact about the company came from
 * newspapers rather than from the company. A fact the company does not assert about itself does not
 * go in the letter, because Shaheen cannot stand behind it and the company can contradict it.
 *
 * banned_facts is the researcher's own list of what it knows that the page does NOT say. It is a
 * NEGATIVE list travelling with the pair, and the writer seat is the place it binds. This node
 * cleans it, caps it and carries it; it never uses it to refuse anything.
 *
 * =============================================================================================
 * 3. THE FAN-OUT, AND WHY THE SITE ITEMS DO NOT CONTINUE.
 * =============================================================================================
 * Research is done once per company. This node looks the company up by `company_key`, the key Plan
 * Research stamped on every alive pair, and copies the verified result onto each pair. `site_text`
 * rides along because the A8 numbers audit downstream has to be able to ask whether a figure in the
 * letter came from the company's own page.
 *
 * The site items themselves STOP HERE. They are scratch: Plan Research created them, they carry up
 * to 8,000 characters of a web page each, and everything on them that matters is now on the pairs
 * and in this node's report. Carrying them further would push a web page through the selector, the
 * writer, the render stage and into the write-back half, where every Code node would have to know to
 * ignore an item kind that stopped meaning anything four nodes earlier. Dropping them is stated here
 * rather than left to be discovered, because "every Code node passes a dead pair through unchanged"
 * is a rule about PAIRS and a site item is not one.
 *
 * =============================================================================================
 * 4. THE COST IS SPLIT, NOT COPIED.
 * =============================================================================================
 * One research call can serve two pairs at the same employer. Copying its cost onto both would make
 * the per-pair figures add up to more than the bill, and the run report is the only place anybody
 * ever sees what this lane costs. So the cost is divided evenly across the pairs it served, the
 * rounding remainder goes to the first of them so the sum is exact, and each call entry records how
 * many pairs it was shared with.
 *
 * `_cost.usd` is READ and the call is APPENDED. The read stage already put its own call in there,
 * and overwriting would make every pair look like it cost only what the last stage spent.
 *
 * =============================================================================================
 * 5. NOTHING HERE BLOCKS A PAIR, INCLUDING AN INJECTION ATTEMPT.
 * =============================================================================================
 * A job posting that tries to give instructions holds its pair for review, because the posting IS
 * the job and a company writing that is worth a human look. A company WEBSITE that tries it is a
 * different case: the job may be perfectly real and the page may not even be the employer's. The
 * whole attack surface of this stage is the three strings the page produced, so all three are
 * dropped, nothing from that page reaches the letter, and the pair carries on with no hook. Loudly
 * reported, never absorbed.
 */

const LN = require('./_lane');
const S2 = require('./_stage2');

const NODE_NAME = 'Parse Research';
const N14 = './14-parse-job-brief.js';

const MODEL = LN.STAGE_MODELS.research;
const PRICE = LN.prices(MODEL);

// The closed schema. A key outside this list is RECORDED and ignored; a required key missing makes
// the research unusable for that company rather than being filled in with a guess.
const SCHEMA_KEYS = ['hook', 'banned_facts', 'company_line', 'page_kind', 'injection_detected', 'injection_note'];
const REQUIRED_KEYS = ['hook', 'banned_facts', 'company_line'];

// Per-string and per-list caps. These strings ride into a Drive README and a sheet cell, so they are
// bounded here rather than downstream. The quote cap is the same as the ad-side quote cap for the
// same reason: a "quote" longer than this is a paragraph and no longer reads as one sentence.
const QUOTE_MAX = 400;
const WHY_MAX = 240;
const URL_MAX = 500;
const COMPANY_LINE_MAX = 400;
const BANNED_FACT_MAX = 160;
const BANNED_FACTS_MAX = 8;
const PAGE_KIND_MAX = 40;

// The two numbers this node only REPORTS. Both are read from the nodes that own them rather than
// restated, so a report cannot quote a cap the pipeline stopped using.
const RESEARCH_MAX_TOKENS = S2.readSourceNumber(
  './05-build-candidates.js',
  /\{\s*stage:\s*'research',[^}]*out_tokens:\s*(\d+)\s*\}/,
  'the research row of COST_MODEL (its out_tokens is the research max_tokens)'
);
const SITE_TEXT_MAX = S2.readSourceNumber('./19-build-research-request.js', /const SITE_TEXT_MAX = (\d+);/, 'the site text cap Build Research Request applies');

const LIFTED = [
  S2.bakedFunction(N14, 'stripDashes', 'EM_DASH'),
  S2.bakedFunction(N14, 'clean', 'formulaPrefixesStripped'),
  S2.bakedFunction(N14, 'cleanList', 'maxItems'),
  S2.bakedFunction(N14, 'extractJson', 'no JSON object could be parsed'),
  S2.bakedFunction(N14, 'costOf', 'cache_creation_input_tokens'),
  S2.bakedFunction(N14, 'classify', 'invalid_request_error'),
].join('\n');

(function assertAgainstUpstream() {
  const merge = require('./22-research-results.js');
  const route = require('./20-research-route.js');
  const call = require('./21-research-company.js');
  const build = require('./19-build-research-request.js');
  const plan = require('./15-plan-research.js');
  const parse = require('./14-parse-job-brief.js');
  if (merge.name !== 'Research Results') throw new Error('Parse Research: node 22 is named ' + JSON.stringify(merge.name) + ' and this node connects from "Research Results".');
  if (route.name !== 'Research Route') throw new Error('Parse Research: node 20 is named ' + JSON.stringify(route.name) + ' and this node reads $(\'Research Route\') output 0 for the authoritative sent order.');
  if (call.name !== 'Research Company') throw new Error('Parse Research: node 21 is named ' + JSON.stringify(call.name) + ' and this node reads $(\'Research Company\') for the responses.');
  if (build.name !== 'Build Research Request') throw new Error('Parse Research: node 19 is named ' + JSON.stringify(build.name) + ' and this node reads $(\'Build Research Request\') for the independent count of what should have been called.');
  if (plan.name !== 'Plan Research') throw new Error('Parse Research: node 15 is named ' + JSON.stringify(plan.name) + ' and the company_key this node fans out on is stamped there.');

  const resp = call.parameters.options && call.parameters.options.response && call.parameters.options.response.response;
  if (!resp || resp.fullResponse !== true || resp.neverError !== true) {
    throw new Error(
      'Parse Research: Research Company no longer sets fullResponse AND neverError. This node reads\n' +
      '  statusCode off the item to tell a credit error, an auth error and a rate limit apart, and those\n' +
      '  three want three different things said in the run report.'
    );
  }
  if (merge.parameters.numberInputs !== 2) {
    throw new Error('Parse Research: Research Results declares numberInputs ' + JSON.stringify(merge.parameters.numberInputs) + '. This node expects the two-input join.');
  }

  // The fan-out key. Without it every pair would have to be matched to a company by name at run
  // time, which is the string matching the key exists to do once.
  if (String(plan.parameters.jsCode || '').indexOf('j.company_key = ck.key;') === -1) {
    throw new Error(
      'Parse Research: Plan Research no longer stamps company_key on a pair, and this node fans the\n' +
      '  research result out to pairs BY that key. Without it every pair would silently get no hook while\n' +
      '  the research calls were still paid for.'
    );
  }
  // The site text the substring check runs against.
  if (String(build.parameters.jsCode || '').indexOf('site.site_text = text;') === -1) {
    throw new Error('Parse Research: Build Research Request no longer puts site_text on a readable company, and the hook substring check has nothing to check against. A hook that cannot be checked is refused, so every hook would be dropped.');
  }

  // ONE definition of "is this quote in that text". These are the exact normalisation fragments the
  // ad-side quote check uses, read out of its generated code. Two definitions would fail honest
  // quotes on one stage and pass invented ones on the other.
  // Each fragment names ONE HALF of the rule, specifically enough that only that half matches it.
  // The first cut of this guard looked for ".replace(/\s+/g, ' ').toLowerCase()", which appears on
  // BOTH the haystack line and the needle line, so mutating either one left the other to satisfy the
  // check and the guard reported a rule it was not testing.
  const pc = String(parse.parameters.jsCode || '');
  for (const frag of [
    "stripDashes(hayRaw).replace(/\\s+/g, ' ').toLowerCase()",
    ".toLowerCase().replace(/[.,;:!?]+$/, '')",
    'quote_line was NOT found in the posting text',
  ]) {
    if (pc.indexOf(frag) === -1) {
      throw new Error(
        'Parse Research: Parse Job Brief no longer contains ' + JSON.stringify(frag) + '.\n' +
        '  The hook substring check in this node uses the SAME normalisation as the ad-side quote check,\n' +
        '  on purpose: an allowlist and a checker that disagree about what a match is will fail honest\n' +
        '  quotes and pass invented ones. If the rule legitimately changed, change both in one edit.'
      );
    }
  }

  LN.prices(MODEL);
  if (NODE_NAME === 'Build Writer Request') {
    throw new Error('Parse Research: this node must not be named "Build Writer Request". That name is the voice-sync enrolment key and belongs to the letter writer alone.');
  }
  for (const k of REQUIRED_KEYS) {
    if (SCHEMA_KEYS.indexOf(k) === -1) throw new Error('Parse Research: ' + k + ' is required and is not in the closed schema, so it could never arrive.');
  }
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// Parse Research. Verify the hook twice, fan it out by company, split the cost.
// ---------------------------------------------------------------------------
const NL = String.fromCharCode(10);
const EM_DASH = String.fromCharCode(8212);
const EN_DASH = String.fromCharCode(8211);

let formulaPrefixesStripped = 0;

${LIFTED}

function round6(n) { return Math.round(n * 1e6) / 1e6; }

// The host of a url, lowercased, with a leading www. dropped. Both sides of the host check go
// through this, so www.acme.com and acme.com are the same host and anything else is a different one.
function hostOf(u) {
  const m = /^https?:\\/\\/([^\\/?#\\s:@]+)/i.exec(String(u || ''));
  if (!m) return null;
  return m[1].toLowerCase().replace(/^www\\./, '');
}

// ONE definition of "is this quote in that text", the same normalisation the ad-side quote check
// uses. See the build assertion in this node file.
function quoteIsIn(needleRaw, hayRaw) {
  const hay = stripDashes(String(hayRaw || '')).replace(/\\s+/g, ' ').toLowerCase();
  const needle = String(needleRaw || '').replace(/\\s+/g, ' ').toLowerCase().replace(/[.,;:!?]+$/, '');
  if (!needle.length) return false;
  return hay.indexOf(needle) !== -1;
}

// --- 1. the three views of who was called -----------------------------------
let called = [];
try {
  called = $('Research Route').all(0).map((i) => i.json);
} catch (e) {
  called = [];
}
let responses = null;
let responsesWhy = null;
try {
  responses = $('Research Company').all();
} catch (e) {
  responses = null;
  responsesWhy = e.message;
}
let expectedCalls = null;
try {
  expectedCalls = $('Build Research Request').all().map((i) => i.json).filter((j) => j && j._call_now === true).length;
} catch (e) {
  expectedCalls = null;
}
const carried = $input.all().map((i) => i.json).filter((j) => j && j._kind !== undefined);

let pairing = 'ok';
let pairingWhy = null;
const warnings = [];

if (expectedCalls !== null && called.length !== expectedCalls) {
  pairing = 'mismatch';
  pairingWhy = 'Build Research Request stamped _call_now true on ' + expectedCalls + ' compan(ies) and Research Route sent ' + called.length +
    ' down the paid branch. The route and the stamp have come apart.';
} else if (responses === null) {
  if (called.length > 0) {
    pairing = 'no_responses';
    pairingWhy = 'Research Route sent ' + called.length + ' compan(ies) and the Research Company node produced no run data (' + (responsesWhy || 'unknown') +
      '). The node did not execute. Every company is treated as unresearched, which costs a hook and nothing else.';
  }
} else if (responses.length !== called.length) {
  pairing = 'mismatch';
  pairingWhy = 'Research Route sent ' + called.length + ' compan(ies) and Research Company returned ' + responses.length +
    '. Refusing to guess an alignment: one company research result on another company pair quotes the wrong website in a cover letter.';
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

// --- 2. the research, per company --------------------------------------------
const byCompany = {};                  // company_key -> the verified result
const usageTotals = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cost_usd: 0 };
const errorKinds = {};
const statusCodes = {};
const hookRejections = [];
const companyReports = [];
let cacheReads = 0;
let cacheWrites = 0;
let parsedOk = 0;
let hooksKept = 0;
let injections = 0;
const unknownKeysSeen = {};

function emptyResult(site, state, why) {
  return {
    company_key: site.company_key,
    company_name: site.company_name || null,
    site_url: site.site_fetch_url || null,
    site_host: site.site_host || null,
    site_text: typeof site.site_text === 'string' ? site.site_text : '',
    site_chars: Number(site.site_chars) || 0,
    page_kind: null,
    hook: null,
    hook_why_dropped: why,
    banned_facts: [],
    company_line: null,
    state: state,
    why: why,
    cost_usd: 0,
    pairs: Array.isArray(site.job_ids) ? site.job_ids.length : 0,
  };
}

for (let i = 0; i < called.length; i += 1) {
  const site = called[i];
  const key = site.company_key;

  if (pairing === 'mismatch') {
    byCompany[key] = emptyResult(site, 'error:pairing', pairingWhy);
    errorKinds.pairing = (errorKinds.pairing || 0) + 1;
    continue;
  }
  if (pairing === 'no_responses') {
    byCompany[key] = emptyResult(site, 'error:node_did_not_run', pairingWhy);
    errorKinds.node_did_not_run = (errorKinds.node_did_not_run || 0) + 1;
    continue;
  }

  const item = responses[i] || {};
  const j = item.json || {};

  if (j.error !== undefined && j.statusCode === undefined) {
    const msg = String(typeof j.error === 'string' ? j.error : (j.error && j.error.message) || JSON.stringify(j.error)).slice(0, 240);
    byCompany[key] = emptyResult(site, 'error:transport', 'the research call never completed: ' + msg);
    errorKinds.transport = (errorKinds.transport || 0) + 1;
    continue;
  }
  const status = Number(j.statusCode);
  const body = j.body;
  if (!isFinite(status)) {
    byCompany[key] = emptyResult(site, 'error:transport', 'the response carried no statusCode. fullResponse is set on Research Company, so a missing status means the item is not an HTTP response at all.');
    errorKinds.transport = (errorKinds.transport || 0) + 1;
    continue;
  }
  statusCodes[String(status)] = (statusCodes[String(status)] || 0) + 1;
  if (status < 200 || status >= 300) {
    const c = classify(status, body);
    byCompany[key] = emptyResult(site, 'error:' + c.kind, c.why);
    errorKinds[c.kind] = (errorKinds[c.kind] || 0) + 1;
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

  const result = emptyResult(site, 'ok', null);
  result.cost_usd = usage.cost_usd;
  result.usage = usage;

  // THE FILTER. content[0] is not the text block. On this model an omitted thinking parameter does
  // mean thinking is off, so content[0] would happen to work today, and that is exactly the reading
  // that put a content[0] parser into two live engines and lost every job silently when the model
  // behind them changed. The law is never content[0], not never content[0] on the models where it
  // breaks.
  const content = (body && Array.isArray(body.content)) ? body.content : [];
  const textBlocks = content.filter((b) => b && b.type === 'text');
  const stop = (body && body.stop_reason) || 'unknown';
  result.content_blocks = { total: content.length, text: textBlocks.length, non_text: content.length - textBlocks.length, types: content.map((b) => (b && b.type) || 'unknown') };
  result.stop_reason = stop;
  const text = textBlocks.map((b) => String(b.text === undefined || b.text === null ? '' : b.text)).join(NL).trim();

  if (!text) {
    result.state = 'no_text';
    result.why = 'the response carried ' + content.length + ' content block(s) and none of them was a text block (types ' + JSON.stringify(result.content_blocks.types) + ', stop_reason ' + stop + ').';
    result.hook_why_dropped = result.why;
    byCompany[key] = result;
    continue;
  }

  const parsed = extractJson(text);
  if (!parsed.ok) {
    result.state = stop === 'max_tokens' ? 'truncated' : 'unparseable';
    result.why = stop === 'max_tokens'
      ? 'the research answer hit max_tokens (' + RESEARCH_MAX_TOKENS + ') and the JSON is cut off. The research stage is the cheap one and a truncated answer costs a hook, not a pair.'
      : 'the research answer would not parse as JSON: ' + parsed.why + '. First 200 characters: ' + JSON.stringify(String(parsed.sample || text).slice(0, 200));
    result.hook_why_dropped = result.why;
    byCompany[key] = result;
    continue;
  }
  parsedOk += 1;

  const ans = parsed.value;
  const unknown = Object.keys(ans).filter((k) => SCHEMA_KEYS.indexOf(k) === -1);
  for (const k of unknown) unknownKeysSeen[k] = (unknownKeysSeen[k] || 0) + 1;
  const missing = REQUIRED_KEYS.filter((k) => ans[k] === undefined);
  if (missing.length) {
    result.state = 'incomplete';
    result.why = 'the research answer is missing required field(s) ' + JSON.stringify(missing) + '. The schema is closed and a missing field is not filled in with a guess.';
    result.hook_why_dropped = result.why;
    byCompany[key] = result;
    continue;
  }

  result.page_kind = clean(ans.page_kind, PAGE_KIND_MAX) || null;
  result.injection_detected = ans.injection_detected === true;
  result.injection_note = clean(ans.injection_note, WHY_MAX) || null;

  // See header note 5. Everything this page produced is dropped and nothing from it reaches the
  // letter. The PAIR is untouched: the job may be perfectly real and this page may not even belong
  // to the employer.
  if (result.injection_detected) {
    injections += 1;
    result.state = 'injection_dropped';
    result.why = 'the researcher reports that the page tried to give it instructions: ' + (result.injection_note || 'no note recorded') +
      '. Every string this page produced is dropped, so nothing from it reaches the letter. The pair itself is untouched: the job may be real and this page may not even be the employer own.';
    result.hook_why_dropped = result.why;
    byCompany[key] = result;
    continue;
  }

  result.banned_facts = cleanList(ans.banned_facts, BANNED_FACT_MAX, BANNED_FACTS_MAX);
  result.company_line = clean(ans.company_line, COMPANY_LINE_MAX) || null;

  // --- THE HOOK, PROVED TWICE OR NULL. See header note 1. ---
  const rawHook = (ans.hook && typeof ans.hook === 'object' && !Array.isArray(ans.hook)) ? ans.hook : null;
  if (!rawHook) {
    result.state = 'ok';
    result.why = 'the researcher returned no hook, which is a correct and common answer: a page that carries only navigation, a cookie notice or a product catalogue has nothing specific enough to quote.';
    result.hook_why_dropped = 'the researcher returned null, which is an answer rather than a failure.';
    byCompany[key] = result;
    continue;
  }

  const quote = clean(rawHook.quote, QUOTE_MAX);
  const url = clean(rawHook.url, URL_MAX);
  const why = clean(rawHook.why, WHY_MAX) || null;

  // BOTH checks always run. A report that stopped at the first failure could not tell a paraphrase
  // from an answer about a different company, and those want different fixes.
  const substringOk = quote.length > 0 && quoteIsIn(quote, result.site_text);
  const answeredHost = hostOf(url);
  const fetchedHost = hostOf(result.site_url);
  const hostOk = !!answeredHost && !!fetchedHost && answeredHost === fetchedHost;

  result.hook_checks = {
    quote_present: quote.length > 0,
    substring_of_site_text: substringOk,
    url_host_answered: answeredHost,
    url_host_fetched: fetchedHost,
    host_matches: hostOk,
  };

  if (substringOk && hostOk) {
    result.hook = { quote: quote, url: result.site_url, why: why };
    result.hook_why_dropped = null;
    result.state = 'ok';
    result.why = 'a hook was returned and it passed both checks: the sentence is in the page this run fetched, and the url it cites is that page.';
    hooksKept += 1;
  } else {
    const reasons = [];
    if (!quote.length) reasons.push('the quote field was empty after cleaning');
    else if (!substringOk) reasons.push('the quoted sentence is NOT in the page text this run fetched, so it was composed or improved rather than copied');
    if (!hostOk) {
      reasons.push('hook.url points at ' + JSON.stringify(answeredHost || 'nothing parseable') + ' and the page fetched was ' + JSON.stringify(fetchedHost || 'nothing parseable') +
        ', so the answer cites a page this run never read');
    }
    const whyDropped = reasons.join('; ') + '. An invented quote reads as evidence of a careful read and is not one, which is exactly why it is checked rather than trusted.';
    result.hook = null;
    result.hook_why_dropped = whyDropped;
    result.state = 'ok';
    result.why = 'the hook was dropped: ' + whyDropped;
    hookRejections.push({ company_key: key, quote: quote.slice(0, 120), substring_ok: substringOk, host_ok: hostOk });
  }
  byCompany[key] = result;
}

for (const key of Object.keys(byCompany)) {
  const r = byCompany[key];
  companyReports.push({
    company_key: key,
    company_name: r.company_name,
    site_host: r.site_host,
    site_chars: r.site_chars,
    page_kind: r.page_kind,
    state: r.state,
    hook: r.hook ? 'kept' : 'none',
    hook_why_dropped: r.hook_why_dropped,
    banned_facts: r.banned_facts.length,
    company_line: r.company_line ? 'present' : 'none',
    cost_usd: r.cost_usd,
    pairs: r.pairs,
  });
}

// --- 3. the fan-out, and the cost split -------------------------------------
// The research cost is DIVIDED across the pairs it served, never copied, so the per pair figures add
// up to the bill. The rounding remainder goes to the first pair so the sum is exact.
const pairsByCompany = {};
for (const raw of carried) {
  if (raw && raw._kind === 'pair' && !raw._status && raw.company_key) {
    if (!pairsByCompany[raw.company_key]) pairsByCompany[raw.company_key] = [];
    pairsByCompany[raw.company_key].push(raw.job_id);
  }
}
const shareOf = {};
for (const key of Object.keys(byCompany)) {
  const n = (pairsByCompany[key] || []).length;
  const total = byCompany[key].cost_usd || 0;
  const each = n > 0 ? round6(total / n) : 0;
  shareOf[key] = { each: each, remainder: round6(total - each * n), n: n, first: (pairsByCompany[key] || [])[0] || null };
}

const out = [];
let pairsWithHook = 0;
let pairsWithResearch = 0;
let alivePairs = 0;

for (const raw of carried) {
  const j = Object.assign({}, raw);

  // The site items STOP HERE. See header note 3.
  if (j._kind === 'site') continue;

  if (j._kind !== 'pair') {
    j._call_now = false;
    out.push(j);
    continue;
  }

  if (j._status) {
    j._call_now = false;
    j.research = null;
    out.push(j);
    continue;
  }

  alivePairs += 1;
  const key = j.company_key;
  const r = key ? byCompany[key] : null;

  if (!r) {
    const planned = j._research_plan || {};
    j.research = {
      company_key: key || null,
      hook: null,
      banned_facts: [],
      company_line: null,
      site_url: planned.site_url || null,
      site_host: planned.site_host || null,
      state: 'no_site',
      why: planned.site_url
        ? 'a site url was planned for this company and no research result came back for it, so the letter carries no hook.'
        : 'no readable employer site url could be found for this company, so nothing was fetched and nothing was paid for. D6 is explicit that no hook is the correct outcome rather than a failure.',
      why_no_url: (planned.url_rejected || []),
    };
    j.site_text = '';
    j._call_now = false;
    out.push(j);
    continue;
  }

  pairsWithResearch += 1;
  if (r.hook) pairsWithHook += 1;

  j.research = {
    company_key: key,
    company_name: r.company_name,
    hook: r.hook,
    hook_why_dropped: r.hook_why_dropped,
    hook_checks: r.hook_checks || null,
    banned_facts: r.banned_facts,
    company_line: r.company_line,
    page_kind: r.page_kind,
    site_url: r.site_url,
    site_host: r.site_host,
    site_chars: r.site_chars,
    state: r.state,
    why: r.why,
    shared_with_pairs: shareOf[key] ? shareOf[key].n : 1,
    rule: 'a hook is proved twice or it is null: the sentence must be in the page this run fetched, and the url it cites must be that page. banned_facts is a NEGATIVE list of what the researcher knows that the page does NOT say; nothing on it may appear in the letter.',
  };
  // site_text rides on the pair because the A8 numbers audit downstream has to be able to ask
  // whether a figure in the letter came from the company own page. It is NOT pre-tokenised here:
  // the audit owns the definition of what a number is, and a second tokeniser would fail honest
  // letters and pass invented ones.
  j.site_text = r.site_text;

  const share = shareOf[key] || { each: 0, remainder: 0, n: 1, first: null };
  let mine = share.each;
  if (share.first && share.first === j.job_id) mine = round6(mine + share.remainder);

  const prev = (j._cost && typeof j._cost === 'object') ? j._cost : { usd: 0, calls: [] };
  const prevCalls = Array.isArray(prev.calls) ? prev.calls : [];
  j._cost = {
    usd: round6((Number(prev.usd) || 0) + mine),
    calls: prevCalls.concat([{
      stage: 'research',
      model: RESEARCH_MODEL,
      company_key: key,
      shared_with: share.n,
      company_total_usd: r.cost_usd,
      usd: mine,
      usage: r.usage || null,
      note: 'one research call per company, its cost divided evenly across the pairs it served so the per pair figures add up to the bill. The remainder rides on the first pair.',
    }]),
  };
  j._call_now = false;
  out.push(j);
}

// --- 4. the stage report ------------------------------------------------------
if (pairing === 'mismatch') warnings.push('RESEARCH PAIRING REFUSED, and no result was applied to any company because of it: ' + pairingWhy + ' No pair is marked: a pair with no hook is an ordinary outcome.');
if (pairing === 'no_responses') warnings.push('THE RESEARCH NODE DID NOT RUN: ' + pairingWhy);
if (errorKinds.credits) warnings.push('THE ANTHROPIC ACCOUNT IS OUT OF CREDIT on the research stage. Every affected company simply has no hook. The pairs are untouched and the run continues, because a hook is optional and an application is not.');
if (errorKinds.auth) warnings.push('THE ANTHROPIC KEY WAS REFUSED on the research stage. Check the credential for this workflow. Note that it is a PROVISIONAL choice: Shaheen has not picked one and human-action anthropic-credential-36-writer is open.');
if (hookRejections.length) {
  warnings.push(hookRejections.length + ' hook(s) were DROPPED because they failed the substring check, the host check or both. An invented quote reads as evidence of a careful read and is not one. The per company reasons say which check failed, and a paraphrase and an answer about a different company want different fixes.');
}
if (injections > 0) {
  warnings.push(injections + ' company page(s) tried to give the researcher instructions. Every string those pages produced was dropped and nothing from them reaches a letter. The pairs are untouched, and the companies are worth a look.');
}
if (called.length > 1 && cacheReads === 0 && parsedOk > 1) {
  warnings.push('THE RESEARCH PROMPT CACHE NEVER READ. ' + parsedOk + ' successful call(s) and cache_read_input_tokens was 0 on every one, so the researcher rubric was paid for at full price each time. The usual causes are a system block that changed between calls, a gap of more than five minutes, or a prefix under the model minimum of ' + MIN_CACHE_TOKENS + ' tokens. Cost is the only symptom.');
}
if (formulaPrefixesStripped > 0) {
  warnings.push(formulaPrefixesStripped + ' research string(s) began with =, + , - or @ and had it stripped. A cell that starts with one of those is a FORMULA in Google Sheets, and the model had just read an attacker controllable web page.');
}
if (Object.keys(unknownKeysSeen).length) {
  warnings.push('the researcher returned key(s) outside the closed schema and they were ignored: ' + JSON.stringify(unknownKeysSeen) + '.');
}

const report = {
  _kind: 'stage_report',
  stage: 'research',
  model: RESEARCH_MODEL,
  pairing: { state: pairing, why: pairingWhy, sent: called.length, responses: responses === null ? null : responses.length, expected: expectedCalls },
  counts: {
    companies_called: called.length,
    parsed: parsedOk,
    hooks_kept: hooksKept,
    hooks_dropped: hookRejections.length,
    injections_dropped: injections,
    alive_pairs: alivePairs,
    pairs_with_research: pairsWithResearch,
    pairs_with_a_hook: pairsWithHook,
  },
  companies: companyReports,
  hook_rejections: hookRejections,
  error_kinds: errorKinds,
  http_status_codes: statusCodes,
  d6: 'read the employer own site, find ONE real verifiable hook, refuse to invent one. A hook is proved twice or it is null: the sentence must be a substring of the page text this run fetched, AND the host of the url it cites must be the host this run fetched. Both checks always run and both reasons are recorded.',
  banned_facts_rule: 'a fact the company does not assert about itself does not go in the letter. The BJAK reference build found that nearly every attractive fact about a company came from newspapers rather than from the company, so the researcher lists what it knows that the page does not say, and that list travels with the pair as a negative list.',
  site_items: 'consumed here. They are scratch created by Plan Research, they carry up to ' + SITE_TEXT_MAX + ' characters of a web page each, and everything on them that matters is now on the pairs and in this report.',
  cost: {
    actual_usd: usageTotals.cost_usd,
    usage: usageTotals,
    split_rule: 'one research call per company, divided evenly across the pairs it served, the rounding remainder on the first pair, so the per pair figures add up to the bill rather than over it.',
    cache: { calls_with_a_cache_read: cacheReads, calls_that_wrote_cache: cacheWrites, of_calls: parsedOk, model_minimum_tokens: MIN_CACHE_TOKENS },
    prices: { model: RESEARCH_MODEL, in_per_mtok: PRICE_IN, out_per_mtok: PRICE_OUT, cache_write_mult: CACHE_WRITE_MULT, cache_read_mult: CACHE_READ_MULT },
  },
  warnings: warnings,
  _call_now: false,
  site_fetch_url: '',
  ad_fetch_url: '',
};

// Never an empty array.
const items = out.map((j) => ({ json: j, pairedItem: { item: 0 } }));
items.push({ json: report, pairedItem: { item: 0 } });
return items;
`;

const jsCode = [
  '// GENERATED at build time from work/36-job-application-writer/nodes/23-parse-research.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  'const RESEARCH_MODEL = ' + JSON.stringify(MODEL) + ';',
  'const RESEARCH_MAX_TOKENS = ' + JSON.stringify(RESEARCH_MAX_TOKENS) + ';',
  'const MIN_CACHE_TOKENS = ' + JSON.stringify(LN.MIN_CACHEABLE_TOKENS[MODEL]) + ';',
  'const PRICE_IN = ' + JSON.stringify(PRICE.in_per_mtok) + ';',
  'const PRICE_OUT = ' + JSON.stringify(PRICE.out_per_mtok) + ';',
  'const CACHE_WRITE_MULT = ' + JSON.stringify(PRICE.cache_write_mult) + ';',
  'const CACHE_READ_MULT = ' + JSON.stringify(PRICE.cache_read_mult) + ';',
  'const SCHEMA_KEYS = ' + JSON.stringify(SCHEMA_KEYS) + ';',
  'const REQUIRED_KEYS = ' + JSON.stringify(REQUIRED_KEYS) + ';',
  'const QUOTE_MAX = ' + JSON.stringify(QUOTE_MAX) + ';',
  'const WHY_MAX = ' + JSON.stringify(WHY_MAX) + ';',
  'const URL_MAX = ' + JSON.stringify(URL_MAX) + ';',
  'const COMPANY_LINE_MAX = ' + JSON.stringify(COMPANY_LINE_MAX) + ';',
  'const BANNED_FACT_MAX = ' + JSON.stringify(BANNED_FACT_MAX) + ';',
  'const BANNED_FACTS_MAX = ' + JSON.stringify(BANNED_FACTS_MAX) + ';',
  'const PAGE_KIND_MAX = ' + JSON.stringify(PAGE_KIND_MAX) + ';',
  'const SITE_TEXT_MAX = ' + JSON.stringify(SITE_TEXT_MAX) + ';',
  LOGIC,
].join('\n');

module.exports = {
  name: NODE_NAME,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [5460, 100],
  connectFrom: 'Research Results',
  notes: 'Filters content[] for text blocks, parses the closed research schema, and proves the hook TWICE or drops it: the quoted sentence must be a substring of the page text this run fetched, and the host of the url it cites must be the host this run fetched. Both checks always run and both reasons are recorded. Fans the result out to every pair carrying the same company_key, keeps site_text on the pair for the A8 numbers audit, and DIVIDES the research cost across the pairs it served so the per pair figures add up to the bill. Nothing here blocks a pair: a company with no hook is an ordinary outcome, and a page that tries to inject has every string it produced dropped while its pair carries on.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};
