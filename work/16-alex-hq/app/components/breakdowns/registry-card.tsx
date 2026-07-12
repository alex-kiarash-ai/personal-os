"use client";

/* Registry card (P9 extraction from dashboard.tsx, moved verbatim): a registered project that
   pushes no live telemetry. Says what it is and why it's quiet, so the ticket is informative
   instead of a dead end. */

import type { RegProject } from "@/lib/types";
import { idleLabel, neverFired } from "@/lib/data";

export function RegistryCard({ reg }: { reg: RegProject }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="state-chip">{reg.state}</span>
        {reg.num ? (
          <span className="text-xs tabular-nums" style={{ color: "var(--mute)" }}>
            #{String(reg.num).padStart(2, "0")}
          </span>
        ) : null}
        {neverFired(reg) ? (
          <span className="text-xs" style={{ color: "var(--warn)" }}>
            never fired
          </span>
        ) : reg.first_fire ? (
          <span className="text-xs tabular-nums" style={{ color: "var(--mute)" }}>
            first fired {reg.first_fire}
            {reg.first_fire_kind === "drill" ? " (drill)" : ""}
          </span>
        ) : null}
        <span className="ml-auto text-xs" style={{ color: "var(--mute)" }}>
          trigger · {reg.trigger}
        </span>
      </div>
      <p className="text-sm leading-relaxed" style={{ color: "var(--mute)" }}>
        {reg.state === "LIVE"
          ? "Runs on a schedule but doesn't push live metrics to HQ yet. On the board because it's a registered project."
          : `Reports on demand, not on a schedule (${idleLabel(reg.state)}). On the board because it's a registered project.`}
      </p>
    </div>
  );
}
