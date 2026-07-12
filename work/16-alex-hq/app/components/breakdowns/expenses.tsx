"use client";

/* Expenses drill-down (P9 extraction from dashboard.tsx, moved verbatim): the usual metric rows
   plus MTD split by category (from the mtd_by_category value_text). */

import type { Project } from "@/lib/types";
import { ageLabel, clean, fmtDateTime, fmtNum } from "@/lib/types";
import { MetricRow } from "@/components/overlay";

export function ExpensesBreakdown({ proj, now }: { proj: Project; now: number }) {
  const cat = proj.metrics["mtd_by_category"];
  const parsed = cat
    ? clean(cat.value_text)
        .split("·")
        .map((s) => s.trim())
        .map((s) => {
          const m2 = s.match(/^(.*\S)\s+(\d+(?:\.\d+)?)$/);
          return m2 ? { name: m2[1], kr: Number(m2[2]) } : null;
        })
        .filter((r): r is { name: string; kr: number } => r !== null)
    : [];
  return (
    <div>
      <div className="mb-1 text-xs tabular-nums" style={{ color: "var(--mute)" }}>
        last event {fmtDateTime(proj.last_ts)} · {ageLabel(proj.last_ts, now)}
      </div>
      {Object.entries(proj.metrics)
        .filter(([k]) => k !== "mtd_by_category")
        .map(([k, m2]) => (
          <MetricRow key={k} mkey={k} m={m2} now={now} />
        ))}
      {cat ? (
        <div className="mt-3">
          <div className="mb-1 kicker" style={{ color: "var(--cyan)" }}>
            {clean(cat.headline) || "MTD by category"}
          </div>
          {parsed.length > 0 ? (
            parsed.map((r) => (
              <div key={r.name} className="note-row">
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className="text-sm tabular-nums" style={{ color: "var(--custard)" }}>
                  {fmtNum(r.kr)} kr
                </span>
              </div>
            ))
          ) : (
            <p className="text-sm" style={{ color: "var(--mute)" }}>
              {clean(cat.value_text)}
            </p>
          )}
          <p className="mt-2 text-xs tabular-nums" style={{ color: "var(--mute)" }}>
            as of {fmtDateTime(cat.ts)}
          </p>
        </div>
      ) : null}
    </div>
  );
}
