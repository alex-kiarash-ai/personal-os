#!/usr/bin/env python3
"""
Health Tracker backfill — parse a 532MB Apple Health export.xml (streaming),
de-duplicate steps, group sleep into nights, compute the Alex Sleep Score,
and emit one summarized row per date.

Read-only on the export. Writes summarized data to the (local, gitignored) vault.

Usage:
  python backfill_health.py                 # parse + write JSON + print summary
  python backfill_health.py --emit-rows out.json   # also write POST-ready rows for n8n seeding

The SCORE CONFIG + score() function below are the single source of the formula.
n8n's scoring Code node mirrors this exactly (keep in sync).
"""
import sys, os, json, argparse
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, date
from collections import defaultdict

EXPORT = r"C:\Users\Thinkpad\Desktop\Health\apple_health_export\export.xml"
FMT = "%Y-%m-%d %H:%M:%S %z"
SESSION_GAP = timedelta(minutes=60)     # new sleep session when gap exceeds this
MIN_MAIN_SLEEP_MIN = 45                 # sessions shorter than this = nap/fragment, not main sleep

# ---------------------------------------------------------------------------
# ALEX SLEEP SCORE CONFIG  (tunable; mirror in n8n scoring node)
# ---------------------------------------------------------------------------
CFG = {
    "duration":    {"w": 35, "band": [420, 540], "zero_below": 300, "taper_above": 660, "floor_above": 0.30},
    "efficiency":  {"w": 20, "zero_at": 0.75, "full_at": 0.90},
    "deep_pct":    {"w": 15, "band": [0.13, 0.23], "zero_below": 0.05, "taper_above": 0.35, "floor_above": 0.75},
    "rem_pct":     {"w": 15, "band": [0.20, 0.25], "zero_below": 0.10, "taper_above": 0.35, "floor_above": 0.80},
    "restfulness": {"w": 10, "free_awakenings": 1, "penalty_per_awakening": 1.5},
    "consistency": {"w": 5,  "full_within_min": 30, "zero_beyond_min": 90},
}

def _clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))

def _plateau(x, c):
    """Full weight inside the band; hard ramp below; gentle taper above."""
    w, (lo, hi) = c["w"], c["band"]
    if x is None:
        return None
    if lo <= x <= hi:
        return w
    if x < lo:
        return w * _clamp((x - c["zero_below"]) / (lo - c["zero_below"]))
    # above the band: taper down to floor_above*w at taper_above
    frac = _clamp((x - hi) / (c["taper_above"] - hi))
    return w * (1 - (1 - c["floor_above"]) * frac)

def _ramp(x, c):
    if x is None:
        return None
    return c["w"] * _clamp((x - c["zero_at"]) / (c["full_at"] - c["zero_at"]))

def score(row):
    """
    row keys: asleep_min, deep_min, rem_min, core_min, inbed_min, awakenings,
              bedtime_dev_min (abs deviation from trailing avg, or None)
    Returns (score_int, components_dict, live_weight). Graceful degradation:
    uncomputable components are dropped and the rest rescaled to 100.
    """
    asleep = row["asleep_min"]
    if not asleep or asleep <= 0:
        return None, {}, 0
    deep_pct = row["deep_min"] / asleep if asleep else None
    rem_pct  = row["rem_min"]  / asleep if asleep else None
    inbed = row.get("inbed_min") or 0
    eff = asleep / inbed if inbed and inbed >= asleep else None

    comp = {}
    comp["duration"]    = _plateau(asleep, CFG["duration"])
    comp["efficiency"]  = _ramp(eff, CFG["efficiency"]) if eff is not None else None
    comp["deep_pct"]    = _plateau(deep_pct, CFG["deep_pct"]) if deep_pct is not None else None
    comp["rem_pct"]     = _plateau(rem_pct, CFG["rem_pct"]) if rem_pct is not None else None
    # restfulness
    rc = CFG["restfulness"]
    wakes = row.get("awakenings")
    comp["restfulness"] = max(0.0, rc["w"] - max(0, (wakes or 0) - rc["free_awakenings"]) * rc["penalty_per_awakening"]) if wakes is not None else None
    # consistency
    cc = CFG["consistency"]
    dev = row.get("bedtime_dev_min")
    if dev is None:
        comp["consistency"] = None
    elif dev <= cc["full_within_min"]:
        comp["consistency"] = cc["w"]
    else:
        comp["consistency"] = cc["w"] * _clamp(1 - (dev - cc["full_within_min"]) / (cc["zero_beyond_min"] - cc["full_within_min"]))

    live = {k: v for k, v in comp.items() if v is not None}
    live_weight = sum(CFG[k]["w"] for k in live)
    if live_weight == 0:
        return None, comp, 0
    raw = sum(live.values())
    scaled = raw / live_weight * 100.0
    return round(scaled), comp, live_weight

# ---------------------------------------------------------------------------
# PARSE
# ---------------------------------------------------------------------------
def parse_dt(s):
    return datetime.strptime(s, FMT)   # tz-aware, offset baked in = local

ASLEEP_VALS = {"AsleepCore", "AsleepDeep", "AsleepREM", "AsleepUnspecified", "Asleep"}

def stream(path):
    step_minute = defaultdict(lambda: defaultdict(int))   # (date, minute_dt) -> {source: steps}
    sleep_samples = []                                    # (start, end, stage)
    n_step = n_sleep = 0
    context = ET.iterparse(path, events=("start", "end"))
    _, root = next(context)
    for event, elem in context:
        if event != "end" or elem.tag != "Record":
            continue
        rtype = elem.get("type")
        if rtype == "HKQuantityTypeIdentifierStepCount":
            start = parse_dt(elem.get("startDate"))
            src = elem.get("sourceName") or "?"
            try:
                steps = int(float(elem.get("value")))
            except (TypeError, ValueError):
                steps = 0
            minute = start.replace(second=0, microsecond=0)
            step_minute[(start.date(), minute)][src] += steps
            n_step += 1
        elif rtype == "HKCategoryTypeIdentifierSleepAnalysis":
            stage = (elem.get("value") or "").replace("HKCategoryValueSleepAnalysis", "")
            sleep_samples.append((parse_dt(elem.get("startDate")), parse_dt(elem.get("endDate")), stage))
            n_sleep += 1
        elem.clear()
        root.clear()
    return step_minute, sleep_samples, n_step, n_sleep

def dedup_steps(step_minute):
    """minute-bucket max across sources -> one source credited per minute."""
    daily = defaultdict(int)
    for (d, _minute), by_src in step_minute.items():
        daily[d] += max(by_src.values())
    return daily

def build_sessions(sleep_samples):
    sleep_samples.sort(key=lambda r: r[0])
    sessions, cur, last_end = [], [], None
    for start, end, val in sleep_samples:
        if last_end is not None and start - last_end > SESSION_GAP:
            sessions.append(cur); cur = []
        cur.append((start, end, val)); last_end = end if last_end is None or end > last_end else last_end
    if cur:
        sessions.append(cur)

    # one main-sleep row per wake-date (largest asleep wins if multiple)
    by_date = {}
    for s in sessions:
        mins = defaultdict(float)
        for start, end, val in s:
            mins[val] += (end - start).total_seconds() / 60.0
        core = mins["AsleepCore"]; deep = mins["AsleepDeep"]; rem = mins["AsleepREM"]
        unspec = mins["AsleepUnspecified"] + mins["Asleep"]
        asleep = core + deep + rem + unspec
        if asleep < MIN_MAIN_SLEEP_MIN:
            continue                      # nap / fragment
        span = (s[-1][1] - s[0][0]).total_seconds() / 60.0
        inbed = mins["InBed"] or span     # InBed & stages overlap by source -> never add
        awakenings = sum(1 for _, _, v in s if v == "Awake")
        wake = s[-1][1]                   # wake-up date attribution
        bedtime = s[0][0]                 # session start
        night = wake.date()
        row = dict(asleep_min=round(asleep, 1), deep_min=round(deep, 1), rem_min=round(rem, 1),
                   core_min=round(core, 1), awake_min=round(mins["Awake"], 1), inbed_min=round(inbed, 1),
                   awakenings=awakenings, bedtime=bedtime.isoformat(), waketime=wake.isoformat(),
                   _bedtime_dt=bedtime)
        if night not in by_date or asleep > by_date[night]["asleep_min"]:
            by_date[night] = row
    return by_date

def bedtime_offset_min(dt):
    """minutes since 18:00 local, so 22:00->240, 00:30->390, 02:00->480 (no wrap)."""
    ref = dt.replace(hour=18, minute=0, second=0, microsecond=0)
    if dt < ref:
        ref = ref - timedelta(days=1)
    return (dt - ref).total_seconds() / 60.0

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--emit-rows", metavar="PATH", help="write POST-ready summarized rows (no score) for n8n seeding")
    args = ap.parse_args()

    if not os.path.exists(EXPORT):
        print(f"ERROR: export not found at {EXPORT}", file=sys.stderr); sys.exit(1)

    print(f"Streaming {EXPORT} ({os.path.getsize(EXPORT)/1e6:.0f} MB) ...", flush=True)
    step_minute, sleep_samples, n_step, n_sleep = stream(EXPORT)
    print(f"  parsed {n_step:,} step records, {n_sleep:,} sleep records", flush=True)

    daily_steps = dedup_steps(step_minute)
    sleep_by_date = build_sessions(sleep_samples)
    print(f"  {len(daily_steps):,} step-days, {len(sleep_by_date):,} sleep-nights", flush=True)

    # bedtime consistency: trailing 14-night avg offset
    nights_sorted = sorted(sleep_by_date.keys())
    trailing = []
    for night in nights_sorted:
        row = sleep_by_date[night]
        off = bedtime_offset_min(row["_bedtime_dt"])
        if len(trailing) >= 5:            # need a small baseline before judging consistency
            avg = sum(trailing[-14:]) / len(trailing[-14:])
            row["bedtime_dev_min"] = round(abs(off - avg), 1)
        else:
            row["bedtime_dev_min"] = None
        trailing.append(off)

    # score every night + merge steps into per-date rows
    all_dates = sorted(set(daily_steps) | set(sleep_by_date))
    rows = []
    for d in all_dates:
        s = sleep_by_date.get(d)
        rec = {"date": d.isoformat(), "steps": daily_steps.get(d)}
        if s:
            sc, comp, live_w = score(s)
            rec.update({k: s[k] for k in ("asleep_min", "deep_min", "rem_min", "core_min",
                                          "awake_min", "inbed_min", "awakenings", "bedtime", "waketime")})
            rec["efficiency"] = round(s["asleep_min"] / s["inbed_min"], 3) if s["inbed_min"] else None
            rec["bedtime_dev_min"] = s.get("bedtime_dev_min")
            rec["sleep_score"] = sc
            rec["score_signals"] = f"{len(comp) - list(comp.values()).count(None)}/6"
        rows.append(rec)

    # --- write local outputs (health data stays in the gitignored vault) ---
    out_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "vault", "projects", "health-tracker")
    out_dir = os.path.abspath(out_dir)
    os.makedirs(out_dir, exist_ok=True)
    data_path = os.path.join(out_dir, "backfill-data.json")
    with open(data_path, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2)
    print(f"  wrote {len(rows):,} daily rows -> {data_path}", flush=True)

    if args.emit_rows:
        seed = [{k: r.get(k) for k in ("date", "steps", "asleep_min", "deep_min", "rem_min",
                 "core_min", "awake_min", "inbed_min", "awakenings", "bedtime", "waketime",
                 "efficiency", "bedtime_dev_min")} for r in rows]
        with open(args.emit_rows, "w", encoding="utf-8") as f:
            json.dump({"source": "backfill", "days": seed}, f, indent=2)
        print(f"  wrote {len(seed):,} POST-ready rows -> {args.emit_rows}", flush=True)

    # --- printed summary ---
    scored = [r for r in rows if r.get("sleep_score") is not None]
    stepd = [r for r in rows if r.get("steps")]
    print("\n================ SUMMARY ================")
    if scored:
        avg_score = sum(r["sleep_score"] for r in scored) / len(scored)
        avg_asleep = sum(r["asleep_min"] for r in scored) / len(scored)
        print(f"Scored nights: {len(scored):,}  (first {scored[0]['date']}, last {scored[-1]['date']})")
        print(f"Avg sleep score: {avg_score:.0f}/100   Avg time asleep: {avg_asleep/60:.1f} h")
    if stepd:
        avg_steps = sum(r["steps"] for r in stepd) / len(stepd)
        print(f"Step-days: {len(stepd):,}   Avg daily steps: {avg_steps:,.0f}")
    print("\nLast 14 nights (date | score | asleep | deep% | rem% | eff | wakes | steps):")
    for r in [x for x in rows if x.get("sleep_score") is not None][-14:]:
        deep_pct = 100 * r["deep_min"] / r["asleep_min"] if r["asleep_min"] else 0
        rem_pct = 100 * r["rem_min"] / r["asleep_min"] if r["asleep_min"] else 0
        eff = f"{r['efficiency']*100:.0f}%" if r.get("efficiency") else "  - "
        steps = f"{r['steps']:,}" if r.get("steps") else "  -"
        print(f"  {r['date']}  {r['sleep_score']:>3}  {r['asleep_min']/60:>4.1f}h  "
              f"{deep_pct:>4.0f}%  {rem_pct:>4.0f}%  {eff:>4}  {r['awakenings']:>2}  {steps:>7}")
    print("========================================")

if __name__ == "__main__":
    main()
