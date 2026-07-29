"use client";

/* The HQ dashboard: composition + the tile map + the three section groupings + top-level state.
   The primitives, tile, overlay, breakdowns, health board and life-ops cards were extracted to
   @/components in the P9 refactor (design 4.3) - this file keeps the information architecture in
   one readable place. No logic changed in the move; the tile map + cadence shaping stay here. */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion, useScroll, useTransform } from "motion/react";
import { ageLabel, cadenceStale, clean, fmtDateTime, fmtDay, fmtNum, periodStartMs, weekdayAgeHours } from "@/lib/types";
import type { Inbox, LifeData, Metric, ProjectsData, RegProject, Status, Summary, TodosData } from "@/lib/types";
import { cadenceStamp, regByKey, stockholmDay, useJson, worst } from "@/lib/data";
import { CountUp, Dot } from "@/components/primitives";
import { ThemeToggle } from "@/components/theme-toggle";
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
/* R2-1: the mount kick asks the server for fresh data, but ISR SERVES the stale payload on that
   first hit past the window and only regenerates behind it — so one kick can legitimately return
   the same stale render. This second, short-delayed refresh is the one that lands the regenerated
   page. Two cheap requests kill the whole class instead of the instance. */
const COLD_START_SETTLE_MS = 6_000;

export function Dashboard({ summary: s, now: serverNow, inbox }: { summary: Summary; now: number; inbox: Inbox | null }) {
  const [open, setOpen] = useState<string | null>(null);

  /* 2026-07-29 reskin: the background layers drift slower than the content on scroll (depth
     parallax). Transform-only, one motion value, and reduced motion pins it still — the same
     charter every other motion obeys. */
  const reduced = useReducedMotion() ?? false;
  const { scrollY } = useScroll();
  const bubbleY = useTransform(scrollY, [0, 1400], [0, -90]);

  /* C13: in a standalone PWA, Back is the universal dismiss gesture — without this it exited
     the whole app from inside a drill-down, the most expensive possible mis-tap. Opening pushes
     ONE history entry (merged into the existing state so Next's router keys survive); the Back
     gesture (popstate) closes the overlay; programmatic closes (Escape / ✕ / backdrop) consume
     that entry via history.back() so the stack never grows. Refresh with an overlay open leaves
     the marker on the CURRENT entry only: the reloaded page has no overlay, and the first Back
     just re-lands on the page (popstate → already-null no-op) — nothing strands. */
  const openRef = useRef<string | null>(null);
  const openOverlay = useCallback((id: string) => {
    if (!openRef.current) window.history.pushState({ ...window.history.state, hqOverlay: true }, "");
    openRef.current = id;
    setOpen(id);
  }, []);
  const closeOverlay = useCallback(() => {
    openRef.current = null;
    setOpen(null);
    if (window.history.state?.hqOverlay) window.history.back();
  }, []);
  useEffect(() => {
    const onPop = () => {
      openRef.current = null;
      setOpen(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /* C2: the standalone PWA has no reload UI, so without this the summary NEVER refetched
     client-side — resumed at 08:00 it showed last night's tiles with "7h ago" frozen. On
     visibilitychange -> visible: refresh the server payload + recompute "now"; while visible,
     a slow interval keeps both live. router.refresh() merges the new RSC payload without
     touching client state (a half-typed note survives). Initial state = the server prop, so
     hydration stays deterministic; the clock only moves in effects. */
  /* R2-1: C2 covered RESUME but never COLD START, and a cold open is the more dangerous one.
     `revalidate = 60` serves stale-while-revalidate, `now` initialised to the server's value, and
     the first interval refresh sat 120s away — so an open after any quiet period painted an old
     payload with a frozen clock for longer than the whole 10-second glance. Proven in the round-2
     renders: the desktop said REST on a live GYM day while mobile, refreshed, said GYM. Getting
     the DAY wrong is not staleness, it is a confidently wrong instruction. */
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
    let settle: ReturnType<typeof setTimeout> | null = null;
    if (document.visibilityState === "visible") {
      // the mount kick: recompute the clock and ask for fresh data NOW, not in two minutes
      setNow(Date.now());
      router.refresh();
      settle = setTimeout(() => router.refresh(), COLD_START_SETTLE_MS);
      start();
    }
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      if (settle) clearTimeout(settle);
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
    opts?: { spark?: boolean; noAccent?: boolean; burn?: boolean; metricKeys?: string[] }
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
      // C8: opts.burn marks an ACTION count — non-zero renders the numeral in Rusty Spice
      burn: (opts?.burn ?? false) && mm.value_num != null && mm.value_num > 0,
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
    const stale = cadenceStale(r?.cadence, ts, now);
    if (stale && tile.status === "green") tile.status = "amber";
    if (!tile.stamp) tile.stamp = cadenceStamp(r?.cadence, ts, now);
    /* R2-8: red tiles name their offender, amber tiles just glowed. A cadence-lifted amber knows
       exactly why it lifted (its own cadence + its own last event), so it says so instead of
       making the reader open a drill-down to find out. Only appended when the stamp doesn't
       already carry the age itself ("missed today · last ..." already answers it). */
    if (stale && ts && tile.stamp && !/missed|last /i.test(tile.stamp))
      tile.stamp = `${tile.stamp} · stale, last ${fmtDay(ts)}`;
    return tile;
  };

  /* R2-9: period honesty, the C7 stall treatment generalized to every RESET-period tile. A kicker
     that names a period ("done this week") asserts a CURRENT-period fact in the page's biggest
     type; when the producer's last event predates that period's start, the numeral is not this
     week's number and must stop looking like it. Deliberately NOT blanket: cumulative tiles
     (YTD income, MTD expenses) stay honest while stale, so dimming them would lie the other way.
     The tile declares its semantics; nothing is inferred. */
  const periodHonesty = (tile: TileDef | null, slug: string, key: string, period: "day" | "week") => {
    if (!tile) return;
    const ts = m(slug, key)?.ts;
    if (!ts || new Date(ts).getTime() >= periodStartMs(period, now)) return;
    tile.dim = true;
    tile.history = undefined;
    tile.stamp = `stale · last real ${fmtDay(ts)}`;
  };

  // per-tile shaping (2026-07-06 feedback round): absolute stamps, sparklines only where
  // the trend means something, subs carrying the ONE next-action fact
  const airbnbTile = withCadence(simple("airbnb", "Airbnb · YTD kr", "airbnb", "ytd_income_kr", { spark: false }), "airbnb", "ytd_income_kr");
  const nextBooking = m("airbnb", "next_booking");
  if (airbnbTile && nextBooking) airbnbTile.sub = `next: ${clean(nextBooking.value_text) || clean(nextBooking.headline) || "no booking"}`;
  // C21 bento resolve: airbnb spans 2 (the plan's call) and expenses joins it (the only RHYTHMS
  // tile with a sparkline + category sub — width serves it) so the section squares at every
  // breakpoint: 4 singles + two doubles = two full rows at 1440, no trailing holes.
  if (airbnbTile) airbnbTile.className = "sm:col-span-2";

  // weekly producer (Mon sweep): the registry cadence labels it so a 6-day-old stamp reads as
  // "on schedule", not "stuck"; amber only past 8 days
  const radarTile = withCadence(simple("radar", "Radar · shipped 30d", "radar", "shipped_30d", { spark: false }), "radar", "shipped_30d");

  // weekdays producer: the staleness math skips weekends, so a Friday run is fresh on Monday morning
  // kicker shortened C19: "Build tasks · done this week" wrapped a 4-col tile at 1440 once
  // kickers stepped up to 0.7rem; the sub still carries the in-progress/next detail
  const buildTile = withCadence(simple("build", "Build · done this week", "sprint", "velocity", { spark: false }), "sprint", "velocity");
  // "done this week" is a resetting counter: a 9-day-old velocity is not this week's number
  periodHonesty(buildTile, "sprint", "velocity", "week");

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

  /* R2-6: one dead iPhone Shortcut was printing itself as two identical alarm paragraphs. Both
     tiles keep their honest red — both metrics really are stalled — but the cause is READ once.

     The predicate is deliberately a FACT, not a diagnosis: same project, both red, and the exact
     same push timestamp, i.e. the two metrics arrived in one delivery and stopped at the same
     instant. The health project has exactly one delivery path (the iPhone Shortcut), so naming it
     shared repeats no claim the data doesn't already carry. Inferring a shared cause ACROSS
     projects is the fabricated correlation the 2026-07-13 debate killed, and it stays killed.

     Matching on headline TEXT was tried first and was dead on arrival: the live producer sends
     "night of 2026-07-22 · 6.4h" and "yesterday · 2026-07-22", never the word "stalled" (the
     stall wording is authored here, by stallHealthTile). That is the same class of bug as the C5
     `oldest Nd` parser that sat dead for weeks — a client matching a string the producer never
     sends. Ride timestamps and status, which the contract actually guarantees. */
  const sleepM = m("health", "sleep_score_today");
  const stepsM = m("health", "steps_today");
  const twinStall =
    sleepM?.status === "red" && stepsM?.status === "red" && !!sleepM.ts && sleepM.ts === stepsM.ts;
  if (twinStall && stepsTile) stepsTile.sub = "same phone sync as sleep · no fresh steps either";

  // monthly producer (runs month-end): the cadence stamp ("monthly · closes month-end") makes a
  // mid-month 0 read as "not captured yet", not "broken"; never amber mid-cycle, zero renders dim
  const expensesTile = withCadence(simple("expenses", "Expenses · MTD kr", "expenses", "mtd_total_kr"), "expenses", "mtd_total_kr");
  const mtdCat = m("expenses", "mtd_by_category");
  if (expensesTile && mtdCat && mtdCat.value_text) expensesTile.sub = clean(mtdCat.value_text);
  if (expensesTile) expensesTile.className = "sm:col-span-2"; // C21, see the airbnb note

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
  /* R2-8: this tile's stamp is its cadence LABEL ("twice weekly (Tue & Thu)"), which explains the
     schedule but never why the tile is amber right now. Same rule as withCadence: the amber says
     what made it amber. */
  const appsStampBase = cadenceStamp(appsReg?.cadence, appsTs, now);
  const appsStamp =
    appsStale && appsTs && appsStampBase && !/missed|last /i.test(appsStampBase)
      ? `${appsStampBase} · stale, last ${fmtDay(appsTs)}`
      : appsStampBase;
  const tiles: TileDef[] = [
    // label matches the number: DRAFTED TODAY; the ready-to-apply lane counts are the page's
    // biggest true backlog (explicitly "waiting on you" in the drill-down), so C21 promotes
    // them from a muted sub to secondary numerals in the aqua accent tier (never Golden
    // Orange) — the span-2 tile finally uses its width.
    appsMissing
      ? null
      : {
          id: "apps",
          kicker: "Applications · drafted today",
          projects: ["app-engine-bi", "app-engine-ai"],
          status: appsStale ? worst(appsStatus, "amber") : appsStatus,
          big: <CountUp value={drafted} />,
          accent: (
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span>ready to apply</span>
              <span className="accent-num">BI {fmtNum(bi.draft_ready_total?.value_num ?? null)}</span>
              <span>·</span>
              <span className="accent-num">AI {fmtNum(ai.draft_ready_total?.value_num ?? null)}</span>
            </span>
          ),
          stamp: appsStamp,
          className: "sm:col-span-2",
        },
    // Broken n8n today: green 0 whispers, a red count shouts. The one glance that answers
    // "is anything on the box down right now?" — fed daily by the liveness harvest and
    // flipped red instantly by the Pipeline Error Alert workflow the moment something throws.
    // Drill-down = the full running-workflow list (n8n-workflows.json). The infra metrics are
    // produced by #16's daily local push, so its registry row carries their cadence.
    withCadence(
      simple("n8n-broken", "n8n · broken today", "infra", "n8n_broken_today", { spark: false, noAccent: true, burn: true }),
      "infra",
      "n8n_broken_today",
      reg["alex-hq"]
    ),
    withCadence(simple("brief", "Morning Brief · urgent", "morning-brief", "urgent_count", { spark: false, burn: true }), "morning-brief", "urgent_count"),
    withCadence(simple("email", "Email · act now", "email-triage", "act_now", { spark: false, burn: true }), "email-triage", "act_now"),
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
  // C21 order: the four singles fill row 1 at 1440 (plants joins them), the two span-2 tiles
  // (airbnb + expenses) fill row 2 — no trailing holes at any breakpoint. Plants moved from the
  // appended slot into the mapped list so the order is one visible line here.
  const RHYTHMS_IDS = ["build", "todos", "radar"];
  const todayTiles = TODAY_IDS.map((id) => byId.get(id)).filter((t): t is TileDef => !!t);
  const rhythmTiles = [...RHYTHMS_IDS.map((id) => byId.get(id)), plantsTile, byId.get("airbnb"), byId.get("expenses")].filter(
    (t): t is TileDef => !!t
  );

  // C11: one heartbeat per section — only the FIRST red tile in each grid pulses; every other
  // red is a steady alarm ("~9 dots pulsing in sync on an alarm day breaks the panel's own
  // 'breathes, never dances' charter"). Amber never pulsed and still doesn't.
  const markWorstPulse = (list: TileDef[]) => {
    const worstRed = list.find((t) => t.status === "red");
    if (worstRed) worstRed.pulse = true;
  };
  markWorstPulse(todayTiles);
  markWorstPulse(rhythmTiles);

  /* R2-10: a ratio rendered as a bare numeral cannot be judged. The strip preferred value_num, so
     the producer's "6 of 6 scheduled on-cadence" collapsed to "6" — and that stat is the only
     strip-level trace of a workflow falling off cadence. The denominator is EXTRACTED from the
     string the client already holds (display work, never an invented number); no match = the
     generic label, never a guess. "mcp tools" is also relabelled: the metric has counted connected
     SERVERS since 2026-07-21 and the label never caught up. */
  const denomOf = (mm: Metric | null): string | null => {
    const match = clean(mm?.value_text).match(/\bof\s+(\d+)/i);
    return match ? `of ${match[1]}` : null;
  };
  const n8nUp = infra.n8n_up_today ?? null;
  const n8nDenom = denomOf(n8nUp);
  /* R2-18: five stats in a 3-column mobile grid left a trailing hole the desktop bento was
     groomed to zero of. Six tracks: three half-width on top, two wide underneath — which is also
     what lets the .k labels take the 0.7rem craft band without clipping ("scheduled jobs" and the
     on-cadence label are the two longest, so they get the wide cells). */
  const brainStats: { label: string; metric: Metric | null; fixed: string | null; span: string }[] = [
    { label: "vault pages", metric: infra.vault_pages ?? null, fixed: null, span: "col-span-2" },
    { label: "mcp servers", metric: infra.mcp_tools ?? null, fixed: null, span: "col-span-2" },
    { label: "projects", metric: null, fixed: String(projectCount), span: "col-span-2" },
    { label: "scheduled jobs", metric: infra.scheduled_jobs_active ?? null, fixed: null, span: "col-span-3" },
    { label: n8nDenom ? `${n8nDenom} on-cadence` : "n8n on-cadence", metric: n8nUp, fixed: null, span: "col-span-3" },
  ];

  /* R2-2: THE VERDICT LINE — the one act of synthesis the page never performed. The header spent
     its only line on store plumbing ("N events · updated ...") while the reader summed four red
     tiles, a red strip, a red brain dot and eleven board rows in their own head.

     It ENUMERATES and it NEVER TOTALS, and that is a correctness property, not a style choice: a
     count like "3 need you" would require deciding whether the n8n red and the health red are one
     problem or two, which is exactly the client-side cause-matching the 2026-07-13 debate killed
     as fabricated correlation. Every fragment below is one producer-pushed number or status
     rendered verbatim, so there is no arithmetic in which a wrong claim could hide. */
  const needsYou: string[] = [];
  const pushCount = (project: string, key: string, label: string) => {
    const mm = m(project, key);
    if (mm?.value_num != null && mm.value_num > 0) needsYou.push(`${fmtNum(mm.value_num)} ${label}`);
  };
  pushCount("email-triage", "act_now", "email");
  pushCount("morning-brief", "urgent_count", "urgent");
  pushCount("infra", "n8n_broken_today", "n8n broken");
  if ((humanActions?.value_num ?? 0) > 0) needsYou.push(`${fmtNum(humanActions!.value_num!)} waiting`);
  // the health stall names itself once here, for the same reason the twin tile stopped repeating it
  if (twinStall || sleepM?.status === "red" || stepsM?.status === "red") needsYou.push("phone sync stalled");

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
      {/* deep-water drift: three blurred brand bubbles behind everything (respects reduced
          motion), riding the slow scroll parallax above */}
      <motion.div className="bubbles" aria-hidden style={reduced ? undefined : { y: bubbleY }}>
        <div className="bubble bubble-1" />
        <div className="bubble bubble-2" />
        <div className="bubble bubble-3" />
      </motion.div>
    <main id="hq-main" className="relative z-10 mx-auto max-w-6xl p-4 pb-14 sm:p-6">
      {/* Header: the ALEX mark, no runway */}
      <motion.header
        className="tile mb-4 flex flex-col gap-2 p-4 sm:gap-3 sm:p-6"
        style={{ cursor: "default" }}
        initial={{ opacity: 0, y: -18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {/* R2-13: mobile chrome pays fold rent on every glance, so the phone gets a tighter
              logo and the header a tighter box; the stamp stays here (measured: it sits BESIDE
              the logo at 390, so it costs no height, and moving it into the verdict row only
              made that row wrap). Freshness disclosure is what let R2-1 drop the shimmer. */}
          {/* h-8 at 390 keeps logo + stamp + toggle on ONE row (the R2-13 "stamp sits BESIDE the
              logo so it costs no height" invariant survived adding the toggle by shrinking the
              mark, not by wrapping the row). The chip is the light-theme dark block behind the
              wordmark (Phase B #6); on dark it renders transparent. */}
          <span className="logo-chip">
            <img src="/alex-logo.png" alt="ALEX" className="h-7 w-auto sm:h-12" />
          </span>
          <span
            className="ml-auto text-xs tabular-nums"
            style={{ color: "var(--mute)" }}
            title={`${s.row_count} events · ${ageLabel(s.generated_at, now)}`}
          >
            {/* 390 shows a compact stamp so logo + stamp + toggle hold ONE row: time-only while
                the payload is from today, the FULL date the moment it goes stale (compactness
                never hides staleness). Desktop keeps the full line + event count. */}
            <span className="hidden sm:inline">
              {s.row_count} events · updated {fmtDateTime(s.generated_at)}
            </span>
            <span className="sm:hidden">
              updated{" "}
              {stockholmDay(new Date(s.generated_at).getTime()) === stockholmDay(now)
                ? fmtDateTime(s.generated_at).slice(11)
                : fmtDateTime(s.generated_at)}
            </span>
          </span>
          {/* the manual night toggle: light is the default on every open (Shaheen 2026-07-29) */}
          <ThemeToggle />
        </div>
        <div className="filament" />
        {/* R2-2: the answer to "how is my life-system doing today", stated in words, first */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {/* Phase B #4: this line IS the page's answer — on desktop it steps up to text-base +
              medium so it outweighs the plumbing around it; 390 keeps text-sm for the fold */}
          {needsYou.length ? (
            <>
              <span className="kicker whitespace-nowrap">Needs you</span>
              {needsYou.map((fragment, i) => (
                <span key={fragment} className="text-sm font-medium sm:text-base" style={{ color: "var(--paper)" }}>
                  {i > 0 ? <span style={{ color: "var(--mute)" }}>· </span> : null}
                  {fragment}
                </span>
              ))}
            </>
          ) : (
            <>
              <span className="kicker whitespace-nowrap">Today</span>
              <span className="text-sm font-medium sm:text-base" style={{ color: "var(--aqua)" }}>
                all clear
              </span>
            </>
          )}
        </div>
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
          <Tile key={t.id} {...t} index={i} onOpen={openOverlay} />
        ))}
        {/* Gym lives in TODAY (computed daily): the answer IS the card, no drill-down */}
        <GymCard life={life} now={now} index={todayTiles.length} />
      </section>

      {/* RHYTHMS: this week / month (design 4.1). Plants renders inside rhythmTiles since C21.
          C18: label unified aqua with its siblings (the mute override was an undocumented
          leftover) — section separation now comes from the bigger break, not a dimmer label. */}
      <span className="kicker mb-2 mt-10 block">This week / month</span>
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {rhythmTiles.map((t, i) => (
          <Tile key={t.id} {...t} index={i} onOpen={openOverlay} />
        ))}
      </section>

      {/* SYSTEM: the Alex Brain strip, the health board, the graph (design 4.1). */}
      <span className="kicker mb-2 mt-10 block">System</span>
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Alex Brain: the structure strip */}
        <motion.button
          layoutId="tile-brain"
          onClick={() => openOverlay("brain")}
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
            {/* C11: the strip is the SYSTEM grid's only dot, so red here = the section's worst */}
            <Dot status={infraStatus} pulse={infraStatus === "red"} />
          </div>
          <div className="grid grid-cols-6 gap-x-4 gap-y-3 sm:flex sm:flex-wrap sm:items-end sm:justify-between sm:gap-x-6">
            {brainStats.map(({ label, metric: mm, fixed, span }) => (
              <div key={label} className={`brain-stat ${span} sm:col-span-1`}>
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
        <HealthBoard projects={s.projects} registry={registry} now={now} onOpen={openOverlay} />
      </section>

      {/* The Brain graph */}
      <section className="mt-4">
        <BrainGraph />
      </section>

      <footer className="mt-6 text-center text-xs" style={{ color: "var(--mute)" }}>
        Personal Ops System · the vault is the brain, this is the face
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
            onClose={closeOverlay}
          />
        ) : null}
      </AnimatePresence>
    </main>
    </>
  );
}
