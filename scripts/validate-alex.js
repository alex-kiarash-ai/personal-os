#!/usr/bin/env node
// validate-alex.js - the validation layer (Layer 6). PHASE 3 DELIVERABLE (P3-S1).
//
// Runs as the final step of every generate-alex.js run, standalone on the CLI, and from the git
// pre-commit hook (P3-S3). Six checks (V1-V6, spec table + amendments A3/A5) plus the structural
// guards G1-G4 from Phase 1, plus V9 first-fire aging (upgrade P4, 2026-07-12; WARNING-only),
// plus V7 lifecycle-state drift lint and V8 HQ hex scan (upgrade P5, 2026-07-12, design 1.5/1.6),
// plus V10 protected-file guard (2026-07-15, context-engineering run; COMMIT-TIME ONLY, enforces
// vault/me/NEVER-TOUCH.md against the staged changeset - runs in pre-commit context with --changed).
// Any failure exits 1 and names exactly what drifted and where.
//
// The full suite (G1-G4 + V1-V9) runs on EVERY invocation - generate-alex.js --only=X limits what
// is staged/applied, never what is checked (c7 fix, upgrade P5).
//
// Contract with generate-alex.js (orchestration step 3):
//   const { runAll } = require('./validate-alex');
//   const result = await runAll({ stagedDir });          // ASYNC since Phase 3 (V6 does live HTTP)
//   result = { ok: boolean, failures: ['FAILED Vx: ...'], warnings: ['WARNING ...'] }
// A file present in stagedDir is validated as the ABOUT-TO-SHIP version; for files not staged the
// current repo copy is checked. Any failure -> the caller deletes staging and touches nothing real.
//
// Parse contracts are REUSED from scripts/lib/read-sources.js and scripts/lib/gen-docs.js /
// gen-scheduler.js, so the generator and the validator can never disagree about how a source or a
// surface is read (Phase 1 handoff requirement).
//
// Contexts (P3-S3 pre-commit design):
//   context: 'generator'  (default) - reality checks are STRICT: missing env creds, an unreachable
//            n8n API, or a failing schtasks query are hard FAILs (ground rule 7: fail loudly).
//   context: 'pre-commit' - same checks, but V6 (n8n) and the live half of V2 (schtasks) degrade to
//            a LOUD WARNING SKIP when creds/network/schtasks are unavailable, so an offline machine
//            or the nightly headless git-backup commit is never blocked by a remote outage.
//            A REAL mismatch (rule model != live model, doc drift, job drift) still blocks in both
//            contexts. The hook wrapper (scripts/hooks/pre-commit) loads the n8n key from the local
//            key file into env when absent, so V6 normally runs for real at commit time too.
//
// Standalone CLI:  node scripts/validate-alex.js [--staged=DIR] [--context=generator|pre-commit]
// Exit 0 = pass (warnings allowed), 1 = fail.
'use strict';
const fs = require('fs');
const path = require('path');

const { parseScheduleJobs, parseMcpList, parseColorTokens, computeCounts } = require('./lib/read-sources');
const { scheduledJobsRows } = require('./lib/gen-docs');
const { liveJobs } = require('./lib/gen-scheduler');
const { TARGETS, NODE } = require('./lib/sync-n8n-voice');
const genTokens = require('./lib/gen-tokens');

const REPO = path.join(__dirname, '..');
const PLACEHOLDER_RE = /\{\{[A-Z0-9_]+\}\}/g; // must match render-templates.js
const RT_BEGIN = '<!-- ROUTING-TABLE:BEGIN';
const RT_END = '<!-- ROUTING-TABLE:END -->';
const CZ_START = '<!-- CUSTOM_START -->';
const CZ_END = '<!-- CUSTOM_END -->';
const PT_BEGIN = '<!-- PROJECT-TABLE:BEGIN';
const PT_END = '<!-- PROJECT-TABLE:END -->';

const pad = n => String(n).padStart(2, '0');

function listFiles(dir) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  })(dir);
  return out;
}

// Prefer the staged copy (the version about to ship); fall back to the live repo copy.
function effective(stagedDir, rel) {
  const staged = stagedDir && path.join(stagedDir, rel);
  if (staged && fs.existsSync(staged)) return { text: fs.readFileSync(staged, 'utf8'), from: 'staged' };
  const real = path.join(REPO, rel);
  if (fs.existsSync(real)) return { text: fs.readFileSync(real, 'utf8'), from: 'repo' };
  return null;
}

function countOf(text, marker) { return text.split(marker).length - 1; }

// Slice a "## ..." section (heading line matching headingRe) up to the next "## " heading or EOF.
function mdSection(text, headingRe) {
  const m = text.match(headingRe);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = text.slice(start);
  const next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
}

async function fetchJson(url, headers, ms = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { headers, signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// ---------------------------------------------------------------------------------------------
// G1-G4 - structural guards (Phase 1, unchanged behavior)
// ---------------------------------------------------------------------------------------------
function structuralGuards({ stagedDir }, failures) {
  // G1 - no unresolved {{PLACEHOLDER}} in any staged output.
  if (stagedDir && fs.existsSync(stagedDir)) {
    for (const f of listFiles(stagedDir)) {
      const left = fs.readFileSync(f, 'utf8').match(PLACEHOLDER_RE);
      if (left) failures.push(`FAILED G1: unresolved placeholder(s) ${[...new Set(left)].join(', ')} in staged ${path.relative(stagedDir, f)}`);
    }
  }

  // G2 - routing-region markers in CLAUDE.md present and well-formed (exactly one, ordered).
  const claude = effective(stagedDir, 'CLAUDE.md');
  if (!claude) failures.push('FAILED G2: CLAUDE.md not found (staged or repo)');
  else {
    const b = countOf(claude.text, RT_BEGIN), e = countOf(claude.text, RT_END);
    if (b !== 1 || e !== 1) failures.push(`FAILED G2: CLAUDE.md (${claude.from}) must contain exactly one ROUTING-TABLE BEGIN/END pair - found BEGIN=${b}, END=${e}`);
    else if (claude.text.indexOf(RT_END) < claude.text.indexOf(RT_BEGIN)) failures.push(`FAILED G2: CLAUDE.md (${claude.from}) routing markers out of order (END before BEGIN)`);
  }

  // G3 - custom-zone markers in docs/README.md present exactly once, ordered.
  const readme = effective(stagedDir, 'docs/README.md');
  if (!readme) failures.push('FAILED G3: docs/README.md not found (staged or repo) - the hand-written welcome block is required (D8)');
  else {
    const s = countOf(readme.text, CZ_START), e = countOf(readme.text, CZ_END);
    if (s !== 1 || e !== 1) failures.push(`FAILED G3: docs/README.md (${readme.from}) must contain exactly one custom zone - found START=${s}, END=${e}`);
    else if (readme.text.indexOf(CZ_END) < readme.text.indexOf(CZ_START)) failures.push(`FAILED G3: docs/README.md (${readme.from}) custom-zone markers out of order`);
  }

  // G4 - project-table markers in docs/projects/README.md present exactly once, ordered.
  const proj = effective(stagedDir, 'docs/projects/README.md');
  if (!proj) failures.push('FAILED G4: docs/projects/README.md not found (staged or repo)');
  else {
    const b = countOf(proj.text, PT_BEGIN), e = countOf(proj.text, PT_END);
    if (b !== 1 || e !== 1) failures.push(`FAILED G4: docs/projects/README.md (${proj.from}) must contain exactly one PROJECT-TABLE BEGIN/END pair - found BEGIN=${b}, END=${e}`);
    else if (proj.text.indexOf(PT_END) < proj.text.indexOf(PT_BEGIN)) failures.push(`FAILED G4: docs/projects/README.md (${proj.from}) project-table markers out of order`);
  }
}

// ---------------------------------------------------------------------------------------------
// V1 - automation count: generated GETTING-STARTED.md (and docs/README.md quick start) vs the
//      count of non-retired NUMBERED entries in system/manifest.json (computeCounts contract).
// ---------------------------------------------------------------------------------------------
function v1AutomationCount({ stagedDir, manifest }, failures) {
  const counts = computeCounts(manifest);
  const gs = effective(stagedDir, 'docs/GETTING-STARTED.md');
  if (!gs) { failures.push('FAILED V1: docs/GETTING-STARTED.md not found (staged or repo)'); return; }

  const h = gs.text.match(/^## \d+\. The automations \((\d+) registered, non-retired\)\s*$/m);
  if (!h) {
    failures.push('FAILED V1: docs/GETTING-STARTED.md has no "## N. The automations (<count> registered, non-retired)" heading - the count contract is broken');
  } else if (parseInt(h[1], 10) !== counts.automationCount) {
    const names = manifest.projects.filter(p => p.state !== 'RETIRED').map(p => p.work_dir);
    failures.push(`FAILED V1: automation count mismatch - docs/GETTING-STARTED.md (${gs.from}) says ${h[1]}, system/manifest.json says ${counts.automationCount}; manifest non-retired: ${names.join(', ')}`);
  }

  // The list itself: one "- **NN Title**" row per non-retired numbered project.
  const sec = mdSection(gs.text, /^## \d+\. The automations[^\n]*$/m);
  if (sec) {
    const rows = sec.match(/^- \*\*\d{2} /gm) || [];
    if (rows.length !== counts.automationCount)
      failures.push(`FAILED V1: docs/GETTING-STARTED.md (${gs.from}) automation list has ${rows.length} numbered rows but system/manifest.json has ${counts.automationCount} non-retired numbered projects`);
  }

  // docs/README.md quick-start counts (same generation run, same source).
  const rd = effective(stagedDir, 'docs/README.md');
  if (rd) {
    const m = rd.text.match(/\*\*(\d+) non-retired automations\*\* \((\d+) LIVE\)/);
    if (!m) failures.push('FAILED V1: docs/README.md quick start has no "**<n> non-retired automations** (<n> LIVE)" line - the count contract is broken');
    else {
      if (parseInt(m[1], 10) !== counts.automationCount)
        failures.push(`FAILED V1: automation count mismatch - docs/README.md (${rd.from}) says ${m[1]}, system/manifest.json says ${counts.automationCount}`);
      if (parseInt(m[2], 10) !== counts.liveCount)
        failures.push(`FAILED V1: LIVE count mismatch - docs/README.md (${rd.from}) says ${m[2]}, system/manifest.json says ${counts.liveCount}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// V2 - scheduled jobs, reality-aware (A3):
//      (a) doc side: the jobs table in generated GETTING-STARTED.md must equal the rows the
//          generator derives from scheduler/schedule.md (scheduledJobsRows contract);
//      (b) reality side: every documented PersonalOS-* job (parseScheduleJobs contract, retry-*
//          excluded by convention) must exist in live Windows Task Scheduler, and every live
//          PersonalOS-* job must be documented. Transient tasks (schedule.md "## Transient tasks"
//          section, e.g. the self-removing QRA poller) are exempt from must-exist-live but count
//          as documented if armed (2026-07-13). schtasks unavailable: FAIL in generator context,
//          LOUD SKIP in pre-commit context (a clone on another machine can still commit).
// ---------------------------------------------------------------------------------------------
function v2ScheduledJobs({ stagedDir, schedule, context }, failures, warnings) {
  // (a) docs vs source
  const gs = effective(stagedDir, 'docs/GETTING-STARTED.md');
  if (!gs) failures.push('FAILED V2: docs/GETTING-STARTED.md not found (staged or repo)');
  else {
    const expected = scheduledJobsRows(schedule).split('\n');
    const secStart = gs.text.indexOf('### The scheduled jobs');
    if (secStart < 0) failures.push(`FAILED V2: docs/GETTING-STARTED.md (${gs.from}) has no "### The scheduled jobs" table`);
    else {
      const sec = gs.text.slice(secStart).split(/^## /m)[0];
      const actual = sec.split(/\r?\n/).filter(l => l.startsWith('| ') && !l.startsWith('| Job |') && !/^\|-+/.test(l.replace(/\s/g, '')) && !l.startsWith('|---'));
      const firstCol = r => r.split(' | ')[0].replace(/^\| /, '').trim();
      const expNames = expected.map(firstCol), actNames = actual.map(firstCol);
      const missing = expNames.filter(n => !actNames.includes(n));
      const extra = actNames.filter(n => !expNames.includes(n));
      if (missing.length || extra.length)
        failures.push(`FAILED V2: scheduled-jobs table drift - scheduler/schedule.md entries missing from docs/GETTING-STARTED.md (${gs.from}): [${missing.join('; ') || 'none'}]; rows in the doc with no schedule.md entry: [${extra.join('; ') || 'none'}]`);
      else {
        for (let i = 0; i < expected.length; i++) {
          if (actual[i] !== expected[i]) {
            failures.push(`FAILED V2: scheduled-jobs table row for '${expNames[i]}' in docs/GETTING-STARTED.md (${gs.from}) does not match scheduler/schedule.md (command/frequency drift)`);
            break; // one named row is enough to act on; regenerate fixes all
          }
        }
      }
    }
  }

  // (b) live Task Scheduler
  let live;
  try {
    live = liveJobs();
  } catch (e) {
    const msg = `V2 (live half): schtasks query unavailable - ${e.message}`;
    if (context === 'pre-commit') { warnings.push(`WARNING V2 SKIPPED (live half, pre-commit): ${msg}`); return; }
    failures.push(`FAILED V2: ${msg}`);
    return;
  }
  const liveSet = new Set(live), docSet = new Set(schedule.allJobNames);
  const transientSet = new Set(schedule.transientJobNames || []); // documented one-shots, live only while armed
  const notRegistered = schedule.allJobNames.filter(j => !liveSet.has(j));
  const unknown = live.filter(j => !docSet.has(j) && !transientSet.has(j));
  if (notRegistered.length)
    failures.push(`FAILED V2: job(s) documented in scheduler/schedule.md but MISSING from live Windows Task Scheduler: ${notRegistered.join(', ')}`);
  if (unknown.length)
    failures.push(`FAILED V2: live Task Scheduler job(s) not documented in scheduler/schedule.md: ${unknown.join(', ')}`);
}

// ---------------------------------------------------------------------------------------------
// V3 - no retired-as-live: every RETIRED manifest entry must be absent from the GETTING-STARTED
//      automation list entirely, and carry the RETIRED state wherever a row for it exists
//      (CLAUDE.md routing region, docs/projects/README.md table).
// ---------------------------------------------------------------------------------------------
function v3NoRetiredAsLive({ stagedDir, manifest }, failures) {
  const retiredNumbered = manifest.projects.filter(p => p.state === 'RETIRED');
  const retiredUnnumbered = (manifest.meta.unnumbered || []).filter(u => u.state === 'RETIRED');
  if (retiredNumbered.length + retiredUnnumbered.length === 0) return;

  const gs = effective(stagedDir, 'docs/GETTING-STARTED.md');
  if (gs) {
    for (const p of retiredNumbered)
      if (gs.text.includes(`- **${pad(p.num)} `))
        failures.push(`FAILED V3: retired project ${pad(p.num)} ${p.title} (system/manifest.json state=RETIRED) appears in the docs/GETTING-STARTED.md (${gs.from}) automation list`);
    for (const u of retiredUnnumbered)
      if (gs.text.includes(`- **${u.title}**`))
        failures.push(`FAILED V3: retired system '${u.title}' (system/manifest.json state=RETIRED) appears in the docs/GETTING-STARTED.md (${gs.from}) automation list`);
  }

  const claude = effective(stagedDir, 'CLAUDE.md');
  if (claude && claude.text.includes(RT_BEGIN) && claude.text.includes(RT_END)) {
    const region = claude.text.slice(claude.text.indexOf(RT_BEGIN), claude.text.indexOf(RT_END));
    for (const p of retiredNumbered) {
      const row = region.split(/\r?\n/).find(l => l.startsWith(`| ${pad(p.num)} |`));
      if (row && !row.includes('RETIRED'))
        failures.push(`FAILED V3: retired project ${pad(p.num)} ${p.title} listed WITHOUT the RETIRED state in the CLAUDE.md (${claude.from}) routing region`);
    }
  }

  const proj = effective(stagedDir, 'docs/projects/README.md');
  if (proj) {
    for (const p of retiredNumbered) {
      const row = proj.text.split(/\r?\n/).find(l => l.startsWith(`| ${pad(p.num)} |`));
      if (row) {
        const state = row.split('|')[3];
        if (!state || state.trim() !== 'RETIRED')
          failures.push(`FAILED V3: retired project ${pad(p.num)} ${p.title} listed with state '${(state || '').trim()}' instead of RETIRED in docs/projects/README.md (${proj.from})`);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// V4 - MCP consistency: the MCP surfaces named in generated docs (ARCHITECTURE.md embedded
//      MCP Reference, GETTING-STARTED.md section 5 list) vs the MCP Reference section of
//      CLAUDE.md, all read with the SAME parseMcpList contract. Any set difference fails.
// ---------------------------------------------------------------------------------------------
function v4McpConsistency({ stagedDir }, failures) {
  const claude = effective(stagedDir, 'CLAUDE.md');
  if (!claude) { failures.push('FAILED V4: CLAUDE.md not found (staged or repo)'); return; }
  let canonical;
  try { canonical = parseMcpList(claude.text); }
  catch (e) { failures.push(`FAILED V4: cannot parse the MCP Reference of CLAUDE.md (${claude.from}): ${e.message}`); return; }
  const canonSet = new Set(canonical);

  const diff = (list, whereName) => {
    const set = new Set(list);
    const missing = canonical.filter(n => !set.has(n));
    const extra = list.filter(n => !canonSet.has(n));
    if (missing.length || extra.length)
      failures.push(`FAILED V4: MCP set difference between CLAUDE.md and ${whereName} - in CLAUDE.md but not there: [${missing.join(', ') || 'none'}]; there but not in CLAUDE.md: [${extra.join(', ') || 'none'}]`);
  };

  const arch = effective(stagedDir, 'docs/ARCHITECTURE.md');
  if (!arch) failures.push('FAILED V4: docs/ARCHITECTURE.md not found (staged or repo)');
  else {
    try { diff(parseMcpList(arch.text), `docs/ARCHITECTURE.md (${arch.from})`); }
    catch (e) { failures.push(`FAILED V4: cannot parse the embedded MCP Reference of docs/ARCHITECTURE.md (${arch.from}): ${e.message}`); }
  }

  const gs = effective(stagedDir, 'docs/GETTING-STARTED.md');
  if (!gs) failures.push('FAILED V4: docs/GETTING-STARTED.md not found (staged or repo)');
  else {
    const sec = mdSection(gs.text, /^## \d+\. The tools Alex reaches \(MCP\)\s*$/m);
    if (!sec) failures.push(`FAILED V4: docs/GETTING-STARTED.md (${gs.from}) has no "The tools Alex reaches (MCP)" section`);
    else diff((sec.match(/^- (.+)$/gm) || []).map(l => l.replace(/^- /, '').trim()), `docs/GETTING-STARTED.md section 5 (${gs.from})`);
  }
}

// ---------------------------------------------------------------------------------------------
// V5 - tokens, not stray hexes (softened per A5): any hex value found OUTSIDE the law file
//      (brand/config/color-system.md) must match a hex the law file defines (parseColorTokens
//      allHexes contract: palette + extended palette + the law file's own semantic values).
//
// SCOPE (deliberate, documented for the architect):
//   Scanned surfaces = the identity-carrying documentation the refactor owns:
//     - CLAUDE.md (the constitution; S1.6 removed its inline hexes)
//     - docs/**/*.md (generated docs + hand docs; .md only, so the gitignored local-only
//       docs/n8n/*/workflow.json exports - mirrors of live n8n state, not brand surfaces - are out)
//     - templates/**/*.md (generation inputs)
//     - brand/**/*.md EXCEPT brand/config/color-system.md (the law file itself)
//     - system/manifest.json + scheduler/schedule.md (hand-edited sources)
//     - every file in .staging/ (any generated output about to ship)
//   NOT scanned: work/** (application code and the LOCKED Building-Alex diagram design system in
//   work/12-linkedin-series, which is explicitly allowed its own palette), vault/** (personal,
//   local-only), outputs/**, scripts/** (code), refactor/** (working notes), node_modules.
//   3-digit shorthand hexes are normalized (#fff -> #ffffff) before the token match.
// ---------------------------------------------------------------------------------------------
const HEX_RE = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;
const LAW_FILE = 'brand/config/color-system.md';

function normalizeHex(h) {
  const x = h.toLowerCase();
  if (x.length === 4) return '#' + x[1] + x[1] + x[2] + x[2] + x[3] + x[3];
  return x;
}

function v5HexTokens({ stagedDir, allHexes }, failures) {
  const rels = new Set(['CLAUDE.md', 'system/manifest.json', 'scheduler/schedule.md']);
  for (const dir of ['docs', 'templates', 'brand']) {
    const abs = path.join(REPO, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of listFiles(abs)) {
      const rel = path.relative(REPO, f).split(path.sep).join('/');
      if (rel.toLowerCase().endsWith('.md')) rels.add(rel);
    }
  }
  if (stagedDir && fs.existsSync(stagedDir))
    for (const f of listFiles(stagedDir)) rels.add(path.relative(stagedDir, f).split(path.sep).join('/'));
  rels.delete(LAW_FILE);

  for (const rel of [...rels].sort()) {
    const eff = effective(stagedDir, rel);
    if (!eff) continue;
    const bad = new Map(); // hex -> first line number
    const lines = eff.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].match(HEX_RE) || []) {
        const hex = normalizeHex(m);
        if (!allHexes.has(hex) && !bad.has(m)) bad.set(m, i + 1);
      }
    }
    if (bad.size) {
      const detail = [...bad.entries()].map(([h, ln]) => `${h} (line ${ln})`).join(', ');
      failures.push(`FAILED V5: hex value(s) outside ${LAW_FILE} matching no defined token in ${rel} (${eff.from}): ${detail}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// V6 - model routing, reality-aware (A3): the prose-model rule in CLAUDE.md ("Text-generation
//      nodes use <model>") vs the model id actually deployed in the live n8n 'Build Writer
//      Request' nodes of the production engines (the sync-n8n-voice TARGETS that are registered
//      in system/manifest.json - i.e. #03 and #14; the Writer Voice Eval is a harness, not a
//      production engine, and is out of scope per the Phase 3 handoff).
//      Credentials come ONLY from env (N8N_API_URL, N8N_API_KEY). Missing creds or an unreachable
//      API: hard FAIL in generator context (ground rule 7), LOUD SKIP in pre-commit context.
//      A real mismatch fails in every context.
// ---------------------------------------------------------------------------------------------
function ruleModel(claudeText) {
  const sec = mdSection(claudeText, /^## Model Routing in n8n Workflows[^\n]*$/m);
  if (!sec) return null;
  const m = sec.match(/Text-generation nodes use \**([A-Za-z0-9._-]+)/);
  if (!m) return null;
  return m[1].replace(/[.*]+$/, ''); // strip sentence period / closing bold
}

async function v6ModelRouting({ stagedDir, manifest, context }, failures, warnings) {
  const claude = effective(stagedDir, 'CLAUDE.md');
  if (!claude) { failures.push('FAILED V6: CLAUDE.md not found (staged or repo)'); return; }
  const rule = ruleModel(claude.text);
  if (!rule) {
    failures.push(`FAILED V6: cannot parse the prose-model rule from the "Model Routing in n8n Workflows" section of CLAUDE.md (${claude.from}) - expected "Text-generation nodes use <model>"`);
    return;
  }

  const base = process.env.N8N_API_URL, key = process.env.N8N_API_KEY;
  if (!base || !key) {
    const msg = 'V6: N8N_API_URL and/or N8N_API_KEY env vars missing - the live model-routing check cannot run (credentials never live in code)';
    if (context === 'pre-commit') { warnings.push(`WARNING V6 SKIPPED (pre-commit): ${msg}`); return; }
    failures.push(`FAILED ${msg}`);
    return;
  }

  const registered = new Set(manifest.projects.map(p => p.n8n).filter(Boolean));
  const engines = TARGETS.filter(t => registered.has(t.id));
  if (engines.length === 0) { failures.push('FAILED V6: no sync-n8n-voice target workflow is registered in system/manifest.json - nothing to verify'); return; }

  for (const t of engines) {
    let wf;
    try {
      wf = await fetchJson(`${base.replace(/\/$/, '')}/workflows/${t.id}`, { 'X-N8N-API-KEY': key });
    } catch (e) {
      const msg = `V6: live n8n workflow ${t.id} (${t.name}) unreachable - ${e.message}`;
      if (context === 'pre-commit') { warnings.push(`WARNING V6 SKIPPED (pre-commit): ${msg}`); continue; }
      failures.push(`FAILED ${msg}`);
      continue;
    }
    const node = (wf.nodes || []).find(n => n.name === NODE);
    if (!node || typeof (node.parameters || {}).jsCode !== 'string') {
      failures.push(`FAILED V6: live workflow ${t.id} (${t.name}) has no '${NODE}' code node - the live pipeline no longer matches what CLAUDE.md describes`);
      continue;
    }
    const models = [...new Set([...node.parameters.jsCode.matchAll(/\bmodel\s*:\s*["']([A-Za-z0-9._-]+)["']/g)].map(m => m[1]))];
    if (models.length === 0) {
      failures.push(`FAILED V6: no model id found in the '${NODE}' node of live workflow ${t.id} (${t.name})`);
      continue;
    }
    for (const m of models) {
      if (m !== rule)
        failures.push(`FAILED V6: model routing mismatch - CLAUDE.md (${claude.from}) rule says ${rule}, live workflow ${t.id} (${t.name}) '${NODE}' runs ${m}`);
    }
  }

  // BUG-10 fix (2026-07-15): also model-check the sync TARGETS that are NOT registered production
  // engines (the Writer Voice Eval) - WARN, not fail. The eval reuses the writer node verbatim and is
  // the "re-test the sanitizer" regression harness, so if it silently drifts to a different model its
  // pass/fail stops representing production; surface it without failing a build.
  for (const t of TARGETS.filter(x => !registered.has(x.id))) {
    try {
      const wf = await fetchJson(`${base.replace(/\/$/, '')}/workflows/${t.id}`, { 'X-N8N-API-KEY': key });
      const node = (wf.nodes || []).find(n => n.name === NODE);
      if (!node || typeof (node.parameters || {}).jsCode !== 'string') continue;
      const models = [...new Set([...node.parameters.jsCode.matchAll(/\bmodel\s*:\s*["']([A-Za-z0-9._-]+)["']/g)].map(m => m[1]))];
      for (const m of models) {
        if (m !== rule) warnings.push(`WARNING V6: sync harness ${t.id} (${t.name}) '${NODE}' runs ${m}, not the rule ${rule} - the regression harness has drifted from production`);
      }
    } catch (e) {
      warnings.push(`WARNING V6: sync harness ${t.id} (${t.name}) unreachable for model-check - ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// V7 - lifecycle-state drift lint (upgrade P5, 2026-07-12, design 1.5.2): deterministic,
//      zero-token. For every registry row (projects[] + meta.unnumbered) scan the hand-maintained
//      prose surfaces for lifecycle-state words that CONTRADICT the manifest state, with exact
//      file:line output.
//
//      Scanned assertion locations ONLY (state words inside dated history notes / body prose are
//      narrative, not claims - deliberately out of scope):
//        - scheduler/schedule.md: the "### " section title line + "- Status:"/"- State:" lines of
//          sections associated to a project (by title containing the project title, a "(#NN)"
//          tag, or the "- Command:" line naming one of the project's /commands). ERROR-tier:
//          the scheduler is an execution surface, a wrong state there mis-runs things (c5/M3).
//        - the project's vault status.md YAML frontmatter `state:` / `status:` value. WARNING.
//        - the project's docs/projects/{docs} markdown heading lines. WARNING.
//
//      False-positive guards (tuned against the real repo, 2026-07-12):
//        - schedule.md matching is UPPERCASE-ONLY: the repo convention writes real state
//          assertions there in caps ("State PARKED", "PAUSED 2026-06-18") while lowercase
//          "parked"/"retired"/"live" are ordinary English inside explanatory prose. Frontmatter
//          values and docs headers stay case-insensitive (their convention is lowercase:
//          "status: on-demand", "# 11 - ... (paused)");
//        - hyphenated compounds are not claims ("Event-driven", "phase-2-live");
//        - "A -> B" transition phrases are narrative (both sides skipped) - the current state,
//          if asserted, appears standalone elsewhere on the surface;
//        - DISABLED next to Task Scheduler wording is a fact about the JOB, not the project
//          ("Status: DISABLED in Task Scheduler" describes schtasks state);
//        - PAUSED is accepted as equivalent to a manifest PARKED (same "deliberately stopped"
//          class); every other word must equal the manifest state exactly.
// ---------------------------------------------------------------------------------------------
const STATE_WORDS = 'ON-DEMAND|LIVE|EVENT|DORMANT|PARKED|RETIRED|PAUSED|DISABLED';
const STATE_RE_CI = new RegExp(`\\b(${STATE_WORDS})\\b`, 'gi'); // frontmatter + docs headers
const STATE_RE_UC = new RegExp(`\\b(${STATE_WORDS})\\b`, 'g');  // schedule.md (uppercase-only)

function stateWordsIn(line, re = STATE_RE_CI) {
  const out = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(line)) !== null) {
    const word = m[1].toUpperCase();
    const before = line.slice(0, m.index);
    const after = line.slice(m.index + m[1].length);
    if (/[A-Za-z0-9]-$/.test(before)) continue;              // compound: phase-2-live
    if (/^-[A-Za-z0-9]/.test(after)) continue;               // compound: Event-driven
    if (/(->|→)\s*$/.test(before.slice(-8))) continue;       // transition target: "PARKED -> X"
    if (/^\s*(->|→)/.test(after.slice(0, 8))) continue;      // transition source: "X -> ON-DEMAND"
    if (word === 'DISABLED' && /task scheduler|schtasks|scheduledtask/i.test(line)) continue;
    out.push(word);
  }
  return out;
}

function stateContradicts(word, manifestState) {
  const s = String(manifestState || '').toUpperCase();
  if (word === s) return false;
  if (word === 'PAUSED' && s === 'PARKED') return false; // same "deliberately stopped" class
  return true;
}

function v7StateDriftLint({ stagedDir, manifest }, failures, warnings) {
  const rows = [...manifest.projects, ...(manifest.meta?.unnumbered || [])];

  // --- scheduler/schedule.md (ERROR-tier) --------------------------------------------------
  const sched = effective(stagedDir, 'scheduler/schedule.md');
  if (sched) {
    const lines = sched.text.split(/\r?\n/);
    // sections: [startIdx, endIdx) of each "### " block
    const sections = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('### ')) {
        if (sections.length) sections[sections.length - 1].end = i;
        sections.push({ start: i, end: lines.length });
      }
    }
    for (const sec of sections) {
      const title = lines[sec.start];
      const body = lines.slice(sec.start, sec.end);
      const cmdLine = body.find(l => /^\s*-\s*Command:/i.test(l)) || '';
      // associate the section to registry rows
      const owners = rows.filter(p => {
        if (p.title && new RegExp(`\\b${p.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(title)) return true;
        if (p.num != null && new RegExp(`\\(#0?${p.num}\\)`).test(title)) return true;
        return (p.commands || []).some(c => new RegExp(`/${c}\\b`).test(cmdLine));
      });
      if (owners.length === 0) continue;
      // assertion lines: the title + Status/State lines
      const assertionIdx = [sec.start];
      for (let i = sec.start + 1; i < sec.end; i++)
        if (/^\s*-\s*\*{0,2}(Status|State)\b/i.test(lines[i])) assertionIdx.push(i);
      for (const idx of assertionIdx) {
        for (const word of stateWordsIn(lines[idx], STATE_RE_UC)) {
          for (const p of owners) {
            if (stateContradicts(word, p.state))
              failures.push(`FAILED V7: scheduler/schedule.md:${idx + 1} asserts ${word} but system/manifest.json says ${p.name} is ${p.state}`);
          }
        }
      }
    }
  }

  // --- vault status.md frontmatter + docs/projects headers (WARNING-tier) -------------------
  for (const p of rows) {
    if (p.status_md) {
      const st = effective(stagedDir, p.status_md);
      if (st) {
        const fmLines = st.text.split(/\r?\n/);
        if (fmLines[0] === '---') {
          for (let i = 1; i < fmLines.length && fmLines[i] !== '---'; i++) {
            const kv = fmLines[i].match(/^(state|status):\s*(.+)$/i);
            if (!kv) continue;
            for (const word of stateWordsIn(kv[2]))
              if (stateContradicts(word, p.state))
                warnings.push(`WARNING V7: ${p.status_md}:${i + 1} frontmatter says ${word} but system/manifest.json says ${p.name} is ${p.state}`);
          }
        }
      }
    }
    if (p.docs) {
      const rel = `docs/projects/${p.docs}`;
      const doc = effective(stagedDir, rel);
      if (doc) {
        const dLines = doc.text.split(/\r?\n/);
        for (let i = 0; i < dLines.length; i++) {
          if (!/^#{1,6}\s/.test(dLines[i])) continue;
          for (const word of stateWordsIn(dLines[i]))
            if (stateContradicts(word, p.state))
              warnings.push(`WARNING V7: ${rel}:${i + 1} heading says ${word} but system/manifest.json says ${p.name} is ${p.state}`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// V8 - HQ hex scan + token staleness (upgrade P5, 2026-07-12, design 1.6/4.5). ERROR-tier.
//      (a) every hex literal in the HQ app source (work/16-alex-hq/app: *.ts/*.tsx/*.css under
//          app/, lib/ and any future scripts/; node_modules, .next, public/data and the generated
//          tokens.css itself excluded) must resolve to a hex the color law defines (parseColorTokens
//          allHexes - the SAME contract V5 and the emitter use) or sit on the documented allowlist;
//      (b) staleness: tokens.css and tokens.json on disk must be byte-equal (modulo CRLF) to what
//          the emitter would emit from the law right now - the committed artifacts can never drift
//          from brand/config/color-system.md.
//      V5 deliberately excludes work/** (the work/12 locked diagram palette); V8 is the surgical
//      extension for the ONE work/ surface that is identity-carrying UI, the HQ app.
// ---------------------------------------------------------------------------------------------
const HQ_APP_DIR = 'work/16-alex-hq/app';
// V8 allowlist - every entry documented:
//   #ffffff : law §4.2 primary text on dark (also in allHexes; listed for explicitness)
//   (#ff8a75 retired from the allowlist 2026-07-12, P8/D5: it is now the law token Signal Coral
//    --error-text-dark in color-system.md, so it resolves via allHexes; the app routes it through
//    var(--error-text-dark) in globals.css + notes.tsx.)
const V8_ALLOWLIST = new Set(['#ffffff']);
const V8_EXTS = new Set(['.ts', '.tsx', '.css']);

function v8HqHexScan({ stagedDir, colorTokens }, failures) {
  // collect candidate rels from the repo tree AND the staged tree (staged copy wins via effective)
  const rels = new Set();
  const collect = (baseAbs, baseRel) => {
    if (!fs.existsSync(baseAbs)) return;
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.next') continue;
        const p = path.join(dir, e.name);
        const rel = baseRel + '/' + path.relative(baseAbs, p).split(path.sep).join('/');
        if (e.isDirectory()) {
          if (rel === `${HQ_APP_DIR}/public/data`) continue;
          walk(p);
        } else if (V8_EXTS.has(path.extname(e.name).toLowerCase()) && rel !== genTokens.CSS_REL) {
          rels.add(rel);
        }
      }
    })(baseAbs);
  };
  collect(path.join(REPO, HQ_APP_DIR), HQ_APP_DIR);
  if (stagedDir) collect(path.join(stagedDir, HQ_APP_DIR), HQ_APP_DIR);

  const allHexes = colorTokens.allHexes;
  for (const rel of [...rels].sort()) {
    const eff = effective(stagedDir, rel);
    if (!eff) continue;
    const lines = eff.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].match(HEX_RE) || []) {
        const hex = normalizeHex(m);
        if (!allHexes.has(hex) && !V8_ALLOWLIST.has(hex))
          failures.push(`FAILED V8: off-palette hex ${m} in ${rel}:${i + 1} (${eff.from}) - not a color-law token and not on the documented allowlist`);
      }
    }
  }

  // staleness: committed artifacts vs what the emitter would emit right now
  const norm = t => t.replace(/\r\n/g, '\n');
  for (const [rel, emit] of [[genTokens.CSS_REL, genTokens.tokensCss], [genTokens.JSON_REL, genTokens.tokensJson]]) {
    const eff = effective(stagedDir, rel);
    if (!eff) { failures.push(`FAILED V8: ${rel} missing - run 'node scripts/generate-alex.js' to emit the brand tokens`); continue; }
    if (norm(eff.text) !== norm(emit(colorTokens)))
      failures.push(`FAILED V8: ${rel} (${eff.from}) is STALE against brand/config/color-system.md - regenerate (node scripts/generate-alex.js), never hand-edit`);
  }
}

// ---------------------------------------------------------------------------------------------
// V9 - first-fire aging (upgrade P4, 2026-07-12, design 1.4/MR2-5): every LIVE/EVENT registry
//      row (numbered + meta.unnumbered) that has NEVER fired (first_fire null) is listed as a
//      WARNING - never a failure (the aging rule blocks nothing; it makes scaffold-masquerade
//      visible). The registry rule (manifest states_doc) allows 14 days from the project's
//      status.md frontmatter `created:` date; rows past that window are marked OVERDUE (check.ps1
//      C13 goes amber on the same condition). ON-DEMAND/DORMANT/PARKED/RETIRED are exempt by
//      rule - they have no promise to fire. A documented drill counts (first_fire_kind=drill).
// ---------------------------------------------------------------------------------------------
function v9FirstFireAging({ stagedDir, manifest }, warnings) {
  const rows = [...manifest.projects, ...(manifest.meta?.unnumbered || [])];
  const flagged = [];
  for (const p of rows) {
    if (p.state !== 'LIVE' && p.state !== 'EVENT') continue;
    if (p.first_fire) continue;
    let ageDays = null;
    if (p.status_md) {
      const st = effective(stagedDir, p.status_md);
      const m = st && st.text.match(/^created:\s*(\d{4}-\d{2}-\d{2})/m);
      if (m) ageDays = Math.floor((Date.now() - new Date(`${m[1]}T00:00:00Z`).getTime()) / 86400000);
    }
    const label = p.num != null ? `#${pad(p.num)} ${p.name}` : p.name;
    flagged.push({ label, ageDays });
  }
  if (flagged.length === 0) return;
  const fmt = f => `${f.label} (${f.ageDays === null ? 'created date unknown' : `${f.ageDays}d since created`})`;
  const overdue = flagged.filter(f => f.ageDays === null || f.ageDays > 14);
  const within = flagged.filter(f => f.ageDays !== null && f.ageDays <= 14);
  if (overdue.length)
    warnings.push(`WARNING V9: LIVE/EVENT project(s) never fired (first_fire null) PAST the 14-day window: ${overdue.map(fmt).join(', ')} - fire it (a documented drill counts, first_fire_kind=drill) or re-state it with a reason`);
  if (within.length)
    warnings.push(`WARNING V9: LIVE/EVENT project(s) never fired (first_fire null), still inside the 14-day window: ${within.map(fmt).join(', ')}`);
}

// ---------------------------------------------------------------------------------------------
// V10 - protected-file guard (context-engineering run, 2026-07-15). Enforces vault/me/NEVER-TOUCH.md
//       at COMMIT TIME. A CHANGESET question (git's staged diff), not a content question, so it
//       reads git directly and runs ONLY in pre-commit context with --changed (armed by
//       scripts/hooks/pre-commit); a no-op in the generator context, so generate-alex.js is
//       untouched.
//
//       Rule per protected path (kinds: immutable | append-only | flagged):
//         - delete / rename-away of a protected path -> FAIL (immutable, append), WARNING (flagged)
//         - modify of an immutable path              -> FAIL
//         - modify of an append-only path            -> FAIL unless the staged diff is pure addition
//                                                       (numstat removed-lines == 0)
//         - modify of a flagged path                 -> WARNING
//         - add (new file), incl. under an immutable dir -> allowed
//       Override: git commit --no-verify (documented in NEVER-TOUCH.md; no custom flag).
//
//       V10_PROTECTED below is the canonical machine list; the human doc is vault/me/NEVER-TOUCH.md
//       (keep the two in sync - short, low-churn set).
//
//       HONESTY NOTE (the privacy scrub reality): a commit guard can only see git-TRACKED files.
//       All of vault/** and outputs/** are gitignored (local-only, encrypted-backup-covered), so
//       those entries NEVER appear in a staged diff - the guard cannot enforce them at commit time;
//       they are protected by policy + the encrypted vault backup, and are listed here (tracked:false)
//       so the set stays canonical and the guard auto-covers any entry that ever becomes tracked.
//       The entries the guard ACTIVELY enforces are the tracked ones (tracked:true):
//       system/landscape-log.jsonl and brand/config/color-system.md.
// ---------------------------------------------------------------------------------------------
const V10_PROTECTED = [
  { path: 'vault/sources/', kind: 'immutable', dir: true, tracked: false },
  { path: 'vault/log.md', kind: 'append', tracked: false },
  { path: 'vault/projects/self-review/close-out-log.md', kind: 'append', tracked: false },
  { path: 'vault/projects/sprint-tracker/velocity.md', kind: 'append', tracked: false },
  { path: 'outputs/ledger.jsonl', kind: 'append', tracked: false },
  { path: 'system/human-actions.jsonl', kind: 'append', tracked: false },   // BUG-07 fix 2026-07-15: the two queues NEVER-TOUCH.md
  { path: 'system/pending-writes.jsonl', kind: 'append', tracked: false },  // lists as append-only were absent from V10_PROTECTED; added so the set matches the doc
  { path: 'system/landscape-log.jsonl', kind: 'append', tracked: true },
  { path: 'vault/identity.md', kind: 'flagged', tracked: false },
  { path: 'brand/config/color-system.md', kind: 'flagged', tracked: true },
];

function matchProtected(rel, list = V10_PROTECTED) {
  const p = String(rel || '').split(path.sep).join('/');
  for (const entry of list) {
    if (entry.dir) { if (p === entry.path.replace(/\/$/, '') || p.startsWith(entry.path)) return entry; }
    else if (p === entry.path) return entry;
  }
  return null;
}

// PURE evaluator (unit-tested directly): changeset = [{status, path, oldPath?, removed}], status a
// single git letter (A/M/D/R/C); removed is the numstat removed-line count (consulted for M only).
function evaluateProtectedChangeset(changeset, list = V10_PROTECTED) {
  const failures = [], warnings = [];
  for (const ch of changeset) {
    const st = String(ch.status || '').toUpperCase();
    if (st === 'D' || st.startsWith('R')) {
      // judged on the path that LEAVES its protected home (old path for a rename)
      const gone = st.startsWith('R') ? (ch.oldPath || ch.path) : ch.path;
      const hit = matchProtected(gone, list);
      if (hit) {
        const verb = st === 'D' ? 'deletes' : 'renames away';
        const msg = `commit ${verb} protected ${hit.kind} path ${gone} (NEVER-TOUCH.md)`;
        if (hit.kind === 'flagged') warnings.push(`WARNING V10: ${msg} - surfaced, not blocked`);
        else failures.push(`FAILED V10: ${msg} - use 'git commit --no-verify' to override deliberately`);
      }
      continue;
    }
    if (st === 'M') {
      const hit = matchProtected(ch.path, list);
      if (!hit) continue;
      if (hit.kind === 'immutable')
        failures.push(`FAILED V10: commit modifies immutable ${ch.path} (NEVER-TOUCH.md) - content is read-only; --no-verify to override`);
      else if (hit.kind === 'flagged')
        warnings.push(`WARNING V10: commit modifies flagged ${ch.path} (NEVER-TOUCH.md) - surfaced, not blocked`);
      else if (hit.kind === 'append') {
        const removed = Number(ch.removed);
        if (!Number.isFinite(removed) || removed > 0)
          failures.push(`FAILED V10: commit modifies append-only ${ch.path} with ${Number.isFinite(removed) ? removed : 'non-text/unknown'} removed line(s) (NEVER-TOUCH.md) - append-only files may only grow; --no-verify to override`);
      }
    }
    // A (add) and any other status: allowed
  }
  return { failures, warnings };
}

// Reads git's staged changeset (name-status + numstat, both -z for robust paths). Only called in
// pre-commit context, so git shelling never happens on the generator path.
function readStagedChangeset() {
  const { execFileSync } = require('child_process');
  const run = args => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 24 });
  const changeset = [];
  const ns = run(['diff', '--cached', '--name-status', '-z']).split('\0');
  for (let i = 0; i < ns.length; i++) {
    const status = ns[i];
    if (!status) continue;
    if (status[0] === 'R' || status[0] === 'C') {
      const oldPath = ns[++i], newPath = ns[++i];
      changeset.push({ status: status[0], oldPath, path: newPath });
    } else {
      const p = ns[++i];
      if (p == null) break;
      changeset.push({ status: status[0], path: p });
    }
  }
  // numstat removed-line counts for modified files (rename records skipped: those FAIL via name-status)
  const removedByPath = new Map();
  const num = run(['diff', '--cached', '--numstat', '-z']).split('\0');
  for (let i = 0; i < num.length; i++) {
    const tok = num[i];
    if (!tok) continue;
    const parts = tok.split('\t');
    if (parts.length === 3 && parts[2] !== '') removedByPath.set(parts[2], parts[1]); // '-' for binary
    else if (parts.length === 3 && parts[2] === '') i += 2; // rename record: skip old+new tokens
  }
  for (const ch of changeset)
    if (ch.status === 'M') ch.removed = removedByPath.has(ch.path) ? removedByPath.get(ch.path) : '0';
  return changeset;
}

function v10ProtectedFileGuard({ context, changed }, failures, warnings) {
  if (context !== 'pre-commit' || !changed) return; // armed only by the commit hook
  let changeset;
  try { changeset = readStagedChangeset(); }
  catch (e) { warnings.push(`WARNING V10 SKIPPED: could not read the staged changeset via git - ${e.message}`); return; }
  const res = evaluateProtectedChangeset(changeset);
  for (const f of res.failures) failures.push(f);
  for (const w of res.warnings) warnings.push(w);
}

// ---------------------------------------------------------------------------------------------
// runAll - the single entry point (async since Phase 3: V6 talks to the live n8n API).
// ---------------------------------------------------------------------------------------------
async function runAll({ stagedDir, context = 'generator', changed = false } = {}) {
  const failures = [];
  const warnings = [];

  structuralGuards({ stagedDir }, failures);

  // Shared sources for V1-V6 (staged copy wins; sources are never staged today but effective()
  // keeps that true by construction if they ever are).
  let manifest = null, schedule = null, colorTokens = null;
  const mfRaw = effective(stagedDir, 'system/manifest.json');
  if (!mfRaw) failures.push('FAILED V1: system/manifest.json not found - the registry is required');
  else {
    try { manifest = JSON.parse(mfRaw.text); }
    catch (e) { failures.push(`FAILED V1: system/manifest.json is not valid JSON: ${e.message}`); }
  }
  const schedRaw = effective(stagedDir, 'scheduler/schedule.md');
  if (!schedRaw) failures.push('FAILED V2: scheduler/schedule.md not found');
  else {
    try { schedule = parseScheduleJobs(schedRaw.text); }
    catch (e) { failures.push(`FAILED V2: cannot parse scheduler/schedule.md: ${e.message}`); }
  }
  const lawRaw = effective(stagedDir, LAW_FILE);
  if (!lawRaw) failures.push(`FAILED V5: ${LAW_FILE} not found - the color law file is required`);
  else {
    try { colorTokens = parseColorTokens(lawRaw.text); }
    catch (e) { failures.push(`FAILED V5: cannot parse the token table of ${LAW_FILE}: ${e.message}`); }
  }

  // The FULL suite runs on every invocation - generate-alex's --only limits what is staged,
  // never what is checked (c7 fix, upgrade P5).
  if (manifest) v1AutomationCount({ stagedDir, manifest }, failures);
  if (schedule) v2ScheduledJobs({ stagedDir, schedule, context }, failures, warnings);
  if (manifest) v3NoRetiredAsLive({ stagedDir, manifest }, failures);
  v4McpConsistency({ stagedDir }, failures);
  if (colorTokens) v5HexTokens({ stagedDir, allHexes: colorTokens.allHexes }, failures);
  if (manifest) await v6ModelRouting({ stagedDir, manifest, context }, failures, warnings);
  if (manifest) v7StateDriftLint({ stagedDir, manifest }, failures, warnings);
  if (colorTokens) v8HqHexScan({ stagedDir, colorTokens }, failures);
  if (manifest) v9FirstFireAging({ stagedDir, manifest }, warnings);
  v10ProtectedFileGuard({ context, changed }, failures, warnings); // commit-time only (no-op otherwise)

  for (const w of warnings) console.error(w);
  for (const f of failures) console.error(f);
  if (failures.length === 0)
    console.log(`validate-alex: G1-G4 + V1-V10 PASS (context=${context}${warnings.length ? `, ${warnings.length} warning(s) - see above` : ''})`);
  return { ok: failures.length === 0, failures, warnings };
}

if (require.main === module) {
  const stagedArg = process.argv.find(a => a.startsWith('--staged='));
  const ctxArg = process.argv.find(a => a.startsWith('--context='));
  const context = ctxArg ? ctxArg.split('=')[1] : 'generator';
  if (!['generator', 'pre-commit'].includes(context)) {
    console.error(`validate-alex: unknown --context '${context}' (valid: generator, pre-commit)`);
    process.exit(1);
  }
  const stagedDir = stagedArg ? path.resolve(stagedArg.split('=')[1]) : path.join(REPO, '.staging');
  const changed = process.argv.includes('--changed'); // arms V10 (pre-commit hook passes it)
  // process.exitCode (not process.exit()): a hard exit right after fetch trips a libuv teardown
  // assertion on Windows (uv async handle still closing). Letting the loop drain is safe and the
  // exit code is identical for the caller.
  runAll({ stagedDir: fs.existsSync(stagedDir) ? stagedDir : undefined, context, changed })
    .then(({ ok }) => { process.exitCode = ok ? 0 : 1; })
    .catch(e => { console.error(`validate-alex: internal error: ${e.message}`); process.exitCode = 1; });
}

module.exports = { runAll, evaluateProtectedChangeset, V10_PROTECTED };
