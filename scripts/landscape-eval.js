#!/usr/bin/env node
// landscape-eval.js - Phase 2 P2-S2, the deterministic half of the weekly evaluation layer (#25).
// This script itself is ZERO-TOKEN: it reads the week's monitor log, and either
//   - short-circuits an empty week (exit 3, "nothing new" -> the wrapper posts nothing, stays GREEN), or
//   - assembles ONE evaluation prompt (with full context on Alex's mission + current capabilities) and
//     writes it to a scratch file, printing its path (exit 0). The wrapper feeds that prompt to a
//     single `claude -p` call - that is the ONE model call per week (P2-S2). Claude proposes a
//     recommend/skip verdict per item; SHAHEEN decides (P2-S3). No item is ever invented and unknown
//     stays unknown - the digest may only assess what the monitor actually logged.
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const LOG_FILE = path.join(REPO, 'system', 'landscape-log.jsonl');
const WINDOW_DAYS = 7;

function daysAgoStr(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function loadWeek() {
  if (!fs.existsSync(LOG_FILE)) return [];
  const cutoff = daysAgoStr(WINDOW_DAYS);
  const out = [];
  for (const line of fs.readFileSync(LOG_FILE, 'utf8').split(/\r?\n/).filter(Boolean)) {
    try { const o = JSON.parse(line); if (o.date && o.date >= cutoff) out.push(o); } catch { /* skip */ }
  }
  return out;
}

// Current-capabilities context: what Alex already is, so the eval can answer "add? replace? redundant?"
function capabilitiesContext() {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'system', 'manifest.json'), 'utf8'));
  const projects = manifest.projects
    .filter(p => p.state !== 'RETIRED')
    .map(p => `  #${p.num} ${p.title} [${p.state}] - ${p.one_liner}`)
    .join('\n');
  const claudeMd = fs.readFileSync(path.join(REPO, 'CLAUDE.md'), 'utf8');
  const mcp = claudeMd.match(/^## MCP Reference$([\s\S]*?)(?=^## )/m);
  const mcpSection = mcp ? mcp[0].trim() : '(MCP Reference section not found)';

  // Skills context (for the skills lane, added 2026-07-11): what's already installed (dedup), the
  // routing contract, and the auto-install policy the model must respect when proposing installs.
  let installedSkills = '(skills-lock.json not found)';
  const allowSet = new Set();
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(REPO, 'skills-lock.json'), 'utf8'));
    const names = Object.entries(lock.skills || {}).map(([n, v]) => {
      if (v && v.source) allowSet.add(String(v.source).split('/')[0].toLowerCase());
      return `${n} (${v && v.source ? v.source : '?'})`;
    });
    installedSkills = names.length ? names.join(', ') : '(none installed yet)';
  } catch { /* leave default */ }

  const bindings = claudeMd.match(/^## Skill Bindings[\s\S]*?(?=^## )/m);
  const bindingsSection = bindings ? bindings[0].trim() : '(Skill Bindings section not found)';

  let allowlist = [];
  let installCap = 3;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'system', 'skills-sources.json'), 'utf8'));
    for (const a of cfg.trust_allowlist || []) allowSet.add(String(a).toLowerCase());
    installCap = cfg.weekly_install_cap || 3;
  } catch { /* skills lane not configured */ }
  allowlist = [...allowSet].sort();

  return { projects, mcpSection, installedSkills, bindingsSection, allowlist, installCap };
}

function renderItem(e, i) {
  if (e.category === 'skills' && e.extra) {
    const pk = e.extra.popularity_kind === 'installs' ? 'installs' : 'repo stars';
    return `${i + 1}. ${e.item} - repo ${e.extra.repo || '?'} (${e.extra.popularity || 0} ${pk}) [via ${e.source}]` +
      `${e.link ? `\n   ${e.link}` : ''}`;
  }
  return `${i + 1}. [${e.source}] ${e.item}${e.link ? `\n   ${e.link}` : ''}`;
}

// Deterministic platform-overlap pre-scan (three-plan validation P4, 2026-07-17). Zero-token: keyword
// match of each new `platform` item against every non-retired project's name + one_liner + commands, so
// "the platform we run on just changed" is caught by the Monday eval, not a manual brainstorm. A hit is
// marked OVERLAPPING with the project(s) + the shared tokens. Tuning bias (per the plan): a false overlap
// costs one digest row, the cheap direction. The model must then resolve every overlap to Recommend/Skip;
// a deterministic post-check in the wrapper (landscape-eval-check.js) fails the run if it silently drops one.
const STOP = new Set(['alex','shaheen','every','automation','status','notion','gmail','into','from','with',
  'that','this','their','there','build','built','daily','weekly','month','monthly','model','models','claude',
  'sonnet','before','after','while','which','when','then','than','they','them','your','yours','field','value',
  'table','data','file','files','page','pages','line','lines','runs','only','also','more','most','some','same',
  'other','across','pipeline','project','projects','update','report','reports','first','second','human','local']);
function tokset(s) {
  return new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 5 && !STOP.has(t)));
}
function computeOverlaps(week) {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'system', 'manifest.json'), 'utf8'));
  const projTokens = manifest.projects.filter(p => p.state !== 'RETIRED').map(p => ({
    num: p.num, title: p.title,
    tokens: tokset(`${p.name} ${p.title} ${p.one_liner} ${(p.commands || []).join(' ')}`),
  }));
  const overlaps = [];
  for (const e of week) {
    if (e.category !== 'platform') continue;
    const it = tokset(`${e.item} ${e.source || ''}`);
    if (!it.size) continue;
    const hits = [];
    for (const p of projTokens) {
      const shared = [...it].filter(t => p.tokens.has(t));
      if (shared.length) hits.push({ project: `#${String(p.num).padStart(2, '0')} ${p.title}`, on: shared });
    }
    if (hits.length) overlaps.push({
      id: e.id, item: e.item, link: e.link || null,
      projects: hits.map(h => h.project), tokens: [...new Set(hits.flatMap(h => h.on))],
    });
  }
  return overlaps;
}

function buildPrompt(week, overlaps) {
  const { projects, mcpSection, installedSkills, bindingsSection, allowlist, installCap } = capabilitiesContext();
  const grouped = { models: [], mcp: [], patterns: [], platform: [], skills: [] };
  for (const e of week) (grouped[e.category] || (grouped[e.category] = [])).push(e);
  // Bound the prompt: show only the strongest skills candidates (rest stay in the log for a later week).
  const EVAL_SKILLS_CAP = 25;
  if (grouped.skills.length > EVAL_SKILLS_CAP) {
    grouped.skills.sort((a, b) => ((b.extra && b.extra.popularity) || 0) - ((a.extra && a.extra.popularity) || 0));
    grouped.skills = grouped.skills.slice(0, EVAL_SKILLS_CAP);
  }
  const itemLines = Object.entries(grouped)
    .filter(([, arr]) => arr.length)
    .map(([cat, arr]) => `### ${cat}\n` + arr.map(renderItem).join('\n'))
    .join('\n\n');

  return `You are Alex, keeping your own build current. This is the weekly landscape evaluation (#25 Evolution).
Your job: assess ONLY the items below - real entries the daily monitor logged this week - for whether
they should change how ALEX ITSELF is built. You do NOT act. You propose; Shaheen decides. The ONE
exception is the skills lane: skills you list in the install block are auto-installed this week by a
deterministic, audited, git-reversible installer (Shaheen's 2026-07-11 decision) - so be conservative.

Hard rules:
- Assess only the listed items. Invent nothing. If an item is unclear, say so; unknown stays unknown.
- Every item in the PLATFORM CAPABILITY OVERLAP block below MUST end up in ## Recommended or ## Skip, named verbatim. Dropping one fails the whole run (a deterministic post-check enforces this).
- This is about Alex's own capabilities (models, MCPs, automation patterns, agent skills), NOT a general
  AI news feed (that is #15 Alex AI Radar's job, for Shaheen's field awareness). If an item is only
  Shaheen-facing news with no bearing on Alex's build, mark it skip and say "radar territory".

For EACH item, answer the relevant question, then a verdict:
- New MCP: is it relevant to Alex? What would it ADD? What would it REPLACE?
- New model: is it better than the current prose model (claude-sonnet-4-6) for our use? Cost/latency change?
- New pattern: would it improve any EXISTING automation, or become a new numbered one?
- New skill: does it improve a SPECIFIC existing automation (name it) or fill a real gap? Is it ALREADY
  covered by an installed skill or MCP below (if so, SKIP)? Is its author on the auto-install allowlist?
- Verdict: RECOMMEND (worth Shaheen's time this week) or SKIP (with one-line reason).

=== ALEX'S CURRENT AUTOMATIONS ===
${projects}

=== ALEX'S CURRENT MCP SURFACE (from CLAUDE.md) ===
${mcpSection}

=== ALEX'S INSTALLED SKILLS (already have these - do NOT re-recommend) ===
${installedSkills}

=== SKILL ROUTING CONTRACT (root CLAUDE.md, for how a new skill would be wired) ===
${bindingsSection}

=== SKILLS AUTO-INSTALL POLICY (governs the install block you emit) ===
- Only these authors are eligible for AUTO-INSTALL: ${allowlist.join(', ') || '(none configured)'}.
- A skill from any other author may be RECOMMENDED in prose, but do NOT put it in the install block; it
  routes to manual review instead.
- Max ${installCap} skills in the install block per week (the 'safe != free' budget rule). Pick the best.
- Only include a skill that clearly improves a NAMED automation and is not already covered.
- The installer independently re-audits every entry (source, hooks, scripts, dedup, cap); a bad entry is
  dropped and flagged, never silently installed. Your block is a proposal, not a guarantee.

=== THIS WEEK'S LANDSCAPE ITEMS (${week.length}) ===
${itemLines}

=== PLATFORM CAPABILITY OVERLAP (deterministic pre-scan; MANDATORY per-item resolution) ===
The daily monitor's new \`platform\` items (the tools Alex runs on) were keyword-matched against your own
automations. Each item below overlaps an existing project - it MIGHT mean that project should change, or it
might be noise. You MUST resolve EVERY item in this block to either ## Recommended or ## Skip, naming it
verbatim (a deterministic post-check fails the whole run if any is silently dropped):
${(overlaps && overlaps.length)
    ? overlaps.map(o => `- **${o.item}** overlaps ${o.projects.join(', ')} (shared: ${o.tokens.join(', ')})${o.link ? `\n  ${o.link}` : ''}`).join('\n')
    : '(none this week)'}

=== OUTPUT FORMAT (this exact shape: digest markdown, THEN one json block) ===
# Landscape Digest ${new Date().toISOString().slice(0, 10)}
_${week.length} items this week. Alex proposes, Shaheen decides (skills auto-install per the policy above)._

## Recommended (<n>)
- **<item>** (<category>) - <what it adds/replaces or which automation it improves>. **Why now:** <one line>.

## Skip (<n>)
- **<item>** (<category>) - <one-line reason>.

## Skills auto-installing this week (<n>)
- **<skill>** -> <#NN automation> (<repo>) - <one-line why>. (empty: "none this week")

## If Shaheen approves any non-skill Recommend
Point to the integration runbook: work/25-evolution/CLAUDE.md (## Integration). Models, MCPs and patterns
still go through: edit source -> node scripts/generate-alex.js -> validation green -> Shaheen reviews the
diff -> merge. Only the skills lane auto-installs.

Then, as the LAST thing in your response, emit EXACTLY ONE fenced code block tagged json - the machine
input for the deterministic installer (DATA, not an action you take). Array of the skills to auto-install
this week, [] if none:
\`\`\`json
[{"name":"skill-name","source_repo":"owner/repo","skill_path":"skills/skill-name/SKILL.md or null","target_project":"#NN or name","task_trigger":"a CLAUDE.md Skill-Bindings-style trigger line","strength":"ADVISORY or MANDATORY","why":"one line"}]
\`\`\`

Write in Alex's voice per soul.md: direct, no filler, no em-dashes, no non-ASCII punctuation (plain
'-' and '.'). Be terse.

HARD OUTPUT CONTRACT for this run: do NOT modify any file yourself, do NOT run Change Propagation, do NOT
print a Close-Out Report, do NOT add a preamble or a closing question. Your ENTIRE response is the digest
markdown in the shape above, followed by the single fenced json install block, and nothing else - the
first line of your output must be the '# Landscape Digest' heading.`;
}

function main() {
  const week = loadWeek();
  if (week.length === 0) {
    console.log('NOTHING_NEW: no landscape-log entries in the last ' + WINDOW_DAYS + ' days.');
    process.exitCode = 3; // wrapper treats 3 as a clean no-op week (GREEN, posts nothing)
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = path.join(REPO, 'outputs', 'evolution', stamp);
  fs.mkdirSync(outDir, { recursive: true });
  // P4: deterministic platform-overlap pre-scan. Written to overlaps.json so the wrapper's post-check
  // (landscape-eval-check.js) can prove the model resolved every overlap to Recommend/Skip.
  const overlaps = computeOverlaps(week);
  fs.writeFileSync(path.join(outDir, 'overlaps.json'), JSON.stringify(overlaps, null, 2), 'utf8');
  const promptPath = path.join(outDir, 'eval-prompt.txt');
  fs.writeFileSync(promptPath, buildPrompt(week, overlaps), 'utf8');
  console.log(promptPath); // the wrapper reads this path, feeds it to one claude -p call
  process.exitCode = 0;
}

if (require.main === module) main();
// Exported for the P4 test harness (computeOverlaps is the deterministic overlap pre-scan).
module.exports = { computeOverlaps, buildPrompt, tokset, loadWeek };
