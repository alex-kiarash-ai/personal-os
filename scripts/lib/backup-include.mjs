#!/usr/bin/env node
// scripts/lib/backup-include.mjs
// The include-set logic of the encrypted vault backup (bash migration Phase 6, 2026-08-05).
//
// Split out of vault-backup.sh on purpose (migration plan §0): deciding WHAT goes into the archive is
// list-building, filtering and JSON - the work bash is worst at and the part that must never quietly
// go wrong. The shell keeps tar/gpg/scp, which is genuine shell work.
//
// THE CENTRAL PROPERTY, preserved exactly: the include set is DERIVED FROM .gitignore
// (`git ls-files --others --ignored`), so it CANNOT drift from what is local-only. Nobody maintains a
// parallel list of "things to back up"; the thing that decides what stays off GitHub is the same
// thing that decides what must be backed up. That is the whole design.
//
// THREE TAR LEGS, because three sets of files live in three places:
//   1. the ignored in-repo surface   (vault/, soul.md, work/*/config, exports)   - relative to the repo
//   2. the identity docs             (out of the repo since 2026-07-21)          - own -C anchor
//   3. the relocated secrets         (out of the repo since ruling A)            - own -C anchor  <-- NEW
//
// Leg 3 is the cost of ruling A and it is the single most important line in this phase. Moving the
// secrets outside the repo removed them from `git ls-files --others --ignored`, which means they
// silently stopped being covered by the backup. A relocated secret that quietly stops being backed up
// is the ONE way that ruling can hurt you, and you would only find out during a restore. So they get
// their own leg AND a positive by-name assertion inside the decrypted archive, exactly like the
// identity docs already have.
//
// Usage:
//   node scripts/lib/backup-include.mjs --list-file <path>   writes the -T list, prints a JSON plan
//   node scripts/lib/backup-include.mjs --plan               prints the JSON plan only (dry run)

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, metaPaths, secretsDir, secretPath } from './paths.mjs';

// Regenerable build/runtime junk. Excluded because restoring it is worthless and taring it is slow.
const JUNK = /(^|\/)(node_modules|\.next|venv|__pycache__|outputs|\.browser-profile|\.obsidian)\/|\.(pyc|log|tmp|lock)$|\/\.pbi\/|(^|\/)\.DS_Store$|next-env\.d\.ts$/;

// Irreplaceable outputs (audit step 7, 2026-07-06): deliverables that exist nowhere else (PBIP
// dashboard, monthly workbooks, final reports). outputs/ stays excluded as a CLASS; only these named
// folders ride along. weekly-exec-report added 2026-07-11 (#10 writes there; reports/ is frozen
// legacy). ledger.jsonl added the same day: hand-written description rows are not regenerable,
// though skeleton rows are.
const KEEP_OUTPUTS = [
  'outputs/alex-costs',
  'outputs/reports',
  'outputs/runway',
  'outputs/expense-wrangler',
  'outputs/weekly-exec-report',
  'outputs/ledger.jsonl',
];

// The four declared credentials. Named here so the archive assertion can be POSITIVE (assert these
// exist inside the decrypted tar) rather than merely "we tarred a directory".
const SECRET_IDS = ['alex-hq-token', 'hq-basic-auth', 'n8n-api-key', 'qra-token'];

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
};

function buildPlan() {
  // --- leg 1: the ignored in-repo surface --------------------------------------------------------
  const r = spawnSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`git ls-files failed: ${(r.stderr || '').trim()}`);

  const list = String(r.stdout || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((p) => !JUNK.test(p))
    .map((p) => p.replace(/\/+$/, '')) // tar's -T rejects directory entries with a trailing slash
    .filter((p) => fs.existsSync(path.join(ROOT, p)));

  for (const k of KEEP_OUTPUTS) if (fs.existsSync(path.join(ROOT, k))) list.push(k);

  // REFUSAL GUARD, kept verbatim in spirit: a thin include set means something upstream broke
  // (a bad .gitignore, a wrong cwd, a failed git). Shipping it would overwrite a good backup on the
  // box with an almost-empty one, which is worse than not backing up at all tonight.
  if (list.length < 5) {
    throw new Error(`include list too small (${list.length} paths) - refusing to ship a thin backup`);
  }

  // --- leg 2: the identity docs (out of repo) ----------------------------------------------------
  // Ruling B: ~/Documents/alex-project/story-and-guides/ on the Linux host. The rename dropped the
  // space and the ampersand that the old 'Alex Project/Story & Guides' carried, which removes a
  // permanent quoting hazard from every script that ever touches this path.
  // The include list above is built from `git ls-files` INSIDE the repo, so it can never reach these.
  const mp = metaPaths();
  const identityReal = mp.identity_doc_real_dir || path.join(process.env.HOME || '', 'Documents', 'alex-project', 'story-and-guides');
  const identityRoot = path.dirname(identityReal);
  const identityLeaf = path.basename(identityReal);
  const identityOk = fs.existsSync(identityReal);

  // --- leg 3: the relocated secrets (ruling A) ---------------------------------------------------
  const secDir = secretsDir();
  const secRoot = path.dirname(secDir);
  const secLeaf = path.basename(secDir);
  const secretsOk = fs.existsSync(secDir);
  const secretFilesPresent = secretsOk
    ? fs.readdirSync(secDir).filter((f) => fs.statSync(path.join(secDir, f)).isFile())
    : [];

  // WHICH secrets get a by-name assertion, and this distinction is the whole point of the leg.
  //
  // The first version of this derived the assertion list from WHAT IS ON DISK, which is worthless
  // against the hazard it exists for: if a secret file vanished, the list simply got shorter and the
  // backup still passed. Caught by the negative test at build. The assertion must be against the
  // DECLARED set, so a missing credential is loud rather than invisible.
  //
  // Three outcomes per declared id:
  //   inSecretsDir - it lives in the relocated dir, so leg 3 carries it -> ASSERT IT BY NAME.
  //   elsewhere    - it still resolves at a pre-migration in-repo path, so leg 1 already carries it
  //                  via the .gitignore derivation. Not asserted here (it is not in this leg), but
  //                  reported so the un-migrated file is visible.
  //   unresolved   - nothing on this machine holds it. NOT an error: qra-token is genuinely not
  //                  provisioned everywhere. Reported so "this credential has no backup coverage"
  //                  is a thing you can read, rather than a silence.
  const secretsDeclared = [];
  for (const id of SECRET_IDS) {
    let resolved = null;
    try {
      resolved = secretPath(id);
    } catch {
      resolved = null;
    }
    if (!resolved) {
      secretsDeclared.push({ id, state: 'unresolved' });
    } else if (path.dirname(path.resolve(resolved)) === path.resolve(secDir)) {
      secretsDeclared.push({ id, state: 'inSecretsDir', file: path.basename(resolved) });
    } else {
      secretsDeclared.push({ id, state: 'elsewhere', at: resolved });
    }
  }

  return {
    repoPaths: list,
    count: list.length,
    identity: { ok: identityOk, root: identityRoot, leaf: identityLeaf, path: identityReal },
    secrets: {
      ok: secretsOk, root: secRoot, leaf: secLeaf, path: secDir,
      files: secretFilesPresent,
      declared: secretsDeclared,
      unresolved: secretsDeclared.filter((d) => d.state === 'unresolved').map((d) => d.id),
      elsewhere: secretsDeclared.filter((d) => d.state === 'elsewhere').map((d) => `${d.id} (${d.at})`),
    },
    // What the post-decrypt verification must find BY NAME. "It was appended" is not proof it is in
    // the shipped blob.
    assertNames: [
      ...(identityOk ? ['ALEX-OS-master.md', 'Alex-Plain-English-Guide.docx'] : []),
      ...secretsDeclared.filter((d) => d.state === 'inSecretsDir').map((d) => `${secLeaf}/${d.file}`),
    ],
    keep: 14,
  };
}

function main() {
  const plan = buildPlan();
  const listFile = getArg('--list-file');
  if (listFile) {
    // LF endings, no BOM: tar's -T treats a trailing \r as part of the path. (The PowerShell version
    // needed an explicit UTF8Encoding(false) to avoid a BOM; Node writes clean by default, so that
    // dance is gone rather than translated.)
    fs.writeFileSync(listFile, plan.repoPaths.join('\n') + '\n', 'utf8');
  }
  process.stdout.write(JSON.stringify(plan, null, 2));
  return 0;
}

try {
  process.exit(main());
} catch (e) {
  process.stderr.write(`backup-include: ${e.message}\n`);
  process.exit(1);
}
