"use client";

/* The "Waiting on you" strip (design 4.1.2 / 1.2): a slim full-width bar directly under the
   header, above the Notes card. Renders ONLY when the human-actions queue has open items —
   an empty queue renders nothing so the healthy screen stays calm.

   Non-expanding banner since the 2026-07-13 design review (C6): the old drill-down overlay only
   repeated the strip's own numbers padded with boilerplate — a tap that taught taps don't pay.
   Rider: any future waiting overlay MUST reuse the DetailOverlay focus-trap hook.

   Data: the `human-actions` summary metric pushed to HQ by /alex-hq (P2), read as
   metric(summary, "human-actions", "open_count"): value_num = count, status drives the border
   (teal when green/amber, tile-red when the cap is critical), headline = top item + oldest-days.
   The full per-row queue lives server-side in system/human-actions.jsonl which the dashboard does
   NOT read; this strip surfaces the pushed summary only, pointer-style. */

import { motion } from "motion/react";
import type { Metric } from "@/lib/types";
import { clean } from "@/lib/types";

const spring = { type: "spring" as const, stiffness: 260, damping: 26 };

/* The pushed headline is "{top item} ({due}) · oldest item {N}d" (older producers used "|") —
   find the oldest-days segment wherever it sits, on either separator, and keep the remaining
   segments as the top item so the strip reads "Waiting on you · 6 · oldest 28d" with the top
   item after (C5: the live producer sends "·", the old parser only ever split on "|", so the
   aging badge — the strip's escalation signal — was dead). */
const OLDEST_RE = /oldest[^\d]*(\d+)\s*d\b/i;
function splitHeadline(headline: string): { top: string; oldest: string | null } {
  const h = clean(headline);
  const m = h.match(OLDEST_RE);
  const top = h
    .split(/[|·]/)
    .map((s) => s.trim())
    .filter((s) => s && !OLDEST_RE.test(s))
    .join(" · ");
  return { top, oldest: m ? `oldest ${m[1]}d` : null };
}

export function WaitingStrip({ metric }: { metric: Metric | null }) {
  // fail-calm: absent/null metric, or zero open items, renders nothing
  const count = metric?.value_num ?? 0;
  if (!metric || count <= 0) return null;

  const critical = metric.status === "red";
  const { top, oldest } = splitHeadline(metric.headline);

  return (
    <motion.div
      aria-live="polite"
      aria-label={`Waiting on you: ${count} ${count === 1 ? "item" : "items"}${oldest ? `, ${oldest}` : ""}`}
      className={`tile ${critical ? "strip-red" : ""} flex w-full items-center gap-3 px-5 py-3 text-left`}
      style={{ borderRadius: "1rem", cursor: "default" }}
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      {/* C11: the strip is its own section with one dot — critical keeps the heartbeat */}
      <span className={`dot ${critical ? "dot-red dot-pulse" : "dot-amber"}`} aria-hidden />
      <span className="kicker whitespace-nowrap" style={critical ? { color: "var(--paper)" } : undefined}>
        Waiting on you
      </span>
      {/* C8: the waiting count is an unactioned action-count, so it burns Rusty Spice like its
          tile siblings; on the critical red face it stays white — max contrast wins there */}
      {/* C12: the count is a data numeral, so it speaks Plex Mono like every other numeral */}
      <span
        className="num-display flex-none text-lg"
        style={critical ? undefined : { color: "var(--warn)" }}
      >
        {count}
      </span>
      {oldest ? (
        <span className="flex-none text-xs tabular-nums" style={{ color: "var(--mute)" }}>
          {oldest}
        </span>
      ) : null}
      {top ? (
        <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--aqua)" }}>
          {top}
        </span>
      ) : null}
    </motion.div>
  );
}
