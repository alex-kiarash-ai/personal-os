#!/usr/bin/env python3
"""n8n liveness + failure signals for Alex HQ.

Read-only against the n8n public REST API. Emits a JSON ARRAY of ready-to-push Alex HQ
metric events on stdout (one array line). On any failure it writes a reason to stderr and
exits non-zero so the /alex-hq harvest SKIPS the metrics rather than pushing bogus zeros
(never fabricate). "Today" = the local Europe/Stockholm calendar day.

Emits two infra metrics:
  * n8n_up_today    - how many ACTIVE workflows ran today, over active count (green if >0).
  * n8n_broken_today - how many ACTIVE workflows are broken RIGHT NOW: their latest run
                       ERRORED, OR (for the expected-daily set) they have gone SILENT
                       (no run in >26h). Red if >0, with the offenders in the headline.
                       This is the number behind the "Broken n8n today" HQ card.

Built 2026-07-04 (up_today). Extended 2026-07-06 with n8n_broken_today + per-workflow
latest-execution classification, so a SINGLE silent/errored workflow shows, not just a
total blackout. Paired with the Pipeline Error Alert workflow, which pushes the same
n8n_broken_today key RED the instant any guarded workflow throws (immediate, pre-harvest).
"""
import sys, json, datetime, urllib.request, urllib.error
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("Europe/Stockholm")
except Exception:
    TZ = datetime.timezone(datetime.timedelta(hours=2))  # CEST fallback

BASE = "https://n8n.shaheenkiarash.com/api/v1"
REPO = Path(__file__).resolve().parents[3]          # scripts -> 16-alex-hq -> work -> repo
KEYFILE = REPO / "work" / "03-application-engine" / "config" / "n8n-api-key.txt"

# Workflows that MUST run about daily. If one hasn't run in >STALE_HOURS it is "silent"
# (a cron that stopped firing / a phone that stopped POSTing) even though it never errored.
# Webhook / on-demand workflows are NOT here: "didn't run today" is normal for them, so
# they only count as broken if their latest execution actually errored.
EXPECTED_DAILY = {
    "9XuIEfxS71DEetVR": "Application Engine (#03)",
    "9x9M3EnEEeX3O8dy": "AI Application Engine (#14)",
    "y5YbDZu8TT38XZ9r": "Pipeline Stats (16)",
    "WtOKBY00Cq1FhQ8T": "Health Ingest (#17)",
    "PYePT4Al6aPZi56M": "Radar Collector (#15)",   # daily 06:00 (added 2026-07-06)
}
STALE_HOURS = 26  # daily cadence + 2h grace

# Third output (2026-07-06, HQ n8n drill-down): the full per-workflow list, written as a
# static JSON the dashboard fetches client-side (scp'd to /opt/alex-hq-data, no rebuild).
WORKFLOWS_JSON = REPO / "work" / "16-alex-hq" / "app" / "public" / "data" / "n8n-workflows.json"


def api(path):
    key = KEYFILE.read_text(encoding="utf-8").strip()
    req = urllib.request.Request(BASE + path, headers={"X-N8N-API-KEY": key})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.load(r)


def parse_ts(s):
    if not s:
        return None
    try:
        return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def latest_execution(wf_id):
    """Most recent execution for one workflow, or None. Tolerant of per-workflow errors."""
    try:
        rows = api(f"/executions?workflowId={wf_id}&limit=1&includeData=false").get("data", [])
    except Exception:
        return None
    return rows[0] if rows else None


def main():
    wf = api("/workflows?limit=250").get("data", [])
    active = [w for w in wf if w.get("active")]
    if not active:
        raise RuntimeError("no active workflows returned")
    n_active = len(active)

    now = datetime.datetime.now(TZ)
    start_today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    ran_today = 0
    broken = []   # list of "Name (reason)" strings
    wf_list = []  # per-workflow rows for n8n-workflows.json
    for w in active:
        ex = latest_execution(w["id"])
        ts = parse_ts((ex or {}).get("startedAt") or (ex or {}).get("stoppedAt"))
        status = (ex or {}).get("status")

        if ts is not None and ts.astimezone(TZ) >= start_today:
            ran_today += 1

        name = w.get("name", w["id"])
        reason = None
        if status in ("error", "crashed"):
            broken.append(f"{name} (errored)")
            reason = "errored"
        elif w["id"] in EXPECTED_DAILY:
            age_h = (now - ts.astimezone(TZ)).total_seconds() / 3600 if ts else None
            if age_h is None:
                broken.append(f"{EXPECTED_DAILY[w['id']]} (never ran)")
                reason = "never ran"
            elif age_h > STALE_HOURS:
                broken.append(f"{EXPECTED_DAILY[w['id']]} (silent {int(age_h)}h)")
                reason = f"silent {int(age_h)}h"

        wf_list.append({
            "name": name,
            "id": w["id"],
            "last_exec": ts.astimezone(datetime.timezone.utc).isoformat().replace("+00:00", "Z") if ts else None,
            "status": status or "never",
            "broken_reason": reason,
        })

    n_broken = len(broken)

    # Write the drill-down list. Best-effort: a write failure must not kill the metrics.
    try:
        wf_list.sort(key=lambda r: (r["broken_reason"] is None, r["name"].lower()))
        WORKFLOWS_JSON.parent.mkdir(parents=True, exist_ok=True)
        WORKFLOWS_JSON.write_text(json.dumps({
            "generated_at": now.astimezone(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
            "active_count": n_active,
            "workflows": wf_list,
        }), encoding="utf-8")
    except Exception as e:
        print(f"n8n_liveness: workflows.json write failed: {e}", file=sys.stderr)
    up = {
        "project": "infra",
        "metric_key": "n8n_up_today",
        "value_num": ran_today,
        "value_text": f"of {n_active} active",
        "headline": f"{ran_today} of {n_active} active workflows ran today",
        "status": "green" if ran_today > 0 else "red",
    }
    bad = {
        "project": "infra",
        "metric_key": "n8n_broken_today",
        "value_num": n_broken,
        "value_text": f"of {n_active} active",
        "headline": ("All " + str(n_active) + " workflows healthy") if n_broken == 0
                    else (str(n_broken) + " broken: " + "; ".join(broken))[:240],
        "status": "green" if n_broken == 0 else "red",
    }
    print(json.dumps([up, bad]))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"n8n_liveness failed: {e}", file=sys.stderr)
        sys.exit(1)
