// alex-hq-path.js - where the Alex HQ website repo lives (added 2026-08-04, the website split).
//
// WHY THIS EXISTS: the Next.js app + its qa/ harness moved out of work/16-alex-hq into their own
// repo. Two personal-os surfaces still legitimately reach into it - the generator emits the brand
// tokens.css the app compiles against, and validator V8 scans the app's source for off-palette
// hexes - so both need ONE honest answer to "where is it", never a hardcoded literal.
//
// THE ORDER (first hit wins):
//   1. env var             - ALEX_HQ_REPO, for odd layouts + CI
//   2. manifest meta.paths - system/manifest.json -> meta.paths.alex_hq_repo, the SSOT
//   3. structural default  - <personal-os>/../alex-hq, a sibling
//
// This is the CANONICAL Node implementation; work/16-alex-hq/scripts/lib/paths.mjs re-exports it
// so ESM and CJS can never disagree. Python twin: scripts/lib/alex_paths.py.
//
// IMPORTANT for callers: the repo may legitimately NOT be present (a machine that has personal-os
// but has not cloned the website). `exists()` is how you ask; callers must degrade honestly - warn
// that the check could not run, never silently pass and never hard-fail a machine that simply
// does not host the site.
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');

// %USERPROFILE% (the manifest's own convention) and ${VAR}. Unknown vars are left verbatim so a
// bad value fails on a visibly-broken path instead of resolving somewhere wrong and silent.
function expand(s) {
  return s
    .replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, v) => process.env[v] ?? m)
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, v) => process.env[v] ?? m);
}

function manifestDeclared() {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(REPO, 'system', 'manifest.json'), 'utf8'));
    return m.meta && m.meta.paths ? m.meta.paths.alex_hq_repo : undefined;
  } catch {
    return undefined; // unreadable manifest falls through to the structural default
  }
}

function root() {
  const declared = process.env.ALEX_HQ_REPO || manifestDeclared();
  if (!declared) return path.resolve(REPO, '..', 'alex-hq');
  const e = expand(declared);
  // a relative declared value resolves against the personal-os root, never the cwd
  return path.isAbsolute(e) ? path.normalize(e) : path.resolve(REPO, e);
}

/** A path inside the website repo. hqPath('app/tokens.css') */
function hqPath(...rel) {
  return path.join(root(), ...rel);
}

/** Is the website repo actually on this machine? Callers degrade to a WARNING when false. */
function exists() {
  try {
    return fs.existsSync(path.join(root(), 'package.json'));
  } catch {
    return false;
  }
}

module.exports = { root, hqPath, exists, REPO };
