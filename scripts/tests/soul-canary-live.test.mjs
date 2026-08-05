// scripts/tests/soul-canary-live.test.mjs
// LIVE integration test (feedback P0.2): invoke `claude -p` headless and assert the SessionStart
// hook actually injects soul.md into the model's context. The test that turns "the headless path
// is reasoned about" into "confirmed from a log".
// Ported from scripts/tests/test-soul-canary-live.ps1 (bash migration Phase 2, 2026-08-05).
//
// How it isolates the HOOK (not the model's own file access):
//   - The sandbox lives OUTSIDE the repo, with its own soul.md carrying a fresh high-entropy token.
//   - claude runs with a --settings file whose SessionStart hook is `cat ./soul.md` (mirrors prod).
//   - ALL file-reading tools are disabled, so the model cannot open soul.md itself. If it can still
//     emit the token, the token came from HOOK INJECTION.
//   - If the hook does NOT fire headless, the token is nowhere in context and the model emits
//     SOUL-MISSING (or no line) -> the test FAILS loudly, which is the finding we want.
//
// COSTS ONE SMALL CLAUDE CALL, so it is OPT-IN and skips by default. That is a change from the
// PowerShell version, which always ran: a test that spends money must never be something `npm test`
// does to you by surprise.
//   ALEX_LIVE_TESTS=1 node --test scripts/tests/soul-canary-live.test.mjs
// Keep the sandbox for inspection with ALEX_KEEP_SANDBOX=1.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { newSoulNonce, testSoulCanary } from '../lib/soul-canary.mjs';

const LIVE = process.env.ALEX_LIVE_TESTS === '1';
const MODEL = process.env.ALEX_LIVE_TEST_MODEL || 'claude-haiku-4-5-20251001';

function resolveClaude() {
  if (process.env.ALEX_CLAUDE_BIN) return process.env.ALEX_CLAUDE_BIN;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const cand = path.join(dir, 'claude');
    try {
      fs.accessSync(cand, fs.constants.X_OK);
      return cand;
    } catch {
      /* not here */
    }
  }
  const local = path.join(os.homedir(), '.local', 'bin', 'claude');
  return fs.existsSync(local) ? local : null;
}

test(
  'headless SessionStart hook injects soul.md into a `claude -p` run',
  { skip: LIVE ? false : 'set ALEX_LIVE_TESTS=1 to run (costs one small claude call)' },
  () => {
    const claude = resolveClaude();
    assert.ok(claude, 'claude CLI not found; set ALEX_CLAUDE_BIN');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-live-'));
    try {
      // A fresh token in the SANDBOX soul.md only. It exists nowhere else on the machine, so the
      // model echoing it is proof of injection rather than of recall.
      const token = crypto.randomBytes(8).toString('hex');
      const nonce = newSoulNonce();
      const soulPath = path.join(dir, 'soul.md');
      fs.writeFileSync(
        soulPath,
        `# Soul (sandbox)\n\nSOUL-CANARY-TOKEN: ${token}\n\nThis file exists only to test headless injection.\n`
      );

      const settingsPath = path.join(dir, 'hook-settings.json');
      fs.writeFileSync(
        settingsPath,
        JSON.stringify(
          { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'cat ./soul.md' }] }] } },
          null,
          2
        )
      );

      const prompt =
        'Do not use any tools. Answer only from what is already in your context. ' +
        `Your entire response must be exactly one line: SOUL-OK <token> ${nonce} ` +
        'where <token> is the SOUL-CANARY-TOKEN value from soul.md. ' +
        `If that token is not in your context, respond exactly: SOUL-MISSING ${nonce}`;

      // No --dangerously-skip-permissions: every file/exec tool is disabled, so the model has
      // nothing to request permission for. It can only answer from injected context.
      const res = spawnSync(
        claude,
        [
          '--settings', settingsPath,
          '--model', MODEL,
          '--disallowed-tools', 'Read', 'Bash', 'Glob', 'Grep', 'Edit', 'Write', 'WebFetch', 'WebSearch',
          '-p', prompt,
        ],
        { cwd: dir, encoding: 'utf8', timeout: 180000 }
      );
      const out = `${res.stdout || ''}${res.stderr || ''}`;
      console.log('--- raw model output ---\n' + out.trim() + '\n------------------------');

      const r = testSoulCanary(out, nonce, soulPath);
      assert.equal(
        r.pass,
        true,
        `${r.reason}\nHeadless soul injection is NOT confirmed. Do not trust voice on scheduled jobs.`
      );
    } finally {
      if (process.env.ALEX_KEEP_SANDBOX === '1') console.log(`sandbox kept: ${dir}`);
      else fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);
