'use strict';
/* h-recovery - facts from work/18-recovery-layer/check.mjs: the recovery checker's own registry.
 * Counts the `# --- C<n>` block headers (the same ground-truth source narrative-drift-check.py uses
 * for C19), so the check count is derived from the CODE, never a prose claim. This row is what C21
 * tests the in-repo work/18 CLAUDE.md "The checks (N total)" header against - the ST-20 "a doc
 * lying about the system" class, mechanized. */
const fs = require('fs');
const path = require('path');

function harvest({ REPO }) {
  const src = path.join(REPO, 'work', '18-recovery-layer', 'check.mjs');
  const txt = fs.readFileSync(src, 'utf8');
  const nums = new Set();
  // Accepts BOTH comment markers: `#` was PowerShell's, `//` is the ported Node checker's. Kept
  // dual on purpose so this harvester reads correctly against either file during the migration, and
  // so a stray old-format header can never be silently uncounted.
  for (const m of txt.matchAll(/^\s*(?:#|\/\/)\s*---\s*C(\d+)\b/gm)) nums.add(parseInt(m[1], 10));
  const facts = [];
  const push = (predicate, object) =>
    facts.push({ subject: 'recovery-checker', predicate, object, source: 'work/18-recovery-layer/check.mjs', harvester: 'h-recovery', aliases: ['recovery', 'checker', 'checks', 'drift'] });
  push('check_count', String(nums.size));
  if (nums.size) push('check_max', String(Math.max(...nums)));
  return facts;
}

module.exports = { harvest };
