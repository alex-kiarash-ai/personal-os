#!/usr/bin/env node
'use strict';
/*
 * mcp-table.js - the MCP inventory, GENERATED, never hand-kept.
 *
 * WHY (A12-T-07). vault/identity.md section 4 is the restore-first page and it named MCP servers in
 * prose, which the 2026-09-04 stress test found wrong: it missed mcp-server-for-revit and three
 * claude.ai connectors. The count is now guarded by C21 against the h-mcp facts, but a count does
 * not tell a person rebuilding this machine WHICH connectors to re-add.
 *
 * Writing the list into identity.md by hand would re-create the exact defect, so it is printed on
 * demand instead. The doc carries the count (guarded) and a pointer to this command; the list itself
 * is never stored anywhere it can go stale.
 *
 * Names and scope only, never a URL or a command line: a restore needs to know WHAT to re-add and
 * that it is user-scope, and this output is pasted into sessions.
 */
const { parseList } = require('./../system/recall/harvesters/h-mcp.js');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
let raw = '';
try {
  raw = execSync('claude mcp list', { cwd: REPO, encoding: 'utf8', timeout: 60000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
} catch {
  console.error('mcp-table: could not run `claude mcp list`.');
  process.exit(2);
}
let projectScoped = new Set();
try {
  const p = path.join(REPO, '.mcp.json');
  if (fs.existsSync(p)) projectScoped = new Set(Object.keys(JSON.parse(fs.readFileSync(p, 'utf8')).mcpServers || {}));
} catch { /* unreadable = scope unknown, not project */ }

const servers = parseList(raw);
const w = Math.max(4, ...servers.map((s) => s.name.length));
console.log(`| ${'Name'.padEnd(w)} | Scope   | Reachable | Re-add on restore |`);
console.log(`|${'-'.repeat(w + 2)}|---------|-----------|-------------------|`);
for (const s of servers) {
  const scope = projectScoped.has(s.name) ? 'project' : 'user';
  const readd = scope === 'project' ? 'arrives with the clone' : 'claude mcp add --scope user ...';
  console.log(`| ${s.name.padEnd(w)} | ${scope.padEnd(7)} | ${(s.connected ? 'yes' : 'NO').padEnd(9)} | ${readd} |`);
}
console.log('');
console.log(`${servers.length} server(s), ${servers.filter((s) => !projectScoped.has(s.name)).length} at USER scope.`);
console.log('User scope lives in ~/.claude.json, which is outside BOTH the git backup and the encrypted');
console.log('vault tar, so a restore brings back none of them. Reachability is a live probe, not a fact:');
console.log('a "NO" here can just mean an API is busy, which is why it is printed and never stored.');
