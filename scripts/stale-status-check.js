#!/usr/bin/env node
'use strict';
/*
 * scripts/stale-status-check.js - propagation debt, surfaced at GENERATION time.
 *
 * WHY (stress-test finding F-02, 2026-07-25): the Close-Out Gate's core invariant is "nothing is done
 * until every connected file agrees", and recovery check C8 is the machine that proves it (a work spec
 * whose hash moved since the last -Init while its vault status.md hash did NOT = the spec changed and
 * the status was never propagated). But C8 only runs in the WEEKLY Monday sweep. So the 2026-07-25
 * per-project upgrade batch edited 12 work specs, verified itself with the validators + a generator
 * dry-run + the narrative-drift check - none of which read status.md - and closed as "verified" while
 * EIGHT projects sat spec-changed-status-stale for four days until the sweep caught them.
 *
 * This is the same compare, available on the path a session actually runs (the generator, wired as an
 * ADVISORY step beside the prompt-regression check), so propagation debt is named the same day it is
 * created instead of four days later.
 *
 * ADVISORY BY DESIGN. Propagation is a judgment act a human finishes (what the status.md should now
 * say is not derivable), so this NAMES the debt and never fails a build. It reads the SAME
 * work/18-recovery-layer/state/baseline.json that C8 reads - one baseline, two readers, so the two can
 * never disagree about what "since the last -Init" means.
 *
 * Exit codes: 0 = clean or advisory (default) - 2 = debt found, only with --strict.
 *   node scripts/stale-status-check.js              human-readable, exit 0/2
 *   node scripts/stale-status-check.js --advisory   one-line summary, ALWAYS exit 0 (generator step 3c)
 *   node scripts/stale-status-check.js --json       machine-readable
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const BASELINE = path.join(REPO, 'work', '18-recovery-layer', 'state', 'baseline.json');
const MANIFEST = path.join(REPO, 'system', 'manifest.json');

const ADVISORY = process.argv.includes('--advisory');
const JSON_OUT = process.argv.includes('--json');
const STRICT = process.argv.includes('--strict');

// Hashing lives in ONE place now (bash migration Phase 5, 2026-08-05). This file used to carry its
// own copy, kept in agreement with check.ps1's Get-Sha by a comment; the migration plan named that
// duplication as evidence the checker belonged in Node. check.mjs imports the same module, so there
// is one implementation instead of two agreeing by convention. sameHash() is case-insensitive
// because pre-migration baselines hold UPPERCASE digests (W22).
const { sha, sameHash, readJsonBomSafe } = require('./lib/repo-hash');

function main() {
  if (!fs.existsSync(BASELINE)) {
    const msg = 'no baseline yet (run `check.mjs --init` once) - propagation debt cannot be computed';
    if (JSON_OUT) console.log(JSON.stringify({ ok: true, reason: 'no-baseline', stale: [] }));
    else console.log(`stale-status: ${msg}`);
    return 0;
  }
  const bl = readJsonBomSafe(BASELINE);
  const manifest = readJsonBomSafe(MANIFEST);
  if (!bl.status_hashes) {
    if (JSON_OUT) console.log(JSON.stringify({ ok: true, reason: 'baseline-has-no-status-hashes', stale: [] }));
    else console.log('stale-status: baseline carries no status_hashes (re-run `check.mjs --init`)');
    return 0;
  }

  const stale = [];
  for (const p of manifest.projects) {
    const specPath = path.join(REPO, String(p.work_dir || '').replace(/\//g, path.sep), 'CLAUDE.md');
    const statusPath = p.status_md ? path.join(REPO, String(p.status_md).replace(/\//g, path.sep)) : null;
    if (!statusPath) continue;
    const curSpec = sha(specPath), curStatus = sha(statusPath);
    const oldSpec = bl.hashes ? bl.hashes[String(p.num)] : null;
    const oldStatus = bl.status_hashes[String(p.num)];
    if (!oldSpec || !curSpec || !oldStatus || !curStatus) continue;   // nothing to compare (same as C8)
    // sameHash, not !==: a pre-migration baseline holds UPPERCASE digests while sha() now returns
    // lowercase, so a raw string compare would report EVERY project as spec-changed (W22).
    if (!sameHash(curSpec, oldSpec) && sameHash(curStatus, oldStatus))
      stale.push({ num: p.num, name: p.name, spec: `${p.work_dir}/CLAUDE.md`, status: p.status_md });
  }

  if (JSON_OUT) { console.log(JSON.stringify({ ok: stale.length === 0, stale })); return stale.length ? 2 : 0; }

  if (stale.length === 0) {
    console.log(`stale-status: CLEAN (0 of ${manifest.projects.length} projects have a spec change with an unpropagated status.md)`);
    return 0;
  }
  const names = stale.map(s => `#${s.num} ${s.name}`).join(', ');
  if (ADVISORY) {
    console.log(`${stale.length} project(s) have a CLAUDE.md change since the last -Init with NO status.md update: ${names}`);
    console.log('propagate into each status.md (Close-Out B), then re-run `node work/18-recovery-layer/check.mjs --init`. Recovery C8 reports the same debt on Monday.');
  } else {
    console.log(`stale-status: ${stale.length} propagation gap(s) - spec changed since the last -Init, status.md did not:`);
    for (const s of stale) console.log(`  #${s.num} ${s.name}: ${s.spec} moved, ${s.status} did not`);
    console.log('Fix: propagate the real change into each status.md, then re-run `node work/18-recovery-layer/check.mjs --init`.');
  }
  return STRICT ? 2 : (ADVISORY ? 0 : 2);
}

try { process.exit(main()); }
catch (e) {
  console.error(`stale-status: ERROR ${e.message}`);
  process.exit(ADVISORY ? 0 : 1);   // advisory must never break a generator run
}
