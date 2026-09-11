#!/usr/bin/env node
// security-sweep.mjs - P5 (three-plan validation, 2026-07-17). Alex's monthly, zero-token,
// detect-never-repair SECURITY conscience, a sibling of check.mjs. Fourteen assertions (S1-S14; S10 added
// 2026-09-10 after stress-test A09-T25 found the HQ dashboard snapshot public on a Vercel URL).
// Ported from security-sweep.ps1 (bash migration Phase 5, 2026-08-05).
//
// Exit 0 clean / 2 findings / 1 sweep-error (Terraform -detailed-exitcode convention, same as
// check.mjs). Its own script so check.mjs's "no network except the HQ push" contract stays intact.
// Detect-only: it NEVER rotates, edits or repairs.
//
// NETWORK STANCE (P5, deliberately LOUDER than the daily n8n watcher), preserved exactly: a
// CONFIGURED live source that is unreachable is a sweep FAILURE (exit 1), never a silent green - at
// monthly cadence a skipped check is a month of blindness. A NOT-YET-CONFIGURED assertion (no
// baseline captured, tool not installed) is a SETUP-NEEDED finding (exit 2, amber) so first-run gaps
// surface without a false hard-fail. Collapsing those two into one severity is the whole way this
// sweep could go quietly useless.
//
// Run: node work/18-recovery-layer/security-sweep.mjs [--dry-run]   (--dry-run skips the HQ push)
// Companion: work/18-recovery-layer/SECURITY-PLAYBOOK.md.
//
// SIMPLIFIED BY THE PLATFORM MOVE: gitleaks and node are resolved from PATH now (the winget Packages
// glob and the "C:\Program Files\nodejs" fallback are gone, W15), and the PowerShell 5.1 traps that
// three of these assertions carried workarounds for - NativeCommandError on stderr, and the
// TryParseExact [ref] overload - simply do not exist here. Those workarounds are deleted rather than
// translated: porting a guard against an impossible hazard is how a file becomes unreadable.

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installExitSignal } from '../../scripts/lib/task-signal.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
process.chdir(REPO);

const DRY = process.argv.includes('--dry-run');
// C31 dead-man signal (stress-test S-D3, 2026-09-04): emit one on exit so a security-sweep that never
// ran (the 08-03 crash class) is visible; --dry-run is a test and is skipped. Installed BEFORE any
// import that can throw (stress-test A10-T7/T8, 2026-09-09): the dynamic import below used to sit
// above this line and above the crash handlers, and on Windows it threw ERR_UNSUPPORTED_ESM_URL_SCHEME
// on a bare `C:\` path, so the sweep died with no signal, no log line and no HQ push on every
// scheduled run this platform has had. The 995b27c crash handler was dead code here for that reason.
installExitSignal(REPO, 'PersonalOS-security-sweep', DRY);

// Fail loud on an UNCAUGHT crash (stress-test S-D5, 2026-09-04). The in-sweep try/catch below pushes
// RED on a logic throw, but a crash during setup or in the report section is outside it and would
// exit silently on HQ until the Monday C31 sweep noticed the missing signal. Push RED immediately so
// a crash is loud the same day; installExitSignal (above) still records the failure for C31 too.
function crashRed(e) { try { if (!DRY) hqPush('red', `security sweep CRASHED: ${(e && e.message) || e}`); } catch { /* best-effort */ } console.error(e && e.stack || e); process.exit(1); }
process.on('uncaughtException', crashRed);
process.on('unhandledRejection', crashRed);

// file:// URL, never a bare path: `import('C:\\...')` is a scheme error on Windows (the check.mjs:45 pattern).
const { sha } = (await import(pathToFileURL(path.join(REPO, 'scripts', 'lib', 'repo-hash.js')).href)).default;

fs.mkdirSync(path.join('outputs', 'logs'), { recursive: true });
const LOG = path.join(REPO, 'outputs', 'logs', 'security-sweep.log');
const say = (m) => {
  try {
    fs.appendFileSync(LOG, `${m}\n`, 'utf8');
  } catch {
    /* never die on an unwritable log */
  }
};
const stampNow = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
say(`=== security sweep ${stampNow()} ===`);

const findings = [];
const addFinding = (sev, s, msg) => findings.push({ sev, s, msg }); // sev: FINDING | SETUP
let sweepError = null; // set to force exit 1 (a configured live source unreachable, or a throw)

const exists = (p) => fs.existsSync(p);
const readText = (p) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
};
// PATH scan in pure Node. Deliberately NOT `spawnSync('command', [...], {shell:true})`: that form
// concatenates rather than escapes its arguments, which Node 22 deprecation-warns about for exactly
// the injection reason - and a SECURITY sweep is the last place to model an unsafe spawn.
const which = (bin) => {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const cand = path.join(dir, bin);
    try {
      fs.accessSync(cand, fs.constants.X_OK);
      return cand;
    } catch {
      /* not here */
    }
  }
  return null;
};
const days = (ms) => Math.floor(ms / 86400000);

function hqPush(status, headline) {
  if (DRY) {
    say(`DryRun: skipping HQ push - ${status} - ${headline}`);
    return;
  }
  spawnSync(
    process.execPath,
    [
      path.join(REPO, 'scripts', 'lib', 'close-out.mjs'), 'hq-push',
      '--log', LOG,
      '--project', 'recovery',
      '--metric', 'security_sweep',
      '--status', status,
      '--value', status === 'green' ? '1' : '0',
      '--headline', headline,
    ],
    { cwd: REPO, stdio: 'ignore' }
  );
}

function getJson(url, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers, timeout: timeoutMs },
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

// Status code only, body discarded (S10): what a public surface answers to an unauthenticated GET.
function headStatus(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers: { 'user-agent': 'alex-security-sweep/S10' }, timeout: timeoutMs },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }
    );
    req.on('timeout', () => req.destroy(new Error(`timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
    req.end();
  });
}

try {
  // --- S1 gitleaks over full history ------------------------------------------------------------
  // gitleaks 8.19+ replaced `detect` with the `git` subcommand (history); the path is positional.
  // --exit-code 9 = leaks found; 0 = clean; anything else = a real gitleaks error.
  {
    const gitleaks = which('gitleaks');
    if (gitleaks) {
      const glArgs = ['git', REPO, '--no-banner', '--exit-code', '9', '--log-level', 'error'];
      const glCfg = path.join(REPO, '.gitleaks.toml');
      if (exists(glCfg)) glArgs.push('--config', glCfg); // tuned allowlist for reviewed false positives
      const gl = spawnSync(gitleaks, glArgs, { encoding: 'utf8' });
      const out = `${gl.stdout || ''}${gl.stderr || ''}`;
      if (gl.status === 9) {
        addFinding('FINDING', 'S1', `gitleaks flagged secret(s) in history - see the log; on a PUBLIC repo the rule is ROTATE, do not rewrite (forks/caches remember). Detail:\n${out}`);
      } else if (gl.status !== 0) {
        addFinding('FINDING', 'S1', `gitleaks errored (exit ${gl.status}): ${out}`);
      } else {
        say('S1 gitleaks: clean');
      }
    } else {
      addFinding('SETUP', 'S1', 'gitleaks is not installed - install it (see docs/INSTALL-LINUX.md) + tune a committed baseline, then this becomes a live history scan. See SECURITY-PLAYBOOK.md.');
    }
  }

  // --- S2 no gitignored path is tracked (the V11 assertion, monthly backstop) --------------------
  {
    const r = spawnSync('git', ['ls-files', '--cached', '--ignored', '--exclude-standard'], { encoding: 'utf8', cwd: REPO });
    if (r.status !== 0) {
      sweepError = `S2: git ls-files failed: ${(r.stderr || '').trim()}`;
    } else {
      const rows = String(r.stdout || '').split(/\r?\n/).filter(Boolean);
      if (rows.length) {
        addFinding('FINDING', 'S2', `gitignored path(s) are TRACKED (a forced 'git add -f'): ${rows.join(', ')}. On the PUBLIC repo this PUBLISHES them. Fix: git rm --cached <path>. (Commit-time this is caught by validator V11; this monthly re-check catches a --no-verify window.)`);
      } else {
        say('S2 tracked-vs-ignored: clean (0 rows)');
      }
    }
  }

  // --- S3 credential-age ledger ------------------------------------------------------------------
  {
    const ledgerPath = path.join('system', 'credentials-ledger.json');
    if (!exists(ledgerPath)) {
      addFinding('SETUP', 'S3', 'system/credentials-ledger.json is missing - the credential-age ledger. Recreate it (gitignored).');
    } else {
      const ledger = readJson(ledgerPath);
      for (const c of (ledger && ledger.credentials) || []) {
        if (c.id === 'vault-backup-gpg-passphrase') {
          say(`S3 ${c.id}: defers to recovery check C14 (no date here)`);
          continue;
        }
        if (c.max_age_days === null || c.max_age_days === undefined) {
          say(`S3 ${c.id}: no age policy (max_age_days null)`);
          continue;
        }
        if (!c.last_rotated) {
          addFinding('SETUP', 'S3', `credential '${c.id}' has never recorded a last_rotated date (where: ${c.where}). Set it after confirming/rotating.`);
          continue;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c.last_rotated))) {
          addFinding('FINDING', 'S3', `credential '${c.id}' last_rotated '${c.last_rotated}' is not a yyyy-MM-dd date.`);
          continue;
        }
        const age = days(Date.now() - new Date(`${c.last_rotated}T00:00:00`).getTime());
        if (age > c.max_age_days) {
          addFinding('FINDING', 'S3', `credential '${c.id}' is ${age}d old (> ${c.max_age_days}d policy) - review/rotate, then update the ledger. Where: ${c.where}`);
        } else {
          say(`S3 ${c.id}: ${age}d old (ok)`);
        }
      }
    }
  }

  // --- S4 n8n version advisory (read the b30 deployed probe, NEVER prose) -------------------------
  {
    const logFile = path.join('system', 'landscape-log.jsonl');
    if (!exists(logFile)) {
      addFinding('SETUP', 'S4', 'system/landscape-log.jsonl missing - cannot read the deployed n8n version probe.');
    } else {
      // Parse-then-filter, NOT a raw-text regex: a deployed row can be written COMPACT by the node
      // monitor OR SPACE-formatted (Python json.dumps). A regex on '"category":"deployed"' silently
      // dropped the spaced row, so S4 read a stale version for days (error-log 2026-07-18).
      const deployed = (readText(logFile) || '')
        .split(/\r?\n/)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter((r) => r && r.category === 'deployed' && r.extra && r.extra.n8n_version)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const latest = deployed[deployed.length - 1];
      if (!latest) {
        addFinding('SETUP', 'S4', "no 'deployed' probe row carries an n8n_version - the b30 self-probe has not logged one.");
      } else {
        const probeAge = days(Date.now() - new Date(latest.date).getTime());
        say(`S4 deployed n8n version (from probe, ${latest.date}): ${latest.extra.n8n_version}`);
        if (probeAge > 45) {
          addFinding('FINDING', 'S4', `the deployed-version probe is ${probeAge}d stale (last row ${latest.date}, n8n ${latest.extra.n8n_version}). Either the box was not recreated or the probe's ssh half is failing. Verify the LIVE box version + fix the probe. NOTE: the constitution claims a newer version - do NOT trust prose over the probe.`);
        }
        addFinding('SETUP', 'S4', `no machine-readable n8n security-advisory source is wired (AL-2). Version-vs-advisory is manual for now: check github.com/n8n-io/n8n security advisories against deployed ${latest.extra.n8n_version}. A hit -> a human-actions row, never an auto-update.`);
      }
    }
  }

  // --- S5 Hetzner exposed ports ------------------------------------------------------------------
  {
    const portBaseline = path.join('work', '18-recovery-layer', 'baselines', 'hetzner-ports.json');
    if (!exists(portBaseline)) {
      addFinding('SETUP', 'S5', `no committed port baseline (${portBaseline}). Capture it: ssh n8n 'ss -tlnp' (expect docker-proxy bindings for n8n/Gotenberg/HQ/Caddy + SSH), Shaheen reviews, then save the reviewed set. SSH is key-only-as-root; the b30 probe proves non-interactive exec daily (F12).`);
    } else {
      // Baseline exists: compare against live ss -tlnp. A configured-but-unreachable box is a LOUD failure.
      const r = spawnSync('ssh', ['-o', 'BatchMode=yes', 'n8n', 'ss -tlnp'], { encoding: 'utf8' });
      if (r.status !== 0) {
        sweepError = `S5: ssh to the box failed (exit ${r.status}) - configured live source unreachable: ${(r.stderr || '').trim()}`;
      } else {
        const baseline = readJson(portBaseline);
        say(`S5 ports: live ss captured; compare against baseline (${((baseline && baseline.listeners) || []).length} declared).`);
        // (Comparison detail is filled at S5 baseline-capture build, per the plan's refuses-to-specify.)
      }
    }
  }

  // --- S6 instance-MCP connected clients (activates after P2) -------------------------------------
  {
    const mcpBaseline = path.join('work', '18-recovery-layer', 'baselines', 'mcp-clients.json');
    if (!exists(mcpBaseline)) {
      addFinding('SETUP', 'S6', `no MCP connected-clients baseline (${mcpBaseline}) - written by the Chat Gateway Phase 2.0 gate test (P2 not built yet). Until then, monthly MCP-client drift is unmonitored (the DAILY n8n-active-check owns same-day toggle flips).`);
    } else {
      say('S6 mcp-clients: baseline present - compare against the instance MCP declaration (P2 build fills the live read).');
    }
  }

  // --- S7 installed skills match skills-lock.json -------------------------------------------------
  {
    const lockPath = 'skills-lock.json';
    if (!exists(lockPath)) {
      addFinding('FINDING', 'S7', 'skills-lock.json missing - the reproducibility/tamper baseline is gone.');
    } else {
      const lock = readJson(lockPath) || {};
      let mismatch = 0;
      let checked = 0;
      for (const name of Object.keys(lock.skills || {})) {
        const entry = lock.skills[name];
        const file = path.join(REPO, '.agents', 'skills', name, 'SKILL.md');
        if (!exists(file)) {
          addFinding('FINDING', 'S7', `skill '${name}' in the lock but .agents/skills/${name}/SKILL.md is MISSING on disk.`);
          mismatch++;
          continue;
        }
        const h = sha(file);
        checked++;
        if (entry.computedHash && h !== String(entry.computedHash).toLowerCase()) {
          addFinding('FINDING', 'S7', `skill '${name}' SKILL.md hash (${h.slice(0, 12)}..) != lock (${String(entry.computedHash).slice(0, 12)}..) - review the diff (script-free markdown edit vs tamper), then re-baseline.`);
          mismatch++;
        }
      }
      say(`S7 skills-hash: ${checked} checked, ${mismatch} mismatch(es)`);

      // skills-sources.json integrity: hash vs a recorded value (recorded on the first clean run).
      const srcCfg = path.join('system', 'skills-sources.json');
      const srcRecord = path.join('work', '18-recovery-layer', 'state', 'skills-sources.sha256');
      if (exists(srcCfg)) {
        const srcHash = sha(srcCfg);
        if (exists(srcRecord)) {
          const rec = (readText(srcRecord) || '').trim().toLowerCase();
          if (rec && rec !== srcHash) {
            addFinding('FINDING', 'S7', `system/skills-sources.json changed since last record (hash ${srcHash.slice(0, 12)}.. != ${rec.slice(0, 12)}..). If deliberate, refresh work/18-recovery-layer/state/skills-sources.sha256.`);
          } else {
            say('S7 skills-sources.json: matches recorded hash');
          }
        } else {
          fs.mkdirSync(path.dirname(srcRecord), { recursive: true });
          fs.writeFileSync(srcRecord, srcHash, 'utf8');
          say('S7 skills-sources.json: first run - recorded baseline hash');
        }
      }
    }
  }

  // --- S8 repo visibility matches declaration ----------------------------------------------------
  {
    const manifest = readJson(path.join('system', 'manifest.json')) || {};
    const declared = String((manifest.meta && manifest.meta.repo_visibility) || 'public');
    try {
      const api = await getJson('https://api.github.com/repos/alex-kiarash-ai/personal-os', { 'User-Agent': 'alex-security-sweep' }, 15000);
      const live = api.visibility ? String(api.visibility) : api.private ? 'private' : 'public';
      if (live !== declared) {
        addFinding('FINDING', 'S8', `repo visibility LIVE='${live}' but DECLARED='${declared}' (manifest.meta.repo_visibility). If the flip was intentional, update the declaration; if not, this is a privacy event - on a public flip, .gitignore is the SOLE barrier (rotate anything ever committed).`);
      } else {
        say(`S8 visibility: live '${live}' == declared '${declared}'`);
      }
    } catch (e) {
      sweepError = `S8: GitHub visibility read failed (configured live source unreachable): ${e.message}`;
    }
  }

  // --- S9 personal-data scan (the PUBLIC-repo privacy conscience; gitleaks S1 is for SECRETS) -----
  // Greps the git-TRACKED tree for personal data that must stay local-only: real NAMES (derived from
  // vault/people/ at runtime, so the script itself holds no personal data), FINANCIAL amounts
  // (kr/SEK), HEALTH values, SE phone, and infra secret PATHs. Detect-only; reviewed exceptions live
  // in system/personal-data-allowlist.json (gitignored, mirroring the .gitleaks.toml model).
  // Born from the 2026-07-20 scan that found a cached HQ metrics dump + a runway builder hardcoding
  // real salary/burn sat public - things gitleaks never looks for.
  {
    const pdScript = path.join('scripts', 'personal-data-scan.js');
    if (!exists(pdScript)) {
      addFinding('SETUP', 'S9', 'scripts/personal-data-scan.js is missing - the personal-data conscience. Restore it.');
    } else {
      const r = spawnSync(process.execPath, [pdScript, '--json'], { encoding: 'utf8', cwd: REPO });
      const out = `${r.stdout || ''}${r.stderr || ''}`;
      if (r.status === 1) {
        addFinding('FINDING', 'S9', `personal-data scan errored: ${out}`);
      } else {
        let pd = null;
        try {
          pd = JSON.parse(r.stdout);
        } catch {
          pd = null;
        }
        if (!pd) {
          addFinding('FINDING', 'S9', `personal-data scan output unparseable: ${out}`);
        } else if (!pd.clean) {
          const cats = Object.entries(pd.byCat || {}).map(([k, v]) => `${k}:${v}`).join(' ');
          const samples = (pd.hits || []).slice(0, 5).map((h) => `${h.file}:${h.line}[${h.cat}]`).join('; ');
          addFinding('FINDING', 'S9', `personal-data in the PUBLIC tracked tree: ${pd.total} hit(s) [${cats}]. First: ${samples}. Fix: move the value/name to a gitignored vault page + pointer, OR add a reviewed exception to system/personal-data-allowlist.json. Full list: node scripts/personal-data-scan.js`);
        } else {
          say(`S9 personal-data: clean (${pd.namesWatched} names watched)`);
        }
      }
    }
  }

  // --- S10 public surfaces challenge, never 200 (stress-test A09-T25, 2026-09-10) -------------------
  // Every internet-facing URL of the HQ surface listed in the gitignored
  // work/16-alex-hq/config/public-surfaces.json must answer an unauthenticated GET with a challenge
  // (401/403/redirect). A 200 means whatever it serves is public: on 2026-09-10 the Vercel snapshot of
  // the whole dashboard was exactly that, named in a tracked doc, and no check looked at it because
  // every probe read the Caddy door. The list is gitignored on purpose (a public URL list belongs in
  // no tracked file); an absent list is SETUP-NEEDED, an unreachable surface is a sweep failure (the
  // network stance above), and nothing here reads a byte of any body.
  {
    const cfg = path.join(REPO, 'work', '16-alex-hq', 'config', 'public-surfaces.json');
    const list = readJson(cfg);
    if (!list || !Array.isArray(list.surfaces)) {
      addFinding('SETUP', 'S10', 'work/16-alex-hq/config/public-surfaces.json is missing (gitignored): the list of internet-facing HQ URLs that must challenge. Recreate it as {"_schema":"public-surfaces@1","surfaces":[{"name","url","expect":"challenge","why"}]}.');
    } else {
      let open = 0, ok = 0;
      for (const s of list.surfaces) {
        let st;
        try { st = await headStatus(s.url, 15000); }
        catch (e) { sweepError = `S10: public surface '${s.name}' unreachable (configured live source): ${e.message}`; continue; }
        if (st >= 200 && st < 300) { open++; addFinding('FINDING', 'S10', `public surface '${s.name}' answers HTTP ${st} to an unauthenticated GET, NO challenge: whatever it serves is public. ${s.why || ''}`); }
        else if (st === 401 || st === 403 || (st >= 300 && st < 400)) ok++;
        else addFinding('FINDING', 'S10', `public surface '${s.name}' answered HTTP ${st}; expected a 401/403/redirect challenge.`);
      }
      say(`S10 public surfaces: ${list.surfaces.length} probed, ${ok} challenge, ${open} OPEN`);
    }
  }

  // --- S11 MCP stdio servers are version-PINNED (stress-test A12-T17, 2026-09-10) -------------------
  // Three stdio servers executed unpinned registry code at EVERY session start with auto-consent
  // (`npx -y ...@latest` twice, and a bare `uvx --from flights[mcp]`), on a machine that holds
  // credentials. The repo's own posture is "zero npm supply-chain surface on a machine that holds
  // credentials", and that was undone at the CLIENT layer by three fetches per session: whatever the
  // registry served that morning ran. No S-check or C-check named any MCP version, and S6's
  // connected-clients baseline has been SETUP-needed since 2026-07-20, so nothing watched this.
  //
  // Reads `claude mcp list`, which prints each server's transport and command WITHOUT touching
  // ~/.claude.json (that file holds OAuth tokens and is deliberately never read here). A stdio
  // command carrying @latest, or an npx/uvx fetch with no version at all, is a FINDING. A remote
  // (https) transport runs no local code; a local build path is pinned by the file on disk.
  {
    // shell:true on win32 - Node 20+ refuses to spawn a .cmd/.bat directly (EINVAL). The command
    // and args are fixed literals here, so there is no injection surface in taking a shell.
    const isWin = process.platform === 'win32';
    const r = spawnSync(isWin ? 'claude.cmd' : 'claude', ['mcp', 'list'], { encoding: 'utf8', timeout: 120000, windowsHide: true, shell: isWin });
    // The CLI exits nonzero when ANY server fails its health check and still prints the listing on
    // stdout, which is what this parses. Only an empty read is a sweep failure.
    const out = String((r && r.stdout) || '');
    if (!out.trim()) {
      sweepError = `S11: could not read 'claude mcp list' (${r && r.error ? r.error.message : `exit ${r ? r.status : 'n/a'}`})`;
    } else {
      let stdio = 0;
      let unpinned = 0;
      for (const raw of out.split(/\r?\n/)) {
        const m = /^(.+?):\s+(.+?)\s+-\s+[^-]*$/.exec(raw.trim());
        if (!m) continue;
        const name = m[1];
        const cmd = m[2];
        if (/^https?:\/\//i.test(cmd)) continue;
        stdio++;
        if (!/\bnpx\b|\buvx\b/.test(cmd)) continue;
        const pinned = /@\d+\.\d+/.test(cmd) || /==\d+\.\d+/.test(cmd);
        if (/@latest\b/.test(cmd) || !pinned) {
          unpinned++;
          addFinding('FINDING', 'S11', `MCP stdio server '${name}' fetches unpinned code at every session start: ${cmd}. Whatever the registry serves that morning executes on a machine holding credentials. Pin it: claude mcp remove ${name} -s <scope>, then claude mcp add ${name} -s <scope> -- <same command with an exact version>`);
        }
      }
      say(`S11 MCP pins: ${stdio} stdio server(s), ${unpinned} unpinned`);
    }
  }

  // --- S12 branch protection on main matches the declared posture (A06-T7 / M-24, 2026-09-10) -------
  // The one mechanical barrier between a bad commit and the public default branch is GitHub's branch
  // protection, and NOTHING asserted it. It could be relaxed or removed - by a token with admin
  // scope, or by hand - and every surface here stayed green, because each check tests the repo's
  // CONTENTS and none tested the rules around them. The machine account owns the repo, authors,
  // approves by absence and merges its own PRs (5 of 5), and holds the scopes to remove the
  // protection it is subject to, so this is the check that would notice.
  //
  // Contract lives in manifest meta.branch_protection, never in this prose (the V6 anti-pattern).
  {
    const GH_REPO = 'alex-kiarash-ai/personal-os';   // same slug S8 reads
    const mf = readJson(path.join('system', 'manifest.json')) || {};
    const bp = (mf.meta && mf.meta.branch_protection) || null;
    if (!bp) {
      addFinding('SETUP', 'S12', 'system/manifest.json meta.branch_protection is absent - the declared protection posture for the public default branch. Add it, then this leg asserts the live rules against it.');
    } else {
      const r = spawnSync(process.platform === 'win32' ? 'gh.exe' : 'gh',
        ['api', `repos/${GH_REPO}/branches/${bp.branch}/protection`],
        { encoding: 'utf8', timeout: 60000, windowsHide: true });
      const body = String((r && r.stdout) || '');
      if (!body.trim()) {
        // A CONFIGURED live source that will not answer is a sweep failure, never a silent pass.
        sweepError = `S12: could not read branch protection for ${GH_REPO}:${bp.branch} (${r && r.error ? r.error.message : `exit ${r ? r.status : 'n/a'}`}) - gh CLI absent or unauthenticated`;
      } else {
        let live = null;
        try { live = JSON.parse(body); } catch { /* handled below */ }
        if (!live || live.message) {
          addFinding('FINDING', 'S12', `branch protection on ${bp.branch} is NOT readable as a protection object${live && live.message ? ` (${live.message})` : ''} - on a PUBLIC repo whose sole barrier is this ruleset, that is either missing protection or a token without the scope to see it.`);
        } else {
          const liveChecks = ((live.required_status_checks || {}).contexts) || [];
          for (const want of bp.required_status_checks || []) {
            if (!liveChecks.includes(want)) addFinding('FINDING', 'S12', `required status check '${want}' is declared but NOT enforced on ${bp.branch} (live: ${liveChecks.join(', ') || 'none'}) - a red CI run would not block a merge.`);
          }
          const enforce = Boolean((live.enforce_admins || {}).enabled);
          if (Boolean(bp.enforce_admins) !== enforce) addFinding('FINDING', 'S12', `enforce_admins is ${enforce} on ${bp.branch}, declared ${bp.enforce_admins} - with it off, the account that owns the repo is exempt from every rule below.`);
          const force = Boolean((live.allow_force_pushes || {}).enabled);
          if (force && bp.allow_force_pushes === false) addFinding('FINDING', 'S12', `force pushes are ALLOWED on ${bp.branch}, declared forbidden - history on the public default branch can be rewritten.`);
          const del = Boolean((live.allow_deletions || {}).enabled);
          if (del && bp.allow_deletions === false) addFinding('FINDING', 'S12', `branch deletion is ALLOWED on ${bp.branch}, declared forbidden.`);
          const reviews = ((live.required_pull_request_reviews || {}).required_approving_review_count) || 0;
          if (reviews < (bp.required_approving_review_count || 0)) addFinding('FINDING', 'S12', `required approving reviews on ${bp.branch} is ${reviews}, declared ${bp.required_approving_review_count}.`);
          say(`S12 branch protection: ${bp.branch} checks=[${liveChecks.join(',')}] enforce_admins=${enforce} force_push=${force} deletions=${del} reviews=${reviews}`);
        }
      }
    }
  }

  // --- S13 no known personal-data commit is reachable from main (A06-T2 / S-F2, 2026-09-10) --------
  // The repo's own rule: personal data off GitHub needs a history PURGE, not a follow-up edit. The
  // follow-up edit is what happened (78e72db), so every branch TIP reads clean and the only trace
  // lives in an ancestor commit - which nothing looks at, because personal-data-scan.js reads the
  // working tree. Merging a carrier branch into main would make a private name permanent history on
  // a public repo, silently. On 2026-09-10 FOUR remote branches carried the commit (the 09-09 audit
  // found two) and so did the active fix branch, so the spread grows on its own as branches are cut.
  //
  // The carrier list is gitignored (system/history-purge-pending.json): a public file saying "this
  // commit holds a private name" is a signpost to the thing it protects.
  {
    const pend = readJson(path.join('system', 'history-purge-pending.json'));
    if (!pend || !Array.isArray(pend.commits)) {
      say('S13 history purge: no pending list (system/history-purge-pending.json absent) - nothing to assert');
    } else if (!pend.commits.length) {
      say('S13 history purge: list present and empty - no known personal-data commit outstanding');
    } else {
      for (const c of pend.commits) {
        const sha = String(c.sha || '').trim();
        if (!sha) continue;
        const known = spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: REPO, encoding: 'utf8' });
        if (known.status !== 0) {
          say(`S13 history purge: ${sha} is not in this clone (purged, or the clone predates it) - not asserted`);
          continue;
        }
        let onMain = 0;
        for (const ref of ['origin/main', 'main']) {
          const has = spawnSync('git', ['merge-base', '--is-ancestor', sha, ref], { cwd: REPO, encoding: 'utf8' });
          if (has.status === 0) {
            onMain++;
            addFinding('FINDING', 'S13', `commit ${sha} (${c.what || 'known personal data'}) is an ANCESTOR of ${ref} on the PUBLIC repo - the purge did not happen before the merge. Remedy: ${c.remedy || 'history purge + force-push'}`);
          }
        }
        const carriers = spawnSync('git', ['branch', '-a', '--contains', sha], { cwd: REPO, encoding: 'utf8' });
        const n = String(carriers.stdout || '').split(/\r?\n/).filter((l) => l.trim()).length;
        say(`S13 history purge: ${sha} reachable from ${n} ref(s) in this clone; main ${onMain ? 'CARRIES IT (see finding)' : 'clean'}`);
      }
    }
  }

  // --- S14 no credential LITERAL in either settings file (stress-test A14-T-07, 2026-09-11) --------
  // The n8n API key sat as a plaintext JWT inside a permissions allow row in settings.local.json for
  // roughly 90 of the 91 days since it was issued. Nothing looked: gitleaks reads the STAGED
  // changeset and settings.local.json is gitignored, so it was invisible to every gate this repo
  // owns while being read by every session. A permission rule is a strange place to keep a secret
  // and an easy one to paste into, which is exactly why it needs its own assertion.
  //
  // Shapes, not entropy: a JWT, the provider key prefixes, and a Bearer literal. Only the SHAPE and
  // the row index are ever reported, never the value - a finding that quotes the secret publishes
  // it into the sweep log.
  {
    const SHAPES = [
      [/eyJ[A-Za-z0-9_-]{10,}\.\S+/, 'a JWT (n8n API key shape)'],
      [/sk-[A-Za-z0-9_-]{16,}/, 'an sk- provider key'],
      [/(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{20,}/, 'a GitHub token'],
      [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
      [/AKIA[0-9A-Z]{16}/, 'an AWS access key id'],
      [/[Bb]earer\s+[A-Za-z0-9._-]{20,}/, 'a Bearer literal'],
    ];
    let scanned = 0, found = 0;
    for (const rel of ['.claude/settings.json', '.claude/settings.local.json']) {
      const abs = path.join(REPO, rel);
      if (!fs.existsSync(abs)) continue;
      scanned++;
      const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        for (const [re, what] of SHAPES) {
          if (re.test(lines[i])) {
            found++;
            addFinding('FINDING', 'S14', `${rel}:${i + 1} carries ${what}. A permission file is not a credential store and this one is read by every session; the value must be rotated (it has been readable for as long as it has been there) and moved behind system/credentials-ledger.json.`);
            break;
          }
        }
      }
    }
    if (!scanned) say('S14 settings credentials: neither settings file present - not asserted');
    else say(`S14 settings credentials: ${scanned} settings file(s) scanned, ${found} credential literal(s)`);
  }




} catch (e) {
  sweepError = `SWEEP THREW: ${e.stack || e.message}`;
}

// ---------------------------------------------------------------- report
const nFind = findings.filter((f) => f.sev === 'FINDING').length;
const nSetup = findings.filter((f) => f.sev === 'SETUP').length;
say(`--- result: ${nFind} finding(s), ${nSetup} setup-needed, error=${Boolean(sweepError)} ---`);
for (const f of findings) say(`  [${f.sev} ${f.s}] ${f.msg}`);

fs.mkdirSync(path.join('vault', 'projects', 'recovery'), { recursive: true });
const report = path.join('vault', 'projects', 'recovery', 'last-security-sweep.md');
const lines = [
  `# Last security sweep - ${stampNow().slice(0, 16)}`,
  '',
  `${nFind} finding(s), ${nSetup} setup-needed, sweep-error=${Boolean(sweepError)}.`,
  '',
];
for (const f of findings) lines.push(`- **${f.s} [${f.sev}]** ${f.msg}`);
if (sweepError) {
  lines.push('');
  lines.push(`**SWEEP ERROR (exit 1):** ${sweepError}`);
}
fs.writeFileSync(report, lines.join('\n') + '\n', 'utf8');

if (sweepError) {
  hqPush('red', `security sweep FAILED: ${sweepError}`);
  console.log(`security sweep ERROR (exit 1): ${sweepError}`);
  process.exit(1);
} else if (nFind > 0 || nSetup > 0) {
  const head = `${nFind} finding(s) + ${nSetup} setup-needed`;
  hqPush('amber', `security sweep: ${head}`);
  console.log(`security sweep: ${head} (exit 2)`);
  process.exit(2);
} else {
  hqPush('green', 'security sweep: clean');
  console.log('security sweep: clean (exit 0)');
  process.exit(0);
}
