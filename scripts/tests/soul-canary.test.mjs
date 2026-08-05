// scripts/tests/soul-canary.test.mjs
// Offline gate-logic test for the headless soul-injection gate (feedback P0.1/P0.2).
// Ported from scripts/tests/test-soul-canary.ps1 (bash migration Phase 2, 2026-08-05).
//
// Proves the verdict function FAILS CLOSED: only a fresh token+nonce from an injected soul.md
// passes. An unarmed soul, a replayed nonce, a wrong token, a SOUL-MISSING report, or no line at
// all must all fail. That direction matters more than the happy path: a gate that passes by
// default is worse than no gate, because it manufactures confidence.
//
// No network, no claude call. Run: node --test scripts/tests/soul-canary.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  newSoulNonce,
  getSoulToken,
  soulCanaryInstruction,
  testSoulCanary,
  assertSoulCanary,
} from '../lib/soul-canary.mjs';

const TOKEN = 'a1b2c3d4e5f6a7b8';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soulcanary-'));
  fs.writeFileSync(path.join(dir, 'soul.md'), `# Soul\n\nSOUL-CANARY-TOKEN: ${TOKEN}\n\nrest of the soul.\n`);
  fs.writeFileSync(path.join(dir, 'soul-unarmed.md'), '# Soul\n\nno token here.\n');
  return {
    dir,
    armed: path.join(dir, 'soul.md'),
    unarmed: path.join(dir, 'soul-unarmed.md'),
    log: path.join(dir, 'gate.log'),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

test('armed + correct token + fresh nonce -> PASS', () => {
  const s = sandbox();
  try {
    const nonce = newSoulNonce();
    const r = testSoulCanary(`the brief...\nSOUL-OK ${TOKEN} ${nonce}`, nonce, s.armed);
    assert.equal(r.pass, true, r.reason);
    assert.equal(r.token, TOKEN);
  } finally {
    s.cleanup();
  }
});

test('REPLAY: right token, stale nonce from a cached run -> FAIL', () => {
  // The property the nonce exists for. A transcript replayed from an earlier run carries that
  // run's nonce, so it cannot satisfy this one.
  const s = sandbox();
  try {
    const nonce = newSoulNonce();
    const stale = newSoulNonce();
    const r = testSoulCanary(`SOUL-OK ${TOKEN} ${stale}`, nonce, s.armed);
    assert.equal(r.pass, false);
    assert.match(r.reason, /nonce/);
  } finally {
    s.cleanup();
  }
});

test('wrong token for the right nonce -> FAIL (soul.md not injected, or altered)', () => {
  const s = sandbox();
  try {
    const nonce = newSoulNonce();
    const r = testSoulCanary(`SOUL-OK deadbeefdeadbeef ${nonce}`, nonce, s.armed);
    assert.equal(r.pass, false);
    assert.match(r.reason, /wrong token/);
  } finally {
    s.cleanup();
  }
});

test('the model explicitly reporting SOUL-MISSING -> FAIL', () => {
  const s = sandbox();
  try {
    const nonce = newSoulNonce();
    const r = testSoulCanary(`I could not find it.\nSOUL-MISSING ${nonce}`, nonce, s.armed);
    assert.equal(r.pass, false);
    assert.match(r.reason, /SOUL-MISSING/);
  } finally {
    s.cleanup();
  }
});

test('no canary line at all -> FAIL (the silent-failure case the gate exists to catch)', () => {
  const s = sandbox();
  try {
    const nonce = newSoulNonce();
    const r = testSoulCanary('just a normal brief with no canary line', nonce, s.armed);
    assert.equal(r.pass, false);
  } finally {
    s.cleanup();
  }
});

test('UNARMED soul (no token) -> FAIL CLOSED, never a default pass', () => {
  const s = sandbox();
  try {
    const nonce = newSoulNonce();
    const r = testSoulCanary(`SOUL-OK whatever ${nonce}`, nonce, s.unarmed);
    assert.equal(r.pass, false);
    assert.match(r.reason, /not armed/);
  } finally {
    s.cleanup();
  }
});

test('a missing soul.md is also unarmed, not a crash', () => {
  const r = testSoulCanary('SOUL-OK x y', 'y', '/nonexistent/soul.md');
  assert.equal(r.pass, false);
  assert.equal(r.token, null);
  assert.match(r.reason, /not armed/);
});

test('assert in soft-fail mode returns false and logs the miss (does not exit)', async () => {
  const s = sandbox();
  try {
    const nonce = newSoulNonce();
    const res = await assertSoulCanary({ out: 'no line', nonce, log: s.log, soulPath: s.armed, softFail: true });
    assert.equal(res, false);
    assert.match(fs.readFileSync(s.log, 'utf8'), /SOUL-CANARY FAIL/);
  } finally {
    s.cleanup();
  }
});

test('assert logs the PASS too, so a green run leaves evidence and not just silence', async () => {
  const s = sandbox();
  try {
    const nonce = newSoulNonce();
    const res = await assertSoulCanary({
      out: `SOUL-OK ${TOKEN} ${nonce}`,
      nonce,
      log: s.log,
      soulPath: s.armed,
      softFail: true,
    });
    assert.equal(res, true);
    assert.match(fs.readFileSync(s.log, 'utf8'), /SOUL-CANARY OK/);
  } finally {
    s.cleanup();
  }
});

test('the nonce is per-run unique', () => {
  // Now crypto.randomBytes rather than PowerShell's clock-seeded Get-Random, so two wrappers
  // firing in the same tick cannot collide. 200 draws, zero repeats.
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(newSoulNonce());
  assert.equal(seen.size, 200);
});

test('getSoulToken reads the token, and only a plausible one', () => {
  const s = sandbox();
  try {
    assert.equal(getSoulToken(s.armed), TOKEN);
    assert.equal(getSoulToken(s.unarmed), null);
    // Too short to be a real canary: the 12-hex-char floor is what stops a stray word matching.
    const shorty = path.join(s.dir, 'short.md');
    fs.writeFileSync(shorty, 'SOUL-CANARY-TOKEN: abc123\n');
    assert.equal(getSoulToken(shorty), null);
  } finally {
    s.cleanup();
  }
});

test('the instruction never leaks the token (that leak would void the whole proof)', () => {
  const s = sandbox();
  try {
    const nonce = newSoulNonce();
    const instr = soulCanaryInstruction(nonce);
    assert.ok(instr.includes(nonce), 'it must carry the nonce');
    assert.ok(!instr.includes(TOKEN), 'and must NEVER carry the token');
    assert.match(instr, /SOUL-OK <token>/);
    assert.match(instr, /SOUL-MISSING/);
  } finally {
    s.cleanup();
  }
});
