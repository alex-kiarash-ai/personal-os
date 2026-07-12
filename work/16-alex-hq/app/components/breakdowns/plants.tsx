"use client";

/* Plants drill-down (P9 extraction from dashboard.tsx, moved verbatim):
   all plants with cadence, last watered and next due — due first. */

import type { LifeData } from "@/lib/types";
import { plantsDue } from "@/lib/data";
import { Dot } from "@/components/primitives";

export function PlantsBreakdown({ life, now }: { life: LifeData | null | "failed"; now: number }) {
  if (life === "failed")
    return (
      <p className="text-sm" style={{ color: "var(--mute)" }}>
        Watering data not synced yet. Run /alex-hq on the ThinkPad.
      </p>
    );
  if (!life)
    return (
      <p className="text-sm" style={{ color: "var(--mute)" }}>
        checking the plants…
      </p>
    );
  // due-today first, then by next watering date; overdue carry-over is never shown as an alarm
  const rows = plantsDue(life, now).sort(
    (a, b) => Number(b.due_today) - Number(a.due_today) || a.next_due.localeCompare(b.next_due) || a.name.localeCompare(b.name)
  );
  return (
    <div>
      {rows.map((p) => (
        <div key={p.name} className="note-row">
          <Dot status={p.due_today ? "amber" : "green"} />
          <span className="min-w-0 flex-1 truncate">{p.name}</span>
          <span className="text-xs tabular-nums" style={{ color: "var(--mute)" }}>
            every {p.every_days}d · watered {p.last_watered}
          </span>
          <span
            className="w-24 flex-none text-right text-xs tabular-nums"
            style={{ color: p.due_today ? "var(--warn)" : "var(--mute)" }}
          >
            {p.due_today ? "due today" : `next ${p.next_due}`}
          </span>
        </div>
      ))}
      <p className="mt-2 text-xs" style={{ color: "var(--mute)" }}>
        only plants due today are flagged · next watering date shown per plant · data as of {life.plants.as_of ?? "unknown"} · tell Alex &quot;watered&quot; and the sheet gets stamped
      </p>
    </div>
  );
}
