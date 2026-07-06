# Alex Radar - Collector (15): the always-on ear

**Workflow ID:** `PYePT4Al6aPZi56M` · **Runs:** daily 06:00 (+ manual fire `GET /webhook/radar-collect`) · **Built:** 2026-07-06 (audit step 6 / Update Logic Phase A) · **Export in this folder:** workflow.json (latest)

## What it does

Every morning at 06:00, before anything else wakes up, this workflow quietly collects the AI-landscape feeds the Radar cares about most and drops them into a `radar_inbox` table on the server. The Monday Radar sweep then reads a week of collected signal from the table instead of fetching feeds live from the laptop. Point of the exercise: the laptop being asleep, out of battery, or out of quota no longer loses a week of "what happened in AI."

## The feeds it collects (Tier 1 + HN)

- **Claude Code releases, official MCP servers, the MCP specification, n8n releases** (GitHub atom feeds) - Alex's own stack; a release here can directly upgrade or break the system.
- **OpenAI news, Google DeepMind blog** (RSS) - the model vendors whose price and capability shifts change Alex's routing decisions.
- **Hacker News** (three Algolia API queries: mcp, claude, n8n) - the field's best free filter.

Product Hunt, Reddit, the MCP directories, and Anthropic's news page (no RSS) stay live-fetched by the Monday sweep itself; the two heaviest of those crashed the container when collected here (see the gotchas).

## The steps, node by node

- **Daily 06:00 / Manual Fire** - the schedule trigger and a webhook for hand-testing.
- **9 fetch nodes** (6 RSS + 3 HTTP) - each set to continue on error, so one dead feed never kills the run.
- **Normalize Items** (Code) - one shape for everything: title, url, source, published, summary, plus a hash of the canonical URL.
- **Filter New** (Code) - keeps items published in the last 3 days, dedups within the batch by hash, and flags `urgent=1` when a Tier 1 source uses breaking-change language OR anything matches the friction list keywords. Cross-day duplicates are accepted by design: the Monday sweep dedups by hash anyway.
- **Insert Rows** - into data table `radar_inbox` (`GLyqcNyG7iCudXcI`).
- **Build Urgent Note → Notify Inbox** - if anything was urgent, ONE aggregated note goes to the "Drop a note to Alex" inbox (`/webhook/alex-note`, field `text`), so breakage news reaches Shaheen the same day instead of waiting for Monday.

## Gotchas learned building it (full detail: vault error-log 2026-07-06)

- The dataTable node's `get` with returnAll crashed the whole n8n container once the table had rows; the workflow deliberately never reads the table.
- Crashed executions do NOT trigger the error-alert workflow; only real node errors do. The liveness harvest covers the crash class.
- The rows REST API paginates by `cursor` (`nextCursor` in the response); `skip`/`offset` are rejected.
- `/webhook/alex-note` requires the field `text`, not `note`.
- `saveDataSuccessExecution` must stay `all` or the liveness monitor sees a healthy workflow as silent.

## Connected to

- **[Alex AI Radar](../../projects/15-alex-ai-radar.md)** - the Monday sweep is the consumer; spec: work/15-alex-ai-radar/CLAUDE.md.
- **[Notes Inbox](../hq-notes-inbox/)** - receives the urgent-lane notes.
- **[Pipeline Error Alert](../pipeline-error-alert/)** - wired as this workflow's error handler.
- Builder script (idempotent): `work/15-alex-ai-radar/scripts/build-radar-collector.js`.
