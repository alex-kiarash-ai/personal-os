'use strict';
/*
 * scripts/lib/write-lock.js - the ONE cross-process mutex for repo-surface mutation.
 *
 * WHY (stress-test finding F-08, 2026-07-25): Alex is driven by whatever sessions Shaheen happens to
 * have open, and two of them can mutate the same generated surface at the same time. This is not
 * theoretical - it has happened twice:
 *   - 2026-07-20: three `download this skill` requests fired back-to-back, parallel sessions raced
 *     `skills-lock.json`, and one session's rewrite transiently mis-attributed one skill and DELETED
 *     another. The fix at the time was a mutex INSIDE skills-installer.js, which manual sessions never
 *     call - so the actual incident shape stayed unguarded.
 *   - 2026-07-24: a generator run and a soul.md voice re-sync collided (error-log); it was benign only
 *     because validation happened to fail first.
 * The generator (CLAUDE.md routing region + docs + tokens) and the skills installer (CLAUDE.md
 * ALEX-AUTO-SKILLS region + skills-lock.json) write the SAME files, so they share ONE lock name by
 * design: an interleave between them is exactly what must be impossible.
 *
 * Mechanism: `fs.mkdirSync` is atomic on Windows and POSIX - it either creates the directory or throws
 * EEXIST, with no read-then-write window. A holder file inside carries pid + start time + label so a
 * stuck lock is diagnosable, and a lock older than staleMs (a crashed run) is STOLEN rather than left
 * to wedge the system forever.
 *
 * Semantics are the CALLER's choice, deliberately:
 *   - generate-alex.js FAILS LOUD when it cannot acquire (the caller asked for surfaces to be
 *     regenerated; silently doing nothing would be a lie).
 *   - skills-installer.js DEFERS (its weekly run is opportunistic; the next run picks it up).
 *
 * Usage:
 *   const lock = require('./lib/write-lock');
 *   const held = lock.acquire({ label: 'generate-alex' });
 *   if (!held.ok) { ...caller decides: fail loud or defer... }
 *   try { ...mutate... } finally { held.release(); }
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const DEFAULT_NAME = 'alex-surfaces';        // one name = generator and installer cannot interleave
const DEFAULT_STALE_MS = 30 * 60 * 1000;     // 30 min, same window the installer's local mutex used

function lockPath(name) { return path.join(REPO, `.alex-lock-${name}`); }

function holderOf(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'holder.json'), 'utf8')); }
  catch (_) { return null; }
}

function ageMsOf(dir) {
  try { return Date.now() - fs.statSync(dir).mtimeMs; }
  catch (_) { return Infinity; }
}

/**
 * Try to take the lock. Returns { ok, release(), holder, reason }.
 * `release()` is always safe to call (a no-op when the lock was not held by us).
 */
function acquire({ name = DEFAULT_NAME, label = 'unknown', staleMs = DEFAULT_STALE_MS, log } = {}) {
  const dir = lockPath(name);
  const say = m => { if (typeof log === 'function') log(m); };

  const tryMk = () => {
    fs.mkdirSync(dir);                                    // atomic: creates, or throws EEXIST
    fs.writeFileSync(path.join(dir, 'holder.json'),
      JSON.stringify({ label, pid: process.pid, since: new Date().toISOString() }, null, 2), 'utf8');
  };

  /*
   * HEARTBEAT (A02-T-06, 2026-09-11). Staleness is measured from the lock directory's mtime, which
   * was only ever set at CREATION. So a holder that legitimately runs longer than the 30-minute
   * window looked exactly like a crashed one, and the next process would steal a live lock and
   * both would write the same generated surfaces at once. That is the precise race this mutex
   * exists to prevent, reachable by nothing worse than a slow run: the generator alone does a
   * full validation suite, four live n8n round-trips and a card rebuild.
   *
   * Touching the directory every 5 minutes makes "still working" and "died" distinguishable.
   * .unref() so a held lock can never keep the process alive on its own.
   */
  let beat = null;
  const startBeat = () => {
    beat = setInterval(() => {
      try { const now = new Date(); fs.utimesSync(dir, now, now); } catch { /* lock gone: release will notice */ }
    }, Math.max(30000, Math.floor(staleMs / 6)));
    if (typeof beat.unref === 'function') beat.unref();
  };

  const release = () => {
    if (beat) { clearInterval(beat); beat = null; }
    // Only remove a lock we still own (guards against releasing a lock that was stolen from us).
    const h = holderOf(dir);
    if (h && h.pid !== process.pid) return false;
    try { fs.rmSync(dir, { recursive: true, force: true }); return true; }
    catch (_) { return false; }
  };

  try {
    tryMk();
    startBeat();
    return { ok: true, release, holder: null, reason: null };
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }

  // Held by someone. Steal it only if it is stale (a crashed run must not wedge the system).
  const holder = holderOf(dir);
  const age = ageMsOf(dir);
  if (age > staleMs) {
    say(`write-lock: stealing a STALE '${name}' lock (age ${Math.round(age / 60000)}min, holder ${holder ? `${holder.label} pid ${holder.pid}` : 'unknown'}) - a prior run almost certainly crashed`);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      tryMk();
      startBeat();
      return { ok: true, release, holder, reason: 'stole-stale' };
    } catch (e2) {
      return { ok: false, release: () => false, holder, reason: `stale-steal failed: ${e2.message}` };
    }
  }

  return {
    ok: false,
    release: () => false,
    holder,
    reason: holder
      ? `held by ${holder.label} (pid ${holder.pid}) since ${holder.since}`
      : 'held by an unknown process (no holder file yet)',
  };
}

/** Run fn under the lock, releasing even if fn throws. Returns { ok, value, reason }. */
async function withLock(opts, fn) {
  const held = acquire(opts);
  if (!held.ok) return { ok: false, value: undefined, reason: held.reason, holder: held.holder };
  try {
    const value = await fn();
    return { ok: true, value, reason: null };
  } finally {
    held.release();
  }
}

module.exports = { acquire, withLock, lockPath, DEFAULT_NAME, DEFAULT_STALE_MS, REPO };
