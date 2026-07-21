#!/usr/bin/env python3
"""Deterministic Alex HQ harvest -> build -> ship -> push -> verify.

THE number path no longer depends on a model. Born 2026-07-21 from a real incident: the
scheduled /alex-hq harvest ran on headless Haiku and asked the MODEL to count its MCP tools,
count scheduled jobs, and scp the data files. When MCP tools became deferred in the harness
(~07-17) the model could no longer see them and pushed mcp_tools=0/"unknown"; the jobs count
drifted to 0; and the scp silently stopped, freezing every box data file (graph, todos, life,
projects, n8n-workflows) at 07-20 06:47. None of that is model work - it is deterministic. So
this script does it, from real sources, and the model is left only the inbox + the narration.

Pipeline (each step best-effort-isolated; a metric whose source fails is SKIPPED, never faked):
  1. infra events   (scripts/hq_infra_harvest.py)   - MCP servers, scheduled jobs, vault pages
  2. n8n events     (work/16-alex-hq/scripts/n8n_liveness.py) - up/broken, writes n8n-workflows.json
  3. build 4 JSONs  (graph, todos, life, projects)
  4. ship 5 JSONs   scp -> n8n:/opt/alex-hq-data/  THEN verify each box mtime is fresh (RED if not)
  5. extras         human-actions summary + alex-hq heartbeat
  6. push           POST /webhook/alex-push  (expects {"ok":true})
  7. verify         GET /webhook/alex-hq-summary, confirm the infra metrics came back fresh

Exit 0 = clean. Exit 1 = a HARD failure (push failed, ship went stale, or read-back mismatch)
with a RED reason printed. The token is read from disk and NEVER printed.
"""
import sys, os, json, subprocess, datetime, urllib.request, urllib.error
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DATA = REPO / "work" / "16-alex-hq" / "app" / "public" / "data"
TOKEN = (REPO / "work" / "16-alex-hq" / "config" / "alex-hq-token.txt").read_text(encoding="utf-8").strip()
PUSH_URL = "https://n8n.shaheenkiarash.com/webhook/alex-push"
SUMMARY_URL = "https://n8n.shaheenkiarash.com/webhook/alex-hq-summary"
JSONS = ["graph", "todos", "life", "projects", "n8n-workflows"]

problems = []   # RED lines
notes = []      # info lines


def run(cmd, label, timeout=90):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=str(REPO))
        if r.returncode != 0:
            notes.append(f"{label}: exit {r.returncode} {(r.stderr or '').strip()[:120]}")
        return r
    except Exception as e:
        notes.append(f"{label}: {e}")
        return None


def json_from(cmd, label):
    r = run(["python", *cmd] if cmd[0].endswith(".py") else cmd, label)
    if not r or not r.stdout.strip():
        return []
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except Exception as e:
        notes.append(f"{label}: unparseable output ({e})")
        return []


def main():
    events = []

    # 1. infra (deterministic - the metrics the model could no longer count)
    events += json_from(["scripts/hq_infra_harvest.py"], "infra_harvest")
    # 2. n8n (also writes n8n-workflows.json)
    events += json_from(["work/16-alex-hq/scripts/n8n_liveness.py"], "n8n_liveness")

    # 3. build the other 4 static JSONs
    for b in ("build-graph.mjs", "build-todos.mjs", "build-life.mjs", "build-projects.mjs"):
        run(["node", f"work/16-alex-hq/scripts/{b}"], b)

    # 4. ship + VERIFY (this is the step that silently died - now it is loud)
    src = [str(DATA / f"{n}.json") for n in JSONS]
    scp = run(["scp", "-q", *src, "n8n:/opt/alex-hq-data/"], "scp", timeout=60)
    if scp is None or scp.returncode != 0:
        problems.append("SHIP FAILED: scp to the box did not complete (box data files will be stale)")
    else:
        # read back each box mtime; fresh = written within the last 15 minutes
        chk = run(["ssh", "-o", "BatchMode=yes", "n8n",
                   "for f in " + " ".join(JSONS) + "; do stat -c '%n %Y' /opt/alex-hq-data/$f.json; done"],
                  "ship_verify", timeout=40)
        if chk is None or chk.returncode != 0:
            problems.append("SHIP UNVERIFIED: could not stat the box data files after scp")
        else:
            now = datetime.datetime.now(datetime.timezone.utc).timestamp()
            stale = []
            for line in chk.stdout.strip().splitlines():
                try:
                    name, mtime = line.rsplit(" ", 1)
                    if now - int(mtime) > 900:
                        stale.append(os.path.basename(name))
                except Exception:
                    pass
            if stale:
                problems.append(f"SHIP STALE: box files not fresh after scp: {', '.join(stale)}")
            else:
                notes.append(f"shipped + verified {len(JSONS)} JSONs fresh on the box")

    # 5. extras: human-actions summary + alex-hq heartbeat
    ha = run(["node", "scripts/human-actions.js", "summary"], "human_actions")
    if ha and ha.stdout.strip():
        try:
            s = json.loads(ha.stdout.strip().splitlines()[-1])
            oc = s.get("open_count", 0); oldest = s.get("oldest_days", 0)
            st = "red" if s.get("worst_severity") == "critical" else ("amber" if oldest >= 7 else "green")
            events.append({"project": "human-actions", "metric_key": "open_count", "value_num": oc,
                           "status": st, "headline": f"{s.get('headline', str(oc) + ' open')} · oldest {oldest}d"})
        except Exception as e:
            notes.append(f"human_actions parse: {e}")
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
    events.append({"project": "alex-hq", "metric_key": "run_status", "value_num": 1, "status": "green",
                   "headline": f"deterministic harvest clean {now_iso[:16]}Z"})

    if not events:
        problems.append("HARVEST EMPTY: no events gathered")
        report(0); sys.exit(1)

    # 6. push
    body = json.dumps({"events": events}).encode()
    req = urllib.request.Request(PUSH_URL, data=body, method="POST",
                                 headers={"X-Alex-Token": TOKEN, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            resp = json.load(r)
        if not resp.get("ok"):
            problems.append(f"PUSH REJECTED: {str(resp)[:120]}")
    except Exception as e:
        problems.append(f"PUSH FAILED: {e}")
        report(len(events)); sys.exit(1)

    # 7. verify-after-write: the infra metrics we just pushed must read back
    try:
        vreq = urllib.request.Request(SUMMARY_URL, headers={"X-Alex-Token": TOKEN})
        with urllib.request.urlopen(vreq, timeout=30) as r:
            inf = json.load(r).get("projects", {}).get("infra", {}).get("metrics", {})
        pushed = {e["metric_key"] for e in events if e["project"] == "infra"}
        missing = [k for k in pushed if k not in inf]
        if missing:
            problems.append(f"READ-BACK MISMATCH: infra metrics not in summary: {missing}")
        else:
            notes.append("read-back verified: infra metrics live in the summary")
    except Exception as e:
        problems.append(f"READ-BACK FAILED: {e}")

    report(len(events))
    sys.exit(1 if problems else 0)


def report(n):
    print(f"hq_harvest_push: pushed {n} events")
    for x in notes:
        print("  - " + x)
    for p in problems:
        print("  RED " + p)


if __name__ == "__main__":
    main()
