#!/usr/bin/env node
// skills-installer.js - #25 Evolution skills lane, the deterministic auto-install engine (2026-07-11).
// ZERO model tokens. It reads the weekly eval's machine-readable install block (the fenced ```json in
// outputs/evolution/<date>/digest.md, or a --manifest file) and, for each proposed skill, runs the
// automated VALIDATION that stands in for the removed human gate:
//   resolve GitHub source -> revocation list -> trust allowlist -> SHA-pinned source audit
//   (hooks/scripts/network, every read at ONE resolved commit) -> dedup -> cap -> install ->
//   post-install byte-verify against the audited SHA (mismatch = rollback + flag).
// The SHA-pin + verify + `revoked` list landed 2026-08-05 (enterprise-assessment idea 4,
// vault/research/enterprise-assessment-ideas.md): before it, audit reads and the `npx skills add`
// fetch hit a MOVING branch ref at different moments, so audited and installed content could differ.
// A survivor is installed live (`npx skills add`), then WIRED into the recall architecture (root
// CLAUDE.md Skill Bindings row + the target project's work/NN/CLAUDE.md ## Skills line), the docs are
// regenerated, and each install is its own git commit so `git revert <sha>` is the always-available
// undo. Anything that fails a gate is NOT installed - it is reported as "Flagged, manual review".
//
// This is Shaheen's 2026-07-11 decision: full auto-install for the skills lane only. Models, MCPs and
// new patterns still go through the human-gated integration runbook (work/25-evolution/CLAUDE.md).
//
// Usage:
//   node scripts/skills-installer.js outputs/evolution/<date>/digest.md
//   node scripts/skills-installer.js --manifest path/to/manifest.json
//   node scripts/skills-installer.js --manifest ... --dry-run     (audit + report, never install/commit)
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, execFileSync, spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const CONFIG = path.join(REPO, 'system', 'skills-sources.json');
const LOCK = path.join(REPO, 'skills-lock.json');
const ROOT_CLAUDE = path.join(REPO, 'CLAUDE.md');
const MANIFEST = path.join(REPO, 'system', 'manifest.json');
const BIND_BEGIN = '<!-- ALEX-AUTO-SKILLS:BEGIN -->';
const BIND_END = '<!-- ALEX-AUTO-SKILLS:END -->';

const DRY = process.argv.includes('--dry-run');
const today = () => new Date().toISOString().slice(0, 10);

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

// ---- input: the eval's install block -----------------------------------------------------------
function loadCandidates() {
  const mArg = process.argv.find(a => a === '--manifest');
  if (mArg) {
    const file = process.argv[process.argv.indexOf('--manifest') + 1];
    const j = readJSON(file, null);
    if (!Array.isArray(j)) throw new Error(`--manifest ${file} is not a JSON array`);
    return j;
  }
  const digest = process.argv.find(a => !a.startsWith('--') && a !== process.argv[0] && a !== process.argv[1]);
  if (!digest || !fs.existsSync(digest)) return [];
  const md = fs.readFileSync(digest, 'utf8');
  // Take the LAST ```json ... ``` fenced block (the installer's machine input).
  const blocks = [...md.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (!blocks.length) return [];
  const raw = blocks[blocks.length - 1][1].trim();
  const arr = readJSON(raw, null);
  return Array.isArray(arr) ? arr : [];
}

// ---- GitHub source audit -----------------------------------------------------------------------
async function ghJSON(url) {
  const headers = { 'User-Agent': 'alex-skills-installer', 'Accept': 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub ${res.status} ${url}`);
  return res.json();
}
async function ghText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'alex-skills-installer' } });
  if (!res.ok) throw new Error(`GitHub raw ${res.status}`);
  return res.text();
}

// Returns { ok:true } or { ok:false, reason }. Deterministic, source-level, from config rules.
async function auditRepo(owner, repo, skillName, cfg) {
  const a = cfg.audit || {};
  const blockPaths = (a.block_repo_paths || []).map(s => s.toLowerCase());
  const blockTokens = a.block_if_scripts_touch || [];
  const allowedDomains = (a.allowed_outbound_domains || []).map(s => s.toLowerCase());

  let meta;
  try { meta = await ghJSON(`https://api.github.com/repos/${owner}/${repo}`); }
  catch (e) { return { ok: false, reason: `repo not reachable (${e.message})` }; }
  const branch = meta.default_branch || 'main';

  // SHA-pin (2026-08-05, enterprise-assessment idea 4): resolve the moving branch ref to ONE commit
  // SHA and do EVERY read below at that SHA. Before this, the tree and each raw fetch hit the branch
  // ref independently, and `npx skills add` fetched the repo AGAIN at install time - so the content
  // audited and the content installed could differ (upstream can rewrite a skill between the two).
  // The SHA travels into the lock (sourceCommit) and the post-install verify re-checks installed
  // bytes against it, which terminates the audit-vs-install TOCTOU class.
  let sha;
  try { sha = (await ghJSON(`https://api.github.com/repos/${owner}/${repo}/commits/${branch}`)).sha; }
  catch (e) { return { ok: false, reason: `head commit not resolvable (${e.message})` }; }

  let tree;
  try { tree = await ghJSON(`https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`); }
  catch (e) { return { ok: false, reason: `tree not reachable (${e.message})` }; }
  const paths = (tree.tree || []).map(t => t.path);

  // `skills add` copies ONLY the skill's own directory (repo-root plugin hooks are NOT copied or run),
  // so the audit is scoped to the SKILL'S OWN directory - not the whole repo (that would wrongly block
  // trusted plugin repos like obra/superpowers that ship root hooks). If the skill dir can't be located,
  // fall back to whole-repo (a missing skill dir is itself suspicious).
  // No RegExp here on purpose: skillName is MODEL-AUTHORED (it arrives in the weekly eval's json
  // block, assembled from skill-market rows). Interpolating it into a pattern made a metachar throw
  // out of the audit into the caller's catch, which reports 'audit error' instead of a clean refusal
  // (A12-T11). A plain string compare cannot be broken by any character the name contains.
  const wantTail = (skillName + '/SKILL.md').toLowerCase();
  const skillDir = paths.find(p => { const lp = p.toLowerCase(); return lp === wantTail || lp.endsWith('/' + wantTail); });
  const dirPrefix = skillDir ? skillDir.replace(/SKILL\.md$/i, '') : '';
  const inScope = p => (dirPrefix ? p.startsWith(dirPrefix) : true);

  // 1) Blocked path segments inside the skill dir (install/lifecycle hooks shipped WITH the skill).
  for (const p of paths) {
    if (!inScope(p)) continue;
    const lp = p.toLowerCase();
    if (blockPaths.some(b => lp.includes(b))) return { ok: false, reason: `blocked path in skill dir: ${p}` };
  }

  // 2) A package.json shipped INSIDE the skill dir with lifecycle scripts (the real, rare risk).
  const pkgPath = paths.find(p => inScope(p) && /(^|\/)package\.json$/i.test(p));
  if (pkgPath) {
    try {
      const pkg = JSON.parse(await ghText(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${pkgPath}`));
      const bad = (a.block_manifest_keys || []).filter(k => pkg.scripts && pkg.scripts[k]);
      if (bad.length) return { ok: false, reason: `${pkgPath} lifecycle script(s): ${bad.join(', ')}` };
    } catch { /* unreadable package.json is not itself a block */ }
  }

  // 3) Scan executable files inside the skill's own directory for dangerous tokens / non-allowlisted URLs.
  const scripts = paths.filter(p => inScope(p) && /\.(js|mjs|cjs|sh|py|ps1)$/i.test(p));
  for (const sp of scripts.slice(0, 20)) {
    let body = '';
    try { body = await ghText(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${sp}`); }
    catch { continue; }
    const lc = body.toLowerCase();
    const hitTok = blockTokens.find(t => lc.includes(String(t).toLowerCase()));
    if (hitTok) return { ok: false, reason: `script ${sp} uses "${hitTok}"` };
    for (const m of body.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = m[1].toLowerCase();
      if (!allowedDomains.some(d => host === d || host.endsWith('.' + d))) {
        return { ok: false, reason: `script ${sp} calls non-allowlisted host ${host}` };
      }
    }
  }

  /*
   * 4) Scan the skill's own MARKDOWN for hidden-unicode payloads and install-by-instruction.
   *    (P2.5 + the graphify class, run-47 merged plan, 2026-08-23.)
   *
   *    Step 3 above only reads .js/.sh/.py/.ps1, and that is exactly the blind spot: an agent skill's
   *    SKILL.md IS the payload, because an agent reading it executes what it says, and no script file
   *    has to exist at all. Two live proofs from the run-47 assessment. (a) graphify ships ZERO script
   *    files and self-installs a PyPI package from prose - it passed every script-scoped gate here and
   *    was only caught by a human reading it (2026-08-17), and at upstream HEAD it has since become
   *    MORE aggressive (`pip install --break-system-packages`). (b) Snyk's ToxicSkills work found
   *    prompt injection in 36% of scanned public skills, and the standard concealment is zero-width or
   *    bidi-override characters that are invisible in every editor and diff.
   *
   *    Persian carve-out: U+200C ZWNJ and U+200D ZWJ are legitimate joiners in Shaheen's languages and
   *    are NOT blocked; the pure concealment characters are.
   */
  const HIDDEN_UNICODE = /[​⁠﻿‪-‮⁦-⁩]/;
  const INSTALL_BY_INSTRUCTION = [
    /\bpip3?\s+install\b/i, /\buv\s+tool\s+install\b/i, /\buvx\s+/i,
    /\bnpm\s+(?:i|install)\s+(?:-g|--global)\b/i, /\bpipx\s+install\b/i,
    /--break-system-packages/i,
    // 2026-09-10 (A12-T6): the 08-23 pass closed the literal graphify verb list and nothing else.
    /\bcurl\s[^\n]*\|\s*(?:ba)?sh\b/i, /\bwget\s[^\n]*\|\s*(?:ba)?sh\b/i,
    /\bnpx\s+-y\b/i, /\bpoetry\s+add\b/i, /\bcargo\s+install\b/i, /\bbrew\s+install\b/i,
    /\bgem\s+install\b/i, /\bgo\s+install\b/i,
  ];

  /*
   * 2026-09-10, stress-test A12-T6 (FRACTURE High). A synthetic SKILL.md carrying a `hooks:` block,
   * a `child_process.exec` line, a curl to an external host and an ignore-the-constitution sentence
   * PASSED this audit singly and all four together. The blind spot was structural: step 3's token and
   * domain lists are applied to .js/.sh/.py/.ps1 only, and an agent skill's SKILL.md IS the payload -
   * an agent reading it executes what it says, and no script file has to exist at all.
   *
   * Three additions, in the order a payload is most likely to arrive:
   *   (a) FENCED CODE in markdown is executable content: the same block_if_scripts_touch tokens and
   *       allowed_outbound_domains that guard real script files now apply inside ``` fences.
   *   (b) FRONTMATTER GRANTS are refused: `hooks:` registers session-long commands this installer
   *       never reads, and `allowed-tools:` pre-approves tools the permission layer would otherwise
   *       prompt for. Both are capability grants arriving with untrusted content (A14-T7).
   *   (c) INSTRUCTION-SHAPED text aimed at the agent - "ignore the constitution", "do not tell the
   *       user" - is refused. A deliberately NARROW list of imperatives with no honest use in a skill
   *       description, NOT a general prompt-injection classifier: a classifier here would false-
   *       positive on security skills that legitimately DISCUSS injection, and a gate that cries wolf
   *       gets removed. Two installed skills already carry frontmatter grants (A14-T7), so (b) is
   *       scoped to NEW installs and the existing set is a separate re-audit item.
   */
  const FRONTMATTER_GRANTS = [
    { re: /^hooks\s*:/mi, what: 'a `hooks:` block, which registers session-long commands this installer never reads and no gate here inspects' },
    { re: /^allowed-tools\s*:/mi, what: 'an `allowed-tools:` grant, which pre-approves tools the permission layer would otherwise prompt for' },
  ];
  const INSTRUCTION_SHAPED = [
    /\bignore\s+(?:the\s+)?(?:previous\s+|prior\s+|above\s+|all\s+)?(?:instructions?|rules?|constitution)\b/i,
    /\bignore\s+CLAUDE\.md\b/i,
    /\bdisregard\s+(?:the\s+)?(?:previous\s+|prior\s+|above\s+|all\s+)?(?:instructions?|rules?|constitution)\b/i,
    /\bdo\s+not\s+tell\s+the\s+user\b/i,
    /\bwithout\s+(?:telling|informing|notifying)\s+the\s+user\b/i,
    /\balways\s+follow\s+this\s+file\s+(?:instead|first)\b/i,
    /\boverrides?\s+(?:the\s+)?(?:constitution|CLAUDE\.md|system\s+prompt)\b/i,
  ];
  const fencedCode = (body) => [...body.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');

  const docs = paths.filter(p => inScope(p) && /\.(md|markdown)$/i.test(p));
  // Over the cap = REFUSED, not partly read. The old slice(0, 20) left the rest unexamined, which is
  // an unbounded hole wearing the costume of a bound.
  if (docs.length > 20) {
    return { ok: false, reason: `skill dir carries ${docs.length} markdown files, over the audit cap of 20 - refused rather than partly audited` };
  }
  for (const dp of docs) {
    let body = '';
    try { body = await ghText(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${dp}`); }
    catch { continue; }
    if (HIDDEN_UNICODE.test(body)) {
      return { ok: false, reason: `doc ${dp} contains hidden-unicode characters (zero-width or bidi override) - the standard prompt-injection concealment` };
    }
    const hitInstall = INSTALL_BY_INSTRUCTION.find(re => re.test(body));
    if (hitInstall) {
      return { ok: false, reason: `doc ${dp} instructs a package install in prose (${hitInstall.source}) - install-by-instruction is invisible to the script-scoped audit and is how a skill self-installs code (the graphify class)` };
    }
    const front = /^---\n([\s\S]*?)\n---/.exec(body);
    if (front) {
      const grant = FRONTMATTER_GRANTS.find(g => g.re.test(front[1]));
      if (grant) return { ok: false, reason: `doc ${dp} frontmatter declares ${grant.what} - a capability grant arriving with untrusted content (A12-T6, A14-T7)` };
    }
    const code = fencedCode(body);
    if (code) {
      const lcCode = code.toLowerCase();
      const hitCodeTok = blockTokens.find(t => lcCode.includes(String(t).toLowerCase()));
      if (hitCodeTok) return { ok: false, reason: `doc ${dp} contains fenced code using "${hitCodeTok}" - an agent reading a SKILL.md executes what it says, so fenced code is held to the same rules as a script file` };
      for (const m of code.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        const host = m[1].toLowerCase();
        if (!allowedDomains.some(d => host === d || host.endsWith('.' + d))) {
          return { ok: false, reason: `doc ${dp} has fenced code calling non-allowlisted host ${host}` };
        }
      }
    }
    const hitInstr = INSTRUCTION_SHAPED.find(re => re.test(body));
    if (hitInstr) {
      return { ok: false, reason: `doc ${dp} contains instruction-shaped text aimed at the agent (${hitInstr.source}) - a skill describes a capability, it does not tell the agent to ignore its constitution or hide its actions` };
    }
  }

  // Blob list of the skill's own dir at the audited SHA - the exact content set the post-install
  // verify holds the installed copy to.
  const dirFiles = (tree.tree || [])
    .filter(t => t.type === 'blob' && dirPrefix && t.path.startsWith(dirPrefix))
    .map(t => t.path);
  return { ok: true, branch, sha, skillPath: skillDir || null, dirPrefix, dirFiles };
}

// ---- post-install verify against the audited SHA (2026-08-05, idea 4) --------------------------
// `npx skills add` fetches upstream HEAD at install time, NOT the audited commit. This re-reads every
// file of the skill dir AT THE AUDITED SHA and byte-compares (CRLF-normalized) against what actually
// landed in .agents/skills/<name>/. Any mismatch, missing file, or extra local file means the install
// does not equal the audit -> the caller rolls the install back and flags it. Verify-after-write.
const norm = b => crypto.createHash('sha256').update(String(b).replace(/\r\n/g, '\n')).digest('hex');
async function verifyInstalledAgainstSha(owner, repo, audit, name) {
  if (!audit.dirPrefix || !audit.dirFiles || !audit.dirFiles.length) {
    return { ok: false, reason: 'audit carried no skill-dir file list to verify against' };
  }
  if (audit.dirFiles.length > 100) {
    return { ok: false, reason: `skill dir too large to verify (${audit.dirFiles.length} files > 100)` };
  }
  const local = path.join(REPO, '.agents', 'skills', name);
  const rel = p => p.slice(audit.dirPrefix.length);
  for (const p of audit.dirFiles) {
    const lp = path.join(local, rel(p));
    if (!fs.existsSync(lp)) return { ok: false, reason: `installed copy missing ${rel(p)}` };
    let remote;
    try { remote = await ghText(`https://raw.githubusercontent.com/${owner}/${repo}/${audit.sha}/${p}`); }
    catch (e) { return { ok: false, reason: `cannot re-read ${p} at audited SHA (${e.message})` }; }
    if (norm(remote) !== norm(fs.readFileSync(lp, 'utf8'))) {
      return { ok: false, reason: `content mismatch vs audited SHA: ${rel(p)} (upstream moved between audit and install)` };
    }
  }
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const expected = new Set(audit.dirFiles.map(p => path.normalize(rel(p))));
  const extras = walk(local).map(f => path.relative(local, f)).filter(f => !expected.has(path.normalize(f)));
  if (extras.length) return { ok: false, reason: `installed copy has file(s) absent at audited SHA: ${extras.slice(0, 5).join(', ')}` };
  return { ok: true };
}

// Rollback a just-installed skill dir + its .claude junction (only ever called on a verify failure,
// same run that created both - never touches a pre-existing install).
function rollbackInstall(name) {
  const link = path.join(REPO, '.claude', 'skills', name);
  const universal = path.join(REPO, '.agents', 'skills', name);
  try { if (fs.existsSync(link)) fs.rmdirSync(link); } catch { /* junction removal best-effort */ }
  try { fs.rmSync(universal, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ---- recall-architecture wiring (step 4b) ------------------------------------------------------
function projectFor(target, manifest) {
  const t = String(target || '').replace('#', '').trim().toLowerCase();
  return (manifest.projects || []).find(p =>
    String(p.num) === t || (p.name && p.name.toLowerCase() === t) ||
    (p.title && p.title.toLowerCase() === t) || (p.work_dir && p.work_dir.toLowerCase().includes(t)));
}

function addBindingRow(trigger, name, repo, strength) {
  let md = fs.readFileSync(ROOT_CLAUDE, 'utf8');
  const row = `| ${trigger} | ${name} (auto-installed #25 ${today()}, ${repo}) | ${strength} |\n`;
  if (md.includes(BIND_END)) {
    md = md.replace(BIND_END, row + BIND_END);
  } else if (md.includes('Audit outcome note:')) {
    md = md.replace('Audit outcome note:', row + '\nAudit outcome note:');
  } else {
    return false;
  }
  fs.writeFileSync(ROOT_CLAUDE, md, 'utf8');
  return true;
}

function addLocalSkillsLine(workDir, name, trigger) {
  const file = path.join(REPO, workDir, 'CLAUDE.md');
  if (!fs.existsSync(file)) return false;
  let md = fs.readFileSync(file, 'utf8');
  const bullet = `- ${name}: consult when - ${trigger}. (auto-wired by #25 evolution ${today()})\n`;
  const m = md.match(/^## Skills\b.*$/m);
  if (m) {
    const idx = md.indexOf(m[0]) + m[0].length;
    md = md.slice(0, idx) + '\n' + bullet + md.slice(idx + 1);
  } else {
    md = md.replace(/\s*$/, '\n') + `\n## Skills (auto-wired by #25 evolution)\n${bullet}`;
  }
  fs.writeFileSync(file, md, 'utf8');
  return true;
}

function upsertLock(name, repo, skillPath, sourceCommit) {
  const lock = readJSON(LOCK, { version: 1, skills: {} });
  let hash = null;
  const local = path.join(REPO, '.agents', 'skills', name, 'SKILL.md');
  if (fs.existsSync(local)) hash = crypto.createHash('sha256').update(fs.readFileSync(local)).digest('hex');
  lock.skills = lock.skills || {};
  // sourceCommit (2026-08-05, idea 4): the exact upstream commit the audit ran against and the
  // post-install verify held the installed bytes to. Provenance is now a pinned commit, not a branch.
  lock.skills[name] = {
    source: repo, sourceType: 'github', skillPath: skillPath || null, computedHash: hash,
    sourceCommit: sourceCommit || null, installedAt: today(),
  };
  fs.writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n', 'utf8');
}

function sh(cmd) { return execSync(cmd, { cwd: REPO, stdio: 'pipe' }).toString(); }

// --- Class E concurrency lock (2026-07-21; PROMOTED to the shared lib 2026-07-25, stress-test F-08).
// The 2026-07-20 sibling-session hazard (two installs racing the skills-lock, one deleting the other's
// entry mid-run) cannot silently corrupt state. The mutex used to be local to this file, which left the
// REAL incident shape - parallel sessions and the generator touching the same CLAUDE.md - unguarded.
// It now lives in scripts/lib/write-lock.js under ONE shared lock name, so this installer (which writes
// the CLAUDE.md ALEX-AUTO-SKILLS region + skills-lock.json) and generate-alex.js (which writes the
// CLAUDE.md routing region + docs) can never interleave on the same file. Semantics here stay DEFER:
// the weekly run is opportunistic, so the next run picks it up.
const writeLock = require('./lib/write-lock');
let heldLock = null;
function acquireLock() {
  heldLock = writeLock.acquire({ label: 'skills-installer', log: m => console.log(m) });
  if (!heldLock.ok) console.log(`skills-installer: lock ${heldLock.reason}`);
  return heldLock.ok;
}
function releaseLock() { if (heldLock) heldLock.release(); }

// --- Class E security preflight (2026-07-21; --no-verify dropped 2026-09-11, A16-T-05).
// This ran because the auto-install commit used to skip the hook entirely. The commit now goes
// through the full pre-commit suite like every other, so these are no longer the ONLY guards on
// this path - they are the EARLY ones. Running them here means an unattended weekly install
// diagnoses its own refusal ("V11 forced-add guard: ...") instead of dying on an opaque hook exit
// with no operator watching. V11: no gitignored path forced-added, which would push a secret
// world-visible. V10: no protected/immutable NEVER-TOUCH file mutated. Throws to abort.
function securityPreflightOrThrow() {
  const v11 = execSync('git ls-files --cached --ignored --exclude-standard', { cwd: REPO }).toString()
    .split('\n').map(s => s.trim()).filter(Boolean);
  if (v11.length) throw new Error(`V11 forced-add guard: gitignored path(s) staged for the PUBLIC repo: ${v11.join(', ')}`);
  const { evaluateProtectedChangeset, readStagedChangeset } = require('./validate-alex');
  const res = evaluateProtectedChangeset(readStagedChangeset());
  if (res.failures.length) throw new Error(`V10 protected-file guard: ${res.failures.join('; ')}`);
}

// The two CONTENT scans, run here as well as in the hook (belt and braces since 2026-09-11).
// gitleaks fail-CLOSED on a found secret; personal-data-scan fail-CLOSED on a blocking hit. Both
// read the STAGED changeset, exactly as the hook does, so a headless install fails with a named
// reason rather than an exit code.
function contentScansOrThrow() {
  try {
    execFileSync('gitleaks', ['protect', '--staged', '--no-banner', '--redact'], { cwd: REPO, stdio: 'pipe' });
  } catch (e) {
    if (e.code === 'ENOENT') {
      // Absent tool = fail-OPEN, matching the hook's documented posture, but said out loud.
      console.log('skills-installer: WARNING gitleaks not on PATH - staged secret scan SKIPPED for this commit');
    } else {
      throw new Error('gitleaks found a secret in the staged changeset - commit refused (PUBLIC repo)');
    }
  }
  const scan = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'personal-data-scan.js'), '--staged', '--json'], { cwd: REPO, encoding: 'utf8' });
  if (scan.status === 2) {
    throw new Error(`personal-data-scan found blocking hits in the staged changeset - commit refused (PUBLIC repo): ${String(scan.stdout || '').slice(0, 300)}`);
  }
}

function installSkill(repo, name) {
  // execFileSync with an ARRAY, never a shell string: name and repo are model-authored, and a `;`
  // in either used to reach the shell verbatim (A12-T11).
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['-y', 'skills', 'add', repo, '--skill', name], { cwd: REPO, stdio: 'inherit' });
  // Verify the universal copy exists; ensure the .claude/skills symlink is present (Windows gotcha).
  const universal = path.join(REPO, '.agents', 'skills', name);
  if (!fs.existsSync(universal)) throw new Error(`.agents/skills/${name} missing after add`);
  const link = path.join(REPO, '.claude', 'skills', name);
  if (!fs.existsSync(link)) {
    try { fs.symlinkSync(universal, link, 'junction'); }
    catch (e) { return `installed; .claude symlink NOT created (${e.message}) - recreate manually`; }
  }
  return 'installed';
}

// Testable core exported when required as a module (the validate-alex pattern): the SHA-pinned audit,
// the post-install verify and the rollback are pure-ish and provable without a live install.
module.exports = { auditRepo, verifyInstalledAgainstSha, rollbackInstall };

// ---- main --------------------------------------------------------------------------------------
if (require.main === module) (async () => {
  if (!acquireLock()) {
    console.log('skills-installer: another repo-surface mutator holds the shared write lock - deferring this run (Class E concurrency guard, 2026-07-21; shared lock since 2026-07-25 F-08).');
    process.exitCode = 0; return;
  }
  try {
  const cfg = readJSON(CONFIG, {});
  // Audit pause (2026-08-30, Survival Audit Phase 0, Shaheen authorised). `paused: true` in
  // system/skills-sources.json stops the AUTO-INSTALL lane only. The #25 monitor and digest legs are
  // untouched, and the scheduler is untouched, so nothing else in evolution goes dark. Config-as-data
  // per the file's own ground rule. Reverse by setting paused back to false.
  if (cfg.paused === true) {
    console.log(`skills-installer: PAUSED via system/skills-sources.json. Reason: ${cfg.paused_reason || "unstated"}. No audit, no install, no commit this run.`);
    return;
  }
  if (!cfg.directories) { console.log('skills-installer: no skills-sources.json - skills lane off.'); return; }
  const manifest = readJSON(MANIFEST, { projects: [] });
  const lock = readJSON(LOCK, { skills: {} });
  const installed = new Set(Object.keys(lock.skills || {}).map(s => s.toLowerCase()));
  const allow = new Set((cfg.trust_allowlist || []).map(a => a.toLowerCase()));
  // A12-T9 (2026-09-10): this line WIDENED trust automatically. Every owner already present in the
  // lock was added to the allowlist, so 9 curated owners became 15 effective ones, and each install
  // enlarged the set that could authorise the next. A trust list that grows by being used is not a
  // trust list. Trust now widens only by editing `trust_allowlist` in system/skills-sources.json,
  // which is a decision someone makes on purpose. (Removed, not commented out, so nothing re-adds it
  // by reflex; the six history-only owners are recoverable from the lock if any is wanted.)
  const cap = cfg.weekly_install_cap || 3;

  // Revocation list (2026-08-05, idea 4): system/skills-sources.json `revoked` names a skill or a
  // whole owner/repo that must never (re-)install. Refusal is deterministic; an ALREADY-installed
  // revoked skill is only REPORTED for manual removal - auto-install was approved, auto-REMOVE never
  // was, so removal stays Shaheen's call.
  const revoked = new Set((cfg.revoked || []).map(s => String(s).toLowerCase()));
  const isRevoked = (name, repo) => revoked.has(name.toLowerCase()) || revoked.has(repo.toLowerCase());
  const watch = new Set((cfg.watch || []).map(s => String(s).toLowerCase()));
  const isWatched = (name, repo) => watch.has(name.toLowerCase()) ||
    watch.has(repo.toLowerCase()) || watch.has(repo.split('/').pop().toLowerCase());

  const candidates = loadCandidates();
  const report = { installed: [], flagged: [], skipped: [], revokedInstalled: [] };

  let count = 0;
  for (const c of candidates) {
    const name = (c.name || '').trim();
    const repo = (c.source_repo || '').trim();
    const label = name || repo || '(unnamed)';
    // A12-T11 / T-03 (2026-09-10): `name` is MODEL-AUTHORED and was checked for truthiness only,
    // then reached a RegExp and `execSync('npx -y skills add ${repo} --skill ${name}')`. In the
    // dry-run a name of `zz-shell;echo pwned` passed shape, revoked, watch, dedup and allowlist and
    // reached a live audit; had that repo scanned clean, the shell line would have run.
    if (!name || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) {
      report.flagged.push({ label, reason: `skill name ${JSON.stringify(name)} is not a plain lowercase slug (^[a-z0-9][a-z0-9-]{0,63}$) - a model-authored name reaches a shell, so its shape is enforced first` });
      continue;
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { report.flagged.push({ label, reason: 'missing name or valid owner/repo' }); continue; }
    if (isRevoked(name, repo)) { report.flagged.push({ label, reason: 'revoked by policy (system/skills-sources.json `revoked`)' }); continue; }
    // Watch list (P2.3, 2026-08-23): NOT a refusal. A name whose caveat must be READ before install,
    // so a known-ambiguous package name can never be adopted on autopilot. Routes to manual review
    // with the note attached, which is the whole point: the digest carries the reason, not just a flag.
    if (isWatched(name, repo)) {
      report.flagged.push({ label, reason: `on the WATCH list (system/skills-sources.json \`watch\`) - read _watch_note before any install: ${String(cfg._watch_note || '').slice(0, 180)}` });
      continue;
    }
    const [owner] = repo.split('/');
    if (installed.has(name.toLowerCase())) { report.skipped.push({ label, reason: 'already installed' }); continue; }
    if (!allow.has(owner.toLowerCase())) { report.flagged.push({ label, reason: `author '${owner}' not on trust allowlist` }); continue; }
    if (!c.target_project) { report.flagged.push({ label, reason: 'no target_project named' }); continue; }
    if (count >= cap) { report.flagged.push({ label, reason: `weekly cap ${cap} reached` }); continue; }

    let audit;
    try { audit = await auditRepo(owner, repo.split('/')[1], name, cfg); }
    catch (e) { report.flagged.push({ label, reason: `audit error: ${e.message}` }); continue; }
    if (!audit.ok) { report.flagged.push({ label, reason: `audit: ${audit.reason}` }); continue; }

    const proj = projectFor(c.target_project, manifest);
    const strength = (c.strength === 'MANDATORY') ? 'MANDATORY' : 'ADVISORY';
    const trigger = (c.task_trigger || `work related to ${c.target_project}`).replace(/\|/g, '/');

    if (DRY) {
      report.installed.push({ label, repo, target: c.target_project, note: 'DRY-RUN: would install + wire', audit: 'passed' });
      count++;
      continue;
    }

    try {
      const note = installSkill(repo, name);
      // TOCTOU close (idea 4): what `skills add` fetched (upstream HEAD now) must equal what the
      // audit read (the pinned SHA). A moved upstream fails here, is rolled back, and is flagged.
      const verify = await verifyInstalledAgainstSha(owner, repo.split('/')[1], audit, name);
      if (!verify.ok) {
        rollbackInstall(name);
        report.flagged.push({ label, reason: `post-install verify vs audited SHA ${String(audit.sha).slice(0, 7)} FAILED - rolled back: ${verify.reason}` });
        continue;
      }
      upsertLock(name, repo, audit.skillPath || c.skill_path || null, audit.sha);
      const wiredRoot = addBindingRow(trigger, name, repo, strength);
      const wiredLocal = proj && proj.work_dir ? addLocalSkillsLine(proj.work_dir, name, trigger) : false;
      try { sh('node scripts/generate-alex.js --only=claude,docs'); } catch (e) { /* report but keep the install */ }
      let sha = '(commit skipped)';
      try {
        // A12-T12 / T-04 (2026-09-10): STAGE BY PATH. `git add -A` staged every untracked,
        // non-ignored file in the tree, so a second session's half-written note or a scratch export
        // in outputs/ rode into a PUBLIC commit whose message named only the skill - and the
        // --no-verify (dropped 2026-09-11) meant gitleaks and the personal-data scan never saw it.
        // Third audit to find this (P-14 08-05, S-H1 08-29, A12-T12 09-09).
        const stagePaths = [
          path.join('.agents', 'skills', name),
          path.join('.claude', 'skills', name),
          'skills-lock.json',
          'CLAUDE.md',
          proj && proj.work_dir ? path.join(proj.work_dir, 'CLAUDE.md') : null,
          'docs',
        ].filter(Boolean);
        for (const rel of stagePaths) {
          if (fs.existsSync(path.join(REPO, rel))) sh(`git add -- "${rel}"`);
        }
        // A16-T-05 (2026-09-11): --no-verify is GONE. It was the one unattended path in the system
        // that installs third-party files and committed them to a PUBLIC repo with the commit gate
        // switched off, flagged by three audits running (P-14 08-05, A16-T20, A12-T12).
        //
        // The reason it stayed was that the hook's full suite asserts the LIVE n8n API (V6) and a
        // headless weekly install cannot depend on the network. That reason was already stale: the
        // hook runs `--context=pre-commit`, and in that context V6 and V2's live halves downgrade
        // to a LOUD WARNING SKIP instead of failing (validate-alex.js:538, :556). So the flag was
        // buying an exemption from gitleaks and the personal-data scan and nothing else.
        //
        // These two calls stay as the belt to the hook's braces: they run the same content scans
        // BEFORE the commit is attempted, so a refusal is diagnosed here rather than as an opaque
        // hook failure inside an unattended run.
        contentScansOrThrow();
        securityPreflightOrThrow();   // Class E: V11 forced-add + V10 protected-file guards
        sh(`git commit -m "evolution: auto-install ${name} for ${c.target_project} [skills lane #25]"`);
        sha = sh('git rev-parse --short HEAD').trim();
      } catch (e) {
        sha = `(commit failed: ${e.message.split('\n')[0]})`;
        // A refused commit must not leave the index holding this run's paths for the 21:30 sweep to
        // pick up and push without any of these gates.
        try { sh('git reset -q'); } catch { /* best effort */ }
      }
      report.installed.push({
        label, repo, target: c.target_project, sha, note,
        wiring: `root-binding:${wiredRoot ? 'ok' : 'MISS'} local-skills:${wiredLocal ? 'ok' : 'MISS(' + (proj ? proj.work_dir : 'no project') + ')'}`,
      });
      count++;
    } catch (e) {
      report.flagged.push({ label, reason: `install failed: ${e.message.split('\n')[0]}` });
    }
  }

  // Revoked-but-installed sweep (idea 4): a revocation added AFTER a skill installed surfaces here
  // every run until Shaheen removes the skill by hand. Reported, never auto-removed.
  for (const [n, v] of Object.entries(lock.skills || {})) {
    if (revoked.has(n.toLowerCase()) || (v.source && revoked.has(String(v.source).toLowerCase()))) {
      report.revokedInstalled.push({ label: n, source: v.source || '?' });
    }
  }

  // Human-readable report the wrapper folds into the digest + log.
  const lines = [];
  lines.push(`## Skills auto-install report (${today()})${DRY ? ' [DRY-RUN]' : ''}`);
  lines.push(`Installed ${report.installed.length} / flagged ${report.flagged.length} / skipped ${report.skipped.length}. Cap ${cap}.`);
  if (report.revokedInstalled.length) {
    lines.push('\n**REVOKED but still installed (manual removal is yours - never auto-removed):**');
    for (const r of report.revokedInstalled) lines.push(`- ${r.label} (${r.source}) - remove from .agents/skills/ + .claude/skills/ + skills-lock.json, or un-revoke`);
  }
  if (report.installed.length) {
    lines.push('\n**Installed + wired:**');
    for (const r of report.installed) lines.push(`- ${r.label} (${r.repo}) -> ${r.target} | ${r.sha || r.note} | ${r.wiring || r.note}`);
  }
  if (report.flagged.length) {
    lines.push('\n**Flagged, manual review (NOT installed):**');
    for (const r of report.flagged) lines.push(`- ${r.label} - ${r.reason}`);
  }
  if (report.skipped.length) {
    lines.push('\n**Skipped:**');
    for (const r of report.skipped) lines.push(`- ${r.label} - ${r.reason}`);
  }
  const out = lines.join('\n') + '\n';

  const outDir = path.join(REPO, 'outputs', 'evolution', today());
  try { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, 'skills-install-report.md'), out, 'utf8'); } catch { /* ok */ }
  process.stdout.write(out);
  process.exitCode = 0;
  } finally { releaseLock(); }
})();
