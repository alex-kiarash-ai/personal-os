#!/usr/bin/env python3
"""Deterministic local infra harvest for Alex HQ.

Built 2026-07-21 to end the class of failure where the /alex-hq harvest asked the
(headless, terse) model to COUNT things it can no longer see: MCP tools went DEFERRED in
the harness (load-on-demand), so the model started reporting `mcp_tools=0/"unknown"` from
07-17 (was 91-94 daily); the scheduled-jobs count likewise drifted to 0. The fix: never
ask the model to introspect its own toolset or the OS. Count everything here, from real
sources, and emit ready-to-push Alex HQ metric events on stdout (one JSON array line).

Emits three infra metrics:
  * mcp_tools             - CONNECTED MCP servers (from `claude mcp list`), value_text names
                            how many need re-auth. Deliberately switched from tool-name
                            counting to server counting on 2026-07-21: tool names cannot be
                            counted deterministically once tools are deferred, and "N servers
                            connected, K need auth" is both stable and more actionable.
  * scheduled_jobs_active - enabled PersonalOS-* Windows scheduled tasks (from schtasks).
  * vault_pages           - vault/**/*.md count (excludes .obsidian/.trash), with sub-counts.

Any single source that fails degrades to skipping ITS metric with a stderr note (never a
fabricated 0) - the other metrics still ship. Exit code is 0 unless nothing could be read.
"""
import sys, json, subprocess, re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]           # scripts -> repo
VAULT = REPO / "vault"


def sh(cmd):
    """Run a command, return stdout text (or '' on failure). Windows-friendly."""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60, shell=False)
        return r.stdout or ""
    except Exception as e:
        print(f"hq_infra_harvest: `{cmd[0]}` failed: {e}", file=sys.stderr)
        return ""


# Anthropic-offered / optional connectors that are fine to leave unauthenticated: idle catalog
# entries, not things any automation depends on. Windsor.ai = a lapsed marketing-data trial;
# Microsoft 365 = a built-in claude.ai default connector never linked (Shaheen has no MS account).
# The Sunday auth-check.ps1 ignores these same two for exactly this reason ("never cry wolf"), so
# the tile mirrors that: only a CRITICAL connector (Notion/Gmail/Calendar/Drive/...) going
# unauthenticated is amber-worthy. (2026-07-21)
OPTIONAL_IDLE_MCP = ("windsor", "microsoft 365")


def count_mcp_servers():
    """Connected MCP servers from `claude mcp list`, plus which unauthenticated ones are the
    known-optional/idle catalog entries vs a real (critical) drop. None if the CLI can't be read."""
    # claude is a .ps1/.cmd shim on Windows; resolve via the shell so PATH + shim work.
    out = sh(["cmd", "/c", "claude", "mcp", "list"])
    if not out.strip():
        # Fallback: some environments expose it only through the APPDATA npm shim.
        out = sh(["cmd", "/c", "%APPDATA%\\npm\\claude.cmd", "mcp", "list"])
    if not out.strip():
        return None
    # Lines look like: "  name: URL - ✔ Connected"  /  "  name: URL - ! Needs authentication"
    connected = 0
    optional_unauth, critical_unauth = [], []
    total = 0
    for line in out.splitlines():
        if " - " not in line or ":" not in line:
            continue
        total += 1
        left, status = line.rsplit(" - ", 1)
        name = left.split(":")[0].strip()
        if re.search(r"Connected", status, re.I):
            connected += 1
        elif re.search(r"Needs authentication|failed to connect|✘", status, re.I):
            (optional_unauth if any(o in name.lower() for o in OPTIONAL_IDLE_MCP)
             else critical_unauth).append(name)
    if connected == 0 and total == 0:
        return None
    return {"connected": connected, "total": total,
            "optional_unauth": optional_unauth, "critical_unauth": critical_unauth}


def count_scheduled_jobs():
    """Enabled PersonalOS-* Windows scheduled tasks. None if schtasks can't be read."""
    out = sh(["schtasks", "/query", "/fo", "LIST"])
    if not out.strip():
        return None
    # Pair each "TaskName:" with the following "Status:" line, keep PersonalOS-* only.
    name = None
    enabled = 0
    total = 0
    for line in out.splitlines():
        s = line.strip()
        if s.startswith("TaskName:"):
            name = s.split(":", 1)[1].strip()
        elif s.startswith("Status:") and name and "\\PersonalOS-" in name:
            total += 1
            if s.split(":", 1)[1].strip().lower() != "disabled":
                enabled += 1
            name = None
    if total == 0:
        return None
    return {"enabled": enabled, "total": total}


def count_vault_pages():
    md = [p for p in VAULT.rglob("*.md")
          if ".obsidian" not in p.parts and ".trash" not in p.parts]
    if not md:
        return None
    def sub(folder):
        return sum(1 for p in md if folder in p.parts)
    return {"total": len(md), "people": sub("people"), "business": sub("business"),
            "research": sub("research"), "projects": sub("projects")}


def main():
    events = []
    any_ok = False

    mcp = count_mcp_servers()
    if mcp is not None:
        any_ok = True
        conn = mcp["connected"]
        opt, crit = mcp["optional_unauth"], mcp["critical_unauth"]
        vt = f"{conn} connected"
        if crit:
            vt += f" · {len(crit)} NEED AUTH"
        if opt:
            vt += f" · {len(opt)} optional idle"
        if crit:
            hl = f"{conn} MCP servers connected, {len(crit)} critical need re-auth: {', '.join(crit)}"
        elif opt:
            hl = f"{conn} MCP servers connected · {len(opt)} optional idle ({', '.join(opt)}), not needed"
        else:
            hl = f"{conn} MCP servers connected, all healthy"
        events.append({
            "project": "infra", "metric_key": "mcp_tools",
            "value_num": conn,
            "value_text": vt,
            "headline": hl,
            # only a CRITICAL connector dropping is amber; idle optional catalog entries stay green
            "status": "amber" if crit else "green",
        })

    jobs = count_scheduled_jobs()
    if jobs is not None:
        any_ok = True
        events.append({
            "project": "infra", "metric_key": "scheduled_jobs_active",
            "value_num": jobs["enabled"],
            "value_text": f"{jobs['enabled']} of {jobs['total']} enabled",
            "headline": f"{jobs['enabled']} PersonalOS jobs enabled",
            "status": "green" if jobs["enabled"] > 0 else "red",
        })

    vp = count_vault_pages()
    if vp is not None:
        any_ok = True
        events.append({
            "project": "infra", "metric_key": "vault_pages",
            "value_num": vp["total"],
            "value_text": f"pages: {vp['total']}",
            "headline": f"{vp['total']} vault pages "
                        f"({vp['people']} people · {vp['business']} business · {vp['research']} research)",
            "status": "green",
        })

    print(json.dumps(events))
    if not any_ok:
        print("hq_infra_harvest: every source failed", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
