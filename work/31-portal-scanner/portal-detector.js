#!/usr/bin/env node
// Portal Scanner - Phase 0 ATS detector (offline, no n8n, no Claude, no cost).
// The honest go/no-go: for each seed company, detect its ATS (Tier A only for v1:
// Greenhouse, Lever, Ashby), hit the free public JSON endpoint, and count jobs
// AFTER a title/location prefilter. "Scrapable-with-jobs" is the metric, not
// "detectable". If too few companies return a prefiltered role, do NOT build the lane.
//
// No em-dashes or en-dashes anywhere (project rule).
//
// Usage:
//   node portal-detector.js               # reads ./seed.json
//   node portal-detector.js my-seed.json  # reads a custom seed file
//
// seed.json shape (array):
//   [{ "company": "Bjak", "careers_url": "https://...", "ats": "ashby", "slug": "bjak" }, ...]
//   - careers_url is required (used for detection when ats/slug are absent).
//   - ats + slug are OPTIONAL hints; when both are present, detection is skipped
//     and the endpoint is hit directly. When absent, the careers_url HTML is
//     sniffed for a Tier A signature.

'use strict';
const fs = require('fs');
const path = require('path');

// --- CONFIG ---------------------------------------------------------------

// Title prefilter: a role must contain at least one of these to count. Tuned to
// Shaheen's two tracks (Power BI / data and AI / automation). Case-insensitive.
const TITLE_KEYWORDS = [
  'power bi', 'powerbi', 'bi developer', 'bi analyst', 'business intelligence',
  'data analyst', 'data engineer', 'analytics', 'data scientist',
  'ai ', 'a.i', 'artificial intelligence', 'machine learning', ' ml ', 'llm',
  'automation', 'n8n', 'workflow', 'ai engineer', 'agent', 'rpa'
];

// Location prefilter: his real target geography is remote/global + EU + UK + Nordic
// + Gulf. Broadened 2026-07-26 after the first run showed the narrow list was
// dropping real Pleo (London/Copenhagen/Lisbon) and Ebury (Madrid) roles. Empty
// location is allowed (counted) so a missing location never silently drops a role.
const LOCATION_KEYWORDS = [
  'remote', 'anywhere', 'global', 'worldwide', 'hybrid',
  'europe', 'emea', 'eu ', 'eu,', 'eu)', 'united kingdom', 'uk', 'uk&i', 'ireland',
  'sweden', 'stockholm', 'nordic', 'denmark', 'copenhagen', 'norway', 'oslo',
  'finland', 'helsinki', 'gothenburg', 'malmo',
  'london', 'dublin', 'madrid', 'spain', 'lisbon', 'portugal', 'barcelona',
  'amsterdam', 'netherlands', 'berlin', 'germany', 'munich', 'paris', 'france',
  'warsaw', 'poland', 'tallinn', 'estonia', 'vilnius', 'lithuania', 'riga', 'latvia',
  'dubai', 'qatar', 'saudi', 'uae', 'gulf', 'abu dhabi', 'doha', 'riyadh'
];

// GO/NO-GO thresholds (from the plan).
const GO_MIN = 8;      // >= this many companies with a prefiltered role = clean GO
const NOGO_MAX = 5;    // < this many = NO-GO, pivot away from the lane

// Per-endpoint request timeout (ms).
const TIMEOUT_MS = 15000;

// --- ATS ENDPOINT BUILDERS + PARSERS -------------------------------------

// Each ATS lists MULTIPLE candidate endpoints (global + EU host) because many
// boards are EU-hosted (job-boards.eu.greenhouse.io, jobs.eu.lever.co) and answer
// on a different API host. countJobs tries them in order until one returns jobs.
const ATS = {
  greenhouse: {
    endpoints: (slug) => [
      `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
      `https://boards-api.eu.greenhouse.io/v1/boards/${slug}/jobs?content=true`
    ],
    parse: (body) => (body && Array.isArray(body.jobs) ? body.jobs : []).map((j) => ({
      title: j.title || '',
      location: (j.location && j.location.name) || '',
      url: j.absolute_url || ''
    }))
  },
  lever: {
    endpoints: (slug) => [
      `https://api.lever.co/v0/postings/${slug}?mode=json`,
      `https://api.eu.lever.co/v0/postings/${slug}?mode=json`
    ],
    parse: (body) => (Array.isArray(body) ? body : []).map((j) => ({
      title: j.text || '',
      location: (j.categories && j.categories.location) || '',
      url: j.hostedUrl || ''
    }))
  },
  ashby: {
    endpoints: (slug) => [`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`],
    parse: (body) => (body && Array.isArray(body.jobs) ? body.jobs : []).map((j) => ({
      title: j.title || '',
      location: j.location || (j.address && j.address.postalAddress && j.address.postalAddress.addressLocality) || '',
      url: j.jobUrl || ''
    }))
  }
};

// Signature regexes to sniff an ATS + slug out of a careers page HTML / redirect.
const SIGNATURES = [
  { ats: 'greenhouse', re: /(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i },
  { ats: 'greenhouse', re: /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/i },
  { ats: 'greenhouse', re: /greenhouse\.io\/embed\/job_board\?for=([a-z0-9_-]+)/i },
  { ats: 'lever',      re: /jobs\.lever\.co\/([a-z0-9_-]+)/i },
  { ats: 'lever',      re: /api\.lever\.co\/v0\/postings\/([a-z0-9_-]+)/i },
  { ats: 'ashby',      re: /jobs\.ashbyhq\.com\/([a-z0-9_-]+)/i },
  { ats: 'ashby',      re: /api\.ashbyhq\.com\/posting-api\/job-board\/([a-z0-9_-]+)/i },
  { ats: 'ashby',      re: /([a-z0-9_-]+)\.ashbyhq\.com/i }
];

// --- HELPERS --------------------------------------------------------------

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 portal-detector', ...(opts.headers || {}) } });
  } finally {
    clearTimeout(t);
  }
}

async function detectAts(careersUrl) {
  // Fetch the careers page (follows redirects) and sniff for a Tier A signature.
  try {
    const res = await fetchWithTimeout(careersUrl);
    const finalUrl = res.url || careersUrl;
    const html = await res.text();
    const haystack = finalUrl + '\n' + html;
    for (const sig of SIGNATURES) {
      const m = haystack.match(sig.re);
      if (m && m[1]) return { ats: sig.ats, slug: m[1].toLowerCase(), via: 'signature' };
    }
    return { ats: null, slug: null, via: 'no-signature' };
  } catch (e) {
    return { ats: null, slug: null, via: 'fetch-error:' + (e.message || e) };
  }
}

function titlePasses(title) {
  const t = String(title || '').toLowerCase();
  return TITLE_KEYWORDS.some((k) => t.includes(k));
}

function locationPasses(location) {
  const l = String(location || '').toLowerCase().trim();
  if (!l) return true; // missing location: do not silently drop, count + flag
  return LOCATION_KEYWORDS.some((k) => l.includes(k));
}

async function countJobs(ats, slug) {
  const spec = ATS[ats];
  if (!spec) return { ok: false, status: 'unsupported_ats', total: 0, prefiltered: 0, samples: [] };
  const urls = spec.endpoints(slug);
  let lastStatus = 'no_endpoint';
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, { headers: { accept: 'application/json' } });
      if (res.status !== 200) { lastStatus = 'http_' + res.status; continue; }
      let body;
      try { body = await res.json(); } catch (e) { lastStatus = 'bad_json'; continue; }
      const jobs = spec.parse(body);
      // A 200 with zero jobs on this host may just mean the board lives on the
      // other host: keep trying, but remember the empty as a fallback result.
      if (jobs.length === 0) { lastStatus = 'empty'; continue; }
      const titleMatched = jobs.filter((j) => titlePasses(j.title));
      const kept = titleMatched.filter((j) => locationPasses(j.location));
      return {
        ok: true, status: 'ok', endpoint: url,
        total: jobs.length,
        titleMatched: titleMatched.length,
        prefiltered: kept.length,
        samples: kept.slice(0, 5).map((j) => `${j.title} [${j.location || 'no-loc'}]`),
        titleSamples: titleMatched.slice(0, 6).map((j) => `${j.title} [${j.location || 'no-loc'}]`)
      };
    } catch (e) { lastStatus = 'error:' + (e.message || e); }
  }
  return { ok: lastStatus === 'empty', status: lastStatus, total: 0, titleMatched: 0, prefiltered: 0, samples: [], titleSamples: [] };
}

// --- MAIN -----------------------------------------------------------------

async function main() {
  const seedPath = process.argv[2] || path.join(__dirname, 'seed.json');
  if (!fs.existsSync(seedPath)) {
    console.error(`Seed file not found: ${seedPath}`);
    console.error('Create seed.json (see the header of this file for the shape) or pass a path.');
    process.exit(1);
  }
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  if (!Array.isArray(seed) || seed.length === 0) {
    console.error('Seed must be a non-empty array.');
    process.exit(1);
  }

  console.log(`Portal Scanner - Phase 0 detector. Seed: ${seed.length} companies. Tier A only (greenhouse, lever, ashby).\n`);
  const rows = [];
  for (const c of seed) {
    const company = c.company || '(unnamed)';
    let ats = (c.ats || '').toLowerCase() || null;
    let slug = c.slug || null;
    let via = 'hint';
    if (!ats || !slug) {
      if (!c.careers_url) { rows.push({ company, ats: null, slug: null, via: 'no-careers-url', result: null });
        console.log(`- ${company}: SKIP (no careers_url and no ats/slug hint)`); continue; }
      const det = await detectAts(c.careers_url);
      ats = det.ats; slug = det.slug; via = det.via;
    }
    if (!ats || !slug) {
      rows.push({ company, ats: null, slug: null, via, result: null });
      console.log(`- ${company}: NOT Tier A (${via})`);
      continue;
    }
    const result = await countJobs(ats, slug);
    rows.push({ company, ats, slug, via, result });
    const tm = result.titleMatched || 0;
    const hit = result.ok && tm > 0 ? 'HIT' : '   ';
    console.log(`- ${company}: ${ats}/${slug} (${via}) -> status=${result.status} total=${result.total} title-match=${tm} +location=${result.prefiltered || 0} ${hit}`);
    const show = (result.samples && result.samples.length) ? result.samples : (result.titleSamples || []);
    for (const s of show) console.log(`      * ${s}`);
  }

  // Summary + go/no-go. Primary metric = companies with >=1 TITLE-matching role,
  // because his search is remote-friendly and location is refined downstream; a
  // narrow location list must never suppress the go decision (the first-run lesson).
  const detected = rows.filter((r) => r.ats);
  const withTitle = rows.filter((r) => r.result && r.result.ok && (r.result.titleMatched || 0) > 0);
  const withLoc = rows.filter((r) => r.result && r.result.ok && (r.result.prefiltered || 0) > 0);
  console.log('\n===== SUMMARY =====');
  console.log(`Seed companies:                 ${seed.length}`);
  console.log(`Tier A detected + reachable:    ${detected.length}`);
  console.log(`Companies with a TITLE match:   ${withTitle.length}   <-- primary go/no-go metric`);
  console.log(`  ...also passing location:     ${withLoc.length}`);
  console.log(`Total title-matching roles:     ${withTitle.reduce((a, r) => a + (r.result.titleMatched || 0), 0)}`);
  let verdict;
  if (withTitle.length >= GO_MIN) verdict = `GO (>= ${GO_MIN} companies with a matching role)`;
  else if (withTitle.length < NOGO_MAX) verdict = `NO-GO (< ${NOGO_MAX})`;
  else verdict = `MARGINAL (${NOGO_MAX}-${GO_MIN}), Shaheen decides`;
  console.log(`VERDICT:                        ${verdict}`);

  // Machine-readable output for the next phase (candidate company_portals rows).
  const outPath = path.join(__dirname, 'detector-result.json');
  fs.writeFileSync(outPath, JSON.stringify({ ran: new Date().toISOString(), verdict, rows }, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
