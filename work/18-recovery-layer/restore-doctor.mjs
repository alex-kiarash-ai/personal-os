#!/usr/bin/env node
// work/18-recovery-layer/restore-doctor.mjs - can this clone actually become Alex? (P6.4, run-47.)
// Ported from restore-doctor.ps1 during the 2026-08-25 powershell-branch reconciliation.
//
// WHY THIS EXISTS. Run 46 measured the fresh-clone path a FRACTURE: a clone gets the functional
// system and none of the identity, the skill links are machine-local and silently absent, and
// `vault/identity.md` - the compendium a restore is supposed to read FIRST - arrives only inside the
// encrypted tar. All of that is DELIBERATE (the repo is public), and all of it was written down as
// prose in a restore runbook, which is the one form a checker cannot read and a panicking human is
// least likely to follow correctly.
//
// This turns that runbook into a diagnosis. It is the RESTORE-side sibling of check.mjs: check.mjs
// asks "is the running system consistent", this asks "could this tree become a running system".
// Read-only. Exit 0 = ready · 2 = gaps found (expected on a bare clone) · 1 = doctor error.
//
//   node work/18-recovery-layer/restore-doctor.mjs [--json]

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
process.chdir(REPO);

const JSON_OUT = process.argv.includes('--json');

const findings = [];
const addF = (level, what, detail, fix) => findings.push({ level, what, detail, fix });
const exists = (p) => fs.existsSync(p);
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

try {
  // 1. IDENTITY. The single thing a clone can never carry, and the thing that makes Alex Alex.
  const soulP = path.join(REPO, 'soul.md');
  if (exists(soulP)) {
    const soulKb = Math.round((fs.statSync(soulP).size / 1024) * 10) / 10;
    addF('OK', 'soul.md present', `${soulKb} KB`, '');
  } else {
    addF(
      'BLOCKER',
      'soul.md is absent',
      'A clone never carries it (gitignored by design, public repo). Without it this tree is Claude Code, not Alex.',
      'Restore the encrypted vault tar FIRST; everything else below depends on it.'
    );
  }
  if (exists(path.join(REPO, 'soul-core.md'))) {
    addF('OK', 'soul-core.md present', 'The compiled identity card the CLAUDE.md @import loads.', '');
  } else {
    addF(
      'WARN',
      'soul-core.md is absent',
      'Sessions fall back to the BOUNDED soul.md fallback (8KB + a loud warning since P3.2). Degraded, not silent.',
      'node scripts/lib/build-soul-core.js --force'
    );
  }

  // 2. THE RESTORE COMPENDIUM. Prose, but the prose a human needs before anything else.
  if (exists(path.join(REPO, 'vault', 'identity.md'))) {
    addF('OK', 'vault/identity.md present', 'The restore compendium.', '');
  } else {
    addF(
      'BLOCKER',
      'vault/identity.md is absent',
      'This is the file a restore is supposed to read first, and it rides only in the encrypted tar.',
      'Restore the tar, then read vault/identity.md before running anything else.'
    );
  }

  // 3. SKILL LINKS. Machine-local, gitignored, and silently missing after any clone.
  const agents = path.join(REPO, '.agents', 'skills');
  const links = path.join(REPO, '.claude', 'skills');
  if (exists(agents)) {
    const have = fs
      .readdirSync(agents, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    const lock = readJson(path.join(REPO, 'skills-lock.json'));
    const parked = lock && lock.skills ? Object.keys(lock.skills).filter((n) => lock.skills[n].parked) : [];
    const missing = have.filter((n) => !parked.includes(n) && !exists(path.join(links, n)));
    if (missing.length) {
      addF(
        'BLOCKER',
        `${missing.length} skill link(s) missing`,
        `MANDATORY-bound skills silently unloadable. First few: ${missing.slice(0, 4).join(', ')}`,
        'node scripts/bootstrap.mjs --repair-links'
      );
    } else {
      addF('OK', 'Skill links resolve', `${have.length - parked.length} active, ${parked.length} parked`, '');
    }
  }

  // 4. LONG PATHS. A restore-time trap that fails LATE and confusingly if unset. Windows-only:
  //    on any other platform the setting is a no-op, so asserting it there would invent a defect.
  if (process.platform === 'win32') {
    const lp = spawnSync('git', ['config', 'core.longpaths'], { encoding: 'utf8', cwd: REPO });
    if ((lp.stdout || '').trim() === 'true') {
      addF('OK', 'core.longpaths enabled', '', '');
    } else {
      addF(
        'WARN',
        'core.longpaths is not enabled',
        'Deep paths fail to check out on Windows, usually mid-restore and with an unhelpful error.',
        'git config core.longpaths true   (clone with: git clone -c core.longpaths=true ...)'
      );
    }
  }

  // 5. RE-INCLUDED SYSTEM FILES. The five system/ files that must survive the default-deny.
  const mustTrack = [
    'system/manifest.json',
    'system/hq-heal-map.json',
    'system/skills-sources.json',
    'system/landscape-log.jsonl',
    'system/environment-schema.json',
  ];
  const absent = mustTrack.filter((p) => !exists(path.join(REPO, p)));
  if (absent.length) {
    addF('BLOCKER', 'Tracked system files missing', absent.join(', '), 'The clone is incomplete - re-clone rather than patching by hand.');
  } else {
    addF('OK', 'Tracked system files present', `${mustTrack.length} checked`, '');
  }

  // 6. LOCAL-ONLY STATE that a clone legitimately lacks. Reported so nobody mistakes it for damage.
  for (const p of ['system/recall/facts.db', 'scripts/vault-index/vault-search.db']) {
    if (exists(path.join(REPO, p))) {
      addF('OK', `${p} present`, '', '');
    } else {
      addF(
        'INFO',
        `${p} absent (regenerable)`,
        'Not a defect: rebuilt by the nightly 21:35 chain or on demand.',
        'node system/recall/harvest.js   /   python3 scripts/vault_search.py build'
      );
    }
  }

  // 7. THE OUT-OF-REPO IDENTITY DOCS. The exact pair the 08-21 Desktop move silently dropped from the
  //    backup for two nights (run-46 N1). Path read from the manifest, never hardcoded - that fourth
  //    hardcoded copy IS what caused N1.
  try {
    const mp = readJson(path.join(REPO, 'system', 'manifest.json'))?.meta?.paths || {};
    let idDir = String(mp.identity_doc_real_dir || '');
    idDir = idDir
      .replace(/%([^%]+)%/g, (_, v) => process.env[v] || '')
      .replace(/^~(?=$|[\\/])/, process.env.HOME || process.env.USERPROFILE || '~');
    if (idDir && exists(idDir)) {
      addF('OK', 'Identity docs reachable', idDir, '');
    } else {
      addF(
        'WARN',
        'Identity docs not at the manifest path',
        idDir || '(manifest key meta.paths.identity_doc_real_dir missing)',
        'They live outside the repo and ride only the encrypted tar. Restore it, or correct meta.paths.identity_doc_real_dir if they moved.'
      );
    }
  } catch (e) {
    addF('WARN', 'Could not resolve the identity-doc path', e.message, 'Check meta.paths.identity_doc_real_dir in system/manifest.json.');
  }

  const blockers = findings.filter((f) => f.level === 'BLOCKER');
  const warns = findings.filter((f) => f.level === 'WARN');

  if (JSON_OUT) {
    console.log(JSON.stringify({ ready: blockers.length === 0, blockers: blockers.length, warnings: warns.length, findings }, null, 2));
  } else {
    console.log('');
    console.log('  Restore doctor - can this tree become Alex?');
    console.log('  ' + '-'.repeat(60));
    for (const f of findings) {
      const tag = f.level === 'OK' ? '  ok   ' : f.level === 'INFO' ? ' info  ' : f.level === 'WARN' ? ' warn  ' : 'BLOCKER';
      console.log(`  [${tag}] ${f.what}`);
      if (f.detail) console.log(`            ${f.detail}`);
      if (f.fix && f.level !== 'OK') console.log(`            fix: ${f.fix}`);
    }
    console.log('  ' + '-'.repeat(60));
    if (blockers.length === 0) console.log(`  READY. ${warns.length} warning(s).`);
    else console.log(`  NOT READY: ${blockers.length} blocker(s), ${warns.length} warning(s). Work top to bottom.`);
  }

  process.exit(blockers.length ? 2 : 0);
} catch (e) {
  console.error(`restore-doctor error: ${e.stack || e.message}`);
  process.exit(1);
}
