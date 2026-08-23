#!/usr/bin/env node
'use strict';
/*
 * scripts/findings-gate.js - the fail-closed aggregation gate for relay QC. (P4.3, run-47 plan.)
 *
 * WHERE IT CAME FROM. ECC's `workflows/orch-review.workflow.js` is the one genuinely coded artifact
 * in that repo, and it does the step Alex has always done by attention: aggregate multi-lane findings
 * and decide what survives. Its mechanics were read verbatim and re-derived here in Alex's own
 * discipline (zero dependencies, no ECC code). The three rules worth stealing:
 *   1. A serious finding is only cleared by an ADVERSARIAL verifier that actively refutes it.
 *   2. Refutation needs CONFIDENCE. Below the floor the finding stays blocking, because "probably
 *      fine" is not a refutation.
 *   3. Everything unknown FAILS CLOSED. A verifier that errored, returned nothing, or never ran
 *      leaves the finding blocking; a lane that died makes the whole run INCOMPLETE. Silence is
 *      never consent.
 *
 * WHY ALEX NEEDS IT. The master's own history is the argument: run 44's value was that all three
 * review passes overturned something real, and run 47 caught its own dossier number wrong. Those
 * catches depended on a careful master, not a mechanism, and "the finding nobody could refute got
 * quietly dropped in synthesis" is a failure that leaves no trace.
 *
 * ADVISORY BY DEFAULT, exactly the close-out-grader's stance: it prints a verdict the master must
 * acknowledge, and only --strict makes it exit nonzero. A gate that blocks before it has earned
 * trust gets worked around, which is worse than no gate.
 *
 * INPUT: a JSON or JSONL findings file. One object per finding:
 *   { "id": "F-1", "lane": "security", "severity": "CRITICAL|HIGH|MEDIUM|LOW",
 *     "claim": "...", "evidence": "file:line or URL",
 *     "verdict": { "isReal": true|false, "confidence": 0.0-1.0, "reasoning": "..." },   // optional
 *     "laneFailed": false }                                                             // optional
 *
 *   node scripts/findings-gate.js <file> [--strict] [--json]
 */
const fs = require('fs');

const REFUTE_MIN_CONFIDENCE = 0.8;   // ECC's value, adopted deliberately: it is a real threshold
const BLOCKING = new Set(['CRITICAL', 'HIGH']);
const RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const STRICT = args.includes('--strict');
const JSON_OUT = args.includes('--json');

function load(p) {
  const raw = fs.readFileSync(p, 'utf8').trim();
  if (!raw) return [];
  if (raw[0] === '[') return JSON.parse(raw);
  return raw.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}

/* Dedup by normalized EVIDENCE anchor (P4.2's convergence law in code): the same defect found by two
 * lanes is ONE finding at the strictest severity, and the fact that independent lanes converged on it
 * is the highest-confidence signal this pipeline produces, so it is recorded rather than collapsed. */
function dedupe(findings) {
  const byAnchor = new Map();
  for (const f of findings) {
    const key = String(f.evidence || f.claim || f.id || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key) { byAnchor.set(Symbol('anon'), { ...f, lanes: [f.lane].filter(Boolean) }); continue; }
    const prev = byAnchor.get(key);
    if (!prev) { byAnchor.set(key, { ...f, lanes: [f.lane].filter(Boolean) }); continue; }
    const strongest = (RANK[String(f.severity).toUpperCase()] || 0) > (RANK[String(prev.severity).toUpperCase()] || 0) ? f.severity : prev.severity;
    prev.severity = strongest;
    if (f.lane && !prev.lanes.includes(f.lane)) prev.lanes.push(f.lane);
    // A verdict that actually ran beats an absent one; never let a missing verdict clear a finding.
    if (!prev.verdict && f.verdict) prev.verdict = f.verdict;
  }
  return [...byAnchor.values()];
}

function classify(f) {
  const sev = String(f.severity || 'MEDIUM').toUpperCase();
  if (!BLOCKING.has(sev)) return { state: 'advisory', why: `${sev} is not a blocking severity` };
  const v = f.verdict;
  if (!v) return { state: 'blocking', why: 'never verified - no adversarial pass ran' };
  if (v.isReal === false && Number(v.confidence ?? 0) >= REFUTE_MIN_CONFIDENCE) {
    return { state: 'refuted', why: `refuted at confidence ${v.confidence}` };
  }
  if (v.isReal === false) return { state: 'blocking', why: `refutation too weak (confidence ${v.confidence ?? 0} < ${REFUTE_MIN_CONFIDENCE})` };
  if (v.isReal === true) return { state: 'blocking', why: 'verifier CONFIRMED it' };
  return { state: 'blocking', why: 'verifier returned no usable verdict' };
}

function main() {
  if (!file) { console.error('usage: findings-gate.js <findings.json|.jsonl> [--strict] [--json]'); return 2; }
  let findings;
  try { findings = load(file); }
  catch (e) { console.error(`findings-gate: unreadable input (${e.message}) - REJECTING. Malformed input is never an approval.`); return 2; }

  const merged = dedupe(findings);
  const laneFailures = merged.filter((f) => f.laneFailed);
  const rows = merged.map((f) => ({ ...f, ...classify(f) }));
  const blocking = rows.filter((r) => r.state === 'blocking');
  const converged = rows.filter((r) => (r.lanes || []).length > 1);
  const incomplete = laneFailures.length > 0;
  const verdict = (blocking.length || incomplete) ? 'CHANGES_REQUESTED' : 'APPROVE';

  if (JSON_OUT) {
    console.log(JSON.stringify({ verdict, blocking: blocking.length, advisory: rows.length - blocking.length, converged: converged.length, incomplete, rows }, null, 2));
  } else {
    console.log(`findings-gate: ${findings.length} finding(s) -> ${merged.length} after evidence-anchor dedup`);
    for (const r of rows) {
      const mark = r.state === 'blocking' ? 'BLOCK ' : r.state === 'refuted' ? 'refuted' : 'advisory';
      const conv = (r.lanes || []).length > 1 ? `  [CONVERGED: ${r.lanes.join(' + ')}]` : '';
      console.log(`  ${mark} ${String(r.severity || '').toUpperCase().padEnd(8)} ${r.id || '(no id)'} - ${r.why}${conv}`);
    }
    if (incomplete) console.log(`  INCOMPLETE: ${laneFailures.length} lane(s) failed - an errored lane is not a clean lane`);
    if (converged.length) console.log(`  ${converged.length} finding(s) reached independently by more than one lane (top confidence tier)`);
    console.log(`VERDICT: ${verdict}${STRICT ? '' : '  (advisory - rerun with --strict to make this exit nonzero)'}`);
  }
  return (STRICT && verdict !== 'APPROVE') ? 2 : 0;
}

process.exit(main());
