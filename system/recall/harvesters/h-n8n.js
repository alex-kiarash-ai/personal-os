'use strict';
/* h-n8n - per-engine facts, sourced from the manifest's structured routing contract + the existing
 * n8n active-flag watcher LOG (scripts/n8n-active-check.mjs -> outputs/logs/n8n-active-check.log).
 * NEVER a new API call (plan constraint): the daily watcher already probes; this reads its last
 * result. Emits, per LIVE workflow-bearing project: expected-active + resolved model, and the last
 * OBSERVED active result if the log's tail is parseable. Model is resolved from model_routing so a
 * per-engine doc claim can be tested without re-deriving the contract. */
const fs = require('fs');
const path = require('path');

/*
 * A17-T-19 (2026-09-11): the DEPLOYED n8n version, from the only thing that actually reads it.
 *
 * "n8n 2.30.3" is restated in three owner docs and was verifiable by nobody: no read-only path
 * could re-derive it, so all three could drift together and stay agreeing with each other. The
 * proposed fix was a new C-check shelling to the box, but that call already exists - the
 * landscape-monitor's deployed self-probe ssh's in daily and writes the version into
 * system/landscape-log.jsonl. It was simply never plumbed anywhere a check could reach.
 *
 * The fact carries the probe's DATE as its own subject, because a version read six weeks ago is
 * not a current fact and a reader deserves to see which. The probe going blind is its own finding
 * (A08-T-05, which now escalates past 7 days), and this makes the staleness visible rather than
 * silently serving an old number as though it were today's.
 */
const SPLIT_LINES = new RegExp(String.fromCharCode(92) + 'r?' + String.fromCharCode(92) + 'n');

function deployedN8nVersion(REPO) {
  try {
    const lines = fs.readFileSync(path.join(REPO, 'system', 'landscape-log.jsonl'), 'utf8')
      .split(SPLIT_LINES).filter(Boolean);
    let newest = null;
    for (const ln of lines) {
      let o;
      try { o = JSON.parse(ln); } catch { continue; }
      if (o && o.category === 'deployed' && o.extra && o.extra.n8n_version) {
        if (!newest || String(o.date) > String(newest.date)) newest = o;
      }
    }
    return newest ? { version: String(newest.extra.n8n_version), probed: String(newest.date) } : null;
  } catch { return null; }
}

function harvest({ REPO }) {
  const m = JSON.parse(fs.readFileSync(path.join(REPO, 'system', 'manifest.json'), 'utf8'));
  const mr = (m.meta && m.meta.model_routing) || {};
  const overrides = {};
  for (const o of mr.overrides || []) overrides[o.workflow] = o.model;
  const facts = [];
  const dep = deployedN8nVersion(REPO);
  if (dep) {
    facts.push({ subject: 'n8n', predicate: 'deployed_version', object: dep.version,
      source: 'landscape-log deployed probe', harvester: 'h-n8n', aliases: ['n8n', 'n8n-version'] });
    facts.push({ subject: 'n8n', predicate: 'version_probed', object: dep.probed,
      source: 'landscape-log deployed probe', harvester: 'h-n8n', aliases: ['n8n', 'n8n-version'] });
  }

  for (const p of m.projects || []) {
    if (!p.n8n) continue;
    const subj = `engine:${p.n8n}`;
    const aliases = [p.name, p.n8n.toLowerCase()];
    const model = overrides[p.n8n] || mr.default || 'unknown';
    facts.push({ subject: subj, predicate: 'model', object: model, source: 'system/manifest.json:model_routing', harvester: 'h-n8n', aliases });
    facts.push({ subject: subj, predicate: 'active_expected', object: p.state === 'LIVE' ? 'true' : 'false', source: 'system/manifest.json', harvester: 'h-n8n', aliases });
    facts.push({ subject: subj, predicate: 'project', object: p.name, source: 'system/manifest.json', harvester: 'h-n8n', aliases });
  }

  // Best-effort: last observed n8n active-watcher verdict from its log tail (never a new call).
  const logf = path.join(REPO, 'outputs', 'logs', 'n8n-active-check.log');
  try {
    if (fs.existsSync(logf)) {
      const tail = fs.readFileSync(logf, 'utf8').split(/\r?\n/).filter(Boolean).slice(-40).join('\n');
      const verdict = /all expected-active workflows are ON|OK/i.test(tail) ? 'all-on'
        : /is OFF|RED|deactivated/i.test(tail) ? 'issue-detected' : null;
      if (verdict) facts.push({ subject: 'n8n', predicate: 'last_active_watch', object: verdict, source: 'outputs/logs/n8n-active-check.log', harvester: 'h-n8n', aliases: ['n8n'] });
    }
  } catch (_) { /* log unreadable - skip */ }

  return facts;
}

module.exports = { harvest };
