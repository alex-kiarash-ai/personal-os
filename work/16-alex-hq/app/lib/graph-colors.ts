/* Brand chart series for the vault graph (color-system.md §4.5): cyan, orange, teal-family
   supports. me = white by the D10 data-viz exception (single-node legibility, not an accent).
   Shared by the legend (app/brain.tsx) and the WebGL renderer (components/brain-3d.tsx). */
export const GROUP_COLORS: Record<string, string> = {
  projects: "#0a9396",
  people: "#94d2bd",
  business: "#ee9b00",
  me: "#ffffff",
  research: "#ca6702",
};

// Dark Teal (color-system.md #2): quiet, structural - correct for unclassified data per the
// 30% band. Was an off-palette slate (fixed 2026-07-12, d2).
export const GROUP_FALLBACK = "#005f73";
