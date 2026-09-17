'use strict';
/*
 * 15-plan-research.js - "Plan Research". Decides which EMPLOYER SITES this run will fetch, once per
 * company rather than once per job, and refuses a url that is not plausibly the employer's own.
 *
 * =============================================================================================
 * 1. ONE SITE ITEM PER COMPANY, AND WHY THAT IS THE WHOLE SHAPE OF THIS STAGE.
 * =============================================================================================
 * The research stage exists for D6: read the employer's own site, find ONE real verifiable hook,
 * refuse to invent one. A company is the unit of that, not a job. Two roles at the same employer in
 * one morning would otherwise fetch the same homepage twice and pay for the same sonnet call twice,
 * and would then be able to disagree about the same company in two letters going out on the same
 * day, which is worse than the cost.
 *
 * So this node emits ONE item with `_kind: 'site'` per distinct company_key, the fetch and the
 * research call run per company, and Parse Research fans the answer back out to the pairs by that
 * key. Every pair carries its company_key from here so the fan-out is a lookup rather than a guess.
 *
 * =============================================================================================
 * 2. THE COMPANY KEY, AND WHY AN UNKNOWN COMPANY GETS ITS OWN KEY RATHER THAN A SHARED ONE.
 * =============================================================================================
 * The key is the employer name the recruiter read out of the ad, normalised: lowercased, legal
 * suffixes removed (ab, oy, gmbh, ltd, inc and the rest), punctuation dropped, whitespace collapsed.
 * The reader's employer wins over the board's company cell, because the board cell is often the
 * agency or a stale string and the posting itself is the better source.
 *
 * When neither yields anything, the key falls back to the JOB ID rather than to a shared empty
 * string. That matters: an empty key would merge every nameless employer of the morning into one
 * "company", fetch one site for all of them, and quote that site in unrelated letters.
 *
 * =============================================================================================
 * 3. THE URL, AND THE DENYLIST THAT DECIDES WHETHER IT IS THE EMPLOYER'S OWN.
 * =============================================================================================
 * First choice is `brief.employer_website`: the reader is asked for the employer's own absolute
 * https url and told null is the right answer far more often than not.
 *
 * Second choice is the HOST of the row's apply_url, turned into a root url. An apply_url usually
 * points at wherever the application is taken, and when that host is NOT a job board or an
 * applicant tracking system it is nearly always the company's own careers domain. When it IS one,
 * there is nothing to read: a Greenhouse page is about Greenhouse.
 *
 * The denylist is in _stage2.js. Its board half is DERIVED from the shared source contract so a new
 * collector source lands in it in the same edit; its ATS half is written, because no file in this
 * repo knows it. It is applied to BOTH candidate urls, including the one the model supplied, which
 * goes one step past the plan's wording on purpose: the reader is TOLD never to return a board, and
 * a rule a model is told is a request rather than a guarantee.
 *
 * =============================================================================================
 * 4. THE URL GUARD IS SEAT 3's, LIFTED, NOT REWRITTEN.
 * =============================================================================================
 * `guardUrl` and its two helpers are baked out of the generated code of 05-build-candidates.js.
 * Runtime nodes cannot require each other, so lifting the SOURCE is the only honest reuse, and
 * _stage2.js fails this build by name if the function is ever renamed or reshaped upstream.
 *
 * The guard matters more here than it did there, not less. There the url came from a spreadsheet
 * cell a collector wrote. Here one of the two candidates was chosen by a MODEL that had just read
 * an attacker-controllable job ad, so a posting that wants this workflow to fetch something is one
 * `employer_website` field away from trying. https only, port 443 only, no credentials in the url,
 * no ip literal, no private range, no single-label docker service name, no .internal or .local.
 *
 * =============================================================================================
 * 5. NOTHING HERE BLOCKS A PAIR. RESEARCH IS OPTIONAL BY DESIGN.
 * =============================================================================================
 * A company with no readable site gets no hook, and D6 says a letter with no hook is the correct
 * outcome rather than a failure: "refuse to invent one". So every refusal in this node is recorded
 * on the pair and in the report and changes no pair's status. The only thing a missing site costs
 * is one sentence of the letter, and the alternative costs the truth.
 */

const LN = require('./_lane');
const S2 = require('./_stage2');

const NODE_NAME = 'Plan Research';
const N05 = './05-build-candidates.js';
const N05_ABS = require.resolve('./05-build-candidates.js');

const DENY = S2.denyDomains();

// Seat 3's guard, lifted verbatim out of the node that already ships it.
const LIFTED = [
  S2.bakedFunction(N05, 'txt', 'replace'),
  S2.bakedFunction(N05, 'isIpv4', 'parts.length !== 4'),
  S2.bakedFunction(N05, 'isPrivateIpv4', 'p[0] === 169'),
  S2.bakedFunction(N05, 'guardUrl', 'only 443 is allowed'),
].join('\n');

const BLOCKED_HOST_LABELS = LN.readBakedConst(N05_ABS, 'BLOCKED_HOST_LABELS', '[');
const BLOCKED_HOST_SUFFIXES = LN.readBakedConst(N05_ABS, 'BLOCKED_HOST_SUFFIXES', '[');

// Legal-form suffixes stripped when a company name becomes a key. Deliberately a small list of
// forms that appear in Nordic, EU and Gulf postings. Over-stripping merges two companies whose
// names differ only by form, which has never happened; under-stripping splits "Acme AB" from
// "Acme" into two keys and pays for the same site twice, which is the ordinary case.
const LEGAL_SUFFIXES = [
  'ab', 'abp', 'oyj', 'oy', 'as', 'asa', 'a/s', 'aps', 'gmbh', 'mbh', 'ag', 'kg', 'bv', 'nv',
  'ltd', 'limited', 'llc', 'llp', 'lp', 'inc', 'incorporated', 'corp', 'corporation', 'co',
  'plc', 'sa', 'sas', 'sarl', 'srl', 'spa', 'sl', 'kft', 'zrt', 'dmcc', 'fzco', 'fze', 'llc-fz',
  'group', 'holding', 'holdings', 'technologies', 'technology',
];

(function assertAgainstUpstream() {
  const parse = require('./14-parse-job-brief.js');
  if (parse.name !== 'Parse Job Brief') {
    throw new Error('Plan Research: node 14 is named ' + JSON.stringify(parse.name) + ' and this node connects from "Parse Job Brief". Rename both in the same edit.');
  }
  const code = String(parse.parameters.jsCode || '');

  // The brief is the source of employer and employer_website. If the closed schema stopped carrying
  // either, this node would silently fall back to the board cell for every single pair and the
  // research stage would quietly become "fetch whatever the apply url points at".
  if (code.indexOf('employer_website:') === -1 || code.indexOf('employer:') === -1) {
    throw new Error(
      'Plan Research: Parse Job Brief no longer writes employer and employer_website onto brief.\n' +
      '  Those two are the first choice for the company key and for the site url. Without them this node\n' +
      '  would fall back to the board cell and to the apply url on every pair, which is a quieter and\n' +
      '  much worse version of the same stage.'
    );
  }
  // Only ALIVE pairs are planned, and alive is "_status is falsy". Parse Job Brief owns that
  // vocabulary; if it stopped stamping _status the filter here would admit blocked pairs and pay to
  // research a company whose job was already refused.
  if (code.indexOf('pair._status =') === -1 && code.indexOf('p._status =') === -1) {
    throw new Error('Plan Research: Parse Job Brief no longer stamps _status on a pair, and this node plans research only for pairs whose _status is still null.');
  }

  if (!DENY.domains.length) {
    throw new Error('Plan Research: the board and ATS denylist is empty, so every job board would read as the employer own site.');
  }
  for (const d of ['linkedin.com', 'indeed.com', 'greenhouse.io', 'lever.co', 'ashbyhq.com', 'workable.com']) {
    if (DENY.domains.indexOf(d) === -1) {
      throw new Error('Plan Research: the denylist is missing ' + JSON.stringify(d) + ', which the approved plan names by hand.');
    }
  }
  if (!LIFTED || LIFTED.indexOf('function guardUrl') === -1) {
    throw new Error('Plan Research: the lifted url guard is empty. It is seat 3 own guard and it is lifted rather than rewritten.');
  }
  if (!Array.isArray(BLOCKED_HOST_LABELS) || BLOCKED_HOST_LABELS.indexOf('gotenberg') === -1) {
    throw new Error('Plan Research: the blocked host labels no longer name the render container. That label is what stops a crafted url reaching gotenberg from inside the docker network.');
  }
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// Plan Research. Key every company, pick one url each, guard it, emit one site item per company.
// ---------------------------------------------------------------------------
const NL = String.fromCharCode(10);

${LIFTED}

// --- the company key ---------------------------------------------------------
function companyKey(pair) {
  const brief = pair.brief || {};
  const raw = txt(brief.employer) || txt(pair.company);
  const cleaned = String(raw).toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!cleaned) {
    // Never a shared empty key. See header note 2: one empty key would merge every nameless
    // employer of the morning into one company and quote one site in unrelated letters.
    return { key: 'job:' + String(pair.job_id), why: 'neither the posting nor the board named an employer, so this pair is its own company and shares a site with nothing', named: false };
  }
  const words = cleaned.split(' ').filter(function (w) { return w && LEGAL_SUFFIXES.indexOf(w) === -1; });
  const key = (words.length ? words : cleaned.split(' ')).join('-');
  return { key: key, why: 'from ' + (txt(brief.employer) ? 'the posting employer name' : 'the board company cell'), named: true };
}

// --- the denylist ------------------------------------------------------------
// Whole-label matching, never substring: a rule that matched "lever.co" anywhere would refuse
// clever.com, and a rule that matched labels refuses jobs.lever.co and allows clever.com.
function deniedHost(host) {
  const h = String(host || '').toLowerCase();
  for (const d of DENY_DOMAINS) {
    if (h === d || (h.length > d.length + 1 && h.slice(-(d.length + 1)) === '.' + d)) return d;
  }
  return null;
}

// --- pick one url per company ------------------------------------------------
function pickSiteUrl(pair) {
  const brief = pair.brief || {};
  const tries = [];
  const stated = txt(brief.employer_website);
  if (stated) tries.push({ from: 'the posting own employer_website, as the recruiter seat read it', raw: stated, asRoot: false });
  const apply = txt(pair.apply_url);
  if (apply) tries.push({ from: 'the host of the row apply_url', raw: apply, asRoot: true });

  const rejected = [];
  for (const t of tries) {
    const g = guardUrl(t.raw);
    if (!g.ok) { rejected.push({ from: t.from, why: 'the url guard refused it: ' + g.why }); continue; }
    const denied = deniedHost(g.host);
    if (denied) {
      rejected.push({ from: t.from, why: 'the host ' + g.host + ' is on the board and ATS denylist (' + denied + '), and a job board page is about the board rather than about the employer' });
      continue;
    }
    if (!t.asRoot) return { url: g.url, host: g.host, from: t.from, rejected: rejected };
    // The apply url is turned into the ROOT of its host. The apply page itself is an application
    // form: it carries the ATS chrome and rarely a sentence about the company worth quoting.
    return { url: 'https://' + g.host + '/', host: g.host, from: t.from + ', reduced to the site root because an application form is not a company page', rejected: rejected };
  }
  return { url: null, host: null, from: null, rejected: rejected };
}

// --- 1. walk the stream -------------------------------------------------------
const items = $input.all().map((i) => i.json);
if (!items.length) {
  throw new Error('Plan Research: Parse Job Brief delivered no items at all. It emits at least its own stage report on every path, so an empty input means that node did not run and every lane report has already been lost.');
}

const out = [];
const companies = {};       // key -> the plan for that company
const order = [];           // stable, first-seen order, so the site items are deterministic
let alivePairs = 0;
let pairsWithSite = 0;
const rejectionCounts = {};

for (const raw of items) {
  const j = Object.assign({}, raw);

  if (j._kind !== 'pair') {
    j._call_now = false;
    j.site_fetch_url = '';
    out.push(j);
    continue;
  }

  if (j._status) {
    // Dead pair: blocked, held, capped or errored upstream. Untouched apart from the two stamps
    // the strict routes downstream need on every single item.
    j._call_now = false;
    j.site_fetch_url = '';
    j.company_key = null;
    out.push(j);
    continue;
  }

  alivePairs += 1;
  const ck = companyKey(j);
  j.company_key = ck.key;
  j._call_now = false;
  j.site_fetch_url = '';

  if (!companies[ck.key]) {
    const picked = pickSiteUrl(j);
    companies[ck.key] = {
      company_key: ck.key,
      company_name: txt((j.brief || {}).employer) || txt(j.company) || null,
      company_named: ck.named,
      key_why: ck.why,
      lane_key: j.lane_key,
      site_url: picked.url,
      site_host: picked.host,
      url_from: picked.from,
      url_rejected: picked.rejected,
      job_ids: [],
    };
    order.push(ck.key);
    for (const r of picked.rejected) {
      const k = r.from;
      rejectionCounts[k] = (rejectionCounts[k] || 0) + 1;
    }
  }
  const plan = companies[ck.key];
  plan.job_ids.push(j.job_id);
  if (plan.site_url) pairsWithSite += 1;

  j._research_plan = {
    company_key: ck.key,
    company_name: plan.company_name,
    site_url: plan.site_url,
    site_host: plan.site_host,
    url_from: plan.url_from,
    url_rejected: plan.url_rejected,
    shared_with_job_ids: plan.job_ids,
    rule: 'one site fetch and one research call per company, never per job. Parse Research fans the answer back to every pair carrying this company_key.',
  };
  out.push(j);
}

// --- 2. one site item per company that has a url -------------------------------
const siteItems = [];
for (const key of order) {
  const c = companies[key];
  if (!c.site_url) continue;
  siteItems.push({
    _kind: 'site',
    company_key: c.company_key,
    company_name: c.company_name,
    lane_key: c.lane_key,
    site_fetch_url: c.site_url,
    site_host: c.site_host,
    url_from: c.url_from,
    job_ids: c.job_ids.slice(),
    pairs: c.job_ids.length,
    _call_now: true,
    ad_fetch_url: '',
  });
}

// --- 3. the stage report --------------------------------------------------------
const warnings = [];
const noUrl = order.filter((k) => !companies[k].site_url);
if (noUrl.length) {
  warnings.push(noUrl.length + ' compan(ies) have no readable site url, so their letters get no hook. D6 is explicit that no hook is the correct outcome rather than a failure: an invented quote is worse than no quote. Reasons are on each pair under _research_plan.url_rejected.');
}
if (alivePairs && !siteItems.length) {
  warnings.push('NOT ONE site will be fetched this run. That is ordinary on a morning of board-hosted postings, and it is also what a broken employer_website field looks like, so the per company reasons are worth reading rather than counting.');
}

const report = {
  _kind: 'stage_report',
  stage: 'research_plan',
  alive_pairs: alivePairs,
  companies: order.length,
  sites_to_fetch: siteItems.length,
  pairs_with_a_site: pairsWithSite,
  plans: order.map((k) => ({
    company_key: k,
    company_named: companies[k].company_named,
    site_host: companies[k].site_host,
    url_from: companies[k].url_from,
    pairs: companies[k].job_ids.length,
    rejected: companies[k].url_rejected,
  })),
  rejections_by_source: rejectionCounts,
  denylist: {
    domains: DENY_DOMAINS.length,
    rule: 'whole label matching, never substring. The board half is derived from the shared source contract so a new collector source lands in it in the same edit; the ATS half is written down.',
  },
  url_guard: 'lifted verbatim from Build Candidates. https only, port 443 only, no credentials in the url, no ip literal, no private range, no single label docker service name, no .internal or .local. One of the two candidate urls was chosen by a model that had just read an attacker controllable job ad, so the guard matters more here than it did there.',
  rule: 'one site item per company, never per job. Nothing in this node blocks a pair: a company with no readable site costs one sentence of the letter and nothing else.',
  warnings: warnings,
  _call_now: false,
  site_fetch_url: '',
  ad_fetch_url: '',
};

// Pairs and carried items first, then the site items, then this report. Never an empty array: a
// Code node returning [] ends the branch and takes every lane report with it.
return out.concat(siteItems, [report]).map((j) => ({ json: j, pairedItem: { item: 0 } }));
`;

const jsCode = [
  '// GENERATED at build time from work/36-job-application-writer/nodes/15-plan-research.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  'const DENY_DOMAINS = ' + JSON.stringify(DENY.domains) + ';',
  'const LEGAL_SUFFIXES = ' + JSON.stringify(LEGAL_SUFFIXES) + ';',
  'const BLOCKED_HOST_LABELS = ' + JSON.stringify(BLOCKED_HOST_LABELS) + ';',
  'const BLOCKED_HOST_SUFFIXES = ' + JSON.stringify(BLOCKED_HOST_SUFFIXES) + ';',
  LOGIC,
].join('\n');

module.exports = {
  name: NODE_NAME,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [3380, 100],
  connectFrom: 'Parse Job Brief',
  notes: 'Keys every alive pair to a company, picks ONE employer site url per company (the posting own employer_website first, else the apply url host reduced to its root), runs both candidates through seat 3 own url guard and through a board and ATS denylist derived from the shared source contract, and emits one _kind site item per company rather than one per job. Nothing here blocks a pair: a company with no readable site simply gets no hook, which D6 calls the correct outcome.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};
