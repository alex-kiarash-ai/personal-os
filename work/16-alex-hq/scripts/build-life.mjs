// Alex HQ - life ops (gym cycle + plant watering) -> life.json
// Source of truth order: Life Ops Google Sheet -> Notion mirror -> these vault pages.
// This script reads the VAULT pages (vault/me/gym.md, vault/me/plants.md); whichever
// session syncs the sheet updates those pages first, then reruns this. The UI computes
// due-ness / gym-vs-rest at render time from the raw dates, so the card stays honest
// even when this file lags — and prints "as of" from the dates themselves.
// Usage: node build-life.mjs [vaultMeDir] [outFile]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const ME = process.argv[2] ?? "C:/Users/Thinkpad/Desktop/personal-os/vault/me";
const OUT = process.argv[3] ?? "C:/Users/Thinkpad/Desktop/personal-os/work/16-alex-hq/app/public/data/life.json";

// Gym: "- **Start date:** YYYY-MM-DD" (+ page date_updated as the confirmation date)
const gymText = readFileSync(join(ME, "gym.md"), "utf8");
const start = gymText.match(/\*\*Start date:\*\*\s*(\d{4}-\d{2}-\d{2})/);
if (!start) throw new Error("gym.md: no Start date line");
const gymAsOf = gymText.match(/date_updated:\s*(\d{4}-\d{2}-\d{2})/);

// Plants: the markdown table | # | Name | Latin | Every (days) | Last Watered | ...
const plantText = readFileSync(join(ME, "plants.md"), "utf8");
const plants = [];
for (const line of plantText.split("\n")) {
  const c = line.split("|").map((s) => s.trim());
  if (c.length < 7 || !/^\d+$/.test(c[1] ?? "")) continue;
  const every = Number(c[4]);
  const last = c[5];
  if (!Number.isFinite(every) || !/^\d{4}-\d{2}-\d{2}$/.test(last)) continue;
  plants.push({ name: c[2], every_days: every, last_watered: last });
}
if (plants.length === 0) throw new Error("plants.md: no plant rows parsed");
const plantAsOf = plantText.match(/date_updated:\s*(\d{4}-\d{2}-\d{2})/);

const out = {
  generated_at: new Date().toISOString(),
  gym: {
    start_date: start[1],
    interval_days: 2,
    label: "every 2nd day",
    as_of: gymAsOf ? gymAsOf[1] : null,
  },
  plants: {
    as_of: plantAsOf ? plantAsOf[1] : null,
    items: plants,
  },
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log(`life: gym start ${out.gym.start_date} · ${plants.length} plants (as of ${out.plants.as_of})`);
