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

// A05-T6 (2026-09-10): the writer accepted ANY task name, so a test run could append rows for tasks
// that do not exist to an append-only ledger C31 reads as ground truth. Two `PersonalOS-STRESSTEST-*`
// rows from the 2026-09-04 audit are the proof, sitting in the live file. The registry is now the
// gate: a name it does not carry is refused. `ALEX_SIGNAL_TEST_ROOT` is the deliberate escape hatch
// for a test, and it must point OUTSIDE the repo, so a test can never write to the real ledger.
function registryHasTask(repo, taskName) {
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(repo, 'system', 'task-registry.json'), 'utf8'));
    if (!reg || !Array.isArray(reg.tasks)) return true;   // no usable registry = do not block a real run
    return reg.tasks.some((t) => (t.name || t.task) === taskName);
  } catch {
    return true;   // unreadable registry must never silence a real signal
  }
}

export function signalTask(repo, taskName, code) {
  if (_signalled || !taskName) return;
  const testRoot = process.env.ALEX_SIGNAL_TEST_ROOT;
  if (testRoot) {
    // A test writes to its own file, never to the live ledger, and only outside the repo.
    try {
      const resolved = path.resolve(testRoot);
      if (resolved.startsWith(path.resolve(repo))) return;   // refuse: that is the live tree
      fs.appendFileSync(path.join(resolved, 'task-signals.jsonl'),
        JSON.stringify({ task: taskName, at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), exit: Number.isFinite(code) ? code : 0, wrapper: 'node', test: true }) + '\n');
      _signalled = true;
    } catch { /* never throw */ }
    return;
  }
  if (!registryHasTask(repo, taskName)) return;   // unregistered name: not a real scheduled task
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
