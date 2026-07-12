"use client";

/* Applications drill-down (P9 extraction from dashboard.tsx, moved verbatim).
   Ordered exactly as Shaheen asked: per lane (BI first, then AI):
   ready to apply · in review · pass rate · spend · today. */

import type { Metric, Project } from "@/lib/types";
import { ageLabel, clean, fmtDateTime, fmtNum } from "@/lib/types";
import { CountUp, Dot } from "@/components/primitives";

export function AppsBreakdown({ projects, now }: { projects: Record<string, Project>; now: number }) {
  const lanes: { slug: string; label: string }[] = [
    { slug: "app-engine-bi", label: "BI lane" },
    { slug: "app-engine-ai", label: "AI lane" },
  ];
  return (
    <div>
      {lanes.map(({ slug, label }) => {
        const p = projects[slug];
        const mm = p?.metrics ?? {};
        const ready = mm.draft_ready_total?.value_num ?? null;
        return (
          <div key={slug} className="mb-4">
            <div className="mb-1 flex items-center gap-2">
              <Dot status={p?.status ?? "amber"} />
              <span className="font-display text-sm font-bold">{label}</span>
              <span className="ml-auto text-xs tabular-nums" style={{ color: "var(--mute)" }}>
                last event {fmtDateTime(p?.last_ts)} · {ageLabel(p?.last_ts, now)}
              </span>
            </div>
            <div className="metric-row">
              <span className="kicker" style={{ color: "var(--cyan)" }}>
                ready to apply · good fit
              </span>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="font-display text-3xl font-bold tracking-tight">
                  {ready !== null ? <CountUp value={ready} /> : "–"}
                </span>
                <span className="text-sm" style={{ color: "var(--mute)" }}>
                  {ready !== null ? "drafted, cleared the fit gate, waiting on you" : "arrives with the next stats run"}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 py-3" style={{ borderBottom: "1px solid rgba(148,210,189,0.12)" }}>
              {[
                ["in review", mm.needs_review_depth],
                ["pass rate %", mm.pass_rate_pct],
                ["spend $", mm.total_spend_usd],
              ].map(([label2, m]) => (
                <div key={label2 as string} className="brain-stat">
                  <span className="v">{m ? ((m as Metric).value_num != null ? fmtNum((m as Metric).value_num) : clean((m as Metric).value_text) || "–") : "–"}</span>
                  <span className="k">{label2 as string}</span>
                </div>
              ))}
            </div>
            <p className="pt-2 text-sm" style={{ color: "var(--mute)" }}>
              today: {fmtNum(mm.drafted_today?.value_num ?? 0)} drafted · {fmtNum(mm.processed_today?.value_num ?? 0)}{" "}
              processed
            </p>
          </div>
        );
      })}
    </div>
  );
}
