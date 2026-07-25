'use strict';
/* h-validators - facts from scripts/validate-alex.js: the generator's validator suite.
 * Parses the check REGISTRY, never prose (the V6 lesson generalized): the canonical
 * "G1-G4 + V1-V<n> PASS" summary line is the machine-authoritative suite range. */
const fs = require('fs');
const path = require('path');

function harvest({ REPO }) {
  const src = path.join(REPO, 'scripts', 'validate-alex.js');
  const txt = fs.readFileSync(src, 'utf8');
  const facts = [];
  const push = (subject, predicate, object, aliases = []) =>
    facts.push({ subject, predicate, object, source: 'scripts/validate-alex.js', harvester: 'h-validators', aliases });

  const m = txt.match(/V1-V(\d+)\s+PASS/);
  if (m) {
    const n = parseInt(m[1], 10);
    push('validator-suite', 'v_count', String(n), ['validator', 'validators', 'validate', 'generator']);
    push('validator-suite', 'suite_range', `V1-V${n}`, ['validator', 'validators']);
  }
  const g = txt.match(/G1-G(\d+)/);
  if (g) push('validator-suite', 'g_count', String(parseInt(g[1], 10)), ['validator']);
  return facts;
}

module.exports = { harvest };
