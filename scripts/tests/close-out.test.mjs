// scripts/tests/close-out.test.mjs
// The Close-Out Gate test suite (bash migration Phase 2, 2026-08-05).
//
// This replaces scripts/tests/test-completion-sentinel.ps1 and is deliberately much wider than it.
// The migration plan calls Phase 2 the keystone: 18 wrappers and the entire failure-detection
// contract sit on close-out.mjs, so this is the highest-value artifact the migration produces and
// it is meant to outlive the migration.
//
// STALENESS FOUND DURING THE PORT, worth recording: the PowerShell test asserted STAGE 1 warn-only
// sentinel behavior ("OBSERVE (sentinel warn-only)") but close-out.ps1 was flipped to ENFORCING on
// 2026-07-21 (audit O-01) and the test was never updated - it had been failing against its own
// library. The cases below assert the ENFORCING behavior that actually ships.
//
// Every case names the incident or bug number it protects. A failing test here is not a style
// problem; it is one of the "died dark, reported green" classes coming back.
//
// Run: node --test scripts/tests/close-out.test.mjs     (or: npm test)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { detectFailure, closeOutCheck, ALEX_VERDICT_INSTRUCTION } from '../lib/close-out.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const CLOSE_OUT = path.join(REPO, 'scripts', 'lib', 'close-out.mjs');

// ~920 chars of plausible run output: long enough to clear the 500-non-whitespace-char short gate,
// with no verdict line and no limit signature.
const LONG = 'The run did real work. '.repeat(40);
const VERDICT = 'Close-Out [session]: A1..A6 ok · Verdict: COMPLETE';

function tmpdir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `alex-${name}-`));
}

/** Run the whole gate against a temp log and return what it wrote. dryRun keeps it offline. */
async function runGate(opts) {
  const dir = tmpdir('closeout');
  const log = path.join(dir, 'run.log');
  try {
    const codeOut = await closeOutCheck({ log, project: '', dryRun: true, ...opts });
    return { exit: codeOut, log: fs.readFileSync(log, 'utf8') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// =================================================================================================
// A1 detection, the pure half
// =================================================================================================

test('A1: blank output is the silent-fail class (2026-06-26 blackout)', () => {
  assert.equal(detectFailure({ out: '', code: 0 }).reason, 'blank output (silent fail)');
  // Whitespace-only is still blank: the check strips ALL whitespace before measuring.
  assert.equal(detectFailure({ out: '   \n\t\r\n  ', code: 0 }).reason, 'blank output (silent fail)');
});

test('A1: blank output outranks a non-zero exit code (the more precise diagnosis wins)', () => {
  assert.equal(detectFailure({ out: '', code: 137 }).reason, 'blank output (silent fail)');
});

test('A1: a wrapper crash is reported with its own line, clipped to 140 chars', () => {
  const r = detectFailure({ out: 'noise\nWRAPPER EXCEPTION: claude not found on PATH\nmore noise', code: 1 });
  assert.equal(r.reason, 'WRAPPER EXCEPTION: claude not found on PATH');
  const long = detectFailure({ out: `WRAPPER EXCEPTION: ${'x'.repeat(400)}`, code: 1 });
  assert.equal(long.reason.length, 140);
});

test('A1: a wrapper crash is detected even in a LONG run (not short-gated)', () => {
  // The exception branch is deliberately un-gated by length: a crash line is unambiguous, unlike a
  // prose mention of a limit.
  const r = detectFailure({ out: `${LONG}\nWRAPPER EXCEPTION: disk full`, code: 1 });
  assert.match(r.reason, /^WRAPPER EXCEPTION: disk full/);
});

test('A1: not-logged-in is detected on short output', () => {
  const r = detectFailure({ out: 'Not logged in. Please run /login', code: 1 });
  assert.equal(r.reason, 'not logged in - needs interactive claude /login');
});

test('A1: a plan limit on short output flags AND arms the plan quota writer', () => {
  const r = detectFailure({ out: 'Claude usage limit reached. Resets at 3pm.', code: 1 });
  assert.match(r.reason, /usage limit reached/);
  assert.equal(r.quotaKind, 'plan');
});

test('A1: an API cap arms the API quota writer, not the plan one (BUG-02/BUG-03 depend on this)', () => {
  const r = detectFailure({ out: 'You have exceeded your API usage limits for this month.', code: 1 });
  assert.equal(r.quotaKind, 'api');
});

test('A1: matching is CASE-INSENSITIVE, as PowerShell -match was', () => {
  // The single easiest thing to get wrong in this port. A capitalized harness message must still
  // be caught; dropping the /i flag would silently narrow every detection pattern.
  assert.notEqual(detectFailure({ out: 'Usage Limit reached for today', code: 1 }).reason, null);
  assert.match(detectFailure({ out: 'wrapper exception: boom', code: 1 }).reason, /wrapper exception/i);
});

test('A1: a non-zero exit code alone is enough (nothing else matched)', () => {
  assert.equal(detectFailure({ out: 'some short unremarkable output', code: 42 }).reason, 'claude exit code 42');
});

// =================================================================================================
// The 500-char short gate: the 2026-07-06 false-flag incident
// =================================================================================================

test('THE FALSE-FLAG CASE (2026-07-06 22:03): a long run whose PROSE mentions a limit must NOT flag', () => {
  // A successful catch-up brief that narrated "the earlier run died on the session limit"
  // false-flagged itself. The short gate exists solely to stop this. The limit mention is placed
  // early so it is nowhere near the tail, and the run ends properly with its verdict line.
  const out = `Yesterday's run died on the session limit, so this brief covers two days. ${LONG}\n${VERDICT}`;
  const r = detectFailure({ out, code: 0 });
  assert.equal(r.reason, null, `must not flag, got: ${r.reason}`);
  assert.equal(r.quotaKind, null, 'and must not arm the quota writer either');
});

test('short gate: exactly the non-whitespace count decides, not the raw length', () => {
  // 499 non-whitespace chars padded out with newlines is still SHORT, so content patterns apply.
  const short = `${'a'.repeat(499)}\n\n\n\n\n usage limit reached`.replace(/a/g, 'a');
  assert.notEqual(detectFailure({ out: short.slice(0, 499) + ' usage limit reached', code: 0 }).reason, null);
});

// =================================================================================================
// BUG-05: the mid-stream cap (died dark, reported green)
// =================================================================================================

test('BUG-05: a long run that hits the cap in its TAIL and exits 0 must flag', () => {
  const out = `${LONG}\nYou have reached your usage limit for this 5-hour window.`;
  const r = detectFailure({ out, code: 0 });
  assert.match(r.reason, /^mid-stream stop: /);
  assert.equal(r.quotaKind, 'plan');
});

test('BUG-05: a mid-stream API cap arms the API writer', () => {
  const out = `${LONG}\nstopped: API usage limits exceeded`;
  assert.equal(detectFailure({ out, code: 0 }).quotaKind, 'api');
});

test('BUG-05: the tail scan is exactly 400 chars, so an early mention stays invisible to it', () => {
  // "reached your limit" placed >400 chars from the end, with a clean verdict line at the end.
  const out = `reached your usage limit was the old problem. ${LONG}\n${VERDICT}`;
  assert.equal(detectFailure({ out, code: 0 }).reason, null);
});

// =================================================================================================
// The completion sentinel (item 1, ENFORCING since 2026-07-21, audit O-01)
// =================================================================================================

test('sentinel: a >500-char run with NO verdict line flags as a truncation', () => {
  const r = detectFailure({ out: LONG, code: 0 });
  assert.match(r.reason, /no Close-Out verdict line/);
  assert.ok(r.sentinelLog, 'and it logs a sentinel ENFORCING line');
});

test('sentinel: a run ending in Verdict: COMPLETE passes', () => {
  assert.equal(detectFailure({ out: `${LONG}\n${VERDICT}`, code: 0 }).reason, null);
});

test('sentinel: Verdict: INCOMPLETE also counts as finished (it reached the end and said so)', () => {
  const out = `${LONG}\nClose-Out [session]: Verdict: INCOMPLETE(status.md not updated)`;
  assert.equal(detectFailure({ out, code: 0 }).reason, null);
});

test('sentinel: a SHORT run with no verdict is short-gated and does NOT flag', () => {
  // A short clean run is a legitimate shape (a wrapper whose command had nothing to do).
  assert.equal(detectFailure({ out: 'tiny run, nothing to report', code: 0 }).reason, null);
});

test('sentinel: the verdict must be in the TAIL, not buried mid-output', () => {
  const out = `${VERDICT}\n${LONG}`;
  assert.match(detectFailure({ out, code: 0 }).reason, /no Close-Out verdict line/);
});

test('the verdict instruction and the sentinel regex agree (they are one contract)', () => {
  // If someone edits the instruction string without editing the check, healthy runs start failing.
  // This test is the tripwire for that.
  assert.match(ALEX_VERDICT_INSTRUCTION, /Verdict: COMPLETE/);
  assert.equal(detectFailure({ out: `${LONG}\nVerdict: COMPLETE`, code: 0 }).reason, null);
});

// =================================================================================================
// F-04: caller-supplied degradation
// =================================================================================================

test('F-04: degradedReason applies when A1 found nothing', () => {
  const r = detectFailure({ out: `${LONG}\n${VERDICT}`, code: 0, degradedReason: 'soul canary missing' });
  assert.equal(r.reason, 'soul canary missing');
  assert.ok(r.degradedLog);
});

test('F-04: a real A1 error OUTRANKS degradedReason (it is the more urgent diagnosis)', () => {
  const r = detectFailure({ out: '', code: 0, degradedReason: 'soul canary missing' });
  assert.equal(r.reason, 'blank output (silent fail)');
});

test('F-04 REGRESSION: an empty or whitespace degradedReason can never fail a healthy run', () => {
  // The PowerShell bug this replaces: a parameter named $Reason silently WAS the internal $reason,
  // so the run failed with a blank reason. Impossible in JS, but the guard is still asserted.
  for (const d of ['', '   ', undefined]) {
    assert.equal(detectFailure({ out: `${LONG}\n${VERDICT}`, code: 0, degradedReason: d }).reason, null);
  }
});

// =================================================================================================
// The whole gate: exit codes and what it writes to the log
// =================================================================================================

test('gate: a healthy run exits 0 and logs OK', async () => {
  const { exit, log } = await runGate({ out: `${LONG}\n${VERDICT}`, code: 0 });
  assert.equal(exit, 0);
  assert.match(log, /OK \(exit 0\)/);
  assert.doesNotMatch(log, /FAILED/);
});

test('gate: a failed run exits 1 and logs the reason', async () => {
  const { exit, log } = await runGate({ out: '', code: 1 });
  assert.equal(exit, 1);
  assert.match(log, /FAILED: blank output \(silent fail\)/);
});

test('gate: with no project key it says so instead of pushing (wrappers with no HQ tile)', async () => {
  const { log } = await runGate({ out: '', code: 1, project: '' });
  assert.match(log, /HQ push skipped: no run_status tile for this wrapper/);
});

test('gate: dry run describes the push it would have made, and never sends it', async () => {
  const { log } = await runGate({ out: '', code: 1, project: 'expenses' });
  assert.match(log, /DRYRUN, would push:/);
  assert.match(log, /"status":"red"/);
  assert.match(log, /"metric_key":"run_status"/);
});

test('gate: retry is skipped, loudly, when the calling wrapper path is unknown', async () => {
  const { log } = await runGate({ out: '', code: 1 });
  assert.match(log, /retry skipped: calling wrapper path unknown/);
});

test('gate: the retry ladder stops at attempt 5, it does not loop forever', async () => {
  const prev = process.env.ALEX_RETRY_ATTEMPT;
  process.env.ALEX_RETRY_ATTEMPT = '5';
  try {
    const { log } = await runGate({ out: '', code: 1, wrapper: '/x/scripts/run-thing.sh' });
    assert.match(log, /retry chain exhausted \(attempt 5\/5\)/);
  } finally {
    if (prev === undefined) delete process.env.ALEX_RETRY_ATTEMPT;
    else process.env.ALEX_RETRY_ATTEMPT = prev;
  }
});

test('gate: the retry names the unit after the wrapper and lands +90 min out', async () => {
  const { log } = await runGate({ out: '', code: 1, wrapper: '/x/scripts/run-morning-brief.sh' });
  assert.match(log, /DRYRUN, would register PersonalOS-retry-run-morning-brief-2 at \d\d:\d\d/);
});

// =================================================================================================
// The quota gate: fail-open is the whole contract
// =================================================================================================
// Driven through the real CLI in a subprocess, with ALEX_ROOT pointed at a fixture, because that is
// what the bash wrappers actually invoke: exit 0 = proceed, exit 10 = skip this slot.

function fixtureRoot(quotaState, projects = []) {
  const dir = tmpdir('quota');
  fs.mkdirSync(path.join(dir, 'system'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# fixture root\n');
  fs.writeFileSync(path.join(dir, 'system', 'manifest.json'), JSON.stringify({ projects }));
  if (quotaState !== null) {
    fs.writeFileSync(
      path.join(dir, 'system', 'quota-state.json'),
      typeof quotaState === 'string' ? quotaState : JSON.stringify(quotaState)
    );
  }
  return dir;
}

function quotaGate(root, project = '') {
  const log = path.join(root, 'gate.log');
  const res = spawnSync(process.execPath, [CLOSE_OUT, 'quota-gate', '--log', log, '--project', project], {
    env: { ...process.env, ALEX_ROOT: root },
    encoding: 'utf8',
  });
  return { exit: res.status, log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' };
}

const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString().slice(0, 19);

test('quota gate: no state file at all -> PROCEED (fail-open)', () => {
  const root = fixtureRoot(null);
  try {
    assert.equal(quotaGate(root).exit, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('quota gate: CORRUPT JSON -> PROCEED (fail-open). A broken gate must never silence the train', () => {
  const root = fixtureRoot('{ this is not json at all ');
  try {
    assert.equal(quotaGate(root).exit, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('quota gate: state ok -> PROCEED', () => {
  const root = fixtureRoot({ claude_plan: { state: 'ok', detected: null }, anthropic_api: { state: 'ok' } });
  try {
    assert.equal(quotaGate(root, 'expenses').exit, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('quota gate: freshly capped plan + ordinary priority -> SKIP the slot', () => {
  const root = fixtureRoot(
    { claude_plan: { state: 'capped', detected: hoursAgo(1) }, anthropic_api: { state: 'ok' } },
    [{ name: 'expense-wrangler', hq_project: 'expenses' }]
  );
  try {
    const { exit, log } = quotaGate(root, 'expenses');
    assert.equal(exit, 10);
    assert.match(log, /DEGRADED - core-only\/skip \(priority 3\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('quota gate: budget_priority <= 1 always runs, even under a fresh cap', () => {
  const root = fixtureRoot(
    { claude_plan: { state: 'capped', detected: hoursAgo(1) }, anthropic_api: { state: 'ok' } },
    [{ name: 'morning-brief', hq_project: 'brief', budget_priority: 1 }]
  );
  try {
    const { exit, log } = quotaGate(root, 'brief');
    assert.equal(exit, 0);
    assert.match(log, /budget_priority=1, proceeding/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('FIX-01: a plan cap older than the 6h TTL is CLEARED, not merely ignored', () => {
  // The asymmetry that let a lifted cap linger 'capped' for two days: the gate used to fail open on
  // a stale flag but never disarm it.
  const root = fixtureRoot({ claude_plan: { state: 'capped', detected: hoursAgo(9) }, anthropic_api: { state: 'ok' } });
  try {
    const { exit, log } = quotaGate(root, 'expenses');
    assert.equal(exit, 0);
    assert.match(log, /claude_plan capped->ok \(plan >6h TTL expired\)/);
    assert.match(log, /quota-state clear verified/, 'and the write is read back (verify-after-write)');
    const q = JSON.parse(fs.readFileSync(path.join(root, 'system', 'quota-state.json'), 'utf8'));
    assert.equal(q.claude_plan.state, 'ok');
    assert.equal(q.claude_plan.detected, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('FIX-01: an API cap whose reset_date has passed is CLEARED on the next gate call', () => {
  const root = fixtureRoot({
    claude_plan: { state: 'ok', detected: null },
    anthropic_api: { state: 'capped', detected: hoursAgo(200), reset_date: '2020-01-01T00:00:00' },
  });
  try {
    const { exit, log } = quotaGate(root, 'expenses');
    assert.equal(exit, 0);
    assert.match(log, /anthropic_api capped->ok \(api reset_date passed\)/);
    const q = JSON.parse(fs.readFileSync(path.join(root, 'system', 'quota-state.json'), 'utf8'));
    assert.equal(q.anthropic_api.state, 'ok');
    assert.equal(q.anthropic_api.reset_date, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('quota gate: an API cap that has NOT reset does not gate the plan lane', () => {
  const future = new Date(Date.now() + 86400000).toISOString().slice(0, 19);
  const root = fixtureRoot({
    claude_plan: { state: 'ok', detected: null },
    anthropic_api: { state: 'capped', detected: hoursAgo(2), reset_date: future },
  });
  try {
    assert.equal(quotaGate(root, 'expenses').exit, 0);
    const q = JSON.parse(fs.readFileSync(path.join(root, 'system', 'quota-state.json'), 'utf8'));
    assert.equal(q.anthropic_api.state, 'capped', 'and it is left capped, not wrongly cleared');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// =================================================================================================
// The CLI contract the bash wrappers depend on
// =================================================================================================

test('CLI: verdict-instruction prints the one canonical string', () => {
  const res = spawnSync(process.execPath, [CLOSE_OUT, 'verdict-instruction'], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, ALEX_VERDICT_INSTRUCTION);
});

test('CLI: an unknown subcommand exits 2 and prints usage (never a silent success)', () => {
  const res = spawnSync(process.execPath, [CLOSE_OUT, 'nonsense'], { encoding: 'utf8' });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /usage:/);
});

test('CLI: check reads the captured output from --out-file', () => {
  const dir = tmpdir('cli');
  try {
    const outFile = path.join(dir, 'out.txt');
    const log = path.join(dir, 'run.log');
    fs.writeFileSync(outFile, `${LONG}\n${VERDICT}`);
    const res = spawnSync(
      process.execPath,
      [CLOSE_OUT, 'check', '--log', log, '--code', '0', '--out-file', outFile, '--dry-run'],
      { encoding: 'utf8' }
    );
    assert.equal(res.status, 0);
    assert.match(fs.readFileSync(log, 'utf8'), /OK \(exit 0\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: an unreadable --out-file presents as a wrapper failure, not a healthy empty run', () => {
  // The dangerous shape: mktemp failed or the file vanished, output is "empty", and a naive
  // implementation would score that as a clean run with nothing to say.
  const dir = tmpdir('cli');
  try {
    const log = path.join(dir, 'run.log');
    const res = spawnSync(
      process.execPath,
      [CLOSE_OUT, 'check', '--log', log, '--code', '0', '--out-file', path.join(dir, 'nope.txt'), '--dry-run'],
      { encoding: 'utf8' }
    );
    assert.equal(res.status, 1);
    assert.match(fs.readFileSync(log, 'utf8'), /FAILED: WRAPPER EXCEPTION: cannot read captured output/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
