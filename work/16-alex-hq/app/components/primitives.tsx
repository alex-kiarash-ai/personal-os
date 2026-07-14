"use client";

/* Small presentational primitives for the HQ dashboard (P9 extraction from dashboard.tsx).
   Dot (status pip), CountUp (animated numeral), Sparkline (14-point trend). Moved verbatim -
   no logic change. `spring` is the one shared motion transition every card uses. */

import { useEffect, useId, useRef, useState } from "react";
import { motion, animate, useReducedMotion } from "motion/react";
import type { Metric, Status } from "@/lib/types";
import { fmtNum } from "@/lib/types";

export const spring = { type: "spring" as const, stiffness: 260, damping: 26 };

/* pulse is opt-in since C11: the section decides its ONE worst dot; a plain red dot is a
   steady alarm, never a heartbeat. */
export function Dot({ status, pulse = false }: { status: Status; pulse?: boolean }) {
  return <span className={`dot dot-${status}${pulse ? " dot-pulse" : ""}`} aria-label={status} />;
}

export function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [text, setText] = useState(() => fmtNum(value) + suffix);
  /* C11: the first paint shows the FINAL value — the old 0→value run meant the first 1.2s of
     every glance showed numbers that were wrong. The count-up survives only for LIVE updates
     (a C2 refresh changing the value), animating from the previous value, and sits still when
     the OS asks for reduced motion (imperative animate() doesn't read MotionConfig). */
  const reduced = useReducedMotion();
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value || reduced) {
      setText(fmtNum(value) + suffix);
      return;
    }
    const controls = animate(from, value, {
      duration: 1.2,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setText(fmtNum(Number.isInteger(value) ? Math.round(v) : v) + suffix),
    });
    return () => controls.stop();
  }, [value, suffix, reduced]);
  return <span className="tabular-nums">{text}</span>;
}

export function Sparkline({ history, big = false }: { history: Metric["history"]; big?: boolean }) {
  const gid = useId();
  // C11: the draw-in is decorative — under OS reduced motion the line just IS there
  const reduced = useReducedMotion();
  const vals = history.map((h) => h.value_num).filter((v): v is number => v != null);
  // fewer than 5 points reads as noise, not signal — instrument panels stay quiet
  if (vals.length < (big ? 2 : 5))
    return big ? (
      <p className="text-xs" style={{ color: "var(--mute)" }}>
        history builds as runs accumulate
      </p>
    ) : null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const h = big ? 40 : 28;
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * 100, h - 4 - ((v - min) / span) * (h - 10)]);
  const line = pts.map((p) => p.join(",")).join(" ");
  const area = `M0,${h} L${pts.map((p) => p.join(",")).join(" L")} L100,${h} Z`;
  return (
    <svg viewBox={`0 0 100 ${h}`} className={`${big ? "h-12" : "h-7"} w-full`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--cyan)" stopOpacity="0.1" />
          <stop offset="100%" stopColor="var(--cyan)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <motion.polyline
        points={line}
        fill="none"
        stroke="var(--cyan)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        initial={reduced ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.2, ease: "easeOut" }}
      />
    </svg>
  );
}
