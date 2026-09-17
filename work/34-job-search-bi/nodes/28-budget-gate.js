'use strict';
/*
 * 28-budget-gate.js - "Budget Gate". The first node of the scoring stage and the only place that
 * decides whether a paid call happens.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. THE THRESHOLD MARKS. IT NEVER DELETES. THE BUDGET IS THE SAME.
 * ---------------------------------------------------------------------------------------------
 * Shaheen on why the old engines failed: "the scoring was incorrect because the jobs were very few
 * and I believe it was way more than that but for some reason the jobs were filtered out". Those
 * engines scored to GATE, so a wrong score silently removed a job. This lane scores to RANK.
 *
 * That rule binds this node too. A row the budget refuses is NOT dropped. It is stamped
 * `score_status: 'budget_hit'` and it travels the false side of Score Route straight to the sheet,
 * unscored, visible, and sorted last. The only thing the budget takes away from a row is a number.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. EVERY ITEM PASSES THROUGH. THAT IS WHY THIS IS NOT A FILTER.
 * ---------------------------------------------------------------------------------------------
 * IN: everything the LinkedIn detail stage emitted, which is everything Remove Known emitted plus
 * an excerpt on the enriched rows plus one more source_report. Job rows, up to NINE `source_report`
 * items and three `stage_report` items, and the reports are NOT jobs: they are never scored, never
 * counted against the budget, and they carry the run verdict Stage F writes. (Eight and two until
 * 2026-09-12; the detail stage added `linkedin_guest_detail` as a reporting source and
 * `linkedin_detail_gate` as a stage. Both counts are ceilings, not expectations.)
 * OUT: every one of those items, untouched except for `_score_now`, plus this node's own stage
 * report. Nothing is ever removed here.
 *
 * `_score_now` is a boolean on EVERY item, reports included, because Score Route reads it under
 * strict type validation and an undefined there is an error rather than a false. Parse Score strips
 * the key again so it never reaches the sheet.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. THE SYSTEM BLOCK IS BUILT ONCE AND COPIED, AND THAT IS THE CACHE.
 * ---------------------------------------------------------------------------------------------
 * The rubric and the CV are baked into this node at build time as ONE constant, and every item gets
 * the same object. Anthropic's prompt cache is a PREFIX match on bytes: one differing byte anywhere
 * in the prefix and the whole thing is re-read at full price. Assembling the block per item, from
 * per-item data, is how that byte appears. So it is assembled zero times at run time.
 *
 * Measured sizes: the BI system block is about 3,400 tokens and the AI one about 4,200. Both are
 * comfortably over the 1,024-token minimum claude-sonnet-4-6 will cache, and _scoring.js refuses to
 * build if that ever stops being true, because under the minimum the marker is accepted, no cache
 * is created, nothing errors, and the run costs about ten times more.
 *
 * ---------------------------------------------------------------------------------------------
 * 4. THE COST ESTIMATE IS DELIBERATELY PESSIMISTIC, AND IT ASSUMES NO CACHE AT ALL.
 * ---------------------------------------------------------------------------------------------
 * This node runs BEFORE any call, so it cannot know what anything cost. It estimates, and it
 * estimates in the safe direction on three separate counts:
 *   - it prices the system block at FULL input rate on every call, as if the cache never formed.
 *     The cache can genuinely fail to form: a cold prefix, or more than five minutes between calls;
 *   - it assumes every reply uses the whole `max_tokens` budget, which almost none will;
 *   - it over-estimates tokens per character (3.6 rather than 4) and then adds 15 percent on top,
 *     because these postings carry Swedish and Ukrainian text that tokenises worse than English.
 * Measured against the shipped caps (20 jobs, 1.00 USD), the pessimistic estimate still admits all
 * twenty on both lanes, so the gate does not bite spuriously. It starts biting somewhere above
 * forty jobs a run, which is the point.
 *
 * The REAL cost is read off `usage` in Parse Score. This number is a brake, not an invoice.
 *
 * ---------------------------------------------------------------------------------------------
 * 5. A SETTINGS READ THAT FAILS DOES NOT SPEND MONEY, AND IT DOES NOT KILL THE RUN EITHER.
 * ---------------------------------------------------------------------------------------------
 * If Parse Settings cannot be reached, this node does not throw. Throwing would end the branch and
 * take every source report with it, which is the one thing the run most needs to explain itself.
 * Instead every job is stamped `scoring_unavailable`, ZERO calls are made, everything travels on,
 * and the stage report carries `verdict: down` with a status token. Unbounded spend and a lost run
 * report are both avoided, which is the whole point of doing it this way round.
 */

const { lane } = require('./_lane');
const S = require('./_scoring');

const L = lane();
const CV = S.loadCv(L);
const REQUEST_BASE = S.requestBase(L, CV);
const CACHE = S.assertCacheable(L, REQUEST_BASE.system);
const PRICE = S.prices(L);

// The system block is fixed for the whole run, so its token cost is a constant.
const SYSTEM_EST_TOKENS = CACHE.est_tokens;

// A hard ceiling on the description text sent per job. Measured: the collectors already cap the
// excerpt at 400 characters (EXCERPT_MAX in 18-extract-board-jobs.js), so this never fires today.
// It is here so that raising EXCERPT_MAX upstream cannot silently multiply the per-call bill.
const USER_EXCERPT_MAX = 2000;

(function assertAgainstUpstream() {
  // The node this one reads its rows from, by name, asserted rather than remembered.
  // REWIRED 2026-09-12: the LinkedIn detail stage now sits between Remove Known and this node, so
  // the rows arrive already carrying an excerpt where one could be fetched. The row SHAPE did not
  // change and neither did anything in this file's logic: Attach Detail emits exactly what Remove
  // Known emitted, plus excerpt on the enriched rows, plus one more source_report.
  const attach = require('./37-attach-detail.js');
  if (attach.name !== 'Attach Detail') {
    throw new Error('Budget Gate: node 37 is named ' + JSON.stringify(attach.name) + ' and this node connects from "Attach Detail". Node names are the wiring key; rename both in the same edit.');
  }
  const removeKnown = require('./22-remove-known.js');
  if (removeKnown.name !== 'Remove Known') {
    throw new Error('Budget Gate: node 22 is named ' + JSON.stringify(removeKnown.name) + ' and the detail stage this node now reads through connects from "Remove Known". Node names are the wiring key; rename both in the same edit.');
  }
  const parseSettings = require('./04-parse-settings.js');
  if (parseSettings.name !== 'Parse Settings') {
    throw new Error('Budget Gate: node 04 is named ' + JSON.stringify(parseSettings.name) + ' and this node reads $(\'Parse Settings\') for the budget. Rename both in the same edit.');
  }
  // The four settings keys this node needs have to still be the types it treats them as.
  const { settingsSchema } = require('./_lane');
  const SC = settingsSchema();
  for (const k of ['max_scored_per_run', 'max_cost_per_run_usd', 'score_threshold']) {
    if (SC.number.indexOf(k) === -1) {
      throw new Error('Budget Gate: ' + k + ' is no longer a number in the settings schema, and the budget arithmetic assumes it is.');
    }
  }
  if (SC.switch.indexOf('scoring_enabled') === -1) {
    throw new Error('Budget Gate: scoring_enabled is no longer a switch in the settings schema. It is the off button for a paid API and it must decode to a real boolean.');
  }
  if (SC.text.indexOf('score_scale') === -1) {
    throw new Error('Budget Gate: score_scale is no longer a text key in the settings schema. Parse Score clamps to it.');
  }
  // The ROW must still carry the fields the prompt is built from, which since 2026-09-17 is not the
  // same question as which columns the sheet has. excerpt and fit_reasons came off the sheet in that
  // trim and are declared in internal_only_fields: excerpt is still the prompt's description block,
  // fit_reasons is still parsed off the response, and neither is written anywhere now. What this
  // check protects is the PROMPT, so it reads columns plus internal and would still catch a real
  // deletion of either.
  const { sources } = require('./_lane');
  const CONTRACT_28 = sources();
  const shape = CONTRACT_28.shared_row_shape
    .concat(Object.keys(CONTRACT_28.internal_only_fields || {}).filter(function (k) { return k[0] !== '_'; }));
  for (const f of ['title', 'company', 'location', 'remote', 'posted_at', 'source', 'excerpt', 'fit_score', 'fit_reasons']) {
    if (shape.indexOf(f) === -1) {
      throw new Error(
        'Budget Gate: the contract carries no ' + f + ' field, as a sheet column or as internal. The\n' +
        '  scoring prompt is built from these fields and the score is written back into fit_score and\n' +
        '  fit_reasons. A column deletion is fine and happened on 2026-09-17; losing the FIELD is not.'
      );
    }
  }
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// Budget Gate. Decide what gets a paid call. Drop nothing, ever.
// ---------------------------------------------------------------------------
const items = $input.all();
const all = items.map((i) => i.json);

// --- 1. the settings, or an honest refusal to spend --------------------------
let cfg = null;
let settingsError = null;
try {
  cfg = $('Parse Settings').first().json;
} catch (e) {
  settingsError = e.message;
}

let scoringEnabled = false;
let maxScored = 0;
let maxCost = 0;
let scoreThreshold = null;
let scoreScale = null;
const configProblems = [];

if (!cfg) {
  configProblems.push('Parse Settings could not be reached (' + settingsError + ')');
} else {
  scoringEnabled = cfg.scoring_enabled === true;
  maxScored = Number(cfg.max_scored_per_run);
  maxCost = Number(cfg.max_cost_per_run_usd);
  scoreThreshold = isFinite(Number(cfg.score_threshold)) ? Number(cfg.score_threshold) : null;
  scoreScale = typeof cfg.score_scale === 'string' ? cfg.score_scale : null;
  if (typeof cfg.scoring_enabled !== 'boolean') {
    configProblems.push('scoring_enabled decoded to ' + JSON.stringify(cfg.scoring_enabled) + ', not a boolean. The off button for a paid API has to be a real boolean.');
  }
  if (!isFinite(maxScored) || maxScored < 1) {
    configProblems.push('max_scored_per_run is ' + JSON.stringify(cfg.max_scored_per_run) + ', which is not a usable cap');
  }
  if (!isFinite(maxCost) || maxCost <= 0) {
    configProblems.push('max_cost_per_run_usd is ' + JSON.stringify(cfg.max_cost_per_run_usd) + ', which is not a usable cap. A run with no cost ceiling against a paid API is not a run, it is an open tab.');
  }
}
// A broken budget means ZERO calls. It does NOT mean a dead branch: everything still travels.
const budgetUsable = configProblems.length === 0;

// --- 2. split the stream -----------------------------------------------------
const jobs = [];
const carried = [];
for (const j of all) {
  if (j && j._kind === 'job') jobs.push(j);
  else carried.push(j);
}

// --- 3. the per-job prompt ---------------------------------------------------
function clean(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\\r/g, '').trim();
}
function buildUser(job) {
  const ex = clean(job.excerpt);
  const truncated = ex.length > USER_EXCERPT_MAX;
  const sent = truncated ? ex.slice(0, USER_EXCERPT_MAX) : ex;
  const lines = [];
  lines.push(POSTING_OPEN);
  // source is a pipeline constant, not scraped text, so it is the one trusted line in here.
  lines.push('source: ' + clean(job.source));
  lines.push('title: ' + (clean(job.title) || '(the source published no title)'));
  lines.push('company: ' + (clean(job.company) || '(the source published no company)'));
  lines.push('location: ' + (clean(job.location) || '(the source published no location)'));
  lines.push('remote flag from the source: ' + (job.remote === true ? 'true' : (job.remote === false ? 'false' : 'not stated')));
  lines.push('posted: ' + (clean(job.posted_at) || 'not stated'));
  lines.push('description:');
  if (!sent) {
    lines.push('(none. This source publishes no description on a search result. Score on the title,');
    lines.push('the company and the location, and say so in fit_reasons.)');
  } else {
    lines.push(sent);
    if (truncated) lines.push('(the description was longer than ' + USER_EXCERPT_MAX + ' characters and is cut here)');
  }
  lines.push(POSTING_CLOSE);
  lines.push('');
  lines.push('Score this posting for the candidate. Return the JSON object only.');
  return {
    text: lines.join('\\n'),
    excerpt_chars_total: ex.length,
    excerpt_chars_sent: sent.length,
    truncated: truncated,
    has_description: sent.length > 0,
  };
}

function estTokens(chars) {
  return Math.ceil((chars / CHARS_PER_TOKEN) * ESTIMATE_SAFETY);
}
function estCostUsd(userChars) {
  // Pessimistic on purpose: no cache, full output. See the header.
  const inTok = SYSTEM_EST_TOKENS + estTokens(userChars);
  const outTok = MAX_TOKENS;
  return {
    est_input_tokens: inTok,
    est_output_tokens: outTok,
    est_cost_usd: Math.round(((inTok / 1e6) * PRICE_IN + (outTok / 1e6) * PRICE_OUT) * 1e6) / 1e6,
  };
}

// --- 4. the decision, in the order Remove Known sorted them (newest first) ----
let admitted = 0;
let runningEst = 0;
let stoppedByCount = 0;
let stoppedByCost = 0;
let noContent = 0;
let unavailable = 0;
let noDescription = 0;
let truncatedCount = 0;
const perSource = {};

const stamped = jobs.map(function (job, idx) {
  const out = Object.assign({}, job);
  const built = buildUser(job);
  const est = estCostUsd(built.text.length);
  const src = String(job.source || 'unknown');
  perSource[src] = perSource[src] || { seen: 0, admitted: 0, no_description: 0 };
  perSource[src].seen += 1;
  if (!built.has_description) { noDescription += 1; perSource[src].no_description += 1; }
  if (built.truncated) truncatedCount += 1;

  let status;
  let reason;
  if (!budgetUsable) {
    status = 'scoring_unavailable';
    reason = 'the budget settings could not be read, so no paid call was made. This row is written unscored and nothing is lost.';
    unavailable += 1;
  } else if (!scoringEnabled) {
    status = 'scoring_off';
    reason = 'scoring_enabled is off in the settings tab. The row is collected and written, it just carries no score.';
  } else if (!clean(job.title) && !clean(job.company)) {
    status = 'no_content';
    reason = 'the row carries neither a title nor a company, so there is nothing to score. Written unscored rather than dropped, and it is worth looking at where it came from.';
    noContent += 1;
  } else if (admitted >= maxScored) {
    status = 'budget_hit';
    reason = 'max_scored_per_run is ' + maxScored + ' and it was already spent. The row is written unscored, sorts last, and comes back scored on a later run once the backlog drains.';
    stoppedByCount += 1;
  } else if (runningEst + est.est_cost_usd > maxCost) {
    status = 'budget_hit';
    reason = 'the estimated run cost would pass max_cost_per_run_usd (' + maxCost + '). Estimated so far: ' +
      (Math.round(runningEst * 1e4) / 1e4) + ' USD, this row adds about ' + est.est_cost_usd + '. The row is written unscored.';
    stoppedByCost += 1;
  } else {
    status = 'pending';
    reason = null;
    admitted += 1;
    runningEst += est.est_cost_usd;
    perSource[src].admitted += 1;
  }

  const willScore = status === 'pending';
  out._score_now = willScore;
  out.score_status = status;
  out._score = {
    decision: status,
    reason: reason,
    seq: idx,
    model: MODEL,
    est_input_tokens: est.est_input_tokens,
    est_output_tokens: est.est_output_tokens,
    est_cost_usd: est.est_cost_usd,
    running_est_usd_after: Math.round(runningEst * 1e6) / 1e6,
    // Carried for Parse Score and Stage F so neither has to re-read the settings and neither can
    // disagree with the number this node actually used.
    budget: {
      scoring_enabled: scoringEnabled,
      max_scored_per_run: budgetUsable ? maxScored : null,
      max_cost_per_run_usd: budgetUsable ? maxCost : null,
      score_threshold: scoreThreshold,
      score_scale: scoreScale,
    },
  };
  out.score_input = {
    fields_present: ['title', 'company', 'location', 'remote', 'posted_at', 'excerpt']
      .filter(function (f) { return job[f] !== null && job[f] !== undefined && String(job[f]).trim() !== ''; }),
    has_description: built.has_description,
    excerpt_chars_total: built.excerpt_chars_total,
    excerpt_chars_sent: built.excerpt_chars_sent,
    description_truncated: built.truncated,
    user_chars: built.text.length,
  };
  if (willScore) {
    // The WHOLE request body, assembled here so the prompt lives in code that can be tested offline
    // rather than in an n8n expression that can only be tested by running it. The Score Job node is
    // then a dumb transport: JSON.stringify this and POST it.
    // REQUEST_BASE.system is the SAME array object on every item, so the cached prefix is byte for
    // byte identical across the run, which is the only way the cache does anything.
    out.score_request = Object.assign({}, REQUEST_BASE, {
      messages: [{ role: 'user', content: built.text }],
    });
    out.score_prompt_chars = built.text.length;
  }
  return out;
});

// --- 5. the stage report -----------------------------------------------------
const warnings = [];
let statusToken = null;
let verdict = 'ok';

if (!budgetUsable) {
  verdict = 'down';
  statusToken = 'scoring_down:budget_unreadable';
  warnings.push(
    'THE BUDGET SETTINGS COULD NOT BE READ, so this run scored NOTHING and spent nothing: ' +
    configProblems.join('; ') + '. Every job row is written unscored with score_status ' +
    'scoring_unavailable. Nothing is lost and nothing was billed, but Stage F must not read a run ' +
    'with no scores as a run with no good jobs.'
  );
} else if (!scoringEnabled) {
  statusToken = 'scoring_off';
  warnings.push(
    'scoring_enabled is OFF in the settings tab, so ' + jobs.length + ' job row(s) are written ' +
    'unscored. This is a setting, not a fault. Turn it on in the settings tab to score again.'
  );
}
if (stoppedByCount > 0) {
  warnings.push(
    'THE PER-RUN COUNT CAP BIT: ' + stoppedByCount + ' row(s) went unscored because max_scored_per_run is ' +
    maxScored + '. Remove Known already applies the same cap to what reaches this node, so this ' +
    'firing means the two disagree or the cap changed mid-run. Worth a look.'
  );
}
if (stoppedByCost > 0) {
  warnings.push(
    'THE COST CAP BIT: ' + stoppedByCost + ' row(s) went unscored because the estimated run cost reached ' +
    'max_cost_per_run_usd (' + maxCost + ' USD). The estimate is deliberately pessimistic (no cache, ' +
    'full output every call), so the real spend would have been lower. Raise the cap in the settings ' +
    'tab if these rows matter more than the difference.'
  );
}
if (noDescription > 0) {
  warnings.push(
    noDescription + ' of ' + jobs.length + ' row(s) carry NO description at all, so they are scored on ' +
    'title, company and location alone. This is not a fault in the scorer. The LinkedIn guest search ' +
    'endpoint returns cards and a card has no description on it, and LinkedIn is the whole Sweden ' +
    'channel. The linkedin_guest_detail stage is wired as of 2026-09-12 and fills that gap, so a row ' +
    'reaching here without a description carries a detail_status saying which of disabled, budget, ' +
    'refused, error, empty or markup_changed applied. Read the linkedin_guest_detail source_report ' +
    'and the linkedin_detail_gate stage report beside this one for the run-level reason.'
  );
}
if (noContent > 0) {
  warnings.push(noContent + ' row(s) carry neither a title nor a company and were written unscored. A row with no content at all points at a collector problem, not a posting problem.');
}
if (jobs.length === 0) {
  warnings.push('no job rows reached the scorer. That is a normal quiet day, and it is also what a broken collector looks like, so read the collector reports rather than this line.');
}

const report = {
  _kind: 'stage_report',
  stage: 'score_budget',
  lane: LANE_NUMBER,
  verdict: verdict,
  status_token: statusToken,
  model: MODEL,
  jobs_in: jobs.length,
  reports_passed_through: carried.length,
  admitted_for_scoring: admitted,
  by_status: stamped.reduce(function (acc, j) { acc[j.score_status] = (acc[j.score_status] || 0) + 1; return acc; }, {}),
  budget: {
    scoring_enabled: scoringEnabled,
    max_scored_per_run: budgetUsable ? maxScored : null,
    max_cost_per_run_usd: budgetUsable ? maxCost : null,
    usable: budgetUsable,
    problems: configProblems,
    stopped_by_count: stoppedByCount,
    stopped_by_cost: stoppedByCost,
  },
  cost_estimate: {
    basis: 'pessimistic: the system block is priced at full input rate on every call as if the cache never formed, and every reply is assumed to use the whole max_tokens budget',
    system_est_tokens: SYSTEM_EST_TOKENS,
    est_total_usd: Math.round(runningEst * 1e6) / 1e6,
    price_in_per_mtok: PRICE_IN,
    price_out_per_mtok: PRICE_OUT,
    note: 'the real cost is read off usage in Parse Score. This number is a brake, not an invoice.',
  },
  input_quality: {
    rows_with_a_description: jobs.length - noDescription,
    rows_with_no_description: noDescription,
    rows_truncated: truncatedCount,
    per_source: perSource,
    why_it_matters: 'a row with no description is scored on title, company and location alone. Measured on execution 5154: 0 of 201 LinkedIn rows carried a description and 748 of 748 board rows did, capped at 400 characters.',
  },
  cv: {
    path: CV_PATH,
    chars: CV_CHARS,
    sha256_16: CV_SHA,
    redacted: CV_REDACTED,
    note: 'the printable CV only. The writer-agent notes and the amendment log are cut, and the contact email and phone are redacted, because none of it helps a score and all of it would travel to a third party on every call.',
  },
  warnings: warnings,
};

// Reports go LAST and they ALWAYS go, including on a run that scored nothing, which is the run that
// most needs explaining. Returning [] here would end the branch and delete every source report with
// it. _score_now is false on all of them so Score Route sends them straight down the carry side.
const jobItems = stamped.map(function (j) { return { json: j, pairedItem: { item: 0 } }; });
const carriedItems = carried.map(function (j) { return { json: Object.assign({}, j, { _score_now: false }), pairedItem: { item: 0 } }; });
return jobItems.concat(carriedItems, [{ json: Object.assign({}, report, { _score_now: false }), pairedItem: { item: 0 } }]);
`;

const jsCode = [
  '// GENERATED at build time from work/34-job-search-bi/nodes/28-budget-gate.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  `const REQUEST_BASE = ${JSON.stringify(REQUEST_BASE)};`,
  `const MODEL = ${JSON.stringify(L.model)};`,
  `const MAX_TOKENS = ${JSON.stringify(S.MAX_TOKENS)};`,
  `const SYSTEM_EST_TOKENS = ${JSON.stringify(SYSTEM_EST_TOKENS)};`,
  `const CHARS_PER_TOKEN = ${JSON.stringify(S.CHARS_PER_TOKEN)};`,
  `const ESTIMATE_SAFETY = ${JSON.stringify(S.ESTIMATE_SAFETY)};`,
  `const PRICE_IN = ${JSON.stringify(PRICE.in_per_mtok)};`,
  `const PRICE_OUT = ${JSON.stringify(PRICE.out_per_mtok)};`,
  `const USER_EXCERPT_MAX = ${JSON.stringify(USER_EXCERPT_MAX)};`,
  `const POSTING_OPEN = ${JSON.stringify(S.POSTING_OPEN)};`,
  `const POSTING_CLOSE = ${JSON.stringify(S.POSTING_CLOSE)};`,
  `const CV_PATH = ${JSON.stringify(CV.path)};`,
  `const CV_CHARS = ${JSON.stringify(CV.chars)};`,
  `const CV_SHA = ${JSON.stringify(CV.sha256)};`,
  `const CV_REDACTED = ${JSON.stringify(CV.redacted)};`,
  `const LANE_NUMBER = ${JSON.stringify(String(L.lane))};`,
  LOGIC,
].join('\n');

module.exports = {
  name: 'Budget Gate',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [4420, 160],
  connectFrom: 'Attach Detail',
  notes: 'Decides which rows get a paid Anthropic call, on scoring_enabled, max_scored_per_run and a pessimistic cost estimate against max_cost_per_run_usd. Drops nothing: a refused row is stamped budget_hit and written unscored. Builds the whole request body per row, with the system block assembled once so the prompt cache actually forms.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};
