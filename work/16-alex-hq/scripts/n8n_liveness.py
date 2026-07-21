#!/usr/bin/env python3
"""n8n liveness + failure signals for Alex HQ.

Read-only against the n8n public REST API. Emits a JSON ARRAY of ready-to-push Alex HQ
metric events on stdout (one array line). On any failure it writes a reason to stderr and
exits non-zero so the /alex-hq harvest SKIPS the metrics rather than pushing bogus zeros
(never fabricate). "Today" = the local Europe/Stockholm calendar day.

Emits two infra metrics:
  * n8n_up_today    - how many CADENCE-MONITORED workflows are on-cadence (ran within their
                      OWN expected window), over the monitored count. Green iff all are.
  * n8n_broken_today - how many workflows are broken RIGHT NOW: their latest run ERRORED, OR
                       a cadence-monitored workflow has gone SILENT past its own window. Red
                       if >0, offenders named. Behind the "Broken n8n today" HQ card.

CADENCE-AWARE MONITORING (2026-07-21b): each scheduled workflow is measured against a window
DERIVED from its own trigger cadence - daily within 26h, every-72h engines within ~78h, the
Tue/Thu LinkedIn within ~5 days - so a workflow that silently STOPS firing (not just one that
errors) is caught, within its cadence + grace. This closes the real gap that bit the job
engines twice (07-10 silent deactivation by the voice sync; 07-19 error run found late): the
old check only silence-tested the 3 daily workflows and error-tested everything else, so a
72h engine that quietly stopped scheduling read "healthy" off its last success. Now every
workflow with a determinable cadence is silence-monitored on its own clock. Webhook / MCP /
error / execute-triggered workflows have no cadence (idle by design) and are error-tested only.

Earlier: built 2026-07-04 (up_today over all-active); denominator narrowed to daily-expected
2026-07-21a; generalized to per-cadence on-cadence 2026-07-21b.
"""
import sys, re, json, datetime, urllib.request, urllib.error
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("Europe/Stockholm")
except Exception:
    TZ = datetime.timezone(datetime.timedelta(hours=2))  # CEST fallback

BASE = "https://n8n.shaheenkiarash.com/api/v1"
REPO = Path(__file__).resolve().parents[3]          # scripts -> 16-alex-hq -> work -> repo
KEYFILE = REPO / "work" / "03-application-engine" / "config" / "n8n-api-key.txt"

# Daily-expected workflows that fire from an EXTERNAL producer (no n8n scheduleTrigger to read
# a cadence from). Health Ingest is POSTed by the iPhone Shortcut at 23:59 - daily-expected, so
# its silence is a real signal. Window = the daily one.
EXPLICIT_DAILY = {
    "WtOKBY00Cq1FhQ8T": "Health Ingest (#17)",   # phone webhook, daily 23:59
}
DAILY_WINDOW_H = 26  # daily cadence + 2h grace

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


def cadence_window_hours(wf):
    """Max expected gap (hours) between runs for a scheduled workflow, derived from its trigger
    cadence + grace. None if it has no scheduleTrigger / the cadence can't be read (then the
    workflow is error-tested only, never silence-tested - webhooks etc.)."""
    for n in wf.get("nodes", []):
        if not n.get("type", "").endswith("scheduleTrigger"):
            continue
        for iv in n.get("parameters", {}).get("rule", {}).get("interval", []):
            field = iv.get("field")
            if field in ("seconds", "minutes", "hours"):
                return DAILY_WINDOW_H                       # sub-daily -> a day is plenty
            if field == "days":
                days = int(iv.get("daysInterval", iv.get("value", 1)) or 1)
                return DAILY_WINDOW_H if days <= 1 else days * 24 + max(6, int(days * 24 * 0.15))
            if field == "weeks":
                weeks = int(iv.get("weeksInterval", iv.get("value", 1)) or 1)
                return weeks * 7 * 24 + 24
            if field == "cronExpression":
                parts = str(iv.get("expression", "")).split()
                if len(parts) != 5:
                    continue
                _minute, _hour, dom, _month, dow = parts
                m = re.match(r"^\*/(\d+)$", dom)                # every-N-days on day-of-month
                if m:
                    nd = int(m.group(1))
                    return nd * 24 + max(6, int(nd * 24 * 0.15))
                if dow != "*" and re.match(r"^[0-9,]+$", dow):  # specific weekdays, e.g. 2,4
                    wd = sorted({int(x) % 7 for x in dow.split(",")})
                    if len(wd) == 1:
                        return 7 * 24 + 24
                    gaps = [((wd[(i + 1) % len(wd)] - wd[i]) % 7) or 7 for i in range(len(wd))]
                    return max(gaps) * 24 + 24
                if dom == "*" and dow == "*":                   # plain daily
                    return DAILY_WINDOW_H
    return None


def main():
    wf = api("/workflows?limit=250").get("data", [])
    active = [w for w in wf if w.get("active")]
    if not active:
        raise RuntimeError("no active workflows returned")
    n_active = len(active)

    now = datetime.datetime.now(TZ)

    # cadence-monitored set: everything with a determinable schedule window + the explicit dailies
    window = {}   # wf_id -> window hours
    disp = {}     # wf_id -> display name
    for w in active:
        wid = w["id"]
        if wid in EXPLICIT_DAILY:
            window[wid] = DAILY_WINDOW_H
            disp[wid] = EXPLICIT_DAILY[wid]
        else:
            win = cadence_window_hours(w)
            if win is not None:
                window[wid] = win
                disp[wid] = w.get("name", wid)
    n_monitored = len(window)

    on_cadence = 0
    broken = []
    wf_list = []
    for w in active:
        wid = w["id"]
        ex = latest_execution(wid)
        ts = parse_ts((ex or {}).get("startedAt") or (ex or {}).get("stoppedAt"))
        status = (ex or {}).get("status")
        age_h = (now - ts.astimezone(TZ)).total_seconds() / 3600 if ts else None
        name = w.get("name", wid)

        if wid in window:
            win = window[wid]
            kind = "daily" if win <= DAILY_WINDOW_H else "scheduled"
        else:
            kind = "webhook"

        reason = None
        if status in ("error", "crashed"):
            broken.append(f"{name} (errored)")
            reason = "errored"
        elif wid in window:
            win = window[wid]
            if age_h is None:
                broken.append(f"{disp[wid]} (never ran)")
                reason = "never ran"
            elif age_h > win:
                broken.append(f"{disp[wid]} (silent {int(age_h)}h/{int(win)}h)")
                reason = f"silent {int(age_h)}h"

        if wid in window and age_h is not None and age_h <= window[wid] and status not in ("error", "crashed"):
            on_cadence += 1

        wf_list.append({
            "name": name,
            "id": wid,
            "kind": kind,
            "window_h": window.get(wid),
            "last_exec": ts.astimezone(datetime.timezone.utc).isoformat().replace("+00:00", "Z") if ts else None,
            "status": status or "never",
            "broken_reason": reason,
        })

    n_broken = len(broken)

    # Write the drill-down list. Best-effort: a write failure must not kill the metrics.
    try:
        kind_rank = {"daily": 0, "scheduled": 1, "webhook": 2}
        wf_list.sort(key=lambda r: (r["broken_reason"] is None, kind_rank.get(r["kind"], 3), r["name"].lower()))
        WORKFLOWS_JSON.parent.mkdir(parents=True, exist_ok=True)
        WORKFLOWS_JSON.write_text(json.dumps({
            "generated_at": now.astimezone(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
            "active_count": n_active,
            "monitored": n_monitored,
            "workflows": wf_list,
        }), encoding="utf-8")
    except Exception as e:
        print(f"n8n_liveness: workflows.json write failed: {e}", file=sys.stderr)

    up = {
        "project": "infra",
        "metric_key": "n8n_up_today",
        "value_num": on_cadence,
        "value_text": f"of {n_monitored} scheduled",
        "headline": f"{on_cadence} of {n_monitored} scheduled workflows on-cadence"
                    + (f" · {n_active} active total" if n_active != n_monitored else ""),
        "status": "green" if on_cadence >= n_monitored else "red",
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
