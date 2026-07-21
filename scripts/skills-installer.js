#!/usr/bin/env node
// skills-installer.js - #25 Evolution skills lane, the deterministic auto-install engine (2026-07-11).
// ZERO model tokens. It reads the weekly eval's machine-readable install block (the fenced ```json in
// outputs/evolution/<date>/digest.md, or a --manifest file) and, for each proposed skill, runs the
// automated VALIDATION that stands in for the removed human gate:
//   resolve GitHub source -> trust allowlist -> source audit (hooks/scripts/network) -> dedup -> cap.
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
const { execSync } = require('child_process');

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

  let tree;
  try { tree = await ghJSON(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`); }
  catch (e) { return { ok: false, reason: `tree not reachable (${e.message})` }; }
  const paths = (tree.tree || []).map(t => t.path);

  // `skills add` copies ONLY the skill's own directory (repo-root plugin hooks are NOT copied or run),
  // so the audit is scoped to the SKILL'S OWN directory - not the whole repo (that would wrongly block
  // trusted plugin repos like obra/superpowers that ship root hooks). If the skill dir can't be located,
  // fall back to whole-repo (a missing skill dir is itself suspicious).
  const skillDir = paths.find(p => new RegExp(`(^|/)${skillName}/SKILL\\.md$`, 'i').test(p));
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
  return { ok: true, branch, skillPath: skillDir || null };
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

function upsertLock(name, repo, skillPath) {
  const lock = readJSON(LOCK, { version: 1, skills: {} });
  let hash = null;
  const local = path.join(REPO, '.agents', 'skills', name, 'SKILL.md');
  if (fs.existsSync(local)) hash = crypto.createHash('sha256').update(fs.readFileSync(local)).digest('hex');
  lock.skills = lock.skills || {};
  lock.skills[name] = { source: repo, sourceType: 'github', skillPath: skillPath || null, computedHash: hash };
  fs.writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n', 'utf8');
}

function sh(cmd) { return execSync(cmd, { cwd: REPO, stdio: 'pipe' }).toString(); }

// --- Class E concurrency lock (2026-07-21): the 2026-07-20 sibling-session hazard (two installs racing
// the skills-lock, one deleting the other's entry mid-run) cannot silently corrupt state. An atomic
// mkdir mutex serializes installs; a lock older than 30 min (a crashed run) is stolen so it can't wedge.
const LOCKDIR = path.join(REPO, '.skills-install.lock');
function acquireLock() {
  try { fs.mkdirSync(LOCKDIR); fs.writeFileSync(path.join(LOCKDIR, 'pid'), `${process.pid} ${new Date().toISOString()}`); return true; }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    try { if (Date.now() - fs.statSync(LOCKDIR).mtimeMs > 30 * 60 * 1000) { fs.rmSync(LOCKDIR, { recursive: true, force: true }); fs.mkdirSync(LOCKDIR); return true; } } catch (_) { /* lost the race */ }
    return false;
  }
}
function releaseLock() { try { fs.rmSync(LOCKDIR, { recursive: true, force: true }); } catch (_) { /* best effort */ } }

// --- Class E security preflight (2026-07-21): the auto-install commit uses --no-verify, so the full
// pre-commit suite (with its live-n8n V6) can't block a headless install - which leaves this the ONE
// commit path that skips the hook. Run the SECURITY-critical guards here explicitly before committing to
// the PUBLIC repo: V11 (no gitignored path forced-added, which would push a secret world-visible) + V10
// (no protected/immutable NEVER-TOUCH file mutated). Throws to abort the commit on any violation; the
// non-security checks stay skipped by design (that is why --no-verify is used).
function securityPreflightOrThrow() {
  const v11 = execSync('git ls-files --cached --ignored --exclude-standard', { cwd: REPO }).toString()
    .split('\n').map(s => s.trim()).filter(Boolean);
  if (v11.length) throw new Error(`V11 forced-add guard: gitignored path(s) staged for the PUBLIC repo: ${v11.join(', ')}`);
  const { evaluateProtectedChangeset, readStagedChangeset } = require('./validate-alex');
  const res = evaluateProtectedChangeset(readStagedChangeset());
  if (res.failures.length) throw new Error(`V10 protected-file guard: ${res.failures.join('; ')}`);
}

function installSkill(repo, name) {
  sh(`npx -y skills add ${repo} --skill ${name}`);
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

// ---- main --------------------------------------------------------------------------------------
(async () => {
  if (!acquireLock()) {
    console.log('skills-installer: another install holds .skills-install.lock - deferring this run (Class E concurrency guard, 2026-07-21).');
    process.exitCode = 0; return;
  }
  try {
  const cfg = readJSON(CONFIG, {});
  if (!cfg.directories) { console.log('skills-installer: no skills-sources.json - skills lane off.'); return; }
  const manifest = readJSON(MANIFEST, { projects: [] });
  const lock = readJSON(LOCK, { skills: {} });
  const installed = new Set(Object.keys(lock.skills || {}).map(s => s.toLowerCase()));
  const allow = new Set((cfg.trust_allowlist || []).map(a => a.toLowerCase()));
  for (const v of Object.values(lock.skills || {})) if (v.source) allow.add(String(v.source).split('/')[0].toLowerCase());
  const cap = cfg.weekly_install_cap || 3;

  const candidates = loadCandidates();
  const report = { installed: [], flagged: [], skipped: [] };

  let count = 0;
  for (const c of candidates) {
    const name = (c.name || '').trim();
    const repo = (c.source_repo || '').trim();
    const label = name || repo || '(unnamed)';
    if (!name || !/^[\w.-]+\/[\w.-]+$/.test(repo)) { report.flagged.push({ label, reason: 'missing name or valid owner/repo' }); continue; }
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
      upsertLock(name, repo, audit.skillPath || c.skill_path || null);
      const wiredRoot = addBindingRow(trigger, name, repo, strength);
      const wiredLocal = proj && proj.work_dir ? addLocalSkillsLine(proj.work_dir, name, trigger) : false;
      try { sh('node scripts/generate-alex.js --only=claude,docs'); } catch (e) { /* report but keep the install */ }
      let sha = '(commit skipped)';
      try {
        sh('git add -A');
        securityPreflightOrThrow();   // Class E: V11 forced-add + V10 protected-file guards before the --no-verify commit
        sh(`git commit -m "evolution: auto-install ${name} for ${c.target_project} [skills lane #25]" --no-verify`);
        sha = sh('git rev-parse --short HEAD').trim();
      } catch (e) { sha = `(commit failed: ${e.message.split('\n')[0]})`; }
      report.installed.push({
        label, repo, target: c.target_project, sha, note,
        wiring: `root-binding:${wiredRoot ? 'ok' : 'MISS'} local-skills:${wiredLocal ? 'ok' : 'MISS(' + (proj ? proj.work_dir : 'no project') + ')'}`,
      });
      count++;
    } catch (e) {
      report.flagged.push({ label, reason: `install failed: ${e.message.split('\n')[0]}` });
    }
  }

  // Human-readable report the wrapper folds into the digest + log.
  const lines = [];
  lines.push(`## Skills auto-install report (${today()})${DRY ? ' [DRY-RUN]' : ''}`);
  lines.push(`Installed ${report.installed.length} / flagged ${report.flagged.length} / skipped ${report.skipped.length}. Cap ${cap}.`);
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
