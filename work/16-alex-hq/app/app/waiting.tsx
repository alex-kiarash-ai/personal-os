"use client";

/* The "Waiting on you" strip (design 4.1.2 / 1.2): a slim full-width bar directly under the
   header, above the Notes card. Renders ONLY when the human-actions queue has open items —
   an empty queue renders nothing so the healthy screen stays calm.

   Data: the `human-actions` summary metric pushed to HQ by /alex-hq (P2), read as
   metric(summary, "human-actions", "open_count"): value_num = count, status drives the border
   (teal when green/amber, tile-red when the cap is critical), headline = top item + "· oldest Nd".
   The full per-row queue lives server-side in system/human-actions.jsonl which the dashboard does
   NOT read; this strip surfaces the pushed summary only, pointer-style. */

import { useEffect } from "react";
import { motion } from "motion/react";
import type { Metric } from "@/lib/types";
import { clean, fmtDateTime, ageLabel } from "@/lib/types";

const spring = { type: "spring" as const, stiffness: 260, damping: 26 };

/* The pushed headline is "{top item} ({due}) | oldest item {N}d" — split the oldest-days tail
   off the count line so the strip reads "Waiting on you · 6 · oldest 28d" with the top item under. */
function splitHeadline(headline: string): { top: string; oldest: string | null } {
  const h = clean(headline);
  const parts = h.split("|");
  const top = (parts[0] ?? "").trim();
  const rest = parts.slice(1).join("|").trim();
  const m = rest.match(/oldest[^\d]*(\d+)\s*d/i);
  return { top, oldest: m ? `oldest ${m[1]}d` : null };
}

export function WaitingStrip({
  metric,
  open,
  onOpen,
  onClose,
  now,
}: {
  metric: Metric | null;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  now: number;
}) {
  // fail-calm: absent/null metric, or zero open items, renders nothing
  const count = metric?.value_num ?? 0;
  if (!metric || count <= 0) return null;

  const critical = metric.status === "red";
  const { top, oldest } = splitHeadline(metric.headline);

  return (
    <>
      <motion.button
        layoutId="waiting-strip"
        onClick={onOpen}
        aria-live="polite"
        aria-label={`Waiting on you: ${count} ${count === 1 ? "item" : "items"}${oldest ? `, ${oldest}` : ""}. Tap for the full queue.`}
        className={`tile ${critical ? "tile-red" : ""} flex w-full items-center gap-3 px-5 py-3 text-left`}
        style={{ borderRadius: "1rem" }}
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.99 }}
      >
        <span className={`dot ${critical ? "dot-red" : "dot-amber"}`} aria-hidden />
        <span className="kicker whitespace-nowrap" style={critical ? { color: "var(--paper)" } : undefined}>
          Waiting on you
        </span>
        <span className="font-display flex-none text-lg font-bold tabular-nums">{count}</span>
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
        <span className="flex-none text-xs" style={{ color: "var(--mute)" }} aria-hidden>
          ›
        </span>
      </motion.button>

      {open ? <WaitingOverlay metric={metric} now={now} onClose={onClose} /> : null}
    </>
  );
}

/* Drill-down: the layoutId morph from the strip to a card. Surfaces the pushed summary only
   (count, status, the top-item headline, the oldest-days) plus one line explaining these are
   items only Shaheen can do. The full per-row queue lives in system/human-actions.jsonl,
   server-side, which the dashboard deliberately does not read (pointer-style, SV6). */
function WaitingOverlay({ metric, now, onClose }: { metric: Metric; now: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const count = metric.value_num ?? 0;
  const critical = metric.status === "red";
  const { top, oldest } = splitHeadline(metric.headline);

  return (
    <motion.div
      className="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 backdrop" onClick={onClose} />
      <motion.div
        layoutId="waiting-strip"
        transition={spring}
        role="dialog"
        aria-modal="true"
        aria-label="Waiting on you breakdown"
        className={`tile ${critical ? "tile-red" : ""} relative z-10 flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden`}
        style={{ borderRadius: "1rem", cursor: "default" }}
      >
        <div className="flex items-center justify-between gap-3 p-5 pb-3">
          <span className="kicker">Waiting on you · breakdown</span>
          <button onClick={onClose} className="close-btn" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-6">
          <div className="mb-3 flex items-baseline gap-3">
            <span className="big">{count}</span>
            <span className="text-sm" style={{ color: "var(--mute)" }}>
              {count === 1 ? "thing" : "things"} only you can do{oldest ? ` · ${oldest}` : ""}
            </span>
            <span className="ml-auto">
              <span className={`dot dot-${metric.status}`} aria-label={metric.status} />
            </span>
          </div>
          <p className="mb-4 text-sm leading-relaxed" style={{ color: "var(--aqua)" }}>
            These are the items no automation can clear on its own: a limit to raise, a fix that
            needs your hands, a decision only you can make. Alex tracks and ages them; you close them.
          </p>
          {top ? (
            <div className="metric-row">
              <span className="kicker" style={{ color: "var(--cyan)" }}>
                oldest open item
              </span>
              <p className="mt-1 text-sm leading-snug" style={{ color: "var(--paper)" }}>
                {top}
              </p>
            </div>
          ) : null}
          <p className="mt-4 text-xs tabular-nums" style={{ color: "var(--mute)" }}>
            the full queue lives in the vault (system/human-actions.jsonl) · this is the pushed
            summary · updated {fmtDateTime(metric.ts)} · {ageLabel(metric.ts, now)}
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}
