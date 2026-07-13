"use client";

/* The HQ dashboard: composition + the tile map + the three section groupings + top-level state.
   The primitives, tile, overlay, breakdowns, health board and life-ops cards were extracted to
   @/components in the P9 refactor (design 4.3) - this file keeps the information architecture in
   one readable place. No logic changed in the move; the tile map + cadence shaping stay here. */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { ageLabel, cadenceStale, clean, fmtDateTime, fmtDay, fmtNum, weekdayAgeHours } from "@/lib/types";
import type { Inbox, LifeData, Metric, ProjectsData, RegProject, Status, Summary, TodosData } from "@/lib/types";
import { cadenceStamp, regByKey, useJson, worst } from "@/lib/data";
import { CountUp, Dot } from "@/components/primitives";
import { Tile } from "@/components/tile";
import type { TileDef } from "@/components/tile";
import { DetailOverlay } from "@/components/overlay";
import { HealthBoard } from "@/components/health-board";
import { GymCard, buildPlantsTile } from "@/components/life";
import { BrainGraph } from "./brain";
import { NotesCard } from "./notes";
import { WaitingStrip } from "./waiting";

const spring = { type: "spring" as const, stiffness: 260, damping: 26 };

// C2 cadences: the page's server fetch revalidates at 60s, so a 2-min refresh always lands fresh
// data; the "ago" labels tick every minute (their own granularity).
const REFRESH_MS = 120_000;
const NOW_TICK_MS = 60_000;

export function Dashboard({ summary: s, now: serverNow, inbox }: { summary: Summary; now: number; inbox: Inbox | null }) {
  const [open, setOpen] = useState<string | null>(null);

  /* C2: the standalone PWA has no reload UI, so without this the summary NEVER refetched
     client-side — resumed at 08:00 it showed last night's tiles with "7h ago" frozen. On
     visibilitychange -> visible: refresh the server payload + recompute "now"; while visible,
     a slow interval keeps both live. router.refresh() merges the new RSC payload without
     touching client state (a half-typed note survives). Initial state = the server prop, so
     hydration stays deterministic; the clock only moves in effects. */
  const router = useRouter();
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    let tick: ReturnType<typeof setInterval> | null = null;
    let refresh: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!tick) tick = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
      if (!refresh) refresh = setInterval(() => router.refresh(), REFRESH_MS);
    };
    const stop = () => {
      if (tick) clearInterval(tick);
      if (refresh) clearInterval(refresh);
      tick = refresh = null;
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        router.refresh(); // resume: last night's tiles must not survive the morning
        start();
      } else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [router]);

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
  const reg = regByKey(registry);

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
    const r = regOverride ?? reg[slug];
    const ts = m(slug, key)?.ts ?? null;
    if (cadenceStale(r?.cadence, ts, now) && tile.status === "green") tile.status = "amber";
    if (!tile.stamp) tile.stamp = cadenceStamp(r?.cadence, ts, now);
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
  const stepsTile = withCadence(
    simple("health-steps", "Body · steps yesterday", "health", "steps_today", {
      metricKeys: ["steps_today"],
    }),
    "health",
    "steps_today"
  );

  /* C7: red = the daily iPhone push didn't land. The 07-08 pass fixed the words but the biggest
     pixels still contradicted them (full-white 42 / 0 reading as fresh). Now the last REAL
     reading renders dimmed (the healthy-zero whisper treatment) + dated, a dead-default 0 (a
     counter that never counted, not a measurement) renders "–", and the sparkline goes quiet. */
  const stallHealthTile = (tile: TileDef | null, key: string, noun: string) => {
    const mm = m("health", key);
    if (!tile || mm?.status !== "red") return;
    tile.sub = `phone sync stalled · no fresh ${noun} from the iPhone · fix the Shortcut`;
    tile.dim = true;
    tile.history = undefined;
    const real = mm.value_num != null && mm.value_num !== 0;
    if (!real) tile.big = "–";
    const lastRealTs = real
      ? mm.ts
      : [...(mm.history ?? [])].reverse().find((h) => h.value_num != null && h.value_num !== 0)?.ts;
    if (lastRealTs) tile.stamp = `last real: ${fmtDay(lastRealTs)}`;
  };
  stallHealthTile(sleepTile, "sleep_score_today", "sleep");
  stallHealthTile(stepsTile, "steps_today", "steps");

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
    const cad = reg["sprint-tracker"]?.cadence;
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

  // Plants: count due today, computed at render from the raw dates (builder in @/components/life)
  const plantsTile = buildPlantsTile(life, now, reg["alex-hq"]);

  const appsMissing = !bi.drafted_today && !ai.drafted_today;
  // apps tile freshness: the newest drafted_today event across both lanes, aged against the
  // BI engine's registry cadence (daily 26h - the lanes are twins)
  const appsTs = [bi.drafted_today?.ts, ai.drafted_today?.ts].filter((t): t is string => !!t).sort().pop() ?? null;
  const appsReg = reg["app-engine-bi"];
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
      reg["alex-hq"]
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
      ? { id: open, kicker: reg[open.slice(5)]?.title ?? open.slice(5), projects: [open.slice(5)] }
      : open === "brain"
        ? { id: "brain", kicker: "Alex Brain · the structure", projects: ["infra"] }
        : open === "plants"
          ? plantsTile
          : tiles.find((t) => t.id === open) ?? null;

  return (
    <>
      {/* Skip-to-main (a11y 4.4): visually hidden until keyboard-focused, so the default render is
          unchanged; lets keyboard users jump the header/notes card straight to the dashboard. */}
      <a href="#hq-main" className="skip-link">
        Skip to dashboard
      </a>
      {/* deep-water drift: three blurred brand bubbles behind everything (respects reduced motion) */}
      <div className="bubbles" aria-hidden>
        <div className="bubble bubble-1" />
        <div className="bubble bubble-2" />
        <div className="bubble bubble-3" />
      </div>
    <main id="hq-main" className="relative z-10 mx-auto max-w-6xl p-4 pb-14 sm:p-6">
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
          (empty queue = nothing here; the healthy screen stays calm). Sits above the Notes card.
          Non-expanding banner since C6 — the overlay it opened only repeated the strip. */}
      <div className="mb-4">
        <WaitingStrip metric={humanActions} />
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
