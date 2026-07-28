// URGENT FIX 2026-07-27: remove the F07 assistant prefill from both live engines.
//
// The plan's F07 step 1 said to append { role: 'assistant', content: '{' } as the final
// message, noting it was compatible because these calls do not use extended thinking.
// That is wrong for this model. The live API rejects it outright:
//
//   400 - "This model does not support assistant message prefill.
//          The conversation must end with a user message."
//
// Caught by the F06 calibration harness, which was the first thing all session to
// actually CALL the API with the new request body. Structural verification passed
// because the request was well-formed JSON; only a live call could reveal this. Left
// in place, every match and writer call on both engines would have thrown a 400 on the
// Tuesday 15:00 run.
//
// The parse-side half of F07 STAYS and still solves the original problem: the
// three-stage extractor (fence strip, prefill-form, widest brace substring) recovers a
// reply that carries a preamble line, so a good job is no longer dumped into
// needs_review with its tokens wasted. The prefill was belt-and-braces on top; the
// braces do the work.
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

const WITH = "  messages: [ { role: 'user', content: userContent }, { role: 'assistant', content: '{' } ]";
const WITHOUT = "  messages: [ { role: 'user', content: userContent } ]";

function must(c, m) { if (!c) { console.error('ASSERT FAILED:', m); process.exit(1); } }
const node = (w, n) => w.nodes.find((x) => x.name === n);

(async () => {
  for (const [label, id] of ENGINES) {
    console.log(`\n=== ${label} ${APPLY ? 'APPLY' : 'DRY RUN'} ===`);
    const wf = await (await fetch(`${API}/workflows/${id}`, { headers: HDRS })).json();
    must(wf.nodes, 'fetch failed');
    const wasActive = wf.active;
    const built = JSON.parse(JSON.stringify(wf));

    for (const nm of ['Build Match Request', 'Build Writer Request']) {
      const n = node(built, nm);
      must(n, nm + ' missing');
      const c = n.parameters.jsCode.split(WITH).length - 1;
      must(c === 1, `${nm}: expected 1 prefill occurrence, found ${c}`);
      n.parameters.jsCode = n.parameters.jsCode.split(WITH).join(WITHOUT);
    }

    const check = (v) => {
      const o = {};
      for (const nm of ['Build Match Request', 'Build Writer Request']) {
        const s = node(v, nm).parameters.jsCode;
        o[`${nm}: prefill removed`] = !/role: 'assistant'/.test(s);
        o[`${nm}: ends with user message`] = s.includes(WITHOUT);
        o[`${nm}: caching intact`] = /cache_control: \{ type: 'ephemeral' \}/.test(s);
        o[`${nm}: syntax`] = (() => { try { new Function(s); return true; } catch (e) { return false; } })();
      }
      return o;
    };

    let bad = 0;
    for (const [k, ok] of Object.entries(check(built))) if (!ok) { bad++; console.log(`  FAIL [dry] ${k}`); }
    console.log(`  dry checks ok: ${bad === 0}`);
    must(bad === 0, 'dry failed');
    if (!APPLY) { console.log('  DRY RUN CLEAN'); continue; }

    fs.mkdirSync(BACKUPS, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
    const bak = path.join(BACKUPS, `${id}-pre-F07revert-${ts}.json`);
    fs.writeFileSync(bak, JSON.stringify(wf, null, 2));

    const settings = {};
    for (const k of ALLOWED_SETTINGS) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
    const res = await fetch(`${API}/workflows/${id}`, { method: 'PUT', headers: HDRS,
      body: JSON.stringify({ name: built.name, nodes: built.nodes, connections: built.connections, settings }) });
    must(res.ok, 'PUT failed ' + res.status);

    let v = await (await fetch(`${API}/workflows/${id}`, { headers: HDRS })).json();
    if (wasActive && v.active !== true) {
      await fetch(`${API}/workflows/${id}/activate`, { method: 'POST', headers: HDRS });
      v = await (await fetch(`${API}/workflows/${id}`, { headers: HDRS })).json();
    }
    bad = 0;
    for (const [k, ok] of Object.entries(check(v))) if (!ok) { bad++; console.log(`  FAIL [live] ${k}`); }
    if (v.active !== wasActive) bad++;
    console.log(`  live checks: ${bad} failed | active ${wasActive} -> ${v.active} | backup ${path.basename(bak)}`);
    must(bad === 0, 'live failed - RESTORE FROM ' + path.basename(bak));
  }
  console.log(`\nF07 prefill ${APPLY ? 'REMOVED AND VERIFIED' : 'DRY RUN CLEAN'} on both engines. Parse-side extractor retained.`);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
