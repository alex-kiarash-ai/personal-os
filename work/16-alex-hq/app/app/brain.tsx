"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { motion } from "motion/react";
import { fmtDateTime } from "@/lib/types";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

type GraphNode = { id: string; group: string; degree: number; x?: number; y?: number };
type GraphData = {
  generated_at: string;
  nodes: GraphNode[];
  links: { source: string; target: string }[];
};

/* Brand chart series (color-system.md 4.5): cyan, orange, teal-family supports.
   me = white so it never collides with research's caramel at dot size. */
const GROUP_COLORS: Record<string, string> = {
  projects: "#0a9396",
  people: "#94d2bd",
  business: "#ee9b00",
  me: "#ffffff",
  research: "#ca6702",
};
// Dark Teal (color-system.md #2): quiet, structural - correct for unclassified data per the
// 30% band. Was an off-palette slate (fixed 2026-07-12, d2).
const FALLBACK = "#005f73";

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
  const [size, setSize] = useState({ w: 0, h: 400 });
  // canvas can't resolve CSS custom properties; resolve the real family once
  const fontRef = useRef("sans-serif");
  useEffect(() => {
    fontRef.current = getComputedStyle(document.body).fontFamily || "sans-serif";
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
      setSize({ w, h: w < 640 ? 340 : 420 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

      <div ref={wrapRef} className="brain-wrap">
        {failed ? (
          <p className="p-6 text-sm" style={{ color: "var(--mute)" }}>
            Graph not pushed yet. Run /alex-hq on the ThinkPad to sync the vault graph.
          </p>
        ) : data && size.w > 0 ? (
          <ForceGraph2D
            width={size.w}
            height={size.h}
            graphData={data}
            backgroundColor="rgba(0,0,0,0)"
            linkColor={() => "rgba(148,210,189,0.13)"}
            linkWidth={0.5}
            enableNodeDrag={true}
            cooldownTicks={140}
            nodeLabel={(n) => `${(n as GraphNode).id} · ${(n as GraphNode).group}`}
            nodeCanvasObject={(node, ctx, globalScale) => {
              const n = node as GraphNode;
              const color = GROUP_COLORS[n.group] ?? FALLBACK;
              const r = 1.6 + Math.sqrt(n.degree || 1) * 0.85;
              ctx.shadowColor = color;
              ctx.shadowBlur = 8;
              ctx.beginPath();
              ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.globalAlpha = 0.8; // data stays quieter than the UI accent
              ctx.fill();
              ctx.shadowBlur = 0;
              ctx.globalAlpha = 1;
              if (globalScale > 2.2 || (n.degree >= 12 && globalScale > 1.1)) {
                const fontSize = Math.max(11 / globalScale, 1.6);
                ctx.font = `500 ${fontSize}px ${fontRef.current}`;
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillStyle = "rgba(255,255,255,0.85)";
                ctx.fillText(n.id, n.x!, n.y! + r + 1.5);
              }
            }}
          />
        ) : (
          <p className="p-6 text-sm" style={{ color: "var(--mute)" }}>
            waking the brain…
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {LEGEND.map(([g, label]) => (
          <span key={g} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--mute)" }}>
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: GROUP_COLORS[g], boxShadow: `0 0 6px ${GROUP_COLORS[g]}` }}
            />
            {label}
          </span>
        ))}
        <span className="ml-auto text-xs" style={{ color: "var(--mute)" }}>
          drag · zoom · index + log excluded
        </span>
      </div>
    </motion.div>
  );
}
