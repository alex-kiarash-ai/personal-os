#!/usr/bin/env node
// validate-alex.js - the validation layer (Layer 6). PHASE 3 DELIVERABLE (P3-S1).
//
// Runs as the final step of every generate-alex.js run, standalone on the CLI, and from the git
// pre-commit hook (P3-S3). Six checks (V1-V6, spec table + amendments A3/A5) plus the structural
// guards G1-G4 from Phase 1, plus V9 first-fire aging (upgrade P4, 2026-07-12; WARNING-only),
// plus V7 lifecycle-state drift lint and V8 HQ hex scan (upgrade P5, 2026-07-12, design 1.5/1.6),
// plus V10 protected-file guard (2026-07-15, context-engineering run; COMMIT-TIME ONLY, enforces
// vault/me/NEVER-TOUCH.md against the staged changeset - runs in pre-commit context with --changed),
// plus V11 forced-add guard (2026-07-17, three-plan validation P0a; COMMIT-TIME ONLY, blocks a
// `git add -f` of a gitignored path from being committed to the public repo),
// plus V12 trifecta gate (2026-07-17, three-plan validation P3; every invocation, pure file checks:
// a manifest project with all three trifecta legs true MUST declare a gate that is echoed in its CLAUDE.md).
// Any failure exits 1 and names exactly what drifted and where.
//
// plus V13 local wrapper model-pin contract (2026-07-25, stress-test F4; the local twin of V6,
// COMPLETE by construction: every scripts/run-*.ps1 + auth-check.ps1 must be declared in the contract).
//
// plus V14 Alex gender-neutrality contract (2026-07-28; the code behind work/12 HARD RULE 15 and
//      the soul.md law of the same date. Two narrow scans: unpublished episode BODIES, and the
//      pinned locked line. Published episodes are archive and are skipped by construction).
// The full suite (SUITE_RANGE below, derived from V_MAX - never restate the number here) runs on EVERY invocation (V10/V11 are
// commit-time only) - generate-alex.js --only=X limits what is staged/applied, never what is checked
// (c7 fix, upgrade P5). V_MAX is the ONE declared suite number; every consumer derives from it (F-10).
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

// --- suite range: ONE declared number, every consumer derives (stress-test fix F-10, 2026-07-25) ---
// The generator used to hand-write its own "G1-G4 + V1-V9" label in two places and rotted four rules
// behind the real suite. A label that restates a fact it does not own is the same class as a validator
// deriving its expectation from prose (the V6 lesson): so V_MAX is declared HERE, once, and
// generate-alex.js + the recall h-validators harvester + narrative-drift-check.py all read THIS
// declaration (a structured `const V_MAX = <n>`), never a printed string or a prose claim.
const V_MAX = 15;
const SUITE_RANGE = `G1-G4 + V1-V${V_MAX}`;

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
// V6 - model routing + schedule intent, CONTRACT-DRIVEN (rewritten 2026-07-24; SWEEP + cron legs
//      added 2026-07-25 for stress-test findings F-06/F-07). Desired state lives in
//      system/manifest.json `meta.model_routing` (`default` + per-workflow `overrides`) and, per
//      project, `n8n_cron`. This REPLACED the original prose-derived check that regex-read
//      "Text-generation nodes use <model>" out of CLAUDE.md; that version broke the day the two
//      engines got a documented Opus 4.8 exception, because a regex over one sentence cannot see an
//      exception paragraph. The rule it embodies: a validator NEVER derives its expectation from
//      prose - desired state lives in structured data and the check reads THAT.
//
//      THREE legs, all off ONE `GET /workflows` call (the n8n public API returns full workflow
//      objects incl. nodes, so the sweep costs the same as the old three per-workflow GETs):
//        (a) TARGETS - each voice-sync target still carries the checked node on its contracted model.
//        (b) SWEEP (F-07) - EVERY OTHER live workflow's model strings must also satisfy the contract.
//            Before this, `meta.model_routing.default` was enforced for nobody: a Claude node added
//            to any non-target workflow ran any model unchecked. Scope note (precision over recall,
//            deliberate): only values that LOOK like an LLM id are asserted, so a data field
//            legitimately named "model" cannot false-fail the generator; a typo'd id that matches no
//            provider is left to the runtime 400 + the Pipeline Error Alert.
//        (c) CRON (F-06) - a project's declared `n8n_cron` must equal the live scheduleTrigger.
//            Nothing checked this: the HQ liveness monitor derives its silence window FROM the live
//            trigger, so a drifted cron silently re-tuned the monitor instead of raising it, and
//            C16 skips the engines' cadence label entirely.
//      Registered production workflows FAIL on a mismatch; unregistered ones (the eval harness,
//      housekeeping flows) WARN. Credentials come ONLY from env. Missing creds or an unreachable
//      API: hard FAIL in generator context (ground rule 7), LOUD SKIP in pre-commit context.
// ---------------------------------------------------------------------------------------------
const LLM_ID_RE = /(claude|gpt|gemini|llama|mistral|sonnet|opus|haiku|kimi|moonshot|o[134]-)/i;

// Every model id declared in a node's parameters: the `model: "..."` form inside Code-node jsCode
// AND a `"model": "..."` key anywhere in a node's parameter JSON (an HTTP/LangChain node body).
function modelIdsInNode(node) {
  const out = new Set();
  const add = s => { if (LLM_ID_RE.test(s)) out.add(s); };
  const js = (node.parameters || {}).jsCode;
  if (typeof js === 'string')
    for (const m of js.matchAll(/\bmodel\s*:\s*["']([A-Za-z0-9._-]+)["']/g)) add(m[1]);
  let blob = '';
  try { blob = JSON.stringify(node.parameters || {}); } catch (_) { blob = ''; }
  for (const m of blob.matchAll(/\\?"model\\?"\s*:\s*\\?"([A-Za-z0-9._-]+)\\?"/g)) add(m[1]);
  return [...out];
}

// The live scheduleTrigger expressed as cron. n8n stores either a raw cronExpression or an
// interval form; a plain every-1-day interval is exactly `<min> <hour> * * *`, so it is normalized
// and comparable. Any other interval shape is returned as null (declared-but-inexpressible warns).
function liveCronsOf(wf) {
  const out = [];
  for (const n of wf.nodes || []) {
    if (!/scheduletrigger/i.test(String(n.type || ''))) continue;
    const intervals = (((n.parameters || {}).rule) || {}).interval || [];
    for (const iv of intervals) {
      if (!iv) continue;
      if (iv.expression) { out.push({ cron: String(iv.expression).trim(), form: 'cronExpression' }); continue; }
      if (iv.field === 'days' && (iv.daysInterval == null || Number(iv.daysInterval) === 1)) {
        const h = Number(iv.triggerAtHour || 0), m = Number(iv.triggerAtMinute || 0);
        out.push({ cron: `${m} ${h} * * *`, form: 'days-interval(normalized)' });
        continue;
      }
      out.push({ cron: null, form: `interval ${JSON.stringify(iv)}` });
    }
  }
  return out;
}

async function v6ModelRouting({ manifest, context }, failures, warnings) {
  const mr = manifest.meta && manifest.meta.model_routing;
  if (!mr || !mr.default) {
    failures.push('FAILED V6: system/manifest.json meta.model_routing is missing or has no `default` - it is the source-of-truth contract this check enforces (a validator must never re-derive the model rule from prose)');
    return;
  }
  const node = mr.checked_node || NODE;
  const expectedFor = id => {
    const ov = (mr.overrides || []).find(o => o.workflow === id);
    return ov ? ov.model : mr.default;
  };

  const base = process.env.N8N_API_URL, key = process.env.N8N_API_KEY;
  if (!base || !key) {
    const msg = 'V6: N8N_API_URL and/or N8N_API_KEY env vars missing - the live model-routing check cannot run (credentials never live in code)';
    if (context === 'pre-commit') { warnings.push(`WARNING V6 SKIPPED (pre-commit): ${msg}`); return; }
    failures.push(`FAILED ${msg}`);
    return;
  }

  const registered = new Set(manifest.projects.map(p => p.n8n).filter(Boolean));
  if (!TARGETS.some(t => registered.has(t.id))) {
    failures.push('FAILED V6: no sync-n8n-voice target workflow is registered in system/manifest.json - nothing to verify');
    return;
  }

  // ONE list call feeds all three legs.
  let all;
  try {
    const j = await fetchJson(`${base.replace(/\/$/, '')}/workflows?limit=250`, { 'X-N8N-API-KEY': key });
    all = Array.isArray(j.data) ? j.data : [];
  } catch (e) {
    const msg = `V6: the live n8n workflow list is unreachable - ${e.message}`;
    if (context === 'pre-commit') { warnings.push(`WARNING V6 SKIPPED (pre-commit): ${msg}`); return; }
    failures.push(`FAILED ${msg}`);
    return;
  }
  if (all.length === 0) {
    failures.push('FAILED V6: the live n8n workflow list came back empty - the model-routing contract cannot be verified (treat as an outage, not a pass)');
    return;
  }
  const byId = new Map(all.map(w => [w.id, w]));
  const flagFor = id => m => registered.has(id)
    ? failures.push(`FAILED ${m}`)
    : warnings.push(`WARNING ${m} - not a registered production workflow`);

  // (a) the declared voice-sync targets
  for (const t of TARGETS) {
    const flag = flagFor(t.id);
    const wf = byId.get(t.id);
    if (!wf) { flag(`V6: sync target ${t.id} (${t.name}) is not in the live workflow list (deleted or renamed?)`); continue; }
    const codeNode = (wf.nodes || []).find(n => n.name === node);
    if (!codeNode || typeof (codeNode.parameters || {}).jsCode !== 'string') {
      flag(`V6: live workflow ${t.id} (${t.name}) has no '${node}' code node - the live pipeline no longer matches the model-routing contract`);
      continue;
    }
    const models = modelIdsInNode(codeNode);
    if (models.length === 0) {
      flag(`V6: no model id found in the '${node}' node of live workflow ${t.id} (${t.name})`);
      continue;
    }
    const exp = expectedFor(t.id);
    for (const m of models) {
      if (m !== exp)
        flag(`V6: model routing mismatch - manifest.meta.model_routing expects ${exp} for ${t.id} (${t.name}) '${node}', live runs ${m}`);
    }
  }

  // (b) the sweep: every other workflow (F-07)
  const targetIds = new Set(TARGETS.map(t => t.id));
  for (const wf of all) {
    if (targetIds.has(wf.id)) continue;
    const found = new Set();
    for (const n of wf.nodes || []) for (const m of modelIdsInNode(n)) found.add(m);
    if (found.size === 0) continue;                       // no LLM call: nothing to route
    const exp = expectedFor(wf.id);
    for (const m of found) {
      if (m !== exp)
        flagFor(wf.id)(`V6 (sweep): live workflow ${wf.id} ("${wf.name}") runs model ${m} but meta.model_routing expects ${exp} - fix the workflow, or add a documented override to the contract`);
    }
  }

  // (c) the cron contract: declared n8n_cron == live scheduleTrigger (F-06)
  for (const p of manifest.projects) {
    if (!p.n8n || !p.n8n_cron) continue;
    const wf = byId.get(p.n8n);
    if (!wf) {
      failures.push(`FAILED V6 (cron): #${pad(p.num)} ${p.name} declares n8n workflow ${p.n8n} which is NOT in the live workflow list`);
      continue;
    }
    const live = liveCronsOf(wf);
    if (live.length === 0) {
      failures.push(`FAILED V6 (cron): #${pad(p.num)} ${p.name} declares n8n_cron '${p.n8n_cron}' but live workflow ${p.n8n} ("${wf.name}") has no schedule trigger at all - it no longer runs on a schedule`);
      continue;
    }
    const comparable = live.filter(l => l.cron);
    if (comparable.length === 0) {
      warnings.push(`WARNING V6 (cron): #${pad(p.num)} ${p.name} declares n8n_cron '${p.n8n_cron}' but the live trigger form is not cron-expressible (${live.map(l => l.form).join('; ')}) - compare it by hand or drop the declaration`);
      continue;
    }
    const want = String(p.n8n_cron).trim();
    if (!comparable.some(l => l.cron === want))
      failures.push(`FAILED V6 (cron): #${pad(p.num)} ${p.name} live n8n schedule is [${comparable.map(l => l.cron).join(' | ')}] but system/manifest.json n8n_cron declares '${want}' - an undocumented schedule change (fix the workflow, or change the contract deliberately)`);
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
function v9FirstFireAging({ stagedDir, manifest }, failures, warnings) {
  const rows = [...manifest.projects, ...(manifest.meta?.unnumbered || [])];

  // (a) FUTURE first_fire = FAILURE (added 2026-07-28, command-layer review F-8). first_fire is the
  //     registry's proof-of-life record: "has this project ever actually produced for real". Both this
  //     check's aging half and check.ps1 C13 branch on first_fire being NULL, so a populated FUTURE date
  //     passes every check while asserting a fire that has not happened - the claim sits inside the
  //     structure but outside what the structure validates. It also permanently disables the 14-day
  //     aging clock, so a project that never fires can never be flagged. #31 carried "2026-07-29" on
  //     2026-07-28 and nothing caught it. The design already makes honesty easy (first_fire_kind:"drill"
  //     lets a documented test run count AND be marked as such), so a future date is never the right answer.
  const today = new Date().toISOString().slice(0, 10);
  for (const p of rows) {
    if (!p.first_fire || !/^\d{4}-\d{2}-\d{2}$/.test(p.first_fire)) continue;
    if (p.first_fire > today) {
      const label = p.num != null ? `#${pad(p.num)} ${p.name}` : p.name;
      failures.push(`FAILED V9: ${label} has first_fire "${p.first_fire}", which is in the FUTURE (today ${today}) - first_fire records a fire that ALREADY happened; set the real date, or null to let the 14-day aging clock run (a documented drill counts, first_fire_kind=drill)`);
    }
  }

  // (b) aging half: never-fired LIVE/EVENT rows, WARNING only (the aging rule blocks nothing).
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

// V11 - the forced-add guard (2026-07-17, three-plan validation run, plan phase P0a). COMMIT-TIME ONLY.
// Lists every tracked-but-ignored path: a `git add -f` of a .gitignore'd file. On the PUBLIC repo where
// .gitignore is the SOLE privacy barrier, one forced-added secret pushed at 21:30 is world-visible and
// permanently cacheable even after deletion. This is the machine behind .gitignore's own "rotate it
// immediately" line, fired at the only cadence that beats the nightly push: commit time. It lists ALL
// such paths (not just this commit's), so a historical forced add surfaces on the next commit too.
// The hook wrapper (scripts/hooks/pre-commit) fires this on interactive AND nightly-backup commits.
function v11IgnoredStagedGuard({ context, changed }, failures, warnings) {
  if (context !== 'pre-commit' || !changed) return; // armed only by the commit hook
  const { execFileSync } = require('child_process');
  let out;
  try {
    out = execFileSync('git', ['ls-files', '--cached', '--ignored', '--exclude-standard'],
      { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 24 });
  } catch (e) {
    warnings.push(`WARNING V11 SKIPPED: could not list tracked-vs-ignored paths via git - ${e.message}`);
    return;
  }
  const paths = out.split('\n').map(s => s.trim()).filter(Boolean);
  if (paths.length) {
    failures.push(
      `FAILED V11: ${paths.length} gitignored path(s) are TRACKED (a forced 'git add -f' of an ignored file). ` +
      `On the PUBLIC repo this PUBLISHES them at the next push: ${paths.join(', ')}. ` +
      `Fix: 'git rm --cached <path>' (keeps the local file) or correct .gitignore. ` +
      `Deliberate override: 'git commit --no-verify'.`);
  }
}

// V12 - the trifecta gate (2026-07-17, three-plan validation P3). Pure file checks, no network.
// The agent-security Rule-of-Two made a validated invariant. Each manifest project carries a
// `trifecta` block {private_data, untrusted_content, external_comm} (raw capability/exposure) + a
// `gate` (the mitigation). Rule: any project with ALL THREE legs true MUST declare a non-null gate
// from the vocab, and that gate string MUST appear on a `## Trifecta` line in its work/NN/CLAUDE.md.
// Any declared gate (even without all three) must be in the vocab and echoed in its CLAUDE.md.
// v1 DROPS the read-only-vs-write integrations assertion (F7, master res 8: the manifest carries no
// integrations data). meta.trifecta_doc holds the vocab + rules; vault/research/trifecta-map.md the map.
const TRIFECTA_GATES = new Set(['draft-only', 'human-posts', 'queue-only', 'read-only']);
function v12TrifectaGate({ stagedDir, manifest }, failures, warnings) {
  for (const p of manifest.projects) {
    const t = p.trifecta;
    if (!t) { warnings.push(`WARNING V12: project ${pad(p.num)} ${p.title} has no trifecta block - classify it in system/manifest.json`); continue; }
    const allThree = t.private_data && t.untrusted_content && t.external_comm;
    const hasGate = t.gate != null && t.gate !== '';
    // (a) all three legs true => a non-null gate is mandatory
    if (allThree && !hasGate) {
      failures.push(`FAILED V12: project ${pad(p.num)} ${p.title} has all three trifecta legs true but no gate - it MUST declare one of {${[...TRIFECTA_GATES].join(', ')}}`);
      continue;
    }
    // (b) any declared gate must be in the vocab
    if (hasGate && !TRIFECTA_GATES.has(t.gate)) {
      failures.push(`FAILED V12: project ${pad(p.num)} ${p.title} declares gate "${t.gate}" not in the vocab {${[...TRIFECTA_GATES].join(', ')}}`);
      continue;
    }
    // (c) a declared gate must appear in a `## Trifecta` section of the project's work/NN/CLAUDE.md
    if (hasGate) {
      if (!p.work_dir) { failures.push(`FAILED V12: project ${pad(p.num)} ${p.title} declares gate "${t.gate}" but has no work_dir to hold its ## Trifecta line`); continue; }
      const rel = p.work_dir.replace(/\\/g, '/') + '/CLAUDE.md';
      const cm = effective(stagedDir, rel);
      if (!cm) { failures.push(`FAILED V12: project ${pad(p.num)} ${p.title} declares gate "${t.gate}" but ${rel} was not found`); continue; }
      const sec = mdSection(cm.text, /^##\s+Trifecta\b/m);
      if (sec === null) { failures.push(`FAILED V12: ${rel} is missing a "## Trifecta" section (project ${pad(p.num)} declares gate "${t.gate}")`); continue; }
      // The gate must appear on a `Gate:` DECLARATION line, not merely somewhere in the section.
      // TIGHTENED 2026-07-29: this was `sec.includes(t.gate)`, a substring match over the whole
      // section, which any prose mention of a different gate word defeats. Found by negative-testing
      // the #31 reclassification: #31's section legitimately explains why the DRAFTING half (#32)
      // keeps `draft-only`, so flipping #31's declared gate to draft-only still PASSED - the check
      // could not tell a declaration from an explanation. Every spec already writes
      // `Gate: **<gate>**` (#28 writes `Gate: read-only` unbolded), so requiring the declaration line
      // costs nothing and closes the hole. Same principle as the CMD-HEADER work: assert the
      // structured claim, never free prose.
      const gateLine = sec.split(/\r?\n/).some(l =>
        new RegExp(`\\bGate:\\s*\\**\\s*${t.gate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(l));
      if (!gateLine) failures.push(`FAILED V12: the "## Trifecta" section of ${rel} has no "Gate: ${t.gate}" declaration line (a passing mention elsewhere in the section does not count, tightened 2026-07-29)`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// V13 - local wrapper model-pin contract (2026-07-25, stress-test fix F4). The LOCAL twin of V6.
//       V6 asserts n8n node models against meta.model_routing; V13 asserts the scheduled `claude -p`
//       wrappers under scripts/ against meta.model_routing.local_wrappers. Pure file reads, no
//       network, so it runs in EVERY context (generator + pre-commit) - unlike V6 which is async/
//       n8n-bound and SKIPs when n8n is unreachable. Root fix for "a wrapper omits --model and
//       inherits the global opus default" (the 2026-07-16 cost cut was convention-only until now).
//       COMPLETE by construction: every scripts/run-*.ps1 (+ auth-check.ps1) that makes a real
//       `claude -p` call MUST be in `pins` (with the matching model) or `deterministic_no_pin`
//       (makes no claude call), else FAIL - so a new/copied wrapper cannot slip through uncovered.
//       This is the bidirectional shape V2 uses for scheduled jobs, applied to the model contract.
// ---------------------------------------------------------------------------------------------
function v13LocalWrapperPins({ stagedDir, manifest }, failures, warnings) {
  const lw = manifest.meta && manifest.meta.model_routing && manifest.meta.model_routing.local_wrappers;
  if (!lw || !lw.pins) {
    warnings.push('WARNING V13: system/manifest.json meta.model_routing.local_wrappers.pins is not set - the local wrapper model-pin contract is unenforced (add it to enable V13)');
    return;
  }
  const pins = lw.pins;
  const detNoPin = new Set(lw.deterministic_no_pin || []);
  const scriptsDir = path.join(REPO, 'scripts');
  let files;
  try {
    files = fs.readdirSync(scriptsDir).filter(f => /^run-.*\.ps1$/.test(f) || f === 'auth-check.ps1');
  } catch (e) { failures.push(`FAILED V13: cannot read scripts/ to enforce the wrapper pin contract - ${e.message}`); return; }

  // The real reasoning-call line: a non-comment line that invokes claude (claude.ps1 / $ClaudeCmd /
  // a bare `claude`) with the -p prompt flag. (mcp-list warmups use `& claude.ps1 mcp list` with no
  // -p, so they are correctly ignored.)
  // HARDENED 2026-07-25 (stress-test T07/F-07): the original matcher required the `&` call operator
  // on the SAME single line, so a PowerShell backtick continuation or a `Start-Process`/bare-command
  // invocation evaded it silently. Two changes: (1) logical lines are joined across backtick
  // continuations and the `&` requirement is dropped; (2) COVERAGE no longer depends on this parser
  // at all - see the declaration-completeness rule below - so a future unparseable shape can cost a
  // model assertion but can never create an UNDECLARED wrapper.
  const logicalLines = text => {
    const out = [];
    let buf = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = buf === null ? raw : buf + ' ' + raw.trim();
      if (/`\s*$/.test(line)) { buf = line.replace(/`\s*$/, ''); continue; } // PS line continuation
      buf = null;
      out.push(line);
    }
    if (buf !== null) out.push(buf);
    return out;
  };
  const claudeCallLine = text => {
    for (const line of logicalLines(text)) {
      if (/^\s*#/.test(line)) continue;                        // skip comments
      if (!/claude/i.test(line)) continue;                     // names claude.ps1 / $ClaudeCmd / claude
      if (!/(^|\s)-p(\s|$)/.test(line)) continue;              // the prompt flag
      return line;
    }
    return null;
  };
  const modelOf = line => { const m = line.match(/--model\s+([A-Za-z0-9._-]+)/); return m ? m[1] : null; };

  for (const f of files) {
    const eff = effective(stagedDir, `scripts/${f}`);
    if (!eff) continue;
    const line = claudeCallLine(eff.text);
    const inPins = Object.prototype.hasOwnProperty.call(pins, f);
    const inDet = detNoPin.has(f);

    // COMPLETENESS, parser-independent (2026-07-25): every wrapper the glob finds MUST be declared,
    // whether or not a claude call is detected. This is what makes V13 complete by construction - a
    // new or copied wrapper cannot slip through on a call shape the matcher cannot read.
    if (!inPins && !inDet) {
      failures.push(`FAILED V13: scripts/${f} is in NEITHER meta.model_routing.local_wrappers.pins NOR deterministic_no_pin - every scheduled wrapper must be declared (an unlisted wrapper that calls claude inherits the global model default); add it to the contract`);
      continue;
    }
    if (inPins && inDet)
      failures.push(`FAILED V13: scripts/${f} is declared in BOTH pins and deterministic_no_pin - the contract must say exactly one`);

    if (line) {
      if (inDet)
        failures.push(`FAILED V13: scripts/${f} is declared deterministic_no_pin but makes a real 'claude -p' call - move it to pins with its model, or the flag is a bug`);
      if (!inPins) continue;
      const want = pins[f], got = modelOf(line);
      if (!got) failures.push(`FAILED V13: scripts/${f} 'claude -p' call has no --model (the contract wants ${want}; without it the wrapper inherits the global default)`);
      else if (got !== want) failures.push(`FAILED V13: scripts/${f} pins --model ${got} but meta.model_routing.local_wrappers wants ${want}`);
    } else if (inPins) {
      warnings.push(`WARNING V13: scripts/${f} is in local_wrappers.pins but has no 'claude -p' call - stale pin entry (remove it, or the wrapper lost its reasoning call)`);
    }
  }
  for (const f of Object.keys(pins)) if (!files.includes(f)) failures.push(`FAILED V13: local_wrappers.pins names scripts/${f} which does not exist`);
  for (const f of detNoPin) if (!files.includes(f)) warnings.push(`WARNING V13: local_wrappers.deterministic_no_pin names scripts/${f} which does not exist`);
}

// V14 - Alex gender-neutrality contract (2026-07-28, Shaheen's standing voice law: "I do not want
//       to give Alex a gender, I want you to not use HE/HIM at all"). The code behind work/12
//       HARD RULE 15 and the soul.md My Words entry of the same date.
//
//       WHY IT EXISTS: the rule was actually first called on 2026-07-05 (see templates/
//       architecture.template.md and docs/ARCHITECTURE.md) and NOTHING enforced it, so episodes 02
//       to 06 published with "he" anyway. A convention that only an agent remembers to run is not a
//       gate. This is the same lesson as V6: expectations live as DATA and are machine-checked, not
//       as prose someone is trusted to have read.
//
//       TWO NARROW SCANS, deliberately not one blanket sweep:
//       (a) EPISODE BODIES of drafts that are NOT yet published. In a Building Alex post body the
//           only two characters are Shaheen (I/my) and Alex, so ANY third-person gendered pronoun
//           there is a real violation. High precision by construction.
//       (b) THE PINNED LOCKED LINE wherever it appears in the series governance files, matched by
//           its own shape rather than by a blanket pronoun sweep.
//
//       WHAT IT DELIBERATELY DOES NOT TOUCH, and these exclusions are the whole reason it is two
//       narrow scans instead of one broad one:
//       - PUBLISHED episodes (header line carries `status: published`). They are the archive of what
//         actually went out on LinkedIn; retro-editing them would make the archive lie.
//       - The governance files' PROSE, which legitimately contains he/him as SPECIMENS while stating
//         the rule (HARD RULE 15 quotes the very regex it enforces). Mention is not use. A blanket
//         scan here would flag the rule for stating itself, exactly as a naive dash scan would flag
//         HARD RULE 2 for quoting the two dash characters it bans.
const V14_EPISODES_DIR = 'work/12-linkedin-series/episodes';
const V14_PRONOUN_RE = /\b(he|him|his|himself|she|her|hers|herself)\b/i;
// The locked line carrying a gender, in any of its pinned punctuations. Matches the DEFECT only.
const V14_LOCKED_GENDERED_RE = /rule\s+(?:he|she)\s+never\s+breaks|(?:his|her)\s+training\s+data/i;
const V14_GOVERNANCE = [
  'work/12-linkedin-series/CLAUDE.md',
  'vault/projects/linkedin-series/concept.md',
  'vault/projects/linkedin-series/build-prompt.md',
  'vault/projects/linkedin-series/posts-5-12-plan.md',
  'soul.md',
];

// ---------------------------------------------------------------------------------------------
// V15 - command-file state/trigger headers (2026-07-28, command-layer review F-3/F-4/F-6/F-11).
//       Every LIVE/EVENT command file must carry the GENERATED CMD-HEADER block, byte-matching what
//       scripts/lib/gen-command-headers.js renders from system/manifest.json.
//
//       WHY: the read-pass found SIX command files contradicting the registry on trigger, schedule,
//       method or source of truth. Distribution was the evidence - every surface with a checker agreed
//       with reality, the one large prose surface without one drifted six times. check.ps1 C1/C2 and
//       V7 do read .claude/commands, but only for file EXISTENCE, ownership and NAMES; nothing read
//       content. Concretely: /application-engine claimed "daily at 07:00" while #03 runs Tue+Thu 15:00,
//       and since that command's own job is to report zero-job days, it manufactured five false alarms
//       a week inside the one report built to surface real ones.
//
//       DIRECTION (the V6 lesson): this does NOT parse prose and infer intent. The manifest renders the
//       block; the file is asserted to contain that exact block. Expectation comes from structured data,
//       never from the doc under test.
//
//       TIER: WARNING for its first cycle by design. An ERROR-tier check with a false positive blocks
//       the nightly 21:30 commit and pushes the backup RED, so it observes before it blocks. Promote by
//       moving the push below from `warnings` to `failures`.
// ---------------------------------------------------------------------------------------------
function v15CommandHeaders({ stagedDir, manifest }, failures, warnings) {
  let genCmdHeaders;
  try { genCmdHeaders = require('./lib/gen-command-headers'); }
  catch (e) { warnings.push(`WARNING V15 SKIPPED: gen-command-headers module unavailable (${e.message})`); return; }

  const missing = [], stale = [];
  for (const t of genCmdHeaders.targets(manifest)) {
    const f = effective(stagedDir, t.rel);
    if (!f) continue; // C1 already fails a declared-but-absent command file; V15 does not double-report
    const want = genCmdHeaders.block(t);
    const bi = f.text.indexOf(genCmdHeaders.BEGIN), ei = f.text.indexOf(genCmdHeaders.END);
    if (bi === -1 || ei === -1) { missing.push(t.rel); continue; }
    const have = f.text.slice(bi, ei + genCmdHeaders.END.length);
    if (have !== want) stale.push(`${t.rel} (state/trigger no longer matches #${t.project.num} in the registry)`);
  }
  if (missing.length)
    warnings.push(`WARNING V15: LIVE/EVENT command file(s) missing the generated CMD-HEADER block: ${missing.join(', ')} - run 'node scripts/generate-alex.js'`);
  if (stale.length)
    warnings.push(`WARNING V15: command header(s) drifted from system/manifest.json: ${stale.join('; ')} - run 'node scripts/generate-alex.js' (never hand-edit between the markers)`);
}

function v14AlexGenderNeutrality({ stagedDir }, failures, warnings) {
  // (a) unpublished episode drafts - scan the POST BODY only, never the provenance header.
  const dir = path.join(REPO, V14_EPISODES_DIR);
  if (!fs.existsSync(dir)) {
    warnings.push(`WARNING V14 SKIPPED: ${V14_EPISODES_DIR} not found - the episode gender scan did not run`);
  } else {
    for (const abs of listFiles(dir)) {
      if (!abs.endsWith('.md')) continue;
      const rel = path.relative(REPO, abs).replace(/\\/g, '/');
      const raw = effective(stagedDir, rel);
      if (!raw) continue;
      const parts = raw.text.split(/\r?\n---\r?\n/);
      if (parts.length < 2) continue;              // no header/body split (plan.md etc.) - not an episode
      const header = parts[0];
      if (/^\s*status:\s*published/im.test(header)) continue;   // ARCHIVE - never scanned, never edited
      const body = parts.slice(1).join('\n---\n');
      const lines = body.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(V14_PRONOUN_RE);
        if (!m) continue;
        failures.push(
          `FAILED V14: ${rel} post body line ${i + 1} uses "${m[0]}" - Alex has no gender ` +
          `(work/12 HARD RULE 15). Use the name plus sentence restructuring; "it" is not a ` +
          `substitute. If the pronoun refers to a real third person and not to Alex, rephrase ` +
          `to name them, because a post body cannot distinguish the two: ${lines[i].trim().slice(0, 90)}`
        );
      }
    }
  }

  // (b) the pinned locked line, matched by its defect shape so the rule may still quote itself.
  for (const rel of V14_GOVERNANCE) {
    const raw = effective(stagedDir, rel);
    if (!raw) { warnings.push(`WARNING V14: ${rel} not found - cannot check the pinned locked line`); continue; }
    const lines = raw.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!V14_LOCKED_GENDERED_RE.test(lines[i])) continue;
      failures.push(
        `FAILED V14: ${rel}:${i + 1} carries the locked line in its PRE-2026-07-28 gendered form. ` +
        `The canonical wording is "every correction becomes a rule Alex never breaks again, my ` +
        `mistakes are Alex's training data." Both possessives are load-bearing; never soften ` +
        `"Alex's training data" to "the training data".`
      );
    }
  }
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
  if (manifest) v9FirstFireAging({ stagedDir, manifest }, failures, warnings);
  v10ProtectedFileGuard({ context, changed }, failures, warnings); // commit-time only (no-op otherwise)
  v11IgnoredStagedGuard({ context, changed }, failures, warnings); // commit-time only (no-op otherwise)
  if (manifest) v12TrifectaGate({ stagedDir, manifest }, failures, warnings); // trifecta gate (every run)
  if (manifest) v13LocalWrapperPins({ stagedDir, manifest }, failures, warnings); // local wrapper model-pin contract (every run)
  v14AlexGenderNeutrality({ stagedDir }, failures, warnings); // Alex has no gender (every run; no manifest needed)
  if (manifest) v15CommandHeaders({ stagedDir, manifest }, failures, warnings); // command-file state/trigger headers (WARN-tier for now)

  for (const w of warnings) console.error(w);
  for (const f of failures) console.error(f);
  if (failures.length === 0)
    console.log(`validate-alex: ${SUITE_RANGE} PASS (context=${context}${warnings.length ? `, ${warnings.length} warning(s) - see above` : ''})`);
  return { ok: failures.length === 0, failures, warnings, range: SUITE_RANGE };
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

module.exports = { runAll, evaluateProtectedChangeset, V10_PROTECTED, readStagedChangeset, SUITE_RANGE, V_MAX };
