// read-sources.js - loads every source of truth into ONE in-memory model (refactor P1-S3).
// Sources: soul.md, CLAUDE.md, brand/config/*, system/manifest.json, scheduler/schedule.md.
// Fails loudly on any missing file or parse error; the generator aborts before staging anything.
// The parse helpers here are THE contracts Phase 3 validation reuses (V1 counts, V2 jobs, V4 MCPs,
// V5 tokens), so generator and validator can never disagree about how a source is read.
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');

function read(rel) {
  const p = path.join(REPO, rel);
  if (!fs.existsSync(p)) throw new Error(`read-sources: missing required source ${rel}`);
  return fs.readFileSync(p, 'utf8');
}

// --- scheduler/schedule.md -> job entries + the full PersonalOS-* job-name set -------------------
// Entries are "### Heading" sections carrying "- Command:" and "- Frequency:" lines.
// Job names are every PersonalOS-<x> token anywhere in the file (the prose carries them), minus the
// ephemeral PersonalOS-retry-* one-shots (excluded by design, same as recovery check C7).
function parseScheduleJobs(scheduleMd) {
  const entries = [];
  const parts = scheduleMd.split(/^### /m).slice(1);
  for (const part of parts) {
    const lines = part.split(/\r?\n/);
    const name = lines[0].trim();
    const cmd = part.match(/^- Command:\s*(.+)$/m);
    const freq = part.match(/^- Frequency:\s*(.+)$/m);
    entries.push({
      name,
      command: cmd ? cmd[1].trim() : null,
      frequency: freq ? freq[1].trim() : null,
      jobNames: [...new Set((part.match(/PersonalOS-[A-Za-z0-9-]+/g) || []))].filter(j => !j.startsWith('PersonalOS-retry-')),
    });
  }
  const allJobNames = [...new Set((scheduleMd.match(/PersonalOS-[A-Za-z0-9-]+/g) || []))]
    .filter(j => !j.startsWith('PersonalOS-retry-')).sort();
  if (entries.length === 0) throw new Error('read-sources: scheduler/schedule.md has no "### " entries');
  return { entries, allJobNames };
}

// --- CLAUDE.md "## MCP Reference" -> the MCP surface names ---------------------------------------
// Contract (shared with Phase 3 V4): bold lead entries of the section, descriptor stripped at the
// first " - " or ":", guidance lines starting with "MCP " excluded, entries sharing a first word
// collapsed to that word (the three "Notion ..." entries -> "Notion").
function parseMcpList(claudeMd) {
  const m = claudeMd.match(/^## MCP Reference$([\s\S]*?)(?=^## )/m);
  if (!m) throw new Error('read-sources: CLAUDE.md has no "## MCP Reference" section');
  const names = [];
  for (const line of m[1].split(/\r?\n/)) {
    const b = line.match(/^\*\*(.+?)\*\*/);
    if (!b) continue;
    let name = b[1].split(' - ')[0].split(':')[0].trim().replace(/\.$/, '');
    if (/^MCP\b/.test(name)) continue; // guidance lines, not tool surfaces
    names.push(name);
  }
  const byFirst = new Map();
  for (const n of names) {
    const first = n.split(/\s+/)[0];
    if (!byFirst.has(first)) byFirst.set(first, []);
    byFirst.get(first).push(n);
  }
  const out = [];
  for (const [first, group] of byFirst) out.push(group.length > 1 ? first : group[0]);
  if (out.length === 0) throw new Error('read-sources: MCP Reference parse produced zero entries');
  return out;
}

// --- brand/config/color-system.md -> token table (name -> hex) -----------------------------------
// Source of the token law for Phase 3 V5 ("no hex outside the law file that matches no token").
// Reads the "## 2. The Palette" table plus the extended-palette table and the semantic extras
// that appear as inline hexes in the law file's own prose/tokens (e.g. #00232e, #fff5e1, #ffffff).
function parseColorTokens(colorSystemMd) {
  const tokens = new Map();
  const rowRe = /^\|\s*\d+\s*\|\s*([^|]+?)\s*\|\s*`(#[0-9a-fA-F]{6})`\s*\|/gm;
  let m;
  while ((m = rowRe.exec(colorSystemMd)) !== null) tokens.set(m[1].trim(), m[2].toLowerCase());
  const extRe = /^\|\s*([A-Z][^|]+?)\s*\|\s*`(#[0-9a-fA-F]{6})`\s*\|/gm;
  while ((m = extRe.exec(colorSystemMd)) !== null) if (!tokens.has(m[1].trim())) tokens.set(m[1].trim(), m[2].toLowerCase());
  // every other hex the law file itself defines (semantic values like elevated surfaces, white)
  const all = new Set([...tokens.values()]);
  for (const hx of colorSystemMd.match(/#[0-9a-fA-F]{6}\b/g) || []) all.add(hx.toLowerCase());
  if (tokens.size === 0) throw new Error('read-sources: color-system.md palette table parse produced zero tokens');
  return { tokens, allHexes: all };
}

// --- counts (Phase 3 V1 contract) ----------------------------------------------------------------
// AUTOMATION_COUNT = non-retired NUMBERED projects; LIVE_COUNT = those in state LIVE.
// Unnumbered systems (meta.unnumbered) are listed but not counted here.
function computeCounts(manifest) {
  const nonRetired = manifest.projects.filter(p => p.state !== 'RETIRED');
  return {
    automationCount: nonRetired.length,
    liveCount: nonRetired.filter(p => p.state === 'LIVE').length,
    retiredCount: manifest.projects.length - nonRetired.length,
    unnumberedCount: (manifest.meta.unnumbered || []).length,
  };
}

function loadModel() {
  const model = { repo: REPO };
  model.soul = read('soul.md');
  model.claudeMd = read('CLAUDE.md');
  model.colorSystem = read('brand/config/color-system.md');
  model.brandConfig = read('brand/config/brand-config.md');
  const manifestRaw = read('system/manifest.json');
  try {
    model.manifest = JSON.parse(manifestRaw);
  } catch (e) {
    throw new Error(`read-sources: system/manifest.json is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(model.manifest.projects) || model.manifest.projects.length === 0)
    throw new Error('read-sources: system/manifest.json has no projects[]');
  if (!model.manifest.meta || !Array.isArray(model.manifest.meta.unnumbered))
    throw new Error('read-sources: system/manifest.json meta.unnumbered missing');
  if (!model.soul.includes('## My Words'))
    throw new Error('read-sources: soul.md has no "## My Words" section (the voice sync needs it)');
  if (!model.soul.includes('## Voice Rules'))
    throw new Error('read-sources: soul.md has no "## Voice Rules" section (the voice sync needs it)');
  model.scheduleMd = read('scheduler/schedule.md');
  model.schedule = parseScheduleJobs(model.scheduleMd);
  model.mcpList = parseMcpList(model.claudeMd);
  model.colorTokens = parseColorTokens(model.colorSystem);
  model.counts = computeCounts(model.manifest);
  return model;
}

module.exports = { REPO, loadModel, parseScheduleJobs, parseMcpList, parseColorTokens, computeCounts };
