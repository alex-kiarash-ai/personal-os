#!/usr/bin/env node
// Scout's Eye - deterministic weekly core (#30 Modeling, Phase 4 / measurement).
// ZERO-TOKEN: no LLM call. GET-checks the live site, tests /now staleness, and audits
// local hygiene (metrics freshness, rights-register vs UGC deliveries, availability regression).
// Emits per-check GREEN/AMBER/RED + a machine summary line the weekly wrapper parses.
// Run: node work/30-modeling/scripts/scout-checks.mjs   (from repo root)
import fs from 'node:fs';

const REPO = process.cwd();
const ROUTES = [
  'https://shaheenkiarash.com/',
  'https://shaheenkiarash.com/commercial-model-stockholm',
  'https://shaheenkiarash.com/hair-model-stockholm',
  'https://shaheenkiarash.com/fitness-model-stockholm',
  'https://shaheenkiarash.com/digitals',
  'https://shaheenkiarash.com/now',
  'https://shaheenkiarash.com/sitemap.xml',
  'https://shaheenkiarash.com/robots.txt',
];
const NOW_STALE_DAYS = 35;
const METRICS = `${REPO}/vault/projects/modeling/metrics.jsonl`;
const RIGHTS = `${REPO}/work/30-modeling/rights-register.md`;
const OUT_LEDGER = `${REPO}/outputs/ledger.jsonl`;

const results = []; // {name, status: GREEN|AMBER|RED|NA, detail}
const rank = { GREEN: 0, NA: 0, AMBER: 1, RED: 2 };
const add = (name, status, detail) => results.push({ name, status, detail });

async function get(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'alex-scout-checks' } });
    const body = await r.text();
    return { ok: r.ok, code: r.status, body };
  } catch (e) { return { ok: false, code: 0, body: '', err: e.message }; }
}

// 1. Route health - every public route must resolve 200.
async function checkRoutes() {
  const bad = [];
  let homeBody = '';
  for (const url of ROUTES) {
    const r = await get(url);
    if (url.endsWith('shaheenkiarash.com/')) homeBody = r.body;
    if (!r.ok) bad.push(`${url} -> ${r.code}${r.err ? ' ' + r.err : ''}`);
  }
  if (bad.length) add('routes', 'RED', `${bad.length}/${ROUTES.length} not 200: ${bad.join(' | ')}`);
  else add('routes', 'GREEN', `all ${ROUTES.length} routes 200`);
  // 1b. availability regression - "august" must never reappear on the homepage
  if (homeBody) {
    if (/august/i.test(homeBody)) add('availability-regression', 'RED', '"august" reappeared on the homepage');
    else add('availability-regression', 'GREEN', 'no stale "august" on homepage');
  }
  return homeBody;
}

// 2. /now staleness - the living page must be fresher than NOW_STALE_DAYS.
async function checkNowStaleness() {
  const r = await get('https://shaheenkiarash.com/now');
  const m = r.body.match(/Last updated\s+([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4})/);
  if (!m) { add('now-staleness', 'AMBER', 'could not parse "Last updated" stamp on /now'); return; }
  const when = new Date(m[1]);
  const ageDays = Math.floor((Date.now() - when.getTime()) / 86400000);
  if (isNaN(ageDays)) add('now-staleness', 'AMBER', `unparseable date "${m[1]}"`);
  else if (ageDays > NOW_STALE_DAYS) add('now-staleness', 'RED', `/now is ${ageDays}d old (>${NOW_STALE_DAYS}); monthly reviewer should rebuild it`);
  else add('now-staleness', 'GREEN', `/now updated ${m[1]} (${ageDays}d ago)`);
}

// 3. Metrics freshness - once the loop runs, metrics.jsonl should gain rows weekly.
function checkMetrics() {
  if (!fs.existsSync(METRICS)) { add('metrics-freshness', 'NA', 'no metrics.jsonl yet (pre-launch, expected)'); return; }
  const lines = fs.readFileSync(METRICS, 'utf8').trim().split('\n').filter(Boolean);
  if (!lines.length) { add('metrics-freshness', 'NA', 'metrics.jsonl empty (pre-launch)'); return; }
  let newest = 0;
  for (const l of lines) { try { const t = new Date(JSON.parse(l).ts).getTime(); if (t > newest) newest = t; } catch {} }
  const ageDays = newest ? Math.floor((Date.now() - newest) / 86400000) : 999;
  if (ageDays > 8) add('metrics-freshness', 'AMBER', `newest metrics row ${ageDays}d old (loop may be stalled once LIVE)`);
  else add('metrics-freshness', 'GREEN', `metrics fresh (${lines.length} rows, newest ${ageDays}d)`);
}

// 4. Rights-register vs UGC deliveries - every UGC delivery in the ledger needs a rights row.
function checkRights() {
  let deliveries = 0;
  if (fs.existsSync(OUT_LEDGER)) {
    for (const l of fs.readFileSync(OUT_LEDGER, 'utf8').trim().split('\n').filter(Boolean)) {
      try { const r = JSON.parse(l); if (r.project === 'modeling' && /ugc|delivery|deliverable/i.test(r.desc || '')) deliveries++; } catch {}
    }
  }
  if (deliveries === 0) { add('rights-register', 'NA', 'no UGC deliveries yet - nothing to register'); return; }
  // count only real data rows (a delivery row carries a 20xx date); skips header + separator
  const rows = fs.existsSync(RIGHTS) ? (fs.readFileSync(RIGHTS, 'utf8').match(/^\|.*\b20\d{2}\b.*$/gm) || []).length : 0;
  if (rows >= deliveries) add('rights-register', 'GREEN', `${rows} rights rows cover ${deliveries} UGC deliveries`);
  else add('rights-register', 'RED', `${deliveries} UGC deliveries but only ${rows} rights rows - register a scope+expiry for each`);
}

(async () => {
  await checkRoutes();
  await checkNowStaleness();
  checkMetrics();
  checkRights();

  const worst = results.reduce((w, r) => (rank[r.status] > rank[w] ? r.status : w), 'GREEN');
  console.log('=== Scout\'s Eye (modeling, deterministic core) ===');
  for (const r of results) console.log(`  [${r.status}] ${r.name}: ${r.detail}`);
  const counts = results.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  const summary = `SCOUT ${worst} | ${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' ')}`;
  console.log(summary);
  // exit non-zero only on RED so the wrapper can push RED to HQ
  process.exit(worst === 'RED' ? 1 : 0);
})();
