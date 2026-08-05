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
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Derive the repo root from the script's own location. A RECOVERY tool must survive a restore to
// any path/machine, so never hardcode the root.
const REPO = path.resolve(HERE, '..', '..');
process.chdir(REPO);

const { paths, manifest: loadManifest } = await import(`${REPO}/scripts/lib/paths.mjs`);
const { sha, sameHash } = (await import(`${REPO}/scripts/lib/repo-hash.js`)).default;
const { liveJobs: systemdJobs, hasSystemd } = await import(`${REPO}/scripts/lib/gen-systemd.js`).then((m) => m.default || m);

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
  console.log(
    `Baselined: ${manifest.projects.length} CLAUDE.md hashes + log high-water ${logLines} lines -> ${STATE_DIR}`
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

  // Ruling C: on the macOS dev box there is no scheduler to be in drift WITH, so C7/C7b are SKIPPED
  // loudly rather than reporting all 23 documented jobs as missing. That would be 23 false findings
  // every run, which is how a checker gets ignored.
  let liveJobs = [];
  let schedulerReadable = false;
  if (!hasSystemd()) {
    say(`C7 SKIPPED: no systemd on this machine (platform=${process.platform}) - the scheduler half of the sweep did not run`);
  } else {
    try {
      liveJobs = systemdJobs().filter((j) => !isEphemeral(j));
      schedulerReadable = true;
    } catch (e) {
      addDrift('scheduler', `cannot read the live systemd timers (${e.message}) - the scheduler half of the sweep did not run`);
    }
  }
  if (schedulerReadable) {
    for (const j of docJobs) if (!liveJobs.includes(j)) addDrift('scheduler', `documented job '${j}' is NOT registered as a systemd timer`);
    for (const j of liveJobs) if (!docJobs.includes(j)) addDrift('scheduler', `registered timer '${j}' is NOT documented in scheduler/schedule.md`);
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
      const missingLinks = [];
      const brokenLinks = [];
      for (const name of listDirs(agentsSkills)) {
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
        addDrift('skills-link', `${missingLinks.length} skill(s) in .agents/skills/ have no .claude/skills/ link (rebuild per pair: ln -s ../../.agents/skills/<name> .claude/skills/<name>): ${missingLinks.join(', ')}`);
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

  // ---------------------------------------------------------------- report
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
