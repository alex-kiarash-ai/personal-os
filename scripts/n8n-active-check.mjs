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
//   node scripts/n8n-active-check.mjs            run the check (daily 08:10, PersonalOS-n8n-active-check)
//   node scripts/n8n-active-check.mjs --dry-run  run + log, but do NOT push to Alex HQ (testing)

import fs from 'node:fs';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { paths, manifest, secret, ROOT } from './lib/paths.mjs';

const DRY = process.argv.includes('--dry-run');
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
  const unreachable = [];
  let checked = 0;

  try {
    const man = manifest();
    // expected-active = LIVE-state projects whose `n8n` field is a workflow-id string (15-20 chars).
    const rows = [...(man.projects || []), ...((man.meta && man.meta.unnumbered) || [])];
    const expected = rows
      .filter((p) => p.state === 'LIVE' && typeof p.n8n === 'string' && p.n8n.length >= 15 && p.n8n.length <= 20)
      .map((p) => ({ label: p.num ? `#${p.num} ${p.name}` : p.name, id: p.n8n }));

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

    if (inactive.length > 0) {
      reason = `OFF: ${inactive.join('; ')}`;
    } else if (checked === 0) {
      reason = 'TRANSIENT-API-UNREACHABLE'; // nothing reachable = network/API blip, not config drift
    }
  } catch (e) {
    reason = `WATCHER EXCEPTION: ${e.message}`;
  }

  if (reason === null) {
    let head = `all ${checked} LIVE n8n workflows active`;
    if (unreachable.length > 0) head += ` (${unreachable.length} unreachable this run)`;
    hqPush({ status: 'green', valueNum: 0, headline: head });
  } else if (reason === 'TRANSIENT-API-UNREACHABLE') {
    hqPush({ status: 'amber', valueNum: 0, headline: 'n8n API unreachable this run (transient, not drift)' });
  } else {
    hqPush({ status: 'red', valueNum: inactive.length, headline: `n8n workflow(s) OFF: ${reason}` });
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
