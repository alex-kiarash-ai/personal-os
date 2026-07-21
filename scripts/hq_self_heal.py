#!/usr/bin/env python3
"""Alex HQ Self-Heal Loop (v1) - the FIX half of the dashboard.

Born 2026-07-21: HQ used to just DISPLAY red. Shaheen's call - "it's the tool to check the
status and FIX it, not display the errors." This runs as part of every HQ update (called after
scripts/hq_harvest_push.py), reads the live summary + re-derives ground truth, and for each
mismatch/red either FIXES it (auto-safe) or ESCALATES it (propose/human) with a diagnosis.

Autonomy boundary (Shaheen 2026-07-21):
  AUTO_SAFE  - deterministic, reversible, no side-effect: run it, then READ-BACK VERIFY. One
               attempt; a remedy that doesn't verify ESCALATES, it never retries (no storms).
  PROPOSE    - a live mutation (workflow redeploy/reactivation, clearing a stuck flag): queued
               to the waiting-on-you list with a diagnosis, NEVER auto-run.
  HUMAN_ONLY - phone/OAuth/credentials: queued as Shaheen's.

Zero-token + deterministic. Every action -> system/heal-log.jsonl. Prints a one-line summary
(picked up by the harvest output + the morning brief). Map: system/hq-heal-map.json.
"""
import sys, json, subprocess, datetime, urllib.request, urllib.error
from pathlib import Path

# headless Windows console is cp1252; metric headlines carry '·' etc. Never let a print crash the loop.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

REPO = Path(__file__).resolve().parents[1]
TOKEN = (REPO / "work/16-alex-hq/config/alex-hq-token.txt").read_text(encoding="utf-8").strip()
SUMMARY_URL = "https://n8n.shaheenkiarash.com/webhook/alex-hq-summary"
PUSH_URL = "https://n8n.shaheenkiarash.com/webhook/alex-push"
HEAL_MAP = REPO / "system/hq-heal-map.json"
HEAL_LOG = REPO / "system/heal-log.jsonl"
DATA = REPO / "work/16-alex-hq/app/public/data"
JSONS = ["graph", "todos", "life", "projects", "n8n-workflows"]

NOW = datetime.datetime.now(datetime.timezone.utc)
actions = []   # heal-log rows for this run


def run(cmd, timeout=90):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=str(REPO))
    except Exception as e:
        return type("R", (), {"returncode": 1, "stdout": "", "stderr": str(e)})()


def get_summary():
    req = urllib.request.Request(SUMMARY_URL, headers={"X-Alex-Token": TOKEN})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def push(events):
    body = json.dumps({"events": events}).encode()
    req = urllib.request.Request(PUSH_URL, data=body, method="POST",
                                 headers={"X-Alex-Token": TOKEN, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def infra_events():
    """Fresh deterministic infra events (mcp/jobs/vault) from the harvest helper."""
    r = run(["python", "scripts/hq_infra_harvest.py"])
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        return []


def n8n_events():
    r = run(["python", "work/16-alex-hq/scripts/n8n_liveness.py"])
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        return []


def escalate(id_, severity, what):
    """Queue to the waiting-on-you list; human-actions.js refuses duplicate open ids, so this is
    idempotent (a returncode != 0 just means it's already queued)."""
    run(["node", "scripts/human-actions.js", "add", "--id", id_,
         "--severity", severity, "--what", what])


def log(check, state, detail, cls=""):
    actions.append({"check": check, "state": state, "class": cls, "detail": detail})


# ---- probes: each returns one of ok / healed / proposed / escalated, and logs ----

def probe_mcp_count(summary, entry):
    ev = infra_events()
    live = next((e["value_num"] for e in ev if e["metric_key"] == "mcp_tools"), None)
    if live is None:
        return log("mcp-count-truth", "skip", "could not read live mcp count")
    stored = (summary.get("projects", {}).get("infra", {}).get("metrics", {})
              .get("mcp_tools", {}).get("value_num"))
    if stored == live:
        return log("mcp-count-truth", "ok", f"stored {stored} == live {live}")
    # AUTO_SAFE: re-push the fresh mcp event, then verify
    push([e for e in ev if e["metric_key"] == "mcp_tools"])
    stored2 = (get_summary().get("projects", {}).get("infra", {}).get("metrics", {})
               .get("mcp_tools", {}).get("value_num"))
    if stored2 == live:
        return log("mcp-count-truth", "healed", f"mcp {stored} -> {live}, re-pushed + verified", "AUTO_SAFE")
    escalate("heal-mcp-ingest", "high", f"{entry['escalate_fail']} (stored {stored2}, live {live})")
    log("mcp-count-truth", "escalated", f"re-push did not stick ({stored2} != {live})", "AUTO_SAFE->escalate")


def probe_box_fresh(summary, entry):
    chk = run(["ssh", "-o", "BatchMode=yes", "n8n",
               "for f in " + " ".join(JSONS) + "; do stat -c '%n %Y' /opt/alex-hq-data/$f.json; done"], timeout=40)
    if chk.returncode != 0:
        escalate("heal-box-ssh", "high", f"{entry['escalate_fail']}")
        return log("box-data-fresh", "escalated", "cannot stat box files (ssh down)", "AUTO_SAFE->escalate")
    now = NOW.timestamp()
    stale = []
    for line in chk.stdout.strip().splitlines():
        try:
            name, mtime = line.rsplit(" ", 1)
            if now - int(mtime) > 900:
                stale.append(name.split("/")[-1])
        except Exception:
            pass
    if not stale:
        return log("box-data-fresh", "ok", "all 5 box JSONs fresh")
    # AUTO_SAFE: re-ship the locally-built files + re-verify
    src = [str(DATA / f"{n}.json") for n in JSONS]
    run(["scp", "-q", *src, "n8n:/opt/alex-hq-data/"], timeout=60)
    chk2 = run(["ssh", "-o", "BatchMode=yes", "n8n",
                "for f in " + " ".join(JSONS) + "; do stat -c '%Y' /opt/alex-hq-data/$f.json; done"], timeout=40)
    still = [1 for l in chk2.stdout.strip().splitlines() if l.strip().isdigit() and now - int(l) > 900]
    if not still:
        return log("box-data-fresh", "healed", f"re-shipped stale JSONs ({', '.join(stale)}) + verified fresh", "AUTO_SAFE")
    escalate("heal-box-ssh", "high", entry["escalate_fail"])
    log("box-data-fresh", "escalated", "still stale after re-scp", "AUTO_SAFE->escalate")


def probe_n8n_broken(summary, entry):
    ev = n8n_events()
    bad = next((e for e in ev if e["metric_key"] == "n8n_broken_today"), None)
    if not bad:
        return log("n8n-broken", "skip", "could not read n8n liveness")
    if bad.get("value_num", 0) == 0:
        return log("n8n-broken", "ok", "no broken workflows")
    # PROPOSE: a live workflow fix needs Shaheen's ok
    escalate("heal-n8n-broken", "high", f"n8n broken: {bad.get('headline')} - redeploy/reactivate needs your ok")
    log("n8n-broken", "proposed", bad.get("headline", ""), "PROPOSE")


def probe_quota_stale(summary, entry):
    """AUTO-SAFE: quota.anthropic_api red but the local quota-state.json says the cap is OK = a stale
    flag that no early-reset path cleared (the 07-13 class). Ground truth is deterministic (the state
    file), so push a truthful corrective green + verify. If the state file says capped, the red is
    TRUE - leave it (don't fabricate an all-clear)."""
    q = (summary.get("projects", {}).get("quota", {}).get("metrics", {}).get("anthropic_api", {}))
    if q.get("status") != "red":
        return log("quota-stale", "ok", "quota not red")
    try:
        st = json.loads((REPO / "system/quota-state.json").read_text(encoding="utf-8"))
        state = st.get("anthropic_api", {}).get("state")
    except Exception as e:
        return log("quota-stale", "skip", f"could not read quota-state.json ({e})")
    if state != "ok":
        return log("quota-stale", "ok", f"quota genuinely {state} - red is truthful, left as-is")
    push([{"project": "quota", "metric_key": "anthropic_api", "value_num": 1, "value_text": "ok",
           "status": "green", "headline": "cap lifted (quota-state.json ok) - stale red auto-cleared"}])
    now_status = (get_summary().get("projects", {}).get("quota", {}).get("metrics", {})
                  .get("anthropic_api", {}).get("status"))
    if now_status == "green":
        return log("quota-stale", "healed", "stale quota cap red cleared (state ok), verified green", "AUTO_SAFE")
    escalate("heal-quota-stuck", "medium", "quota red won't clear despite quota-state.json ok - ingest issue")
    log("quota-stale", "escalated", f"corrective push didn't stick ({now_status})", "AUTO_SAFE->escalate")


def probe_health_stalled(summary, entry):
    h = summary.get("projects", {}).get("health", {}).get("metrics", {})
    stalled = [k for k, m in h.items() if m.get("status") == "red" and "stalled" in str(m.get("headline", "")).lower()]
    if not stalled:
        return log("health-source-stalled", "ok", "health source live")
    escalate("iphone-health-shortcut", "high",
             "Health tiles stalled - the iPhone Shortcut/HealthKit source is dead (check step + sleep reads)")
    log("health-source-stalled", "escalated", f"stalled: {', '.join(stalled)}", "HUMAN_ONLY")


def probe_stuck_status(summary, entry):
    hits = []
    for name, p in summary.get("projects", {}).items():
        if name in ("infra", "health"):
            continue
        rs = p.get("metrics", {}).get("run_status", {})
        if rs.get("status") != "red":
            continue
        ts = rs.get("ts")
        if not ts:
            continue
        try:
            age_d = (NOW - datetime.datetime.fromisoformat(str(ts).replace("Z", "+00:00"))).days
        except Exception:
            continue
        if age_d >= 3:
            hits.append(f"{name} ({age_d}d)")
    if not hits:
        return log("stuck-red-status", "ok", "no stale reds")
    escalate("heal-stuck-status", "medium", f"stuck red run_status >3d: {', '.join(hits)} - confirm healthy then clear")
    log("stuck-red-status", "proposed", ", ".join(hits), "PROPOSE")


# Metrics that go RED by design to DRAW ATTENTION (real items for Shaheen), not because anything
# is broken - the morning brief / email-triage / CRM already surface these to him. A project red
# ONLY because of a signal metric is not a system FAULT, so the fault catch-all must skip it, or it
# nags "unknown red" every day Shaheen simply has things to do. (added 2026-07-21 after the
# morning-brief urgent_count=4 false-positive.)
SIGNAL_METRICS = {"urgent_count", "act_now", "followups_due"}


def probe_unknown_red(summary, entry, claimed):
    hits = []
    for name, p in summary.get("projects", {}).items():
        if name in claimed or p.get("status") != "red":
            continue
        red_metrics = {k: m for k, m in p.get("metrics", {}).items() if m.get("status") == "red"}
        fault_metrics = {k: m for k, m in red_metrics.items() if k not in SIGNAL_METRICS}
        if not fault_metrics:
            log("unknown-red", "ok", f"{name} red is signal-only ({', '.join(red_metrics)}), not a fault")
            continue
        hits.append((name, next(iter(fault_metrics.values())).get("headline", "")))
    for name, worst in hits:
        escalate(f"heal-unknown-{name}", "medium", f"Unknown red on '{name}': {worst or 'see HQ'} - needs diagnosis")
        log("unknown-red", "proposed", f"{name}: {worst}", "PROPOSE")
    if not hits:
        log("unknown-red", "ok", "no unclaimed FAULT reds")


PROBES = {
    "mcp_count": probe_mcp_count,
    "box_fresh": probe_box_fresh,
    "n8n_broken": probe_n8n_broken,
    "quota_stale": probe_quota_stale,
    "health_stalled": probe_health_stalled,
    "stuck_status": probe_stuck_status,
}


def main():
    heal_map = json.loads(HEAL_MAP.read_text(encoding="utf-8"))
    summary = get_summary()
    # projects a specific check owns (so the catch-all doesn't double-flag them)
    claimed = {"infra", "health", "quota"}
    for entry in heal_map["checks"]:
        if not entry.get("enabled", True):
            continue
        pid = entry["probe"]
        if pid == "unknown_red":
            probe_unknown_red(summary, entry, claimed)
        elif pid in PROBES:
            try:
                PROBES[pid](summary, entry)
            except Exception as e:
                log(entry["id"], "error", f"probe crashed: {e}")

    # persist + summarize
    ts = NOW.isoformat().replace("+00:00", "Z")
    with HEAL_LOG.open("a", encoding="utf-8") as f:
        for a in actions:
            f.write(json.dumps({"ts": ts, **a}) + "\n")
    healed = [a for a in actions if a["state"] == "healed"]
    proposed = [a for a in actions if a["state"] == "proposed"]
    esc = [a for a in actions if a["state"] == "escalated"]
    oks = [a for a in actions if a["state"] == "ok"]
    print(f"self-heal: {len(healed)} healed, {len(proposed)} proposed, {len(esc)} escalated, {len(oks)} ok")
    for a in healed + proposed + esc:
        print(f"  {a['state'].upper()} [{a['check']}] {a['detail']}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"hq_self_heal failed: {e}", file=sys.stderr)
        sys.exit(1)
