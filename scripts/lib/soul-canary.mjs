// scripts/lib/soul-canary.mjs
// Headless soul.md injection GATE (feedback P0.1 + P0.2).
// Ported from scripts/lib/soul-canary.ps1 (bash migration Phase 2, 2026-08-05).
//
// The problem: scheduled `claude -p` jobs are assumed to receive soul.md via the SessionStart hook,
// but nothing proved it from a run. A brief (or worse, prose in Shaheen's name) generated with
// CLAUDE.md orders present but soul.md absent looks fine and is silently off-voice.
//
// The gate, and why it can't be faked or replayed:
//   - A high-entropy token lives ONLY in soul.md prose (SOUL-CANARY-TOKEN: <hex>). It is never put
//     in the prompt. The wrapper asks the model to emit "the token from soul.md" plus a per-run
//     NONCE. The model can only produce the token if soul.md actually reached its context, and can
//     only produce THIS nonce if the line came from THIS run (a cached/replayed transcript carries
//     an old nonce). Token present + nonce fresh = soul was injected, this run. Anything else fails.
//   - On failure the gate LOGS, pushes run_status RED to Alex HQ, and exits 1. It blocks; it does
//     not just write a status line someone has to read.
//
// ARMING, preserved exactly: the gate only fires when a SOUL-CANARY-TOKEN exists in soul.md AND a
// wrapper passes a nonce. With no token / no nonce it is inert, so wiring this file into a wrapper
// can never disturb the existing scheduled jobs.
//
// ONE PORT CHANGE: the nonce now comes from crypto.randomBytes instead of Get-Random. Get-Random is
// seeded from the system clock and is NOT cryptographically random - two wrappers firing in the
// same tick could draw the same nonce, which would weaken exactly the replay property this gate is
// built on. randomBytes is the honest primitive and costs nothing.
//
// Tests: scripts/tests/soul-canary.test.mjs (offline gate logic),
//        scripts/tests/soul-canary-live.test.mjs (real `claude -p`, opt-in).

import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { paths, secret, HQ_TOKEN_ID, HQ_PUSH_URL } from './paths.mjs';
import https from 'node:https';

function logLine(log, msg) {
  if (!log) return;
  try {
    fs.appendFileSync(log, `${msg}\n`, 'utf8');
  } catch {
    /* never die because the log is unwritable */
  }
}

/** 64-bit random hex, regenerated per run so a replayed/cached transcript cannot satisfy the gate. */
export function newSoulNonce() {
  return crypto.randomBytes(8).toString('hex');
}

/** The SOUL-CANARY-TOKEN value from soul.md, or null when the gate is not armed. */
export function getSoulToken(soulPath = paths.soulMd()) {
  if (!fs.existsSync(soulPath)) return null;
  const m = /SOUL-CANARY-TOKEN:\s*([0-9a-f]{12,})/i.exec(fs.readFileSync(soulPath, 'utf8'));
  return m ? m[1] : null;
}

/**
 * Appended to the headless prompt. The token is deliberately NOT included here; the model must
 * supply it from soul.md, which is the whole proof.
 *
 * REWRITTEN 2026-08-05 after the pen-test suite measured a ~40% flake rate since 2026-07-20
 * (morning-brief 18 pass / 12 fail, email-triage 11 pass / 14 fail). Three design faults, all
 * in the ASK rather than in the injection, and the log proves it:
 *   (a) COLLIDING FINAL-LINE ORDERS. This block said "the very last line must be SOUL-OK"; the
 *       wrappers then append the verdict instruction ("end your final message with ... Verdict:").
 *       Two instructions cannot both own the last line, so the model resolved it differently on
 *       different runs. Fixed by SEQUENCING both explicitly instead of each claiming primacy.
 *   (b) CONFABULATION. The model invented plausible tokens rather than looking one up
 *       ("SOUL-OK eyJ-kiarash <nonce>", "SOUL-OK brkb-canary-2026 <nonce>" - real log lines).
 *       An opaque 16-hex value buried in a 143KB file is a retrieval task, and an un-anchored
 *       retrieval task is where a model guesses. Fixed by naming the exact anchor line to copy
 *       from and forbidding a guess outright.
 *   (c) DROPPED NONCE. "SOUL-OK <the-real-token>" with the nonce omitted (real log line). Fixed
 *       by showing the shape as two required fields with the nonce pre-filled and marked verbatim.
 * The gate still cannot be faked: the token is still never in the prompt, and the nonce is still
 * per-run. This only makes the honest answer easy to give and the guess explicitly disallowed.
 */
export function soulCanaryInstruction(nonce) {
  return `

Close-out requirement (do not skip, and do not summarise it away):
End your response with these two lines, in this exact order, nothing after them:

  1. the Close-Out Report line, ending in 'Verdict: COMPLETE' or 'Verdict: INCOMPLETE(<missed>)'
  2. SOUL-OK <token> ${nonce}

For line 2: <token> is copied VERBATIM from the line beginning 'SOUL-CANARY-TOKEN:' in soul.md
(near the top of the file, and again in its own block lower down). Copy the value character for
character. NEVER guess, abbreviate, or invent it, and never substitute a placeholder. Reproduce
the nonce '${nonce}' exactly as given; both fields are required.
If soul.md is genuinely not in your context and you cannot find that line, print instead:
SOUL-MISSING ${nonce}`;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Pure verdict function (no side effects) so it is unit-testable.
 * @returns {{pass: boolean, reason: string, token: string|null}}
 */
export function testSoulCanary(out, nonce, soulPath = paths.soulMd()) {
  const text = typeof out === 'string' ? out : '';
  const token = getSoulToken(soulPath);
  if (!token) {
    return { pass: false, reason: `no SOUL-CANARY-TOKEN in ${soulPath} (gate not armed)`, token: null };
  }
  const n = esc(nonce);
  const t = esc(token);
  // Order matters and mirrors the original: the specific diagnoses come before the generic miss,
  // because "wrong token" and "stale nonce" are different incidents with different fixes.
  if (new RegExp(`SOUL-OK\\s+${t}\\s+${n}(\\s|$)`, 'i').test(text)) {
    return { pass: true, reason: 'soul injected + fresh (token+nonce matched)', token };
  }
  if (new RegExp(`SOUL-MISSING\\s+${n}(\\s|$)`, 'i').test(text)) {
    return { pass: false, reason: 'model reported SOUL-MISSING (soul.md absent from context)', token };
  }
  if (new RegExp(`SOUL-OK\\s+\\S+\\s+${n}(\\s|$)`, 'i').test(text)) {
    return { pass: false, reason: 'wrong token for this nonce (soul.md not injected or altered)', token };
  }
  // Correct token, nonce omitted entirely (real 2026-08-05 log line: "SOUL-OK <the-real-token>").
  // Still a FAIL - without the nonce there is no freshness proof, so the gate stays closed. But the
  // DIAGNOSIS matters: the token is unguessable, so its presence proves soul.md DID reach the model
  // and only the line shape was wrong. Before this case existed the run fell through to the catch-all
  // and reported "soul canary absent", which is the opposite of what happened; that false reading is
  // what made a formatting flake look like an identity outage for two weeks. (Added 2026-08-05.)
  if (new RegExp(`SOUL-OK\\s+${t}\\s*(\\r?\\n|$)`, 'i').test(text)) {
    return { pass: false, reason: 'token correct but nonce omitted (soul DID reach the model; canary line malformed, no freshness proof)', token };
  }
  if (new RegExp(`SOUL-OK\\s+${t}\\s+\\S+`, 'i').test(text)) {
    return { pass: false, reason: 'token matched but nonce stale (possible replay/cache)', token };
  }
  return { pass: false, reason: 'no SOUL-OK line for this run (soul canary absent)', token };
}

function hqPush(body, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let token;
    try {
      token = secret(HQ_TOKEN_ID);
    } catch (e) {
      reject(e);
      return;
    }
    const payload = JSON.stringify(body);
    const u = new URL(HQ_PUSH_URL);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'X-Alex-Token': token,
        },
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        res.on('end', () =>
          res.statusCode >= 200 && res.statusCode < 300 ? resolve() : reject(new Error(`HTTP ${res.statusCode}`))
        );
      }
    );
    req.on('timeout', () => req.destroy(new Error(`timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * THE GATE. On failure: log, push run_status RED to Alex HQ, and (default) exit 1 so the run is
 * treated as the degraded run it is. softFail only flags (resolves false) for a run that is not
 * shipping content in Shaheen's name.
 *
 * NOTE for wrapper authors (stress-test fix F-04): if you want the miss to inherit the Close-Out
 * Gate's full semantics (RED headline + retry ladder) rather than a bare exit 1, call this with
 * softFail and hand the reason to `close-out.mjs check --degraded-reason`. That is the sanctioned
 * path and the reason --degraded-reason exists.
 *
 * @returns {Promise<boolean>} true = passed. May not return at all (exit 1) on a hard fail.
 */
export async function assertSoulCanary({
  out,
  nonce,
  log,
  soulPath = paths.soulMd(),
  project = '',
  softFail = false,
  dryRun = false,
}) {
  const r = testSoulCanary(out, nonce, soulPath);
  if (r.pass) {
    logLine(log, `SOUL-CANARY OK: ${r.reason}`);
    return true;
  }
  logLine(log, `SOUL-CANARY FAIL: ${r.reason}`);

  if (project !== '' && !dryRun) {
    try {
      await hqPush({
        project,
        metric_key: 'run_status',
        value_num: 0,
        headline: `soul canary failed: ${r.reason}`,
        status: 'red',
      });
      logLine(log, `HQ red push sent (soul canary, project=${project})`);
    } catch (e) {
      logLine(log, `HQ push failed: ${e.message}`);
    }
  }

  if (dryRun || softFail) return false;
  process.exit(1);
}

// --- CLI -----------------------------------------------------------------------------------------
// Wrappers use `nonce` and `instruction` before the spawn, and `assert` after it.
async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const a = {};
  for (let i = 1; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      if (eq !== -1) a[t.slice(2, eq)] = t.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) a[t.slice(2)] = argv[++i];
      else a[t.slice(2)] = true;
    }
  }

  switch (cmd) {
    case 'nonce':
      process.stdout.write(newSoulNonce());
      return 0;

    case 'armed':
      // Exit 0 when a token exists in soul.md, 1 when it does not. Lets a wrapper decide whether to
      // bother appending the instruction, without ever printing the token itself.
      return getSoulToken(a.soul || paths.soulMd()) ? 0 : 1;

    case 'instruction': {
      if (!a.nonce) {
        process.stderr.write('soul-canary.mjs instruction: --nonce is required\n');
        return 2;
      }
      process.stdout.write(soulCanaryInstruction(a.nonce));
      return 0;
    }

    case 'assert': {
      let out = '';
      if (a['out-file']) {
        try {
          out = fs.readFileSync(a['out-file'], 'utf8');
        } catch {
          out = '';
        }
      } else if (typeof a.out === 'string') {
        out = a.out;
      }
      const ok = await assertSoulCanary({
        out,
        nonce: a.nonce || '',
        log: a.log || '',
        soulPath: a.soul || paths.soulMd(),
        project: a.project || '',
        softFail: Boolean(a['soft-fail']),
        dryRun: Boolean(a['dry-run']),
      });
      return ok ? 0 : 1;
    }

    default:
      process.stderr.write(
        'soul-canary.mjs: unknown subcommand\n' +
          'usage:\n' +
          '  soul-canary.mjs nonce\n' +
          '  soul-canary.mjs armed [--soul <path>]                # exit 0 = armed\n' +
          '  soul-canary.mjs instruction --nonce <hex>\n' +
          '  soul-canary.mjs assert --nonce <hex> --log <file> [--out-file <f> | --out <s>]\n' +
          '                         [--project <key>] [--soft-fail] [--dry-run]\n'
      );
      return 2;
  }
}

// fileURLToPath, not URL.pathname: pathname on Windows yields '/C:/...' which realpathSync
// mangles into 'C:\C:' and throws, so the module could not even be imported there (found 2026-08-25
// while porting the P-01 canary fixes; same platform-agnostic class as the 86ff0f7 backports).
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main().then(
    (c) => process.exit(c),
    (e) => {
      process.stderr.write(`soul-canary.mjs: ${e.stack || e.message}\n`);
      process.exit(1);
    }
  );
}
