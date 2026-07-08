#!/usr/bin/env node
// validate-alex.js - the validation layer (Layer 6). PHASE 3 DELIVERABLE.
//
// PHASE 1 STATE: working SKELETON. It runs the structural guards only and prints
// "V1-V6 pending Phase 3". The six real checks (V1 automation count, V2 scheduled jobs vs live
// Task Scheduler, V3 no retired-as-live, V4 MCP consistency, V5 tokens-not-stray-hexes softened
// per A5, V6 model routing vs the live n8n API per A3) land in Phase 3 in THIS file, behind the
// same runAll() entry point, so the generate-alex.js wiring does not change.
//
// Contract with generate-alex.js (the orchestration contract, step 3):
//   const { runAll } = require('./validate-alex');
//   const result = runAll({ stagedDir });   // stagedDir = .staging/ (absolute)
//   result = { ok: boolean, failures: [ 'FAILED Gx: ...' ] }
// A file present in stagedDir is validated as the ABOUT-TO-SHIP version; for files not staged the
// current repo copy is checked. Any failure -> the caller deletes staging and touches nothing real.
//
// Standalone CLI:  node scripts/validate-alex.js [--staged=DIR]
// Exit 0 = pass, 1 = fail (names exactly what is wrong and where).
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const PLACEHOLDER_RE = /\{\{[A-Z0-9_]+\}\}/g; // must match render-templates.js
const RT_BEGIN = '<!-- ROUTING-TABLE:BEGIN';
const RT_END = '<!-- ROUTING-TABLE:END -->';
const CZ_START = '<!-- CUSTOM_START -->';
const CZ_END = '<!-- CUSTOM_END -->';
const PT_BEGIN = '<!-- PROJECT-TABLE:BEGIN';
const PT_END = '<!-- PROJECT-TABLE:END -->';

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

function runAll({ stagedDir } = {}) {
  const failures = [];

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

  for (const f of failures) console.error(f);
  if (failures.length === 0) console.log('validate-alex: structural guards G1-G4 PASS');
  console.log('validate-alex: V1-V6 pending Phase 3');
  return { ok: failures.length === 0, failures };
}

if (require.main === module) {
  const stagedArg = process.argv.find(a => a.startsWith('--staged='));
  const stagedDir = stagedArg ? path.resolve(stagedArg.split('=')[1]) : path.join(REPO, '.staging');
  const { ok } = runAll({ stagedDir: fs.existsSync(stagedDir) ? stagedDir : undefined });
  process.exit(ok ? 0 : 1);
}

module.exports = { runAll };
