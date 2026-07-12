"use client";

/* Life-ops cards (P9 extraction from dashboard.tsx, moved verbatim): the GymCard (no drill-down,
   the answer IS the card) and the plants-tile builder (render-time due-today count + stale-log
   guard). buildPlantsTile returns the same TileDef the dashboard placed inline before. */

import { motion } from "motion/react";
import type { LifeData, RegProject } from "@/lib/types";
import { daysSinceStockholm } from "@/lib/types";
import { plantsDue } from "@/lib/data";
import { CountUp, Dot, spring } from "@/components/primitives";
import type { TileDef } from "@/components/tile";

export function GymCard({ life, now, index }: { life: LifeData | null | "failed"; now: number; index: number }) {
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

/* Plants "Home · plants due" TileDef: count due today, computed at render from the raw dates.
   Moved verbatim from dashboard.tsx (same due-today-only logic, stale-log guard, snapshot honesty
   against #16's daily push cadence). `alexHqReg` is regByKey["alex-hq"], passed in so this stays a
   pure builder. */
export function buildPlantsTile(life: LifeData | null | "failed", now: number, alexHqReg: RegProject | undefined): TileDef {
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
    const lifeExp = (alexHqReg?.cadence?.expected_hours ?? 26) * 2;
    const lifeAgeH = (now - new Date(life.generated_at).getTime()) / 3600000;
    if (lifeAgeH > lifeExp && plantsTile.status === "green") {
      plantsTile.status = "amber";
      plantsTile.stamp = `${plantsTile.stamp ?? `watering data as of ${life.plants.as_of ?? "unknown"}`} · snapshot stale`;
    }
  }
  return plantsTile;
}
