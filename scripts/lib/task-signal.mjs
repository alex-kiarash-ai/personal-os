// The C31 dead-man signal for the zero-token NODE tasks that never source scripts/lib/common.sh and
// so never emit the shell `task_signal` - recovery-check (check.mjs), security-sweep.mjs and the
// n8n active-flag watcher (n8n-active-check.mjs). Before this, C31 red them every week because red is
// its default posture and they gave it no evidence of a run, which buried the real silent-outage
// signal it exists to catch (stress-test finding S-D3, 2026-09-04).
//
// Mirrors common.sh `task_signal` exactly: one append-only JSON row per run, written ON EXIT with the
// real exit code, idempotent, dependency-free, and it NEVER throws - a dead-man signal must not take
// down the run it reports on.
import fs from 'node:fs';
import path from 'node:path';

let _signalled = false;

export function signalTask(repo, taskName, code) {
  if (_signalled || !taskName) return;
  try {
    const row = JSON.stringify({
      task: taskName,
      at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      exit: Number.isFinite(code) ? code : 0,
      wrapper: 'node',
    }) + '\n';
    fs.appendFileSync(path.join(repo, 'system', 'task-signals.jsonl'), row);
    _signalled = true;
  } catch {
    /* never throw */
  }
}

// Install a process EXIT handler that signals with the final exit code. `skip` is true for a
// --dry-run or --init invocation: those are tests, not real scheduled runs, and must not count as
// one (the same reason the shell task_signal returns early on ALEX_DRY_RUN).
export function installExitSignal(repo, taskName, skip) {
  if (skip) return;
  process.on('exit', (code) => signalTask(repo, taskName, code || 0));
}
