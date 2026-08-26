// scripts/lib/close-out.mjs
// Shared Close-Out Gate mechanical checks for the scheduled Personal Ops System wrappers.
// Canonical mechanism for the Close-Out Gate (vault/research/alex-close-out-gate.md).
//
// PORTED FROM scripts/lib/close-out.ps1 (bash migration Phase 2, 2026-08-05). The behavior is a
// contract, not an implementation detail: this file was built over three real blackout incidents
// (2026-06-26 / 06-29 / 06-30) and hardened by five numbered bugs. Every gate below carries the
// reason it exists. DO NOT "simplify" one without reading the incident it names.
//
// Implements:
//   A1 - blocked/degraded detection (blank output, wrapper crash, not-logged-in, usage/session
//        limit, non-zero claude exit, mid-stream stop, missing verdict line) so a dead run is
//        never silently reported as success.
//   A4 - RED run_status push to Alex HQ on failure (only when a project key is given), so a
//        failed scheduled run shows up on the health board instead of dying quiet.
// On failure it exits 1 so the caller's retry policy can act; on success it exits 0. The GREEN
// push stays inside each automation's own post-run, exactly as before.
//
// TWO THINGS CHANGED IN THE PORT, both deliberate:
//   1. The retry ladder registers a transient systemd unit instead of a Windows scheduled task
//      (W8). Same 5 attempts, same +90 min, same ALEX_RETRY_ATTEMPT env var. The plan is explicit
//      that the LADDER IS NOT SIMPLIFIED here even though systemd's Restart=on-failure would
//      make it redundant: changing failure-recovery behavior during a platform move makes any
//      incident un-diagnosable. That simplification is a separate, later decision.
//   2. The calling wrapper's path arrives as --wrapper instead of being sniffed from the
//      PowerShell call stack. Bash has no equivalent of Get-PSCallStack, and an explicit
//      argument is honest. A wrapper that forgets it gets the same "path unknown" skip line.
//
// TWO THINGS DELETED, because the hazard no longer exists:
//   - The utf8-BOM avoidance dance ("node consumers choke on PS 5.1's utf8 BOM"). Node writes
//     BOM-free by default.
//   - The warning about PowerShell's case-insensitive variables silently clobbering $Reason with
//     $DegradedReason (the F-04 bug). JavaScript identifiers are case-sensitive; porting a
//     warning about an impossible hazard would be cargo cult.
//
// ONE THING CAREFULLY PRESERVED THAT IS EASY TO GET WRONG: PowerShell's `-match` operator is
// CASE-INSENSITIVE by default. Every ported pattern therefore carries the /i flag. Dropping it
// would silently narrow detection (e.g. an "Usage limit reached" line would stop matching), which
// is the exact class of regression this gate exists to prevent.
//
// Usage from a bash wrapper:
//   node scripts/lib/close-out.mjs quota-gate --project crm --log "$LOG"     # exit 10 = skip slot
//   node scripts/lib/close-out.mjs check --project crm --code "$code" \
//        --log "$LOG" --out-file "$TMPOUT" --wrapper "$0"
// Project omitted (or '') = detect + exit only, no HQ push (for wrappers with no run_status tile).

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { paths, manifest, secret, HQ_TOKEN_ID, HQ_PUSH_URL, hasSystemd, ROOT } from './paths.mjs';

// --- Item 1 completion sentinel: the ONE home for the verdict-line instruction (2026-07-20) -------
// Every claude-spawning wrapper appends this to its prompt so a run POSITIVELY proves it finished:
// the Close-Out Report's verdict line is that proof, and a run that dies partway never reaches it.
// Defined here, read by the wrappers through `close-out.mjs verdict-instruction`, so a future
// format change is ONE edit. The string is a behavioral contract with the sentinel check below.
export const ALEX_VERDICT_INSTRUCTION =
  "End your final message with the Close-Out Report line, ending in 'Verdict: COMPLETE' or 'Verdict: INCOMPLETE(<missed>)'.";

// --- logging -------------------------------------------------------------------------------------
// Every diagnostic line the PowerShell version wrote is written here too, verbatim where the text
// carried meaning. The run log is read by the checkers and by a human after an incident, so the
// wording is part of the interface.
function logLine(log, msg) {
  if (!log) return;
  try {
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.appendFileSync(log, `${msg}\n`, 'utf8');
  } catch {
    /* a wrapper must never die because its log is unwritable */
  }
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function hhmm(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// --- Alex HQ push --------------------------------------------------------------------------------
// Never log the token; never let a push crash the wrapper. 10s timeout, same as the PowerShell
// -TimeoutSec 10. Synchronous-by-await so the caller can exit immediately afterwards without
// losing the request.
function hqToken() {
  try {
    return secret(HQ_TOKEN_ID);
  } catch {
    return null;
  }
}

function hqPush(body, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const token = hqToken();
    if (!token) {
      reject(new Error('token file missing'));
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
        res.resume(); // drain, we do not care about the body
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(new Error(`HTTP ${res.statusCode}`));
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error(`timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// --- quota state ---------------------------------------------------------------------------------
function readQuotaState() {
  const p = paths.quotaState();
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeQuotaState(q) {
  fs.writeFileSync(paths.quotaState(), `${JSON.stringify(q, null, 2)}\n`, 'utf8');
}

function runNode(args) {
  // human-actions.js is CommonJS and lives at the repo root; call it the same way the PowerShell
  // did, and swallow its exit code (a `done` on a non-open item exits 1 by design).
  return spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'ignore' });
}

/**
 * P3 quota-state writer (upgrade 2026-07-12, design 1.7.1).
 * One shared code path for flagging a detected cap. Kind 'plan' = the Claude subscription limit
 * (auto-resets in hours; the gate's 6h TTL handles recovery). Kind 'api' = the Anthropic Console
 * monthly cap (also auto-appends the Console-raise row to the human-actions queue, idempotent).
 */
export function setQuotaCapped(kind, log) {
  if (kind !== 'plan' && kind !== 'api') throw new Error(`setQuotaCapped: kind must be plan|api, got ${kind}`);
  try {
    const q = readQuotaState();
    if (!q) {
      logLine(log, `quota-state write failed: ${paths.quotaState()} not found`);
      return;
    }
    const now = stamp();
    if (kind === 'api') {
      // BUG-02 fix (2026-07-15): only enqueue the Console-raise row on the ok->capped TRANSITION,
      // never on every capped re-detection during a weeks-long cap. Otherwise a closed-then-recapped
      // item resurrects and poisons the "waiting on you" queue's trust.
      const wasCapped = q.anthropic_api?.state === 'capped';
      q.anthropic_api = q.anthropic_api || {};
      q.anthropic_api.state = 'capped';
      q.anthropic_api.detected = now;
      if (!wasCapped) {
        runNode([
          'scripts/human-actions.js', 'add',
          '--id', 'cap-raise-console',
          '--what', 'Raise the Anthropic API monthly limit in Console (cap re-detected by a wrapper)',
          '--why', 'Console account access is yours alone',
          '--severity', 'critical',
        ]);
      }
    } else {
      q.claude_plan = q.claude_plan || {};
      q.claude_plan.state = 'capped';
      q.claude_plan.detected = now;
    }
    writeQuotaState(q);
    logLine(log, `quota-state updated: ${kind} capped at ${now}`);
  } catch (e) {
    logLine(log, `quota-state write failed: ${e.message}`);
  }
}

/**
 * P3 quota-state disarm (FIX-01 class, 2026-07-15 /prompting item 6).
 * The mirror of setQuotaCapped. The gate ARMED automatically (limit-detect + auth-check) but
 * nothing DISARMED it, so a lifted cap left a stale 'capped' flag until cleared by hand (FIX-01,
 * cleared 2 days late). One shared clear path with verify-after-write built in.
 * Clears only what is actually 'capped' (idempotent no-op otherwise).
 *
 * Scope: a clean `claude -p` probe (auth-check / morning-brief) is a PLAN oracle only, so those
 * callers pass kind='plan'. The api (Console monthly) cap clears on reset_date expiry (the gate);
 * an EARLY api lift still needs a future n8n-side success signal - it has no local clear path
 * (documented gap). On an api clear it closes the cap-raise-console human-action, the mirror of
 * arming's enqueue.
 * @returns {boolean} true if it cleared anything.
 */
export function clearQuotaCapped(kind = 'plan', log, reason = 'cleared') {
  let cleared = false;
  try {
    const q = readQuotaState();
    if (!q) return false;
    const now = stamp();
    const doPlan = kind === 'plan' || kind === 'both';
    const doApi = kind === 'api' || kind === 'both';
    if (doPlan && q.claude_plan?.state === 'capped') {
      q.claude_plan.state = 'ok';
      q.claude_plan.detected = null;
      cleared = true;
      logLine(log, `quota-state: claude_plan capped->ok (${reason}) at ${now}`);
    }
    if (doApi && q.anthropic_api?.state === 'capped') {
      q.anthropic_api.state = 'ok';
      q.anthropic_api.detected = null;
      q.anthropic_api.reset_date = null;
      cleared = true;
      logLine(log, `quota-state: anthropic_api capped->ok (${reason}) at ${now}`);
      runNode(['scripts/human-actions.js', 'done', 'cap-raise-console']);
    }
    if (cleared) {
      writeQuotaState(q);
      // Verify-after-write (standing order): read back the mutated field(s), log a mismatch.
      const rb = readQuotaState();
      const bad =
        (doPlan && rb?.claude_plan?.state !== 'ok') || (doApi && rb?.anthropic_api?.state !== 'ok');
      if (bad) {
        logLine(
          log,
          `quota-state CLEAR VERIFY FAILED: plan='${rb?.claude_plan?.state}' api='${rb?.anthropic_api?.state}'`
        );
      } else {
        logLine(log, `quota-state clear verified (${kind}, ${reason})`);
      }
    }
  } catch (e) {
    logLine(log, `quota-state clear failed: ${e.message}`);
  }
  return cleared;
}

/**
 * P3 quota gate (upgrade 2026-07-12, design 1.7.2 / plan Phase 3 step 1).
 * Called at the TOP of a wrapper, BEFORE spawning claude -p.
 *   true  = proceed normally.
 *   false = the Claude PLAN is freshly capped and this project is not a budget-priority winner:
 *           the wrapper runs its deterministic core only (if it has one) and exits 0. An amber
 *           "degraded: quota" run_status has already been pushed here (PARTIAL, not RED - a
 *           degraded run is visible, never alarming, never silent).
 *
 * FAIL-OPEN BY DESIGN, and this is load-bearing: missing/unreadable state file, missing manifest,
 * corrupt JSON, or a capped flag older than 6 hours (plan limits reset in hours; QC risk R4) all
 * return true. A broken gate must never be able to silence the whole job train.
 * budget_priority comes from system/manifest.json (matched on hq_project, then name); <=1 always runs.
 */
export async function testQuotaGate(log, project = '') {
  let q;
  try {
    q = readQuotaState();
  } catch {
    return true; // corrupt JSON: fail open
  }
  if (!q) return true;

  // Edit 2 (FIX-01 class, 2026-07-15 /prompting item 6): date-expiry disarm, so a lapsed cap never
  // lingers 'capped'. Deterministic, zero-token, fail-open. The api (Console monthly) cap clears when
  // its recorded reset_date has passed; the plan cap clears on its >6h TTL below. This is the missing
  // DISARM half - before it, the gate ignored a stale flag but never cleared it (the FIX-01 asymmetry).
  try {
    if (q.anthropic_api?.state === 'capped' && q.anthropic_api.reset_date) {
      const rd = new Date(q.anthropic_api.reset_date);
      if (!Number.isNaN(rd.getTime()) && Date.now() >= rd.getTime()) {
        clearQuotaCapped('api', log, 'api reset_date passed');
      }
    }
  } catch {
    /* fail open */
  }

  const plan = q.claude_plan;
  if (!plan || plan.state !== 'capped') return true;

  let detected = null;
  if (plan.detected) {
    const d = new Date(plan.detected);
    if (!Number.isNaN(d.getTime())) detected = d;
  }
  if (!detected || (Date.now() - detected.getTime()) / 3600000 > 6) {
    // A plan cap resets in hours, so a flag older than the 6h TTL is stale: CLEAR it, don't just
    // fail-open (the silent fail-open left the flag 'capped' forever - the FIX-01 asymmetry).
    if (detected) clearQuotaCapped('plan', log, 'plan >6h TTL expired');
    return true;
  }

  let pri = 3;
  try {
    const man = manifest();
    const row = (man.projects || []).find(
      (p) => project !== '' && (p.hq_project === project || p.name === project)
    );
    if (row && row.budget_priority) pri = parseInt(row.budget_priority, 10);
  } catch {
    /* no manifest: default priority, still gated */
  }
  if (pri <= 1) {
    logLine(log, `quota gate: plan capped but budget_priority=${pri}, proceeding`);
    return true;
  }

  logLine(
    log,
    `quota gate: claude_plan capped (detected ${plan.detected}), DEGRADED - core-only/skip (priority ${pri})`
  );
  if (project !== '') {
    // Same shape as the RED push below: an absent token is "not configured", not "failed". Saying
    // "push failed" for a machine that simply has no HQ token trains you to ignore the line.
    if (!hqToken()) {
      logLine(log, 'quota gate: amber push skipped, token file missing');
    } else {
      try {
        await hqPush({
          project,
          metric_key: 'run_status',
          value_num: 0,
          headline: 'degraded: quota (plan limit) - deterministic core only this slot',
          status: 'amber',
        });
      } catch (e) {
        logLine(log, `quota gate: amber push failed: ${e.message}`);
      }
    }
  }
  return false;
}

// --- A1 detection --------------------------------------------------------------------------------
// PURE, on purpose: it returns the verdict and the quota side effect it WANTS, and the caller
// applies it. The PowerShell version wrote quota state inline, which made the detection logic
// untestable without a real state file. Same order, same outcomes, now exercisable by a unit test.
//
// @returns {{reason: string|null, quotaKind: 'plan'|'api'|null, sentinelLog: string|null,
//            degradedLog: string|null}}

const firstLineMatching = (out, re) => (out.split(/\r?\n/).find((l) => re.test(l)) || null);
const lastLineMatching = (out, re) => {
  const hits = out.split(/\r?\n/).filter((l) => re.test(l));
  return hits.length ? hits[hits.length - 1] : null;
};
const clip = (s) => (s.length > 140 ? s.slice(0, 140) : s);

export function detectFailure({ out, code = 0, degradedReason = '' }) {
  const text = typeof out === 'string' ? out : '';
  let reason = null;
  let quotaKind = null;
  let sentinelLog = null;
  let degradedLog = null;

  // Content-pattern checks (not-logged-in / limit) only apply to SHORT output: a genuinely blocked
  // run emits nothing but the error line (<~500 chars), while a real run emits kilobytes. Without
  // the gate, a successful run whose PROSE mentions the incident ("died on the session limit")
  // false-flags itself - happened live 2026-07-06 22:03 (morning-brief catch-up brief).
  const nonWs = text.replace(/\s/g, '');
  const short = nonWs.length < 500;

  if (nonWs.length === 0) {
    reason = 'blank output (silent fail)';
  } else if (/WRAPPER EXCEPTION/i.test(text)) {
    const line = firstLineMatching(text, /WRAPPER EXCEPTION/i);
    reason = clip(line ? line.trim() : 'wrapper exception');
  } else if (short && /Not logged in|Please run \/login/i.test(text)) {
    reason = 'not logged in - needs interactive claude /login';
  } else if (short && /session limit|usage limit|API usage limits|reached your .{0,40}limit/i.test(text)) {
    const line = firstLineMatching(text, /limit/i);
    reason = clip(line ? line.trim() : 'usage/session limit');
    // P3 quota writer (design 1.7.1): a detected limit updates the shared quota state so the
    // pre-run gate degrades the NEXT wrappers instead of letting each one die the same death.
    quotaKind = /API usage limits/i.test(reason) ? 'api' : 'plan';
  } else if (code !== 0) {
    reason = `claude exit code ${code}`;
  }

  // BUG-05 fix (2026-07-15): a run that streams >500 chars of real work, THEN hits the cap and exits 0,
  // escapes the short-gated limit patterns above and would be scored green ("died dark, reported green").
  // Catch it by scanning the TAIL of the output (last 400 chars) for the harness's hard-limit signature:
  // a limit notice in the tail means the run died mid-stream, whereas a limit merely *mentioned* earlier
  // in prose (the 2026-07-06 false-flag class) is not in the tail. Un-gated by total length.
  if (reason === null) {
    const tail = text.length > 400 ? text.slice(text.length - 400) : text;
    if (/reached your .{0,40}limit|API usage limits|Please run \/login/i.test(tail)) {
      const tl = lastLineMatching(tail, /limit|\/login/i);
      reason = clip(
        tl ? `mid-stream stop: ${tl.trim()}` : 'mid-stream usage/session limit (tail-detected, exit 0)'
      );
      quotaKind = /API usage limits/i.test(tail) ? 'api' : 'plan';
    }
  }

  // --- Positive-completion sentinel (item 1, STAGE 2 = ENFORCING since 2026-07-21, audit O-01) ---
  // A run that emitted real work (>500 non-ws chars, so not `short`) and exited 0 but printed NO
  // Close-Out verdict line in its TAIL is a candidate truncation / silent mid-stream stop - the one
  // class the error-signature gates above cannot see (there is no error to match). The verdict line
  // is a POSITIVE proof of finish; absence-of-error is not. Every claude-spawning wrapper appends
  // ALEX_VERDICT_INSTRUCTION, so a healthy run ALWAYS ends in the verdict line; its absence in a
  // long run means the run died dark before finishing. STAGE 1 (warn-only, 2026-07-20) observed a
  // week clean; flipped to ENFORCING (audit O-01): the miss sets a reason -> RED + self-retry,
  // closing the last "died dark, reported green" gap. (Revert to warn-only by not setting reason.)
  if (reason === null && !short) {
    const vtail = text.length > 400 ? text.slice(text.length - 400) : text;
    if (!/Verdict:\s*(COMPLETE|INCOMPLETE)/i.test(vtail)) {
      reason = 'no Close-Out verdict line in a >500-char run (truncated / mid-stream stop, exit 0)';
      sentinelLog = `sentinel ENFORCING: ${reason}`;
    }
  }

  // Caller-supplied degradation (2026-07-25, stress-test fix F-04): a wrapper that detects its OWN
  // degraded condition (the soul canary missing on a voice-shipping lane is the first case) passes
  // it here instead of inventing a parallel failure path - so the miss inherits this ONE path's
  // semantics: precise RED headline, the retry ladder, exit 1. Applied only if A1 found nothing
  // itself: a real A1 error is the more urgent diagnosis AND carries side effects, so it wins.
  // Guarded on non-empty so an omitted argument can never fail a healthy run.
  if (reason === null && degradedReason && degradedReason.trim() !== '') {
    reason = degradedReason;
    degradedLog = `caller-reported degradation: ${reason}`;
  }

  return { reason, quotaKind, sentinelLog, degradedLog };
}

/**
 * The DELIBERATELY NARROWER check for an OPTIONAL pass (the sprint-tracker prose pass is the only
 * caller today). That pass is allowed to fail: the deterministic core already wrote the numbers and
 * greened HQ, so a capped week is an accepted degradation, not an incident.
 *
 * Reusing detectFailure() here would be wrong in a specific way worth stating: its completion
 * sentinel and its tail scan would turn every accepted degradation into a RED plus a retry ladder,
 * i.e. a false alarm on exactly the weeks the core-first design was built to survive quietly.
 *
 * @returns {string} the reason, or '' when the optional pass was healthy enough.
 */
export function detectProseFailure({ out, code = 0 }) {
  const text = typeof out === 'string' ? out : '';
  const nonWs = text.replace(/\s/g, '');
  const short = nonWs.length < 500;
  if (nonWs.length === 0) return 'blank output';
  if (/PROSE EXCEPTION/i.test(text)) return 'prose exception';
  if (short && /Not logged in|Please run \/login/i.test(text)) return 'not logged in';
  if (short && /session limit|usage limit|API usage limits/i.test(text)) return 'usage/session limit';
  if (code !== 0) return `claude exit ${code}`;
  return '';
}

// --- the retry ladder ----------------------------------------------------------------------------
// Added 2026-07-06. Windows Task Scheduler's RestartCount does NOT fire on a non-zero exit code
// (proven 2026-07-06: four exit-1 limit failures at 07:30-09:00, RestartCount=4 on every task,
// zero restarts). So a failed wrapper schedules its OWN one-shot retry 90 min out, up to 4 retries
// (attempts 2-5), so a transient quota/auth window self-heals. The attempt number rides
// ALEX_RETRY_ATTEMPT.
//
// systemd's Restart=on-failure DOES fire on a non-zero exit, so on Linux this ladder is arguably
// redundant. It is ported as-is anyway, on purpose (migration plan §2.2): changing failure-recovery
// behavior during a platform move makes any incident un-diagnosable. Simplifying it is a separate,
// later decision with its own verification.
function scheduleRetry({ reason, log, wrapper, dryRun }) {
  let attempt = 1;
  const envAttempt = process.env.ALEX_RETRY_ATTEMPT;
  if (envAttempt && /^\d+$/.test(envAttempt)) attempt = parseInt(envAttempt, 10);

  if (!wrapper) {
    logLine(log, 'retry skipped: calling wrapper path unknown');
    return;
  }
  if (attempt >= 5) {
    logLine(log, `retry chain exhausted (attempt ${attempt}/5), giving up until the next scheduled slot`);
    return;
  }

  // BUG-03 fix (2026-07-15): a week-scale Anthropic API cap is still capped in 90 min, so waking
  // to re-hit it is pure battery/token drain across ~13 wrappers x 4 retries. Skip the retry; the
  // next scheduled slot covers recovery. A transient plan/auth cap is NOT matched here, so it
  // still self-heals as before.
  if (/API usage limits/i.test(reason)) {
    let apiCapped = false;
    try {
      apiCapped = readQuotaState()?.anthropic_api?.state === 'capped';
    } catch {
      /* unreadable state: fall through and retry, the old behavior */
    }
    if (apiCapped) {
      logLine(log, 'retry skipped: known persistent Anthropic API cap (next scheduled slot covers recovery)');
      return;
    }
  }

  const next = attempt + 1;
  const base = path.basename(wrapper).replace(/\.[^.]+$/, '');
  const rname = `PersonalOS-retry-${base}-${next}`;
  const rat = new Date(Date.now() + 90 * 60 * 1000);

  if (dryRun) {
    logLine(log, `DRYRUN, would register ${rname} at ${hhmm(rat)}`);
    return;
  }

  // Ruling C: the job train runs on Linux; development happens on macOS. A LOUD SKIP on a machine
  // with no systemd, never a silent no-op and never a crash - a dev-box run must still complete
  // its detection and its RED push.
  if (!hasSystemd()) {
    logLine(
      log,
      `retry NOT scheduled: no systemd on this machine (platform=${process.platform}). ` +
        `Would have registered ${rname} at ${hhmm(rat)}. This is expected on the macOS dev box; ` +
        `on the Linux host it means systemd is unreachable and the retry ladder is DOWN.`
    );
    return;
  }

  try {
    const res = spawnSync(
      'systemd-run',
      [
        '--user',
        '--collect', // transient units self-delete, cleaner than the Windows DeleteExpiredTaskAfter hack
        `--unit=${rname}`,
        '--on-active=90min',
        `--setenv=ALEX_RETRY_ATTEMPT=${next}`,
        `--property=WorkingDirectory=${ROOT}`,
        '--property=RuntimeMaxSec=7200', // the old ExecutionTimeLimit of 2 hours
        wrapper,
      ],
      { encoding: 'utf8' }
    );
    if (res.status === 0) {
      logLine(log, `retry ${next}/5 scheduled: ${rname} at ${hhmm(rat)}`);
    } else {
      logLine(log, `retry registration failed: ${(res.stderr || res.error?.message || `exit ${res.status}`).trim()}`);
    }
  } catch (e) {
    logLine(log, `retry registration failed: ${e.message}`);
  }
}

// --- the gate ------------------------------------------------------------------------------------
/**
 * @returns {Promise<number>} process exit code: 0 = healthy, 1 = failure detected.
 */
export async function closeOutCheck({
  out,
  code = 0,
  log,
  project = '',
  degradedReason = '',
  wrapper = '',
  dryRun = false,
}) {
  const { reason, quotaKind, sentinelLog, degradedLog } = detectFailure({ out, code, degradedReason });

  if (quotaKind) setQuotaCapped(quotaKind, log);
  if (sentinelLog) logLine(log, sentinelLog);
  if (degradedLog) logLine(log, degradedLog);

  // P1.1: stamp the run id into the log on BOTH paths. This is the third leg of the D1 join - the
  // ledger rows and heal-log rows for this run carry the same id, so one grep across three files
  // reconstructs a run instead of three manual excavations across three timestamp conventions.
  // ALEX_RUN_ID is set by log_init in common.sh (one definition, 17 wrappers, no per-wrapper
  // drift); an interactive session has none, and that absence is itself information.
  const runId = process.env.ALEX_RUN_ID || '';

  if (reason === null) {
    logLine(log, `OK (exit ${code}) run=${runId}`);
    return 0;
  }

  logLine(log, `FAILED: ${reason} run=${runId}`);

  // --- A4: RED run_status push to Alex HQ. Never log the token; never let the push crash the wrapper.
  if (project !== '') {
    const body = {
      project,
      metric_key: 'run_status',
      value_num: 0,
      headline: `scheduled run failed: ${reason}`,
      status: 'red',
    };
    if (dryRun) {
      logLine(log, `DRYRUN, would push: ${JSON.stringify(body)}`);
    } else if (!hqToken()) {
      logLine(log, 'HQ push skipped: token file missing');
    } else {
      try {
        await hqPush(body);
        logLine(log, `HQ red push sent (project=${project})`);
      } catch (e) {
        logLine(log, `HQ push failed: ${e.message}`);
      }
    }
  } else {
    logLine(log, 'HQ push skipped: no run_status tile for this wrapper');
  }

  scheduleRetry({ reason, log, wrapper, dryRun });
  return 1;
}

// --- CLI -----------------------------------------------------------------------------------------
// The bash wrappers' whole interface to this file. Subcommands mirror the PowerShell functions
// one-for-one so the port is auditable against the original.

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      if (eq !== -1) a[t.slice(2, eq)] = t.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) a[t.slice(2)] = argv[++i];
      else a[t.slice(2)] = true;
    } else a._.push(t);
  }
  return a;
}

// Exit codes, which the wrappers depend on:
//   quota-gate: 0 = proceed, 10 = skip this slot (degraded). ANY internal error also exits 0,
//               because the gate is fail-open by design and a crash must not silence the train.
//   check:      0 = healthy, 1 = failure detected (same as the PowerShell `exit 1`).
const EXIT_SKIP_SLOT = 10;

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const a = parseArgs(argv.slice(1));
  const log = a.log || '';
  const project = a.project || '';

  switch (cmd) {
    case 'verdict-instruction':
      process.stdout.write(ALEX_VERDICT_INSTRUCTION);
      return 0;

    case 'quota-gate': {
      try {
        const proceed = await testQuotaGate(log, project);
        return proceed ? 0 : EXIT_SKIP_SLOT;
      } catch (e) {
        // Fail-open, loudly. A broken gate must never be able to stop the job train.
        logLine(log, `quota gate: FAILED OPEN on an internal error: ${e.message}`);
        return 0;
      }
    }

    case 'check': {
      let out = '';
      if (a['out-file']) {
        try {
          out = fs.readFileSync(a['out-file'], 'utf8');
        } catch (e) {
          // An unreadable capture file is itself a wrapper failure, and it must present as one
          // rather than as a healthy empty run.
          out = `WRAPPER EXCEPTION: cannot read captured output at ${a['out-file']}: ${e.message}`;
        }
      } else if (typeof a.out === 'string') {
        out = a.out;
      }
      return closeOutCheck({
        out,
        code: a.code !== undefined ? parseInt(a.code, 10) || 0 : 0,
        log,
        project,
        degradedReason: a['degraded-reason'] || '',
        wrapper: a.wrapper || '',
        dryRun: Boolean(a['dry-run']),
      });
    }

    // hq-push exists so a bash wrapper never has to hold the token itself. Eight PowerShell files
    // each open the token file, build the JSON and call Invoke-RestMethod; in bash that would mean
    // eight copies of a curl line with a credential on the command line, where `ps` can see it.
    // One subcommand instead: the token never leaves Node, and the GREEN/AMBER heartbeat pushes the
    // wrappers do on success get the same timeout and the same never-crash-the-wrapper behavior as
    // the RED push above. Always exits 0: a heartbeat that cannot be delivered is a logged problem,
    // never a failed run.
    case 'hq-push': {
      const status = a.status || 'green';
      const body = {
        project: project,
        metric_key: a.metric || 'run_status',
        value_num: a.value !== undefined ? Number(a.value) : status === 'green' ? 1 : 0,
        headline: a.headline || '',
        status,
      };
      if (!project) {
        logLine(log, 'HQ push skipped: no project key given');
        return 0;
      }
      if (a['dry-run']) {
        logLine(log, `DRYRUN, would push: ${JSON.stringify(body)}`);
        return 0;
      }
      if (!hqToken()) {
        logLine(log, 'HQ push skipped: token file missing');
        return 0;
      }
      try {
        await hqPush(body);
        logLine(log, `HQ ${status} push sent (project=${project}, ${body.metric_key})`);
      } catch (e) {
        logLine(log, `HQ push failed: ${e.message}`);
      }
      return 0;
    }

    // Prints the reason an OPTIONAL pass degraded, or nothing at all when it was healthy. Always
    // exits 0: the caller decides what a non-empty reason means, because for an optional pass it
    // means PARTIAL, not failure.
    case 'prose-reason': {
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
      process.stdout.write(detectProseFailure({ out, code: a.code !== undefined ? parseInt(a.code, 10) || 0 : 0 }));
      return 0;
    }

    case 'quota-set':
      setQuotaCapped(a.kind, log);
      return 0;

    case 'quota-clear':
      clearQuotaCapped(a.kind || 'plan', log, a.reason || 'cleared');
      return 0;

    default:
      process.stderr.write(
        'close-out.mjs: unknown subcommand\n' +
          'usage:\n' +
          '  close-out.mjs verdict-instruction\n' +
          '  close-out.mjs quota-gate --log <file> [--project <key>]        # exit 10 = skip slot\n' +
          '  close-out.mjs check --log <file> [--project <key>] [--code N]\n' +
          '                      [--out-file <file> | --out <string>]\n' +
          '                      [--degraded-reason <text>] [--wrapper <path>] [--dry-run]\n' +
          '  close-out.mjs hq-push --project <key> --log <file> [--status green|amber|red]\n' +
          '                        [--metric <key>] [--value <n>] [--headline <text>] [--dry-run]\n' +
          '  close-out.mjs prose-reason --out-file <file> [--code N]   # optional-pass check\n' +
          '  close-out.mjs quota-set --kind plan|api --log <file>\n' +
          '  close-out.mjs quota-clear [--kind plan|api|both] --log <file> [--reason <text>]\n'
      );
      return 2;
  }
}

// Run only when invoked directly, so the test suite can import the functions above.
// fileURLToPath, not URL.pathname: pathname on Windows yields '/C:/...' which realpathSync
// mangles into 'C:\C:' and throws at import time (found 2026-08-25 during the powershell-branch
// reconciliation; same platform-agnostic class as the 86ff0f7 backports).
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main().then(
    (c) => process.exit(c),
    (e) => {
      process.stderr.write(`close-out.mjs: ${e.stack || e.message}\n`);
      process.exit(1);
    }
  );
}
