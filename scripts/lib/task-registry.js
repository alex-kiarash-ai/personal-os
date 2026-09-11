#!/usr/bin/env node
'use strict';
/*
 * task-registry.js - regenerate system/task-registry.json from the live Windows Task Scheduler.
 *
 * WHY (A05-T-05 / A04-T-02). The registry is C31's list of who to watch for silence, and it was
 * HAND-WRITTEN. git-backup sat in it at enabled:false while running every night and returning 0,
 * so the one job whose silence means the off-machine backup has stopped was not being watched, and
 * nobody could have noticed because nothing compared the list to the machine. C31 now flags that
 * disagreement every sweep; this is the other half, the way to FIX a flagged row without hand-
 * editing JSON and introducing the next drift.
 *
 * THE CADENCE FIELDS ARE NOT DERIVED, AND THAT IS DELIBERATE. `interval_hours` and `grace_hours`
 * encode a judgement about how long a given job may be silent before silence means broken, and a
 * monthly job that legitimately sleeps 30 days is indistinguishable from a dead daily one by
 * trigger inspection alone. So --refresh carries existing cadence rows through untouched, applies
 * a conservative default to genuinely NEW rows, and says which rows got a default so a human can
 * correct them. A regenerator that invented cadences would quietly rewrite the dead-man switch's
 * thresholds every time it ran.
 *
 * Usage:
 *   node scripts/lib/task-registry.js --check     # print the diff, change nothing (default)
 *   node scripts/lib/task-registry.js --refresh   # rewrite the file, preserving cadence
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const REG = path.join(REPO, 'system', 'task-registry.json');

const DEFAULTS = { kind: 'daily', interval_hours: 24, grace_hours: 12 };

/** Live PersonalOS tasks with their armed state. Throws rather than returning an empty list: an
 *  unreadable scheduler must never be mistaken for a machine with no jobs. */
function liveTasks() {
  // State is an ENUM (1 Disabled, 3 Ready, 4 Running) and ConvertTo-Json renders it as a NUMBER,
  // so a string test against "Disabled" silently never matches and every task reads as armed. The
  // first run of this tool proposed flipping the two correctly-PARKED jobs (#01 sprint-tracker,
  // #11 whatsapp-harvest) to enabled:true, which would have put C31 to watching two jobs that are
  // meant to be silent and painted the sweep permanently red. Cast it to its name in PowerShell.
  const ps = 'Get-ScheduledTask -TaskName "PersonalOS-*" | ' +
    'Select-Object TaskName,@{n="StateName";e={$_.State.ToString()}} | ConvertTo-Json -Compress';
  const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps],
    { encoding: 'utf8', timeout: 60000, windowsHide: true });
  const parsed = JSON.parse(out.trim() || '[]');
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .filter((r) => r && r.TaskName)
    .map((r) => ({ name: String(r.TaskName), enabled: !/^disabled$/i.test(String(r.StateName)) }));
}

function main() {
  const refresh = process.argv.includes('--refresh');
  let live;
  try {
    live = liveTasks();
  } catch (e) {
    console.error(`task-registry: cannot read the live scheduler (${e.message}).`);
    console.error('Refusing to rewrite the registry from an unreadable scheduler: that would mark every job gone.');
    process.exit(2);
  }
  if (!live.length) {
    console.error('task-registry: the scheduler reported ZERO PersonalOS tasks. Refusing to rewrite.');
    process.exit(2);
  }

  const existing = fs.existsSync(REG) ? JSON.parse(fs.readFileSync(REG, 'utf8')) : { schema: 'task-registry@1', tasks: [] };
  const byName = new Map((existing.tasks || []).map((t) => [t.name, t]));

  const next = [];
  const added = [];
  const flipped = [];
  for (const l of live.sort((a, b) => a.name.localeCompare(b.name))) {
    const prev = byName.get(l.name);
    if (prev) {
      if (prev.enabled !== l.enabled) flipped.push(`${l.name}: ${prev.enabled} -> ${l.enabled}`);
      next.push({ ...prev, enabled: l.enabled }); // cadence carried through untouched
    } else {
      added.push(l.name);
      next.push({ name: l.name, ...DEFAULTS, enabled: l.enabled, cadence_note: 'DEFAULTED by --refresh, review me' });
    }
  }
  const removed = [...byName.keys()].filter((n) => !live.some((l) => l.name === n));

  console.log(`task-registry: ${live.length} live task(s), ${existing.tasks ? existing.tasks.length : 0} in the registry`);
  if (added.length) console.log(`  + ${added.length} new (cadence DEFAULTED, review): ${added.join(', ')}`);
  if (removed.length) console.log(`  - ${removed.length} in the registry with no live task: ${removed.join(', ')}`);
  if (flipped.length) console.log(`  ~ enabled flag corrected: ${flipped.join('; ')}`);
  if (!added.length && !removed.length && !flipped.length) console.log('  registry agrees with the scheduler');

  if (!refresh) {
    console.log('  (--check: nothing written; pass --refresh to apply)');
    return 0;
  }

  // Rows for tasks that no longer exist are DROPPED, which is why --check prints them first: a
  // task removed by accident and a task removed on purpose look identical here, and only a human
  // knows which happened.
  const out = { ...existing, schema: 'task-registry@1', generated: new Date().toISOString(), tasks: next };
  fs.writeFileSync(REG, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`  written: ${next.length} row(s) -> ${path.relative(REPO, REG)}`);
  if (added.length) console.log('  REVIEW the defaulted cadences: a monthly job left at 24h will red every day.');
  return 0;
}

process.exit(main());
