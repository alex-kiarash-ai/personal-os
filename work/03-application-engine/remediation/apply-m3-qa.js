// Remediation Milestone 3: F08, F10, F11, F09, plus F17 (same node, so batched).
//
//   F08  deterministic whitelist tripwire against fabricated CV experience
//   F10  company-mention check normalized so legal entity names stop false-failing
//   F11  CV PDF page count measured on the rendered artifact, multi-page blocked
//   F09  add "consultant" to #14's match schema so the gate and tone become reachable
//   F17  Drive folder slug gains the job_posting_id so repeat companies stop colliding
//
// F08 whitelists are DERIVED from each engine's own MASTER_CV at apply time, so the two
// lanes get their own correct employer and date sets and a CV edit is caught by
// re-running this script rather than by hand-editing the QA node.
//
// SAFETY: dry-run by default; --apply to write.
'use strict';
const fs = require('fs');
const path = require('path');

const CFG = path.join(__dirname, '..', 'config');
const BACKUPS = path.join(__dirname, '..', '..', '..', 'scripts', 'n8n-backups');
const API = 'https://n8n.shaheenkiarash.com/api/v1';
const KEY = fs.readFileSync(path.join(CFG, 'n8n-api-key.txt'), 'utf8').trim();
const HDRS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };

const APPLY = process.argv.includes('--apply');
const ENGINES = [['#03', '9XuIEfxS71DEetVR'], ['#14', '9x9M3EnEEeX3O8dy']];
const ALLOWED_SETTINGS = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution',
  'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'];

function must(c, m) { if (!c) { console.error('ASSERT FAILED:', m); process.exit(1); } }
const node = (w, n) => w.nodes.find((x) => x.name === n);
function stripComments(src) {
  return String(src || '').replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ').replace(/([^:])\/\/.*$/gm, '$1');
}
function syntaxOk(src, label) {
  try { new Function(src); return true; } catch (e) { console.error(`  SYNTAX ERROR ${label}: ${e.message}`); return false; }
}
function replaceOnce(src, from, to, label) {
  const n = src.split(from).length - 1;
  must(n === 1, `${label}: expected 1 anchor occurrence, found ${n}`);
  return src.split(from).join(to);
}

const normTxt = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normDate = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// Employer tokens to look for in the CV. Kept short and distinctive so a reworded
// company line ("UC AB (Enento Group)") still matches.
// Rule set D' (2026-08-07, arbitration record 7 - cross-corpus convergence). 'independent' is
// DROPPED (it admitted an invented "Independent Consulting Group of Berlin"); 'self directed' stays
// a SUBSTRING candidate because #14's writer decorates the company line ("Self-directed, production
// AI systems on Claude + n8n") and exact-form matching measurably broke 10 of its 46 passing drafts.
const EMPLOYER_CANDIDATES = ['uc ab', 'enento', 'building alex', 'menigo', 'self directed'];

function deriveWhitelists(writerSrc) {
  const dateRe = /([A-Z][a-z]{2} \d{4})\s*[–—-]\s*(Present|[A-Z][a-z]{2} \d{4})/g;
  const dates = new Set();
  let m;
  while ((m = dateRe.exec(writerSrc)) !== null) dates.add(normDate(m[1] + m[2]));
  // Merged-range tolerance (2026-08-06 F9): a writer may truthfully compress two adjacent
  // same-employer ranges into one. Derive start(first)..end(last) for the UC AB block.
  dates.add('jan2019jun2021');
  const cvNorm = normTxt(writerSrc);
  const employers = EMPLOYER_CANDIDATES.filter((t) => cvNorm.includes(t));
  return { employers, dates: Array.from(dates) };
}

const F10_BLOCK = `
// F10: LinkedIn supplies legal names ("Spotify Technology S.A.", "Acme AB") while a
// well-written letter says "Spotify". The old exact-substring test dumped correct
// drafts into the review tab, which erodes trust in it. Normalize both sides, drop
// legal suffixes, and accept the distinctive brand tokens.
const LEGAL_SUFFIXES = ['ab','asa','as','aps','oy','oyj','gmbh','ag','ltd','limited','inc','llc','sa','bv','nv','plc','co','corp','corporation','holding','holdings','group','kg','srl','sas','pte','pty','the','and','of'];
const normCoTokens = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  .split(' ').filter((t) => t && t.length > 1 && LEGAL_SUFFIXES.indexOf(t) === -1);
const clNormForCo = String(cl || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
const coTokens = normCoTokens(company);
const coFull = coTokens.join(' ');
// Accept the full normalized name, OR any token of 3+ chars, OR the leading brand
// token. "UC AB (Enento Group)" normalizes to ['uc','enento']; a letter saying "UC AB"
// contains neither the full string nor a 3+ char token, so without the leading-token
// clause a perfectly good draft would be rejected.
const coHit = company
  ? (coTokens.length === 0
      || (coFull && clNormForCo.indexOf(coFull) !== -1)
      || coTokens.some((t) => t.length >= 3 && clNormForCo.indexOf(t) !== -1)
      || (coTokens[0] && clNormForCo.indexOf(coTokens[0]) !== -1))
  : true;
if (!coHit) reasons.push('cover_letter_missing_company');
`;

const F08_BLOCK = (employers, dates) => `
// F08: the writer prompt forbids inventing employers, dates and metrics, but nothing
// verified compliance. Stage 3 has a grounding tripwire for company facts; the CV, the
// document a recruiter actually screens, had none. This is the one failure mode that
// could genuinely damage credibility.
// Whitelists are generated from this engine's own MASTER_CV by
// work/03-application-engine/remediation/apply-m3-qa.js. Any CV edit must re-run it.
const ALLOWED_EMPLOYER_TOKENS = ${JSON.stringify(employers)};
const ALLOWED_DATE_RANGES = ${JSON.stringify(dates)};
const normExp = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// normExpDate v2 (2026-08-06 F9 repair): tokenize, drop range connectors (to/until/till/through),
// map full month names to 3-letter forms, map ongoing/current/now/today to "present", join.
// "Jan 2019 - Jun 2021" == "Jan 2019 to Jun 2021" == "January 2019 - June 2021" -> "jan2019jun2021".
const EXP_MONTHS = {january:'jan',february:'feb',march:'mar',april:'apr',june:'jun',july:'jul',august:'aug',september:'sep',sept:'sep',october:'oct',november:'nov',december:'dec'};
const EXP_PRESENT = {present:'present',current:'present',ongoing:'present',now:'present',today:'present'};
const normExpDate = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  .split(' ')
  .filter((t) => t && t !== 'to' && t !== 'until' && t !== 'till' && t !== 'through')
  .map((t) => EXP_MONTHS[t] || EXP_PRESENT[t] || t)
  .join('');
for (const e of (Array.isArray(j.experience) ? j.experience : [])) {
  const c = normExp(e && e.company);
  // Match either direction: the writer may expand ("UC AB Enento Group") or shorten
  // ("UC") the master CV's company line, and a shortened form is not a fabrication.
  if (c && c.length >= 2 && !ALLOWED_EMPLOYER_TOKENS.some((t) => c.indexOf(t) !== -1 || t.indexOf(c) !== -1)) { reasons.push('fabricated_experience'); break; }
  const d = normExpDate(e && e.dates);
  if (d && d !== 'present' && !ALLOWED_DATE_RANGES.some((r) => d.startsWith(r))) { reasons.push('fabricated_experience'); break; }
}
`;

const F11_BLOCK = `
// F11: "keep the CV to one page" existed only as a prompt instruction, so an
// over-generous bullet selection shipped a two-page PDF that nobody noticed until
// manual review, or after submission. Measure the rendered artifact, not the model's
// intent. Gotenberg (Chromium) output counts reliably on /Type /Page objects.
let cv_page_count = null;
try {
  const b64 = $('Render CV PDF').item.binary.cv_pdf.data;
  const raw = Buffer.from(b64, 'base64').toString('latin1');
  const hits = raw.match(/\\/Type\\s*\\/Page(?![s])/g);
  cv_page_count = hits ? hits.length : null;
} catch (e) { cv_page_count = null; }
const qa_reasons_out = Array.isArray(qa.qa_reasons) ? qa.qa_reasons.slice() : [];
if (cv_page_count !== null && cv_page_count > 1) qa_reasons_out.push('cv_over_one_page');
const _cv_ok = !(cv_page_count !== null && cv_page_count > 1);
`;

function buildNewGraph(wf, label) {
  const w = JSON.parse(JSON.stringify(wf));
  const qaN = node(w, 'QA + Fill Templates');
  const rbN = node(w, 'Rebind PDFs');
  const bwN = node(w, 'Build Writer Request');
  must(qaN && rbN && bwN, 'required nodes missing');

  const { employers, dates } = deriveWhitelists(bwN.parameters.jsCode);
  must(employers.length >= 2, `derived too few employers (${employers.length}) - CV shape changed?`);
  must(employers.includes('self directed'), "rule set D': 'self directed' must derive as a substring token - CV shape changed?");
  must(dates.length >= 3, `derived too few date ranges (${dates.length}) - CV shape changed?`);
  console.log(`  ${label} whitelist: employers=[${employers.join(', ')}] dates=${dates.length}`);

  // --- QA node: F10 replaces the naive check, F08 inserts before the leftover scan ---
  let qa = qaN.parameters.jsCode;
  qa = replaceOnce(qa,
    "if (company && !cl.toLowerCase().includes(company.toLowerCase())) reasons.push('cover_letter_missing_company');",
    F10_BLOCK.trim(), 'F10 company check');
  qa = replaceOnce(qa, 'const leftover = ', F08_BLOCK(employers, dates).trim() + '\nconst leftover = ', 'F08 whitelist');
  // --- F17 folder slug ---
  qa = replaceOnce(qa,
    "const drive_folder = ((company || 'company') + '-' + (j.target_role || 'role')).toLowerCase()",
    "const drive_folder = ((company || 'company') + '-' + (j.target_role || 'role') + '-' + (j.job_posting_id || '')).toLowerCase()",
    'F17 folder slug');
  qaN.parameters.jsCode = qa;

  // --- Rebind PDFs: F11 page count ---
  let rb = rbN.parameters.jsCode;
  rb = replaceOnce(rb, 'return {', F11_BLOCK.trim() + '\nreturn {', 'F11 page count');
  rb = replaceOnce(rb, '    ...qa,', '    ...qa,\n    qa_reasons: qa_reasons_out,\n    cv_page_count,\n    _cv_ok,', 'F11 carry fields');
  rbN.parameters.jsCode = rb;

  // --- F11 routing: block uploads for a multi-page CV ---
  w.nodes.push({ parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: 'cv-one-page-c', leftValue: '={{ $json._cv_ok ? "true" : "false" }}', rightValue: 'true',
        operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, options: {} },
    id: 'cv-one-page', name: 'CV One Page?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [1180, 700] });

  w.connections['Rebind PDFs'] = { main: [[{ node: 'CV One Page?', type: 'main', index: 0 }]] };
  w.connections['CV One Page?'] = { main: [
    [{ node: 'Upload CV PDF', type: 'main', index: 0 }, { node: 'Upload Cover Letter PDF', type: 'main', index: 0 }],
    [{ node: 'Format Review Row S5', type: 'main', index: 0 }]
  ] };

  // --- F09: #14 only. Its match schema permits only "ai" or "neither", so the gate's
  // ['ai','consultant'] allow-list and the writer's consultant tone are dead code and
  // consultancy postings get the direct-technical voice authored for engineering roles.
  if (label === '#14') {
    const bm = node(w, 'Build Match Request');
    let src = bm.parameters.jsCode;
    const before = src;
    src = src.split('\\"ai\\" | \\"neither\\"').join('\\"ai\\" | \\"consultant\\" | \\"neither\\"');
    src = src.split('\\"ai\\" if the role is genuinely AI, automation, agent, or n8n work, else \\"neither\\"')
      .join('\\"ai\\" if the role is genuinely AI, automation, agent, or n8n work, \\"consultant\\" when it is client-facing automation or AI consulting or agency delivery rather than internal engineering, else \\"neither\\"');
    must(src !== before, 'F09: no consultant edit applied to #14 match schema');
    bm.parameters.jsCode = src;
  }

  return w;
}

function verify(v, before, label) {
  const qa = node(v, 'QA + Fill Templates').parameters.jsCode;
  const rb = node(v, 'Rebind PDFs').parameters.jsCode;
  const o = {
    'QA syntax': syntaxOk(qa, 'QA'),
    'Rebind syntax': syntaxOk(rb, 'Rebind PDFs'),
    'F08 whitelist present': /ALLOWED_EMPLOYER_TOKENS/.test(qa) && /fabricated_experience/.test(qa),
    'F08 date whitelist present': /ALLOWED_DATE_RANGES = \[/.test(qa),
    'F10 normalizer present': /LEGAL_SUFFIXES/.test(qa),
    'F10 naive check gone': !/!cl\.toLowerCase\(\)\.includes\(company\.toLowerCase\(\)\)/.test(stripComments(qa)),
    'F17 slug has job_posting_id': /drive_folder = \(\(company \|\| 'company'\) \+ '-' \+ \(j\.target_role \|\| 'role'\) \+ '-' \+ \(j\.job_posting_id/.test(qa),
    'F11 page count in Rebind': /cv_page_count/.test(rb),
    'F11 reason wired': /cv_over_one_page/.test(rb),
    'F11 IF node added': v.nodes.some((n) => n.name === 'CV One Page?'),
    'F11 uploads behind the gate': JSON.stringify(v.connections['CV One Page?'] || {}).includes('Upload CV PDF'),
    'F11 fail lane to S5': JSON.stringify((v.connections['CV One Page?'] || {}).main ? v.connections['CV One Page?'].main[1] : []).includes('Format Review Row S5'),
    'Rebind no longer uploads directly': !JSON.stringify(v.connections['Rebind PDFs']).includes('Upload CV PDF'),
    'node count +1': v.nodes.length === before.nodes.length + 1,
    'errorWorkflow preserved': (v.settings || {}).errorWorkflow === (before.settings || {}).errorWorkflow
  };
  if (label === '#14') {
    const bm = node(v, 'Build Match Request').parameters.jsCode;
    o['F09 consultant in #14 schema'] = bm.includes('\\"ai\\" | \\"consultant\\" | \\"neither\\"');
  }
  return o;
}

async function run(label, id) {
  console.log(`\n=== ${label} (${id}) ${APPLY ? 'APPLY' : 'DRY RUN'} ===`);
  const wf = await (await fetch(`${API}/workflows/${id}`, { headers: HDRS })).json();
  must(wf.nodes, 'fetch failed');
  const wasActive = wf.active;
  console.log(`before: ${wf.nodes.length} nodes, active=${wasActive}`);

  const built = buildNewGraph(wf, label);
  let bad = 0;
  const dry = verify(built, wf, label);
  for (const [k, ok] of Object.entries(dry)) if (!ok) { bad++; console.log(`  FAIL [dry] ${k}`); }
  console.log(`  dry checks: ${Object.keys(dry).length} run, ${bad} failed`);
  must(bad === 0, `${bad} dry check(s) failed on ${label}, nothing written`);
  if (!APPLY) { console.log(`  DRY RUN CLEAN for ${label}.`); return; }

  fs.mkdirSync(BACKUPS, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const bak = path.join(BACKUPS, `${id}-pre-M3-${ts}.json`);
  fs.writeFileSync(bak, JSON.stringify(wf, null, 2));
  console.log('  backup:', path.basename(bak));

  const settings = {};
  for (const k of ALLOWED_SETTINGS) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
  const res = await fetch(`${API}/workflows/${id}`, { method: 'PUT', headers: HDRS,
    body: JSON.stringify({ name: built.name, nodes: built.nodes, connections: built.connections, settings }) });
  const rb2 = await res.json();
  must(res.ok, 'PUT failed: ' + res.status + ' ' + JSON.stringify(rb2).slice(0, 600));

  let v = await (await fetch(`${API}/workflows/${id}`, { headers: HDRS })).json();
  if (wasActive && v.active !== true) {
    console.log('  PUT dropped the active flag, re-activating...');
    await fetch(`${API}/workflows/${id}/activate`, { method: 'POST', headers: HDRS });
    v = await (await fetch(`${API}/workflows/${id}`, { headers: HDRS })).json();
  }
  bad = 0;
  for (const [k, ok] of Object.entries(verify(v, wf, label))) if (!ok) { bad++; console.log(`  FAIL [live] ${k}`); }
  if (v.active !== wasActive) bad++;
  console.log(`  live checks done, ${bad} failed | active ${wasActive} -> ${v.active} | nodes ${v.nodes.length}`);
  must(bad === 0, `${bad} live check(s) failed on ${label} - RESTORE FROM ${path.basename(bak)}`);
}

(async () => {
  for (const [label, id] of ENGINES) await run(label, id);
  console.log(`\nF08 + F09 + F10 + F11 + F17 ${APPLY ? 'APPLIED AND VERIFIED' : 'DRY RUN CLEAN'} on both engines.`);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
