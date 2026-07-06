// Alex HQ - sprint vault snapshot -> todos.json (the To-Do card's data)
// Source: vault/projects/sprint-tracker/status.md — the board snapshot table (the only
// complete read path for the Notion Progress Tracker; search caps below the row count)
// PLUS any "## Update YYYY-MM-DD" sections newer than the snapshot that add rows by hand
// (`New row **"Task"**: ... Status **X**`). Non-Done rows only.
// Usage: node build-todos.mjs [statusFile] [outFile]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SRC = process.argv[2] ?? "C:/Users/Thinkpad/Desktop/personal-os/vault/projects/sprint-tracker/status.md";
const OUT = process.argv[3] ?? "C:/Users/Thinkpad/Desktop/personal-os/work/16-alex-hq/app/public/data/todos.json";

const text = readFileSync(SRC, "utf8");

// 1. Snapshot table: "## Board snapshot (updated YYYY-MM-DD, ...)"
const snapHead = text.match(/## Board snapshot \(updated (\d{4}-\d{2}-\d{2})/);
if (!snapHead) throw new Error("no board snapshot heading found");
const snapshotDate = snapHead[1];
const snapStart = text.indexOf(snapHead[0]);
const snapEnd = text.indexOf("\n## ", snapStart + 1);
const snapBlock = text.slice(snapStart, snapEnd === -1 ? undefined : snapEnd);

const items = new Map(); // lowercase task -> { task, status, since }
for (const line of snapBlock.split("\n")) {
  const cells = line.split("|").map((c) => c.trim());
  // | # | Task | Status | Since | Page ID |  -> 7 cells with empty ends
  if (cells.length < 6 || !/^\d{4}-\d{2}-\d{2}$/.test(cells[4] ?? "")) continue;
  const [task, status, since] = [cells[2], cells[3], cells[4]];
  if (!task || task === "Task") continue;
  items.set(task.toLowerCase(), { task, status, since });
}

// 2. Hand-added rows in update sections NEWER than the snapshot
const sections = [...text.matchAll(/## Update (\d{4}-\d{2}-\d{2})[^\n]*\n([\s\S]*?)(?=\n## |$)/g)];
for (const [, date, body] of sections) {
  if (date <= snapshotDate) continue;
  for (const m of body.matchAll(/New row \*\*"([^"]+)"\*\*[^\n]*?Status \*\*([A-Za-z ]+)\*\*/g)) {
    const task = m[1];
    const status = m[2].trim();
    const sinceM = body.slice(m.index).match(/Since (\d{4}-\d{2}-\d{2})/);
    const since = sinceM ? sinceM[1] : date;
    if (!items.has(task.toLowerCase())) items.set(task.toLowerCase(), { task, status, since });
  }
}

const ORDER = { "In Progress": 0, Next: 1, Blocked: 2, Planned: 3 };
const open = [...items.values()]
  .filter((r) => r.status !== "Done" && r.status in ORDER)
  .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.since.localeCompare(b.since) || a.task.localeCompare(b.task));

const out = { generated_at: new Date().toISOString(), snapshot_date: snapshotDate, items: open };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
const counts = {};
for (const r of open) counts[r.status] = (counts[r.status] ?? 0) + 1;
console.log(`todos: ${open.length} open of ${items.size} rows`, JSON.stringify(counts));
