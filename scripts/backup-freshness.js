#!/usr/bin/env node
'use strict';
/*
 * backup-freshness.js - is the off-machine copy actually still happening?
 *
 * WHY (A06-T-08, stress test 2026-09-04). Two jobs stand between this laptop and total loss: the
 * 21:30 git push and the 21:45 encrypted vault blob. C31 notices when either stops, ON MONDAY. So
 * a machine that stops backing up on a Tuesday runs unprotected for six days before anything says
 * a word, and a backup is the one thing whose absence is only ever discovered at the moment it is
 * needed. This puts the same question in the daily brief.
 *
 * IT IS SILENT WHEN HEALTHY, on purpose. A line that prints every morning saying "backups fine" is
 * a line that stops being read in a week, and then the morning it says something else it is
 * invisible. F-14 already taught this system what a permanent amber costs. This speaks only when
 * something is overdue.
 *
 * Reads the SIGNAL ledger rather than the log files: a signal is written by the task's own exit
 * trap, so it proves the job ran to completion, where a log line only proves it started.
 *
 * Usage:
 *   node scripts/backup-freshness.js briefline   # one line if overdue, nothing if healthy
 *   node scripts/backup-freshness.js status      # always print, for a human checking by hand
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const SIGNALS = path.join(REPO, 'system', 'task-signals.jsonl');

// Grace, not cadence: both run nightly, and a laptop that was shut or on battery legitimately
// misses one. Two missed nights in a row is not bad luck.
const WATCHED = [
  { task: 'PersonalOS-git-backup', label: 'git push', graceHours: 48 },
  { task: 'PersonalOS-vault-backup', label: 'encrypted vault blob', graceHours: 48 },
];

function lastSignals() {
  const out = new Map();
  let text;
  try {
    text = fs.readFileSync(SIGNALS, 'utf8');
  } catch {
    return null; // no ledger: a fresh clone, not a finding
  }
  for (const ln of text.split(/\r?\n/)) {
    if (!ln.trim()) continue;
    let row;
    try { row = JSON.parse(ln); } catch { continue; }
    const name = String(row.task || '');
    if (!name) continue;
    const at = Date.parse(row.at || row.when || '');
    if (Number.isNaN(at)) continue;
    const prev = out.get(name);
    if (!prev || at > prev.at) out.set(name, { at, result: row.result });
  }
  return out;
}

function evaluate() {
  const sig = lastSignals();
  if (!sig) return { known: false, overdue: [] };
  const now = Date.now();
  const overdue = [];
  for (const w of WATCHED) {
    const last = sig.get(w.task);
    if (!last) {
      overdue.push({ ...w, ageH: null, reason: 'never signalled' });
      continue;
    }
    const ageH = (now - last.at) / 3600000;
    if (ageH > w.graceHours) {
      overdue.push({ ...w, ageH, reason: `last completed ${Math.round(ageH)}h ago` });
    } else if (last.result !== undefined && Number(last.result) !== 0) {
      // It ran, and it failed. Silence is not the only failure mode.
      overdue.push({ ...w, ageH, reason: `last run FAILED (exit ${last.result}, ${Math.round(ageH)}h ago)` });
    }
  }
  return { known: true, overdue, sig };
}

function main() {
  const mode = process.argv[2] || 'briefline';
  const r = evaluate();

  if (mode === 'status') {
    if (!r.known) {
      console.log('backup-freshness: no system/task-signals.jsonl yet - nothing has signalled on this machine.');
      return 0;
    }
    for (const w of WATCHED) {
      const last = r.sig.get(w.task);
      console.log(last
        ? `  ${w.label.padEnd(22)} last completed ${Math.round((Date.now() - last.at) / 3600000)}h ago (exit ${last.result ?? '?'})`
        : `  ${w.label.padEnd(22)} NEVER signalled`);
    }
    console.log(r.overdue.length ? `  ${r.overdue.length} overdue` : '  both current');
    return 0;
  }

  // briefline: silent when healthy
  if (!r.known || !r.overdue.length) return 0;
  const parts = r.overdue.map((o) => `${o.label} (${o.reason})`);
  console.log(`Backups: ${parts.join('; ')} - the off-machine copy is the one thing you find out about too late.`);
  return 0;
}

process.exit(main());
