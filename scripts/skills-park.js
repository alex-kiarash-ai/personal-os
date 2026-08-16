'use strict';
/*
 * scripts/skills-park.js - S1 Compiled Surfaces P4 (2026-08-16): park/wake skills by JUNCTION.
 *
 * Parking removes ONLY the `.claude/skills/<name>` junction; the content in `.agents/skills/`
 * is never touched, stays git-tracked, and the skills-lock.json row is marked `parked: true`
 * (+ parkedAt) so S7's hash sweep and the #25 installer know the state is deliberate.
 * Waking re-links the junction (`cmd /c mklink /J`, non-elevated) and clears the flag.
 * V17 fails the build if a MANDATORY-bound skill is ever parked - built BEFORE this script
 * so parking can never break a binding.
 *
 * Usage:
 *   node scripts/skills-park.js --park name1,name2,...   park (junction rm + lock flag)
 *   node scripts/skills-park.js --wake name1,name2,...   wake (re-link + clear flag)
 *   node scripts/skills-park.js --list                   show parked/awake counts + parked names
 * Every mutation runs under the shared repo-surface write-lock (skills-lock.json is a shared
 * surface with the installer) and is read-back verified.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const LOCK = path.join(REPO, 'skills-lock.json');
const LINKS = path.join(REPO, '.claude', 'skills');
const STORE = path.join(REPO, '.agents', 'skills');

function readLock() { return JSON.parse(fs.readFileSync(LOCK, 'utf8')); }
function writeLock(l) { fs.writeFileSync(LOCK, JSON.stringify(l, null, 2) + '\n', 'utf8'); }
function linkPath(n) { return path.join(LINKS, n); }
function isLive(n) { try { fs.readFileSync(path.join(linkPath(n), 'SKILL.md')); return true; } catch { return false; } }

function park(names) {
  const lock = readLock();
  const done = [], skipped = [];
  for (const n of names) {
    if (!lock.skills[n]) { skipped.push(`${n} (not in lock)`); continue; }
    if (!fs.existsSync(path.join(STORE, n))) { skipped.push(`${n} (no .agents/skills content - refusing)`); continue; }
    if (fs.existsSync(linkPath(n))) fs.rmdirSync(linkPath(n)); // junction: rmdir removes the LINK, target untouched
    lock.skills[n].parked = true;
    lock.skills[n].parkedAt = new Date().toISOString();
    done.push(n);
  }
  writeLock(lock);
  // read-back verify: junction gone + content intact + flag set
  const bad = done.filter(n => fs.existsSync(linkPath(n)) || !fs.existsSync(path.join(STORE, n, 'SKILL.md')) || !readLock().skills[n].parked);
  if (bad.length) throw new Error(`park verify FAILED for: ${bad.join(', ')}`);
  console.log(`parked ${done.length} (junction removed, content untouched, lock flagged)${skipped.length ? `; skipped: ${skipped.join('; ')}` : ''}`);
}

function wake(names) {
  const lock = readLock();
  const done = [], skipped = [];
  for (const n of names) {
    if (!fs.existsSync(path.join(STORE, n))) { skipped.push(`${n} (no content)`); continue; }
    if (!fs.existsSync(linkPath(n))) {
      execFileSync('cmd', ['/c', 'mklink', '/J', linkPath(n), path.join(STORE, n)], { stdio: 'pipe' });
    }
    if (lock.skills[n]) { delete lock.skills[n].parked; delete lock.skills[n].parkedAt; }
    done.push(n);
  }
  writeLock(lock);
  const bad = done.filter(n => !isLive(n) || (readLock().skills[n] || {}).parked);
  if (bad.length) throw new Error(`wake verify FAILED for: ${bad.join(', ')}`);
  console.log(`woke ${done.length} (junction re-linked + verified)${skipped.length ? `; skipped: ${skipped.join('; ')}` : ''}`);
}

function list() {
  const lock = readLock();
  const names = Object.keys(lock.skills);
  const parked = names.filter(n => lock.skills[n].parked);
  console.log(`skills: ${names.length} total, ${names.length - parked.length} awake, ${parked.length} parked`);
  if (parked.length) console.log('parked: ' + parked.sort().join(', '));
  const orphans = names.filter(n => !lock.skills[n].parked && !isLive(n));
  if (orphans.length) console.log('WARN awake-but-dead junctions (restore gap?): ' + orphans.join(', '));
}

const argv = process.argv.slice(2);
const get = flag => { const a = argv.find(x => x.startsWith(flag + '=')) || (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null); return a && a.startsWith(flag) ? a.split('=')[1] : a; };

const writeLockLib = require('./lib/write-lock');
(async () => {
  if (argv.includes('--list') || argv.length === 0) return list();
  const names = (get('--park') || get('--wake') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!names.length) { console.error('usage: skills-park --park a,b | --wake a,b | --list'); process.exitCode = 1; return; }
  const held = writeLockLib.acquire({ label: 'skills-park' });
  if (!held.ok) { console.error(`skills-park: write lock busy (${held.reason})`); process.exitCode = 2; return; }
  try {
    if (argv.some(a => a.startsWith('--park'))) park(names); else wake(names);
    process.exitCode = 0;
  } catch (e) { console.error(`skills-park FAILED: ${e.message}`); process.exitCode = 1; }
  finally { held.release(); }
})();
