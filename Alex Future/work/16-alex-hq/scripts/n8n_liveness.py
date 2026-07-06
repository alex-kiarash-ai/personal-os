#!/usr/bin/env python3
"""infra.n8n_up_today for Alex HQ: how many ACTIVE n8n workflows actually ran today.

Read-only against the n8n public REST API. Emits ONE Alex HQ metric event as a single
JSON line on stdout (project=infra, metric_key=n8n_up_today). On any failure it writes a
reason to stderr and exits non-zero so the /alex-hq harvest simply SKIPS the metric rather
than pushing a bogus 0 (never fabricate). "Today" = the local Europe/Stockholm calendar day.

Wired into /alex-hq step 1 so the metric refreshes daily instead of going stale (its CADENCE
is 26h). Built 2026-07-04 to close Alex HQ carry-over (a).
"""
import sys, json, datetime, urllib.request
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("Europe/Stockholm")
except Exception:
    TZ = datetime.timezone(datetime.timedelta(hours=2))  # CEST fallback

BASE = "https://n8n.shaheenkiarash.com/api/v1"
REPO = Path(__file__).resolve().parents[3]          # scripts -> 16-alex-hq -> work -> repo
KEYFILE = REPO / "work" / "03-application-engine" / "config" / "n8n-api-key.txt"


def api(path):
    key = KEYFILE.read_text(encoding="utf-8").strip()
    req = urllib.request.Request(BASE + path, headers={"X-N8N-API-KEY": key})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def parse_ts(s):
    if not s:
        return None
    try:
        return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def main():
    # 1. Active workflow id set.
    wf = api("/workflows?limit=250").get("data", [])
    active_ids = {w["id"] for w in wf if w.get("active")}
    active = len(active_ids)
    if active == 0:
        raise RuntimeError("no active workflows returned")

    # 2. Distinct ACTIVE workflows with >=1 execution since local midnight.
    #    Executions come newest-first; page until we pass the start of today (cap 10 pages).
    start_today = datetime.datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    ran = set()
    cursor, pages = None, 0
    while pages < 10:
        pages += 1
        page = api(f"/executions?limit=250&includeData=false" + (f"&cursor={cursor}" if cursor else ""))
        rows = page.get("data", [])
        if not rows:
            break
        oldest_before_today = False
        for e in rows:
            ts = parse_ts(e.get("startedAt") or e.get("stoppedAt"))
            if ts is None:
                continue
            if ts.astimezone(TZ) >= start_today:
                if e.get("workflowId") in active_ids:
                    ran.add(e.get("workflowId"))
            else:
                oldest_before_today = True
        cursor = page.get("nextCursor")
        if oldest_before_today or not cursor:
            break

    num = len(ran)
    event = {
        "project": "infra",
        "metric_key": "n8n_up_today",
        "value_num": num,
        "value_text": f"of {active} active",
        "headline": f"{num} of {active} active workflows ran today",
        "status": "green" if num > 0 else "red",
    }
    print(json.dumps(event))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"n8n_liveness failed: {e}", file=sys.stderr)
        sys.exit(1)
