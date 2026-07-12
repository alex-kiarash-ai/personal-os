"use client";

/* To-Do drill-down (P9 extraction from dashboard.tsx, moved verbatim):
   open build-board items grouped by status, In Progress first. */

import type { TodosData } from "@/lib/types";
import { fmtDateTime } from "@/lib/types";

const TODO_GROUPS = ["In Progress", "Next", "Blocked", "Planned"] as const;

export function TodoBreakdown({ todos }: { todos: TodosData | null | "failed" }) {
  if (todos === "failed")
    return (
      <p className="text-sm" style={{ color: "var(--mute)" }}>
        Board not synced yet. Run /alex-hq on the ThinkPad.
      </p>
    );
  if (!todos)
    return (
      <p className="text-sm" style={{ color: "var(--mute)" }}>
        reading the board…
      </p>
    );
  return (
    <div>
      {TODO_GROUPS.map((g) => {
        const rows = todos.items.filter((i) => i.status === g);
        if (rows.length === 0) return null;
        return (
          <div key={g} className="mb-3">
            <div className="mb-1 kicker" style={{ color: "var(--cyan)" }}>
              {g} · {rows.length}
            </div>
            {rows.map((i) => (
              <div key={i.task} className="note-row">
                <span className="min-w-0 flex-1">{i.task}</span>
                <span className="flex-none text-xs tabular-nums" style={{ color: "var(--mute)" }}>
                  since {i.since}
                </span>
              </div>
            ))}
          </div>
        );
      })}
      <p className="text-xs tabular-nums" style={{ color: "var(--mute)" }}>
        from the Notion build board via the sprint snapshot · as of {fmtDateTime(todos.generated_at)}
      </p>
    </div>
  );
}
