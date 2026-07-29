"use client";

/* The WebGL half of the Brain card (2026-07-29 reskin: the 2D canvas force graph became a real
   three.js 3D force graph — the page's ONE WebGL surface, by decision, so the always-on phone
   dashboard stays phone-safe). This inner component exists because next/dynamic does not forward
   refs: the shell (app/brain.tsx) dynamic-imports THIS file ssr:false, and the ref lives here.

   Phone-safety levers, all in this file:
   - device pixel ratio capped at 2 (a DPR-3 phone renders 2.25x fewer pixels);
   - `paused` prop freezes the whole render loop (offscreen card, hidden tab, reduced motion
     after settle) via pauseAnimation();
   - `ambient` prop gates the slow camera auto-orbit — reduced motion means the surface IDLES
     as a formed, static graph instead of animating;
   - low-poly spheres (nodeResolution 12) + gl-line links + labels only on hub nodes. */

import { useCallback, useEffect, useRef } from "react";
import ForceGraph3D from "react-force-graph-3d";
import SpriteText from "three-spritetext";
import { GROUP_COLORS, GROUP_FALLBACK } from "@/lib/graph-colors";

type GraphNode = { id: string; group: string; degree: number; x?: number; y?: number; z?: number };
type GraphData = {
  nodes: GraphNode[];
  links: { source: string; target: string }[];
};

export function Brain3D({
  data,
  width,
  height,
  paused,
  ambient,
  labelFont,
  onSettled,
}: {
  data: GraphData;
  width: number;
  height: number;
  paused: boolean;
  ambient: boolean;
  labelFont: string;
  onSettled: () => void;
}) {
  // react-force-graph-3d's methods object (controls/renderer/pauseAnimation/cameraPosition)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  // the engine also stops after every drag re-heat: auto-frame only the FIRST settle,
  // never while the user is mid-exploration
  const framed = useRef(false);

  // DPR cap + renderer hygiene, once the WebGL context exists
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    try {
      fg.renderer()?.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    } catch {
      // renderer not ready: the default DPR still renders, just less frugally
    }
  }, []);

  // ambient = slow auto-orbit (the "alive" state); off under reduced motion
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    try {
      const controls = fg.controls();
      controls.autoRotate = ambient;
      controls.autoRotateSpeed = 0.55;
    } catch {
      // controls not ready yet; the next effect run catches it
    }
  }, [ambient, data]);

  // the whole render loop obeys `paused` (computed in the shell: offscreen / hidden / settled
  // reduced-motion). Resume must also re-kick after data swaps.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    if (paused) fg.pauseAnimation();
    else fg.resumeAnimation();
  }, [paused]);

  // keep the frame honest across container resizes (rotation/desktop window changes)
  useEffect(() => {
    if (!framed.current) return;
    const fg = fgRef.current;
    if (!fg) return;
    try {
      fg.zoomToFit(0, 40, (n: object) => ((n as GraphNode).degree ?? 0) >= 1);
    } catch {
      // pre-layout resize: the settle handler will frame it
    }
  }, [width, height]);

  const flyTo = useCallback((node: GraphNode) => {
    const fg = fgRef.current;
    if (!fg || node.x == null) return;
    const dist = 90;
    const r = Math.hypot(node.x, node.y ?? 0, node.z ?? 0) || 1;
    const k = 1 + dist / r;
    fg.cameraPosition({ x: node.x * k, y: (node.y ?? 0) * k, z: (node.z ?? 0) * k }, node, 1100);
  }, []);

  return (
    <ForceGraph3D
      ref={fgRef}
      width={width}
      height={height}
      graphData={data}
      backgroundColor="rgba(0,0,0,0)"
      showNavInfo={false}
      warmupTicks={50}
      cooldownTicks={140}
      onEngineStop={() => {
        if (framed.current) return;
        framed.current = true;
        /* Frame the CONNECTED mass, not the whole node set: pages with no resolved links get
           flung far by the charge force, and fitting them shrinks the real cluster to a smudge
           in the middle of the well (the Phase B BLOCK finding). Filtering to degree >= 1 lets
           the stray singletons leave frame — they are noise, the structure is the point. */
        try {
          fgRef.current?.zoomToFit(ambient ? 700 : 0, 40, (n: object) => ((n as GraphNode).degree ?? 0) >= 1);
        } catch {
          // zoomToFit needs layout coords; a miss just keeps the default framing
        }
        setTimeout(onSettled, ambient ? 850 : 50);
      }}
      enableNodeDrag={true}
      nodeLabel={(n) => `${(n as GraphNode).id} · ${(n as GraphNode).group}`}
      nodeColor={(n) => GROUP_COLORS[(n as GraphNode).group] ?? GROUP_FALLBACK}
      nodeVal={(n) => (n as GraphNode).degree || 1}
      nodeRelSize={2.4}
      nodeResolution={12}
      nodeOpacity={0.85}
      /* R2-16 carried into 3D: data stays quieter than the UI accent — links are a faint aqua
         haze, labels only where they inform (hubs), so the graph reads organic, not busy */
      linkColor={() => "#94d2bd"}
      linkOpacity={0.16}
      linkWidth={0}
      nodeThreeObjectExtend={true}
      nodeThreeObject={(n: object) => {
        const node = n as GraphNode;
        if ((node.degree ?? 0) < 12) return false as unknown as object; // sphere only
        const sprite = new SpriteText(node.id);
        sprite.color = "rgba(255,255,255,0.88)";
        sprite.textHeight = 3.4;
        sprite.fontFace = labelFont;
        // three-spritetext's d.ts omits the THREE.Sprite base members it really has
        const base = sprite as unknown as { material: { depthWrite: boolean }; center: { y: number } };
        base.material.depthWrite = false; // transparent sprite background
        base.center.y = -0.9; // label floats above its node
        return sprite;
      }}
      onNodeClick={(n) => flyTo(n as GraphNode)}
    />
  );
}
