// gen-scheduler.js - scheduler/schedule.md -> the machine's scheduler (refactor P1-S3).
//
// BASH MIGRATION 2026-08-05: this file used to describe itself as "the ONLY PowerShell/Windows
// touchpoint in the generator". That is now true of the systemd backend instead, and this file is
// the dispatcher. The generator was built cross-platform in 2026-07-08 (decision D11: "Node ... it
// is cross-platform. PowerShell is invoked ONLY as a subprocess for Windows Task Scheduler
// registration"); swapping that subprocess for systemd is the completion of a decision the repo
// already made, not a new direction.
//
// Job-naming is unchanged and stays unchanged deliberately (W11): PersonalOS-{name}, each running a
// hardened wrapper scripts/run-{name}.sh, never a bare `claude -p`. Recovery check C7 compares
// documented names to live names, so preserving them keeps C7 meaningful across the migration.
//
// Idempotence + safety contract, identical on both backends:
//   - dry-run (apply=false): parse the documented PersonalOS-* job set from scheduler/schedule.md,
//     query the live set, report missing / unknown / matched. No writes to the scheduler.
//   - apply: creates ONLY jobs that are documented but not registered. It NEVER touches an existing
//     job: live jobs carry hand-applied hardening that re-creation would silently wipe, which is a
//     documented past incident class, so "leave existing jobs alone" is a hard rule here.
//   - PersonalOS-retry-* one-shots are ephemeral by design and excluded on both sides (same as
//     recovery check C7).
//
// PLATFORM GUARD (ruling C): on a machine with no systemd - this dev box is Windows - the LIVE half
// cannot run. It degrades to a LOUD SKIP: never a silent no-op (which would let real drift hide),
// never a crash (which would break `generate-alex.js` on the machine where it is edited). Unit
// GENERATION still happens there, on purpose, so the units are reviewable in git before deploy.
'use strict';
const fs = require('fs');
const path = require('path');
const systemd = require('./gen-systemd');

const REPO = path.join(__dirname, '..', '..');

// Live PersonalOS-* job names, from whichever scheduler this machine actually has.
function liveJobs() {
  return systemd.liveJobs();
}

// Kept as a named export because validate-alex V2 and the tests import it. Delegates to the
// systemd expression builder; the schtasks argument-array form is gone with the .ps1 files.
function parseFrequency(freq) {
  return systemd.parseFrequency(freq);
}

async function run({ schedule, apply, log }) {
  const documented = schedule.allJobNames;

  // Generation is platform-independent and always runs: the units are a git artifact.
  const gen = systemd.generateUnits({ schedule, log });

  if (!systemd.hasSystemd()) {
    log(
      `  scheduler: LIVE CHECK SKIPPED - no systemd on this machine (platform=${process.platform}). ` +
        `${documented.length} jobs documented, ${gen.written.length} unit pairs written to systemd/. ` +
        'This is expected on a dev box without systemd (ruling C: dev here, run on Linux); on the Linux ' +
        'host it means systemd is unreachable and the scheduler is UNVERIFIED.'
    );
    return {
      documented,
      live: [],
      missing: [],
      unknown: [],
      matched: [],
      applied: [],
      skippedLive: true,
      units: gen,
    };
  }

  const live = systemd.liveJobs();
  const liveSet = new Set(live);
  const docSet = new Set(documented);
  const missing = documented.filter((j) => !liveSet.has(j));
  const unknown = live.filter((j) => !docSet.has(j));
  const matched = documented.filter((j) => liveSet.has(j));

  log(`  scheduler: documented=${documented.length} live=${live.length} matched=${matched.length}`);
  if (missing.length) log(`  scheduler: MISSING from systemd: ${missing.join(', ')}`);
  if (unknown.length) log(`  scheduler: live but NOT documented in schedule.md: ${unknown.join(', ')}`);
  if (!missing.length && !unknown.length) log('  scheduler: schedule.md and systemd agree (verified no-op)');

  if (!apply) return { documented, live, missing, unknown, matched, applied: [], skippedLive: false, units: gen };

  const applied = systemd.applyUnits({ schedule, missing, log });
  return { documented, live, missing, unknown, matched, applied, skippedLive: false, units: gen };
}

module.exports = { run, liveJobs, parseFrequency, REPO, fs };
