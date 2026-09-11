#!/usr/bin/env node
'use strict';
/*
 * scripts/facts-check.js - recovery check C21: standing DOCS tested against the bi-temporal fact
 * ledger (system/recall/facts.db). The Recall Spine's rent-payer (upgrade plan Phase 1.3).
 *
 * DIRECTION (this is the whole point): the DOC is the test SUBJECT; facts.db is the EXPECTATION. A
 * doc that claims a value the ledger disproves is flagged. This does NOT reintroduce the V6
 * anti-pattern (deriving an expectation FROM prose): facts.db is derived from STRUCTURED sources
 * (manifest, validate-alex.js registry, check.mjs headers, schtasks, skills-lock, the attestation
 * file), and the prose is checked against THAT. The ST-20 / FR-04 "a doc lying about the system"
 * class becomes one deterministic diff.
 *
 * NON-DUPLICATION NOTE: the plan (2026-07-24) had C20 re-enter the out-of-repo ALEX-OS-master.md +
 * plain-English guide into enforcement. The 2026-07-25 stress-test fix F2 ALREADY did that: C19
 * (narrative-drift-check.py) was repointed to the manifest's master path and now derives its claim
 * set from ground truth (check count, V count, project count, escrow date). So C21 does NOT duplicate
 * the master-doc numeric claims (that would create two checks fighting over one doc). C21 owns the
 * COMPLEMENTARY, IN-REPO prose-vs-structured-truth surface C19 never touches. The map grows the same
 * way C19's does: each new claim is one {doc-regex + fact} row.
 *
 * Renumbered C21 (not the plan's C20): C20 was taken by the 07-25 F1 backup-destinations check.
 *
 * Exit 0 = consistent - 2 = drift found (one line per finding) - 1 = could not compute.
 *   node scripts/facts-check.js               harvest fresh, then check
 *   node scripts/facts-check.js --no-harvest  check against facts.db as-is (nightly chain already ran harvest)
 */
const fs = require('fs');
const path = require('path');
const { openDb, REPO } = require('../system/recall/lib/db');
const { currentFact } = require('../system/recall/lib/facts');

// The assertion map: each row is a standing doc claim tested against one (subject,predicate) fact.
// `optional: true` -> a missing doc/absent value is skipped, not a finding.
// `mode`: 'equals' (extracted value must equal the fact) | 'contains' (the fact object must appear in
// the doc; guards a manifest-side change not propagated into prose).
const ASSERTIONS = [
  {
    name: 'recovery-check-count',
    doc: 'work/18-recovery-layer/CLAUDE.md',
    regex: /The checks \((\d+) total/,
    subject: 'recovery-checker', predicate: 'check_count', mode: 'equals',
    why: 'the in-repo recovery-layer doc must not misstate how many C-checks the code runs (ST-20 class)',
  },
  {
    name: 'model-routing-default-in-root',
    doc: 'CLAUDE.md',
    // The default model string must appear in the model-routing section of root CLAUDE.md; if the
    // manifest default changed and prose wasn't propagated, the new string is absent -> flag.
    section: /## Model Routing in n8n Workflows[\s\S]*?(?=\n## )/,
    subject: 'model-routing', predicate: 'default', mode: 'contains',
    why: 'root CLAUDE.md model-routing prose must name the current manifest default model',
  },

  // --- vault/identity.md, added 2026-07-25 (stress-test finding F-01) ------------------------------
  // identity.md is the file a fresh clone reads FIRST after a laptop loss, and it was wrong on six
  // load-bearing claims at once while NOTHING checked it: C19 watches the out-of-repo master, C21 only
  // watched two in-repo claims, and identity.md is gitignored so no git-based check ever sees it. The
  // volatile facts it used to restate are now pointers (see its POINTER DISCIPLINE header); the few
  // numbers genuinely worth stating in a restore doc are asserted HERE instead, so they cannot re-rot.
  {
    name: 'identity-recovery-check-count',
    doc: 'vault/identity.md',
    regex: /\*\*(\d+) checks C1-C\d+\*\*/,
    subject: 'recovery-checker', predicate: 'check_count', mode: 'equals',
    why: 'the restore map must not misstate how many C-checks the recovery sweep runs',
  },
  {
    name: 'identity-scheduled-job-count',
    doc: 'vault/identity.md',
    regex: /\*\*(\d+) registered jobs\*\*/,
    subject: 'scheduler', predicate: 'registered_job_count', mode: 'equals',
    why: 'a restore has to re-create every scheduled job, so a wrong count here means a job is quietly never rebuilt',
  },
  {
    name: 'identity-skills-count',
    doc: 'vault/identity.md',
    regex: /\*\*(\d+) skills PROJECT-SCOPED in-repo\*\*/,
    subject: 'skills', predicate: 'count', mode: 'equals',
    why: 'the skills-store count said 29/30 for 11 days while three owner-approved packs had taken it to 82',
  },
  {
    // A11-T-03 (2026-09-11): section 4 named its MCP servers by hand and nothing compared that to
    // the machine. A USER-scope server lives outside the repo, so a restore that does not re-add
    // it comes back silently short a capability and nobody finds out until something needs it.
    name: 'identity-mcp-user-scope-count',
    doc: 'vault/identity.md',
    regex: /\*\*(\d+) MCP servers at user scope\*\*/,
    subject: 'mcp', predicate: 'user_scope_count', mode: 'equals',
    why: 'a restore has to re-add every user-scope MCP by hand; a wrong count here means a connector is quietly never rebuilt',
  },
  {
    name: 'identity-escrow-attested',
    doc: 'vault/identity.md',
    regex: /escrow drill re-passed (\d{4}-\d{2}-\d{2})/,
    subject: 'escrow', predicate: 'attested', mode: 'equals',
    why: 'recoverability is the one claim that must never be optimistic: the date here must equal the attestation file',
  },

  // --- the constitution annex, added 2026-08-16 (S1 Compiled Surfaces P3, the rulebook diet) ------
  // The diet turned CLAUDE.md sections into pointers over docs/constitution-annex/ pages. The
  // sharpest failure mode of a pointer architecture (the ExoCortex lesson, run 44): the pointer
  // stays valid while the content behind it rots, and a stale page loads as quiet misdirection
  // with no error anywhere. These rows make annex-rot Monday-loud for the machine-checkable claims.
  {
    name: 'root-skills-count',
    doc: 'CLAUDE.md',
    regex: /\*\*(\d+) third-party skills\*\*/,
    subject: 'skills', predicate: 'count', mode: 'equals',
    why: 'the dieted Skill Bindings section states the installed count; the auto-install lane moves it, so the prose must track skills-lock.json',
  },
  {
    name: 'annex-skills-count',
    doc: 'docs/constitution-annex/skills-provenance.md',
    regex: /(\d+) third-party skills/,
    subject: 'skills', predicate: 'count', mode: 'equals',
    why: 'the annex carries the full skills provenance; a stale count there is exactly the pointer-rot class the annex rows exist for',
  },
  {
    name: 'annex-model-default',
    doc: 'docs/constitution-annex/model-routing-history.md',
    subject: 'model-routing', predicate: 'default', mode: 'contains',
    why: 'the model-routing annex must name the CURRENT manifest default; history pages may narrate old models but the standing intro line must not lie',
  },
];

function readDoc(p) {
  const abs = path.isAbsolute(p) ? p : path.join(REPO, p);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

// =================================================================================================
// THE PROJECT-SPEC SWEEP (added 2026-07-29, architecture review, the CLASS fix)
// =================================================================================================
// WHY: that review found ELEVEN spec-vs-registry disagreements across work/NN/CLAUDE.md, and the
// reason they had all accumulated silently was simple - the project specs were the one surface with
// no checker at all. C1 asserts a spec FILE exists, C10 notices it changed, V7 reads schedule prose,
// but nothing had ever read what a spec CLAIMS about itself. Fixing eleven sentences by hand without
// this would just reset the clock.
//
// A generic sweep, deliberately NOT 32 hand-written assertion rows: a per-project row set would drift
// exactly like the prose it polices, and a new project would silently arrive uncovered.
//
// DIRECTION LAW HOLDS: the expectation comes from system/manifest.json (structured), the spec prose is
// the test subject. Never the reverse.
//
// SCOPE IS DELIBERATELY NARROW. Only two claims are asserted, because both are decidable from
// structured data with no judgement. Lifecycle-state prose was evaluated and REJECTED for v1: specs
// name states in history lines, in comparisons to other projects, and in superseded notes, so any
// regex broad enough to catch a real drift also fires on correct prose, and a checker with false
// positives gets ignored, which is worse than no checker.
const FOREIGN_PROVIDERS = /\b(openai|gpt-[0-9o]|gpt4|chatgpt|gemini|llama|mistral|cohere|deepseek|grok|moonshot|kimi(?:-k[0-9])?)\b/i;
// moonshot|kimi added 2026-09-10 (A17-T5): they were the ACTUAL provider from 2026-07-27 to 08-07,
// so a doc still claiming them is the most likely routing lie this repo can tell, and the pattern
// could not see it. Proven by a negative test that did not fire until this line changed.
// A mention only counts as a ROUTING CLAIM if it reads like one. Feed/source references are excluded:
// #15 alex-radar legitimately reads the OpenAI news RSS, and that is data ingestion, not model routing.
const ROUTING_CONTEXT = /\b(model|runs on|run on|prose|writer|voice block|routing|fed from|node runs|call(?:s|ed)? )\b/i;
const SOURCE_CONTEXT = /\b(rss|feed|changelog|atom|\.xml|news|blog|releases?|landscape|monitor|advisor)\b/i;
// Tuned against all 32 live specs on 2026-07-29 until the sweep reported ZERO false positives, because
// a checker that cries wolf gets ignored and is worse than no checker. Each exclusion below is a REAL
// line that fired during that tuning pass, kept here so a future widening knows what it must not break:
//   - `openai-whisper` is a pip package name (#06, #16), not a routing decision.
//   - a DENIAL ("no OpenAI key exists or is needed", "never carried", "was never applied") is the spec
//     being correct out loud, which is the opposite of drift.
//   - a HISTORY line ("First run (2026-07-07)... the old gpt-4.1-mini wording") records what was once
//     true; specs are allowed to remember.
const PKG_NAME = /openai[-_]whisper/i;
const DENIAL = /\bno\s+\w*\s?(?:openai|gpt)\b|\bnot\b[^.]{0,40}\b(?:openai|gpt)\b|\bnever\s+(?:carried|ran|run|applied|has)\b|\bno\s+\w+\s+has\s+ever\b/i;
const HISTORY = /\bFirst run \(|\bPrior state\b|\bhistorical\b|\bat that time\b|\bthe old\b|\bused to\b|\bpreviously\b|\bSUPERSEDE[SD]?\b|\bwas\b|\bswap(?:ped)?\b|\bhas read\b|\bwent through\b|\bno longer\b|\bolder notes\b|\b(?:429|outage|overloaded|refusing|blocked by)\b|\(20\d{2}-\d{2}-\d{2}[,)]|\bperiod\b|\[20\d{2}-\d{2}-\d{2}\]|\bExec \d+ \(|\b20\d{2}-\d{2}-\d{2}\b.*\b(?:to|until|through)\b/i;
// A DATED record - a `[2026-07-27]` bulletin, an `Exec 3670 (08-06 ...)` incident line, a date range -
// states what was true THEN. Those are the shape the supersession convention asks for, not drift.
// Supersession phrasing added 2026-09-10: a doc that records what a value USED to be, in the same
// sentence as the correction, is doing exactly what the convention asks for and must not be flagged.
// The repo's OWN supersession convention is the biggest false-positive source: corrections are written
// INLINE and quote the value they replace (`*(Corrected 2026-07-29 ... this said "OpenAI" ...)*`), so a
// naive prose scan flags every correctly-corrected file. Strip those spans before scanning, and the
// checker reads only the live claim - which is exactly what it is supposed to police.
// A11-T14 / A17-T17 (2026-09-10): the second replace consumed everything from the marker to the end
// of the LINE, including any live claim written after the correction on that same line. A false
// claim wrapped behind a supersession note was therefore invisible to C21, the one checker that
// exists to catch a doc lying about the system. It now stops at the correction's own closing bold
// marker, so the correction is removed and the text after it stays scannable.
function stripCorrections(text) {
  return text
    .replace(/\*\((?:Corrected|Correction|Superseded)[\s\S]*?\)\*/gi, ' ')
    .replace(/\*\*Superseded[^*\n]*(?:\*\*)?/gi, ' ');
}

function sweepProjectSpecs(manifest, findings) {
  let swept = 0;
  const routing = (manifest.meta && manifest.meta.model_routing) || {};
  const allowed = new Set();
  if (routing.default) allowed.add(String(routing.default).toLowerCase());
  for (const v of Object.values(routing.overrides || {})) {
    if (typeof v === 'string') allowed.add(v.toLowerCase());
    else if (v && v.model) allowed.add(String(v.model).toLowerCase());
  }
  for (const v of Object.values((routing.local_wrappers || {}).pins || {})) {
    allowed.add(String(v).toLowerCase());
  }

  // The checker's OWN spec is exempt from the two prose sweeps, and only from those. work/18's spec
  // documents these rules and therefore has to QUOTE the patterns they match ("OpenAI", "No separate
  // schedule") as worked examples; scanning it flags the documentation of the check as a violation of
  // the check. Found immediately on first full run 2026-07-29, which is the same self-referential shape
  // as C21 catching its own "20 checks" line - except that one was a real drift and this is not.
  // NARROW ON PURPOSE: work/18's factual claims are still covered by the row assertions above
  // (recovery-check-count), so this exempts a prose scan, never the file.
  const SWEEP_EXEMPT = new Set(['work/18-recovery-layer']);

  for (const p of manifest.projects || []) {
    const dir = p.work_dir;
    if (!dir || SWEEP_EXEMPT.has(dir)) continue;
    const rel = `${dir}/CLAUDE.md`;
    const raw = readDoc(rel);
    if (!raw) continue; // C1 owns "the spec must exist"; not this sweep's job
    const text = stripCorrections(raw);
    swept++;

    // --- A. a spec must not advertise a model provider the routing contract does not carry --------
    // This is the #23 class: work/23-self-review/CLAUDE.md said "OpenAI + soul.md" for a prose line
    // for three weeks after the 2026-07-08 rule change, while meta.model_routing named no OpenAI
    // anywhere and the wrapper pinned claude-sonnet-4-6.
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(FOREIGN_PROVIDERS);
      if (!m) continue;
      if (!ROUTING_CONTEXT.test(line)) continue;
      if (SOURCE_CONTEXT.test(line)) continue;      // a feed, not a routing claim
      if (PKG_NAME.test(line)) continue;            // `openai-whisper` is a package, not a provider
      if (DENIAL.test(line)) continue;              // "no OpenAI key exists" is correctness, not drift
      if (HISTORY.test(line)) continue;             // specs are allowed to record what was once true
      if (/OpenAI-(format|compatible)|OpenAI `?messages`?/i.test(line)) continue; // Moonshot body format
      const token = m[1].toLowerCase();
      if (allowed.has(token)) continue;
      findings.push(
        `${rel}: spec prose names model provider "${m[1]}" in a routing claim, but ` +
        `meta.model_routing carries only [${[...allowed].join(', ')}]. Line: "${line.trim().slice(0, 140)}"`
      );
    }

    // --- B. a spec must not deny a schedule the registry gives it (and vice versa) ----------------
    // This is the #13 class: airbnb-host said "No separate schedule" while the manifest and
    // scheduler/schedule.md both carried PersonalOS-airbnb-host monthly on the 24th at 10:00.
    const jobs = Array.isArray(p.schedule_jobs) ? p.schedule_jobs : [];
    // Precise phrases only. A loose /no schedule/ fired on #30's per-lane note about its HELD content
    // engine, which is a TRUE statement about one lane of a project that legitimately has two jobs.
    const deniesSchedule = /\bNo separate schedule\b|\bNot scheduled\b/i.test(text);
    if (jobs.length && deniesSchedule) {
      findings.push(
        `${rel}: spec denies having a schedule ("No separate schedule" / "Not scheduled") but the ` +
        `registry gives it ${jobs.length} job(s): [${jobs.join(', ')}]. One of the two is lying to a reader.`
      );
    }
  }

  // --- A2. the SAME model-provider scan over the live n8n mirrors (A17-T5, 2026-09-10) -----------
  // docs/n8n/<workflow>/README.md is the human-readable mirror of what is deployed, and it is the
  // page a person reads before touching a live workflow. Four of them named `kimi-k3` and
  // `claude-opus-4-8` for 34 days after the 2026-08-07 move to opus-5/sonnet-5, including in
  // node-by-node prose asserting the engines call api.moonshot.ai, which they have not since. The
  // spec sweep above never looked here because it iterates manifest projects. Same rules, same
  // allowed set, same history/denial carve-outs, so a mirror can record what WAS true.
  const mirrorRoot = path.join(REPO, 'docs', 'n8n');
  if (fs.existsSync(mirrorRoot)) {
    for (const d of fs.readdirSync(mirrorRoot, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const rel = `docs/n8n/${d.name}/README.md`;
      const raw = readDoc(rel);
      if (!raw) continue;
      const text = stripCorrections(raw);
      swept++;
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(FOREIGN_PROVIDERS);
        if (!m) continue;
        if (!ROUTING_CONTEXT.test(line)) continue;
        if (SOURCE_CONTEXT.test(line)) continue;
        if (PKG_NAME.test(line)) continue;
        if (DENIAL.test(line)) continue;
        if (HISTORY.test(line)) continue;
        if (/OpenAI-(format|compatible)|OpenAI `?messages`?/i.test(line)) continue;
        const token = m[1].toLowerCase();
        if (allowed.has(token)) continue;
        findings.push(
          `${rel}: n8n mirror names model provider "${m[1]}" in a routing claim, but ` +
          `meta.model_routing carries only [${[...allowed].join(', ')}]. Line: "${line.trim().slice(0, 140)}"`
        );
      }
    }
  }
  return swept;
}

function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--no-harvest')) {
    try {
      require('../system/recall/lib/harvest-core').runHarvest();
    } catch (e) {
      // A04-T-13 (2026-09-11): this used to warn and carry on against whatever facts.db already
      // held. C21's whole job is testing DOCS against GROUND TRUTH, so a failed harvest means the
      // ground truth is stale by an unknown amount and every "consistent" verdict below is really
      // "consistent with yesterday". Worse, the mass-drift tripwire ABORTS the harvest on purpose
      // when something is badly wrong, which is exactly when this check was most confident.
      // A check that could not refresh its own ground truth has not passed, it has not run.
      console.error(`facts-check: FAILED - harvest did not complete (${e.message})`);
      console.error('C21 tests docs against facts.db, so a stale ledger makes every verdict below meaningless. Not reporting a pass.');
      return 2;
    }
  }

  let db;
  try { db = openDb(true); } catch (e) {
    console.error(`facts-check: cannot open facts.db (${e.message}) - run the harvest first`);
    return 1;
  }

  // A11-T13 (2026-09-10): C21 tests standing doc claims AGAINST facts.db, so a ledger that stopped
  // refreshing turns this check into a comparison of two stale things that agree with each other.
  // That is worse than no check: it reports consistency. The harvest runs nightly, so anything past
  // 48h means the chain is down and this run cannot make a truthful statement.
  try {
    const mx = db.prepare('SELECT MAX(t_valid) m FROM facts').get().m;
    if (mx) {
      const iso = String(mx).replace(' ', 'T');
      const ms = Date.parse(/[Zz]$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
      const ageH = (Date.now() - ms) / 3.6e6;
      if (Number.isFinite(ageH) && ageH > 48) {
        console.error(`facts-check: facts.db newest fact is ${ageH.toFixed(0)}h old (over the 48h bar) - the harvest chain is not running, so every doc claim below would be tested against a stale ledger. Not asserting.`);
        return 2;
      }
    }
  } catch { /* a ledger without a facts table is the openDb error above, not this */ }

  const findings = [];
  for (const a of ASSERTIONS) {
    const fact = currentFact(db, a.subject, a.predicate);
    if (!fact) {
      if (!a.optional) findings.push(`no current fact for ${a.subject}/${a.predicate} (harvester gap) - cannot verify "${a.name}"`);
      continue;
    }
    let text = readDoc(a.doc);
    if (text == null) {
      if (!a.optional) findings.push(`doc missing for "${a.name}": ${a.doc}`);
      continue;
    }
    if (a.section) {
      const sm = text.match(a.section);
      if (!sm) { findings.push(`section not found in ${a.doc} for "${a.name}"`); continue; }
      text = sm[0];
    }
    if (a.mode === 'contains') {
      if (!text.includes(String(fact.object))) {
        findings.push(`${a.doc}: prose does not mention the current ${a.subject}/${a.predicate} = "${fact.object}" (source ${fact.source}). ${a.why}`);
      }
    } else { // equals
      const m = text.match(a.regex);
      if (!m) { findings.push(`${a.doc}: could not locate the "${a.name}" claim (regex ${a.regex}) to verify against ${a.subject}/${a.predicate}=${fact.object}`); continue; }
      if (String(m[1]) !== String(fact.object)) {
        findings.push(`${a.doc}: claims "${m[0].trim()}" but ${a.subject}/${a.predicate} = ${fact.object} (source ${fact.source}). ${a.why}`);
      }
    }
  }
  db.close();

  // The project-spec sweep (2026-07-29): expectation from the structured registry, prose as subject.
  let specCount = 0;
  try {
    const manifest = JSON.parse(readDoc('system/manifest.json'));
    specCount = sweepProjectSpecs(manifest, findings);
  } catch (e) {
    findings.push(`spec sweep could not run: ${e.message}`);
  }

  if (findings.length) { findings.forEach((f) => console.log(f)); return 2; }
  console.log(
    `facts-check C21: ${ASSERTIONS.length} doc claim(s) consistent with facts.db; ` +
    `${specCount} project spec(s) consistent with the registry`
  );
  return 0;
}

process.exit(main());
