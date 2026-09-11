// scripts/lib/gen-systemd.js
// scheduler/schedule.md -> systemd user units (bash migration Phase 4, 2026-08-05).
// The Linux replacement for the schtasks half of gen-scheduler.js.
//
// DEPLOY-ONLY BY NATURE (ruling C). macOS has no systemd, so the QUERY half of this file cannot run
// on the dev box and the caller degrades to a LOUD SKIP there. The GENERATE half is pure text and
// runs anywhere, deliberately: unit files are reviewable in git before they ever reach the host,
// which is the only compensation available for a phase that cannot be tested locally.
//
// WHY UNITS LIVE IN THE REPO at systemd/, not directly in ~/.config/systemd/user/:
// they are generated from scheduler/schedule.md, so they are generated artifacts and belong beside
// the source that produces them. `systemctl --user link` points at them from there. That keeps the
// "sources are hand-edited, views are generated" ground rule intact and makes a scheduler change a
// reviewable diff instead of an invisible act on one machine.
//
// JOB NAMES ARE PRESERVED VERBATIM (W11): PersonalOS-morning-brief.timer, not a systemd-idiomatic
// rename. Recovery check C7 compares documented names to live names, so keeping them identical
// keeps that check meaningful throughout the migration instead of blinding it for the duration.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const UNIT_DIR = path.join(REPO, 'systemd');

// --- Documentation= -------------------------------------------------------------------------------
// A local `file://` absolute path only resolves on the ONE machine that generated it, which is
// exactly the class of bug the bash migration exists to remove (2026-08-18 follow-up: every
// checked-in unit carried one developer's home directory). systemd's own convention for
// Documentation= is a globally-resolvable reference (a manpage, a URL), not a local file - so this
// derives the project's public GitHub origin instead and points at scheduler/schedule.md there,
// which works identically on every clone regardless of where it lives on disk.
//
// Pinned to `main`, not whatever branch is currently checked out: Documentation= is a stable
// reference for an admin reading a unit file later, and a link to a feature branch that gets
// deleted is worse than a link to main that is briefly one commit behind.
//
// Falls back to the local file:// absolute path (the pre-2026-08-18 behavior) when there is no
// `origin` remote or it is not a GitHub URL - never let a documentation pointer crash the generator.
let _docUrlCache = null;
function docUrl() {
  if (_docUrlCache) return _docUrlCache; // one `git remote` shell-out per generator run, not per job
  const localFallback = `file://${path.join(REPO, 'scheduler', 'schedule.md')}`;
  let remote;
  try {
    remote = execFileSync('git', ['-C', REPO, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  } catch {
    return (_docUrlCache = localFallback);
  }
  // Handles both https://github.com/OWNER/REPO(.git) and git@github.com:OWNER/REPO(.git).
  const m = /github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/.exec(remote);
  if (!m) return (_docUrlCache = localFallback);
  return (_docUrlCache = `https://github.com/${m[1]}/${m[2]}/blob/main/scheduler/schedule.md`);
}

// --- platform ------------------------------------------------------------------------------------
function hasSystemd() {
  return process.platform === 'linux' && fs.existsSync('/run/systemd/system');
}

// --- live query ----------------------------------------------------------------------------------
// Replaces `schtasks /query /fo CSV`. --all so a loaded-but-inactive timer still shows: a job that
// exists but is disabled is a completely different finding from a job that does not exist, and C7
// needs to be able to tell them apart.
function liveJobs() {
  let out;
  try {
    out = execFileSync('systemctl', ['--user', 'list-timers', '--all', '--no-pager', '--no-legend', '-o', 'json'], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    throw new Error(`gen-systemd: systemctl --user list-timers failed: ${e.message}`);
  }
  const names = new Set();
  let rows;
  try {
    rows = JSON.parse(out);
  } catch {
    // Older systemd builds ignore `-o json` for list-timers and print a table. Fall back to
    // scraping unit names rather than failing: a scheduler check that dies on a formatting
    // difference is worse than one that reads a table.
    for (const m of out.matchAll(/(PersonalOS-[A-Za-z0-9-]+)\.timer/g)) names.add(m[1]);
    return [...names].filter((n) => !n.startsWith('PersonalOS-retry-')).sort();
  }
  for (const r of rows || []) {
    const unit = r.unit || r.UNIT || '';
    const m = /^(PersonalOS-[A-Za-z0-9-]+)\.timer$/.exec(unit);
    if (m && !m[1].startsWith('PersonalOS-retry-')) names.add(m[1]);
  }
  return [...names].sort();
}

/** Which of the documented timers are actually ENABLED. Used by C7b and hq_infra_harvest. */
function enabledJobs() {
  let out;
  try {
    out = execFileSync('systemctl', ['--user', 'list-unit-files', '--no-pager', '--no-legend', 'PersonalOS-*.timer'], {
      encoding: 'utf8',
    });
  } catch (e) {
    throw new Error(`gen-systemd: systemctl --user list-unit-files failed: ${e.message}`);
  }
  const names = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^(PersonalOS-[A-Za-z0-9-]+)\.timer\s+enabled/.exec(line.trim());
    if (m && !m[1].startsWith('PersonalOS-retry-')) names.push(m[1]);
  }
  return names.sort();
}

// --- frequency -> OnCalendar ---------------------------------------------------------------------
// The systemd twin of parseFrequency(). CONSERVATIVE ON PURPOSE, same contract as the Windows side:
// anything it cannot parse must be registered by hand, because guessing a schedule is worse than
// refusing to write one. Every returned expression is in the machine's local timezone, which is why
// Phase 4 sets the host tz BEFORE any timer is enabled.
function parseFrequency(freq) {
  if (!freq) return null;
  const f = freq.toLowerCase();
  const time = f.match(/(\d{1,2})[:.](\d{2})\s*(am|pm)?/);
  if (!time) return null;
  let hh = parseInt(time[1], 10);
  const mm = time[2];
  if (time[3] === 'pm' && hh < 12) hh += 12;
  if (time[3] === 'am' && hh === 12) hh = 0;
  const at = `${String(hh).padStart(2, '0')}:${mm}:00`;

  // ORDER MATTERS: the most specific pattern first. "monthly, first Monday" contains a weekday name,
  // so a bare weekday test placed earlier would swallow it and silently schedule it every week.
  if (/monthly.*first (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/.test(f)) {
    const d = f.match(/first (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/)[1];
    // "the first <day> of the month" = that weekday falling in days 01..07.
    return `${cap3(d)} *-*-01..07 ${at}`;
  }
  if (/monthly.*last day/.test(f)) {
    // systemd's negative day-of-month. `~01` is the last day of the month, which is exactly what
    // the Windows side expressed as /mo LASTDAY. Requires systemd 240+, far below any current host.
    return `*-*~01 ${at}`;
  }
  const dom = f.match(/monthly on the (\d{1,2})/);
  if (dom) return `*-*-${String(dom[1]).padStart(2, '0')} ${at}`;
  if (/weekday/.test(f)) return `Mon..Fri ${at}`;
  const day = f.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/);
  if (day) return `${cap3(day[1])} *-*-* ${at}`;
  if (/daily|\bdays\b/.test(f)) return `*-*-* ${at}`;
  return null;
}

const cap3 = (d) => d.slice(0, 1).toUpperCase() + d.slice(1, 3);

/**
 * Ask systemd itself whether an OnCalendar expression is valid, when systemd is present.
 *
 * WHY: Phase 4 is written on a machine that cannot run it (ruling C), so every expression above is
 * written from the documentation rather than from a passing test. `systemd-analyze calendar` is the
 * authority, it is free, and it self-activates the moment this runs on the host - which converts
 * "these look right" into "systemd parsed them" at exactly the point where it can.
 * Returns null when systemd-analyze is unavailable (the Mac), so callers can tell "not checked"
 * apart from "checked and fine".
 */
function verifyCalendar(expr) {
  try {
    execFileSync('systemd-analyze', ['calendar', expr], { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch (e) {
    if (e && e.code === 'ENOENT') return null; // no systemd-analyze here
    return false;
  }
}

// --- hardening (W10) -----------------------------------------------------------------------------
// The Windows task-settings vocabulary, mapped. These values are documented per job in the prose of
// scheduler/schedule.md and NOWHERE else, so they are read from the entry body rather than invented.
// Anything the prose does not state gets the documented default below, which is the standing
// hardening every job carried.
//
//   StartWhenAvailable      -> Persistent=true      (and it is strictly better: it fires on the next
//                              boot if the machine was off, which Task Scheduler only approximated)
//   WakeToRun               -> WakeSystem=true
//   ExecutionTimeLimit      -> RuntimeMaxSec=
//   MultipleInstances       -> nothing needed; Type=oneshot already refuses a concurrent start
//   RestartCount/Interval   -> deliberately NOT mapped. The close-out retry ladder owns retries, and
//                              §2.2 of the plan is explicit that it is ported as-is rather than
//                              collapsed into Restart=on-failure during a platform move.
function hardeningFor(entryText) {
  const t = entryText || '';
  const h = {
    persistent: true,
    wake: /WakeToRun|WakeSystem/i.test(t),
    runtimeMaxSec: 7200, // the standing 2h default
    disabled: false,
    disabledReason: '',
  };
  const lim = t.match(/ExecutionTimeLimit\s*(\d+)\s*(min|minutes|h|hours?)/i);
  if (lim) {
    const n = parseInt(lim[1], 10);
    h.runtimeMaxSec = /^h/i.test(lim[2]) ? n * 3600 : n * 60;
  }
  // DISABLED BY DESIGN is a first-class state, not an oversight. Two jobs carry it (sprint-tracker,
  // paused 2026-07-16; whatsapp-harvest, whose retired Phase-1 02:30 trigger must never be re-armed).
  // The units are still GENERATED - so re-enabling is one systemctl command, not a rebuild - but the
  // apply step must never enable them.
  if (/STATUS:\s*DISABLED|stays DISABLED|set Disabled/i.test(t)) {
    h.disabled = true;
    h.disabledReason = /whatsapp/i.test(t)
      ? 'retired Phase-1 02:30 trigger must never be re-armed'
      : 'paused by Shaheen 2026-07-16 until he says otherwise';
  }
  return h;
}

// --- unit rendering ------------------------------------------------------------------------------
function renderService(job, { wrapper, description, runtimeMaxSec }) {
  return `# GENERATED by scripts/lib/gen-systemd.js from scheduler/schedule.md. Do not hand-edit.
# Edit scheduler/schedule.md, then run: node scripts/generate-alex.js
[Unit]
Description=${description}
Documentation=${docUrl()}

[Service]
Type=oneshot
WorkingDirectory=${REPO}
ExecStart=${wrapper}
RuntimeMaxSec=${runtimeMaxSec}
# The job train's failure handling lives in scripts/lib/close-out.mjs (RED push + a self-scheduled
# retry ladder), NOT here. Restart= is deliberately unset: see the migration plan §2.2 on why the
# ladder is ported as-is rather than collapsed into Restart=on-failure during a platform move.
`;
}

function renderTimer(job, { description, onCalendar, persistent, wake }) {
  return `# GENERATED by scripts/lib/gen-systemd.js from scheduler/schedule.md. Do not hand-edit.
# Edit scheduler/schedule.md, then run: node scripts/generate-alex.js
[Unit]
Description=${description} (timer)

[Timer]
OnCalendar=${onCalendar}
# Persistent=true is the StartWhenAvailable equivalent, and better: a job missed because the machine
# was off fires on the next boot instead of being lost.
Persistent=${persistent ? 'true' : 'false'}
${wake ? 'WakeSystem=true\n' : ''}# These jobs are time-anchored (the 07:30 sweep must land before the 08:00 brief reads it), so no
# randomized spread.
RandomizedDelaySec=0
AccuracySec=1min
Unit=${job}.service

[Install]
WantedBy=timers.target
`;
}

// --- the generator -------------------------------------------------------------------------------
function wrapperFor(job) {
  const base = job.replace(/^PersonalOS-/, '');
  // Two documented jobs do not follow the run-{name}.sh convention, because their names describe
  // what they do rather than which command they run.
  const special = {
    'PersonalOS-recovery-check': 'work/18-recovery-layer/check.mjs',
    'PersonalOS-security-sweep': 'work/18-recovery-layer/security-sweep.mjs',
    'PersonalOS-lint-monthly': 'scripts/run-lint.sh',
    'PersonalOS-git-backup': 'scripts/git-backup.sh',
    'PersonalOS-vault-backup': 'scripts/vault-backup.sh',
    'PersonalOS-vault-index': 'scripts/run-vault-index.sh',
    'PersonalOS-auth-check': 'scripts/auth-check.sh',
    'PersonalOS-n8n-active-check': 'scripts/n8n-active-check.mjs',
  };
  return special[job] || `scripts/run-${base}.sh`;
}

/**
 * Write every documented job's .service + .timer into systemd/. Pure text, so it runs on any
 * platform - which is the point: the units are reviewable in git before they reach the host.
 */
function generateUnits({ schedule, log }) {
  fs.mkdirSync(UNIT_DIR, { recursive: true });
  const written = [];
  const skipped = [];
  const disabled = [];
  const verified = []; // OnCalendar expressions systemd itself parsed (empty on a non-systemd box)

  for (const job of schedule.allJobNames) {
    const entry = schedule.entries.find((e) => e.jobNames.includes(job));
    if (!entry) {
      skipped.push(`${job} (no ### entry in schedule.md names it)`);
      continue;
    }
    const onCalendar = parseFrequency(entry.frequency);
    if (!onCalendar) {
      // Refusing beats guessing. A job whose cadence prose cannot be parsed is reported, and the
      // human registers it; it is never given an invented schedule.
      skipped.push(`${job} (cannot parse frequency: ${JSON.stringify(entry.frequency)})`);
      continue;
    }
    // Refuse to WRITE an expression systemd rejects. On the Mac this returns null (not checked) and
    // generation proceeds; on the host it is a hard gate, so a bad expression can never be linked.
    const calOk = verifyCalendar(onCalendar);
    if (calOk === false) {
      skipped.push(`${job} (systemd-analyze rejected OnCalendar=${onCalendar} - fix parseFrequency)`);
      continue;
    }
    if (calOk === true) verified.push(job);

    const rel = wrapperFor(job);
    const abs = path.join(REPO, rel);
    if (!fs.existsSync(abs)) {
      skipped.push(`${job} (wrapper ${rel} does not exist yet)`);
      continue;
    }
    const h = hardeningFor(entry.text);
    const description = `Alex: ${entry.name}`;
    const exec = rel.endsWith('.mjs') ? `${process.execPath} ${abs}` : abs;

    fs.writeFileSync(
      path.join(UNIT_DIR, `${job}.service`),
      renderService(job, { wrapper: exec, description, runtimeMaxSec: h.runtimeMaxSec })
    );
    fs.writeFileSync(
      path.join(UNIT_DIR, `${job}.timer`),
      renderTimer(job, { description, onCalendar, persistent: h.persistent, wake: h.wake })
    );
    written.push(job);
    if (h.disabled) disabled.push({ job, reason: h.disabledReason });
  }

  fs.writeFileSync(path.join(UNIT_DIR, 'README.md'), renderReadme({ written, disabled, skipped }));
  log(`  systemd: wrote ${written.length * 2} unit files for ${written.length} jobs into systemd/`);
  log(
    verified.length
      ? `  systemd: ${verified.length}/${written.length} OnCalendar expressions verified by systemd-analyze`
      : '  systemd: OnCalendar expressions NOT verified (systemd-analyze absent - expected on a dev box without systemd, a finding on the Linux host)'
  );
  if (disabled.length) log(`  systemd: ${disabled.length} DISABLED by design, units written but never enabled: ${disabled.map((d) => d.job).join(', ')}`);
  for (const s of skipped) log(`  systemd: SKIPPED ${s}`);
  return { written, disabled, skipped, verified };
}

function renderReadme({ written, disabled, skipped }) {
  return `# systemd units (GENERATED)

Generated from \`scheduler/schedule.md\` by \`scripts/lib/gen-systemd.js\`. Do not hand-edit a unit
file: edit \`scheduler/schedule.md\` and run \`node scripts/generate-alex.js\`.

**These files are inert on macOS.** The dev machine has no systemd (ruling C of the bash migration
plan: dev on macOS, run on Linux). Seeing them here on a Mac does not mean anything is broken.

## Installing on the Linux host

\`\`\`sh
# 1. Link the units from the repo (they stay in git; ~/.config/systemd/user just points here).
systemctl --user link "$PWD"/systemd/PersonalOS-*.service "$PWD"/systemd/PersonalOS-*.timer
systemctl --user daemon-reload

# 2. Enable + start every timer that is NOT disabled by design (see the table below).
for t in systemd/PersonalOS-*.timer; do
  name="$(basename "$t")"
  case "$name" in PersonalOS-sprint-tracker.timer|PersonalOS-whatsapp-harvest.timer) continue;; esac
  systemctl --user enable --now "$name"
done

# 3. MANDATORY and easy to forget: without lingering, user timers do not fire unless someone is
#    logged in. A headless box without this silently runs nothing at all.
loginctl enable-linger "$USER"

# 4. Verify.
systemctl --user list-timers --all
\`\`\`

## Timezone

Every \`OnCalendar=\` is wall-clock in the machine's local timezone. Set it BEFORE enabling anything:

\`\`\`sh
sudo timedatectl set-timezone Europe/Stockholm
\`\`\`

DST is then handled by the OS, which is the whole reason the schema moved from Windows timezone IDs
to IANA ones (W18).

## Jobs

${written.length} job${written.length === 1 ? '' : 's'} generated.

${
  disabled.length
    ? `### Disabled by design - do NOT enable\n\n${disabled.map((d) => `- \`${d.job}\` - ${d.reason}`).join('\n')}\n`
    : ''
}${
    skipped.length
      ? `### Not generated\n\nThese are documented but produced no unit. Each is a real finding, not noise.\n\n${skipped.map((s) => `- ${s}`).join('\n')}\n`
      : ''
  }
## What is deliberately NOT here

\`Restart=on-failure\`. systemd would fire it on a non-zero exit, unlike Task Scheduler's
\`RestartCount\` (which was the whole reason the close-out retry ladder was written). That makes the
ladder arguably redundant on Linux - and it is still ported as-is, because changing failure-recovery
behavior during a platform move makes any incident un-diagnosable. Simplifying it is a separate
decision with its own verification.
`;
}

// --- apply ---------------------------------------------------------------------------------------
// Same safety contract as the Windows side: create what is missing, NEVER touch what exists.
function applyUnits({ schedule, missing, log }) {
  const applied = [];
  for (const job of missing) {
    const timer = path.join(UNIT_DIR, `${job}.timer`);
    if (!fs.existsSync(timer)) {
      throw new Error(`gen-systemd: ${job} is missing live but has no generated unit - run the generator first`);
    }
    const entry = schedule.entries.find((e) => e.jobNames.includes(job));
    if (hardeningFor(entry && entry.text).disabled) {
      log(`  systemd: ${job} is DISABLED by design - unit exists, deliberately NOT enabled`);
      continue;
    }
    execFileSync('systemctl', ['--user', 'link', path.join(UNIT_DIR, `${job}.service`), timer], { encoding: 'utf8' });
    execFileSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8' });
    execFileSync('systemctl', ['--user', 'enable', '--now', `${job}.timer`], { encoding: 'utf8' });
    log(`  systemd: ENABLED ${job}.timer`);
    applied.push(job);
  }
  return applied;
}

module.exports = { hasSystemd, liveJobs, enabledJobs, parseFrequency, hardeningFor, generateUnits, applyUnits, UNIT_DIR };
