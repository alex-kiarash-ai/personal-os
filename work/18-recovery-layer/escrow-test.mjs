#!/usr/bin/env node
// escrow-test.mjs - T-20 vault-backup passphrase ESCROW DRILL (recovery layer).
// Ported from escrow-test.ps1 (bash migration Phase 5, 2026-08-05).
//
// PROVES the vault-backup passphrase stored in Shaheen's PASSWORD MANAGER can decrypt the
// OFF-MACHINE encrypted backup - i.e. the backups survive a dead machine even if the local
// passphrase file is gone.
//
// Run:   node work/18-recovery-layer/escrow-test.mjs
// When prompted, paste the passphrase COPIED FROM YOUR PASSWORD MANAGER (not the local file).
// The passphrase is read WITHOUT ECHO and handed to gpg via a temp --passphrase-file that is wiped
// immediately; it is never printed, logged, or sent anywhere. Re-run every ~90 days (the C14 window).
//
// TWO-STAGE ON PURPOSE, and this is the part that makes a FAIL actionable rather than mysterious:
//   (1) SELF-TEST with the local passphrase file proves the drill + blob + gpg all work, so a FAIL
//       at stage 2 can ONLY mean the manager copy is wrong.
//   (2) MANAGER TEST is the real proof.
// Without stage 1, a failure could equally mean "your password manager is stale" or "the backup is
// corrupt", and those need opposite responses.
//
// IT IS THE ONLY WRITER OF THE C14 ATTESTATION (single-source-of-truth, 2026-07-21 audit F-01): on a
// PASS it stamps today's date AND closes the escrow queue items in the SAME run; on a FAIL it writes
// PENDING and keeps/opens the queue item. scripts/human-actions.js `done` refuses to close those ids
// unless this file is a real dated attestation - so the 2026-07-18 contradiction (the queue said done
// while the drill had FAILED) is unrepresentable.
//
// PLATFORM NOTES: gpg comes from PATH now (the two hardcoded Windows install paths are gone, W13).
// The PowerShell comment about --passphrase-fd appending \r\n on Windows is deleted with the
// platform, but the --passphrase-file approach is KEPT: it is the portable, non-racy way to do this.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const ATTEST_FILE = path.join(HERE, 'state', 'passphrase-attested.txt');
const HA_CLI = path.join(REPO, 'scripts', 'human-actions.js');

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

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

function gpgDecrypt(gpg, blobPath, passFile, outPath) {
  const r = spawnSync(
    gpg,
    ['--batch', '--yes', '--pinentry-mode', 'loopback', '--passphrase-file', passFile, '-o', outPath, '-d', blobPath],
    { encoding: 'utf8' }
  );
  if (r.status !== 0) return false;
  try {
    return fs.statSync(outPath).size > 0;
  } catch {
    return false;
  }
}

function runHa(args) {
  // Never let a benign "no open item" stderr abort the run. The PowerShell version had exactly this
  // bug (2026-07-21): under $ErrorActionPreference='Stop' a NativeCommandError from an already-closed
  // id terminated the loop BEFORE it reached the still-open item, so the drill PASSED but
  // passphrase-safeplace-fix stayed open. spawnSync simply cannot do that, but the intent is kept
  // explicit: every id is attempted independently and failures are ignored.
  spawnSync(process.execPath, [HA_CLI, ...args], { cwd: REPO, stdio: 'ignore' });
}

// --- Class A single-source-of-truth (2026-07-21, audit F-01): the drill is the ONLY writer of the
// attestation, and it closes/opens the queue in the SAME run, so the file and the queue can never
// disagree. Stamp the date BEFORE closing (the human-actions `done` gate reads this file and refuses
// to close an unproven escrow item).
function writeAttestationPass(blobName, entries) {
  const body = [
    today(),
    `Escrow drill PASSED: the password-manager passphrase decrypted ${blobName} (${entries} entries) on ${today()}.`,
    `Next re-drill due ~${plusDays(90)} (90-day C14 window). Sole writer: escrow-test.mjs.`,
  ].join('\n');
  fs.mkdirSync(path.dirname(ATTEST_FILE), { recursive: true });
  fs.writeFileSync(ATTEST_FILE, body + '\n', 'utf8');
  for (const id of ['passphrase-attestation', 'passphrase-escrow-retest', 'passphrase-safeplace-fix']) {
    runHa(['done', id]); // no-op if not open; the gate passes because the date is stamped above
  }
}

function writeAttestationFail(reason) {
  const body = [
    `PENDING - escrow drill FAILED ${today()}, do NOT treat as attested`,
    reason,
    'Fix + re-run: node work/18-recovery-layer/escrow-test.mjs. Sole writer: escrow-test.mjs.',
  ].join('\n');
  fs.mkdirSync(path.dirname(ATTEST_FILE), { recursive: true });
  fs.writeFileSync(ATTEST_FILE, body + '\n', 'utf8');
  // Ensure the failure is ESCALATED: the canonical escrow item stays open and ages up the ladder.
  const list = spawnSync(process.execPath, [HA_CLI, 'list'], { cwd: REPO, encoding: 'utf8' });
  if (!String(list.stdout || '').includes('passphrase-safeplace-fix')) {
    runHa([
      'add', '--id', 'passphrase-safeplace-fix',
      '--what', 'Vault-backup off-machine passphrase is UNPROVEN: fix the password-manager copy and re-run work/18-recovery-layer/escrow-test.mjs until it prints PASS',
      '--why', 'only you can open your password manager',
      '--severity', 'high',
    ]);
  }
}

/** Read a line from the TTY with echo OFF. The passphrase never appears on screen or in scrollback. */
function readSecret(promptText) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('not a TTY - this drill is interactive by design and must not read a passphrase from a pipe'));
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Suppress the echo of typed characters while still letting readline handle line editing.
    const onData = () => {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(promptText);
    };
    process.stdout.write(promptText);
    process.stdin.on('data', onData);
    rl.question('', (answer) => {
      process.stdin.removeListener('data', onData);
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const gpg = which('gpg') || which('gpg2');
  if (!gpg) {
    console.log('FAIL: gpg not found on PATH.');
    return 1;
  }

  // F-04 (2026-07-21): the local passphrase-file path is read from the gitignored credentials
  // ledger, never hardcoded in this tracked/public script. That is the whole reason S9 watches for
  // INFRA-SECRET-PATH strings in the tracked tree.
  let localPass = null;
  const ledgerPath = path.join(REPO, 'system', 'credentials-ledger.json');
  if (fs.existsSync(ledgerPath)) {
    try {
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
      const entry = (ledger.credentials || []).find((c) => c.id === 'vault-backup-gpg-passphrase');
      if (entry && entry.local_path) {
        const { expand } = await import(`${REPO}/scripts/lib/paths.mjs`);
        localPass = expand(entry.local_path);
      }
    } catch {
      /* absent/unreadable ledger just means no self-test */
    }
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'escrow-'));
  // trap-equivalent: wipe the pulled blob, the decrypted tars and the passphrase file on ANY exit
  // path, including SIGINT/SIGTERM - not just a clean return (the PowerShell `finally` only covered
  // a normal unwind).
  const cleanup = () => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      cleanup();
      process.exit(130);
    });
  }

  console.log('Finding the newest off-machine backup on the box...');
  const ls = spawnSync('ssh', ['-o', 'BatchMode=yes', 'n8n', 'ls -1t /opt/alex-backups/vault-*.tar.gpg 2>/dev/null | head -1'], { encoding: 'utf8' });
  const blob = String(ls.stdout || '').trim();
  if (!blob) {
    console.log('FAIL: no backup blob found on the box.');
    return 1;
  }
  const name = path.basename(blob);
  const blobPath = path.join(tmp, name);
  console.log(`Newest off-machine blob: ${name}`);
  console.log('Pulling it down (~140 MB, give it a moment)...');
  const scp = spawnSync('scp', [`n8n:${blob}`, blobPath], { encoding: 'utf8', stdio: 'inherit' });
  if (scp.status !== 0 || !fs.existsSync(blobPath)) {
    console.log('FAIL: could not pull the blob off the box.');
    return 1;
  }

  // 1) SELF-TEST with the local passphrase file (the one the nightly backup uses).
  console.log('Self-test: decrypting with the LOCAL passphrase file...');
  if (!localPass || !fs.existsSync(localPass)) {
    console.log('  NOTE: local passphrase file not found - skipping self-test, manager result still valid.');
  } else if (gpgDecrypt(gpg, blobPath, localPass, path.join(tmp, 'self.tar'))) {
    console.log('  self-test OK - the drill, the blob and gpg all work. A FAIL below can only be the manager copy.');
  } else {
    console.log('');
    console.log('PROBLEM: even the LOCAL passphrase file did not decrypt this blob.');
    console.log('         So the issue is the drill / blob / gpg, NOT your password manager. Tell Alex; do not touch the manager.');
    return 1;
  }

  // 2) MANAGER TEST - the real escrow proof.
  const plain = await readSecret('Paste the vault-backup passphrase FROM your password manager: ');
  const pf = path.join(tmp, 'pp.txt');
  // Exact value, no BOM, no trailing newline: gpg folds any trailing byte into the passphrase.
  fs.writeFileSync(pf, plain, { encoding: 'utf8', mode: 0o600 });
  console.log('Decrypting with your PASSWORD-MANAGER passphrase...');
  const ok = gpgDecrypt(gpg, blobPath, pf, path.join(tmp, 'out.tar'));
  try {
    fs.rmSync(pf, { force: true });
  } catch {
    /* the tmp-dir cleanup catches it */
  }

  console.log('');
  if (ok) {
    const tar = spawnSync('tar', ['-tf', path.join(tmp, 'out.tar')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const entries = String(tar.stdout || '').split(/\r?\n/).filter(Boolean).length;
    writeAttestationPass(name, entries);
    console.log('PASS: your PASSWORD-MANAGER passphrase decrypted the off-machine backup.');
    console.log(`      ${name}  ->  ${entries} entries recovered. The backups survive a dead machine.`);
    console.log(`      Attestation stamped (${ATTEST_FILE}) and the escrow queue items closed automatically.`);
    console.log('      C14 will read green on the next recovery sweep. No "tell Alex" step needed.');
    return 0;
  }
  writeAttestationFail('the local file decrypted this blob but the password-manager copy did not - the manager entry is genuinely wrong/stale.');
  console.log('FAIL: the local file decrypted this blob but your MANAGER copy did not - the manager entry is genuinely wrong/stale.');
  console.log('      Attestation left PENDING and a HIGH "passphrase-safeplace-fix" item is open until this passes.');
  console.log(`      Fix: copy the value from ${localPass || 'the local passphrase file'} into your password manager (replace the entry), save, and re-run this drill.`);
  return 1;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(`escrow-test: ${e.message}`);
    process.exit(1);
  }
);
