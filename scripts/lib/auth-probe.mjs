// scripts/lib/auth-probe.mjs
// The judgment half of the weekly auth-freshness probe (bash migration Phase 3, 2026-08-05).
// Ported from the analysis sections of scripts/auth-check.ps1; the spawning half stays in
// scripts/auth-check.sh, which is genuine shell work.
//
// The largest recorded outage class is headless-claude auth/quota dying silently between runs (the
// 06-26/29/30 sprint blackout). This probe catches login expiry SUNDAY EVENING, before the Monday
// morning job train, instead of it being discovered by a dead week.
//
// Two independent verdicts, and the second must never be able to change the first:
//   1. AUTH  - one micro-prompt's output decides infra/auth_ok, and sets the process exit code.
//   2. MCP   - `claude mcp list` decides infra/mcp_ok. Strictly ADDITIVE (upgrade-scan item 3,
//              2026-07-07): best-effort, wrapped, and it NEVER changes the auth-based exit code.
//              Only CRITICAL connectors are flagged, so the perpetually-unauthenticated optional
//              ones cannot cry wolf.

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { paths, ROOT } from './paths.mjs';

const CRITICAL_MCP = ['Notion', 'Gmail', 'Google Calendar', 'Google Drive'];

function logLine(log, msg) {
  if (!log) return;
  try {
    fs.appendFileSync(log, `${msg}\n`, 'utf8');
  } catch {
    /* never die on an unwritable log */
  }
}

/**
 * The auth verdict. Note it is INTENTIONALLY not detectFailure(): this probe asks for a fixed
 * one-word answer, so "the model said something else" is itself a finding, and there is no
 * completion sentinel to look for.
 * @returns {string|null} the reason, or null when auth is fresh.
 */
export function authReason(out, code) {
  const text = typeof out === 'string' ? out : '';
  if (text.replace(/\s/g, '').length === 0) return 'blank output (silent fail)';
  if (/Not logged in|Please run \/login/i.test(text)) return 'not logged in - needs interactive claude /login';
  if (/session limit|usage limit|API usage limits|reached your .{0,40}limit/i.test(text)) {
    return 'usage/session limit at probe time';
  }
  if (code !== 0) return `claude exit code ${code}`;
  if (!/\bOK\b/.test(text)) return 'unexpected probe output';
  return null;
}

/**
 * Parse `claude mcp list`.
 * Healthy = "Connected" with no failure/warning marker, which catches "! Connected - tools fetch
 * failed" (degraded) and "! Needs authentication" / "Failed to connect" (down) alike.
 */
export function parseMcpList(mcpOut) {
  const text = typeof mcpOut === 'string' ? mcpOut : '';
  const unattachedAll = [];
  const unattachedCritical = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes(':') || !line.includes(' - ')) continue;
    const parts = line.split(' - ');
    const status = parts[parts.length - 1].trim();
    const name = line.slice(0, line.indexOf(':')).trim();
    if (!name) continue;
    const ok = /Connected/i.test(status) && !/Disconnected|fail|Needs|error|unauthor/i.test(status);
    if (ok) continue;
    unattachedAll.push(name);
    if (CRITICAL_MCP.some((c) => name.toLowerCase().includes(c.toLowerCase()))) unattachedCritical.push(name);
  }
  const parseFailure = !text.includes(':') ? 'mcp list produced no parseable output' : null;
  return { unattachedAll, unattachedCritical, parseFailure };
}

function closeOut(args) {
  return spawnSync(process.execPath, [paths.root + '/scripts/lib/close-out.mjs', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function readIf(p) {
  if (!p) return '';
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

async function main() {
  const a = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) continue;
    const eq = t.indexOf('=');
    if (eq !== -1) a[t.slice(2, eq)] = t.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) a[t.slice(2)] = argv[++i];
    else a[t.slice(2)] = true;
  }
  const log = a.log || '';
  const dry = Boolean(a['dry-run']) ? ['--dry-run'] : [];

  const probeOut = readIf(a['probe-file']);
  const probeCode = a['probe-code'] !== undefined ? parseInt(a['probe-code'], 10) || 0 : 0;
  const reason = authReason(probeOut, probeCode);

  // BUG-12 fix (2026-07-15): a limit caught Sunday evening must ARM the quota gate for the Monday
  // train, not just alert. The probe's whole purpose ("catch it before the Monday train") was half
  // delivered - it turned the HQ tile RED but never primed system/quota-state.json, so Monday's
  // wrappers each rediscovered the cap and each fired a retry ladder.
  if (reason && /limit/i.test(reason)) {
    const kind = /API usage limits/i.test(probeOut) ? 'api' : 'plan';
    closeOut(['quota-set', '--kind', kind, '--log', log]);
    // Verify-after-write (standing order): read the mutated field back, log a mismatch.
    try {
      const q = JSON.parse(fs.readFileSync(paths.quotaState(), 'utf8'));
      const armed = kind === 'api' ? q.anthropic_api?.state : q.claude_plan?.state;
      if (armed !== 'capped') logLine(log, `quota-state prime VERIFY FAILED: ${kind} state='${armed}'`);
      else logLine(log, `quota-state primed + verified: ${kind} capped`);
    } catch (e) {
      logLine(log, `quota-state verify read failed: ${e.message}`);
    }
  }

  // FIX-01 class (2026-07-15 /prompting item 6): the DISARM mirror of the prime above. A clean probe
  // just completed a successful `claude -p` call, which is a PLAN oracle, so a stale plan cap is
  // cleared here. Before this, auth-check armed the gate on a hit but nothing ever cleared it, so a
  // lifted cap stayed 'capped' until cleared by hand (FIX-01, two days late).
  if (reason === null) {
    closeOut(['quota-clear', '--kind', 'plan', '--log', log, '--reason', 'clean auth probe']);
  }

  // Push infra/auth_ok (green fresh / red stale).
  closeOut([
    'hq-push', '--log', log, '--project', 'infra', '--metric', 'auth_ok',
    ...(reason === null
      ? ['--status', 'green', '--value', '1', '--headline', 'headless claude auth fresh']
      : ['--status', 'red', '--value', '0', '--headline', `headless claude auth STALE: ${reason}`]),
    ...dry,
  ]);

  // --- the MCP half: additive, and it cannot change the exit code -------------------------------
  const mcpOut = readIf(a['mcp-file']);
  if (a['mcp-file']) {
    logLine(log, '--- mcp list ---');
    logLine(log, mcpOut.replace(/\s+$/, ''));
  }
  const { unattachedAll, unattachedCritical, parseFailure } = parseMcpList(mcpOut);
  const mcpHealthy = !parseFailure && unattachedCritical.length === 0;
  const headline = mcpHealthy
    ? `critical MCP connectors attached${unattachedAll.length ? ` (optional off: ${unattachedAll.join(', ')})` : ''}`
    : parseFailure
      ? `MCP probe: ${parseFailure}`
      : `critical MCP UNATTACHED: ${unattachedCritical.join(', ')} -> claude mcp login <name>`;
  closeOut([
    'hq-push', '--log', log, '--project', 'infra', '--metric', 'mcp_ok',
    '--status', mcpHealthy ? 'green' : 'red',
    '--value', mcpHealthy ? '1' : '0',
    '--headline', headline,
    ...dry,
  ]);
  logLine(log, `MCP verdict recorded (critical unattached: ${unattachedCritical.length})`);

  if (reason === null) {
    logLine(log, 'OK');
    return 0;
  }
  logLine(log, `FAILED: ${reason}`);
  return 1;
}

// fileURLToPath, not URL.pathname: pathname on Windows yields '/C:/...' which realpathSync
// mangles into 'C:\C:' and throws at import time (found 2026-08-25 during the powershell-branch
// reconciliation; same platform-agnostic class as the 86ff0f7 backports).
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main().then(
    (c) => process.exit(c),
    (e) => {
      process.stderr.write(`auth-probe.mjs: ${e.stack || e.message}\n`);
      process.exit(1);
    }
  );
}
