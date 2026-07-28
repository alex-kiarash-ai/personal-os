#!/usr/bin/env node
'use strict';
/*
 * scripts/facts-check.js - recovery check C21: standing DOCS tested against the bi-temporal fact
 * ledger (system/recall/facts.db). The Recall Spine's rent-payer (upgrade plan Phase 1.3).
 *
 * DIRECTION (this is the whole point): the DOC is the test SUBJECT; facts.db is the EXPECTATION. A
 * doc that claims a value the ledger disproves is flagged. This does NOT reintroduce the V6
 * anti-pattern (deriving an expectation FROM prose): facts.db is derived from STRUCTURED sources
 * (manifest, validate-alex.js registry, check.ps1 headers, schtasks, skills-lock, the attestation
 * file), and the prose is checked against THAT. The ST-20 / FR-04 "a doc lying about the system"
 * class becomes one deterministic diff.
 *
 * NON-DUPLICATION NOTE: the plan (2026-07-24) had C20 re-enter the out-of-repo ALEX-OS-master.md +
 * plain-English guide into enforcement. The 2026-07-25 stress-test fix F2 ALREADY did that: C19
 * (narrative-drift-check.py) was repointed to the manifest's master path and now derives its claim
 * set from ground truth (check count, V count, project count, escrow date). So C21 does NOT duplicate
 * the master-doc numeric claims (that would create two checks fighting over one doc). C21 owns the
 * COMPLEMENTARY, IN-REPO prose-vs-structured-truth surface C19 never touches. The map grows the same
 * way C19's does: each new claim is one {doc-regex + fact} row.
 *
 * Renumbered C21 (not the plan's C20): C20 was taken by the 07-25 F1 backup-destinations check.
 *
 * Exit 0 = consistent - 2 = drift found (one line per finding) - 1 = could not compute.
 *   node scripts/facts-check.js               harvest fresh, then check
 *   node scripts/facts-check.js --no-harvest  check against facts.db as-is (nightly chain already ran harvest)
 */
const fs = require('fs');
const path = require('path');
const { openDb, REPO } = require('../system/recall/lib/db');
const { currentFact } = require('../system/recall/lib/facts');

// The assertion map: each row is a standing doc claim tested against one (subject,predicate) fact.
// `optional: true` -> a missing doc/absent value is skipped, not a finding.
// `mode`: 'equals' (extracted value must equal the fact) | 'contains' (the fact object must appear in
// the doc; guards a manifest-side change not propagated into prose).
const ASSERTIONS = [
  {
    name: 'recovery-check-count',
    doc: 'work/18-recovery-layer/CLAUDE.md',
    regex: /The checks \((\d+) total/,
    subject: 'recovery-checker', predicate: 'check_count', mode: 'equals',
    why: 'the in-repo recovery-layer doc must not misstate how many C-checks the code runs (ST-20 class)',
  },
  {
    name: 'model-routing-default-in-root',
    doc: 'CLAUDE.md',
    // The default model string must appear in the model-routing section of root CLAUDE.md; if the
    // manifest default changed and prose wasn't propagated, the new string is absent -> flag.
    section: /## Model Routing in n8n Workflows[\s\S]*?(?=\n## )/,
    subject: 'model-routing', predicate: 'default', mode: 'contains',
    why: 'root CLAUDE.md model-routing prose must name the current manifest default model',
  },

  // --- vault/identity.md, added 2026-07-25 (stress-test finding F-01) ------------------------------
  // identity.md is the file a fresh clone reads FIRST after a laptop loss, and it was wrong on six
  // load-bearing claims at once while NOTHING checked it: C19 watches the out-of-repo master, C21 only
  // watched two in-repo claims, and identity.md is gitignored so no git-based check ever sees it. The
  // volatile facts it used to restate are now pointers (see its POINTER DISCIPLINE header); the few
  // numbers genuinely worth stating in a restore doc are asserted HERE instead, so they cannot re-rot.
  {
    name: 'identity-recovery-check-count',
    doc: 'vault/identity.md',
    regex: /\*\*(\d+) checks C1-C\d+\*\*/,
    subject: 'recovery-checker', predicate: 'check_count', mode: 'equals',
    why: 'the restore map must not misstate how many C-checks the recovery sweep runs',
  },
  {
    name: 'identity-scheduled-job-count',
    doc: 'vault/identity.md',
    regex: /\*\*(\d+) registered jobs\*\*/,
    subject: 'scheduler', predicate: 'registered_job_count', mode: 'equals',
    why: 'a restore has to re-create every scheduled job, so a wrong count here means a job is quietly never rebuilt',
  },
  {
    name: 'identity-skills-count',
    doc: 'vault/identity.md',
    regex: /\*\*(\d+) skills PROJECT-SCOPED in-repo\*\*/,
    subject: 'skills', predicate: 'count', mode: 'equals',
    why: 'the skills-store count said 29/30 for 11 days while three owner-approved packs had taken it to 82',
  },
  {
    name: 'identity-escrow-attested',
    doc: 'vault/identity.md',
    regex: /escrow drill re-passed (\d{4}-\d{2}-\d{2})/,
    subject: 'escrow', predicate: 'attested', mode: 'equals',
    why: 'recoverability is the one claim that must never be optimistic: the date here must equal the attestation file',
  },
];

function readDoc(p) {
  const abs = path.isAbsolute(p) ? p : path.join(REPO, p);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--no-harvest')) {
    try {
      require('../system/recall/lib/harvest-core').runHarvest();
    } catch (e) {
      console.error(`facts-check: harvest failed (${e.message}); checking against existing facts.db`);
    }
  }

  let db;
  try { db = openDb(true); } catch (e) {
    console.error(`facts-check: cannot open facts.db (${e.message}) - run the harvest first`);
    return 1;
  }

  const findings = [];
  for (const a of ASSERTIONS) {
    const fact = currentFact(db, a.subject, a.predicate);
    if (!fact) {
      if (!a.optional) findings.push(`no current fact for ${a.subject}/${a.predicate} (harvester gap) - cannot verify "${a.name}"`);
      continue;
    }
    let text = readDoc(a.doc);
    if (text == null) {
      if (!a.optional) findings.push(`doc missing for "${a.name}": ${a.doc}`);
      continue;
    }
    if (a.section) {
      const sm = text.match(a.section);
      if (!sm) { findings.push(`section not found in ${a.doc} for "${a.name}"`); continue; }
      text = sm[0];
    }
    if (a.mode === 'contains') {
      if (!text.includes(String(fact.object))) {
        findings.push(`${a.doc}: prose does not mention the current ${a.subject}/${a.predicate} = "${fact.object}" (source ${fact.source}). ${a.why}`);
      }
    } else { // equals
      const m = text.match(a.regex);
      if (!m) { findings.push(`${a.doc}: could not locate the "${a.name}" claim (regex ${a.regex}) to verify against ${a.subject}/${a.predicate}=${fact.object}`); continue; }
      if (String(m[1]) !== String(fact.object)) {
        findings.push(`${a.doc}: claims "${m[0].trim()}" but ${a.subject}/${a.predicate} = ${fact.object} (source ${fact.source}). ${a.why}`);
      }
    }
  }
  db.close();

  if (findings.length) { findings.forEach((f) => console.log(f)); return 2; }
  console.log(`facts-check C21: ${ASSERTIONS.length} doc claim(s) consistent with facts.db`);
  return 0;
}

process.exit(main());
