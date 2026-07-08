// gen-scheduler.js - scheduler/schedule.md -> Windows Task Scheduler jobs (refactor P1-S3).
// The ONLY PowerShell/Windows touchpoint in the generator (D11): schtasks is invoked as a
// subprocess. Job-naming follows the existing /cron-setup pattern: PersonalOS-{name}, each running
// a hardened wrapper scripts/run-{name}.ps1 (never a bare `claude -p`).
//
// Idempotence + safety contract:
//   - dry-run (apply=false): parse the documented PersonalOS-* job set from scheduler/schedule.md,
//     query the live set (schtasks /query), report missing / unknown / matched. No writes.
//   - apply: creates ONLY jobs that are documented but not registered (schtasks /create /f by job
//     name). It NEVER touches an existing job: the live jobs carry hand-applied hardening
//     (RestartCount ladders, WakeToRun, battery settings) that re-creation would silently wipe -
//     that is a documented past incident class, so "leave existing jobs alone" is a hard rule here.
//   - PersonalOS-retry-* one-shots are ephemeral by design and excluded on both sides (same as
//     recovery check C7).
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');

// Live PersonalOS-* task names from Windows Task Scheduler.
function liveJobs() {
  let csv;
  try {
    csv = execFileSync('schtasks', ['/query', '/fo', 'CSV'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`gen-scheduler: schtasks /query failed: ${e.message}`);
  }
  const names = new Set();
  for (const m of csv.matchAll(/"\\([^"\\]*PersonalOS-[A-Za-z0-9-]+)"/g)) {
    const name = m[1];
    if (!name.startsWith('PersonalOS-retry-')) names.add(name);
  }
  return [...names].sort();
}

// Parse a schedule.md frequency phrase into schtasks args. Conservative on purpose: anything it
// cannot parse must go through /cron-setup by hand - guessing a schedule is worse than failing.
function parseFrequency(freq) {
  if (!freq) return null;
  const f = freq.toLowerCase();
  const time = f.match(/(\d{1,2})[:.](\d{2})\s*(am|pm)?/);
  if (!time) return null;
  let hh = parseInt(time[1], 10);
  const mm = time[2];
  if (time[3] === 'pm' && hh < 12) hh += 12;
  if (time[3] === 'am' && hh === 12) hh = 0;
  const st = `${String(hh).padStart(2, '0')}:${mm}`;
  if (/weekday/.test(f)) return ['/sc', 'WEEKLY', '/d', 'MON,TUE,WED,THU,FRI', '/st', st];
  const day = f.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (day) return ['/sc', 'WEEKLY', '/d', day[1].slice(0, 3).toUpperCase(), '/st', st];
  if (/monthly.*last day/.test(f)) return ['/sc', 'MONTHLY', '/mo', 'LASTDAY', '/m', '*', '/st', st];
  const dom = f.match(/monthly on the (\d{1,2})/);
  if (dom) return ['/sc', 'MONTHLY', '/d', dom[1], '/st', st];
  if (/daily|\bdays\b|3x daily/.test(f)) return ['/sc', 'DAILY', '/st', st];
  return null;
}

// Map a documented job name back to its schedule.md entry (the entry text carries the job name).
function entryForJob(schedule, jobName) {
  return schedule.entries.find(e => e.jobNames.includes(jobName)) || null;
}

async function run({ schedule, apply, log }) {
  const documented = schedule.allJobNames;
  const live = liveJobs();
  const liveSet = new Set(live);
  const docSet = new Set(documented);
  const missing = documented.filter(j => !liveSet.has(j));
  const unknown = live.filter(j => !docSet.has(j));
  const matched = documented.filter(j => liveSet.has(j));

  log(`  scheduler: documented=${documented.length} live=${live.length} matched=${matched.length}`);
  if (missing.length) log(`  scheduler: MISSING from Task Scheduler: ${missing.join(', ')}`);
  if (unknown.length) log(`  scheduler: live but NOT documented in schedule.md: ${unknown.join(', ')}`);
  if (!missing.length && !unknown.length) log('  scheduler: schedule.md and Task Scheduler agree (verified no-op)');

  if (!apply) return { documented, live, missing, unknown, matched, applied: [] };

  const applied = [];
  for (const job of missing) {
    const entry = entryForJob(schedule, job);
    if (!entry) throw new Error(`gen-scheduler: ${job} is documented but no schedule.md entry names it - fix schedule.md`);
    const schArgs = parseFrequency(entry.frequency);
    if (!schArgs)
      throw new Error(`gen-scheduler: cannot parse frequency '${entry.frequency}' for ${job} - register it via /cron-setup instead`);
    const base = job.replace(/^PersonalOS-/, '');
    const wrapper = path.join(REPO, 'scripts', `run-${base}.ps1`);
    const fsx = require('fs');
    if (!fsx.existsSync(wrapper))
      throw new Error(`gen-scheduler: wrapper scripts/run-${base}.ps1 does not exist for ${job} - create the hardened wrapper first (never schedule a bare claude -p)`);
    const tr = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${wrapper}"`;
    execFileSync('schtasks', ['/create', '/f', '/tn', job, '/tr', tr, ...schArgs], { encoding: 'utf8' });
    log(`  scheduler: CREATED ${job} (${entry.frequency}) - apply hardening per scheduler/schedule.md Task Hardening section`);
    applied.push(job);
  }
  return { documented, live, missing, unknown, matched, applied };
}

module.exports = { run, liveJobs, parseFrequency };
