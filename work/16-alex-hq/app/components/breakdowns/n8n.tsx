"use client";

/* n8n drill-down (P9 extraction from dashboard.tsx, moved verbatim): what is broken right now,
   then every active workflow + last run. Freshness is harvest-cadence — the footer says so; an
   error still flips the TILE red instantly. */

import type { N8nList, Status } from "@/lib/types";
import { fmtDateTime } from "@/lib/types";
import { useJson } from "@/lib/data";
import { Dot } from "@/components/primitives";

export function N8nBreakdown() {
  const data = useJson<N8nList>("/data/n8n-workflows.json");
  if (data === "failed")
    return (
      <p className="text-sm" style={{ color: "var(--mute)" }}>
        Workflow list not synced yet. Run /alex-hq on the ThinkPad.
      </p>
    );
  if (!data)
    return (
      <p className="text-sm" style={{ color: "var(--mute)" }}>
        reading the box…
      </p>
    );
  const broken = data.workflows.filter((w) => w.broken_reason);
  /* R2-3 (both review lanes, independently): every non-success row fell through to amber, so the
     ten idle-BY-DESIGN workflows (webhook / MCP / on-demand lanes that have simply never run) wore
     the same warning ring as a genuinely silent scheduled workflow — a wall of look-alike alarms
     inside the overlay you opened to isolate ONE offender. The liveness harvest gives every
     should-have-run workflow a broken_reason, so "no reason + never ran" is exactly idle-by-design,
     and it now speaks the health board's calm hollow grammar. */
  const dotFor = (w: N8nList["workflows"][number]): Status | "idle" =>
    w.broken_reason
      ? w.broken_reason === "errored"
        ? "red"
        : "amber"
      : w.status === "success"
        ? "green"
        : w.last_exec
          ? "amber"
          : "idle";
  return (
    <div>
      <div className="mb-1 kicker" style={{ color: "var(--cyan)" }}>
        broken now
      </div>
      {broken.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--mute)" }}>
          all {data.active_count} active workflows healthy
        </p>
      ) : (
        broken.map((w) => (
          <div key={w.id} className="note-row">
            <Dot status={dotFor(w)} />
            <span className="min-w-0 flex-1 truncate font-medium">{w.name}</span>
            {/* R2-5: measured 2.4:1 (--error) / 3.0:1 (--warn) at 12px on dark — the exact failure
                class the small-text state tokens were chartered for. Error semantics take
                --error-text (Signal Coral on dark, Oxidized on light); warning semantics take
                --count-warm (Custard on dark, Rusty on light), the dot carrying the state. */}
            <span
              className="text-xs"
              style={{ color: w.broken_reason === "errored" ? "var(--error-text)" : "var(--count-warm)" }}
            >
              {w.broken_reason}
            </span>
          </div>
        ))
      )}
      <div className="mb-1 mt-4 kicker" style={{ color: "var(--cyan)" }}>
        all {data.active_count} active · last run
      </div>
      {data.workflows.map((w) => (
        <div key={w.id} className="note-row">
          <Dot status={dotFor(w)} />
          <span className="min-w-0 flex-1 truncate">{w.name}</span>
          <span className="text-xs tabular-nums" style={{ color: "var(--mute)" }}>
            {w.last_exec ? fmtDateTime(w.last_exec) : "idle · never ran"}
          </span>
        </div>
      ))}
      <p className="mt-3 text-xs tabular-nums" style={{ color: "var(--mute)" }}>
        as of {fmtDateTime(data.generated_at)} · list refreshes with each harvest; an error flips the tile red instantly
      </p>
    </div>
  );
}
