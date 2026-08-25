#!/usr/bin/env node
// scripts/bootstrap.mjs - the machine-rebuild doctor (2026-08-05, enterprise-assessment idea 6,
// vault/research/enterprise-assessment-ideas.md). Ported from bootstrap.ps1 during the 2026-08-25
// powershell-branch reconciliation.
//
// WHY: the restore story covered the DATA (git clone + the encrypted vault tar, both drilled) but a
// new machine's ENVIRONMENT was archaeology across identity.md, recovery docs and memory. This makes
// it a checklist a machine runs: every outside-repo dependency is declared in
// system/environment-schema.json (tracked, no secret paths) and this script proves each one present.
//
// DOCTOR, NOT INSTALLER. It reports and it repairs exactly ONE thing (--repair-links, safe +
// idempotent). It never installs tools, never creates scheduler jobs (/cron-setup owns those), never
// reads a secret VALUE (existence of the ledger's file-type entries only).
//
// Usage:  node scripts/bootstrap.mjs                  # doctor: report PASS/MISS/OPT
//         node scripts/bootstrap.mjs --repair-links   # + recreate missing skill links
// Exit:   0 = every REQUIRED item present · 2 = something required is missing · 1 = script error
// Log:    outputs/logs/bootstrap-check.log (gitignored)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
process.chdir(REPO);

const REPAIR = process.argv.includes('--repair-links');
const WIN = process.platform === 'win32';

fs.mkdirSync(path.join(REPO, 'outputs', 'logs'), { recursive: true });
const LOG_FILE = path.join(REPO, 'outputs', 'logs', 'bootstrap-check.log');
const logAppend = (m) => {
  try {
    fs.appendFileSync(LOG_FILE, `${m}\n`, 'utf8');
  } catch {
    /* never die on an unwritable log */
  }
};
logAppend(`=== bootstrap check ${new Date().toISOString()} ===`);

let missRequired = 0;
function report(state, section, name, detail) {
  const line = `[${state}] ${section.padEnd(14)} ${name.padEnd(28)} ${detail}`;
  console.log(line);
  logAppend(line);
  if (state === 'MISS') missRequired++;
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const exists = (p) => fs.existsSync(p);
const expandVars = (s) =>
  String(s)
    .replace(/%([^%]+)%/g, (_, v) => process.env[v] || '')
    .replace(/^~(?=$|[\\/])/, os.homedir());
// Probes are COMMAND NAMES from the tracked schema, never arbitrary strings, so the schema cannot
// inject shell. shell:false throughout; npm alone needs the .cmd shim on Windows.
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', shell: false });

try {
  const schema = readJson(path.join(REPO, 'system', 'environment-schema.json'));

  // --- 1. tools -------------------------------------------------------------------------------
  for (const t of schema.tools || []) {
    let ver = '';
    let found = false;
    if (t.version_args) {
      const r = run(t.id, t.version_args.split(' '));
      if (!r.error && r.status !== null) {
        found = true;
        ver = (r.stdout || r.stderr || '').split(/\r?\n/)[0].trim();
      }
    } else {
      // No version probe declared: presence on PATH is the whole check.
      const which = run(WIN ? 'where' : 'which', [t.id]);
      found = which.status === 0;
    }
    let exe = '';
    if (!found && Array.isArray(t.fallback_paths)) {
      // some tools live off-PATH by design (gpg rides Git's bundle; the vault backup resolves the
      // same list in the same order) - probe exactly what production probes.
      exe = t.fallback_paths.find((p) => exists(expandVars(p))) || '';
      found = Boolean(exe);
    }
    if (!found) {
      report(t.required ? 'MISS' : 'OPT ', 'tool', t.id, `absent - restore: ${t.restore}`);
      continue;
    }
    if (t.id === 'node' && t.min_major) {
      const m = /v(\d+)/.exec(ver);
      if (m && Number(m[1]) < t.min_major) {
        report('MISS', 'tool', t.id, `${ver} but need >= v${t.min_major} (node:sqlite)`);
        continue;
      }
    }
    report('PASS', 'tool', t.id, ver || exe || 'present');
  }

  // --- 2. npm globals + python packages -------------------------------------------------------
  for (const g of schema.npm_globals || []) {
    const r = spawnSync(WIN ? 'npm.cmd' : 'npm', ['ls', '-g', '--depth=0', g.id], { encoding: 'utf8', shell: WIN });
    const ok = r.status === 0;
    report(ok ? 'PASS' : g.required ? 'MISS' : 'OPT ', 'npm-global', g.id, ok ? 'installed' : `absent - npm install -g ${g.id}`);
  }
  for (const p of schema.python_packages || []) {
    let ok = false;
    for (const py of ['python3', 'python']) {
      const r = run(py, ['-c', `import ${p.id}`]);
      if (!r.error && r.status === 0) {
        ok = true;
        break;
      }
    }
    report(ok ? 'PASS' : p.required ? 'MISS' : 'OPT ', 'py-package', p.pip_name, ok ? 'imports' : `absent - pip install ${p.pip_name}`);
  }

  // --- 3. secret files (existence only, from the gitignored ledger) ---------------------------
  const ledgerPath = path.join(REPO, 'system', 'credentials-ledger.json');
  if (!exists(ledgerPath)) {
    report('MISS', 'secrets', 'credentials-ledger', 'system/credentials-ledger.json ABSENT - restore the encrypted vault backup FIRST (vault-backup-plan)');
  } else {
    const ledger = readJson(ledgerPath);
    for (const c of ledger.credentials || []) {
      let p = null;
      if (c.local_path) p = expandVars(c.local_path);
      else {
        const m = /^([\w./\\-]+\.(txt|json|pass))\b/.exec(c.where || '');
        if (m) p = m[1];
      }
      if (p === null) {
        report('INFO', 'secrets', c.id, 'not file-backed (password manager / n8n credential / OS keyring) - nothing to check here');
        continue;
      }
      if (exists(path.isAbsolute(p) ? p : path.join(REPO, p))) report('PASS', 'secrets', c.id, 'file present (value not read)');
      else report('MISS', 'secrets', c.id, `expected file absent: ${p}`);
    }
  }

  // --- 4. scheduler jobs (manifest = source of truth; /cron-setup recreates) ------------------
  const manifest = readJson(path.join(REPO, 'system', 'manifest.json'));
  const declared = (manifest.projects || []).flatMap((proj) => proj.schedule_jobs || []).filter(Boolean);
  let live = null; // null = no scheduler backend reachable on this machine
  {
    const sysd = run('systemctl', ['--user', 'list-timers', '--all', '--no-legend', '--no-pager']);
    if (!sysd.error && sysd.status === 0) {
      live = (sysd.stdout || '')
        .split(/\r?\n/)
        .map((l) => (/(PersonalOS-[\w-]+)\.timer/.exec(l) || [])[1])
        .filter(Boolean);
    } else if (WIN) {
      const ps = run('powershell', ['-NoProfile', '-Command', "(Get-ScheduledTask -TaskName 'PersonalOS-*' -ErrorAction SilentlyContinue).TaskName"]);
      if (!ps.error && ps.status === 0) live = (ps.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }
  }
  if (live === null) {
    report('OPT ', 'scheduler', 'PersonalOS-* jobs', `no scheduler backend reachable (systemd/Task Scheduler) - ${declared.length} declared jobs not asserted here; /cron-setup recreates them`);
  } else {
    const missingJobs = declared.filter((j) => !live.includes(j));
    if (missingJobs.length === 0) report('PASS', 'scheduler', 'PersonalOS-* jobs', `${declared.length} declared, all registered`);
    else report('MISS', 'scheduler', 'PersonalOS-* jobs', `${missingJobs.length} of ${declared.length} missing (recreate via /cron-setup): ${missingJobs.join(', ')}`);
  }

  // --- 5. skill links (.agents/skills -> .claude/skills) --------------------------------------
  // PARKED skills (skills-lock.json `parked: true`, S1 Compiled Surfaces P4 2026-08-16) are
  // deliberately link-less; the doctor must not count them broken nor resurrect them on repair
  // (wake = node scripts/skills-park.js --wake <name>).
  const jr = schema.junction_rule || { target_dir: '.agents/skills', link_dir: '.claude/skills' };
  const targetDir = path.join(REPO, jr.target_dir);
  const linkDir = path.join(REPO, jr.link_dir);
  const parkedSet = new Set();
  try {
    const lk = readJson(path.join(REPO, 'skills-lock.json'));
    for (const [n, row] of Object.entries(lk.skills || {})) if (row && row.parked) parkedSet.add(n);
  } catch {
    /* no lock = nothing parked */
  }
  const targets = exists(targetDir)
    ? fs
        .readdirSync(targetDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !parkedSet.has(d.name))
        .map((d) => d.name)
    : [];
  const broken = targets.filter((n) => !exists(path.join(linkDir, n)));
  if (broken.length === 0) {
    report('PASS', 'links', 'skill store', `${targets.length} skills, all linked`);
  } else if (REPAIR) {
    // Node's 'junction' type needs no elevation on Windows and degrades to a plain symlink on
    // POSIX - one code path, both platforms (the old mklink /J shell-out is gone with the port).
    let fixed = 0;
    for (const n of broken) {
      const link = path.join(linkDir, n);
      try {
        fs.symlinkSync(path.join(targetDir, n), link, 'junction');
        if (exists(link)) fixed++;
      } catch {
        /* counted below */
      }
    }
    const still = broken.length - fixed;
    if (still === 0) report('PASS', 'links', 'skill store', `repaired ${fixed} missing link(s), all ${targets.length} linked now`);
    else report('MISS', 'links', 'skill store', `repair left ${still} of ${broken.length} still missing`);
  } else {
    report('MISS', 'links', 'skill store', `${broken.length} of ${targets.length} links missing - run: node scripts/bootstrap.mjs --repair-links`);
  }

  // --- 6. ssh alias ---------------------------------------------------------------------------
  const sshCfg = path.join(os.homedir(), '.ssh', 'config');
  for (const s of schema.ssh || []) {
    const ok = exists(sshCfg) && new RegExp(`^\\s*Host\\s+.*\\b${s.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'im').test(fs.readFileSync(sshCfg, 'utf8'));
    report(ok ? 'PASS' : 'MISS', 'ssh', `alias '${s.alias}'`, ok ? 'in ~/.ssh/config' : `absent from ~/.ssh/config - ${s.note}`);
  }

  // --- 7. claude settings (identity.md section 4: re-apply after restore) ---------------------
  const cs = schema.claude_settings || {};
  const csPath = path.join(os.homedir(), '.claude', 'settings.json');
  if (!exists(csPath)) {
    report('MISS', 'claude-cfg', 'settings.json', '~/.claude/settings.json absent');
  } else {
    const cfg = readJson(csPath);
    for (const k of cs.expect_keys || []) {
      const has = Object.prototype.hasOwnProperty.call(cfg, k);
      report(has ? 'PASS' : 'MISS', 'claude-cfg', k, has ? 'set' : 'missing (identity.md section 4)');
    }
    for (const [name, wantVal] of Object.entries(cs.expect_env || {})) {
      const ok = cfg.env && cfg.env[name] === wantVal;
      report(ok ? 'PASS' : 'MISS', 'claude-cfg', name, ok ? `= ${wantVal}` : `expected ${wantVal} (identity.md section 4)`);
    }
  }

  // --- 8. git expectations --------------------------------------------------------------------
  const ge = schema.git_expectations || {};
  const remote = run('git', ['remote', 'get-url', ge.remote || 'origin']);
  const remoteOk = !remote.error && remote.status === 0;
  report(remoteOk ? 'PASS' : 'MISS', 'git', `remote '${ge.remote || 'origin'}'`, remoteOk ? 'configured' : 'absent (clone from GitHub or re-add)');
  if (WIN) {
    // core.longpaths matters only where paths can exceed MAX_PATH; asserting it elsewhere would
    // invent a defect the platform does not have.
    const lp = run('git', ['config', '--get', 'core.longpaths']);
    const lpOk = (lp.stdout || '').trim() === 'true';
    report(lpOk ? 'PASS' : 'MISS', 'git', 'core.longpaths', lpOk ? 'true' : "not 'true' - restore doc requires it on Windows");
  }

  // --- verdict --------------------------------------------------------------------------------
  console.log('');
  if (missRequired === 0) {
    const msg = 'bootstrap: environment COMPLETE (0 required items missing)';
    console.log(msg);
    logAppend(msg);
    process.exit(0);
  } else {
    const msg = `bootstrap: ${missRequired} required item(s) MISSING - see MISS lines above`;
    console.log(msg);
    logAppend(msg);
    process.exit(2);
  }
} catch (e) {
  const msg = `BOOTSTRAP SCRIPT ERROR: ${e.stack || e.message}`;
  console.log(msg);
  logAppend(msg);
  process.exit(1);
}
