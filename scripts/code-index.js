#!/usr/bin/env node
'use strict';
/*
 * scripts/code-index.js - a deterministic map of this repo's own code. (P7.1, run-47 plan.)
 *
 * WHAT IT IS. Walks scripts/ and work/ and records what each file requires, imports, dot-sources or
 * shells out to, then writes one JSON map. /deep-audit and any migration read the map instead of
 * fanning out agents to re-read everything.
 *
 * WHAT IT IS NOT. Not a knowledge graph, not a model, not a third-party skill. This is the one
 * genuinely good capability graphify had - a free, local, deterministic view of code structure -
 * rebuilt in-repo after graphify itself was removed on 2026-08-23 for installing a package from
 * prose. Nothing here calls the network, spawns anything, or costs a token.
 *
 * THE ZERO-DEPENDENCY TRADE, STATED HONESTLY. Real AST parsing wants tree-sitter, which is a native
 * dependency, and scripts/ has no package.json by law. So this is REGEX extraction, and it is weaker
 * in exactly one way worth naming: it reads what a file DECLARES (its requires, imports, dot-sources,
 * and the scripts it invokes by name), not the full call graph inside functions. That is enough for
 * "what depends on this file", "what would this change break" and "what is orphaned", which are the
 * questions /deep-audit and #27 actually ask. It is NOT enough for "which function calls which".
 * If that day comes, the upgrade is a pinned tree-sitter venv under work/, never a dependency in
 * scripts/. Every edge is EXTRACTED-grade by construction: no model inferred anything.
 *
 *   node scripts/code-index.js              build + write system/code-graph.json
 *   node scripts/code-index.js --stale      exit 2 if the map is older than the newest source file
 *   node scripts/code-index.js --who-uses <file>   what depends on this file
 *   node scripts/code-index.js --orphans    tracked code nothing references
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const OUT = path.join(REPO, 'system', 'code-graph.json');
const ROOTS = ['scripts', 'work', 'system/recall'];
const SKIP_DIRS = new Set(['node_modules', '.next', '.venv', '__pycache__', '.git', 'n8n-backups', 'vault-index', 'browser-profile']);
const EXT = new Set(['.js', '.mjs', '.cjs', '.ps1', '.py', '.sh']);

const args = process.argv.slice(2);
const flag = (k) => args.includes('--' + k);
const val = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.claude') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(full); }
    else if (EXT.has(path.extname(e.name))) yield full;
  }
}

const rel = (p) => path.relative(REPO, p).split(path.sep).join('/');

/* Resolve a referenced path to a real file in the repo, or null. Deliberately conservative: a
 * reference that cannot be resolved to a file on disk is recorded as an EXTERNAL edge rather than
 * guessed at, because a wrong edge in an audit map is worse than a missing one. */
function resolveRef(fromFile, ref) {
  if (!ref) return null;
  const cleaned = ref.replace(/^['"`]|['"`]$/g, '').trim();
  if (!cleaned || cleaned.startsWith('http')) return null;
  const norm = cleaned.replace(/\\/g, '/');
  const candidates = [];
  if (norm.startsWith('.')) {
    const base = path.dirname(fromFile);
    candidates.push(path.resolve(base, norm));
    for (const e of EXT) candidates.push(path.resolve(base, norm + e));
    candidates.push(path.resolve(base, norm, 'index.js'));
  } else {
    candidates.push(path.join(REPO, norm));
    for (const e of EXT) candidates.push(path.join(REPO, norm + e));
  }
  for (const c of candidates) {
    try { if (fs.existsSync(c) && fs.statSync(c).isFile()) return rel(c); } catch (_) { /* skip */ }
  }
  return null;
}

const PATTERNS = [
  // node
  { lang: 'js', kind: 'require', re: /\brequire\(\s*['"`]([^'"`]+)['"`]\s*\)/g },
  { lang: 'js', kind: 'import', re: /\bfrom\s+['"`]([^'"`]+)['"`]/g },
  { lang: 'js', kind: 'import', re: /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g },
  // powershell
  { lang: 'ps1', kind: 'dot-source', re: /^\s*\.\s+["']?([^\s"';]+\.ps1)["']?/gm },
  { lang: 'ps1', kind: 'invoke', re: /(?:&|Start-Process|powershell(?:\.exe)?)\s+(?:-File\s+)?["']?([^\s"';]+\.(?:ps1|js|py))["']?/g },
  // python
  { lang: 'py', kind: 'import', re: /^\s*(?:from|import)\s+([A-Za-z_][\w.]*)/gm },
  // Any language shelling out to a repo script. BOTH separators on purpose: check.ps1 invokes
  // `node "scripts\facts-check.js"` with backslashes, and a forward-slash-only pattern reported 179
  // orphans of which most were false - a noisy orphans list is worse than none (the F-14 lesson).
  { lang: '*', kind: 'shell', re: /\b(?:node|python|python3|sh|bash|&)\s+["']?((?:scripts|work|system)[\\/][^\s"';)]+)["']?/g },
];

/* Files invoked from CONFIG rather than from code: .claude/settings.json hooks, and the scheduler.
 * Without these, every hook script looks orphaned, which is exactly backwards - they are the most
 * load-bearing files in the repo. Scanned as extra edge SOURCES so the map reflects reality. */
const CONFIG_SOURCES = ['.claude/settings.json', 'scheduler/schedule.md', 'system/manifest.json'];

function build() {
  const files = [];
  for (const r of ROOTS) for (const f of walk(path.join(REPO, r))) files.push(f);

  const nodes = {};
  const edges = [];
  for (const f of files) {
    const id = rel(f);
    let body = '';
    try { body = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
    const st = fs.statSync(f);
    nodes[id] = { id, ext: path.extname(f), bytes: st.size, mtime: st.mtime.toISOString().slice(0, 10), lines: body.split('\n').length };
    const seen = new Set();
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(body)) !== null) {
        const raw = m[1];
        const target = resolveRef(f, raw);
        const key = `${p.kind}:${target || raw}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (target && target !== id) edges.push({ from: id, to: target, kind: p.kind });
        else if (!target) {
          // Builtins and third-party names are recorded as external, never as a repo edge.
          edges.push({ from: id, to: raw, kind: p.kind, external: true });
        }
      }
    }
  }

  // Config-invoked edges: a hook script or a scheduled wrapper is referenced by JSON/prose, not by
  // an import, and would otherwise read as orphaned.
  for (const cfg of CONFIG_SOURCES) {
    const full = path.join(REPO, cfg);
    let body = '';
    try { body = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }
    const re = /((?:scripts|work|system)[\\/][^\s"';)]+\.(?:js|mjs|cjs|ps1|py|sh))/g;
    const seen = new Set();
    let m;
    while ((m = re.exec(body)) !== null) {
      const target = resolveRef(full, m[1].replace(/\\/g, '/'));
      if (!target || seen.has(target)) continue;
      seen.add(target);
      edges.push({ from: cfg, to: target, kind: 'config-invoked' });
    }
  }

  const graph = {
    _what: 'Deterministic map of this repo\'s own code. Every edge is EXTRACTED by regex from a declaration; no model inferred anything. Built by scripts/code-index.js (P7.1).',
    _limits: 'Declaration-level, not call-level: it records what a file requires/imports/dot-sources/invokes, not which function calls which. Enough for "what depends on this", "what would this break", "what is orphaned". Not enough for intra-function call graphs.',
    generated: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    counts: { files: Object.keys(nodes).length, internal_edges: edges.filter((e) => !e.external).length, external_refs: edges.filter((e) => e.external).length },
    nodes, edges,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(graph, null, 1) + '\n', 'utf8');
  return graph;
}

function load() {
  try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) { return null; }
}

// --- queries -------------------------------------------------------------------------------------

if (flag('who-uses') || val('who-uses')) {
  const g = load() || build();
  const target = String(val('who-uses') || '').replace(/\\/g, '/');
  const hits = g.edges.filter((e) => !e.external && (e.to === target || e.to.endsWith('/' + target)));
  if (!hits.length) console.log(`nothing in the map references ${target}`);
  else { console.log(`${hits.length} file(s) reference ${target}:`); for (const h of hits) console.log(`  ${h.from}  (${h.kind})`); }
  process.exit(0);
}

if (flag('orphans')) {
  const g = load() || build();
  const referenced = new Set(g.edges.filter((e) => !e.external).map((e) => e.to));
  // Entry points are referenced by schedulers, hooks and humans, not by code, so they are not orphans.
  const isEntry = (id) => /^scripts\/run-|^scripts\/hooks\/|check\.ps1$|security-sweep\.ps1$|\/tests\//.test(id);
  const orphans = Object.keys(g.nodes).filter((id) => !referenced.has(id) && !isEntry(id));
  console.log(`${orphans.length} file(s) referenced by nothing in the map (entry points excluded):`);
  for (const o of orphans.slice(0, 40)) console.log(`  ${o}`);
  if (orphans.length > 40) console.log(`  ... and ${orphans.length - 40} more`);
  console.log('\nNOT a delete list: a file can be invoked by Task Scheduler, a hook, an n8n node or by hand.');
  process.exit(0);
}

if (flag('stale')) {
  const g = load();
  if (!g) { console.log('code-graph: NEVER BUILT (not stale - run node scripts/code-index.js)'); process.exit(0); }
  let newest = 0; let newestFile = '';
  for (const r of ROOTS) for (const f of walk(path.join(REPO, r))) {
    const m = fs.statSync(f).mtimeMs;
    if (m > newest) { newest = m; newestFile = rel(f); }
  }
  const built = Date.parse(g.generated);
  const days = (newest - built) / 864e5;
  if (days > 7) { console.log(`code-graph is STALE: newest source ${newestFile} is ${days.toFixed(1)}d newer than the map`); process.exit(2); }
  console.log(`code-graph fresh (newest source within ${Math.max(0, days).toFixed(1)}d of the build)`);
  process.exit(0);
}

const g = build();
console.log(`code-index: ${g.counts.files} files, ${g.counts.internal_edges} internal edges, ${g.counts.external_refs} external refs -> ${rel(OUT)}`);
