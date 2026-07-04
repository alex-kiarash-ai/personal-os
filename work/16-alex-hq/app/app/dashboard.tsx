"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { motion, AnimatePresence, animate } from "motion/react";
import type { Inbox, Metric, Project, Status, Summary } from "@/lib/types";
import { ageLabel, clean, fmtNum, CADENCE_HOURS, DESCRIPTIONS, STACK } from "@/lib/types";
import { BrainGraph } from "./brain";
import { NotesCard } from "./notes";

/* ---------- primitives ---------- */

function Dot({ status }: { status: Status }) {
  return <span className={`dot dot-${status}`} aria-label={status} />;
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
      {history ? <Sparkline history={history} /> : null}
      <span className="tap-hint" aria-hidden>
        tap for breakdown
      </span>
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
          {ageLabel(m.ts, now)}
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
              <span className="ml-auto text-xs" style={{ color: "var(--mute)" }}>
                last event {ageLabel(p?.last_ts, now)}
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

/* Alex Brain breakdown: the counts, then the stack. */
function BrainBreakdown({ projects, projectCount }: { projects: Record<string, Project>; projectCount: number }) {
  const infra = projects["infra"]?.metrics ?? {};
  const counts: [string, Metric | undefined | null, string | null][] = [
    ["vault pages", infra.vault_pages, null],
    ["mcp tools", infra.mcp_tools, null],
    ["scheduled jobs", infra.scheduled_jobs_active, null],
    ["n8n up + ran today", infra.n8n_up_today, null],
    ["projects reporting", null, String(projectCount)],
  ];
  return (
    <div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 pb-4 sm:grid-cols-3">
        {counts.map(([label, m, fixed]) => (
          <div key={label} className="brain-stat">
            <span className="v">
              {fixed ?? (m ? (m.value_num != null ? fmtNum(m.value_num) : clean(m.value_text) || "–") : "–")}
            </span>
            <span className="k">{label}</span>
          </div>
        ))}
      </div>
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

/* ---------- detail overlay ---------- */

function DetailOverlay({
  tile,
  projects,
  projectCount,
  now,
  onClose,
}: {
  tile: { id: string; kicker: string; projects: string[] };
  projects: Record<string, Project>;
  projectCount: number;
  now: number;
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
  const desc =
    tile.id === "apps"
      ? "Two job engines on the Hetzner box: BI roles at 07:00, AI roles at 07:30. Each sources postings, scores fit, writes a tailored CV + cover letter, renders PDFs to Drive. Never auto-submits."
      : projSlug
        ? DESCRIPTIONS[projSlug]
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
            <BrainBreakdown projects={projects} projectCount={projectCount} />
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
                      <span className="ml-auto text-xs" style={{ color: "var(--mute)" }}>
                        last event {ageLabel(proj.last_ts, now)}
                      </span>
                    </div>
                  ) : (
                    <div className="mb-1 text-xs" style={{ color: "var(--mute)" }}>
                      last event {ageLabel(proj.last_ts, now)}
                    </div>
                  )}
                  {Object.entries(proj.metrics).map(([k, m]) => (
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

/* ---------- health board ---------- */

function HealthBoard({
  projects,
  now,
  onOpen,
}: {
  projects: Record<string, Project>;
  now: number;
  onOpen: (id: string) => void;
}) {
  const rows = useMemo(
    () =>
      Object.values(projects)
        .filter((p) => p.project !== "me")
        .map((p) => {
          const ageH = p.last_ts ? (now - new Date(p.last_ts).getTime()) / 3600000 : Infinity;
          const stale = ageH > (CADENCE_HOURS[p.project] ?? 48);
          const status: Status = p.status === "red" ? "red" : stale ? "amber" : p.status;
          return { ...p, status, stale };
        })
        .sort((a, b) => {
          const rank = { red: 0, amber: 1, green: 2 };
          return rank[a.status] - rank[b.status] || a.project.localeCompare(b.project);
        }),
    [projects, now]
  );

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
            key={p.project}
            initial={{ opacity: 0, x: -12 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ ...spring, delay: i * 0.03 }}
          >
            <button className="health-row" onClick={() => onOpen(`proj:${p.project}`)}>
              <Dot status={p.status} />
              <span className="font-medium">{p.project}</span>
              <span className="ml-auto text-xs tabular-nums" style={{ color: "var(--mute)" }}>
                {ageLabel(p.last_ts, now)}
                {p.stale ? " · stale" : ""}
              </span>
            </button>
          </motion.li>
        ))}
      </ul>
    </motion.div>
  );
}

/* ---------- dashboard ---------- */

export function Dashboard({ summary: s, now, inbox }: { summary: Summary; now: number; inbox: Inbox | null }) {
  const [open, setOpen] = useState<string | null>(null);

  const m = (p: string, k: string): Metric | null => s.projects?.[p]?.metrics?.[k] ?? null;

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
  const projectCount = Object.keys(s.projects).filter((p) => p !== "me").length;

  type TileDef = {
    id: string;
    kicker: string;
    projects: string[];
    status: Status;
    big: React.ReactNode;
    dim?: boolean;
    accent?: string;
    sub?: string;
    history?: Metric["history"];
    className?: string;
  };

  const simple = (id: string, kicker: string, project: string, key: string): TileDef | null => {
    const mm = m(project, key);
    if (!mm) return null;
    return {
      id,
      kicker,
      projects: [project],
      status: mm.status,
      big: mm.value_num != null ? <CountUp value={mm.value_num} /> : clean(mm.value_text) || "–",
      dim: mm.value_num === 0 && mm.status === "green",
      accent: mm.value_num != null && mm.value_text ? clean(mm.value_text) : undefined,
      sub: mm.headline ? clean(mm.headline) : undefined,
      history: mm.history,
    };
  };

  const appsMissing = !bi.drafted_today && !ai.drafted_today;
  const tiles: TileDef[] = [
    // label matches the number: DRAFTED TODAY; ready-to-apply totals live in the sub + drill-down
    appsMissing
      ? null
      : {
          id: "apps",
          kicker: "Applications · drafted today",
          projects: ["app-engine-bi", "app-engine-ai"],
          status: appsStatus,
          big: <CountUp value={drafted} />,
          sub: `ready to apply BI ${fmtNum(bi.draft_ready_total?.value_num ?? null)} · AI ${fmtNum(
            ai.draft_ready_total?.value_num ?? null
          )} · tap for both lanes`,
          className: "sm:col-span-2",
        },
    simple("brief", "Morning Brief · urgent", "morning-brief", "urgent_count"),
    simple("email", "Email · act now", "email-triage", "act_now"),
    simple("airbnb", "Airbnb · YTD kr", "airbnb", "ytd_income_kr"),
    simple("radar", "Radar · shipped 30d", "radar", "shipped_30d"),
    simple("expenses", "Expenses · MTD kr", "expenses", "mtd_total_kr"),
    simple("build", "Build tasks · done this week", "sprint", "velocity"),
  ].filter((t): t is TileDef => t !== null);

  const brainStats: [string, Metric | null, string | null][] = [
    ["vault pages", infra.vault_pages ?? null, null],
    ["mcp tools", infra.mcp_tools ?? null, null],
    ["scheduled jobs", infra.scheduled_jobs_active ?? null, null],
    ["n8n up today", infra.n8n_up_today ?? null, null],
    ["projects", null, String(projectCount)],
  ];

  const openTile =
    open?.startsWith("proj:") && open
      ? { id: open, kicker: open.slice(5), projects: [open.slice(5)] }
      : open === "brain"
        ? { id: "brain", kicker: "Alex Brain · the structure", projects: ["infra"] }
        : tiles.find((t) => t.id === open) ?? null;

  return (
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
          <span className="text-xs tabular-nums" style={{ color: "var(--mute)" }}>
            {s.row_count} events · updated {ageLabel(s.generated_at, now)}
          </span>
        </div>
        <div className="filament" />
      </motion.header>

      {/* Two-way inbox */}
      <section className="mb-4">
        <NotesCard initial={inbox} now={now} />
      </section>

      {/* Glance tiles */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t, i) => (
          <Tile key={t.id} {...t} index={i} onOpen={setOpen} />
        ))}

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
          <span className="tap-hint" aria-hidden>
            tap for the stack
          </span>
        </motion.button>
      </section>

      {/* Health board: the flagship sits above the graph */}
      <section className="mt-4">
        <HealthBoard projects={s.projects} now={now} onOpen={setOpen} />
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
            projectCount={projectCount}
            now={now}
            onClose={() => setOpen(null)}
          />
        ) : null}
      </AnimatePresence>
    </main>
  );
}
