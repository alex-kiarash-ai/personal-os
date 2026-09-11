#!/usr/bin/env node
'use strict';
/*
 * test-validator-negative.js - prove the validator's checks can actually FAIL.
 *
 * WHY (A03-T-05, stress test 2026-09-04). The suite had one test. Sixteen of the V-checks and all
 * four G-checks had none, and every negative test that has ever proven them lived in a throwaway
 * clone that was deleted at the end of the session that wrote it. So the only evidence any of
 * these checks worked was that they were green, which is exactly the evidence a check that tests
 * nothing also produces. This repo has now found that shape in C8, C7b, C29, the personal-data
 * scan, facts-check and C31; assuming the validator is the one layer immune to it would be odd.
 *
 * HOW IT WORKS. runAll() already takes a `stagedDir` - the seam the generator uses to validate a
 * preview tree before swapping it in - and most checks read through `effective(stagedDir, rel)`.
 * So the fixture is a COPY of the real tree's inputs, which gives a passing baseline by
 * construction (the live repo passes), and each case mutates exactly ONE thing and asserts that
 * the specific check names itself in the failures.
 *
 * A baseline copy rather than a synthetic minimal tree is deliberate: a hand-built fixture has to
 * satisfy every check at once to be useful, and the first thing that drifts is the fixture, which
 * turns a test suite into a maintenance tax nobody pays.
 *
 * COVERAGE IS STATED, NOT IMPLIED. The checks that read the git index (V10, V11) or the live
 * network (V6) are not reachable this way and are listed at the end as uncovered, with where they
 * ARE covered. A test file that quietly omits what it cannot do is the same lie as a green check
 * that inspects nothing.
 *
 * Run: node scripts/tests/test-validator-negative.js   (exit 0 = pass)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const { runAll } = require(path.join(REPO, 'scripts', 'validate-alex.js'));

// The inputs the staged-reading checks actually consult.
const FIXTURE_FILES = [
  'CLAUDE.md',
  'system/manifest.json',
  'scheduler/schedule.md',
  'docs/README.md',
  'docs/GETTING-STARTED.md',
  'docs/ARCHITECTURE.md',
  'docs/projects/README.md',
];

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-vneg-'));
  for (const rel of FIXTURE_FILES) {
    const src = path.join(REPO, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  return dir;
}

const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const write = (dir, rel, text) => fs.writeFileSync(path.join(dir, rel), text, 'utf8');
const editJson = (dir, rel, fn) => {
  const j = JSON.parse(read(dir, rel));
  fn(j);
  write(dir, rel, JSON.stringify(j, null, 2) + '\n');
};

let pass = 0;
const fails = [];

/** Mutate the fixture, run the suite, assert `tag` appears in a failure line. */
async function expectFailure(name, tag, mutate) {
  const dir = makeFixture();
  try {
    mutate(dir);
    const res = await runAll({ stagedDir: dir, context: 'pre-commit' });
    const hit = (res.failures || []).some((f) => f.includes(tag));
    if (hit) { pass++; console.log(`  ok  ${tag} fires: ${name}`); }
    else {
      fails.push(`${tag} did NOT fire on: ${name}\n      failures were: ${(res.failures || []).join(' | ') || '(none)'}`);
    }
  } catch (e) {
    fails.push(`${tag} threw on: ${name} (${e.message})`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The baseline must be CLEAN, or every case above is meaningless. */
async function expectBaselineClean() {
  const dir = makeFixture();
  try {
    const res = await runAll({ stagedDir: dir, context: 'pre-commit' });
    if ((res.failures || []).length === 0) { pass++; console.log('  ok  baseline fixture is clean (so a failure below is caused by the mutation)'); }
    else fails.push(`baseline fixture is NOT clean: ${(res.failures || []).join(' | ')}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

(async () => {
  console.log('test-validator-negative: one synthetic violation per staged-readable check\n');
  await expectBaselineClean();

  await expectFailure('routing-table BEGIN marker deleted', 'G2', (d) => {
    write(d, 'CLAUDE.md', read(d, 'CLAUDE.md').replace('<!-- ROUTING-TABLE:BEGIN', '<!-- ROUTING-TABLE-GONE'));
  });

  await expectFailure('docs/README.md custom zone opened twice', 'G3', (d) => {
    const t = read(d, 'docs/README.md');
    write(d, 'docs/README.md', t.replace('<!-- CUSTOM_START', '<!-- CUSTOM_START -->\n<!-- CUSTOM_START'));
  });

  await expectFailure('the docs state an automation count the manifest does not', 'V1', (d) => {
    // V1 compares the COUNT the docs state against the manifest, so the mutation has to move one
    // of those two numbers. Deleting a routing-table row (the first thing I reached for) changes
    // neither, and the check was right to stay quiet about it.
    editJson(d, 'system/manifest.json', (j) => { j.projects = j.projects.filter((x) => x.num !== 27); });
  });

  await expectFailure('a RETIRED project listed as a live automation', 'V3', (d) => {
    editJson(d, 'system/manifest.json', (j) => {
      const p = j.projects.find((x) => x.num === 2);
      if (p) p.state = 'RETIRED';
    });
  });

  await expectFailure('constitution pushed past its byte budget', 'V16', (d) => {
    editJson(d, 'system/manifest.json', (j) => { j.meta.constitution.byte_budget = 100; });
  });

  await expectFailure('a stray control byte in a tracked doc', 'V18', (d) => {
    write(d, 'docs/ARCHITECTURE.md', read(d, 'docs/ARCHITECTURE.md') + String.fromCharCode(7));
  });

  await expectFailure('a PARKED project with no revisit date', 'V19', (d) => {
    editJson(d, 'system/manifest.json', (j) => {
      const p = j.projects.find((x) => x.state === 'PARKED' || x.state === 'DORMANT');
      if (p) delete p.revisit;
    });
  });

  await expectFailure('two unchanged revisits on a DORMANT row', 'V19', (d) => {
    editJson(d, 'system/manifest.json', (j) => {
      const p = j.projects.find((x) => x.state === 'DORMANT');
      if (p) p.revisit_history = [{ date: '2026-07-01', outcome: 'unchanged' }, { date: '2026-08-01', outcome: 'unchanged' }];
    });
  });

  console.log('\nNOT covered here, and where they ARE covered:');
  console.log('  V6  - asserts the LIVE n8n API; needs credentials and a network, so it cannot run from a fixture.');
  console.log('  V8  - reads the sibling alex-hq repo, which is not on this machine (waived until 2026-09-30).');
  console.log('  V10 - reads the git INDEX, not the tree: covered by scripts/tests/test-protected-guard.js.');
  console.log('  V11 - reads the git index the same way; covered by the same file and by the pre-commit hook.');
  console.log('  V5, V13, V14, V17 - read REPO paths as well as the staged tree, so a fixture only exercises half.');
  console.log('    V17 was negative-tested by hand on 2026-09-11 (a planted hyphen-less MANDATORY row).');
  console.log('  V9  - reads each status.md frontmatter created date, which the fixture does not carry, so a');
  console.log('        first_fire mutation alone changes nothing it can see: honestly uncovered, not faked.');
  console.log('  V2, V4, V7, V12, V15 - staged-readable and NOT yet cased. Next additions, not a claim of coverage.');

  console.log('');
  if (fails.length) {
    console.error(`test-validator-negative: ${fails.length} FAILED\n  ` + fails.join('\n  '));
    process.exit(1);
  }
  console.log(`test-validator-negative: all ${pass} case(s) passed`);
})();
