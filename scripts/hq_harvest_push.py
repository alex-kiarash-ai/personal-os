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
sys.path.insert(0, str(REPO / "scripts" / "lib"))
from alex_paths import alex_hq_data, secret  # noqa: E402  (needs REPO resolved first)

# The website left personal-os on 2026-08-04; DATA now resolves to the alex-hq repo
# (env ALEX_HQ_REPO -> manifest meta.paths.alex_hq_repo -> ../alex-hq sibling).
DATA = alex_hq_data(REPO)
# Resolved through the credentials ledger, never a literal path (ruling A). This line USED to name
# work/16-alex-hq/config/alex-hq-token.txt directly and broke the moment that file was relocated to
# ~/.config/alex/secrets/ - a module-level read, so the whole script died on import.
TOKEN = secret(REPO, "alex-hq-token")
PUSH_URL = "https://n8n.shaheenkiarash.com/webhook/alex-push"
SUMMARY_URL = "https://n8n.shaheenkiarash.com/webhook/alex-hq-summary"
JSONS = ["graph", "todos", "life", "projects", "n8n-workflows"]

RUN_START = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
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
            # A16-T10 (2026-09-10): the escalation ladder the constitution describes has three rungs
            # (day 0 the brief prints it, day 3+ the HQ strip, day 7+ the SessionStart line) and only
            # the 7-day one was code. The queue reached 101 open with the oldest at 60 days while the
            # tile stayed green for everything under a week. The middle rung exists now: amber at 3.
            # Deliberately NOT red at 7 days. The queue's oldest item is 60 days old and 101 are
            # open, so a 7-day red would be permanently red, and this repo already learned what that
            # costs (F-14: reporting a healthy-but-unstamped leg in the same words as a rotted one is
            # how an amber teaches people to ignore it). Red stays for a CRITICAL item, which is a
            # thing that changed. The day-7 rung is not missing either way: the SessionStart line
            # already prints the count and the oldest age at every session.
            st = ("red" if s.get("worst_severity") == "critical"
                  else "amber" if oldest >= 3
                  else "green")
            events.append({"project": "human-actions", "metric_key": "open_count", "value_num": oc,
                           "status": st, "headline": f"{s.get('headline', str(oc) + ' open')} · oldest {oldest}d"})
        except Exception as e:
            notes.append(f"human_actions parse: {e}")
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
    # A09-T-04 (2026-09-11): the alex-hq run_status event used to be appended HERE, hardcoded green,
    # BEFORE the push and before the read-back. So the tile for the thing that updates the dashboard
    # was green by construction: it reported "deterministic harvest clean" even on a run whose push
    # was rejected or whose read-back failed. The one producer nobody was watching was the watcher.
    # It is pushed at the END now, carrying the real verdict. See the second push below.

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
        # A09-T-10 (2026-09-11): this only checked that the KEY existed. A summary still serving
        # last week's values passes that test perfectly, which makes "read-back verified" a claim
        # about the shape of the response rather than about the write having landed. Compare the
        # VALUE we pushed and require the stored timestamp to be at or after this run's start.
        pushed = {e["metric_key"]: e for e in events if e["project"] == "infra"}
        missing, stale_rb, wrong = [], [], []
        for k, ev in pushed.items():
            got = inf.get(k)
            if got is None:
                missing.append(k); continue
            ts = str(got.get("ts") or "")
            if ts and ts < RUN_START:
                stale_rb.append(f"{k}(ts {ts[:16]} < run start {RUN_START[:16]})")
            if "value_num" in ev and got.get("value_num") is not None:
                try:
                    if float(got["value_num"]) != float(ev["value_num"]):
                        wrong.append(f"{k}(stored {got['value_num']} != pushed {ev['value_num']})")
                except (TypeError, ValueError):
                    pass
        if missing:
            problems.append(f"READ-BACK MISMATCH: infra metrics not in summary: {missing}")
        if stale_rb:
            problems.append(f"READ-BACK STALE: the summary served values older than this run: {', '.join(stale_rb)}")
        if wrong:
            problems.append(f"READ-BACK VALUE MISMATCH: {', '.join(wrong)}")
        if not (missing or stale_rb or wrong):
            notes.append(f"read-back verified: {len(pushed)} infra metric(s) present, fresh and value-matched")
    except Exception as e:
        problems.append(f"READ-BACK FAILED: {e}")

    # A09-T-04, second half: NOW push the alex-hq verdict, after everything that can fail has run.
    # A failure to deliver this heartbeat is logged and never changes the exit code (the standing
    # carve-out for run_status), but the VERDICT it carries is finally the truth.
    verdict_red = bool(problems)
    try:
        vbody = json.dumps({"events": [{
            "project": "alex-hq", "metric_key": "run_status",
            "value_num": 0 if verdict_red else 1,
            "status": "red" if verdict_red else "green",
            "headline": (problems[0][:120] if verdict_red
                         else f"deterministic harvest clean {now_iso[:16]}Z"),
        }]}).encode()
        vr = urllib.request.Request(PUSH_URL, data=vbody, method="POST",
                                    headers={"X-Alex-Token": TOKEN, "Content-Type": "application/json"})
        with urllib.request.urlopen(vr, timeout=30) as r:
            r.read()
        notes.append(f"alex-hq verdict pushed: {'red' if verdict_red else 'green'}")
    except Exception as e:
        notes.append(f"alex-hq verdict push failed (not fatal): {e}")

    report(len(events) + 1)
    sys.exit(1 if problems else 0)


def report(n):
    print(f"hq_harvest_push: pushed {n} events")
    for x in notes:
        print("  - " + x)
    for p in problems:
        print("  RED " + p)


if __name__ == "__main__":
    main()
