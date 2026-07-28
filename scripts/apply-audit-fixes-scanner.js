// Apply the 2026-07-28 node-audit SAFE SET to the LIVE Portal Scanner (5tPXbhdpp6PfF56V).
// SF3 (retry flags on the 2 Sheets reads), SF1 (80-char empty-JD gate), SF5 (boundary-safe
// location match), SF4 (recency split). SF2 DEFERRED. Backup-first, dry-run, syntax-check, PUT,
// read-back. DRY_RUN=1 => no PUT.
const fs = require('fs');
const path = require('path');
const BASE = 'https://n8n.shaheenkiarash.com/api/v1';
const KEY = fs.readFileSync(path.join(__dirname, '../work/03-application-engine/config/n8n-api-key.txt'), 'utf8').trim();
const HDRS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };
const DRY = process.env.DRY_RUN === '1';
const ID = '5tPXbhdpp6PfF56V';
const ALLOWED_SETTINGS = ['executionOrder','timezone','errorWorkflow','saveDataErrorExecution','saveDataSuccessExecution','saveManualExecutions','saveExecutionProgress'];

async function api(method, url, body) {
  const res = await fetch(BASE + url, { method, headers: HDRS, body: body ? JSON.stringify(body) : undefined });
  const txt = await res.text(); let json = null; try { json = JSON.parse(txt); } catch (e) {}
  return { status: res.status, json, txt };
}
const nodeByName = (wf, n) => wf.nodes.find(x => x.name === n);

// ---- the SF5 block (exact live text) -> boundary-safe replacement ----
const SF5_FIND = `const LOCATION_KEYWORDS = [
  'remote', 'anywhere', 'global', 'worldwide', 'hybrid',
  'europe', 'emea', 'eu ', 'eu,', 'eu)', 'united kingdom', 'uk', 'uk&i', 'ireland',
  'sweden', 'stockholm', 'nordic', 'denmark', 'copenhagen', 'norway', 'oslo',
  'finland', 'helsinki', 'gothenburg', 'malmo',
  'london', 'dublin', 'madrid', 'spain', 'lisbon', 'portugal', 'barcelona',
  'amsterdam', 'netherlands', 'berlin', 'germany', 'munich', 'paris', 'france',
  'warsaw', 'poland', 'tallinn', 'estonia', 'vilnius', 'lithuania', 'riga', 'latvia',
  'dubai', 'qatar', 'saudi', 'uae', 'gulf', 'abu dhabi', 'doha', 'riyadh'
];`;
const SF5_REPLACE = `// SF5: boundary-safe location matching. Bare indexOf('uk') hit "Milwaukee"/"Waukesha"/"Ukraine";
// the old 'eu '/'eu,'/'eu)' entries were hand-faked boundaries. PHRASES are safe substrings;
// short ambiguous country codes are matched ONLY at word boundaries. se/no/ie dropped (their
// cities are phrase-covered) to kill the "Se Portland"/"No. 12"/"Ie Shima" false-keep class.
const LOC_PHRASES = [
  'remote', 'anywhere', 'global', 'worldwide', 'hybrid',
  'europe', 'emea', 'united kingdom', 'uk&i', 'england', 'scotland', 'wales', 'ireland',
  'sweden', 'stockholm', 'nordic', 'nordics', 'scandinavia', 'denmark', 'copenhagen',
  'norway', 'oslo', 'finland', 'helsinki', 'gothenburg', 'goteborg', 'malmo',
  'london', 'dublin', 'madrid', 'spain', 'lisbon', 'portugal', 'barcelona', 'valencia',
  'amsterdam', 'netherlands', 'rotterdam', 'berlin', 'germany', 'munich', 'stuttgart',
  'frankfurt', 'hamburg', 'cologne', 'paris', 'france', 'warsaw', 'krakow', 'poland',
  'tallinn', 'estonia', 'vilnius', 'lithuania', 'riga', 'latvia',
  'dubai', 'qatar', 'saudi', 'uae', 'gulf', 'abu dhabi', 'doha', 'riyadh'
];
const LOC_TOKENS = ['uk', 'eu', 'uae', 'dk', 'fi'];
const LOC_TOKEN_RE = new RegExp('\\\\b(' + LOC_TOKENS.join('|') + ')\\\\b', 'i');`;

const LOCPASS_FIND = `const locationPasses = (l) => {
  const s = String(l || '').toLowerCase().trim();
  if (!s) return true; // missing location: never silently drop
  return LOCATION_KEYWORDS.some((k) => s.indexOf(k) !== -1);
};`;
const LOCPASS_REPLACE = `const locationPasses = (l) => {
  const s = String(l || '').toLowerCase().trim();
  if (!s) return true; // missing location: never silently drop
  if (LOC_PHRASES.some((k) => s.indexOf(k) !== -1)) return true;
  return LOC_TOKEN_RE.test(s);
};`;

const EDITS = [
  // SF1 - const + predicate near MAX_AGE_HOURS, and the keep-filter (upstream of the cap).
  { tag: 'SF1-const', find: 'const MAX_AGE_HOURS = 100;',
    replace: "const MAX_AGE_HOURS = 100;\n// SF1: minimum real-JD length (stubs/empties cluster <=40 chars; real JDs 240+). Under-drops.\nconst MIN_DESC_CHARS = 80;\nconst descPasses = (d) => String(d || '').trim().length >= MIN_DESC_CHARS;" },
  { tag: 'SF1-filter',
    find: "    .filter((j) => locationPasses(j.location))\n    .filter((j) => {\n      const age = ageHours(j.posted_at);",
    replace: "    .filter((j) => locationPasses(j.location))\n    .filter((j) => {\n      if (descPasses(j.description)) return true;\n      console.log('SF1 drop empty-desc:', company, '|', j.title, '| len=', String(j.description||'').trim().length);\n      return false;\n    })\n    .filter((j) => {\n      const age = ageHours(j.recency_at);" },
  // SF5 - array + predicate.
  { tag: 'SF5-array', find: SF5_FIND, replace: SF5_REPLACE },
  { tag: 'SF5-pass', find: LOCPASS_FIND, replace: LOCPASS_REPLACE },
  // SF4 - recency_at per parser (age already switched to recency_at in SF1-filter).
  { tag: 'SF4-gh',
    find: "    posted_at: j.first_published || j.updated_at || '',\n    description: stripHtml(j.content || '')",
    replace: "    recency_at: j.first_published || '',\n    posted_at: j.first_published || j.updated_at || '',\n    description: stripHtml(j.content || '')" },
  { tag: 'SF4-lever',
    find: "    posted_at: Number.isFinite(Number(j.createdAt)) ? new Date(Number(j.createdAt)).toISOString() : '',\n    description: stripHtml(j.descriptionPlain || j.description || '')",
    replace: "    recency_at: (Number(j.createdAt) > 0) ? new Date(Number(j.createdAt)).toISOString() : '',\n    posted_at: Number.isFinite(Number(j.createdAt)) ? new Date(Number(j.createdAt)).toISOString() : '',\n    description: stripHtml(j.descriptionPlain || j.description || '')" },
  { tag: 'SF4-ashby',
    find: "    posted_at: j.publishedAt || '',\n    description: stripHtml(j.descriptionPlain || j.descriptionHtml || '')",
    replace: "    recency_at: j.publishedAt || '',\n    posted_at: j.publishedAt || '',\n    description: stripHtml(j.descriptionPlain || j.descriptionHtml || '')" },
];
// SF3 - node flags (not jsCode).
const FLAG_NODES = ['Read Company Portals', 'Read Processed Jobs'];

const POS = ['MIN_DESC_CHARS = 80', 'LOC_TOKEN_RE', 'recency_at: j.first_published', 'ageHours(j.recency_at)', 'SF1 drop empty-desc'];
const NEG = ["LOCATION_KEYWORDS.some((k) => s.indexOf(k)", "ageHours(j.posted_at)"];

(async () => {
  console.log(`=== Portal Scanner (${ID}) ${DRY ? '[DRY]' : '[LIVE]'} ===`);
  const g = await api('GET', `/workflows/${ID}`);
  if (g.status !== 200) { console.log(`GET failed ${g.status}`); return; }
  const wf = g.json; const wasActive = wf.active;
  const map = nodeByName(wf, 'Map + Prefilter + Cap');
  if (!map) { console.log('MISS Map + Prefilter + Cap'); return; }
  let ok = true;
  for (const e of EDITS) {
    const c = map.parameters.jsCode.split(e.find).length - 1;
    if (c !== 1) { console.log(`  ASSERT-FAIL ${e.tag}: found ${c}, expected 1`); ok = false; continue; }
    map.parameters.jsCode = map.parameters.jsCode.split(e.find).join(e.replace);
    console.log(`  ok  ${e.tag}`);
  }
  // SF3 flags
  for (const nm of FLAG_NODES) {
    const n = nodeByName(wf, nm);
    if (!n) { console.log(`  MISS ${nm}`); ok = false; continue; }
    n.retryOnFail = true; n.maxTries = 4; n.waitBetweenTries = 5000;
    console.log(`  ok  SF3 retry on "${nm}"`);
  }
  if (!ok) { console.log('  >> FAILURES - NOT written.'); return; }
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  try { new AsyncFunction(map.parameters.jsCode); console.log('  syntax ok (Map + Prefilter + Cap)'); }
  catch (err) { console.log(`  SYNTAX-FAIL: ${err.message}`); return; }
  if (DRY) { console.log('  >> DRY: all edits matched + syntax-clean.'); return; }
  const settings = {}; for (const k of ALLOWED_SETTINGS) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
  const put = await api('PUT', `/workflows/${ID}`, { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings });
  if (put.status !== 200) { console.log(`  PUT failed ${put.status}: ${put.txt.slice(0,300)}`); return; }
  const rb = await api('GET', `/workflows/${ID}`); const s = JSON.stringify(rb.json);
  const posMiss = POS.filter(p => !s.includes(p)); const negHit = NEG.filter(n => s.includes(n));
  let active = rb.json.active;
  if (!active) { const a = await api('POST', `/workflows/${ID}/activate`); active = a.json && a.json.active; }
  console.log(`  PUT ok. read-back: posMissing=${posMiss.length?JSON.stringify(posMiss):'none'} negPresent=${negHit.length?JSON.stringify(negHit):'none'} active=${active} (was ${wasActive})`);
  console.log((posMiss.length||negHit.length||!active) ? '  >> VERIFY WARNING - inspect.' : '  >> Portal Scanner VERIFIED.');
})();
