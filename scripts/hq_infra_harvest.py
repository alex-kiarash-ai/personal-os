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
  * scheduled_jobs_active - enabled PersonalOS-* systemd user timers (from systemctl).
  * vault_pages           - vault/**/*.md count (excludes .obsidian/.trash), with sub-counts.

Any single source that fails degrades to skipping ITS metric with a stderr note (never a
fabricated 0) - the other metrics still ship. Exit code is 0 unless nothing could be read.
"""
import sys, json, subprocess, re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]           # scripts -> repo
VAULT = REPO / "vault"


def sh(cmd):
    """Run a command, return stdout text (or '' on failure). No shell, ever."""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60, shell=False)
        return r.stdout or ""
    except Exception as e:
        print(f"hq_infra_harvest: `{cmd[0]}` failed: {e}", file=sys.stderr)
        return ""


def resolve_claude():
    """Absolute path to the Claude CLI, or None.

    Ported from the Windows shim hunt 2026-08-05 (bash migration Phase 4, W2). It used to run
    `cmd /c claude mcp list` and fall back to `%APPDATA%\\npm\\claude.cmd`, neither of which
    exists on Linux. Same resolution order as resolve_claude() in scripts/lib/common.sh, so the
    Python and bash sides cannot disagree about which binary they mean.
    """
    import os
    import shutil
    override = os.environ.get("ALEX_CLAUDE_BIN")
    if override and Path(override).is_file():
        return override
    found = shutil.which("claude")
    if found:
        return found
    local = Path.home() / ".local" / "bin" / "claude"
    if local.is_file():
        return str(local)
    prefix = sh(["npm", "prefix", "-g"]).strip()
    if prefix:
        cand = Path(prefix) / "bin" / "claude"
        if cand.is_file():
            return str(cand)
    return None


# Anthropic-offered / optional connectors that are fine to leave unauthenticated: idle catalog
# entries, not things any automation depends on. Windsor.ai = a lapsed marketing-data trial;
# Microsoft 365 = a built-in claude.ai default connector never linked (Shaheen has no MS account).
# The Sunday auth-check.sh ignores these same two for exactly this reason ("never cry wolf"), so
# the tile mirrors that: only a CRITICAL connector (Notion/Gmail/Calendar/Drive/...) going
# unauthenticated is amber-worthy. (2026-07-21)
OPTIONAL_IDLE_MCP = ("windsor", "microsoft 365")


def count_mcp_servers():
    """Connected MCP servers from `claude mcp list`, plus which unauthenticated ones are the
    known-optional/idle catalog entries vs a real (critical) drop. None if the CLI can't be read."""
    claude = resolve_claude()
    if not claude:
        print("hq_infra_harvest: claude CLI not found - skipping the mcp_tools metric", file=sys.stderr)
        return None
    out = sh([claude, "mcp", "list"])
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
    """Enabled PersonalOS-* systemd user timers. None if systemctl can't be read.

    Ported from schtasks 2026-08-05 (bash migration Phase 4). `list-unit-files` is the right
    source rather than `list-timers`: it reports every installed timer WITH its enablement
    state, so the two jobs that are Disabled by design (sprint-tracker, whatsapp-harvest) are
    counted in `total` but not in `enabled` - exactly the distinction the Windows version drew
    from the Status: line, and exactly what makes the HQ tile honest instead of alarming.

    Returning None on an unreadable scheduler is deliberate and unchanged: this metric degrades
    to ABSENT, never to a fabricated 0. A 0 here would read as "the whole job train is dead".
    """
    out = sh(["systemctl", "--user", "list-unit-files", "--no-pager", "--no-legend",
              "PersonalOS-*.timer"])
    if not out.strip():
        return None
    enabled = 0
    total = 0
    for line in out.splitlines():
        parts = line.split()
        if len(parts) < 2 or not parts[0].startswith("PersonalOS-"):
            continue
        if parts[0].startswith("PersonalOS-retry-"):
            continue  # ephemeral one-shots, excluded on every side (same as recovery C7)
        total += 1
        if parts[1].strip().lower() == "enabled":
            enabled += 1
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
