"use client";

/* The Brain card shell: data fetch, sizing, the touch veil (R2-21), visibility/idle management
   and the legend. The WebGL renderer itself lives in components/brain-3d.tsx behind next/dynamic
   ssr:false (refs don't survive next/dynamic, so the ref logic lives inside that chunk). */

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { motion, useReducedMotion } from "motion/react";
import { fmtDateTime } from "@/lib/types";
import { GROUP_COLORS } from "@/lib/graph-colors";

const Brain3D = dynamic(() => import("@/components/brain-3d").then((m) => m.Brain3D), { ssr: false });

type GraphData = {
  generated_at: string;
  nodes: { id: string; group: string; degree: number }[];
  links: { source: string; target: string }[];
};

const LEGEND = [
  ["projects", "projects"],
  ["people", "people"],
  ["business", "business"],
  ["me", "me"],
  ["research", "research"],
] as const;

export function BrainGraph() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 420 });
  // SpriteText draws to its own canvas and can't resolve CSS custom properties; hand it the
  // resolved body family once
  const [labelFont, setLabelFont] = useState("sans-serif");
  useEffect(() => {
    setLabelFont(getComputedStyle(document.body).fontFamily || "sans-serif");
  }, []);

  useEffect(() => {
    fetch("/data/graph.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width;
      // taller on desktop since the 3D upgrade: this card is the page's centerpiece
      setSize({ w, h: w < 640 ? 340 : 480 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* R2-21: TOUCH TRAP, measured (run 37): the graph canvas ate vertical drags outright. On touch
     devices a veil takes the first tap, page scroll passes through it untouched (no
     preventDefault, touch-action: pan-y), and only after a deliberate tap does the graph get the
     gestures. Scrolling the card away disarms it again. Pointer devices never see any of this. */
  const [touchDevice, setTouchDevice] = useState(false);
  const [graphActive, setGraphActive] = useState(false);
  useEffect(() => {
    setTouchDevice(window.matchMedia?.("(hover: none) and (pointer: coarse)").matches ?? false);
  }, []);

  /* WebGL idle management (the reskin's phone-safety contract):
     - offscreen or hidden tab -> the render loop pauses entirely;
     - reduced motion -> no auto-orbit, and once the force engine settles the loop pauses on a
       formed static graph; deliberate engagement (hover on pointer devices, the veil tap on
       touch) resumes it for interaction. */
  const reduced = useReducedMotion() ?? false;
  const [visible, setVisible] = useState(true);
  const [docVisible, setDocVisible] = useState(true);
  const [hovering, setHovering] = useState(false);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        setVisible(e.isIntersecting);
        if (!e.isIntersecting) setGraphActive(false); // scroll-away re-arms the veil
      },
      { threshold: 0.12 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const onVis = () => setDocVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const engaged = touchDevice ? graphActive : hovering;
  const paused = !visible || !docVisible || (reduced && settled && !engaged);

  return (
    <motion.div
      className="tile flex flex-col gap-3 p-5"
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="kicker">The Brain · vault graph</span>
        {data ? (
          <span className="text-xs tabular-nums" style={{ color: "var(--mute)" }}>
            {data.nodes.length} graph pages · nav excluded · {data.links.length} links · built {fmtDateTime(data.generated_at)}
          </span>
        ) : null}
      </div>

      <div
        ref={wrapRef}
        className="brain-wrap"
        style={{ minHeight: size.h }}
        onPointerEnter={() => setHovering(true)}
        onPointerLeave={() => setHovering(false)}
      >
        {failed ? (
          <p className="p-6 text-sm" style={{ color: "var(--mute)" }}>
            Graph not pushed yet. Run /alex-hq on the ThinkPad to sync the vault graph.
          </p>
        ) : data && size.w > 0 ? (
          <Brain3D
            data={data}
            width={size.w}
            height={size.h}
            paused={paused}
            ambient={!reduced}
            labelFont={labelFont}
            onSettled={() => setSettled(true)}
          />
        ) : (
          <p className="p-6 text-sm" style={{ color: "var(--mute)" }}>
            waking the brain…
          </p>
        )}
        {touchDevice && !graphActive && data && !failed ? (
          <button type="button" className="graph-veil" onClick={() => setGraphActive(true)}>
            <span className="kicker">tap to explore in 3D</span>
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {LEGEND.map(([g, label]) => (
          <span key={g} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--mute)" }}>
            {/* R2-16: legend dots stay glowless — pure attention cost, zero information.
                The white "me" dot (D10, a dark-canvas call) gets a hairline ring so it stays
                visible on the light page too (Phase B #8); the in-well node is untouched. */}
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                background: GROUP_COLORS[g],
                boxShadow: g === "me" ? "inset 0 0 0 1px var(--idle-ring)" : undefined,
              }}
            />
            {label}
          </span>
        ))}
        <span className="ml-auto text-xs" style={{ color: "var(--mute)" }}>
          {touchDevice && !graphActive ? "tap the graph to explore · index + log excluded" : "orbit · zoom · drag nodes · index + log excluded"}
        </span>
      </div>
    </motion.div>
  );
}
