"use client";

/* The glass instrument tile (P9 extraction from dashboard.tsx, moved verbatim) + the TileDef
   shape the dashboard tile map builds. A tile is a motion.button that morphs (shared layoutId)
   into its DetailOverlay on click. */

import { motion } from "motion/react";
import type { Metric, Status } from "@/lib/types";
import { Dot, Sparkline, spring } from "@/components/primitives";

/* The tile-map row the dashboard builds per glance tile: id + display fields + which projects and
   metric keys the drill-down should surface. */
export type TileDef = {
  id: string;
  kicker: string;
  projects: string[];
  status: Status;
  big: React.ReactNode;
  dim?: boolean;
  /* C8: an unactioned action-count (urgent / act now / broken) burns Rusty Spice — the mirror
     of the dim-zeros rule, so "zeros whisper, actionable counts burn" holds in both directions.
     Independent of the dot: Morning Brief can show a burning 2 on a green run. */
  burn?: boolean;
  /* C11: exactly one dot per section carries the pulse — the dashboard marks its worst red */
  pulse?: boolean;
  accent?: React.ReactNode;
  sub?: string;
  stamp?: string;
  history?: Metric["history"];
  className?: string;
  metricKeys?: string[];
};

export function Tile({
  id,
  kicker,
  status,
  big,
  dim,
  burn,
  pulse,
  accent,
  sub,
  stamp,
  history,
  className = "",
  index,
  onOpen,
}: {
  id: string;
  kicker: string;
  status: Status;
  big: React.ReactNode;
  dim?: boolean;
  burn?: boolean;
  pulse?: boolean;
  accent?: React.ReactNode;
  sub?: string;
  stamp?: string;
  history?: Metric["history"];
  className?: string;
  index: number;
  onOpen: (id: string) => void;
}) {
  return (
    <motion.button
      layoutId={`tile-${id}`}
      onClick={() => onOpen(id)}
      className={`tile ${status !== "green" ? `tile-${status}` : ""} flex flex-col gap-2 p-5 text-left ${className}`}
      style={{ borderRadius: "1rem" }}
      initial={{ opacity: 0, y: 28, scale: 0.96 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ ...spring, delay: Math.min(index * 0.055, 0.5) }}
      whileHover={{ y: -5, scale: 1.02 }}
      whileTap={{ scale: 0.975 }}
    >
      <div className="flex w-full items-center justify-between gap-3">
        <span className="kicker">{kicker}</span>
        <Dot status={status} pulse={pulse} />
      </div>
      {/* healthy zeros whisper (dim); unactioned action-counts burn Rusty Spice (C8 —
          §4.2 allows warning colors in big stat numbers, never paragraphs) */}
      <div
        className="big"
        style={dim ? { color: "rgba(148, 210, 189, 0.55)" } : burn ? { color: "var(--warn)" } : undefined}
      >
        {big}
      </div>
      {accent ? (
        <div className="text-sm" style={{ color: "var(--aqua)" }}>
          {accent}
        </div>
      ) : null}
      {sub ? (
        // red subs carry the offender names — one extra line so the alarm is never clipped (C17)
        <p className={`${status === "red" ? "line-clamp-3" : "line-clamp-2"} text-sm leading-snug`} style={{ color: "var(--mute)" }}>
          {sub}
        </p>
      ) : null}
      {stamp ? (
        <p className="text-xs tabular-nums" style={{ color: "var(--mute)" }}>
          {stamp}
        </p>
      ) : null}
      {history ? <Sparkline history={history} /> : null}
    </motion.button>
  );
}
