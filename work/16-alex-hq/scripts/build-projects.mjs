// Alex HQ - project registry -> projects.json (the Automation Health board's roster)
// Source of truth: work/18-recovery-layer/manifest.json (THE project registry).
// HQ's health board used to discover projects only from who pushed a metric to alex_metrics,
// so ON-DEMAND/EVENT/DORMANT/PARKED projects (and LIVE ones never retrofitted with a push)
// were invisible. This ships the FULL registered roster; the frontend merges live metrics
// onto it by hq_slug. Add a project to the registry -> it appears on HQ automatically.
// Non-retired numbered projects + the meta.unnumbered ones. Deterministic, no deps.
// Usage: node build-projects.mjs [manifest] [outFile]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SRC = process.argv[2] ?? "C:/Users/Thinkpad/Desktop/personal-os/work/18-recovery-layer/manifest.json";
const OUT = process.argv[3] ?? "C:/Users/Thinkpad/Desktop/personal-os/work/16-alex-hq/app/public/data/projects.json";

const m = JSON.parse(readFileSync(SRC, "utf8"));

const row = (p, num) => ({
  name: p.name,
  num: num ?? null,
  title: p.title ?? p.name,
  state: p.state,
  trigger: p.trigger ?? "-",
  one_liner: p.one_liner ?? "",
  hq_slug: p.hq_project ?? null, // the alex_metrics slug this project pushes under (null = pushes none)
});

const numbered = m.projects
  .filter((p) => p.state !== "RETIRED") // retired = tombstoned, off the live board
  .map((p) => row(p, p.num));

const unnumbered = (m.meta?.unnumbered ?? []).map((u) => row(u, null));

const projects = [...numbered, ...unnumbered];

const out = {
  generated_at: new Date().toISOString(),
  count: projects.length,
  projects,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));

const reporting = projects.filter((p) => p.hq_slug).length;
console.log(`projects: ${projects.length} registered (${numbered.length} numbered + ${unnumbered.length} unnumbered), ${reporting} mapped to an HQ metric slug`);
