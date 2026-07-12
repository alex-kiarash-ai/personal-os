"use client";

/* Data hooks + pure helpers for the HQ dashboard (P9 extraction from dashboard.tsx).
   Moved verbatim - no logic change - so dashboard.tsx keeps only composition + the tile map.
   The client fetch, cadence-stamp render logic, plant due-ness math, worst-status fold and the
   registry-by-key index all live here now; the render trees import them. */

import { useEffect, useState } from "react";
import type { Cadence, LifeData, ProjectsData, RegProject, Status } from "./types";
import { cadenceStale, daysSinceStockholm, fmtDateTime, fmtDay } from "./types";

/* Client fetch of a static /data JSON (the graph.json pattern).
   null = loading, "failed" = not synced. First client render matches the server
   (loading state), data arrives via state — no hydration risk. */
export function useJson<T>(url: string): T | null | "failed" {
  const [data, setData] = useState<T | null | "failed">(null);
  useEffect(() => {
    let alive = true;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => alive && setData(d))
      .catch(() => alive && setData("failed"));
    return () => {
      alive = false;
    };
  }, [url]);
  return data;
}

/* a LIVE/EVENT project that has never produced (first_fire null) says so, honestly (design 1.4) */
export const neverFired = (reg: RegProject | null | undefined): boolean =>
  !!reg && (reg.state === "LIVE" || reg.state === "EVENT") && !reg.first_fire;

/* Stockholm same-calendar-day check (pure function of ts/now - hydration-safe) */
export const stockholmDay = (t: number) => fmtDateTime(new Date(t).toISOString()).slice(0, 10);

/* The per-class tile stamp (design 4.2). daily/weekdays/always-on: "today HH:MM" when fresh,
   "missed today" once past expected_hours; weekly: "weekly · last Mon 06 Jul"; monthly:
   "monthly · {note}" and never an age; on-demand/event: just the label - never stale. */
export function cadenceStamp(cad: Cadence | null | undefined, ts: string | null | undefined, now: number): string | undefined {
  if (!cad) return ts ? `last run ${fmtDateTime(ts)}` : undefined;
  switch (cad.label) {
    case "daily":
    case "weekdays":
    case "always-on": {
      if (!ts) return cad.note ? `${cad.label} · ${cad.note}` : cad.label;
      const t = fmtDateTime(ts);
      if (stockholmDay(new Date(ts).getTime()) === stockholmDay(now)) return `today ${t.slice(11)}`;
      return cadenceStale(cad, ts, now) ? `missed today · last ${t}` : `last ${t}`;
    }
    case "weekly":
      return `weekly · last ${fmtDay(ts)}`;
    case "monthly":
      return `monthly · ${cad.note ?? "updates at month-end"}`;
    default:
      // on-demand / event / dormant / parked / retired: the label is the whole story
      return cad.note ? `${cad.label} · ${cad.note}` : cad.label;
  }
}

const STATE_LABEL: Record<string, string> = {
  LIVE: "no telemetry yet",
  "ON-DEMAND": "on-demand",
  EVENT: "event-triggered",
  DORMANT: "dormant",
  PARKED: "parked",
  RETIRED: "retired",
};
export const idleLabel = (state: string) => STATE_LABEL[state] ?? state.toLowerCase();

/* due-ness computed at render from raw dates, so the card is right even if the sync lagged.
   "due_today" = today lands on the watering cadence (every Nth day from last watered), NOT a
   growing overdue counter — carry-over / "Nd over" is deliberately gone (Shaheen 2026-07-08:
   show only what's due today). overdue_days is kept solely for the stale-log guard below. */
export function plantsDue(life: LifeData, now: number) {
  return life.plants.items.map((p) => {
    const daysSince = daysSinceStockholm(p.last_watered, now);
    const overdue_days = daysSince - p.every_days;
    const due_today = daysSince > 0 && daysSince % p.every_days === 0;
    const cycles = Math.max(1, Math.ceil(daysSince / p.every_days)); // next on-or-after today
    const nd = new Date(p.last_watered + "T00:00:00Z");
    nd.setUTCDate(nd.getUTCDate() + cycles * p.every_days);
    return { ...p, overdue_days, due_today, next_due: nd.toISOString().slice(0, 10) };
  });
}

/* worst-of two statuses (red > amber > green). Folds project-level status into a metric status so
   a red run_status never hides behind a green metric. */
export const worst = (a?: Status, b?: Status): Status => {
  const rank = { green: 0, amber: 1, red: 2 };
  return (rank[a ?? "green"] >= rank[b ?? "green"] ? a : b) ?? "green";
};

/* registry index by both the project name AND its hq_slug, so a tile can look its cadence up by
   whichever key it holds. Empty when the registry is loading or failed. */
export function regByKey(registry: ProjectsData | null | "failed"): Record<string, RegProject> {
  const out: Record<string, RegProject> = {};
  if (registry && registry !== "failed")
    for (const r of registry.projects) {
      out[r.name] = r;
      if (r.hq_slug) out[r.hq_slug] = r;
    }
  return out;
}

export function prettyKey(k: string) {
  return k.replace(/_/g, " ").replace(/\bpct\b/, "%").replace(/\busd\b/, "$").replace(/\bkr\b/, "kr");
}
