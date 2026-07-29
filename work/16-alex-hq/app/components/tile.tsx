"use client";

/* The instrument tile (P9 extraction from dashboard.tsx) + the TileDef shape the dashboard tile
   map builds. A tile is a motion.button that morphs (shared layoutId) into its DetailOverlay on
   click. 2026-07-29 reskin: tiles carry real CSS 3D — a pointer-tracked tilt (rotateX/rotateY
   springs + a glare sheen following the cursor) on hover-capable fine-pointer devices only.
   Touch devices and prefers-reduced-motion get the flat card unchanged, so the always-on phone
   glance pays zero motion cost. */

import { useEffect, useState } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
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

const TILT_SPRING = { stiffness: 260, damping: 22 };

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
  // tilt only where a hovering fine pointer exists AND the OS didn't ask for reduced motion
  const reduced = useReducedMotion() ?? false;
  const [fine, setFine] = useState(false);
  useEffect(() => {
    setFine(window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  }, []);
  const tilt = fine && !reduced;

  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const rxSpring = useSpring(rx, TILT_SPRING);
  const rySpring = useSpring(ry, TILT_SPRING);

  return (
    <motion.button
      layoutId={`tile-${id}`}
      onClick={() => onOpen(id)}
      className={`tile ${status !== "green" ? `tile-${status}` : ""} flex flex-col gap-2 p-5 text-left ${className}`}
      /* the tilt motion values attach ONLY on tilt-capable profiles: a perspective transform on
         touch devices would force GPU rasterization of every tile (softer text) for zero effect */
      style={
        tilt
          ? { borderRadius: "1rem", rotateX: rxSpring, rotateY: rySpring, transformPerspective: 900 }
          : { borderRadius: "1rem" }
      }
      initial={{ opacity: 0, y: 28, scale: 0.96 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ ...spring, delay: Math.min(index * 0.055, 0.5) }}
      whileHover={{ y: -5, scale: 1.02 }}
      whileTap={{ scale: 0.975 }}
      onPointerMove={(e) => {
        if (!tilt) return;
        const el = e.currentTarget;
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) return;
        const px = (e.clientX - b.left) / b.width;
        const py = (e.clientY - b.top) / b.height;
        ry.set((px - 0.5) * 7);
        rx.set((0.5 - py) * 5);
        el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
        el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
      }}
      onPointerLeave={() => {
        rx.set(0);
        ry.set(0);
      }}
    >
      <div className="flex w-full items-center justify-between gap-3">
        <span className="kicker">{kicker}</span>
        <Dot status={status} pulse={pulse} />
      </div>
      {/* healthy zeros whisper (dim); unactioned action-counts burn Rusty Spice (C8 —
          §4.2 allows warning colors in big stat numbers, never paragraphs). A SHORT string
          accent (a unit like "/ 100" or "steps") joins the numeral's baseline instead of
          stacking under it with a gap (Phase B #10); long accents keep their own row. */}
      {typeof accent === "string" && accent.length <= 8 ? (
        <div className="flex items-baseline gap-2">
          <div className="big" style={dim ? { color: "var(--dim)" } : burn ? { color: "var(--warn)" } : undefined}>
            {big}
          </div>
          <span className="text-sm" style={{ color: "var(--aqua)" }}>
            {accent}
          </span>
        </div>
      ) : (
        <>
          <div className="big" style={dim ? { color: "var(--dim)" } : burn ? { color: "var(--warn)" } : undefined}>
            {big}
          </div>
          {accent ? (
            <div className="text-sm" style={{ color: "var(--aqua)" }}>
              {accent}
            </div>
          ) : null}
        </>
      )}
      {sub ? (
        // red subs carry the offender names — one extra line so the alarm is never clipped (C17).
        // R2-4: the sub is the tile's second READ, so it takes the law's named secondary tier.
        <p className={`${status === "red" ? "line-clamp-3" : "line-clamp-2"} text-sm leading-snug`} style={{ color: "var(--aqua)" }}>
          {sub}
        </p>
      ) : null}
      {stamp ? (
        <p className="text-xs tabular-nums" style={{ color: "var(--mute)" }}>
          {stamp}
        </p>
      ) : null}
      {history ? <Sparkline history={history} /> : null}
      <span aria-hidden className="tile-glare" />
    </motion.button>
  );
}
