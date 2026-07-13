"use client";

/* The Automation Health board (P9 extraction from dashboard.tsx, moved verbatim): one row per
   REGISTERED project (the full roster from projects.json), live metrics merged on by hq_slug,
   non-reporting projects shown as honest idle tickets. liveRow folds cadence-staleness in. */

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import type { Project, ProjectsData, RegProject, Status } from "@/lib/types";
import { ageLabel, cadenceStale, DISPLAY_NAMES } from "@/lib/types";
import { idleLabel, neverFired } from "@/lib/data";
import { spring } from "@/components/primitives";

type HealthRow = {
  key: string;
  drillId: string;
  label: string;
  display: Status | "idle";
  meta: string;
  sortRank: number;
};

// Live status for a reporting project, cadence-staleness folded in - the cadence now comes from
// the registry row (projects.json), not a hand map (upgrade P4). No registry row (unclaimed slug,
// registry not synced) = the old 48h fallback. Weekly rows amber only past 8 days, monthly rows
// never amber mid-cycle, on-demand/event rows never age (design 4.2); red stays the producer's call.
function liveRow(key: string, label: string, p: Project, now: number, slug: string, reg?: RegProject | null): HealthRow {
  const cad = reg?.cadence;
  const stale = cadenceStale(cad, p.last_ts, now);
  const status: Status = p.status === "red" ? "red" : stale ? "amber" : p.status;
  // weekly/monthly/on-demand ages read wrong without the label ("12d ago" on a monthly is fine)
  const prefix = cad && !["daily", "weekdays", "always-on"].includes(cad.label) ? `${cad.label} · ` : "";
  return {
    key,
    drillId: `proj:${slug}`,
    label,
    display: status,
    meta: `${prefix}${ageLabel(p.last_ts, now)}${stale ? " · stale" : ""}`,
    sortRank: { red: 0, amber: 1, green: 2 }[status],
  };
}

export function HealthBoard({
  projects,
  registry,
  now,
  onOpen,
}: {
  projects: Record<string, Project>;
  registry: ProjectsData | null | "failed";
  now: number;
  onOpen: (id: string) => void;
}) {
  const rows = useMemo<HealthRow[]>(() => {
    const live: Record<string, Project> = {};
    for (const [k, v] of Object.entries(projects)) if (k !== "me") live[k] = v;

    const out: HealthRow[] = [];
    const claimed = new Set<string>();

    if (registry && registry !== "failed") {
      // one row per REGISTERED project — the full roster, from the source of truth
      for (const reg of registry.projects) {
        const lp = reg.hq_slug ? live[reg.hq_slug] : null;
        if (lp && reg.hq_slug) {
          claimed.add(reg.hq_slug);
          out.push(liveRow(reg.name, reg.title, lp, now, reg.hq_slug, reg));
        } else {
          // registered but no live telemetry: show its real state, never a false red/stale.
          // A LIVE/EVENT project that has never produced says "never fired" (design 1.4).
          out.push({
            key: reg.name,
            drillId: `proj:${reg.name}`,
            label: reg.title,
            display: "idle",
            meta: neverFired(reg) ? "never fired" : idleLabel(reg.state),
            sortRank: 3,
          });
        }
      }
    }
    // any live slug the registry didn't claim (infra, plus any future unmapped producer) —
    // keep it so nothing that reports today ever disappears. The infra metrics are produced by
    // #16's daily local push, so its registry row carries their cadence (no hand map).
    const alexHqReg = registry && registry !== "failed" ? registry.projects.find((r) => r.name === "alex-hq") : null;
    for (const [slug, lp] of Object.entries(live)) {
      if (claimed.has(slug)) continue;
      // C9: real names for the unclaimed feeds (raw slugs sat in the red-first top rows)
      out.push(liveRow(slug, DISPLAY_NAMES[slug] ?? slug, lp, now, slug, slug === "infra" ? alexHqReg : null));
    }

    return out.sort((a, b) => a.sortRank - b.sortRank || a.label.localeCompare(b.label));
  }, [projects, registry, now]);

  /* C9: the idle tier (registered, no telemetry expected) costs ~1,500 mobile px for near-zero
     daily signal — on mobile it folds behind a one-tap disclosure; desktop stays fully expanded.
     Nothing is hidden, every registered project stays reachable in one tap. */
  const [idleOpen, setIdleOpen] = useState(false);
  const active = rows.filter((r) => r.sortRank < 3);
  const idle = rows.filter((r) => r.sortRank === 3);

  // C20: say what the population is — registered projects vs unclaimed live feeds
  const regCount = registry && registry !== "failed" ? registry.projects.length : 0;
  const feedCount = rows.length - regCount;
  const popLabel =
    regCount > 0
      ? `${regCount} projects${feedCount > 0 ? ` + ${feedCount} feeds` : ""}`
      : `${rows.length} systems`;

  const loading = registry === null;

  return (
    <motion.div
      className="tile flex flex-col gap-3 p-5"
      style={{ cursor: "default" }}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={spring}
    >
      <div className="flex items-center justify-between">
        <span className="kicker">Automation Health</span>
        <span className="text-xs" style={{ color: "var(--mute)" }}>
          {popLabel} · tap one for what it does
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {active.map((p, i) => (
          <motion.li
            key={p.key}
            initial={{ opacity: 0, x: -12 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ ...spring, delay: i * 0.03 }}
          >
            <button className="health-row" onClick={() => onOpen(p.drillId)}>
              <span className={`dot dot-${p.display}`} aria-label={p.display} />
              <span className="min-w-0 flex-1 truncate font-medium">{p.label}</span>
              <span className="ml-auto flex-none text-xs tabular-nums" style={{ color: "var(--mute)" }}>
                {p.meta}
              </span>
            </button>
          </motion.li>
        ))}
        {idle.map((p, i) => (
          <motion.li
            key={p.key}
            className={idleOpen ? "" : "hidden sm:block"}
            initial={{ opacity: 0, x: -12 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ ...spring, delay: (active.length + i) * 0.03 }}
          >
            <button className="health-row" onClick={() => onOpen(p.drillId)}>
              <span className={`dot dot-${p.display}`} aria-label={p.display} />
              <span className="min-w-0 flex-1 truncate font-medium">{p.label}</span>
              <span className="ml-auto flex-none text-xs tabular-nums" style={{ color: "var(--mute)" }}>
                {p.meta}
              </span>
            </button>
          </motion.li>
        ))}
      </ul>
      {idle.length > 0 ? (
        <button
          type="button"
          className="health-row justify-center sm:hidden"
          onClick={() => setIdleOpen((v) => !v)}
          aria-expanded={idleOpen}
        >
          <span className="text-xs" style={{ color: "var(--mute)" }}>
            {idleOpen ? `hide the ${idle.length} idle / on-demand` : `+ ${idle.length} idle / on-demand`}
          </span>
        </button>
      ) : null}
      {loading ? (
        <p className="text-xs" style={{ color: "var(--mute)" }}>
          loading the full roster…
        </p>
      ) : registry === "failed" ? (
        <p className="text-xs" style={{ color: "var(--mute)" }}>
          showing reporting projects only · registry not synced (run /alex-hq on the ThinkPad)
        </p>
      ) : null}
    </motion.div>
  );
}
