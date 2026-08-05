#!/usr/bin/env node
// scripts/lib/secret-env.mjs
// The bash-side door to a declared credential (bash migration Phase 3, 2026-08-05).
//
// WHY IT EXISTS: several wrappers need a credential in the ENVIRONMENT of a child process (the n8n
// API key, so landscape-monitor's deployed-version probe can read the live writer model). The
// PowerShell version opened a literal in-repo path and did `$env:N8N_API_KEY = Get-Content ...`.
// Ruling A moves those files out of the repo, so no script may name a credential path again.
//
// This prints ONE credential's value to stdout so the caller can do:
//     N8N_API_KEY="$(node scripts/lib/secret-env.mjs --read n8n-api-key)"
//
// SAFETY, deliberately:
//   - --check tells you whether it resolves WITHOUT printing anything, so a wrapper can branch on
//     availability without ever putting the value on a pipeline it does not need.
//   - The value goes to STDOUT only, so it lands in a shell variable. It is never an argument to
//     anything, so it never appears in `ps` output or a shell history file.
//   - Errors go to stderr and never contain the value.
//   - It refuses to run when stdout is a TTY unless --force, so an idle `node secret-env.mjs
//     --read hq-token` in a terminal cannot casually paint a credential onto the screen (or into a
//     scrollback buffer, or a screen share).

import { secret, hasSecret, secretPath } from './paths.mjs';

const argv = process.argv.slice(2);
const mode = argv[0];
const id = argv[1];
const force = argv.includes('--force');

if (!id || !['--check', '--read', '--path'].includes(mode)) {
  process.stderr.write(
    'usage:\n' +
      '  secret-env.mjs --check <id>          # exit 0 if it resolves, prints nothing\n' +
      '  secret-env.mjs --read  <id> [--force] # prints the value to stdout\n' +
      '  secret-env.mjs --path  <id>          # prints where it resolved (no value)\n'
  );
  process.exit(2);
}

try {
  if (mode === '--check') {
    process.exit(hasSecret(id) ? 0 : 1);
  }
  if (mode === '--path') {
    process.stdout.write(secretPath(id));
    process.exit(0);
  }
  if (process.stdout.isTTY && !force) {
    process.stderr.write(
      `secret-env.mjs: refusing to print '${id}' to a terminal. ` +
        'Capture it into a variable instead, or pass --force if you really mean to look at it.\n'
    );
    process.exit(3);
  }
  process.stdout.write(secret(id));
} catch (e) {
  process.stderr.write(`secret-env.mjs: ${e.message}\n`);
  process.exit(1);
}
