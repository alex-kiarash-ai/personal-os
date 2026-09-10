// work/18-recovery-layer/lib/doc-paths.mjs - do the restore documents point at files that exist?
//
// Stress-test 2026-08-29 S-G1 (Critical), re-measured 2026-09-04 M-14 and 2026-09-09 A11-T1 / A17-T1:
// vault/identity.md named 27 scripts/ paths and 10 were dead, the recovery runbooks 12 more, the
// technical master 13 across five classes, the identical set on three audits. The 08-29 fix proposed
// "a recovery check that resolves every path and REDs on a miss" and it never existed; the 08-29
// probe itself extracted the `scripts/` SUBSTRING and produced two false positives
// (work/16-alex-hq/scripts/n8n_liveness.py read as scripts/n8n_liveness.py). This module is that
// check, with the anchoring the probe lacked.
//
// CONVENTION the check enforces: a repo path in BACKTICKS is a LIVE claim and must resolve; history
// belongs in plain text ("git-backup.ps1, the PowerShell era, now `scripts/git-backup.sh`"). So a
// runbook keeps its record and the checker never has to guess which sentences are archival.
//
// Pure: takes text, returns the dead paths. No I/O beyond fs.existsSync on each candidate, and the
// caller passes the root, so the same function runs on a fixture in a test.
import fs from 'node:fs';
import path from 'node:path';

// Root-anchored: the token must START with one of these classes (after the opening backtick).
const CLASSES = ['scripts', 'work', 'system', 'docs', 'templates', 'scheduler', 'brand', '.claude', '.github', 'vault'];
const TOKEN = new RegExp('`((?:' + CLASSES.map((c) => c.replace('.', '\\.')).join('|') + ')/[^`\\s]+)`', 'g');

// Placeholders and shapes that are documentation, not a path claim.
const SKIP = [
  /\{|\}|<|>/,                 // `work/{n}-{name}`, `work/<dir>`
  /\bNN\b|\bNNN\b|\bYYYY\b/,   // `work/NN-name`, `scripts/migrations/NNN-`, `outputs/x/YYYY-MM-DD`
  /\*|\?/,                     // globs: `scripts/run-*.sh`
  /\.\.\./,                    // truncations
  /^\w+\/$/,                   // a bare class with a trailing slash: `scripts/`
  /\/\d\d\.\.\d\d\b/,          // ranges: `work/01..33`
];

export function pathClaims(text) {
  const out = [];
  for (const m of text.matchAll(TOKEN)) {
    let p = m[1];
    p = p.replace(/[.,;:)]+$/, '');       // trailing punctuation inside the backticks
    p = p.replace(/:\d+(?:-\d+)?$/, '');   // `file.js:12-14` line pointers
    if (SKIP.some((re) => re.test(p))) continue;
    out.push(p);
  }
  return [...new Set(out)];
}

// Returns { checked, dead: [path, ...] } for one document's text against a repo root.
export function deadRepoPaths(text, repoRoot) {
  const claims = pathClaims(text);
  const dead = claims.filter((p) => !fs.existsSync(path.join(repoRoot, p)));
  return { checked: claims.length, dead };
}
