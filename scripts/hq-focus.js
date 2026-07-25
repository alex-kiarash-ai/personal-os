#!/usr/bin/env node
/*
 * hq-focus.js - the Alex HQ "one glance, one decision" focus slot (#16 Phase 1, 2026-07-25).
 *
 * A personal dashboard's only real job is to answer "what should Shaheen do NEXT". This computes that
 * single highest-leverage item with a DETERMINISTIC rule stack (zero Claude calls), reusing the canonical
 * summary commands so the logic never forks:
 *   1. a CRITICAL red (cost tripwire red, or a critical human-action)   -> the fire, handle first
 *   2. the oldest human-action PAST ITS SLA (critical 0d / high 3d / medium 7d / low 14d)
 *   3. the oldest waiting-on-them thread (someone owes Shaheen a reply)
 *   4. a loop-status milestone (the outcome-loop winner gate just cleared -> activate the moat)
 *
 * Focus-trap rider (the anti-nag): HQ must not fixate on the same item day after day. If the chosen focus
 * has the SAME stable key + status as last run (no state change), it is demoted to the next candidate, so
 * a stuck item does not monopolize the one slot. State: work/16-alex-hq/state/last-focus.json.
 *
 * Output: prints the focus line; writes work/16-alex-hq/state/focus.json (read by the HQ render + the
 * brief). Best-effort HQ push (metric_key 'focus') when the token is present. Never throws on a missing
 * input - a source that isn't there simply yields no candidate from that tier.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const STATE_DIR = path.join(REPO, 'work', '16-alex-hq', 'state');
const LAST = path.join(STATE_DIR, 'last-focus.json');
const FOCUS = path.join(STATE_DIR, 'focus.json');
const HQ_TOKEN = path.join(REPO, 'work', '16-alex-hq', 'config', 'alex-hq-token.txt');
const SLA = { critical: 0, high: 3, medium: 7, low: 14 };

function tryJSON(cmd) { try { return JSON.parse(execSync(cmd, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] }).toString()); } catch { return null; } }
function tryLine(cmd) { try { return execSync(cmd, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } }

// top open human-action (stable id + severity + age) - minimal loader, latest-per-id wins.
function topHumanAction() {
  const f = path.join(REPO, 'system', 'human-actions.jsonl');
  if (!fs.existsSync(f)) return null;
  const byId = new Map();
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const t = line.trim(); if (!t) continue;
    let r; try { r = JSON.parse(t); } catch { continue; }
    if (r.done) byId.delete(r.id); else byId.set(r.id, r);
  }
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  const open = [...byId.values()].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9) || a.created.localeCompare(b.created));
  if (!open.length) return null;
  const top = open[0];
  const age = Math.floor((Date.now() - new Date(top.created + 'T00:00:00').getTime()) / 86400000);
  return { id: top.id, severity: top.severity, age, what: top.what };
}

function buildCandidates() {
  const c = [];
  // tier 1: cost tripwire red
  let cost = null; try { cost = JSON.parse(fs.readFileSync(path.join(REPO, 'system', 'cost-tripwires.json'), 'utf8')); } catch {}
  const red = cost && (cost.tripwires || []).find(t => t.severity === 'red');
  if (red) c.push({ tier: 1, key: `cost:${red.project}`, status: 'red', text: `Cost RED: ${red.project} at ${red.pct}% of budget (day ${red.day}). Cut or raise the budget.` });

  const ha = topHumanAction();
  // tier 1: a critical human-action is also a "fire"
  if (ha && ha.severity === 'critical') c.push({ tier: 1, key: `ha:${ha.id}`, status: 'red', text: `CRITICAL waiting-on-you: ${ha.what.slice(0, 90)} (${ha.age}d).` });
  // tier 2: oldest human-action past its SLA
  if (ha && ha.severity !== 'critical' && ha.age >= (SLA[ha.severity] ?? 7)) c.push({ tier: 2, key: `ha:${ha.id}`, status: 'amber', text: `Past SLA: ${ha.what.slice(0, 90)} (${ha.severity}, ${ha.age}d).` });

  // tier 3: oldest waiting-on-them
  const wot = tryJSON('node scripts/waiting-on-them.js summary');
  if (wot && wot.open_count > 0) c.push({ tier: 3, key: `wot:oldest`, status: 'amber', text: `Follow up: ${wot.headline} owes you a reply.` });

  // tier 4: loop-status milestone (gate cleared)
  const loop = tryLine('node scripts/alex-outcome-loop.js loopstatus');
  if (/gate CLEARED/i.test(loop)) c.push({ tier: 4, key: `loop:gate`, status: 'green', text: `Moat ready: outcome-loop gate cleared - activate winners (see outcome-loop-activation-runbook.md).` });

  return c.sort((a, b) => a.tier - b.tier);
}

function readLast() { try { return JSON.parse(fs.readFileSync(LAST, 'utf8')); } catch { return null; } }

function main() {
  const candidates = buildCandidates();
  let focus = candidates[0] || { tier: 9, key: 'none', status: 'green', text: 'Nothing on fire. Ship the next thing on the plan.' };
  const last = readLast();
  // focus-trap: same item + same status as last run with more than one candidate -> show the next one.
  if (last && last.key === focus.key && last.status === focus.status && candidates.length > 1) {
    focus = candidates[1];
  }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const out = { generated: new Date().toISOString(), key: focus.key, status: focus.status, tier: focus.tier, text: focus.text };
  fs.writeFileSync(FOCUS, JSON.stringify(out, null, 2), 'utf8');
  fs.writeFileSync(LAST, JSON.stringify({ key: focus.key, status: focus.status, date: new Date().toISOString().slice(0, 10) }), 'utf8');
  console.log(`HQ focus [${focus.status.toUpperCase()}]: ${focus.text}`);

  // best-effort HQ push
  if (fs.existsSync(HQ_TOKEN) && !process.argv.includes('--no-push')) {
    const body = JSON.stringify({ events: [{ project: 'alex-hq', metric_key: 'focus', value_num: focus.tier, status: focus.status, headline: focus.text.slice(0, 120) }] });
    const req = https.request('https://n8n.shaheenkiarash.com/webhook/alex-push', { method: 'POST', timeout: 10000,
      headers: { 'Content-Type': 'application/json', 'X-Alex-Token': fs.readFileSync(HQ_TOKEN, 'utf8').trim() } },
      res => console.log(`HQ focus push: ${res.statusCode}`));
    req.on('error', e => console.log('HQ focus push failed (non-fatal): ' + e.message));
    req.on('timeout', () => { req.destroy(); console.log('HQ focus push timeout (non-fatal)'); });
    req.end(body);
  }
}
main();
