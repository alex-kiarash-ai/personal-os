#!/usr/bin/env node
// scripts/personal-crm-core.js
// The zero-token deterministic core of the Personal CRM Monday run (upgrade P3, design #05 row).
//
// WHY: three straight Mondays died whole on quota/auth (06-26 -> 07-08 class), taking the follow-up
// LIST down with them - the one Monday deliverable that matters. This core computes the list from
// the vault alone (no Claude, no Notion, no Gmail) so Monday is never dark. Scoring, Msgs-90d,
// status, Notion sync and drafts stay in the (quota-gated) Claude pass, which can refine this list.
//
// INPUTS (all local):
//   vault/people/{category}/*.md frontmatter: channel, last_contact, tags (folder = category)
//   work/05-personal-crm/state/cadence.json  OPTIONAL per-contact cadence override, written by the
//     full Claude pass when it computes real status-aware Cadence Days ({"<basename>": days}).
//     Absent-tolerant: without it the core uses the spec's channel/category DEFAULTS (below).
//
// CADENCE DEFAULTS (from work/05-personal-crm/CLAUDE.md step 3; the override file wins):
//   whatsapp / linkedin / in-person / mixed-personal -> 45 (the SOFT personal cadence; recency is
//     "last logged, unverified" - the list line is gentle, never "gone quiet")
//   email + professional folder (recruiters/prospects/clients/colleagues/network) -> 30
//   email + personal folder (friends/family/relationships) -> 45
//   last_contact unknown -> data-gap line, never a due line.
//
// OUTPUTS: work/05-personal-crm/state/monday-list.md (the list, always written) +
//   HQ push crm/run_status GREEN "core: N contacts, M past cadence" (unless --dry-run).
// Exit 0 = core succeeded (even with 0 due). Exit 1 = real failure (vault unreadable etc.).

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const PEOPLE = path.join(ROOT, 'vault', 'people');
const STATE_DIR = path.join(ROOT, 'work', '05-personal-crm', 'state');
const LIST = path.join(STATE_DIR, 'monday-list.md');
const OVERRIDES = path.join(STATE_DIR, 'cadence.json');
const HQ_TOKEN = path.join(ROOT, 'work', '16-alex-hq', 'config', 'alex-hq-token.txt');
const DRY = process.argv.includes('--dry-run');

const PRO_FOLDERS = ['recruiters', 'prospects', 'clients', 'colleagues', 'network'];
const SOFT_CHANNELS = ['whatsapp', 'linkedin', 'in-person', 'in person'];

function frontmatter(txt) {
  const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+?)\s*$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return fm;
}

function daysSince(dateStr) {
  const t = new Date(dateStr + 'T00:00:00').getTime();
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

let overrides = {};
try { overrides = JSON.parse(fs.readFileSync(OVERRIDES, 'utf8')); } catch (_) { /* absent-tolerant */ }

const contacts = [];
const gaps = [];
for (const dir of fs.readdirSync(PEOPLE, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  for (const f of fs.readdirSync(path.join(PEOPLE, dir.name))) {
    if (!f.endsWith('.md') || f.startsWith('_') || f === 'index.md') continue;
    const base = f.replace(/\.md$/, '');
    const fm = frontmatter(fs.readFileSync(path.join(PEOPLE, dir.name, f), 'utf8'));
    const channel = (fm.channel || 'unknown').toLowerCase();
    const soft = SOFT_CHANNELS.includes(channel) || (channel === 'mixed' && !PRO_FOLDERS.includes(dir.name));
    const cadence = Number.isInteger(overrides[base]) ? overrides[base]
      : soft ? 45
      : PRO_FOLDERS.includes(dir.name) ? 30
      : 45;
    if (!fm.last_contact || fm.last_contact === 'unknown') {
      gaps.push({ base, folder: dir.name, channel });
      continue;
    }
    const days = daysSince(fm.last_contact);
    if (days === null) { gaps.push({ base, folder: dir.name, channel, bad_date: fm.last_contact }); continue; }
    contacts.push({ base, folder: dir.name, channel, soft, days, cadence, last: fm.last_contact });
  }
}

const due = contacts.filter(c => c.days > c.cadence).sort((a, b) => (b.days - b.cadence) - (a.days - a.cadence));
const today = new Date().toISOString().slice(0, 10);

const lines = [];
lines.push(`# Monday follow-up list (deterministic core) - ${today}`);
lines.push('');
lines.push(`Computed from vault/people frontmatter alone (${contacts.length} dated contacts, ${gaps.length} data-gaps).`);
lines.push(`Cadence: overrides from state/cadence.json where present, else spec defaults (soft 45 / pro-email 30 / personal-email 45).`);
lines.push(`The Claude pass refines this (scores, Msgs 90d, Notion sync, gated drafts); if it was quota-skipped, THIS list stands.`);
lines.push('');
if (!due.length) lines.push('Nothing past cadence this week.');
for (const c of due) {
  if (c.soft) {
    lines.push(`- [gentle] Been a while since you logged contact with ${c.base} (${c.channel}, ${c.folder}): last logged ${c.last} (${c.days}d, soft cadence ${c.cadence}d). Ping them or say \`talked ${c.base}\`. Recency is last-logged, unverified - never "gone quiet".`);
  } else {
    lines.push(`- [due] ${c.base} (${c.channel}, ${c.folder}): ${c.days}d since ${c.last}, cadence ${c.cadence}d.`);
  }
}
if (gaps.length) {
  lines.push('');
  lines.push(`Data-gaps (no usable last_contact, never listed as due): ${gaps.map(g => g.base).join(', ')}`);
}
lines.push('');

try {
  if (!DRY) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(LIST, lines.join('\n'), 'utf8');
    // verify-after-write
    if (!fs.readFileSync(LIST, 'utf8').includes(today)) { console.error('crm-core: list write verify FAILED'); process.exit(1); }
  }
  console.log(`crm-core: ${contacts.length} contacts, ${due.length} past cadence, ${gaps.length} data-gaps${DRY ? ' (dry-run, nothing written)' : ' -> ' + path.relative(ROOT, LIST)}`);
} catch (e) { console.error('crm-core FAILED: ' + e.message); process.exit(1); }

// HQ green push (best-effort, never fails the core)
if (!DRY && fs.existsSync(HQ_TOKEN)) {
  const body = JSON.stringify({ events: [{ project: 'crm', metric_key: 'run_status', value_num: 1, status: 'green', headline: `core: ${contacts.length} contacts, ${due.length} past cadence (${today})` }] });
  const req = https.request('https://n8n.shaheenkiarash.com/webhook/alex-push', {
    method: 'POST', timeout: 10000,
    headers: { 'Content-Type': 'application/json', 'X-Alex-Token': fs.readFileSync(HQ_TOKEN, 'utf8').trim() }
  }, res => { console.log(`crm-core: HQ push ${res.statusCode}`); });
  req.on('error', e => console.log('crm-core: HQ push failed (non-fatal): ' + e.message));
  req.on('timeout', () => { req.destroy(); console.log('crm-core: HQ push timeout (non-fatal)'); });
  req.end(body);
}
