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
import os, sys, json, subprocess, datetime, urllib.request, urllib.error
from pathlib import Path

# headless Windows console is cp1252; metric headlines carry '·' etc. Never let a print crash the loop.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts" / "lib"))
from alex_paths import alex_hq_data, secret  # noqa: E402  (needs REPO resolved first)

# Ledger-resolved, never a literal path (ruling A). Same module-level break as hq_harvest_push.py:
# naming the in-repo file killed the script on import once the credential moved to ~/.config.
TOKEN = secret(REPO, "alex-hq-token")
SUMMARY_URL = "https://n8n.shaheenkiarash.com/webhook/alex-hq-summary"
PUSH_URL = "https://n8n.shaheenkiarash.com/webhook/alex-push"
HEAL_MAP = REPO / "system/hq-heal-map.json"
HEAL_LOG = REPO / "system/heal-log.jsonl"
# The website left personal-os on 2026-08-04; DATA now resolves to the alex-hq repo.
DATA = alex_hq_data(REPO)
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


def probe_identity_views(summary, entry):
    """The identity docs must stay ONE file object each, reached through a directory junction.

    Added 2026-07-25. The permanent fix for doc-copy drift is structural (one file, plus a junction at
    every legacy location), and this probe is the layer that NOTICES if that structure is destroyed -
    daily, on every HQ update, instead of weekly.

    AUTO_SAFE is justified ONLY because the remedy touches ZERO document bytes: removing a junction
    provably leaves its target intact, `mklink /J` is idempotent and non-elevated, and the read-back is
    one samefile call. The split is absolute:
      nothing-has-bytes (view missing, or an EMPTY directory sits there) -> re-link + verify
      anything-has-bytes (a real file is there)                          -> ESCALATE, never touch it
    That second branch is the whole safety property: a human who edited the wrong location must never
    lose that work to an automatic repair. Needs no HQ summary (needs_summary: false in the map).
    """
    mani = json.loads((REPO / "system" / "manifest.json").read_text(encoding="utf-8"))
    paths = mani.get("meta", {}).get("paths", {}) or {}
    real_raw = paths.get("identity_doc_real_dir")
    views = paths.get("identity_doc_views") or []
    if not real_raw or not views:
        return log("identity-doc-views", "skip", "no identity_doc_real_dir / identity_doc_views declared")
    real = Path(os.path.expandvars(real_raw))
    if not real.is_dir():
        escalate("identity-docs-real-dir-missing", "critical",
                 f"the identity docs' real folder {real} is GONE - restore it from the encrypted backup "
                 f"before touching the views (both documents live only there)")
        return log("identity-doc-views", "escalated", f"real dir missing: {real}", "HUMAN_ONLY")

    JUNCTION = 0xA0000003
    for v in views:
        vp = Path(os.path.expandvars(v.get("path", "")))
        if not str(vp):
            continue
        try:
            tag = os.lstat(vp).st_reparse_tag if vp.exists() else None
        except OSError:
            tag = None
        if vp.exists() and tag == JUNCTION:
            names = [p.name for p in real.iterdir() if p.is_file()]
            forked = [n for n in names if not os.path.samefile(real / n, vp / n)]
            if forked:
                escalate("identity-doc-view-forked", "high",
                         f"{vp} is a junction but {forked} do not resolve to the same file - investigate by hand")
                log("identity-doc-views", "escalated", f"junction present but forked: {forked}", "HUMAN_ONLY")
            else:
                log("identity-doc-views", "ok", f"{vp.name}: one file object per doc ({len(names)} files)")
            continue

        # the view is not a junction. Decide ONLY on whether anything there has bytes.
        has_bytes = []
        if vp.exists():
            try:
                has_bytes = [p.name for p in vp.iterdir()] if vp.is_dir() else [vp.name]
            except OSError as e:
                escalate("identity-doc-view-unreadable", "high", f"cannot inspect {vp} ({e})")
                log("identity-doc-views", "escalated", f"unreadable: {vp} ({e})", "HUMAN_ONLY")
                continue
        if has_bytes:
            escalate("identity-doc-view-replaced", "high",
                     f"{vp} is no longer a junction and CONTAINS FILES ({has_bytes[:5]}). Refusing to touch "
                     f"it: those bytes may be edits that exist nowhere else. Compare them against {real} by "
                     f"hand, keep what is newer, then re-link with: mklink /J \"{vp}\" \"{real}\"")
            log("identity-doc-views", "escalated", f"{vp} replaced by real content - not auto-repaired", "PROPOSE")
            continue

        # nothing to lose: re-link and read back
        try:
            if vp.exists():
                os.rmdir(vp)                      # empty dir only; raises if not empty
            r = run(["cmd", "/c", "mklink", "/J", str(vp), str(real)], timeout=30)
            ok = vp.exists() and os.lstat(vp).st_reparse_tag == JUNCTION
            names = [p.name for p in real.iterdir() if p.is_file()]
            ok = ok and all(os.path.samefile(real / n, vp / n) for n in names)
            if ok:
                log("identity-doc-views", "healed", f"re-linked {vp} -> {real}, verified samefile", "AUTO_SAFE")
            else:
                escalate("identity-doc-view-relink-failed", "high",
                         f"{entry.get('escalate_fail', 'view re-link did not verify')} ({r.stdout.strip()[:120]})")
                log("identity-doc-views", "escalated", "re-link did not verify", "AUTO_SAFE->escalate")
        except OSError as e:
            escalate("identity-doc-view-relink-failed", "high", f"could not re-link {vp}: {e}")
            log("identity-doc-views", "escalated", f"re-link error: {e}", "AUTO_SAFE->escalate")


PROBES = {
    "mcp_count": probe_mcp_count,
    "box_fresh": probe_box_fresh,
    "n8n_broken": probe_n8n_broken,
    "quota_stale": probe_quota_stale,
    "health_stalled": probe_health_stalled,
    "stuck_status": probe_stuck_status,
    "identity_views": probe_identity_views,
}


def main():
    heal_map = json.loads(HEAL_MAP.read_text(encoding="utf-8"))
    # The HQ summary comes off the network. It used to be fetched UNCONDITIONALLY here, so an n8n
    # outage meant ZERO probes ran - including probes that need no summary at all (2026-07-25).
    # Fetch it defensively and let summary-free checks run regardless.
    try:
        summary = get_summary()
    except Exception as e:
        summary = {}
        log("hq-summary", "skip", f"summary unavailable ({e}); running summary-free probes only")
    # projects a specific check owns (so the catch-all doesn't double-flag them)
    claimed = {"infra", "health", "quota"}
    for entry in heal_map["checks"]:
        if not entry.get("enabled", True):
            continue
        pid = entry["probe"]
        # A check that needs the summary cannot run without it; one that does not (a filesystem
        # invariant, say) must still run on an n8n-outage day - which is exactly a heavy-edit day.
        if not summary and entry.get("needs_summary", True):
            log(entry["id"], "skip", "needs the HQ summary, which is unavailable this run")
            continue
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
    # A crashed probe used to be logged as "error" and then omitted from BOTH the counts and the
    # printed lines, so it vanished into an exit-0 summary (2026-07-25). Surface it.
    errs = [a for a in actions if a["state"] == "error"]
    print(f"self-heal: {len(healed)} healed, {len(proposed)} proposed, {len(esc)} escalated, "
          f"{len(errs)} errored, {len(oks)} ok")
    for a in healed + proposed + esc + errs:
        print(f"  {a['state'].upper()} [{a['check']}] {a['detail']}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"hq_self_heal failed: {e}", file=sys.stderr)
        sys.exit(1)
