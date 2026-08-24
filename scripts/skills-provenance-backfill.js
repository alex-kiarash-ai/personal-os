#!/usr/bin/env node
'use strict';
/*
 * scripts/skills-provenance-backfill.js - P2.7 (run-47 merged plan, 2026-08-23).
 *
 * WHY. skills-lock.json v2 pins `sourceCommit` (the audited commit) so an upgrade or a revocation
 * check has a baseline to compare against. That pin landed 2026-08-05, so exactly 1 of 85 entries
 * carries it and the other 84 predate it: the lock proves the installed BYTES are untampered
 * (computedHash) but says nothing about which upstream state they came from.
 *
 * THE HONESTY RULE THAT SHAPES THIS SCRIPT. A commit resolved TODAY is not the commit that was
 * audited in July, and writing it into `sourceCommit` would be a lie a future session cannot
 * detect - it would read as "audited at this SHA" forever. So the backfill writes a DIFFERENT key,
 * `sourceCommitBackfilled`, plus `backfilledAt`, and never touches `sourceCommit`. The value is
 * "upstream HEAD when we looked", which is a real drift baseline and nothing more.
 *
 * Read-only against the network (GitHub API), single write to skills-lock.json, --dry by default.
 * Zero dependencies.
 *
 *   node scripts/skills-provenance-backfill.js          # dry run, prints what it would write
 *   node scripts/skills-provenance-backfill.js --apply  # writes skills-lock.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO = path.resolve(__dirname, '..');
const LOCK = path.join(REPO, 'skills-lock.json');
const APPLY = process.argv.includes('--apply');

function gh(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'alex-provenance-backfill', Accept: 'application/vnd.github+json' } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

(async function main() {
  const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
  const skills = lock.skills || {};
  const names = Object.keys(skills);

  // One API call per distinct SOURCE REPO, not per skill: 85 skills come from far fewer repos, and
  // hammering the API once per skill would rate-limit for no extra information.
  const bySource = new Map();
  for (const n of names) {
    const e = skills[n];
    if (!e || !e.source || e.sourceCommit || e.sourceCommitBackfilled) continue;
    if (e.sourceType !== 'github') continue;
    if (!bySource.has(e.source)) bySource.set(e.source, []);
    bySource.get(e.source).push(n);
  }

  if (!bySource.size) { console.log('backfill: nothing to do - every github-sourced entry already carries a pin'); return; }
  console.log(`backfill: ${bySource.size} distinct source repo(s) covering ${[...bySource.values()].flat().length} skill(s)${APPLY ? '' : '  [DRY RUN]'}`);

  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  let resolved = 0; let failed = 0;
  for (const [source, list] of bySource) {
    let sha = null;
    try {
      const info = await gh(`https://api.github.com/repos/${source}`);
      const branch = info.default_branch || 'main';
      const ref = await gh(`https://api.github.com/repos/${source}/commits/${branch}`);
      sha = ref.sha;
    } catch (e) {
      failed++;
      console.log(`  SKIP ${source}: ${e.message}`);
      continue;
    }
    resolved++;
    console.log(`  ${source} -> ${sha.slice(0, 12)}  (${list.length} skill(s))`);
    if (APPLY) for (const n of list) { skills[n].sourceCommitBackfilled = sha; skills[n].backfilledAt = stamp; }
  }

  if (APPLY) {
    fs.writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n', 'utf8');
    // Verify-after-write: re-read from disk rather than trusting the in-memory object.
    const rb = JSON.parse(fs.readFileSync(LOCK, 'utf8')).skills;
    const covered = Object.keys(rb).filter((n) => rb[n].sourceCommit || rb[n].sourceCommitBackfilled).length;
    console.log(`backfill: WROTE skills-lock.json - ${covered}/${Object.keys(rb).length} entries now carry a provenance anchor`);
  } else {
    console.log('backfill: dry run only. Re-run with --apply to write.');
  }
  if (failed) console.log(`backfill: ${failed} source(s) unresolved (left untouched, never guessed)`);
})();
