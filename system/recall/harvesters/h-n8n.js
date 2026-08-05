'use strict';
/* h-n8n - per-engine facts, sourced from the manifest's structured routing contract + the existing
 * n8n active-flag watcher LOG (scripts/n8n-active-check.mjs -> outputs/logs/n8n-active-check.log).
 * NEVER a new API call (plan constraint): the daily watcher already probes; this reads its last
 * result. Emits, per LIVE workflow-bearing project: expected-active + resolved model, and the last
 * OBSERVED active result if the log's tail is parseable. Model is resolved from model_routing so a
 * per-engine doc claim can be tested without re-deriving the contract. */
const fs = require('fs');
const path = require('path');

function harvest({ REPO }) {
  const m = JSON.parse(fs.readFileSync(path.join(REPO, 'system', 'manifest.json'), 'utf8'));
  const mr = (m.meta && m.meta.model_routing) || {};
  const overrides = {};
  for (const o of mr.overrides || []) overrides[o.workflow] = o.model;
  const facts = [];

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
