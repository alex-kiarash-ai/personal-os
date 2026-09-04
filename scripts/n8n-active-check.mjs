#!/usr/bin/env node
// scripts/n8n-active-check.mjs  -  Recovery layer: n8n active-flag watcher.
// Ported from scripts/n8n-active-check.ps1 (bash migration Phase 5, 2026-08-05).
//
// ZERO LLM tokens. Born from the 2026-07-16 diagnostic audit (BUG-01 / register): a LIVE n8n workflow
// can go active:false and NOTHING notices until a missed run is spotted hours or days later (the proven
// 2026-07-10 silent dual-engine deactivation; and n8n's activate/deactivate does NOT bump `updatedAt`,
// so drift is invisible to a timestamp check - you must read the flag itself).
//
// What it does: reads system/manifest.json, takes every LIVE project that maps to an n8n workflow id,
// GETs each workflow, and asserts active==true. Any expected-active workflow that is OFF -> RED to Alex
// HQ (recovery/n8n_active) + exit 1. A total-API-outage is amber+exit 0 (transient, not config drift),
// never a false RED. Best-effort HQ push (a bad token/network never changes the exit code).
//
// THE ONE DISTINCTION THAT MAKES THIS USEFUL, preserved exactly: "some workflows unreachable" is not
// the same finding as "nothing reachable". The first is noted and still green; the second is amber and
// exits 0, because a network blip must never look like config drift. Getting that wrong in either
// direction destroys the check - a false RED trains you to ignore it, a false GREEN is the outage.
//
// Exit 0 = all expected-active workflows are active (or the API was unreachable, treated as transient).
// Exit 1 = at least one expected-active workflow is OFF (real drift).
//
// --- LEG 2 added 2026-08-05 (pen-test finding P-02) -------------------------------------------
// The flag leg above answers "is it switched on". It does NOT answer "did it work", and those are
// different invariants. Proven on 2026-08-04/05: #03 and #14 both ERRORED on the live box while this
// watcher, validator V6 and the weekly sweep all read green, because every one of them inspects
// CONFIGURATION. Three greens on the same layer are not independent evidence.
//
// Leg 2 reads /executions and asserts, per governed workflow:
//   (a) the LAST execution did not error   -> a run that failed is a red, immediately; and
//   (b) a SUCCESS happened within the window its declared `n8n_cron` implies (x2 for slack)
//       -> catches the silent case: a trigger that stopped firing at all, which (a) cannot see
//          because there is no failed execution to find.
// Only projects carrying an `n8n_cron` get leg (b); webhook-driven lanes (#16, #17) have no
// expected cadence in the registry, so asserting one would invent a contract that does not exist.
// Their silence is owned by the HQ self-heal `health-source-stalled` probe instead.
//
// Deliberately NOT retried or auto-fixed here: this is the DETECT half, same as the flag leg. The
// remedy for a failed run is a person reading the error, because the causes are not interchangeable
// (2026-08-04 alone produced a Google Sheets 503, a Bright Data "Customer is not active", and an
// unparseable Sheets range - three different remedies, none of them a rerun).
//
// Exit 1 now also means: a governed workflow's last run errored, or it has gone quiet past its cadence.
//
//   node scripts/n8n-active-check.mjs            run the check (daily 08:10, PersonalOS-n8n-active-check)
//   node scripts/n8n-active-check.mjs --dry-run  run + log, but do NOT push to Alex HQ (testing)

import fs from 'node:fs';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { paths, manifest, secret, ROOT } from './lib/paths.mjs';
import { installExitSignal } from './lib/task-signal.mjs';

const DRY = process.argv.includes('--dry-run');
// C31 dead-man signal (stress-test S-D3, 2026-09-04): emit one on exit so this daily watcher, a
// zero-token node task that never sourced common.sh, proves it ran; --dry-run is a test and is skipped.
installExitSignal(ROOT, 'PersonalOS-n8n-active-check', DRY);
const N8N_BASE = 'https://n8n.shaheenkiarash.com/api/v1';

fs.mkdirSync(paths.logDir(), { recursive: true });
const LOG = paths.log('n8n-active-check');
const say = (m) => {
  try {
    fs.appendFileSync(LOG, `${m}\n`, 'utf8');
  } catch {
    /* never die on an unwritable log */
  }
  if (process.stdout.isTTY) console.log(m);
};

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function getJson(url, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'GET', headers, timeout: timeoutMs },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}`));
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`unparseable JSON: ${e.message}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error(`timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
    req.end();
  });
}

/** Best-effort HQ push through the shared helper, so the token never lives in this file either. */
function hqPush({ status, valueNum, headline }) {
  if (DRY) {
    say(`DRYRUN, would push: ${status} / ${headline}`);
    return;
  }
  spawnSync(
    process.execPath,
    [
      `${ROOT}/scripts/lib/close-out.mjs`, 'hq-push',
      '--log', LOG,
      '--project', 'recovery',
      '--metric', 'n8n_active',
      '--status', status,
      '--value', String(valueNum),
      '--headline', headline,
    ],
    { cwd: ROOT, stdio: 'ignore' }
  );
}

async function main() {
  say(`=== run ${stamp()}${DRY ? ' (DRYRUN)' : ''} ===`);

  let reason = null;
  const inactive = [];
  const failed = []; // leg 2a: governed workflows whose LAST execution errored
  const stale = []; // leg 2b: governed workflows with no success inside their declared cadence
  const unreachable = [];
  let checked = 0;

  try {
    const man = manifest();
    // expected-active = LIVE-state projects whose `n8n` field is a workflow-id string (15-20 chars).
    const rows = [...(man.projects || []), ...((man.meta && man.meta.unnumbered) || [])];
    const expected = rows
      .filter((p) => p.state === 'LIVE' && typeof p.n8n === 'string' && p.n8n.length >= 15 && p.n8n.length <= 20)
      .map((p) => ({
        label: p.num ? `#${p.num} ${p.name}` : p.name,
        id: p.n8n,
        cron: typeof p.n8n_cron === 'string' ? p.n8n_cron : null,
      }));

    if (expected.length === 0) throw new Error('no LIVE project carries an n8n workflow id - manifest schema drift?');

    const headers = { 'X-N8N-API-KEY': secret('n8n-api-key') };

    for (const w of expected) {
      try {
        const wf = await getJson(`${N8N_BASE}/workflows/${w.id}`, headers, 15000);
        checked++;
        if (wf.active !== true) {
          inactive.push(`${w.label} [${w.id}]`);
          say(`OFF: ${w.label} [${w.id}] active=${wf.active}`);
        } else {
          say(`ok: ${w.label} active=true`);
        }
      } catch (e) {
        unreachable.push(`${w.label} [${w.id}]`);
        say(`unreachable: ${w.label} [${w.id}] - ${e.message}`);
      }
    }

    // --- LEG 2: execution health (P-02). Config-green is not run-green. -------------------------
    // One /executions read for the whole set, then per-workflow verdicts. Kept to a single call so a
    // daily zero-token watcher stays cheap; 250 rows covers every governed lane's recent history.
    if (checked > 0) {
      try {
        const ex = await getJson(`${N8N_BASE}/executions?limit=250&includeData=false`, headers, 30000);
        const exRows = Array.isArray(ex.data) ? ex.data : [];
        say(`executions read: ${exRows.length}`);
        for (const w of expected) {
          const mine = exRows
            .filter((r) => r.workflowId === w.id)
            .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
          if (mine.length === 0) {
            say(`exec: ${w.label} - no executions in the window (not asserted)`);
            continue;
          }

          // (a) last run errored -> red now. n8n uses 'error' and 'crashed' for real failures.
          const last = mine[0];
          if (last.status === 'error' || last.status === 'crashed') {
            failed.push(`${w.label} last run ${last.status} ${String(last.startedAt).slice(0, 16)}`);
            say(`FAILED: ${w.label} last execution id=${last.id} status=${last.status} at ${last.startedAt}`);
            continue; // already red; the staleness leg would just restate it
          }

          // (b) gone quiet past its declared cadence. Only for lanes that DECLARE one.
          if (!w.cron) {
            say(`ok: ${w.label} last run ${last.status} (no n8n_cron declared, cadence not asserted)`);
            continue;
          }
          const succ = mine.filter((r) => r.status === 'success');
          if (succ.length === 0) {
            stale.push(`${w.label} no success in window`);
            say(`STALE: ${w.label} no success in the execution window`);
            continue;
          }
          const lastOk = new Date(succ[0].startedAt);
          // Expected gap from the cron's day-of-week field: a 2-days-a-week lane may legitimately
          // be quiet for 5 days. Weekly-ish = 8d, daily = 2d, then doubled for slack. Deliberately
          // coarse: this leg exists to catch "stopped firing entirely", not to police punctuality.
          const dow = w.cron.split(/\s+/)[4];
          const days = dow === '*' ? 2 : 8;
          const ageD = Math.round(((Date.now() - lastOk.getTime()) / 86400000) * 10) / 10;
          if (ageD > days * 2) {
            stale.push(`${w.label} last success ${ageD}d ago (cron '${w.cron}')`);
            say(`STALE: ${w.label} last success ${ageD}d ago, window ${days * 2}d, cron '${w.cron}'`);
          } else {
            say(`ok: ${w.label} last run success, ${ageD}d ago (window ${days * 2}d)`);
          }
        }
      } catch (e) {
        // Executions unreadable is NOT drift - same posture as the flag leg's API-outage case.
        say(`executions unreadable this run (leg 2 skipped): ${e.message}`);
      }
    }

    if (inactive.length > 0) {
      reason = `OFF: ${inactive.join('; ')}`;
    } else if (failed.length > 0) {
      reason = `FAILED RUN: ${failed.join('; ')}`;
    } else if (stale.length > 0) {
      reason = `NO RECENT SUCCESS: ${stale.join('; ')}`;
    } else if (checked === 0) {
      reason = 'TRANSIENT-API-UNREACHABLE'; // nothing reachable = network/API blip, not config drift
    }
  } catch (e) {
    reason = `WATCHER EXCEPTION: ${e.message}`;
  }

  if (reason === null) {
    // Green now means BOTH legs passed: switched on AND last run healthy. Say so, because the
    // old headline ("all N active") is exactly the reassurance that hid P-02 for two days.
    let head = `all ${checked} LIVE n8n workflows active + last runs healthy`;
    if (unreachable.length > 0) head += ` (${unreachable.length} unreachable this run)`;
    hqPush({ status: 'green', valueNum: 0, headline: head });
  } else if (reason === 'TRANSIENT-API-UNREACHABLE') {
    hqPush({ status: 'amber', valueNum: 0, headline: 'n8n API unreachable this run (transient, not drift)' });
  } else {
    // value_num carries the total count of unhealthy lanes across both legs, not just OFF ones.
    hqPush({
      status: 'red',
      valueNum: inactive.length + failed.length + stale.length,
      headline: `n8n unhealthy: ${reason}`,
    });
  }

  if (reason === null || reason === 'TRANSIENT-API-UNREACHABLE') {
    say(`OK (${checked} checked, ${unreachable.length} unreachable)`);
    return 0;
  }
  say(`DRIFT: ${reason}`);
  return 1;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    say(`WATCHER EXCEPTION: ${e.stack || e.message}`);
    process.exit(1);
  }
);
