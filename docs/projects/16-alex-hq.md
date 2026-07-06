# 16 - Alex HQ

## What it actually does
The glanceable dashboard: **https://hq.shaheenkiarash.com** (private, password-protected), built as a phone-installable web app in the Building Alex visual style. One screen shows the numbers that matter: daily tiles (jobs processed, drafts, inbox stats, brief status), weekly tiles, infrastructure tiles - and the flagship **automation health board**: every automation's last run, green/red status, and staleness (a daily job that hasn't reported in two days turns amber by itself). It's two-way: a "Drop a note to Alex" card accepts typed or voice notes any time; Alex collects and files them into the vault at its next touchpoint. Local numbers only this laptop can see (MCP tool count, vault size, scheduler health, backup age) are pushed up daily by the `/alex-hq` command.

Since 2026-07-06 there's a dedicated **"n8n · broken today"** card: it answers "is anything on the Hetzner box down right now?" in one glance. Calm and grey when all is well; a red number that names the culprit the instant any workflow fails (a workflow either erroring, or a daily one going quiet for more than a day). It goes red immediately - the moment a workflow throws, the error handler flips this card - and clears itself once the next health check confirms things are healthy again. Tapping it lists every active workflow on the box with when it last ran and what, if anything, is broken.

The same day brought a refinement round on the whole dashboard: real date-and-time stamps everywhere instead of "2h ago" guesswork, three new life cards - **To-Do** (the open items from the Notion build board), **gym today** (GYM or REST, computed from the every-second-day cycle), and **plants due** (which of the 8 houseplants need water, computed live from the watering log) - plus a next-booking line on the Airbnb tile, a by-category split behind the expenses tile, and a calmer look (slow drifting background, fewer mini-charts, no "tap for breakdown" labels).

## Why it exists
Sixteen automations produce numbers in sixteen places; the question "is everything actually working?" had no single answer. HQ is that answer, sized for a phone glance at a bus stop. The health board is the real point - automations fail silently by default, and this makes silence visible. The note-drop exists because thoughts arrive when Alex isn't running; now capture is always on. Deliberately: no Notion database, no chat - a dashboard and an inbox, nothing pretending to be a conversation.

## Works together with
- **Every automation** - all push run metrics to it (the "metrics contract"); it is the system's shared nervous system.
- **The n8n backend** - four workflows documented in [docs/n8n/](../n8n/): [metrics ingest](../n8n/hq-metrics-ingest/), [summary API](../n8n/hq-summary-api/), [pipeline stats sidecar](../n8n/hq-pipeline-stats/), [notes inbox](../n8n/hq-notes-inbox/).
- **[Pipeline Error Alert](../n8n/pipeline-error-alert/)** - the box's smoke alarm now feeds HQ directly: it guards all active workflows and flips the "n8n · broken today" card red on any failure.
- **[Morning Brief](02-morning-brief.md)** - quotes HQ health; collects dropped notes; the ≤24h backstop that reads the same failure alerts from the Notion side.
- **The Recovery layer** - the backup job and future integrity checker report their status here.
