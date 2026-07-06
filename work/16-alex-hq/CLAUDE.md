# Alex HQ

## Type
Automation (metrics dashboard: always-on backend + PWA frontend + on-demand local push command)

## Purpose
The glanceable numbers layer of the Personal OS. Every automation reports its key metrics to one store; Alex HQ renders them as a branded, advanced bento dashboard reachable from Shaheen's phone (PWA) and PC, answering "how is my life-system doing today" in 10 seconds. **Two-way since 2026-07-02:** metrics flow up to Shaheen's eyes, and Shaheen's notes (typed or voice) flow down to Alex through the Inbox Contract below - an ASYNC capture inbox, not a chat. VS Code stays the cockpit, the vault stays the brain, HQ is the face (now with ears). Born from [[research/alex-push-ui-delivery-layer]] (architecture) + [[research/alex-hq-tiles-and-stack]] (tiles, infra signals, stack; /research-team run 6).

## Entry Points
- **Always-on backend:** two n8n webhook endpoints on the Hetzner box (see Infrastructure).
- **Producers:** every automation's post-run step POSTs metric events (retrofit one at a time, morning-brief first).
- **On-demand:** `/alex-hq` - harvests local-only metrics (MCP tool count, vault page counts, scheduler status), pushes them, prints the live summary.
- **Frontend:** Next.js PWA (work/16-alex-hq/app/), Docker on Hetzner beside n8n (deployment pending, see status.md).

## The Metrics Contract (v1, frozen 2026-07-02)
One event = one JSON object. POST single, array, or `{"events": [...]}` to the ingest endpoint:
```json
{ "project": "app-engine-bi",        // required, stable slug
  "metric_key": "drafted_today",     // required, stable per project
  "value_num": 2,                    // optional number (sparkline source)
  "value_text": "2 of 20",           // optional display string
  "headline": "Acme Corp drafted",    // optional one-liner
  "status": "green|amber|red",       // optional, default green
  "ts": "ISO-8601"                   // optional, default now
}
```
Append-only history; the summary endpoint reduces to latest-per-(project, metric_key) + last-14 history + worst-status-per-project. New automation = one POST line. Store keeps ~90 days (pruning TODO once volume justifies it); the vault remains the permanent memory.

## Infrastructure (as built 2026-07-02)
- **Store:** n8n Data Table `alex_metrics`, id `etzrOnviaxXQFPll` (7 columns matching the contract). Native on the box, zero new infra.
- **Ingest:** workflow `V0AXq5QfJBu8WMk5` "Alex HQ - Metrics Ingest (16)" → `POST https://n8n.shaheenkiarash.com/webhook/alex-push`.
- **Read API:** workflow `GLcMPA4m0DRGjnQH` "Alex HQ - Summary API (16)" → `GET https://n8n.shaheenkiarash.com/webhook/alex-hq-summary`.
- **Notes inbox (two-way, 2026-07-02):** data table `alex_inbox`, id `vxiU4IU7S0OvmcXy` (note, source, status, filed_to, ts, filed_ts, audio) + workflow `701jclfh3q4d8l1q` "Alex HQ - Notes Inbox (16)" with 4 lanes: `POST /webhook/alex-note` (typed) · `POST /webhook/alex-note-voice` (multipart audio → file on the box, see Inbox Contract) · `GET /webhook/alex-inbox` (list: count_new/new/recent) · `POST /webhook/alex-inbox-mark` (flip to filed). Voice audio lands in `/opt/alex-inbox-audio` (bind-mounted at `/data/inbox-audio` in the n8n container; `N8N_RESTRICT_FILE_ACCESS_TO=/data/inbox-audio` allowlists exactly that dir).
- **Auth:** ALL webhooks gated by header `X-Alex-Token` (n8n credential `m6VkVeG9bym6OFID` "Alex HQ Token"). Token at `work/16-alex-hq/config/alex-hq-token.txt` - NEVER in the vault, repo docs, or logs. 403 without it (verified).
- **Seeding/ops fallback:** the n8n REST rows API (`/api/v1/data-tables/{id}/rows`, X-N8N-API-KEY) can read/write rows directly for repairs.
- Workflow JSON backups in config/ (wf-ingest, wf-summary, wf-inbox, wf-pipeline-stats).

## Tools Used
- n8n REST API (workflow + data-table management, pattern from work/03/14)
- Bash/curl (push + verify), PowerShell (local metric harvest: schtasks, file counts)
- Frontend: Next.js + Tailwind + shadcn/ui + Recharts, official shadcn MCP server during builds, headless Chrome screenshot QA
- Skills: frontend-design (visual direction), ui-ux-pro-max, ui-styling, design-system

## Notion Integration
**None, by design** (decided 2026-07-02). The metrics store is the n8n data table; mirroring it to Notion would duplicate state the dashboard already renders. HQ READS nothing from Notion directly (producers do that in their own pipelines).

## The Inbox Contract (two-way notes, v1, 2026-07-02)
Shaheen drops a note (typed or voice) into the "Drop a note to Alex" card on the PWA; Alex files it into the vault at the next touchpoint. **Async inbox, NOT a chat** - the expectation set with Shaheen is explicit: notes are read at 08:00 (morning-brief), 09:00/13:00/17:00 (email-triage), any /alex-hq or /status run, and every live session. A note at 18:45 about a 19:00 meeting will not beat the clock.

**Flow:**
1. PWA card → `/api/note` (typed JSON) or `/api/voice` (MediaRecorder FormData, max ~2 min) - Next.js route handlers hold the token server-side (`HQ_WEBHOOK_BASE` + `ALEX_HQ_TOKEN` envs); the browser never sees it.
2. n8n inserts an `alex_inbox` row (`status=new`). Voice: audio file written to `/opt/alex-inbox-audio/{name}` (host), row carries the filename in `audio`, `note` stays empty until transcription.
3. **Ingest (every touchpoint):** GET `/webhook/alex-inbox`; if `count_new` 0 → skip. Voice notes: `scp n8n:/opt/alex-inbox-audio/{audio}` to the session scratchpad → transcribe with LOCAL Whisper (`whisper <file> --model base --output_format txt`, the #06 meeting-intel protocol; no OpenAI key exists or is needed) → transcript = note text. File EVERY note per the standing vault protocols (dated event → Google Calendar; person → People Intake; goal/preference → vault/me/; meeting → vault/meetings/; project → vault/projects/; else best-fit page) with [[links]] + vault/log.md. Scheduled runs never block on questions: best-guess + `data-gap` tag, questions surface in the next interactive session.
4. **Mark filed:** POST `/webhook/alex-inbox-mark` `{"marks":[{"id":N,"filed_to":"<short destination>","note":"<final text>"}]}`. `note` is REQUIRED on every mark (original text for typed, transcript for voice - it backfills the voice row so the PWA list shows what was heard). After a successful voice mark: delete the remote audio (`ssh n8n "rm -f /opt/alex-inbox-audio/{audio}"`) and the local copy. Audio never persists anywhere after filing.
5. The PWA card shows the last 5 notes with waiting/filed status + destination, so Shaheen sees the loop close.

**Hard rules:** never print the token; never fail a parent run on an unreachable inbox (one line, continue); never leave audio behind after a mark; a note is never deleted, only filed (append-only history in the table, ~90-day pruning with the metrics).

## Tile Map v2.1 (2026-07-06 feedback round; v1 archived in git history of this file)
- **Header:** ALEX mark + `{row_count} events · updated {absolute Stockholm stamp}` (relative age in the tooltip). Background: 3 slow blurred brand bubbles (pure CSS, transform-only, 90/120/150s, reduced-motion aware).
- **Glance grid:** Applications drafted-today (spans 2, both-lanes drill-down) · n8n broken-today (drill-down = full workflow list, see below) · morning-brief `urgent_count` · email-triage `act_now` · airbnb `ytd_income_kr` (sub = `next_booking`: guest + dates, seeded "a guest · sample dates") · radar `shipped_30d` (+ "last run {stamp}") · expenses `mtd_total_kr` (sub = `mtd_by_category` compact string; drill-down parses it into category rows) · sprint `velocity` (+ "last run {stamp}") · **To-Do · build board** (IP+Next count; drill-down = open items grouped by status with since dates; data = `todos.json` from the sprint vault snapshot via `scripts/build-todos.mjs`) · health sleep + steps (each with "pushed {stamp}"; drill-downs scoped via metricKeys so they no longer duplicate) · **Body · gym today** (GYM/REST computed at render from `life.json` cycle anchor; not clickable) · **Home · plants due** (count due today computed at render from `life.json` last-watered dates; names in sub; drill-down lists all 8 with next-due; stale-log guard when everything is >2x cadence overdue).
- **Sparklines:** only steps (14-day trend) + expenses keep tile sparklines (Shaheen 2026-07-06: removed from email/brief/airbnb/radar/build/sleep/n8n). Big history charts inside drill-downs stay.
- **Timestamps:** every drill-down shows `{absolute Europe/Stockholm} · {relative}` per project header and per metric row; Brain graph card + Brain drill-down show the graph build stamp. Formatter: `fmtDateTime` in app/lib/types.ts (Intl formatToParts en-GB + manual assembly - deterministic, hydration-safe; never raw toLocaleString).
- **Infra row / Alex Brain strip:** automation health board (derived from per-project `status` + `last_ts` age) · infra `mcp_tools` + `vault_pages` · infra `scheduled_jobs_active` · infra `n8n_up_today` (active n8n workflows that ran today over active count, computed each daily harvest by `scripts/n8n_liveness.py` since 2026-07-04 - was a one-shot push before).
- **Static data JSONs (channel B, scp to n8n:/opt/alex-hq-data/, volume-mounted, NO rebuild):** `graph.json` (build-graph.mjs) · `todos.json` (build-todos.mjs, parses vault/projects/sprint-tracker/status.md snapshot table + newer "New row" update lines) · `life.json` (build-life.mjs, parses vault/me/gym.md Start-date line + vault/me/plants.md table - update those vault pages from the Life Ops sheet FIRST when fresher) · `n8n-workflows.json` (written by n8n_liveness.py alongside its stdout metrics). All four built + shipped by /alex-hq step 1b.
- **"n8n · broken today" glance tile (added 2026-07-06):** infra `n8n_broken_today` - the one card that answers "is anything on the box down right now?". Green 0 whispers, a red count burns and names the offenders. The number = workflows broken RIGHT NOW: latest run errored, OR an expected-daily workflow (`#03`/`#14`/pipeline-stats/health-ingest/radar-collector, the last added 2026-07-06) gone silent >26h. Computed by the enhanced `scripts/n8n_liveness.py` (emits a 2-event array `n8n_up_today` + `n8n_broken_today` on stdout AND writes `app/public/data/n8n-workflows.json`, the per-workflow list) on every daily/on-demand harvest, AND flipped red instantly by the **Pipeline Error Alert** workflow (it writes `n8n_broken_today` red straight into `alex_metrics` the moment any guarded workflow throws; the next harvest reconciles the exact count / clears to green - self-heals like sprint run_status). Full n8n error-handler coverage was wired 2026-07-06 (`scripts/wire-all-error-handlers.js`, 13/14 active workflows). The break also cascades to two backup surfaces via worst-status-per-project: the Alex Brain strip and the `infra` health-board row both go red. **Drill-down (v2.1, 2026-07-06):** tapping the tile opens the full list - "broken now" section (or "all N healthy") + every active workflow with its last-execution stamp, footer honest about harvest-cadence freshness ("as of {stamp} · an error flips the tile red instantly").

## Vault Structure
- Tier 1: vault/projects/alex-hq/status.md (endpoints, IDs, last run, deployment state)
- Tier 2: none yet (metrics history lives in the data table, not the vault)

## Vault Reads
- soul.md (voice for any user-facing output), vault/research/alex-hq-tiles-and-stack.md (tile map), brand + work/12-linkedin-series/screenshots/DIAGRAM-DESIGN-SYSTEM.md (visual system)

## Vault Writes
- vault/projects/alex-hq/status.md per change; vault/log.md per run; vault/index.md on new pages

## Connections
- **Fed by:** every automation (post-run POST), /alex-hq local harvest (MCP count, vault size, scheduler, n8n workflow liveness), **Shaheen's notes** (typed + voice via the PWA card, Inbox Contract)
- **Feeds into:** Shaheen's phone/PC (the UI), the vault (filed notes → calendar/people/me/meetings/projects), morning-brief ("Notes you dropped" block + may quote HQ health), Building Alex episode ("I gave Alex a face"), STEMPLICITY demo

## Post-Run (mandatory)
1. No people/companies expected (metrics only); if any appear in headlines, standard intake applies
2. Update vault/projects/alex-hq/status.md (last push, row count)
3. Update vault/log.md
4. vault/index.md if new pages
5. Sprint board: mark Done on first build only

## Producer Retrofit - COMPLETE 2026-07-02 (ALL producers, sprint closed same day)
- **Local commands** (01, 02, 07, 12/post-publish, 13, 08, 05, 15): failure-tolerant curl in each post-run (command file + spec both updated). Never fail the run on a push failure; never log the token.
- **Sprint (#01) closed 2026-07-02:** post-run pushes `velocity` + `run_status` green as one array POST; the hardened wrapper (scripts/run-sprint-tracker.ps1) pushes `run_status` RED with the failure reason on a dead run, so the health board distinguishes "ran and reported" from "died at the scheduler". Worst-status-per-project means a leftover red run_status is cleared by the next clean run's green push.
- **Pipelines #03/#14: fed by the SIDECAR, not by in-pipeline nodes** (workflow `y5YbDZu8TT38XZ9r` "Alex HQ - Pipeline Stats (16)", JSON archived in config/wf-pipeline-stats.json). Daily 07:50 Stockholm + on-demand `GET /webhook/alex-hq-stats-run` (X-Alex-Token). Design: 2× `values:batchGetByDataFilter` POSTs (one per pipeline spreadsheet, all 3 tabs per call) → Compute Stats (drafted/processed today by UTC date, review depth, cumulative pass rate + spend from run_log.total_cost) → direct data-table insert (no HTTP, no token inside n8n). Pipelines untouched; backups in work/03+14/config/backup-pre-hqpush-*.json.

### Sidecar debug ledger (2026-07-02, cost ~2h - read before touching)
1. httpHeaderAuth creds created with `allowedHttpRequestDomains` CANNOT be used in HTTP Request nodes at all ("configured to prevent use"); even a domain-scoped copy failed. Solution: skip HTTP entirely, insert into the data table directly (same box).
2. **This Google project has a TINY Sheets READ quota** (429 "too many requests" after ~1 read/min; writes are a separate quota, which is why the pipelines never noticed). 6 sequential reads can never fit, waits/retries don't help. Solution: batch to 1 read-unit per spreadsheet.
3. **n8n's HTTP Request node collapses duplicate query params** - both in `queryParameters` AND when baked into the URL string, so GET `values:batchGet` (which needs repeated `ranges=`) silently returns only the LAST range. Solution: POST `values:batchGetByDataFilter` with `dataFilters` in the JSON body; response nests each range under `.valueRange`.
4. First real read of the numbers corrected stale docs: #14 AI pipeline = 905 processed / 48 drafts / $2.815, NOT "deployed inactive".

## Implementation Notes (as built 2026-07-02)
- Backend built and verified end to end in one session: table + credential + 2 workflows + auth tests (403 unauthenticated) + 18 seed rows across 13 projects with REAL current values from the 07-02 audit.
- httpHeaderAuth credential API gotcha (same family as the runbook's httpBearerAuth): schema demands `allowedHttpRequestDomains`; `"none"` passes.
- Data Table node accepted `autoMapInputData` mapping first try; summary `operation: get` with `returnAll: true` worked unmodified.
- **Frontend v0 built + QA'd same session** (app/): Next 16.2 / React 19 / Tailwind v4, no component library needed at this size (hand-rolled glass tiles beat pulling shadcn for 4 primitives; revisit shadcn + its MCP when the chat pane lands). next/font Sora + Hanken Grotesk; manifest.ts + Pillow-generated icons for PWA; `output: "standalone"` + Dockerfile for the box; server-component-only (zero client JS beyond Next runtime), fetch revalidate 60s; graceful "backend unreachable" state.
- Health board staleness: expected-cadence map lives in app/app/components.tsx (CADENCE_HOURS); a project turns amber when last_ts exceeds its cadence even if its own status is green.
- **QA gotcha that cost 20 min:** raw `chrome --headless --screenshot --window-size=390` renders layout at a ~500px minimum window and crops to 390, faking a mobile overflow. Diagnose with puppeteer-core viewport emulation (devDependency, recipe in DEPLOY.md); the page was correct all along (scrollWidth 390, zero wide elements).
- Bugs caught in visual QA: Applications tile showed green dot while its text said "AI lane unverified" (merged status now passed via statusOverride); runway line needed min-w-0 to wrap on phones.
- Deployment: LIVE at https://hq.shaheenkiarash.com (see DEPLOY.md for the full box-side state + gotchas).
- **v1.2 (2026-07-02, feedback #2 - The Brain):** scripts/build-graph.mjs (node, no deps) walks the vault, parses `[[links]]` (excludes index.md/log.md as navigation hubs, .obsidian/.trash; resolves by lowercase basename; skips unresolved), emits public/data/graph.json. Box side: `/opt/alex-hq-data` volume-mounted read-only at `/app/public/data`, so a graph refresh is `node scripts/build-graph.mjs && scp .../graph.json n8n:/opt/alex-hq-data/` with NO container rebuild (/alex-hq step 1b). UI: app/brain.tsx, react-force-graph-2d via next/dynamic ssr:false, canvas nodeCanvasObject (glow dots by section, degree-sized, labels at zoom>2.2 or hubs degree>=12), transparent bg over .brain-wrap, ResizeObserver sizing.
- **v2.1 (2026-07-06, feedback round on the v2 skin - 18 items):** absolute Europe/Stockholm stamps everywhere (`fmtDateTime`/`daysSinceStockholm` in lib/types.ts - Intl formatToParts, deterministic across server/client, the fmtNum lesson applied to dates); slow CSS background bubbles (transform-only, reduced-motion aware); tap-hint affordances removed; tile sparklines cut to steps + expenses only; n8n tile drill-down = live workflow list from `n8n-workflows.json`; airbnb tile carries `next_booking`; expenses tile + drill-down carry `mtd_by_category`; Body drill-downs scoped per tile via `metricKeys`; new To-Do tile (`todos.json` from the sprint snapshot), gym card (render-time GYM/REST from `life.json`, cycle anchor restarted 2026-07-03 via Life Ops write-back) and plants card (render-time due-ness, stale-log guard). New scripts: build-todos.mjs, build-life.mjs; n8n_liveness.py extended (workflows JSON + radar-collector in EXPECTED_DAILY). Producers extended: /airbnb-host + morning-brief push `next_booking`, /expense-wrangler pushes `mtd_by_category` in both modes. Life Ops source order for the gym/plants data: Google Sheet → Notion mirror → vault pages (vault/me/gym.md + plants.md refreshed from the sheet 2026-07-06, then build-life.mjs reads the vault). QA renders: outputs/alex-hq/2026-07-06/.
- **v1.1 (2026-07-02, Shaheen feedback round 1):** added `motion` (v12, import from "motion/react"). Server/client split: page.tsx fetches, app/dashboard.tsx ("use client") renders everything; shared pure helpers in lib/types.ts (deterministic fmtNum avoids sv-SE nbsp hydration mismatches; `now` computed server-side and passed down so ageLabel matches). Drill-down = layoutId shared-element morph from tile → overlay; overlay renders every metric of the tile's project list (Applications = both lanes). Scroll reveals via whileInView (once, -40px margin). QA gotcha: an INSTANT programmatic jump-scroll never fires IntersectionObserver, so fullPage screenshots show unrevealed tiles - step-scroll in the QA script (shots2 pattern); real momentum scrolling is fine. Per-job drill-down depth needs the pipeline retrofit; the overlay says so honestly.
