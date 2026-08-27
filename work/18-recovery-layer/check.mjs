#!/usr/bin/env node
// work/18-recovery-layer/check.mjs  -  Recovery Phase 2: the deterministic checker.
// Ported from check.ps1 (bash migration Phase 5, 2026-08-05). Stays in work/18 by ruling E: four
// files parse it by path, and "project code lives in work/, scheduler plumbing lives in scripts/"
// holds on Linux exactly as it did on Windows.
//
// ZERO LLM tokens. Level-triggered reconciliation (Kubernetes/Terraform style): re-checks the WHOLE
// system against the desired state in manifest.json, forgiving of missed Change-Propagation events
// (the standing order is edge-triggered and forgets when a session dies mid-propagation; this sweep
// is the layer that can't forget). It DETECTS, never auto-repairs (IaC warning).
//
// Exit 0 = clean · 2 = drift found (Terraform `-detailed-exitcode` convention) · 1 = checker error.
// Pushes recovery/integrity to Alex HQ (green clean / amber drift). Writes a human drift report to
// vault/projects/recovery/last-sweep.md for the Monday morning brief. Log: outputs/logs/recovery-check.log.
//
//   node work/18-recovery-layer/check.mjs --init      baseline the CLAUDE.md hashes + log high-water
//   node work/18-recovery-layer/check.mjs             run the sweep (Monday 07:30, PersonalOS-recovery-check)
//   node work/18-recovery-layer/check.mjs --dry-run   run the sweep, print, but do NOT push to HQ
//
// THE HEADER FORMAT `// --- C<n>` IS A CONTRACT, not a style choice. Two consumers count these block
// headers to derive the live check total: scripts/narrative-drift-check.py (C19's ground truth) and
// system/recall/harvesters/h-recovery.js (the fact C21 tests the work/18 spec against). Both were
// updated in this same commit to accept `//` as well as `#`. Renaming or reformatting a header
// silently changes the number the whole narrative-drift lane is anchored to.
//
// Design: vault/research/alex-recovery-layer.md (pieces 1-2). Runbook: vault/projects/recovery/recovery-layer-plan.md.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Derive the repo root from the script's own location. A RECOVERY tool must survive a restore to
// any path/machine, so never hardcode the root.
const REPO = path.resolve(HERE, '..', '..');
process.chdir(REPO);

// pathToFileURL, not a bare template string: an absolute Windows path ('C:\...') is rejected by the
// ESM loader ("protocol 'c:'"), so the checker could not even start there (found 2026-08-25 during
// the powershell-branch reconciliation; same platform-agnostic class as the 86ff0f7 backports).
const libUrl = (rel) => pathToFileURL(path.join(REPO, rel)).href;
const { paths, manifest: loadManifest } = await import(libUrl('scripts/lib/paths.mjs'));
const { sha, sameHash } = (await import(libUrl('scripts/lib/repo-hash.js'))).default;
const { liveJobs: systemdJobs, hasSystemd } = await import(libUrl('scripts/lib/gen-systemd.js')).then((m) => m.default || m);

const INIT = process.argv.includes('--init');
const DRY = process.argv.includes('--dry-run');

const STATE_DIR = path.join(HERE, 'state');
fs.mkdirSync(STATE_DIR, { recursive: true });
fs.mkdirSync(path.join(REPO, 'outputs', 'logs'), { recursive: true });
const LOG = path.join(REPO, 'outputs', 'logs', 'recovery-check.log');
const say = (m) => {
  try {
    fs.appendFileSync(LOG, `${m}\n`, 'utf8');
  } catch {
    /* never die on an unwritable log */
  }
};

const BASELINE_FILE = path.join(STATE_DIR, 'baseline.json');
const HW_FILE = path.join(STATE_DIR, 'log-highwater.json');
const SOUL_HW_FILE = path.join(STATE_DIR, 'soul-highwater.json');

const now = () => new Date();
const fmt = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const fmtMin = (d) => fmt(d).slice(0, 16);
const days = (ms) => ms / 86400000;

// Hashing comes from the ONE shared implementation (scripts/lib/repo-hash.js), which
// scripts/stale-status-check.js also imports. That file used to carry a second copy kept in
// agreement with check.ps1 by a comment; porting the checker to Node deletes the duplicate rather
// than creating a third. sameHash() is case-insensitive because pre-migration baselines hold
// UPPERCASE digests (W22) - without that, the first sweep after the cutover would report all 32
// projects as drifted at once, which is how a checker stops being read.

const exists = (p) => fs.existsSync(p);
const readText = (p) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};
const readJson = (p) => {
  const t = readText(p);
  if (t === null) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};
const lineCount = (p) => {
  const t = readText(p);
  if (t === null) return 0;
  // True line count. The PowerShell note here mattered: Measure-Object -Line drops blank lines, which
  // would have made C9's monotonicity guard blind to exactly the kind of loss it exists to catch.
  const lines = t.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.length;
};
const listDirs = (p) => {
  try {
    return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
};
const walkMd = (root, out = []) => {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      if (e.name === '.obsidian') continue;
      walkMd(full, out);
    } else if (e.isFile() && e.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
};
const rx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// --- fail-loud ------------------------------------------------------------------------------------
// Pushes RED integrity (value_num -1) to Alex HQ + logs, so the checker can never sit stale-green
// while dead. Used by BOTH the pre-sweep manifest-load guard AND the sweep's catch (BUG-02 fix,
// 2026-07-16: those were duplicated, and the manifest load sat OUTSIDE the try, so a corrupt
// manifest killed the checker with no red push - the exact class this whole layer exists to kill).
function pushCheckerError(err) {
  say(`CHECKER ERROR: ${err}`);
  console.log(`Recovery checker ERROR (exit 1): ${err}`);
  hqPush({ valueNum: -1, headline: `checker ERROR: ${err}`, status: 'red' });
}

function hqPush({ valueNum, headline, status }) {
  if (DRY) {
    say(`DRYRUN, would push: integrity=${valueNum} ${status} - ${headline}`);
    return;
  }
  spawnSync(
    process.execPath,
    [
      path.join(REPO, 'scripts', 'lib', 'close-out.mjs'), 'hq-push',
      '--log', LOG,
      '--project', 'recovery',
      '--metric', 'integrity',
      '--status', status,
      '--value', String(valueNum),
      '--headline', headline,
    ],
    { cwd: REPO, stdio: 'ignore' }
  );
}

let manifest;
try {
  manifest = loadManifest();
} catch (e) {
  pushCheckerError(`manifest load failed: ${e.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------- --init: baseline desired state
if (INIT) {
  const hashes = {};
  const statusHashes = {};
  for (const p of manifest.projects) {
    hashes[String(p.num)] = sha(path.join(p.work_dir, 'CLAUDE.md'));
    statusHashes[String(p.num)] = sha(p.status_md); // baseline status.md too, for the hash-based C8
  }
  fs.writeFileSync(
    BASELINE_FILE,
    JSON.stringify({ hashes, status_hashes: statusHashes, last_init: fmt(now()) }, null, 2) + '\n'
  );
  const logLines = lineCount(paths.vaultLog());
  fs.writeFileSync(HW_FILE, JSON.stringify({ lines: logLines, updated: fmt(now()) }, null, 2) + '\n');
  // C28 (2026-08-23): record the ACCEPTED user-scope skill set. Deliberately a name inventory, not
  // hashes: the point is "what is installed outside every gate", and a name arriving or vanishing is
  // the signal. Hashing user-scope content would imply this repo governs it, which it does not.
  const usDir = path.join(os.homedir(), '.claude', 'skills');
  const usList = listDirs(usDir).sort();
  fs.writeFileSync(
    path.join(STATE_DIR, 'user-skills-baseline.json'),
    JSON.stringify({ skills: usList, updated: fmt(now()) }, null, 2) + '\n'
  );
  console.log(
    `Baselined: ${manifest.projects.length} CLAUDE.md hashes + log high-water ${logLines} lines + ${usList.length} user-scope skill(s) -> ${STATE_DIR}`
  );
  process.exit(0);
}

// ---------------------------------------------------------------- sweep (wrapped: fail LOUD)
const drift = [];
const addDrift = (cat, msg) => drift.push({ cat, msg });
let linkSamples = [];

try {
  const claudeMd = readText(paths.claudeMd()) || '';
  const claudeMdLines = claudeMd.split(/\r?\n/);
  const utility = manifest.meta.utility_commands || [];
  const knownExtra = manifest.meta.known_extra_projects_no_work_folder || [];

  // Every command declared by a manifest project (for the orphan-command reverse check).
  const declaredCmds = new Set();
  for (const p of manifest.projects) for (const c of p.commands || []) declaredCmds.add(c);
  for (const u of utility) declaredCmds.add(u);

  // --- C1 quad completeness: each project has work dir, status.md, and each declared command file ---
  for (const p of manifest.projects) {
    if (!exists(p.work_dir)) addDrift('quad', `#${p.num} ${p.name}: work dir missing (${p.work_dir})`);
    if (!exists(path.join(p.work_dir, 'CLAUDE.md'))) addDrift('quad', `#${p.num} ${p.name}: work CLAUDE.md missing`);
    if (!exists(p.status_md)) addDrift('quad', `#${p.num} ${p.name}: status.md missing (${p.status_md})`);
    for (const c of p.commands || []) {
      if (!exists(path.join('.claude', 'commands', `${c}.md`)))
        addDrift('quad', `#${p.num} ${p.name}: command file .claude/commands/${c}.md missing`);
    }
    // --- C5 routing row: a real '| NN |' TABLE row carrying this work_dir (not just a prose mention) ---
    // 0* tolerates zero-padded row numbers (| 01 |).
    const rowRe = new RegExp(`^\\|\\s*0*${p.num}\\s*\\|`);
    const found = claudeMdLines.some((l) => rowRe.test(l) && l.includes(p.work_dir));
    if (!found)
      addDrift('routing', `#${p.num} ${p.name}: no routing-table row ('| ${p.num} |' row carrying ${p.work_dir})`);
  }

  // --- C2 orphan commands: a command file no project or utility claims (this caught venture-sync) ---
  for (const f of fs.readdirSync(path.join('.claude', 'commands')).filter((f) => f.endsWith('.md'))) {
    const name = f.replace(/\.md$/, '');
    if (!declaredCmds.has(name))
      addDrift('orphan-cmd', `command '/${name}' is not owned by any project or utility (register it in the routing table + manifest)`);
  }

  // --- C3 orphan work folders: ANY work/ dir (not just NN-*) with no manifest entry / allowlist ---
  const manifestDirs = manifest.projects.map((p) => p.work_dir.replace(/\\/g, '/'));
  const knownWork = manifest.meta.known_work_folders || [];
  for (const d of listDirs('work')) {
    const rel = `work/${d}`;
    if (!manifestDirs.includes(rel) && !knownWork.includes(d)) {
      addDrift('orphan-work', `work folder '${rel}' has no manifest entry (register it, or add to meta.known_work_folders if it is non-project tooling)`);
    }
  }

  // --- C4 orphan vault projects: a vault/projects/* not registered (catches modeling + stale pages) ---
  const registeredStatus = [
    ...manifest.projects.map((p) => p.status_md.replace(/\\/g, '/')),
    ...knownExtra.map((k) => String(k.status_md).replace(/\\/g, '/')),
  ];
  for (const d of listDirs(path.join('vault', 'projects'))) {
    const st = `vault/projects/${d}/status.md`;
    if (!registeredStatus.includes(st)) {
      if (exists(st))
        addDrift('orphan-project', `vault project '${d}' has a status.md but is not in the manifest (retire -> archive, or register it)`);
      else
        addDrift('orphan-project', `vault project dir '${d}' has no status.md and is unregistered (likely stale -> GC candidate)`);
    }
  }

  // --- C6 wiki-link resolution: every [[link]] resolves to a vault page (Obsidian basename/path style) ---
  // TARGET set INCLUDES vault/archive/ (supersede-never-delete GC keeps archived pages valid targets).
  const vaultRoot = path.join(REPO, 'vault');
  const targetMd = walkMd(vaultRoot);
  const relpaths = new Set();
  const basenames = new Set();
  const basenameCounts = new Map();
  for (const m of targetMd) {
    const rel = path.relative(vaultRoot, m).split(path.sep).join('/').toLowerCase();
    relpaths.add(rel.replace(/\.md$/, ''));
    const bn = path.basename(m, '.md').toLowerCase();
    basenames.add(bn);
    basenameCounts.set(bn, (basenameCounts.get(bn) || 0) + 1);
  }
  // soul.md lives at the repo root (outside the Obsidian vault) but is a real, unique target.
  basenames.add('soul');
  basenameCounts.set('soul', 1);

  // Placeholder targets that appear in prose/instructions, not real links.
  const ignoreTargets = new Set([
    'wiki links', 'wiki link', 'link', 'links', 'name',
    'people/name', 'projects/name', 'business/company', 'wiki-links',
  ]);
  const unresolved = [];
  // SOURCES exclude archive/ (don't scan retired pages), index.md + log.md (navigation/history), and
  // last-sweep.md (the checker's OWN output - scanning it self-pollutes the next run's count). Also
  // skip immutable dated records (history/ + standups/): append-only snapshots we never edit, so a
  // dangling link in a 3-week-old brief is not actionable.
  const linkSources = targetMd.filter((m) => {
    const rel = path.relative(vaultRoot, m).split(path.sep).join('/');
    if (/(^|\/)(archive|sources|history|standups)\//.test(rel)) return false;
    return !['index.md', 'log.md', 'last-sweep.md'].includes(path.basename(m));
  });
  for (const m of linkSources) {
    let content = readText(m);
    if (!content) continue;
    // Strip fenced + inline code so [[links]] shown as EXAMPLES don't count.
    content = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
    for (const mt of content.matchAll(/\[\[([^\]|#]+)/g)) {
      // TrimEnd('\'): a pipe escaped for a markdown table (\|) leaves a trailing backslash.
      const t = mt[1].trim().replace(/\\+$/, '').toLowerCase();
      if (t === '' || ignoreTargets.has(t)) continue;
      let ok;
      if (t.includes('/')) {
        // Path-style links must resolve to the FULL relpath; the basename fallback is ONLY for bare
        // [[name]]. Otherwise [[x/status]] falsely resolves via any status.md ("links resolve", hollow).
        ok = relpaths.has(t);
        if (!ok) for (const r of relpaths) if (r.endsWith(`/${t}`)) { ok = true; break; }
        // A UNIQUE basename resolves (e.g. [[people/name]] -> the one name.md, per the People
        // Protocol); an AMBIGUOUS one (status/index, ~19 files) does NOT.
        const seg = t.split('/').pop();
        if (!ok && basenameCounts.get(seg) === 1) ok = true;
      } else {
        ok = relpaths.has(t) || basenames.has(t);
      }
      // Cross-tree: a link to a real file OUTSIDE vault/ (work/, sources/, outputs/) resolves if it
      // exists on disk. Wrapped so an illegal-character target degrades to "unresolved" rather than
      // throwing into the fail-loud catch.
      if (!ok) {
        try {
          if (exists(path.join(REPO, `${t}.md`)) || exists(path.join(REPO, t))) ok = true;
        } catch {
          /* unresolved */
        }
      }
      if (!ok) unresolved.push(t);
    }
  }
  // ONE drift item for links; the report lists the TOP DISTINCT targets by count so real missing
  // pages (a page referenced 10x that doesn't exist) don't hide behind one noisy root cause.
  if (unresolved.length > 0) {
    const counts = new Map();
    for (const u of unresolved) counts.set(u, (counts.get(u) || 0) + 1);
    addDrift('links', `${unresolved.length} unresolved [[wiki links]] across ${counts.size} distinct targets (top below)`);
    linkSamples = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, c]) => `[[${name}]] x${c}`);
  }

  // --- C7 scheduler <-> live systemd user timers (names AND trigger times) ---
  // PersonalOS-retry-* are the close-out lib's ephemeral one-shot retries (self-registered on a
  // failed run, self-deleting). Not documented jobs; never drift. The qra-poller is the same class
  // (arm.sh-created one-shot, OBS-21 fix 2026-07-15). Both excluded on BOTH sides.
  const schedRaw = readText(path.join('scheduler', 'schedule.md')) || '';
  const isEphemeral = (j) => j.startsWith('PersonalOS-retry-') || j === 'PersonalOS-qra-poller';
  const docJobs = [...new Set((schedRaw.match(/PersonalOS-[\w-]+/g) || []))].filter((j) => !isEphemeral(j)).sort();

  // Ruling C: on a dev box with no systemd there is no scheduler to be in drift WITH, so C7/C7b are
  // SKIPPED loudly rather than reporting all 23 documented jobs as missing. That would be 23 false
  // findings every run, which is how a checker gets ignored.
  //
  // Wording corrected 2026-08-26 (inspection ticket X-1): this said "the macOS dev box" and the dev box
  // is now win32, so the message and its rationale disagreed. The SKIP is deliberate and loud, and the
  // 2026-08-26 inspection initially flagged it as a silent coverage hole - that was wrong, it says so
  // every run. The residual gap is real but different: this drift class is only ever checked on the
  // Linux host, so nothing catches scheduler drift during development here.
  let liveJobs = [];
  let schedulerReadable = false;
  if (!hasSystemd() && process.platform === 'win32') {
    // 2026-08-28: C7 no longer skips on Windows. It skipped because there was no scheduler to diff
    // against, and that stopped being true the moment the Windows Task Scheduler was repaired. A check
    // that reports PASS while covering nothing is the "green light that cannot go red" defect this
    // layer exists to kill. schtasks is the same ground truth h-scheduler.js already harvests, so the
    // two stop watching different, mutually invisible schedulers (Lane A blocker 4).
    try {
      const csv = execFileSync('schtasks', ['/query', '/fo', 'CSV', '/nh'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
      const seen = new Set();
      for (const line of csv.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const cells = line.match(/"([^"]*)"/g);
        if (!cells || cells.length < 3) continue;
        const nm = cells[0].replace(/"/g, '').replace(/^\\/, '');
        if (!nm.startsWith('PersonalOS-') || nm.startsWith('PersonalOS-retry-')) continue;
        seen.add(nm); // keep the PersonalOS- prefix: docJobs is parsed WITH it (line ~355)
      }
      liveJobs = [...seen];
      schedulerReadable = true;
      say(`C7: read ${liveJobs.length} live Windows scheduled task(s) via schtasks`);
    } catch (e) {
      addDrift('scheduler', `cannot read the live Windows Task Scheduler (${e.message}) - the scheduler half of the sweep did not run, and that is drift, not a pass`);
    }
  } else if (!hasSystemd()) {
    addDrift('scheduler', `no readable scheduler on this machine (platform=${process.platform}) - the scheduler half of the sweep did not run. Recorded as drift rather than a silent skip: a check that cannot run must never report success.`);
  } else {
    try {
      liveJobs = systemdJobs().filter((j) => !isEphemeral(j));
      schedulerReadable = true;
    } catch (e) {
      addDrift('scheduler', `cannot read the live systemd timers (${e.message}) - the scheduler half of the sweep did not run`);
    }
  }
  if (schedulerReadable) {
    for (const j of docJobs) if (!liveJobs.includes(j)) addDrift('scheduler', `documented job '${j}' is NOT registered in the live scheduler`);
    for (const j of liveJobs) if (!docJobs.includes(j)) addDrift('scheduler', `registered job '${j}' is NOT documented in scheduler/schedule.md`);
  }

  // C7b TRIGGER TIMES (added 2026-07-25, stress-test fix F-05). Until it existed every scheduler
  // check compared NAMES: C7 (doc <-> live), V2's live half (doc <-> live), and the retired C16
  // (doc <-> doc). So a job whose trigger TIME was hand-edited, or mangled by a re-creation, fired at
  // the wrong hour forever while every surface read green.
  //
  // Deliberately soft where it cannot be certain, so it can never cry wolf:
  //   - the expected time is parsed from the section's '- Frequency:' line ONLY (never body prose,
  //     which legitimately mentions other times - the Application Engine section documents the n8n
  //     engine's 15:00 beside the local watch's 08:30);
  //   - a Frequency line with no parseable clock is SKIPPED (on-demand/event/phone-side entries);
  //   - a timer with no parseable OnCalendar is SKIPPED;
  //   - a timer with several OnCalendar lines passes if ANY matches.
  const docTimeFromFrequency = (freq) => {
    if (!freq) return null;
    if (/on-?demand|event-driven|^\s*none\b/i.test(freq)) return null; // no clock promise
    const m = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(freq);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const mi = parseInt(m[2], 10);
    const ap = m[3];
    if (ap) {
      if (/PM/i.test(ap) && h < 12) h += 12;
      else if (/AM/i.test(ap) && h === 12) h = 0;
    }
    if (h > 23 || mi > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  };
  if (schedulerReadable) {
    const jobDocTime = new Map();
    for (const part of schedRaw.split(/^### /m).slice(1)) {
      const freqM = /^- Frequency:\s*(.+)$/m.exec(part);
      if (!freqM) continue;
      const docTime = docTimeFromFrequency(freqM[1]);
      if (!docTime) continue;
      const named = [...new Set((part.match(/PersonalOS-[\w-]+/g) || []))].filter((j) => !j.startsWith('PersonalOS-retry-')).sort();
      const cmdM = /^- Command:\s*\/?([\w-]+)/m.exec(part);
      if (named.length > 0) {
        for (const n of named) if (!jobDocTime.has(n)) jobDocTime.set(n, docTime);
      } else if (cmdM) {
        const guess = `PersonalOS-${cmdM[1]}`;
        if (liveJobs.includes(guess) && !jobDocTime.has(guess)) jobDocTime.set(guess, docTime);
      }
    }
    for (const job of liveJobs) {
      if (!jobDocTime.has(job)) continue; // no documented clock time
      const want = jobDocTime.get(job);
      // systemd reports the calendar spec as: TimersCalendar={ OnCalendar=*-*-* 08:00:00 ; ... }
      const res = spawnSync('systemctl', ['--user', 'show', `${job}.timer`, '-p', 'TimersCalendar'], { encoding: 'utf8' });
      const liveTimes = [];
      for (const m of String(res.stdout || '').matchAll(/OnCalendar=([^;}]+)/g)) {
        const t = /(\d{1,2}):(\d{2})(?::\d{2})?\s*$/.exec(m[1].trim());
        if (t) liveTimes.push(`${String(parseInt(t[1], 10)).padStart(2, '0')}:${t[2]}`);
      }
      if (liveTimes.length === 0) continue; // nothing comparable
      if (!liveTimes.includes(want)) {
        addDrift('scheduler-time', `'${job}' fires at ${liveTimes.join('/')} but scheduler/schedule.md documents ${want} (retime the timer, or correct the doc - a wrong hour runs the job at the wrong time silently)`);
      }
    }
  }

  // --- C8 dependent staleness (HASH-based, mtime-immune): spec changed since --init but status.md did NOT ---
  // Was mtime-based, which a mass write (the privacy scrub) or a git clone bumps in BOTH directions ->
  // false positives AND negatives. Hashing status.md + CLAUDE.md against the --init baseline flags only
  // a real propagation gap: "the spec moved, the status didn't." Resolution = propagate, then re-init.
  // W22: comparison is case-insensitive so a PowerShell-era (UPPERCASE) baseline still reads correctly.
  const blC8 = readJson(BASELINE_FILE);
  if (blC8 && blC8.status_hashes) {
    for (const p of manifest.projects) {
      const curCm = sha(path.join(p.work_dir, 'CLAUDE.md'));
      const curSt = sha(p.status_md);
      const oldCm = blC8.hashes[String(p.num)];
      const oldSt = blC8.status_hashes[String(p.num)];
      if (oldCm && curCm && !sameHash(curCm, oldCm) && oldSt && curSt && sameHash(curSt, oldSt)) {
        addDrift('stale-status', `#${p.num} ${p.name}: CLAUDE.md changed since last --init but status.md did not (propagate into status.md, then re-run --init)`);
      }
    }
  }

  // --- C9 log monotonicity: vault/log.md line count must never drop (append-only history) ---
  const logLines = lineCount(paths.vaultLog());
  const prevHwRaw = readJson(HW_FILE);
  const prevHw = prevHwRaw ? parseInt(prevHwRaw.lines, 10) || 0 : 0;
  if (logLines < prevHw) addDrift('log-shrink', `vault/log.md shrank from ${prevHw} to ${logLines} lines (data loss?)`);
  fs.writeFileSync(HW_FILE, JSON.stringify({ lines: Math.max(logLines, prevHw), updated: fmt(now()) }, null, 2) + '\n');

  // --- C10 uncommitted-spec drift: a work CLAUDE.md differs from its COMMITTED version (git HEAD) ---
  // CHANGED 2026-07-21 (audit F-02 / Class B). Was "changed since the last --init baseline", which
  // flagged EVERY committed edit until a human re-ran --init - chronic noise (13 stale rows at the
  // audit) that masked the real signal. Now COMMITTED = ACCEPTED: it flags ONLY an uncommitted /
  // out-of-band edit, which is stateless (git IS the baseline), so C10 can never itself go stale.
  // Falls back to the --init baseline only when git is unavailable (a pre-first-commit restore).
  // C8 deliberately KEEPS the --init baseline: it catches a COMMITTED spec change whose status.md
  // was not propagated, which git HEAD cannot see.
  const git = (args) => spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8' });
  const gitOk = git(['rev-parse', '--is-inside-work-tree']).status === 0;
  if (gitOk) {
    for (const p of manifest.projects) {
      const rel = `${p.work_dir}/CLAUDE.md`;
      if (!exists(path.join(REPO, rel))) continue;
      if (git(['diff', '--quiet', 'HEAD', '--', rel]).status !== 0) {
        addDrift('manifest-stale', `#${p.num} ${p.name}: work CLAUDE.md has UNCOMMITTED changes vs HEAD (commit so the spec + baseline move together, or revert; the manifest-entry review is the weekly /self-review's job)`);
      }
    }
  } else if (blC8 && blC8.hashes) {
    for (const p of manifest.projects) {
      const cur = sha(path.join(p.work_dir, 'CLAUDE.md'));
      const old = blC8.hashes[String(p.num)];
      if (old && cur && !sameHash(cur, old)) {
        addDrift('manifest-stale', `#${p.num} ${p.name}: CLAUDE.md changed since last --init (git unavailable; review the manifest entry, then re-run --init)`);
      }
    }
  } else {
    addDrift('manifest-stale', "no baseline yet and git unavailable - run 'check.mjs --init' to seed manifest hashes");
  }

  // --- C11 index catalog (index.md <-> disk): each project's status page is catalogued in the index ---
  const indexRaw = readText(paths.vaultIndex()) || '';
  for (const p of manifest.projects) {
    const stRef = p.status_md.replace(/^vault\//, '').replace(/\.md$/, '');
    if (!indexRaw.includes(stRef)) addDrift('index', `#${p.num} ${p.name}: status page [[${stRef}]] not catalogued in vault/index.md`);
  }

  // --- C12 outputs naming (2026-07-11): outputs/ top-level dirs must be manifest keys or the declared
  // exemptions in scripts/outputs-ledger.js (ONE source of truth for the list, so this calls the
  // validator instead of duplicating it). Detect-only here; the nightly reconcile is the healing lane.
  {
    const lv = spawnSync(process.execPath, [path.join('scripts', 'outputs-ledger.js'), 'validate'], { encoding: 'utf8', cwd: REPO });
    const out = `${lv.stdout || ''}${lv.stderr || ''}`.split(/\r?\n/)[0] || '';
    if (lv.status === 2) addDrift('outputs-naming', out);
    else if (lv.status !== 0) addDrift('outputs-naming', `outputs-ledger validate errored (exit ${lv.status})`);
  }

  // --- C13 first-fire aging (upgrade P4, 2026-07-12): a LIVE/EVENT registry row that has NEVER fired
  // (first_fire null) may age at most 14 days from its status.md frontmatter `created:` date. Past
  // that = amber until it fires (a documented drill counts, first_fire_kind=drill) or is re-stated
  // with a reason. ON-DEMAND/DORMANT/PARKED/RETIRED exempt.
  const ffRows = [...manifest.projects, ...(manifest.meta.unnumbered || [])];
  for (const p of ffRows) {
    if (!['LIVE', 'EVENT'].includes(p.state)) continue;
    if (p.first_fire) continue;
    const label = p.num ? `#${p.num} ${p.name}` : `${p.name}`;
    let createdStr = null;
    if (p.status_md && exists(p.status_md)) {
      const m = /^created:\s*(\d{4}-\d{2}-\d{2})/m.exec(readText(p.status_md) || '');
      if (m) createdStr = m[1];
    }
    if (!createdStr) {
      addDrift('first-fire', `${label} : LIVE/EVENT with first_fire null and no status.md created date to age against (fix the frontmatter, or stamp first_fire)`);
      continue;
    }
    const ageDays = days(now() - new Date(`${createdStr}T00:00:00`));
    if (ageDays > 14) {
      addDrift('first-fire', `${label} : never fired (first_fire null), created ${createdStr} (${Math.floor(ageDays)}d ago, past the 14-day window) - fire it (a documented drill counts) or re-state with a reason`);
    }
  }

  // --- RETIRED CHECK: the former C16 cadence-vs-schedule (deleted 2026-07-25, Shaheen: "APPLY") ----
  // Deliberately NOT written as a "C16" block header: that is the pattern narrative-drift-check.py
  // counts to derive the live check total, and a retired check must not inflate it. The NUMBER 16 is
  // retired and never reused, so every dated reference to "C16" in the running-changes stays meaningful.
  // Its job is now done STRICTLY BETTER by C7b (live trigger hour vs documented hour) and validator
  // V6 leg (c) (declared n8n_cron vs the live scheduleTrigger) - both doc-vs-REALITY rather than
  // doc-vs-doc. Check count 21 (C1-C22, C16 retired).

  // --- C14 passphrase attestation (upgrade P10, 2026-07-12, closes audit c14 without ever reading the
  // secret): state/passphrase-attested.txt carries a yyyy-MM-dd date on its first line, written ONLY
  // by the escrow drill. Missing file, malformed date, or >90 days old = amber (the 90-day re-check
  // doubles as the rotation-review prompt). The check NEVER touches the passphrase file itself.
  {
    const attestFile = path.join(STATE_DIR, 'passphrase-attested.txt');
    if (!exists(attestFile)) {
      addDrift('attestation', "vault-backup passphrase NEVER attested: run the escrow drill (node work/18-recovery-layer/escrow-test.mjs) so it stamps work/18-recovery-layer/state/passphrase-attested.txt (queue row 'passphrase-attestation')");
    } else {
      const attLine = (readText(attestFile) || '').split(/\r?\n/)[0].trim();
      const head = attLine.slice(0, 10);
      // Strict yyyy-MM-dd only. (The PowerShell version needed an explicit culture/styles overload
      // here to avoid a crash; Node has no such trap, so the guard is just the regex.)
      const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(head);
      const attDate = dm ? new Date(`${head}T00:00:00`) : null;
      if (!attDate || Number.isNaN(attDate.getTime())) {
        addDrift('attestation', `passphrase-attested.txt first line is not a yyyy-MM-dd date ('${attLine}')`);
      } else if (days(now() - attDate) > 90) {
        addDrift('attestation', `passphrase attestation is ${Math.floor(days(now() - attDate))}d old (>90d): re-confirm the password-manager copy (and consider rotation), then re-run the escrow drill`);
      }
    }
  }

  // --- C15 PAT expiry window (upgrade P10, 2026-07-12, closes audit c17): the GitHub backup PAT
  // expires ~2027-07. Amber inside 60 days of expiry so rotation happens before the nightly push dies
  // RED. UPDATE patExpiry when the PAT is rotated (this constant is the check's single input; the
  // credential itself is never read).
  {
    const patExpiry = new Date('2027-07-01T00:00:00');
    const patDaysLeft = days(patExpiry - now());
    if (patDaysLeft <= 60) {
      if (patDaysLeft <= 0)
        addDrift('pat-expiry', `GitHub backup PAT expiry date (${patExpiry.toISOString().slice(0, 10)}) has PASSED - rotate it and update patExpiry in check.mjs`);
      else
        addDrift('pat-expiry', `GitHub backup PAT expires in ${Math.floor(patDaysLeft)}d (${patExpiry.toISOString().slice(0, 10)}): rotate it, then update patExpiry in check.mjs`);
    }
  }

  // --- C17 skills symlink layer (BUG-16 fix, 2026-07-15): committed skill CONTENT lives in
  // .agents/skills/; the discovery layer .claude/skills/ is gitignored links that must be rebuilt on
  // restore. A missing link = that (often MANDATORY) skill silently does not load, with nothing
  // failing loud. Detect-only.
  // W19: these are real POSIX symlinks now, not NTFS junctions, so the whole "Git Bash ln -s silently
  // COPIES on Windows / PowerShell symlinks need elevation" hazard is gone and the remediation is one
  // ordinary command. The check also now catches a BROKEN symlink, which the Test-Path version could
  // not distinguish from a healthy one.
  {
    const agentsSkills = path.join(REPO, '.agents', 'skills');
    const claudeSkills = path.join(REPO, '.claude', 'skills');
    if (exists(agentsSkills)) {
      // PARKED skills (S1 Compiled Surfaces P4, 2026-08-16) are DELIBERATELY link-less: the docket
      // Shaheen approved parks a skill by removing its link and flagging `parked: true` in
      // skills-lock.json (content stays; wake = node scripts/skills-park.js --wake <name>). A parked
      // row is exempt here; an UNPARKED row with no link is still the restore-gap this check exists for.
      const parkedSet = new Set();
      {
        const lk = readJson(path.join(REPO, 'skills-lock.json'));
        if (lk && lk.skills) for (const [n, row] of Object.entries(lk.skills)) if (row && row.parked) parkedSet.add(n);
      }
      const missingLinks = [];
      const brokenLinks = [];
      for (const name of listDirs(agentsSkills)) {
        if (parkedSet.has(name)) continue;
        const link = path.join(claudeSkills, name);
        let st = null;
        try {
          st = fs.lstatSync(link);
        } catch {
          missingLinks.push(name);
          continue;
        }
        // A symlink whose target no longer resolves is worse than a missing one: it looks present.
        if (st.isSymbolicLink() && !exists(link)) brokenLinks.push(name);
      }
      if (missingLinks.length) {
        addDrift('skills-link', `${missingLinks.length} UNPARKED skill(s) in .agents/skills/ have no .claude/skills/ link (rebuild per pair: ln -s ../../.agents/skills/<name> .claude/skills/<name>; parked skills are exempt by design): ${missingLinks.join(', ')}`);
      }
      if (brokenLinks.length) {
        addDrift('skills-link', `${brokenLinks.length} .claude/skills/ symlink(s) are BROKEN (they point at nothing, so the skill silently does not load): ${brokenLinks.join(', ')}`);
      }
    }
  }

  // --- C18 machine timezone vs travel-state expectation (P8 scheduler TZ audit, 2026-07-17). Detect-only.
  // Every systemd OnCalendar= fires at the machine's wall clock, so if the machine tz drifts from where
  // Alex expects Shaheen to be, follows-Shaheen jobs (brief/triage) OR must-anchor jobs (server-
  // coordinated) fire at the wrong hour. Expectation = the home tz, UNLESS system/travel-state.json
  // declares an active trip.
  // W18: the schema moved from Windows timezone IDs ('W. Europe Standard Time') to IANA
  // ('Europe/Stockholm'). The new field names are home_tz / current_tz; the old home_win_tz /
  // current_win_tz are still READ so a state file written before the migration keeps working, and
  // reading one raises a drift item naming the rename rather than failing silently.
  {
    let homeTz = 'Europe/Stockholm';
    let expectedTz = homeTz;
    let tripCtx = `no active trip -> expected home '${homeTz}'`;
    const travelState = path.join(REPO, 'system', 'travel-state.json');
    if (exists(travelState)) {
      const ts = readJson(travelState);
      if (ts === null) {
        addDrift('timezone', 'system/travel-state.json is not valid JSON - cannot verify the machine timezone expectation');
      } else {
        if (ts.home_win_tz || ts.current_win_tz) {
          addDrift('timezone', "system/travel-state.json still uses the Windows tz field names (home_win_tz/current_win_tz). Rename them to home_tz/current_tz with IANA values (e.g. 'Europe/Stockholm'); work/29-trip-ops is the writer.");
        }
        const home = ts.home_tz || ts.home_win_tz;
        const current = ts.current_tz || ts.current_win_tz;
        if (home) {
          homeTz = home;
          expectedTz = home;
          tripCtx = `no active trip -> expected home '${home}'`;
        }
        if (ts.trip_id && current) {
          expectedTz = current;
          tripCtx = `travel-state trip '${ts.trip_id}' -> expected '${expectedTz}'`;
        }
      }
    }
    const actualTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (actualTz !== expectedTz) {
      addDrift('timezone', `machine timezone is '${actualTz}' but ${tripCtx} (scheduler TZ policy, schedule.md). Set the machine tz (sudo timedatectl set-timezone ${expectedTz}) or update system/travel-state.json so scheduled jobs fire at the right wall clock.`);
    }
  }

  // --- C19 narrative numbers-drift (item 3, 2026-07-20): the identity-carrying master reference must
  // not claim a recovery-check count the code disproves. A doc lying about the system IS structural
  // drift. Shells to the zero-token python checker (ONE source for the claim-set), like C12.
  {
    const nd = spawnSync('python3', [path.join('scripts', 'narrative-drift-check.py')], { encoding: 'utf8', cwd: REPO });
    const out = `${nd.stdout || ''}${nd.stderr || ''}`;
    if (nd.status === 2) {
      for (const ln of out.split(/\r?\n/)) if (ln.trim()) addDrift('narrative-drift', ln.trim());
    } else if (nd.status !== 0) {
      addDrift('narrative-drift', `narrative-drift-check errored (exit ${nd.status}): ${out.split(/\r?\n/)[0] || ''}`);
    }
  }

  // --- C20 backup destinations (F1, 2026-07-25): >=2 INDEPENDENT off-machine destinations must each
  // have verified a copy this cycle. The SPOF this kills: the sole off-machine backup home was the
  // PRODUCTION n8n box, so a box+laptop loss was unrecoverable. Ambers (never reds) until >=2 are
  // live, so the B2 provisioning stays visible.
  {
    const destDecl = (manifest.meta.paths && manifest.meta.paths.backup_destinations) || [];
    if (destDecl.length >= 1) {
      const windowH = 72; // daily backup + slack
      const verFile = path.join('work', '18-recovery-layer', 'state', 'backup-destinations.json');
      const verified = readJson(verFile) || {};
      // F-14 (2026-07-25): distinguish "the stamp mechanism has not run yet" from "a backup is dead".
      // Reporting a healthy-but-unstamped destination in the same words as a rotted one is how an
      // amber teaches people to ignore it.
      const stampMissing = !exists(verFile);
      let freshCount = 0;
      const missing = [];
      for (const d of destDecl) {
        const ts = verified[d.name];
        let ok = false;
        if (ts) {
          const t = new Date(ts);
          if (!Number.isNaN(t.getTime()) && days(now() - t) * 24 <= windowH) ok = true;
        }
        if (ok) freshCount++;
        else if (/INERT|pending/i.test(String(d.note || ''))) missing.push(`${d.name} (pending provisioning)`);
        else if (stampMissing) missing.push(`${d.name} (never stamped: the destination-verification file does not exist yet, so this is UNPROVEN, not failed - the next vault-backup run writes it)`);
        else missing.push(`${d.name} (no verified copy in ${windowH}h)`);
      }
      if (freshCount < 2) {
        const lead = stampMissing
          ? `backup destinations UNPROVEN: ${verFile} has never been written (F1 stamping is new), so 0 of ${destDecl.length} destinations can be confirmed this cycle`
          : `only ${freshCount} of ${destDecl.length} independent backup destination(s) verified a copy in the last ${windowH}h`;
        addDrift('backup-spof', `${lead} - a correlated single-point loss risks the backups until >=2 are live: ${missing.join('; ')} (provision: human-actions f1-b2-backup)`);
      }
    }
  }

  // --- C21 facts-ledger doc drift (Recall Spine Phase 1, 2026-07-25): standing IN-REPO docs tested
  // against the bi-temporal fact ledger system/recall/facts.db. The DOC is the test subject; facts.db
  // (derived from STRUCTURED sources) is the expectation - so this does NOT reintroduce the V6
  // anti-pattern of deriving an expectation FROM prose. Complements C19 (the out-of-repo master doc).
  {
    const fc = spawnSync(process.execPath, [path.join('scripts', 'facts-check.js')], { encoding: 'utf8', cwd: REPO });
    const out = `${fc.stdout || ''}${fc.stderr || ''}`;
    if (fc.status === 2) {
      for (const ln of out.split(/\r?\n/)) if (ln.trim()) addDrift('facts-drift', ln.trim());
    } else if (fc.status !== 0) {
      addDrift('facts-drift', `facts-check errored (exit ${fc.status}): ${out.split(/\r?\n/)[0] || ''}`);
    }
  }

  // --- C22 soul-corpus monotonicity (2026-07-28, command-layer review F-1): the soul.md "My Words"
  // corpus must never SHRINK. Same shape as C9, applied to the highest-value file in the repo. Why it
  // exists: /setup step 4B said "OVERWRITE the template ... Under 2.5KB" with no fresh-install branch,
  // so any agent running /setup on a live install would truncate a 115KB corpus built over months.
  // That failure is SILENT - every prose surface keeps working, it just stops sounding like Shaheen -
  // and Close-Out V cannot catch it, because V only asks whether My Words gained AN entry today, which
  // a freshly overwritten file satisfies. soul.md is gitignored, so no git-based guard can ever see it.
  {
    const soulPath = paths.soulMd();
    if (!exists(soulPath)) {
      addDrift('soul-shrink', `soul.md is MISSING at ${soulPath} - Alex has no identity file (restore from the encrypted vault backup)`);
    } else {
      const soulText = readText(soulPath) || '';
      const soulLines = lineCount(soulPath);
      const soulEntries = (soulText.match(/^###\s+(Harvested\s+)?\d{4}-\d{2}-\d{2}/gm) || []).length;
      const prevSoul = readJson(SOUL_HW_FILE);
      const prevEntries = prevSoul ? parseInt(prevSoul.entries, 10) || 0 : 0;
      const prevSoulLn = prevSoul ? parseInt(prevSoul.lines, 10) || 0 : 0;
      if (soulEntries < prevEntries) {
        addDrift('soul-shrink', `soul.md My Words corpus SHRANK from ${prevEntries} to ${soulEntries} dated entries - the voice corpus is the input to every prose surface; restore from the 21:45 encrypted vault backup (last 14 kept) before it ages out`);
      }
      if (soulLines < prevSoulLn) {
        addDrift('soul-shrink', `soul.md shrank from ${prevSoulLn} to ${soulLines} lines (entries ${prevEntries} -> ${soulEntries}) - check for a truncating write`);
      }
      fs.writeFileSync(
        SOUL_HW_FILE,
        JSON.stringify({ entries: Math.max(soulEntries, prevEntries), lines: Math.max(soulLines, prevSoulLn), updated: fmt(now()) }, null, 2) + '\n'
      );
    }
  }

  // --- C23 soul-core freshness (S1 Compiled Surfaces, 2026-08-16): soul-core.md is THE identity
  // injection since the @-import swap (harness 2.1.220 truncates hook stdout at ~10KB, so the old
  // `cat soul.md` path delivered ~2KB; the card rides a CLAUDE.md memory import and loads whole).
  // The card's tail stamp carries source-sha256 = sha256(soul.md BYTES) at build time; this check
  // recomputes the live hash (same byte primitive the builder uses) and AMBERS on any mismatch -
  // a stale card means every session is fed yesterday's identity slice and the nightly 21:35
  // rebuild (run-vault-index.sh) or the generator missed. A MISSING card also ambers: the
  // SessionStart hook falls back to full soul.md (fail-open, by design), but on this harness that
  // fallback delivers only the 2KB preview, so a silently deleted card must not hide behind it.
  // The FIX half is the hq-heal-map `soul-core-stale` AUTO-SAFE row (rebuild --force + read-back,
  // one attempt then escalate). Compute-and-compare; negative-tested at install with a stale stamp.
  {
    const soulP = paths.soulMd();
    const corePath = path.join(REPO, 'soul-core.md');
    if (exists(soulP)) {
      if (!exists(corePath)) {
        addDrift('soul-core', 'soul-core.md MISSING - sessions run on the truncated full-soul fallback (~2KB reaches the model). Rebuild: node scripts/lib/build-soul-core.js --force');
      } else {
        const coreText = readText(corePath) || '';
        const stampM = /source-sha256=([0-9a-f]{64})/.exec(coreText.slice(Math.max(0, coreText.length - 400)));
        if (!stampM) {
          addDrift('soul-core', 'soul-core.md has no parseable SOUL-CORE-STAMP source-sha256 - hand-edited or truncated; rebuild: node scripts/lib/build-soul-core.js --force');
        } else {
          const liveSha = String(sha(soulP) || '').toLowerCase();
          if (liveSha !== stampM[1]) {
            addDrift('soul-core', `soul-core.md STALE: card built from sha ${stampM[1].slice(0, 12)}.. but soul.md is now ${liveSha.slice(0, 12)}.. - the nightly rebuild missed; node scripts/lib/build-soul-core.js --force`);
          }
        }
      }
    }
  }

  // --- C24 status byte budget (S1 Compiled Surfaces P2, 2026-08-16): Tier-1 status.md files are
  // SUMMARIES by contract and had grown to 87-180KB. scripts/status-rotate.js (nightly, before the
  // 21:35 index build) moves whole dated H2 blocks to history/; this check reads LIVE byte counts
  // against manifest meta.vault.status_byte_budget so a dead rotator cannot hide behind a green
  // chain. Fires at budget + 10% (deliberate grace: the keep-the-newest-dated-block rule can land a
  // file a few hundred bytes over, and an amber that cries over 4 bytes teaches amber-blindness,
  // the F-14 lesson). The message distinguishes "movable blocks present = the rotator missed" from
  // "undated standing weight = needs a human restructure / the monthly /lint" - different remedies.
  // Negative-tested at install with a temp-inflated file.
  {
    const sbBudget = Number(manifest.meta?.vault?.status_byte_budget) || 0;
    if (sbBudget > 0) {
      const sbRows = [...(manifest.projects || []), ...((manifest.meta && manifest.meta.unnumbered) || [])];
      const sbSeen = new Set();
      for (const p of sbRows) {
        if (!p.status_md) continue;
        const sp = path.join(REPO, p.status_md);
        if (sbSeen.has(sp) || !exists(sp)) continue;
        sbSeen.add(sp);
        const len = fs.statSync(sp).size;
        if (len <= Math.round(sbBudget * 1.1)) continue;
        const txt = readText(sp) || '';
        const movable = (txt.match(/^##\s.*\b20\d{2}-\d{2}-\d{2}\b/gm) || []).length;
        const why =
          movable > 1
            ? `has ${movable} dated block(s) the rotator should have moved - is the nightly status-rotate step dead? (run: node scripts/status-rotate.js)`
            : 'weight is UNDATED standing content - rotation cannot help; needs a human restructure (a /lint-class judgment pass)';
        addDrift('status-budget', `${p.status_md} is ${len} B against the ${sbBudget} B Tier-1 budget - ${why}`);
      }
    }
  }

  // --- C25 inbound mail channels (2026-08-23): every custom address on the zone that forwards into
  // Gmail is asserted to still have an enabled Cloudflare routing rule, and to have actually received
  // mail inside its declared window. Born from a real 2.5-month silent outage: shaheen@shaheenkiarash.com,
  // the ONLY contact address on the live portfolio site, stopped delivering around 2026-06-08 and
  // nothing anywhere went red. What a MISSING rule does depends on the catch-all: enabled+drop means
  // accepted-then-binned with nobody told; DISABLED means REJECTED at SMTP and the SENDER gets a bounce.
  // CORRECTED 2026-08-23 from a live API read: this zone has it DISABLED, so the first version of this
  // comment had the mechanism backwards, and its evidence was misread (two probe mails produced no bounce
  // because they were DELIVERED and Gmail deduped Shaheen's own copies). Either way HE hears nothing, and
  // he is the only observer the system can act for. Every component was green
  // because the system only ever checked that its own JOBS ran, never that expected mail ARRIVED.
  // Shelled out C12-style because the probe needs the network, and check.mjs's "no network except the
  // one HQ push" contract must hold. Registry: system/mail-channels.json (add a channel = one row).
  {
    const mc = spawnSync(process.execPath, [path.join('scripts', 'mail-channel-check.js'), '--dry'], { encoding: 'utf8', cwd: REPO });
    const mcOut = `${mc.stdout || ''}${mc.stderr || ''}`;
    if (mc.status === 2) {
      for (const line of mcOut.split(/\r?\n/)) {
        if (/^DRIFT: /.test(line)) addDrift('mail-channels', line.replace(/^DRIFT: /, ''));
      }
    } else if (mc.status !== 0) {
      addDrift('mail-channels', `mail-channel-check errored (exit ${mc.status}): ${mcOut.split(/\r?\n/)[0] || ''}`);
    }
  }

  // --- C30 code-map freshness (P7.1, run-47 merged plan, 2026-08-23): `scripts/code-index.js` builds a
  // deterministic map of this repo's own code (what requires/sources/invokes what) that /deep-audit
  // and #27 migrations read instead of fanning out agents to re-read everything. A map is only useful
  // while it is true, and a STALE map is worse than none: it answers confidently about code that has
  // since moved, which is precisely the failure mode that disqualified graphify's query-first design.
  // N/A when the map has never been built (an absent optional index is not drift); AMBER when it exists
  // and the newest source file is more than 7 days newer than it. Shells out C12-style so this file's
  // "no network except the one HQ push" contract holds and the freshness logic has ONE home.
  if (exists(path.join(REPO, 'system', 'code-graph.json'))) {
    const cg = spawnSync(process.execPath, [path.join('scripts', 'code-index.js'), '--stale'], { encoding: 'utf8', cwd: REPO });
    if (cg.status === 2) {
      const cgOut = `${cg.stdout || ''}${cg.stderr || ''}`.trim().replace(/\s+/g, ' ');
      addDrift('code-map', `code-graph.json is stale - ${cgOut}. Rebuild: node scripts/code-index.js`);
    }
  }

  // --- C29 hook liveness (P3.7, run-47 merged plan, 2026-08-23): every wired hook leaves a breadcrumb,
  // and until now NOTHING asserted that the breadcrumbs keep arriving. A hook that silently stops
  // firing is invisible for weeks: the voice hook already died quietly once (its own header records
  // it), and the recall/capture hooks would fail exactly as quietly because both are fail-OPEN by
  // design - which is correct for a prompt path and is precisely why their silence needs a separate
  // watcher. Asserts each hook produced evidence inside its own window, sized to how often that hook
  // can legitimately fire. NEVER-FIRED is reported in different words from WENT-QUIET (the C20/F-14
  // rule): a hook wired today has no history yet, and saying "stale" would be a lie.
  {
    const today = fmt(now()).slice(0, 10);
    const hookProbes = [
      { name: 'UserPromptSubmit/recall-inject', p: path.join('system', 'recall', 'recall-metrics.jsonl'), days: 3 },
      { name: 'UserPromptSubmit/capture-typed', p: path.join('outputs', 'typed', 'transcripts', `${today}.md`), days: 3, todayOnly: true },
      { name: 'PreCompact|SessionEnd|ToolFail', p: path.join('system', 'lifecycle.jsonl'), days: 14 },
    ];
    for (const hp of hookProbes) {
      const hpFull = path.join(REPO, hp.p);
      if (!exists(hpFull)) {
        // Never-fired: state it as such. For the per-day transcript this is normal on a quiet day.
        if (!hp.todayOnly) {
          addDrift('hook-liveness', `${hp.name}: no evidence file yet at ${hp.p} - NEVER FIRED (not stale). Expected once the hook runs for the first time; if it stays empty past a few sessions the wiring in .claude/settings.json is dead.`);
        }
        continue;
      }
      const ageDays = days(now() - fs.statSync(hpFull).mtime);
      if (ageDays > hp.days) {
        addDrift('hook-liveness', `${hp.name}: last evidence ${Math.round(ageDays * 10) / 10}d ago in ${hp.p}, window is ${hp.days}d - the hook went QUIET. Check .claude/settings.json wiring and the script's own log.`);
      }
    }
  }

  // --- C28 user-scope skill inventory (P2.1, run-47 merged plan, 2026-08-23): `~/.claude/skills/` is
  // entirely OUTSIDE skills-lock.json, the S7 hash sweep and every audit gate this repo owns. Those
  // guard `.agents/skills/` (project scope) only. The run-47 assessment found the consequence live:
  // graphify has sat at user scope since 2026-06-09, unpinned, unaudited, 113 releases stale, wired
  // into every session by the global CLAUDE.md, self-installing a PyPI package from prose - and it was
  // found by a human reading it in August, not by any mechanism. This inventory is the mechanism that
  // would have surfaced it in June. AMBER + names the skill: appearing here is not an accusation, it
  // is "this exists outside every baseline you have, decide about it".
  {
    const c28Baseline = path.join(STATE_DIR, 'user-skills-baseline.json');
    const userSkillsDir = path.join(os.homedir(), '.claude', 'skills');
    if (exists(userSkillsDir)) {
      const liveUser = listDirs(userSkillsDir).sort();
      if (exists(c28Baseline)) {
        const known = (readJson(c28Baseline) || {}).skills || [];
        const newOnes = liveUser.filter((s) => !known.includes(s));
        const goneOnes = known.filter((s) => !liveUser.includes(s));
        if (newOnes.length) {
          addDrift('user-skills', `user-scope skill(s) present but NOT baselined: ${newOnes.join(', ')} - these live outside skills-lock.json, the S7 hash sweep and every audit gate; review, then re-run check.mjs --init to accept`);
        }
        if (goneOnes.length) {
          addDrift('user-skills', `baselined user-scope skill(s) now MISSING: ${goneOnes.join(', ')} - a skill disappearing is as much a change as one arriving; re-run check.mjs --init if the removal was deliberate`);
        }
      } else {
        addDrift('user-skills', `no user-scope skill baseline yet (${liveUser.length} skill(s) in ${userSkillsDir}) - run check.mjs --init to record the accepted set`);
      }
    }
  }

  // --- C27 soul-core byte budget (P1.6, run-47 merged plan, 2026-08-23): the identity card is the one
  // surface EVERY session and every scheduled run pays for, and its size was guarded by a builder WARN
  // that shipped the oversized card anyway - the same dead-check-green shape as the backup's identity
  // warning. The builder now trims the recency slice to manifest meta.vault.soul_core_byte_budget;
  // this is the level-triggered proof that it worked. Over budget here means the trim hit the
  // MIN_ENTRIES floor and could not get under, which is a real signal (his recent entries are long)
  // and wants a human decision: raise the budget deliberately, or prune the corpus.
  {
    const scBudget = Number(manifest.meta?.vault?.soul_core_byte_budget) || 0;
    const scPath = path.join(REPO, 'soul-core.md');
    if (scBudget > 0 && exists(scPath)) {
      const scLen = fs.statSync(scPath).size;
      if (scLen > scBudget) {
        addDrift('soul-core-budget', `soul-core.md is ${scLen} B against the ${scBudget} B budget - the builder's trim hit its MIN_ENTRIES floor, so this needs a human call: raise meta.vault.soul_core_byte_budget deliberately, or prune the My Words corpus`);
      }
    }
  }

  // --- C26 vault/log.md tail ordering (P1.5, run-47 merged plan, 2026-08-23): the activity log is
  // described everywhere as append-only and time-ordered, and measured on 2026-08-23 it was neither -
  // 276 of 1,107 adjacent heading pairs ran BACKWARDS, one entry was stamped in the future, and no
  // script owned the file (run-46 finding N3). scripts/log-append.js is now the mechanical writer and
  // refuses an out-of-order stamp; this check is the level-triggered backstop for anything written by
  // hand or by a model. HISTORY IS BASELINED, NOT REPAIRED: the 276 existing inversions are what
  // actually happened and rewriting them would be a lie, so only entries at or after the baseline date
  // are asserted. AMBER, never RED: an ordering wobble is a hygiene problem, not a data-loss one.
  {
    const c26Baseline = String(manifest.meta?.vault?.log_order_baseline || '');
    const logPath = paths.vaultLog();
    if (c26Baseline && exists(logPath)) {
      const stamps = [...(readText(logPath) || '').matchAll(/^## \[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]/gm)]
        .map((m) => m[1])
        .filter((s) => s >= c26Baseline);
      let inversions = 0;
      for (let i = 1; i < stamps.length; i++) if (stamps[i] < stamps[i - 1]) inversions++;
      if (inversions > 0) {
        addDrift('log-order', `vault/log.md has ${inversions} out-of-order entry pair(s) at or after the ${c26Baseline} baseline - append through scripts/log-append.js (it refuses an older-than-tail stamp) instead of writing the file by hand`);
      }
      // A stamp in the FUTURE is its own defect: it makes every later entry look out of order and
      // poisons any temporal join. Checked against local now + 5 min of clock slack.
      const slack = fmtMin(new Date(Date.now() + 5 * 60000));
      const future = stamps.filter((s) => s > slack);
      if (future.length) {
        addDrift('log-order', `vault/log.md carries ${future.length} future-stamped entr(ies) (newest: ${future[future.length - 1]}) - a timestamp ahead of now cannot be trusted for ordering`);
      }
    }
  }

  // ---------------------------------------------------------------- report
  // --- C31 task-completion monitor (the dead-man switch). Recovered 2026-08-28 from
  // backup/main-local-2026-08-25, where it was written and then stranded when the platform migration
  // deleted the PowerShell checker. Design: work/18-recovery-layer/archive/C31-dead-man-switch.ps1.txt
  //
  // THE INVERSION, and it is the whole point. Every other check here judges state. This one judges
  // NOTHING: each scheduled task appends a signal as its FINAL act after genuine success, and this
  // check only notices ABSENCE. Red is the default posture, so a registered task is green ONLY by
  // evidence. That is what makes it un-rottable: there is no red branch that can silently stop being
  // reachable, because red is what happens when nothing is done at all.
  //
  // WHY IT IS BACK. On ~2026-08-25 all 23 scheduled jobs began failing silently because they pointed at
  // wrapper scripts a platform migration had deleted, and the failure reporter lived INSIDE the wrapper
  // that never launched. Nothing alarmed for two days. This check is the mechanism that catches exactly
  // that class, because a process that never starts cannot reach its final act.
  //
  // DELIBERATELY NOT READ: scheduler exit codes or any scheduler state. Signals from INSIDE the task
  // make an expected-exit contract unnecessary, and a process killed mid-run never signals at all.
  //
  // Three verdicts, never collapsed into one colour: fresh signal + exit 0 = green; fresh signal +
  // nonzero = WENT-WRONG (it ran, finished, and reported its own failure); no signal in the window =
  // MISSING (never ran, died mid-run, or was never wired). A task that vanished and a task that
  // reported failure are different problems with different urgency.
  {
    const regPath = path.join(REPO, 'system', 'task-registry.json');
    const sigPath = path.join(REPO, 'system', 'task-signals.jsonl');
    if (!exists(regPath)) {
      // Gitignored by design (it names this machine's tasks and their timing, and the repo is public),
      // so a fresh clone legitimately has none. Absent registry is not-yet-configured, not drift.
      say('C31 task-completion: SKIP (no system/task-registry.json yet - gitignored, so a fresh clone starts without one)');
    } else {
      const reg = readJson(regPath);
      if (!reg || reg.schema !== 'task-registry@1') {
        // Fail LOUD on a wrong or absent schema id. A monitor reading a registry it does not
        // understand must stop, not guess.
        throw new Error(`C31: system/task-registry.json missing or wrong schema (expected task-registry@1, got ${reg && reg.schema})`);
      }
      const regTasks = (reg.tasks || []).filter((t) => t && t.name && t.enabled !== false);
      const signals = [];
      let badLines = 0;
      if (exists(sigPath)) {
        for (const ln of (readText(sigPath) || '').split(/\r?\n/)) {
          if (!ln.trim()) continue;
          try { signals.push(JSON.parse(ln)); } catch { badLines++; }
        }
      }
      if (badLines > 0) {
        addDrift('task-signals', `system/task-signals.jsonl carries ${badLines} unparseable line(s). The ledger is append-only with exactly one writer role, so a malformed line means a partial write or a second writer.`);
      }
      const nowMs = now().getTime();
      let missing = 0, wentWrong = 0, green = 0;
      for (const t of regTasks) {
        const windowH = Number(t.interval_hours || 24) + Number(t.grace_hours || 4);
        const cutoff = nowMs - windowH * 3600000;
        let latestWhen = 0, latestCode = 0;
        for (const s of signals) {
          if (String(s.task) !== String(t.name)) continue;
          const w = Date.parse(s.at || s.when || '');
          if (Number.isNaN(w) || w <= latestWhen) continue;
          latestWhen = w; latestCode = Number(s.exit || 0);
        }
        if (latestWhen === 0 || latestWhen < cutoff) {
          missing++;
          const age = latestWhen ? `${Math.round(days(nowMs - latestWhen))}d old` : 'never signalled';
          addDrift('task-missing', `${t.name}: no completion signal inside its ${windowH}h window (${age}). It never ran, died mid-run, or was never wired. This is the class that hid the 2026-08-25 outage for two days.`);
        } else if (latestCode !== 0) {
          wentWrong++;
          addDrift('task-failed', `${t.name}: ran and reported its OWN failure (exit ${latestCode}). It is alive and something inside it broke, which is a different problem from MISSING.`);
        } else {
          green++;
        }
      }
      say(`C31 task-completion: ${regTasks.length} enabled, ${green} green, ${wentWrong} went-wrong, ${missing} missing, ${signals.length} signal(s) on file`);
    }
  }

  const n = drift.length;
  const byCat = [...drift.reduce((m, d) => m.set(d.cat, [...(m.get(d.cat) || []), d]), new Map())]
    .map(([name, group]) => ({ name, count: group.length, group }))
    .sort((a, b) => b.count - a.count);
  const stamp = fmtMin(now());
  say(`=== sweep ${stamp} : ${n} drift items ===`);

  const report = [];
  report.push('# Recovery Sweep - last-sweep');
  report.push('');
  report.push(`**${stamp}** | result: ${n === 0 ? 'CLEAN' : `${n} drift items`}`);
  report.push('');
  if (n === 0) {
    report.push('System consistent: quads complete, links resolve, scheduler matches the live timers, no orphans or shrink.');
  } else {
    for (const g of byCat) {
      report.push(`## ${g.name} (${g.count})`);
      for (const item of g.group) report.push(`- ${item.msg}`);
      if (g.name === 'links' && linkSamples.length > 0) for (const s of linkSamples) report.push(`  - ${s}`);
      report.push('');
    }
    report.push('_Detect-only. Nothing was changed. Register/fix or retire-to-archive, then re-run. Content/semantic drift (stale prose) is the monthly /lint\'s job, not this sweep\'s._');
  }

  // Vault-read health (item 2, 2026-07-20): INFORMATIONAL only, NEVER a drift item - a soft usage
  // signal must not touch the checker's 0/2/1 drift semantics. Its exit code is deliberately IGNORED.
  report.push('');
  let vrLine = '';
  {
    const vr = spawnSync('python3', [path.join('scripts', 'vault-reads-report.py'), '--days', '60'], { encoding: 'utf8', cwd: REPO });
    vrLine = `${vr.stdout || ''}${vr.stderr || ''}`.split(/\r?\n/)[0] || 'vault-read report unavailable';
  }
  report.push(`**Vault-read health (informational, not drift):** ${vrLine}`);

  const lastSweep = path.join(REPO, 'vault', 'projects', 'recovery', 'last-sweep.md');
  fs.mkdirSync(path.dirname(lastSweep), { recursive: true });
  fs.writeFileSync(lastSweep, report.join('\n') + '\n', 'utf8');

  // console summary
  console.log(`Recovery sweep: ${n === 0 ? 'CLEAN' : `${n} drift items`}`);
  for (const g of byCat) console.log(`  ${g.name.padEnd(16)} ${g.count}`);
  console.log('Report: vault/projects/recovery/last-sweep.md');

  // ---------------------------------------------------------------- Alex HQ push (recovery/integrity)
  const head = n === 0
    ? `consistent, ${manifest.projects.length} projects`
    : `${n} drift: ${byCat.slice(0, 3).map((g) => `${g.name} ${g.count}`).join(', ')}`;
  hqPush({ valueNum: n, headline: head, status: n === 0 ? 'green' : 'amber' });

  say(`done (${n} drift)`);
  process.exit(n === 0 ? 0 : 2);
} catch (e) {
  // Fail LOUD: the checker itself broke. Push RED integrity (value_num -1) so the tile can't sit
  // stale-green while the sweep is dead - the exact "job can't announce its own failure" class this
  // layer was built to kill (design piece 5), now guarded inside the layer itself.
  pushCheckerError(e.stack || e.message);
  process.exit(1);
}
