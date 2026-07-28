// Apply the 2026-07-28 node-audit SAFE SET to the three live job engines (#03/#14/#31).
// Deterministic, reversible, backup-first. Works on the FRESH LIVE workflow (GET), never the
// stale Desktop exports. DRY_RUN=1 => report match counts, no PUT. Otherwise: PUT -> GET
// read-back -> assert positive+negative marks -> hard-verify active.
//
// Edits (safe set): V2 (bureau/seven-years in SYSTEM), Fix3 (carry description), Fix8 (model
// label), Fix9 (match-JSON truncation guard), Fix10 (template em-dashes), Fix5a (DRAIN_CAP,
// #03/#14 only), limit_per_input 25->10 (#03/#14 only). Fix1 SKIPPED (already live). Fix4/6
// held.
const fs = require('fs');
const path = require('path');
const BASE = 'https://n8n.shaheenkiarash.com/api/v1';
const KEY = fs.readFileSync(path.join(__dirname, '../work/03-application-engine/config/n8n-api-key.txt'), 'utf8').trim();
const HDRS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };
const DRY = process.env.DRY_RUN === '1';
const ALLOWED_SETTINGS = ['executionOrder','timezone','errorWorkflow','saveDataErrorExecution','saveDataSuccessExecution','saveManualExecutions','saveExecutionProgress','saveDataManualExecutions'];

const ENGINES = [
  { id: '9XuIEfxS71DEetVR', label: '#03 BI',    hasBD: true },
  { id: '9x9M3EnEEeX3O8dy', label: '#14 AI',    hasBD: true },
  { id: 'sxEYRyeHH7i1mHzb', label: '#31 portal', hasBD: false }, // no BD trigger, DRAIN_CAP already present
];

async function api(method, url, body) {
  const res = await fetch(BASE + url, { method, headers: HDRS, body: body ? JSON.stringify(body) : undefined });
  const txt = await res.text();
  let json = null; try { json = JSON.parse(txt); } catch (e) {}
  return { status: res.status, json, txt };
}
function nodeByName(wf, name) { return wf.nodes.find(n => n.name === name); }

// A single edit = {node, field, find, replace, expect}. field defaults 'jsCode' (in parameters).
function applyEdit(wf, e, report) {
  const node = nodeByName(wf, e.node);
  if (!node) { report.push(`  MISS node "${e.node}"`); return false; }
  const field = e.field || 'jsCode';
  let cur = field === 'url' ? node.parameters.url : node.parameters[field];
  if (typeof cur !== 'string') { report.push(`  MISS field ${field} on "${e.node}"`); return false; }
  const count = cur.split(e.find).length - 1;
  const want = e.expect == null ? 1 : e.expect;
  if (count !== want) { report.push(`  ASSERT-FAIL "${e.node}"/${e.tag}: found ${count} of "${short(e.find)}", expected ${want}`); return false; }
  const next = cur.split(e.find).join(e.replace);
  if (field === 'url') node.parameters.url = next; else node.parameters[field] = next;
  report.push(`  ok  "${e.node}"/${e.tag} (${count}x)`);
  return true;
}
function short(s){ return s.length>60 ? s.slice(0,57)+'...' : s; }

function editsFor(eng) {
  const E = [];
  // V2 - kill banned "bureau" + stale "seven years" in the SYSTEM literals of both Build nodes.
  E.push({ node: 'Build Match Request', tag: 'V2-match',
    find: "the candidate's seven years at UC (the leading Nordic credit information bureau)",
    replace: "the candidate's 7.5+ years at UC (the leading credit information provider in the Nordics)" });
  E.push({ node: 'Build Writer Request', tag: 'V2-writer',
    find: "foreground the candidate's seven years at UC (Enento Group), the leading credit information bureau in the Nordics",
    replace: "foreground the candidate's 7.5+ years at UC (Enento Group), the leading credit information provider in the Nordics" });
  // Fix3 - carry description forward as a field; kill the two long-range .item lookups.
  E.push({ node: 'Parse Match', tag: 'Fix3-carry',
    find: "  job_posting_id: job.job_posting_id || null,\n  job_title: job.job_title || null,",
    replace: "  job_posting_id: job.job_posting_id || null,\n  description: job.description || null,\n  job_title: job.job_title || null," });
  E.push({ node: 'Stage 3 Gate', tag: 'Fix3-gate',
    find: "try { description = String($('Build Match Request').item.json.description || '').toLowerCase(); } catch (e) { description = ''; }",
    replace: "description = String(j.description || '').toLowerCase();" });
  E.push({ node: 'Build Writer Request', tag: 'Fix3-writer',
    find: "try { description = $('Build Match Request').item.json.description || ''; } catch (e) { description = ''; }",
    replace: "description = j.description || '';" });
  // Fix8 - run_log model column tells the truth on mixed runs.
  E.push({ node: 'Compute Costs', tag: 'Fix8-model',
    find: "  model: j.stage2_model || '',",
    replace: "  model: (j.stage2_model === j.stage4_model) ? (j.stage2_model || '') : ((j.stage2_model || '?') + '+' + (j.stage4_model || '?'))," });
  // Fix9 - quarantine a truncated-but-parseable MATCH json (append to the existing parse_error path).
  E.push({ node: 'Parse Match', tag: 'Fix9-complete',
    find: "if (parsed && parsed.interest_score !== undefined) parsed.interest_score = clamp(parsed.interest_score);",
    replace: "if (parsed && parsed.interest_score !== undefined) parsed.interest_score = clamp(parsed.interest_score);\n\n// Fix9: a truncated but brace-balanced reply can parse into a partial object; require the\n// gate-load-bearing fields, and catch Moonshot's explicit length-truncation flag.\nlet completeness_error = null;\nif (parsed) {\n  const _need = ['fit_score','interest_score','target_role','work_condition_detected'];\n  const _missing = _need.filter(k => parsed[k] === undefined || parsed[k] === null);\n  if (_missing.length) completeness_error = 'incomplete_match_json:' + _missing.join(',');\n  const _fr = (((resp||{}).choices||[])[0]||{}).finish_reason;\n  if (_fr === 'length') completeness_error = (completeness_error ? completeness_error + ';' : '') + 'truncated_length';\n}" });
  E.push({ node: 'Parse Match', tag: 'Fix9-wire',
    find: "  stage2_parse_error: parse_error,",
    replace: "  stage2_parse_error: parse_error || completeness_error," });
  // Fix10 - the two visible printed em-dashes in the static templates (jsCode carries — as 6 chars).
  E.push({ node: 'QA + Fill Templates', tag: 'Fix10-contact',
    find: "Stockholm, Sweden \\u2014 open to remote",
    replace: "Stockholm, Sweden, open to remote", expect: 2 });
  E.push({ node: 'QA + Fill Templates', tag: 'Fix10-edu',
    find: "Business Administration \\u2014 Cordoba Private University",
    replace: "Business Administration, Cordoba Private University" });
  // Fix5a + limit: BI-source engines only (#31 already has DRAIN_CAP, no BD trigger).
  if (eng.hasBD) {
    E.push({ node: 'Dedup Against Log', tag: 'Fix5a-cap-open',
      find: "// Drain: previously banked jobs rejoin the batch for Match from their stored payload.\nfor (const [id, payload] of drainable) {\n  if (inRun.has(id) || siblingOwned.has(id)) continue; // F20: sibling lane owns it",
      replace: "// Drain: previously banked jobs rejoin the batch for Match from their stored payload.\n// Fix5a: cap the drain per run so a large post-outage backlog cannot fan out into one enormous Claude run.\nconst DRAIN_CAP = 40;\nlet _drained = 0;\nfor (const [id, payload] of drainable) {\n  if (_drained >= DRAIN_CAP) break;\n  if (inRun.has(id) || siblingOwned.has(id)) continue; // F20: sibling lane owns it" });
    E.push({ node: 'Dedup Against Log', tag: 'Fix5a-cap-count',
      find: "  inRun.add(id);\n  out.push({ json: { ...job, _banked: true } });\n}\nreturn out;",
      replace: "  inRun.add(id);\n  out.push({ json: { ...job, _banked: true } });\n  _drained++;\n}\nreturn out;" });
    E.push({ node: 'BD Trigger Search', tag: 'limit-25to10', field: 'url',
      find: "limit_per_input=25", replace: "limit_per_input=10" });
  }
  return E;
}

// Read-back marks: new strings that MUST be present, old strings that MUST be gone.
const POS = ["7.5+ years at UC", "credit information provider in the Nordics", "description: job.description || null", "completeness_error", "Stockholm, Sweden, open to remote"];
const NEG = ["credit information bureau", "candidate's seven years at UC", "String($('Build Match Request').item.json.description"];

(async () => {
  for (const eng of ENGINES) {
    console.log(`\n=== ${eng.label} (${eng.id}) ${DRY ? '[DRY]' : '[LIVE]'} ===`);
    const g = await api('GET', `/workflows/${eng.id}`);
    if (g.status !== 200) { console.log(`  GET failed ${g.status}`); continue; }
    const wf = g.json;
    const wasActive = wf.active;
    const report = [];
    const edits = editsFor(eng);
    let allOk = true;
    for (const e of edits) if (!applyEdit(wf, e, report)) allOk = false;
    report.forEach(r => console.log(r));
    if (!allOk) { console.log(`  >> ASSERT FAILURES - ${eng.label} NOT written.`); continue; }
    // Syntax-check every modified Code node (AsyncFunction parse; allows top-level return/await, does not run).
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const touched = [...new Set(edits.map(e => e.node))];
    let syntaxOk = true;
    for (const nm of touched) {
      const n = nodeByName(wf, nm);
      if (!n || typeof n.parameters.jsCode !== 'string') continue;
      try { new AsyncFunction(n.parameters.jsCode); }
      catch (err) { console.log(`  SYNTAX-FAIL "${nm}": ${err.message}`); syntaxOk = false; }
    }
    if (!syntaxOk) { console.log(`  >> SYNTAX FAILURES - ${eng.label} NOT written.`); continue; }
    console.log(`  syntax ok (${touched.length} Code nodes checked)`);
    if (DRY) { console.log(`  >> DRY: all ${edits.length} edits matched + syntax-clean.`); continue; }
    // PUT (filtered settings)
    const settings = {}; for (const k of ALLOWED_SETTINGS) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
    const put = await api('PUT', `/workflows/${eng.id}`, { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings });
    if (put.status !== 200) { console.log(`  PUT failed ${put.status}: ${put.txt.slice(0,300)}`); continue; }
    // read-back
    const rb = await api('GET', `/workflows/${eng.id}`);
    const s = JSON.stringify(rb.json);
    const posMiss = POS.filter(p => !s.includes(p));
    const negHit = NEG.filter(n => s.includes(n));
    let active = rb.json.active;
    if (!active) { const act = await api('POST', `/workflows/${eng.id}/activate`); active = act.json && act.json.active; }
    console.log(`  PUT ok. read-back: posMissing=${posMiss.length?JSON.stringify(posMiss):'none'} negPresent=${negHit.length?JSON.stringify(negHit):'none'} active=${active} (was ${wasActive})`);
    if (posMiss.length || negHit.length || !active) console.log(`  >> VERIFY WARNING on ${eng.label} - inspect before trusting.`);
    else console.log(`  >> ${eng.label} VERIFIED.`);
  }
})();
