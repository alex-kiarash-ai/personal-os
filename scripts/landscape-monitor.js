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

const REPO = path.join(__dirname, '..');
const LOG_FILE = path.join(REPO, 'system', 'landscape-log.jsonl');
const FETCH_TIMEOUT_MS = 15000;
const MAX_PER_SOURCE_FIRST_RUN = 8; // don't dump a feed's entire history on the first ever run

// category = the three signal types the spec names (models | mcp | patterns).
// kind = how to parse the response: 'atom' (GitHub release/commit feeds) or 'hn' (HN Algolia JSON).
const SOURCES = [
  { category: 'models',   name: 'anthropic-sdk-python releases', kind: 'atom', url: 'https://github.com/anthropics/anthropic-sdk-python/releases.atom' },
  { category: 'models',   name: 'HN: Anthropic/Claude',          kind: 'hn',   minPoints: 30, url: 'https://hn.algolia.com/api/v1/search_by_date?query=Anthropic%20Claude&tags=story&hitsPerPage=25' },
  { category: 'mcp',      name: 'MCP TypeScript SDK releases',   kind: 'atom', url: 'https://github.com/modelcontextprotocol/typescript-sdk/releases.atom' },
  { category: 'mcp',      name: 'MCP servers commits',           kind: 'atom', url: 'https://github.com/modelcontextprotocol/servers/commits/main.atom' },
  { category: 'mcp',      name: 'HN: MCP',                       kind: 'hn',   minPoints: 20, url: 'https://hn.algolia.com/api/v1/search_by_date?query=model%20context%20protocol&tags=story&hitsPerPage=25' },
  { category: 'patterns', name: 'n8n releases',                  kind: 'atom', url: 'https://github.com/n8n-io/n8n/releases.atom' },
  { category: 'patterns', name: 'HN: n8n / automation',          kind: 'hn',   minPoints: 20, url: 'https://hn.algolia.com/api/v1/search_by_date?query=n8n&tags=story&hitsPerPage=25' },
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
      for (const it of items) {
        const id = idOf(src.category, it.link, it.title);
        if (seen.has(id)) continue;
        seen.add(id);
        fresh.push({ date, category: src.category, source: src.name, item: it.title, link: it.link, id });
      }
    } catch (e) {
      failed.push(`${src.name} (${e.message})`);
      console.error(`landscape-monitor: source failed - ${src.name}: ${e.message}`);
    }
  }

  if (okSources === 0) {
    console.error(`landscape-monitor: ALL ${SOURCES.length} sources failed - nothing fetched. Failures: ${failed.join('; ')}`);
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
