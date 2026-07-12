#!/usr/bin/env node
// landscape-monitor.js - Phase 2 P2-S1, the monitoring layer (#25 Evolution).
// ZERO-TOKEN by design: no LLM call, ever. It fetches a small, keyless set of public feeds, extracts
// the newest items, and appends the ones it has not seen before to system/landscape-log.jsonl.
// It gathers and logs, nothing else - assessment is the weekly eval's job (landscape-eval.js), a
// human decides (P2-S2). Boundary vs #15 Alex AI Radar: the radar watches the whole AI field for
// SHAHEEN's decisions (research + opportunities + content, scored into a Notion pipeline). This
// watches the same field through ONE narrow lens - "does this change how ALEX ITSELF is built?"
// (new Claude models, new MCPs, new automation patterns) - and its output feeds the generator's
// manifest/MCP surface, not a research feed. See work/25-evolution/CLAUDE.md.
//
// Sources are DATA, not prose (ground rule 6): edit the SOURCES array to add/remove a feed.
// Every source is public + keyless. Fetch failure of one source is logged and skipped (partial data
// beats none); ALL sources failing is the only hard failure (exit 1 -> the wrapper pushes RED).
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const LOG_FILE = path.join(REPO, 'system', 'landscape-log.jsonl');
const SKILLS_CONFIG = path.join(REPO, 'system', 'skills-sources.json');
const FETCH_TIMEOUT_MS = 15000;
const MAX_PER_SOURCE_FIRST_RUN = 8; // don't dump a feed's entire history on the first ever run
const MAX_PER_SOURCE_PER_RUN = 6;   // c8 (upgrade P13): a chatty feed can't flood one run's log

// category = the three signal types the spec names (models | mcp | patterns).
// kind = how to parse the response: 'atom' (GitHub release/commit feeds) or 'hn' (HN Algolia JSON).
// b29 (upgrade P13, 2026-07-12): dropped two ~96%-noise feeds - 'anthropic-sdk-python releases' (SDK
// point bumps, never a model launch: the launch signal lives in HN + the deployed-vs-released compare
// below) and 'MCP servers commits' (CI/docs churn: the real MCP signal is the SDK releases + HN).
// Tightened 'HN: n8n / automation' minPoints 20 -> 40 (it was pulling non-compete automation blog posts).
const SOURCES = [
  { category: 'models',   name: 'HN: Anthropic/Claude',          kind: 'hn',   minPoints: 30, url: 'https://hn.algolia.com/api/v1/search_by_date?query=Anthropic%20Claude&tags=story&hitsPerPage=25' },
  { category: 'mcp',      name: 'MCP TypeScript SDK releases',   kind: 'atom', url: 'https://github.com/modelcontextprotocol/typescript-sdk/releases.atom' },
  { category: 'mcp',      name: 'HN: MCP',                       kind: 'hn',   minPoints: 20, url: 'https://hn.algolia.com/api/v1/search_by_date?query=model%20context%20protocol&tags=story&hitsPerPage=25' },
  { category: 'patterns', name: 'n8n releases',                  kind: 'atom', url: 'https://github.com/n8n-io/n8n/releases.atom' },
  { category: 'patterns', name: 'HN: n8n / automation',          kind: 'hn',   minPoints: 40, url: 'https://hn.algolia.com/api/v1/search_by_date?query=n8n&tags=story&hitsPerPage=25' },
];
// HN Algolia's server-side numericFilters returns 400 on search_by_date, so points are filtered here.

function today() { return new Date().toISOString().slice(0, 10); }

// A stable identity per item so re-runs never double-log. Prefer the link; fall back to title.
function idOf(category, link, title) {
  return `${category}::${(link || title || '').trim().toLowerCase()}`;
}

async function fetchText(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'alex-personal-os-landscape-monitor', 'Accept': 'application/atom+xml, application/json, */*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function decodeEntities(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
}

// Minimal Atom parse: pull <entry> blocks, then title + link href from each. Deterministic, no dep.
function parseAtom(xml) {
  const items = [];
  for (const m of xml.matchAll(/<entry\b[\s\S]*?<\/entry>/g)) {
    const block = m[0];
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    const link = block.match(/<link[^>]*href="([^"]+)"/);
    if (title) items.push({ title: decodeEntities(title[1].replace(/<[^>]+>/g, '')), link: link ? link[1] : null });
  }
  return items;
}

function parseHn(jsonText, minPoints = 0) {
  const data = JSON.parse(jsonText);
  return (data.hits || [])
    .filter(h => (h.points || 0) >= minPoints)
    .map(h => ({
      title: h.title || h.story_title || '(untitled)',
      link: h.url || h.story_url || (h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : null),
    }));
}

// ---- Skills lane (#25 evolution, 2026-07-11) --------------------------------------------------
// Gated on system/skills-sources.json existing (feature flag by file presence). Scans agent-skill
// directories (skills.sh / skillsmp.com / skillhub.club) for portfolio keywords and logs NEW skills as
// category:'skills' rows. Zero-token, one fetch per (directory x keyword). Dedup key collapses the same
// skill listed by multiple directories. The weekly eval assesses fit; the installer audits + installs.
function getByPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// Resolve an item to a clean GitHub "owner/repo" from whatever field the directory provides.
function resolveRepo(item, map) {
  if (map.repo && item[map.repo]) {
    // skills.sh: source is already "owner/repo" (may carry extra path segments - keep first two).
    const parts = String(item[map.repo]).split('/').filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  }
  const url = (map.github_url && item[map.github_url]) || (map.repo_url && item[map.repo_url]);
  if (url) {
    const m = String(url).match(/github\.com\/([^/#?]+)\/([^/#?]+)/i);
    if (m) return `${m[1]}/${m[2].replace(/\.git$/, '')}`;
  }
  return null; // no resolvable repo -> the installer will flag it, never install
}

async function scanSkills() {
  if (!fs.existsSync(SKILLS_CONFIG)) return { rows: [], ok: 0, failed: [] };
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(SKILLS_CONFIG, 'utf8')); }
  catch (e) { return { rows: [], ok: 0, failed: [`skills-sources.json parse (${e.message})`] }; }

  const keywords = (cfg.portfolio_keywords || []).slice(0, 45);
  const dirs = (cfg.directories || []).filter(d => d.enabled !== false);
  const allow = new Set((cfg.trust_allowlist || []).map(a => a.toLowerCase()));
  const maxPerRun = cfg.max_log_per_run || 60;
  const date = today();
  const rows = [];
  const seenThisRun = new Set();
  let ok = 0;
  const failed = [];

  for (const dir of dirs) {
    for (const kw of keywords) {
      const url = dir.url_template.replace('{q}', encodeURIComponent(kw));
      let payload;
      try { payload = JSON.parse(await fetchText(url)); ok++; }
      catch (e) { failed.push(`${dir.name} "${kw}" (${e.message})`); continue; }
      const items = getByPath(payload, dir.items_path) || [];
      if (!Array.isArray(items)) continue;
      for (const it of items) {
        const map = dir.map || {};
        const name = it[map.name];
        if (!name) continue;
        const repo = resolveRepo(it, map);
        const author = repo ? repo.split('/')[0].toLowerCase() : String(it[map.author] || '').toLowerCase();
        const pop = Number(it[map.popularity] || 0);
        // Noise gate. Stars are whole-repo/mirror-bot noise (skillsmp/skillhub), so the ONLY reliable
        // filter there is the trust allowlist -> log only skills we could actually install. skills.sh
        // gives real install counts, so gate it on the install floor and let the eval judge new authors.
        if ((dir.popularity_kind || 'installs') === 'stars') {
          if (!author || !allow.has(author)) continue;
        } else if (dir.min_popularity && pop < dir.min_popularity) {
          continue;
        }
        // Dedup on the resolved skill identity so the same skill across directories logs once.
        const id = `skills::${(repo || 'unknown').toLowerCase()}::${String(name).toLowerCase()}`;
        if (seenThisRun.has(id)) continue;
        seenThisRun.add(id);
        const link = repo ? `https://github.com/${repo}` : (it[map.repo_url] ? it[map.repo_url] : null);
        rows.push({
          date, category: 'skills', source: dir.name, item: String(name), link, id,
          extra: { repo, author: repo ? repo.split('/')[0] : (it[map.author] || null), popularity: pop, popularity_kind: dir.popularity_kind || 'installs', directory_role: dir.role || null },
        });
      }
    }
  }
  // Hard safety cap: never dump more than max_log_per_run in one run. Prefer real install counts, then
  // higher popularity, so the eval always sees the strongest candidates first.
  rows.sort((a, b) => {
    const ai = a.extra.popularity_kind === 'installs' ? 1 : 0;
    const bi = b.extra.popularity_kind === 'installs' ? 1 : 0;
    if (ai !== bi) return bi - ai;
    return (b.extra.popularity || 0) - (a.extra.popularity || 0);
  });
  return { rows: rows.slice(0, maxPerRun), ok, failed };
}

// ---- Deployed-versions self-probe (b30, upgrade P13, 2026-07-12) ------------------------------
// The eval used to GUESS what the box runs (the 2.21.7 incident: it assumed n8n 1.x). This logs a
// `deployed` row so released-vs-deployed is a real comparison, not a guess. IDEMPOTENT: the row id is
// the version+model signature, so loadSeenIds dedups it - a new row appears ONLY when the box changes.
// Everything is best-effort + graceful: the public feeds above never depend on this, and any probe
// failure (no creds, box unreachable, service renamed) just skips the deployed row. NOT zero-auth
// (the model read needs the n8n key from env), but still ZERO-TOKEN (no LLM).
async function probeDeployed() {
  const date = today();
  // n8n version: ask the box directly (ssh alias 'n8n' = the Hetzner host, same as the backups/cron).
  let n8nVer = null;
  try {
    const out = execSync(
      'ssh -o ConnectTimeout=8 -o BatchMode=yes n8n "cd /opt/n8n && docker compose exec -T n8n n8n --version 2>/dev/null || true"',
      { timeout: 15000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    n8nVer = out.match(/\d+\.\d+\.\d+/) ? out.match(/\d+\.\d+\.\d+/)[0] : (out || null);
  } catch { /* box unreachable / service renamed -> skip the version half */ }
  // Deployed writer model: read it off the live BI engine (#03) - env-gated on the n8n API key.
  let model = null;
  const base = process.env.N8N_API_URL, key = process.env.N8N_API_KEY;
  if (base && key) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(`${base.replace(/\/$/, '')}/workflows/9XuIEfxS71DEetVR`,
        { headers: { 'X-N8N-API-KEY': key }, signal: ac.signal }).finally(() => clearTimeout(t));
      if (res.ok) { const wf = await res.text(); const m = wf.match(/claude-[a-z0-9.-]+/i); model = m ? m[0] : null; }
    } catch { /* API unreachable -> skip the model half */ }
  }
  if (!n8nVer && !model) return [];
  const id = `deployed::n8n=${n8nVer || '?'}::model=${model || '?'}`;
  return [{
    date, category: 'deployed', source: 'box self-probe (P13/b30)',
    item: `n8n ${n8nVer || 'unknown'} · writer model ${model || 'unknown'}`,
    link: null, id, extra: { n8n_version: n8nVer, writer_model: model },
  }];
}

function loadSeenIds() {
  const seen = new Set();
  let firstRun = true;
  if (fs.existsSync(LOG_FILE)) {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
    if (lines.length) firstRun = false;
    for (const line of lines) {
      try { const o = JSON.parse(line); if (o.id) seen.add(o.id); } catch { /* skip a corrupt line */ }
    }
  }
  return { seen, firstRun };
}

(async () => {
  const { seen, firstRun } = loadSeenIds();
  const date = today();
  const fresh = [];
  let okSources = 0;
  const failed = [];

  for (const src of SOURCES) {
    try {
      const text = await fetchText(src.url);
      let items = src.kind === 'atom' ? parseAtom(text) : parseHn(text, src.minPoints || 0);
      okSources++;
      if (firstRun) items = items.slice(0, MAX_PER_SOURCE_FIRST_RUN);
      let addedThisSource = 0;
      for (const it of items) {
        const id = idOf(src.category, it.link, it.title);
        if (seen.has(id)) continue;
        if (addedThisSource >= MAX_PER_SOURCE_PER_RUN) break; // c8 (P13): cap NEW items per source/run;
        seen.add(id);                                          // the rest stay unseen and drain next run
        fresh.push({ date, category: src.category, source: src.name, item: it.title, link: it.link, id });
        addedThisSource++;
      }
    } catch (e) {
      failed.push(`${src.name} (${e.message})`);
      console.error(`landscape-monitor: source failed - ${src.name}: ${e.message}`);
    }
  }

  // Skills lane (gated on system/skills-sources.json). Its fetches count toward okSources so a total
  // network outage still hard-fails, but a missing config just means "no skills lane", not a failure.
  const skills = await scanSkills();
  okSources += skills.ok;
  for (const f of skills.failed) failed.push(f);
  for (const row of skills.rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    fresh.push(row);
  }

  // Deployed-versions self-probe (b30). Best-effort; never affects okSources or the hard-fail gate.
  try {
    for (const row of await probeDeployed()) {
      if (seen.has(row.id)) continue; // idempotent: only a CHANGED deployed signature logs
      seen.add(row.id);
      fresh.push(row);
    }
  } catch (e) { console.error(`landscape-monitor: deployed probe skipped (${e.message})`); }

  if (okSources === 0) {
    console.error(`landscape-monitor: ALL sources failed - nothing fetched. Failures: ${failed.join('; ')}`);
    process.exitCode = 1;
    return;
  }

  if (fresh.length) {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, fresh.map(o => JSON.stringify(o)).join('\n') + '\n', 'utf8');
  }

  const byCat = fresh.reduce((a, o) => { a[o.category] = (a[o.category] || 0) + 1; return a; }, {});
  console.log(`landscape-monitor: ${okSources}/${SOURCES.length} sources ok` +
    `${failed.length ? ` (${failed.length} failed)` : ''}; ${fresh.length} new item(s)` +
    `${fresh.length ? ' [' + Object.entries(byCat).map(([k, v]) => `${k}:${v}`).join(' ') + ']' : ''}` +
    `${firstRun ? ' (first run, capped per source)' : ''}`);
  process.exitCode = 0;
})();
