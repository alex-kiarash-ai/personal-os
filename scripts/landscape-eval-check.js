#!/usr/bin/env node
// landscape-eval-check.js - three-plan validation P4, 2026-07-17. The deterministic overlap guard for the
// #25 weekly eval. Given the saved digest + overlaps.json (written by landscape-eval.js), it FAILS (exit 1)
// if any platform item the pre-scan flagged as OVERLAPPING a project was silently dropped - i.e. resolved
// to NEITHER ## Recommended nor ## Skip. The model cannot police itself (work/25's no-model-verifier-chains
// guardrail); this is code. The wrapper runs it after saving the digest; a failure pushes RED + close-out RED.
'use strict';
const fs = require('fs');
const [, , digestPath, overlapsPath] = process.argv;
if (!digestPath || !overlapsPath) {
  console.error('usage: landscape-eval-check.js <digest.md> <overlaps.json>');
  process.exit(2);
}
let overlaps = [];
try { overlaps = JSON.parse(fs.readFileSync(overlapsPath, 'utf8')); }
catch { console.log('overlap-check: no overlaps.json / not readable - nothing to enforce (PASS)'); process.exit(0); }
if (!Array.isArray(overlaps) || overlaps.length === 0) {
  console.log('overlap-check: 0 platform overlaps this week - PASS');
  process.exit(0);
}
let digest = '';
try { digest = fs.readFileSync(digestPath, 'utf8'); }
catch (e) { console.error('overlap-check: FAILED - cannot read digest: ' + e.message); process.exit(1); }

// Resolution region = from "## Recommended" to "## Skills auto-installing" (the heading after Skip), or to
// EOF if that heading is absent. An overlap is RESOLVED if its item text (whitespace-normalized) OR any of
// its shared tokens appears in that region. Lenient toward the model's phrasing, strict about silent drops.
const norm = s => String(s).toLowerCase().replace(/\s+/g, ' ');
const dn = norm(digest);
const recIdx = dn.indexOf('## recommended');
let region;
if (recIdx < 0) region = dn; // malformed digest (no Recommended heading) - use whole body, still catches drops
else {
  const end = dn.indexOf('## skills auto-installing', recIdx);
  region = end < 0 ? dn.slice(recIdx) : dn.slice(recIdx, end);
}

const unresolved = [];
for (const o of overlaps) {
  const itemN = norm(o.item || '').trim();
  const inItem = itemN && region.includes(itemN);
  const inTok = Array.isArray(o.tokens) && o.tokens.some(t => region.includes(String(t).toLowerCase()));
  if (!inItem && !inTok) unresolved.push(o);
}
if (unresolved.length) {
  console.error(`overlap-check: FAILED - ${unresolved.length} platform overlap(s) NOT resolved to Recommend/Skip:`);
  for (const o of unresolved) console.error(`  - "${o.item}" (overlaps ${(o.projects || []).join(', ')})`);
  console.error('The weekly digest must resolve every flagged platform overlap. Fix the digest or the eval prompt.');
  process.exit(1);
}
console.log(`overlap-check: PASS - all ${overlaps.length} platform overlap(s) resolved to Recommend/Skip`);
process.exit(0);
