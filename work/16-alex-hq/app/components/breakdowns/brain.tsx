"use client";

/* Alex Brain drill-down (P9 extraction from dashboard.tsx, moved verbatim):
   the counts, the graph build stamp, then the stack. */

import type { Metric, Project, ProjectsData } from "@/lib/types";
import { clean, fmtDateTime, fmtNum, STACK } from "@/lib/types";
import { useJson } from "@/lib/data";

export function BrainBreakdown({ projects }: { projects: Record<string, Project> }) {
  const infra = projects["infra"]?.metrics ?? {};
  // browser cache makes this second graph.json fetch free (BrainGraph already pulled it)
  const graph = useJson<{ generated_at: string }>("/data/graph.json");
  const registry = useJson<ProjectsData>("/data/projects.json");
  const registered = registry && registry !== "failed" ? registry.count : null;
  const reporting = Object.keys(projects).filter((p) => p !== "me").length;
  // graph.json's own stamp is the SINGLE source for the brain-graph stamp (b9 fix 2026-07-12);
  // the old fallback to the pushed infra.brain_graph metric could serve a stale value.
  const graphStamp = graph && graph !== "failed" ? fmtDateTime(graph.generated_at) : null;
  const counts: [string, Metric | undefined | null, string | null][] = [
    ["vault pages", infra.vault_pages, null],
    ["mcp tools", infra.mcp_tools, null],
    ["scheduled jobs", infra.scheduled_jobs_active, null],
    ["n8n up + ran today", infra.n8n_up_today, null],
    ["n8n broken today", infra.n8n_broken_today, null],
    ["projects registered", null, registered != null ? String(registered) : "–"],
    ["reporting live", null, String(reporting)],
  ];
  return (
    <div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 pb-2 sm:grid-cols-3">
        {counts.map(([label, m, fixed]) => (
          <div key={label} className="brain-stat">
            <span className="v">
              {fixed ?? (m ? (m.value_num != null ? fmtNum(m.value_num) : clean(m.value_text) || "–") : "–")}
            </span>
            <span className="k">{label}</span>
          </div>
        ))}
      </div>
      {graphStamp ? (
        <p className="pb-3 text-xs tabular-nums" style={{ color: "var(--mute)" }}>
          vault graph updated {graphStamp}
        </p>
      ) : null}
      <div className="mb-1 mt-2 kicker" style={{ color: "var(--cyan)" }}>
        the stack
      </div>
      {STACK.map((s) => (
        <div key={s.name} className="stack-row">
          <span className="name">{s.name}</span>
          <span className="what">{s.what}</span>
        </div>
      ))}
    </div>
  );
}
