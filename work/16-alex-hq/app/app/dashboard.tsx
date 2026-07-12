"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { motion, AnimatePresence, animate } from "motion/react";
import type { Cadence, Inbox, Metric, Project, Status, Summary } from "@/lib/types";
import { ageLabel, cadenceStale, clean, daysSinceStockholm, fmtDateTime, fmtDay, fmtNum, weekdayAgeHours, DESCRIPTIONS, STACK } from "@/lib/types";
import { BrainGraph } from "./brain";
import { NotesCard } from "./notes";
import { WaitingStrip } from "./waiting";

/* ---------- primitives ---------- */

function Dot({ status }: { status: Status }) {
  return <span className={`dot dot-${status}`} aria-label={status} />;
}

/* Client fetch of a static /data JSON (the graph.json pattern).
   null = loading, "failed" = not synced. First client render matches the server
   (loading state), data arrives via state — no hydration risk. */
function useJson<T>(url: string): T | null | "failed" {
  const [data, setData] = useState<T | null | "failed">(null);
  useEffect(() => {
    let alive = true;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => alive && setData(d))
      .catch(() => alive && setData("failed"));
    return () => {
      alive = false;
    };
  }, [url]);
  return data;
}

/* static /data JSON shapes (producers: n8n_liveness.py, build-todos.mjs, build-life.mjs) */
type N8nList = {
  generated_at: string;
  active_count: number;
  workflows: { name: string; id: string; last_exec: string | null; status: string; broken_reason: string | null }[];
};
type TodosData = {
  generated_at: string;
  snapshot_date: string;
  items: { task: string; status: string; since: string }[];
};
type LifeData = {
  generated_at: string;
  gym: { start_date: string; interval_days: number; label: string; as_of: string | null };
  plants: { as_of: string | null; items: { name: string; every_days: number; last_watered: string }[] };
};
/* projects.json (build-projects.mjs, from the project registry): the full roster so the health
   board shows EVERY registered project, not just the ones pushing telemetry. hq_slug links a
   project to its live metrics; null = it pushes none (renders as an honest idle ticket). */
type RegProject = {
  name: string;
  num: number | null;
  title: string;
  state: string;
  trigger: string;
  one_liner: string;
  hq_slug: string | null;
  /* cadence-as-data (upgrade P4, 2026-07-12): the registry's cadence object + first-fire proof.
     Nullable so a stale projects.json (pre-P4) degrades to the old 48h fallback, never crashes. */
  cadence?: Cadence | null;
  first_fire?: string | null;
  first_fire_kind?: "live" | "drill" | null;
};
type ProjectsData = { generated_at: string; count: number; projects: RegProject[] };

/* a LIVE/EVENT project that has never produced (first_fire null) says so, honestly (design 1.4) */
const neverFired = (reg: RegProject | null | undefined): boolean =>
  !!reg && (reg.state === "LIVE" || reg.state === "EVENT") && !reg.first_fire;

/* Stockholm same-calendar-day check (pure function of ts/now - hydration-safe) */
const stockholmDay = (t: number) => fmtDateTime(new Date(t).toISOString()).slice(0, 10);

/* The per-class tile stamp (design 4.2). daily/weekdays/always-on: "today HH:MM" when fresh,
   "missed today" once past expected_hours; weekly: "weekly · last Mon 06 Jul"; monthly:
   "monthly · {note}" and never an age; on-demand/event: just the label - never stale. */
function cadenceStamp(cad: Cadence | null | undefined, ts: string | null | undefined, now: number): string | undefined {
  if (!cad) return ts ? `last run ${fmtDateTime(ts)}` : undefined;
  switch (cad.label) {
    case "daily":
    case "weekdays":
    case "always-on": {
      if (!ts) return cad.note ? `${cad.label} · ${cad.note}` : cad.label;
      const t = fmtDateTime(ts);
      if (stockholmDay(new Date(ts).getTime()) === stockholmDay(now)) return `today ${t.slice(11)}`;
      return cadenceStale(cad, ts, now) ? `missed today · last ${t}` : `last ${t}`;
    }
    case "weekly":
      return `weekly · last ${fmtDay(ts)}`;
    case "monthly":
      return `monthly · ${cad.note ?? "updates at month-end"}`;
    default:
      // on-demand / event / dormant / parked / retired: the label is the whole story
      return cad.note ? `${cad.label} · ${cad.note}` : cad.label;
  }
}

const STATE_LABEL: Record<string, string> = {
  LIVE: "no telemetry yet",
  "ON-DEMAND": "on-demand",
  EVENT: "event-triggered",
  DORMANT: "dormant",
  PARKED: "parked",
  RETIRED: "retired",
};
const idleLabel = (state: string) => STATE_LABEL[state] ?? state.toLowerCase();

/* due-ness computed at render from raw dates, so the card is right even if the sync lagged.
   "due_today" = today lands on the watering cadence (every Nth day from last watered), NOT a
   growing overdue counter — carry-over / "Nd over" is deliberately gone (Shaheen 2026-07-08:
   show only what's due today). overdue_days is kept solely for the stale-log guard below. */
function plantsDue(life: LifeData, now: number) {
  return life.plants.items.map((p) => {
    const daysSince = daysSinceStockholm(p.last_watered, now);
    const overdue_days = daysSince - p.every_days;
    const due_today = daysSince > 0 && daysSince % p.every_days === 0;
    const cycles = Math.max(1, Math.ceil(daysSince / p.every_days)); // next on-or-after today
    const nd = new Date(p.last_watered + "T00:00:00Z");
    nd.setUTCDate(nd.getUTCDate() + cycles * p.every_days);
    return { ...p, overdue_days, due_today, next_due: nd.toISOString().slice(0, 10) };
  });
}

function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [text, setText] = useState(() => fmtNum(value) + suffix);
  useEffect(() => {
    const controls = animate(0, value, {
      duration: 1.2,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setText(fmtNum(Number.isInteger(value) ? Math.round(v) : v) + suffix),
    });
    return () => controls.stop();
  }, [value, suffix]);
  return <span className="tabular-nums">{text}</span>;
}

function Sparkline({ history, big = false }: { history: Metric["history"]; big?: boolean }) {
  const gid = useId();
  const vals = history.map((h) => h.value_num).filter((v): v is number => v != null);
  // fewer than 5 points reads as noise, not signal — instrument panels stay quiet
  if (vals.length < (big ? 2 : 5))
    return big ? (
      <p className="text-xs" style={{ color: "var(--mute)" }}>
        history builds as runs accumulate
      </p>
    ) : null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const h = big ? 40 : 28;
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * 100, h - 4 - ((v - min) / span) * (h - 10)]);
  const line = pts.map((p) => p.join(",")).join(" ");
  const area = `M0,${h} L${pts.map((p) => p.join(",")).join(" L")} L100,${h} Z`;
  return (
    <svg viewBox={`0 0 100 ${h}`} className={`${big ? "h-12" : "h-7"} w-full`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--cyan)" stopOpacity="0.1" />
          <stop offset="100%" stopColor="var(--cyan)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <motion.polyline
        points={line}
        fill="none"
        stroke="var(--cyan)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.2, ease: "easeOut" }}
      />
    </svg>
  );
}

/* ---------- tile ---------- */

const spring = { type: "spring" as const, stiffness: 260, damping: 26 };

function Tile({
  id,
  kicker,
  status,
  big,
  dim,
  accent,
  sub,
  stamp,
  history,
  className = "",
  index,
  onOpen,
}: {
  id: string;
  kicker: string;
  status: Status;
  big: React.ReactNode;
  dim?: boolean;
  accent?: string;
  sub?: string;
  stamp?: string;
  history?: Metric["history"];
  className?: string;
  index: number;
  onOpen: (id: string) => void;
}) {
  return (
    <motion.button
      layoutId={`tile-${id}`}
      onClick={() => onOpen(id)}
      className={`tile ${status !== "green" ? `tile-${status}` : ""} flex flex-col gap-2 p-5 text-left ${className}`}
      style={{ borderRadius: "1rem" }}
      initial={{ opacity: 0, y: 28, scale: 0.96 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ ...spring, delay: Math.min(index * 0.055, 0.5) }}
      whileHover={{ y: -5, scale: 1.02 }}
      whileTap={{ scale: 0.975 }}
    >
      <div className="flex w-full items-center justify-between gap-3">
        <span className="kicker">{kicker}</span>
        <Dot status={status} />
      </div>
      {/* healthy zeros whisper; only actionable numbers burn white */}
      <div className="big" style={dim ? { color: "rgba(148, 210, 189, 0.55)" } : undefined}>
        {big}
      </div>
      {accent ? (
        <div className="text-sm" style={{ color: "var(--aqua)" }}>
          {accent}
        </div>
      ) : null}
      {sub ? (
        <p className="line-clamp-2 text-sm leading-snug" style={{ color: "var(--mute)" }}>
          {sub}
        </p>
      ) : null}
      {stamp ? (
        <p className="text-xs tabular-nums" style={{ color: "var(--mute)" }}>
          {stamp}
        </p>
      ) : null}
      {history ? <Sparkline history={history} /> : null}
    </motion.button>
  );
}

/* ---------- overlay building blocks ---------- */

function prettyKey(k: string) {
  return k.replace(/_/g, " ").replace(/\bpct\b/, "%").replace(/\busd\b/, "$").replace(/\bkr\b/, "kr");
}

function MetricRow({ mkey, m, now }: { mkey: string; m: Metric; now: number }) {
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
        <span className="font-display text-3xl font-bold tracking-tight">
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

/* Applications breakdown, ordered exactly as Shaheen asked:
   per lane (BI first, then AI): ready to apply · in review · pass rate · spend · today */
function AppsBreakdown({ projects, now }: { projects: Record<string, Project>; now: number }) {
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

/* Alex Brain breakdown: the counts, the graph stamp, then the stack. */
function BrainBreakdown({ projects }: { projects: Record<string, Project> }) {
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

/* n8n breakdown: what is broken right now, then every active workflow + last run.
   Freshness is harvest-cadence — the footer says so; an error still flips the TILE red instantly. */
function N8nBreakdown() {
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
  const dotFor = (w: N8nList["workflows"][number]): Status =>
    w.broken_reason
      ? w.broken_reason === "errored"
        ? "red"
        : "amber"
      : w.status === "success"
        ? "green"
        : "amber";
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
            <span
              className="text-xs"
              style={{ color: w.broken_reason === "errored" ? "var(--error)" : "var(--warn)" }}
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
            {w.last_exec ? fmtDateTime(w.last_exec) : "never ran"}
          </span>
        </div>
      ))}
      <p className="mt-3 text-xs tabular-nums" style={{ color: "var(--mute)" }}>
        as of {fmtDateTime(data.generated_at)} · list refreshes with each harvest; an error flips the tile red instantly
      </p>
    </div>
  );
}

/* Expenses breakdown: the usual metric rows plus MTD split by category (from mtd_by_category value_text) */
function ExpensesBreakdown({ proj, now }: { proj: Project; now: number }) {
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

/* To-Do breakdown: open build-board items grouped by status, In Progress first */
const TODO_GROUPS = ["In Progress", "Next", "Blocked", "Planned"] as const;
function TodoBreakdown({ todos }: { todos: TodosData | null | "failed" }) {
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

/* Plants breakdown: all plants with cadence, last watered and next due — due first */
function PlantsBreakdown({ life, now }: { life: LifeData | null | "failed"; now: number }) {
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

/* Registry card: a registered project that pushes no live telemetry. Says what it is and why
   it's quiet, so the ticket is informative instead of a dead end. */
function RegistryCard({ reg }: { reg: RegProject }) {
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

/* ---------- detail overlay ---------- */

function DetailOverlay({
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
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

/* ---------- gym card (no drill-down: the answer IS the card) ---------- */

function GymCard({ life, now, index }: { life: LifeData | null | "failed"; now: number; index: number }) {
  let big = "–";
  let sub = life === "failed" ? "not synced yet · run /alex-hq" : "checking the cycle…";
  if (life && life !== "failed") {
    const d = daysSinceStockholm(life.gym.start_date, now);
    const session = d >= 0 && d % life.gym.interval_days === 0;
    big = session ? "GYM" : "REST";
    sub = `${life.gym.label} · cycle from ${life.gym.start_date}`;
  }
  return (
    <motion.div
      className="tile flex flex-col gap-2 p-5"
      style={{ borderRadius: "1rem", cursor: "default" }}
      initial={{ opacity: 0, y: 28, scale: 0.96 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ ...spring, delay: Math.min(index * 0.055, 0.5) }}
    >
      <div className="flex w-full items-center justify-between gap-3">
        <span className="kicker">Body · gym today</span>
        <Dot status="green" />
      </div>
      <div className="big">{big}</div>
      <p className="line-clamp-2 text-sm leading-snug" style={{ color: "var(--mute)" }}>
        {sub}
      </p>
    </motion.div>
  );
}

/* ---------- health board ---------- */

type HealthRow = {
  key: string;
  drillId: string;
  label: string;
  display: Status | "idle";
  meta: string;
  sortRank: number;
};

// Live status for a reporting project, cadence-staleness folded in - the cadence now comes from
// the registry row (projects.json), not a hand map (upgrade P4). No registry row (unclaimed slug,
// registry not synced) = the old 48h fallback. Weekly rows amber only past 8 days, monthly rows
// never amber mid-cycle, on-demand/event rows never age (design 4.2); red stays the producer's call.
function liveRow(key: string, label: string, p: Project, now: number, slug: string, reg?: RegProject | null): HealthRow {
  const cad = reg?.cadence;
  const stale = cadenceStale(cad, p.last_ts, now);
  const status: Status = p.status === "red" ? "red" : stale ? "amber" : p.status;
  // weekly/monthly/on-demand ages read wrong without the label ("12d ago" on a monthly is fine)
  const prefix = cad && !["daily", "weekdays", "always-on"].includes(cad.label) ? `${cad.label} · ` : "";
  return {
    key,
    drillId: `proj:${slug}`,
    label,
    display: status,
    meta: `${prefix}${ageLabel(p.last_ts, now)}${stale ? " · stale" : ""}`,
    sortRank: { red: 0, amber: 1, green: 2 }[status],
  };
}

function HealthBoard({
  projects,
  registry,
  now,
  onOpen,
}: {
  projects: Record<string, Project>;
  registry: ProjectsData | null | "failed";
  now: number;
  onOpen: (id: string) => void;
}) {
  const rows = useMemo<HealthRow[]>(() => {
    const live: Record<string, Project> = {};
    for (const [k, v] of Object.entries(projects)) if (k !== "me") live[k] = v;

    const out: HealthRow[] = [];
    const claimed = new Set<string>();

    if (registry && registry !== "failed") {
      // one row per REGISTERED project — the full roster, from the source of truth
      for (const reg of registry.projects) {
        const lp = reg.hq_slug ? live[reg.hq_slug] : null;
        if (lp && reg.hq_slug) {
          claimed.add(reg.hq_slug);
          out.push(liveRow(reg.name, reg.title, lp, now, reg.hq_slug, reg));
        } else {
          // registered but no live telemetry: show its real state, never a false red/stale.
          // A LIVE/EVENT project that has never produced says "never fired" (design 1.4).
          out.push({
            key: reg.name,
            drillId: `proj:${reg.name}`,
            label: reg.title,
            display: "idle",
            meta: neverFired(reg) ? "never fired" : idleLabel(reg.state),
            sortRank: 3,
          });
        }
      }
    }
    // any live slug the registry didn't claim (infra, plus any future unmapped producer) —
    // keep it so nothing that reports today ever disappears. The infra metrics are produced by
    // #16's daily local push, so its registry row carries their cadence (no hand map).
    const alexHqReg = registry && registry !== "failed" ? registry.projects.find((r) => r.name === "alex-hq") : null;
    for (const [slug, lp] of Object.entries(live)) {
      if (claimed.has(slug)) continue;
      out.push(liveRow(slug, slug, lp, now, slug, slug === "infra" ? alexHqReg : null));
    }

    return out.sort((a, b) => a.sortRank - b.sortRank || a.label.localeCompare(b.label));
  }, [projects, registry, now]);

  const loading = registry === null;

  return (
    <motion.div
      className="tile flex flex-col gap-3 p-5"
      style={{ cursor: "default" }}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={spring}
    >
      <div className="flex items-center justify-between">
        <span className="kicker">Automation Health</span>
        <span className="text-xs" style={{ color: "var(--mute)" }}>
          {rows.length} systems · tap one for what it does
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map((p, i) => (
          <motion.li
            key={p.key}
            initial={{ opacity: 0, x: -12 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ ...spring, delay: i * 0.03 }}
          >
            <button className="health-row" onClick={() => onOpen(p.drillId)}>
              <span className={`dot dot-${p.display}`} aria-label={p.display} />
              <span className="min-w-0 flex-1 truncate font-medium">{p.label}</span>
              <span className="ml-auto flex-none text-xs tabular-nums" style={{ color: "var(--mute)" }}>
                {p.meta}
              </span>
            </button>
          </motion.li>
        ))}
      </ul>
      {loading ? (
        <p className="text-xs" style={{ color: "var(--mute)" }}>
          loading the full roster…
        </p>
      ) : registry === "failed" ? (
        <p className="text-xs" style={{ color: "var(--mute)" }}>
          showing reporting projects only · registry not synced (run /alex-hq on the ThinkPad)
        </p>
      ) : null}
    </motion.div>
  );
}

/* ---------- dashboard ---------- */

export function Dashboard({ summary: s, now, inbox }: { summary: Summary; now: number; inbox: Inbox | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const [waitingOpen, setWaitingOpen] = useState(false);
  const todos = useJson<TodosData>("/data/todos.json");
  const life = useJson<LifeData>("/data/life.json");
  const registry = useJson<ProjectsData>("/data/projects.json");

  const m = (p: string, k: string): Metric | null => s.projects?.[p]?.metrics?.[k] ?? null;

  // Waiting-on-you strip (design 4.1.2): the pushed human-actions summary metric. Absent/null or
  // open_count 0 -> the strip renders nothing (fail-calm, the healthy screen stays calm).
  const humanActions = m("human-actions", "open_count");

  const bi = s.projects["app-engine-bi"]?.metrics ?? {};
  const ai = s.projects["app-engine-ai"]?.metrics ?? {};
  const drafted = (bi.drafted_today?.value_num ?? 0) + (ai.drafted_today?.value_num ?? 0);
  const worst = (a?: Status, b?: Status): Status => {
    const rank = { green: 0, amber: 1, red: 2 };
    return (rank[a ?? "green"] >= rank[b ?? "green"] ? a : b) ?? "green";
  };
  // fold in project-level status too: a red run_status must never hide behind a green metric
  const appsStatus = worst(
    worst(bi.drafted_today?.status, ai.drafted_today?.status),
    worst(s.projects["app-engine-bi"]?.status, s.projects["app-engine-ai"]?.status)
  );

  const infra = s.projects["infra"]?.metrics ?? {};
  const infraStatus: Status = s.projects["infra"]?.status ?? "amber";
  const reportingCount = Object.keys(s.projects).filter((p) => p !== "me").length;
  // the honest headline: how many projects Alex HAS (registry), not how many push telemetry
  const registeredCount = registry && registry !== "failed" ? registry.count : null;
  const projectCount = registeredCount ?? reportingCount;
  const regByKey: Record<string, RegProject> = {};
  if (registry && registry !== "failed")
    for (const r of registry.projects) {
      regByKey[r.name] = r;
      if (r.hq_slug) regByKey[r.hq_slug] = r;
    }

  type TileDef = {
    id: string;
    kicker: string;
    projects: string[];
    status: Status;
    big: React.ReactNode;
    dim?: boolean;
    accent?: string;
    sub?: string;
    stamp?: string;
    history?: Metric["history"];
    className?: string;
    metricKeys?: string[];
  };

  const simple = (
    id: string,
    kicker: string,
    project: string,
    key: string,
    opts?: { spark?: boolean; noAccent?: boolean; metricKeys?: string[] }
  ): TileDef | null => {
    const mm = m(project, key);
    if (!mm) return null;
    return {
      id,
      kicker,
      projects: [project],
      status: mm.status,
      big: mm.value_num != null ? <CountUp value={mm.value_num} /> : clean(mm.value_text) || "–",
      dim: mm.value_num === 0 && mm.status === "green",
      accent: opts?.noAccent ? undefined : mm.value_num != null && mm.value_text ? clean(mm.value_text) : undefined,
      sub: mm.headline ? clean(mm.headline) : undefined,
      history: opts?.spark === false ? undefined : mm.history,
      metricKeys: opts?.metricKeys,
    };
  };

  // cadence honesty pass (upgrade P4, design 4.2): every tile's freshness stamp + staleness come
  // from the registry cadence in projects.json (the CADENCE_HOURS hand map is gone). Stale only
  // lifts green -> amber; red stays the producer's call. A tile that already set a stamp keeps it.
  const withCadence = (tile: TileDef | null, slug: string, key: string, regOverride?: RegProject | null): TileDef | null => {
    if (!tile) return tile;
    const reg = regOverride ?? regByKey[slug];
    const ts = m(slug, key)?.ts ?? null;
    if (cadenceStale(reg?.cadence, ts, now) && tile.status === "green") tile.status = "amber";
    if (!tile.stamp) tile.stamp = cadenceStamp(reg?.cadence, ts, now);
    return tile;
  };

  // per-tile shaping (2026-07-06 feedback round): absolute stamps, sparklines only where
  // the trend means something, subs carrying the ONE next-action fact
  const airbnbTile = withCadence(simple("airbnb", "Airbnb · YTD kr", "airbnb", "ytd_income_kr", { spark: false }), "airbnb", "ytd_income_kr");
  const nextBooking = m("airbnb", "next_booking");
  if (airbnbTile && nextBooking) airbnbTile.sub = `next: ${clean(nextBooking.value_text) || clean(nextBooking.headline) || "no booking"}`;

  // weekly producer (Mon sweep): the registry cadence labels it so a 6-day-old stamp reads as
  // "on schedule", not "stuck"; amber only past 8 days
  const radarTile = withCadence(simple("radar", "Radar · shipped 30d", "radar", "shipped_30d", { spark: false }), "radar", "shipped_30d");

  // weekdays producer: the staleness math skips weekends, so a Friday run is fresh on Monday morning
  const buildTile = withCadence(simple("build", "Build tasks · done this week", "sprint", "velocity", { spark: false }), "sprint", "velocity");

  const sleepTile = withCadence(
    simple("health-sleep", "Body · sleep score", "health", "sleep_score_today", {
      spark: false,
      metricKeys: ["sleep_score_today"],
    }),
    "health",
    "sleep_score_today"
  );
  if (sleepTile) {
    // red here = the daily iPhone push didn't land a real night; say so, don't show a stale number as if fresh
    if (m("health", "sleep_score_today")?.status === "red")
      sleepTile.sub = "phone sync stalled · no fresh sleep from the iPhone · fix the Shortcut";
  }

  const stepsTile = withCadence(
    simple("health-steps", "Body · steps yesterday", "health", "steps_today", {
      metricKeys: ["steps_today"],
    }),
    "health",
    "steps_today"
  );
  if (stepsTile) {
    if (m("health", "steps_today")?.status === "red")
      stepsTile.sub = "phone sync stalled · no fresh steps from the iPhone · fix the Shortcut";
  }

  // monthly producer (runs month-end): the cadence stamp ("monthly · closes month-end") makes a
  // mid-month 0 read as "not captured yet", not "broken"; never amber mid-cycle, zero renders dim
  const expensesTile = withCadence(simple("expenses", "Expenses · MTD kr", "expenses", "mtd_total_kr"), "expenses", "mtd_total_kr");
  const mtdCat = m("expenses", "mtd_by_category");
  if (expensesTile && mtdCat && mtdCat.value_text) expensesTile.sub = clean(mtdCat.value_text);

  // To-Do: the open build-board items (client-fetched todos.json, sprint snapshot)
  const openTodos = todos && todos !== "failed" ? todos.items : null;
  const todoTile: TileDef = {
    id: "todos",
    kicker: "To-Do · build board",
    projects: [],
    status: "green",
    big: openTodos ? (
      <CountUp value={openTodos.filter((i) => i.status === "In Progress" || i.status === "Next").length} />
    ) : (
      "–"
    ),
    sub:
      todos === "failed"
        ? "not synced yet · run /alex-hq"
        : openTodos
          ? `${openTodos.filter((i) => i.status === "In Progress").length} in progress · ${openTodos.filter((i) => i.status === "Next").length} next · ${openTodos.length} open total`
          : undefined,
    stamp: openTodos && todos !== "failed" && todos ? `as of ${fmtDateTime(todos.generated_at)}` : undefined,
  };
  // snapshot honesty (d5, design 4.2): the snapshot ages against 2x its PRODUCER's cadence
  // (todos.json is built from the sprint snapshot - weekdays producer, weekends skipped)
  if (todos && todos !== "failed") {
    const cad = regByKey["sprint-tracker"]?.cadence;
    const exp = cad?.expected_hours ?? 26;
    const age =
      cad?.label === "weekdays"
        ? weekdayAgeHours(todos.generated_at, now)
        : (now - new Date(todos.generated_at).getTime()) / 3600000;
    if (age > 2 * exp) {
      todoTile.status = "amber";
      todoTile.stamp = `as of ${fmtDateTime(todos.generated_at)} · snapshot stale`;
    }
  }

  // Plants: count due today, computed at render from the raw dates
  const plantsTile: TileDef = {
    id: "plants",
    kicker: "Home · plants due",
    projects: [],
    status: "green",
    big: "–",
    sub: life === "failed" ? "not synced yet · run /alex-hq" : "checking the plants…",
  };
  if (life && life !== "failed") {
    const all = plantsDue(life, now);
    // only what's due TODAY — no overdue carry-over (Shaheen 2026-07-08)
    const dueToday = all.filter((p) => p.due_today);
    const sourceDead = all.length > 0 && all.every((p) => p.overdue_days > p.every_days);
    if (sourceDead) {
      // every plant past 2x its cadence = the log is stale, not the plants dying — say so
      const oldest = all.reduce((a, b) => (a.last_watered < b.last_watered ? a : b)).last_watered;
      plantsTile.big = "?";
      plantsTile.status = "amber";
      plantsTile.sub = `watering log stale since ${oldest} · tell Alex when you water`;
    } else {
      plantsTile.big = <CountUp value={dueToday.length} />;
      plantsTile.dim = dueToday.length === 0;
      plantsTile.status = dueToday.length > 0 ? "amber" : "green";
      plantsTile.sub = dueToday.length > 0 ? `due today: ${dueToday.map((p) => p.name).join(", ")}` : "none due today";
      plantsTile.stamp = `watering data as of ${life.plants.as_of ?? "unknown"}`;
    }
    // snapshot honesty (d5, design 4.2): life.json is shipped by #16's daily local push - a copy
    // older than 2x that cadence gets an honest amber instead of looking live
    const lifeExp = (regByKey["alex-hq"]?.cadence?.expected_hours ?? 26) * 2;
    const lifeAgeH = (now - new Date(life.generated_at).getTime()) / 3600000;
    if (lifeAgeH > lifeExp && plantsTile.status === "green") {
      plantsTile.status = "amber";
      plantsTile.stamp = `${plantsTile.stamp ?? `watering data as of ${life.plants.as_of ?? "unknown"}`} · snapshot stale`;
    }
  }

  const appsMissing = !bi.drafted_today && !ai.drafted_today;
  // apps tile freshness: the newest drafted_today event across both lanes, aged against the
  // BI engine's registry cadence (daily 26h - the lanes are twins)
  const appsTs = [bi.drafted_today?.ts, ai.drafted_today?.ts].filter((t): t is string => !!t).sort().pop() ?? null;
  const appsReg = regByKey["app-engine-bi"];
  const appsStale = cadenceStale(appsReg?.cadence, appsTs, now);
  const tiles: TileDef[] = [
    // label matches the number: DRAFTED TODAY; ready-to-apply totals live in the sub + drill-down
    appsMissing
      ? null
      : {
          id: "apps",
          kicker: "Applications · drafted today",
          projects: ["app-engine-bi", "app-engine-ai"],
          status: appsStale ? worst(appsStatus, "amber") : appsStatus,
          big: <CountUp value={drafted} />,
          sub: `ready to apply BI ${fmtNum(bi.draft_ready_total?.value_num ?? null)} · AI ${fmtNum(
            ai.draft_ready_total?.value_num ?? null
          )}`,
          stamp: cadenceStamp(appsReg?.cadence, appsTs, now),
          className: "sm:col-span-2",
        },
    // Broken n8n today: green 0 whispers, a red count shouts. The one glance that answers
    // "is anything on the box down right now?" — fed daily by the liveness harvest and
    // flipped red instantly by the Pipeline Error Alert workflow the moment something throws.
    // Drill-down = the full running-workflow list (n8n-workflows.json). The infra metrics are
    // produced by #16's daily local push, so its registry row carries their cadence.
    withCadence(
      simple("n8n-broken", "n8n · broken today", "infra", "n8n_broken_today", { spark: false, noAccent: true }),
      "infra",
      "n8n_broken_today",
      regByKey["alex-hq"]
    ),
    withCadence(simple("brief", "Morning Brief · urgent", "morning-brief", "urgent_count", { spark: false }), "morning-brief", "urgent_count"),
    withCadence(simple("email", "Email · act now", "email-triage", "act_now", { spark: false }), "email-triage", "act_now"),
    airbnbTile,
    radarTile,
    expensesTile,
    buildTile,
    todoTile,
    sleepTile,
    stepsTile,
  ].filter((t): t is TileDef => t !== null);

  // IA regroup (design 4.1): the SAME tiles, grouped by cadence into TODAY / RHYTHMS / SYSTEM.
  // No tile added, none removed — just moved. GymCard + plants render inline (not TileDefs), so
  // the groups list ids and the section JSX places the special cards. Any listed id that didn't
  // build (metric missing -> null tile) is silently skipped, so an absent producer never gaps.
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const TODAY_IDS = ["apps", "n8n-broken", "brief", "email", "health-sleep", "health-steps"];
  const RHYTHMS_IDS = ["build", "todos", "radar", "airbnb", "expenses"];
  const todayTiles = TODAY_IDS.map((id) => byId.get(id)).filter((t): t is TileDef => !!t);
  const rhythmTiles = RHYTHMS_IDS.map((id) => byId.get(id)).filter((t): t is TileDef => !!t);

  const brainStats: [string, Metric | null, string | null][] = [
    ["vault pages", infra.vault_pages ?? null, null],
    ["mcp tools", infra.mcp_tools ?? null, null],
    ["scheduled jobs", infra.scheduled_jobs_active ?? null, null],
    ["n8n up today", infra.n8n_up_today ?? null, null],
    ["projects", null, String(projectCount)],
  ];

  const openTile =
    open?.startsWith("proj:") && open
      ? { id: open, kicker: regByKey[open.slice(5)]?.title ?? open.slice(5), projects: [open.slice(5)] }
      : open === "brain"
        ? { id: "brain", kicker: "Alex Brain · the structure", projects: ["infra"] }
        : open === "plants"
          ? plantsTile
          : tiles.find((t) => t.id === open) ?? null;

  return (
    <>
      {/* deep-water drift: three blurred brand bubbles behind everything (respects reduced motion) */}
      <div className="bubbles" aria-hidden>
        <div className="bubble bubble-1" />
        <div className="bubble bubble-2" />
        <div className="bubble bubble-3" />
      </div>
    <main className="relative z-10 mx-auto max-w-6xl p-4 pb-14 sm:p-6">
      {/* Header: the ALEX mark, no runway */}
      <motion.header
        className="tile mb-4 flex flex-col gap-3 p-5 sm:p-6"
        style={{ cursor: "default" }}
        initial={{ opacity: 0, y: -18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/alex-logo.png" alt="ALEX" className="h-12 w-auto sm:h-14" />
          <span className="text-xs tabular-nums" style={{ color: "var(--mute)" }} title={ageLabel(s.generated_at, now)}>
            {s.row_count} events · updated {fmtDateTime(s.generated_at)}
          </span>
        </div>
        <div className="filament" />
      </motion.header>

      {/* Waiting-on-you strip: renders only when the human-actions queue has open items
          (empty queue = nothing here; the healthy screen stays calm). Sits above the Notes card. */}
      <div className="mb-4">
        <WaitingStrip
          metric={humanActions}
          open={waitingOpen}
          onOpen={() => setWaitingOpen(true)}
          onClose={() => setWaitingOpen(false)}
          now={now}
        />
      </div>

      {/* Two-way inbox */}
      <section className="mb-4">
        <NotesCard initial={inbox} now={now} />
      </section>

      {/* TODAY: the daily-cadence tiles (design 4.1). Applications keeps col-span-2 + stays first. */}
      <span className="kicker mb-2 block">Today</span>
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {todayTiles.map((t, i) => (
          <Tile key={t.id} {...t} index={i} onOpen={setOpen} />
        ))}
        {/* Gym lives in TODAY (computed daily): the answer IS the card, no drill-down */}
        <GymCard life={life} now={now} index={todayTiles.length} />
      </section>

      {/* RHYTHMS: this week / month (design 4.1). Plants (computed daily from dates) joins them. */}
      <span className="kicker mb-2 mt-6 block" style={{ color: "var(--mute)" }}>
        This week / month
      </span>
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {rhythmTiles.map((t, i) => (
          <Tile key={t.id} {...t} index={i} onOpen={setOpen} />
        ))}
        <Tile {...plantsTile} index={rhythmTiles.length} onOpen={setOpen} />
      </section>

      {/* SYSTEM: the Alex Brain strip, the health board, the graph (design 4.1). */}
      <span className="kicker mb-2 mt-6 block">System</span>
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Alex Brain: the structure strip */}
        <motion.button
          layoutId="tile-brain"
          onClick={() => setOpen("brain")}
          className={`tile ${infraStatus !== "green" ? `tile-${infraStatus}` : ""} flex flex-col gap-3 p-5 text-left sm:col-span-2 lg:col-span-4`}
          style={{ borderRadius: "1rem" }}
          initial={{ opacity: 0, y: 28, scale: 0.98 }}
          whileInView={{ opacity: 1, y: 0, scale: 1 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ ...spring, delay: 0.15 }}
          whileHover={{ y: -4, scale: 1.008 }}
          whileTap={{ scale: 0.99 }}
        >
          <div className="flex w-full items-center justify-between gap-3">
            <span className="kicker">Alex Brain · the structure</span>
            <Dot status={infraStatus} />
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-3 sm:flex sm:flex-wrap sm:items-end sm:justify-between sm:gap-x-6">
            {brainStats.map(([label, mm, fixed]) => (
              <div key={label} className="brain-stat">
                <span className="v">
                  {fixed ?? (mm ? (mm.value_num != null ? fmtNum(mm.value_num) : clean(mm.value_text) || "–") : "–")}
                </span>
                <span className="k">{label}</span>
              </div>
            ))}
          </div>
        </motion.button>
      </section>

      {/* Health board: the flagship sits above the graph */}
      <section className="mt-4">
        <HealthBoard projects={s.projects} registry={registry} now={now} onOpen={setOpen} />
      </section>

      {/* The Brain graph */}
      <section className="mt-4">
        <BrainGraph />
      </section>

      <footer className="mt-6 text-center text-xs" style={{ color: "var(--mute)" }}>
        Personal OS · the vault is the brain, this is the face
      </footer>

      <AnimatePresence>
        {openTile ? (
          <DetailOverlay
            tile={openTile}
            projects={s.projects}
            registry={registry}
            now={now}
            todos={todos}
            life={life}
            onClose={() => setOpen(null)}
          />
        ) : null}
      </AnimatePresence>
    </main>
    </>
  );
}
