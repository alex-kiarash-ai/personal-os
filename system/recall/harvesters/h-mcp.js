'use strict';
/* h-mcp - facts about which MCP servers this machine actually has wired, and at what scope.
 *
 * WHY (A11-T-03, stress test 2026-09-04). vault/identity.md section 4 is the RESTORE-FIRST
 * document: the page a fresh clone reads to rebuild this machine. It names the MCP servers by
 * hand, and nothing ever compared that list to reality. The stress test found the section wrong
 * by name on five infrastructure claims at once, and the MCP list was one of them, because a
 * USER-scope server lives outside the repo entirely and a restore that does not re-add it comes
 * back silently missing a capability. The Cloudflare note in the constitution says exactly this
 * and had no enforcement behind it.
 *
 * SOURCE: `claude mcp list`, deliberately, NOT `~/.claude.json`. Security sweep S11 set that
 * precedent and it is the right one twice over: the CLI is the supported interface and stays
 * correct across config format changes, and reading the user config file directly is what blocked
 * a stress-test agent for eight hours on a permission prompt. Names and scope only, never a URL,
 * a command line or a token: this file feeds a ledger that other docs are tested against, and a
 * server's transport is not a fact identity.md is allowed to assert.
 *
 * SCOPE is derived, not parsed: a server named in the repo's .mcp.json is project scope, anything
 * else is user scope. That is the distinction that matters for restore (project scope arrives with
 * the clone, user scope does not).
 *
 * Fails SOFT. A missing or slow CLI yields no facts rather than a run-killing throw: the nightly
 * harvest runs seven of these and one unavailable tool must not take the ledger down. An empty
 * harvest supersedes nothing, so a bad night leaves yesterday's facts standing rather than
 * marking every server gone.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// "name: transport - ✔ Connected" / "claude.ai Gmail: https://... - ! Needs authentication".
// Only the part left of the first colon is taken, and the status is kept as its own fact so a
// server that has silently fallen out of auth is visible without storing the endpoint.
function parseList(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const ln = raw.trim();
    if (!ln || /^Checking MCP server health/i.test(ln)) continue;
    const m = ln.match(/^(.+?):\s+(.*?)\s+-\s+(.+)$/);
    if (!m) continue;
    const name = m[1].trim();
    if (!name || /^[-=\s]+$/.test(name)) continue;
    out.push({ name, connected: /connected/i.test(m[3]) });
  }
  return out;
}

/*
 * Invoking the CLI is platform work, not a one-liner. On this Windows box `claude` is a .cmd
 * shim: execFileSync('claude') is ENOENT because there is no bare executable, and
 * execFileSync('claude.cmd') is EINVAL because Node refuses to exec a batch file without a shell.
 * The first draft of this harvester silently returned zero facts for exactly that reason, which
 * is the failure mode this whole ledger exists to catch, produced while building it.
 *
 * Same shim class as A07-T9 (bootstrap.mjs cannot see a .cmd shim). The argv is fixed and carries
 * no interpolation, so the shell path introduces nothing to quote.
 */
function runCli(cwd) {
  const attempts = process.platform === 'win32'
    ? [{ cmd: 'claude mcp list', shell: true }, { cmd: 'claude', args: ['mcp', 'list'] }]
    : [{ cmd: 'claude', args: ['mcp', 'list'] }];
  for (const a of attempts) {
    try {
      const opts = { cwd, encoding: 'utf8', timeout: 60000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] };
      return a.shell
        ? require('child_process').execSync(a.cmd, opts)
        : execFileSync(a.cmd, a.args, opts);
    } catch { /* try the next shape */ }
  }
  return null;
}

function harvest({ REPO }) {
  const raw = runCli(REPO);
  if (!raw) return []; // fail soft: no facts beats wrong facts, and supersedes nothing

  const servers = parseList(raw);
  if (!servers.length) return [];

  let projectScoped = new Set();
  try {
    const p = path.join(REPO, '.mcp.json');
    if (fs.existsSync(p)) {
      projectScoped = new Set(Object.keys(JSON.parse(fs.readFileSync(p, 'utf8')).mcpServers || {}));
    }
  } catch { /* a malformed .mcp.json means scope is unknown, not project */ }

  const facts = [];
  const push = (subject, predicate, object) =>
    facts.push({ subject, predicate, object, source: 'claude mcp list', harvester: 'h-mcp', aliases: ['mcp', 'mcp-server', subject] });

  // CONNECTION STATE IS DELIBERATELY NOT A FACT. The first draft emitted one `reachable` row per
  // server and the test run caught an MCP server mid rate-limit, which is exactly the point: that
  // value flips for reasons that have nothing to do with this machine's configuration. This ledger
  // SUPERSEDES on change and aborts the whole nightly harvest above 20 supersessions
  // (harvest-core.js MAX_SUPERSEDE), so eighteen servers flapping overnight would take the ledger
  // down to report that somebody else's API was busy. Reachability is a monitoring question and
  // security-sweep S10 already probes surfaces. What belongs here is what a restore needs: who is
  // wired, and whether the clone brings them.
  for (const s of servers) {
    push(`mcp/${s.name}`, 'scope', projectScoped.has(s.name) ? 'project' : 'user');
  }
  push('mcp', 'count', String(servers.length));
  push('mcp', 'user_scope_count', String(servers.filter((s) => !projectScoped.has(s.name)).length));
  return facts;
}

module.exports = { harvest, parseList };
