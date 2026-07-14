"use client";

/* The detail overlay + its MetricRow row (P9 extraction from dashboard.tsx). The render logic is
   moved verbatim; the ONLY additions are the a11y focus trap + focus return (design 4.4), which
   are invisible until a keyboard opens the dialog, so the default render is pixel-identical. */

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import type { LifeData, Metric, Project, ProjectsData, TodosData } from "@/lib/types";
import { ageLabel, clean, DESCRIPTIONS, fmtDateTime } from "@/lib/types";
import { CountUp, Dot, Sparkline, spring } from "@/components/primitives";
import { prettyKey } from "@/lib/data";
import { AppsBreakdown } from "@/components/breakdowns/apps";
import { BrainBreakdown } from "@/components/breakdowns/brain";
import { N8nBreakdown } from "@/components/breakdowns/n8n";
import { TodoBreakdown } from "@/components/breakdowns/todos";
import { PlantsBreakdown } from "@/components/breakdowns/plants";
import { ExpensesBreakdown } from "@/components/breakdowns/expenses";
import { RegistryCard } from "@/components/breakdowns/registry-card";

export function MetricRow({ mkey, m, now }: { mkey: string; m: Metric; now: number }) {
  return (
    <div className="metric-row">
      <div className="flex items-baseline justify-between gap-3">
        <span className="kicker" style={{ color: "var(--cyan)" }}>
          {prettyKey(mkey)}
        </span>
        <span className="text-xs tabular-nums" style={{ color: "var(--mute)" }}>
          {fmtDateTime(m.ts)} · {ageLabel(m.ts, now)}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-3">
        {/* C12: one numeral voice — headline numbers match the tiles' Plex Mono, two inches away */}
        <span className="num-display text-3xl tracking-tight">
          {m.value_num != null ? <CountUp value={m.value_num} /> : clean(m.value_text) || "–"}
        </span>
        {m.value_num != null && m.value_text ? (
          <span className="text-sm" style={{ color: "var(--custard)" }}>
            {clean(m.value_text)}
          </span>
        ) : null}
        <span className="ml-auto">
          <Dot status={m.status} />
        </span>
      </div>
      {m.headline ? (
        <p className="mt-1 text-sm leading-snug" style={{ color: "var(--mute)" }}>
          {clean(m.headline)}
        </p>
      ) : null}
      <div className="mt-2">
        <Sparkline history={m.history} big />
      </div>
    </div>
  );
}

export function DetailOverlay({
  tile,
  projects,
  registry,
  now,
  todos,
  life,
  onClose,
}: {
  tile: { id: string; kicker: string; projects: string[]; metricKeys?: string[] };
  projects: Record<string, Project>;
  registry: ProjectsData | null | "failed";
  now: number;
  todos: TodosData | null | "failed";
  life: LifeData | null | "failed";
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // a11y (design 4.4): Escape already closes (kept); ADD a Tab focus-trap so keyboard focus
  // stays inside the open dialog instead of escaping to the page behind the backdrop, and return
  // focus to the element that opened it on close. Pointer users never see any of this.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // wrap at the ends; also pull focus in if it somehow sits outside the dialog
      if (e.shiftKey) {
        if (active === first || !dialogRef.current?.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialogRef.current?.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    // move keyboard focus into the dialog on open (next frame, after the morph mounts children)
    const raf = requestAnimationFrame(() => focusables()[0]?.focus());
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      cancelAnimationFrame(raf);
      // return focus to the invoking tile (if it is still in the DOM)
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [onClose]);

  const projSlug = tile.id.startsWith("proj:") ? tile.id.slice(5) : tile.projects.length === 1 ? tile.projects[0] : null;
  const regList = registry && registry !== "failed" ? registry.projects : [];
  const reg = projSlug ? regList.find((r) => r.hq_slug === projSlug || r.name === projSlug) ?? null : null;
  const isIdleProj = tile.id.startsWith("proj:") && projSlug != null && !projects[projSlug];
  const desc =
    tile.id === "apps"
      ? "Two job engines on the Hetzner box: BI roles at 07:00, AI roles at 07:30. Each sources postings, scores fit, writes a tailored CV + cover letter, renders PDFs to Drive. Never auto-submits."
      : tile.id === "n8n-broken"
        ? "Every active workflow on the Hetzner box: what is broken right now, and when each one last ran."
        : tile.id === "todos"
          ? "Open items on the Notion build board, In Progress first. Synced from the sprint snapshot."
          : tile.id === "plants"
            ? "Per-plant watering cadence vs last watered. Due-ness is computed live from the dates."
            : projSlug
              ? DESCRIPTIONS[projSlug] ?? reg?.one_liner ?? null
              : null;

  return (
    <motion.div
      className="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 backdrop" onClick={onClose} />
      <motion.div
        ref={dialogRef}
        layoutId={`tile-${tile.id}`}
        transition={spring}
        role="dialog"
        aria-modal="true"
        aria-label={`${tile.kicker} breakdown`}
        className="tile relative z-10 flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden"
        style={{ borderRadius: "1rem", cursor: "default" }}
        {...(tile.id.startsWith("proj:")
          ? { initial: { opacity: 0, scale: 0.96, y: 14 }, animate: { opacity: 1, scale: 1, y: 0 } }
          : {})}
      >
        <div className="flex items-center justify-between gap-3 p-5 pb-3">
          <span className="kicker">{tile.kicker} · breakdown</span>
          <button onClick={onClose} className="close-btn" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-6">
          {desc ? (
            <p className="mb-3 text-sm leading-relaxed" style={{ color: "var(--aqua)" }}>
              {desc}
            </p>
          ) : null}
          {tile.id === "apps" ? (
            <AppsBreakdown projects={projects} now={now} />
          ) : tile.id === "brain" ? (
            <BrainBreakdown projects={projects} />
          ) : tile.id === "n8n-broken" ? (
            <N8nBreakdown />
          ) : tile.id === "todos" ? (
            <TodoBreakdown todos={todos} />
          ) : tile.id === "plants" ? (
            <PlantsBreakdown life={life} now={now} />
          ) : tile.id === "expenses" && projects["expenses"] ? (
            <ExpensesBreakdown proj={projects["expenses"]} now={now} />
          ) : isIdleProj ? (
            reg ? (
              <RegistryCard reg={reg} />
            ) : (
              <p className="text-sm" style={{ color: "var(--mute)" }}>
                No live metrics for this project yet.
              </p>
            )
          ) : (
            tile.projects.map((p) => {
              const proj = projects[p];
              if (!proj) return null;
              return (
                <div key={p} className="mb-2">
                  {tile.projects.length > 1 ? (
                    <div className="mt-2 mb-1 flex items-center gap-2">
                      <Dot status={proj.status} />
                      <span className="font-display text-sm font-bold">{p}</span>
                      <span className="ml-auto text-xs tabular-nums" style={{ color: "var(--mute)" }}>
                        last event {fmtDateTime(proj.last_ts)} · {ageLabel(proj.last_ts, now)}
                      </span>
                    </div>
                  ) : (
                    <div className="mb-1 text-xs tabular-nums" style={{ color: "var(--mute)" }}>
                      last event {fmtDateTime(proj.last_ts)} · {ageLabel(proj.last_ts, now)}
                    </div>
                  )}
                  {Object.entries(proj.metrics)
                    .filter(([k]) => !tile.metricKeys || tile.metricKeys.includes(k))
                    .map(([k, m]) => (
                      <MetricRow key={k} mkey={k} m={m} now={now} />
                    ))}
                </div>
              );
            })
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
