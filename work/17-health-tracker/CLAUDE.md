# Health Tracker (17)

## Type
Automation (n8n ingest on Hetzner + iPhone Shortcut producer + brief/HQ consumers). Daily.

## Purpose
Pulls **yesterday's step count** and a nightly **Alex Sleep Score (0-100)** off the iPhone's Apple Health
into the [[projects/morning-brief/status|Morning Brief]] and [[projects/alex-hq/status|Alex HQ]], fully automated,
free, native. Apple has no cloud health API and no native sleep score, so: a native iOS Shortcut pushes the
raw numbers to a token-gated n8n webhook, n8n computes the score, the brief + HQ read it.
Design + evidence: [[research/health-tracker-architecture]] (/research-team run 8, 3 lanes).

## Entry Points
- **Producer (phone):** native iOS Shortcut "Alex Health Push", daily time automation at **23:59, Run Immediately** (every date filter is **"is today"**, and every sleep block ends in **Calculate ÷ 60** because Health returns seconds; both gotchas are in the guide). Build guide: `IPHONE-SHORTCUT.md`. **BUILT + 23:59 automation set + verified live 2026-07-06** (was the only manual piece). Sends `Content-Type: text/plain`; the webhook is self-healing (`rawBody` + the Score node coerces empty fields `:,`->`:0,`) so an empty steps/sleep value can't break it.
- **Ingest (n8n, Hetzner):** `POST https://n8n.shaheenkiarash.com/webhook/alex-health-ingest` (header `X-Alex-Token`). Accepts a single day object, `{day:{...}}`, or `{days:[...]}` (batch). The daily Shortcut sends `{days:[one combined row]}` and gets back `{ok:true,count:1}`; the one-time backfill sends many.
- **Backfill (one-time):** `scripts/backfill_health.py` streams the 532MB export, `scripts/seed_via_webhook.py` POSTs the history through the webhook.

## Infrastructure (as built 2026-07-04)
- **Store:** n8n Data Table `alex_health`, id in `config/table-id.txt` (currently `J2cGka85Cf9DzNFc`), 16 columns (date, steps, asleep_min, deep_min, rem_min, core_min, awake_min, inbed_min, awakenings, efficiency, bedtime, waketime, bedtime_dev_min, sleep_score, source, ts). **Append-only** (like alex_metrics); readers merge by field per date. Seeded with 1,479 daily rows / 151 scored nights (Jan 2024 → 2026-07-04).
- **Ingest workflow:** `Alex Health - Ingest (17)`, id `WtOKBY00Cq1FhQ8T`, ACTIVE. Webhook → Code "Score + Normalize" (the Alex Sleep Score, v1 5-component) → Data Table insert → Respond `{ok,count}`. JSON backup: `config/wf-health-ingest.json`.
- **Read:** the existing `Alex HQ - Summary API (16)` (id `GLcMPA4m0DRGjnQH`) was EXTENDED to also read `alex_health` and expose a `health` project (`steps_today`, `sleep_score_today`, each 14-day history). Pre-change backup: `work/16-alex-hq/config/wf-summary-backup-pre-health.json`.
- **Auth:** same `X-Alex-Token` header cred (`m6VkVeG9bym6OFID`) as all Alex HQ webhooks. 403 without it (verified). Token file `work/16-alex-hq/config/alex-hq-token.txt` - never printed/logged/committed.
- **n8n mgmt:** REST API base `https://n8n.shaheenkiarash.com/api/v1`, key `work/03-application-engine/config/n8n-api-key.txt` (header `X-N8N-API-KEY`). NB: this n8n's PUBLIC API only supports GET + insert on data-table rows (no PATCH/DELETE/upsert); richer ops live only on the in-workflow Data Table node. Table create = `POST /data-tables` (project-scoped path 404s; global path works, projectId in body). Table delete = `DELETE /data-tables/{id}`.

## The Alex Sleep Score (v1, 5 components, config-tunable)
From Apple Watch sleep stages. Weights sum to 95, rescaled to 100 (graceful: uncomputable components drop, remaining rescale).
| Component | Weight | Full points | Curve |
|---|---|---|---|
| Duration | 35 | 7-9h asleep | deficit punished hard (0 at ≤5h), excess gently (floor 30% at ≥11h) |
| Efficiency | 20 | ≥90% (asleep/in-bed) | ramp from 0 at 75% |
| Deep % | 15 | 13-23% of asleep | 0 below 5%, mild taper above 35% |
| REM % | 15 | 20-25% of asleep | 0 below 10%, mild taper above 35% |
| Restfulness | 10 | 0-1 awakenings | −1.5 per extra wake |
The formula lives in TWO mirrored places (keep in sync): the n8n Code node (daily) and `scripts/backfill_health.py` `score()`. **Consistency (bedtime vs 14-night avg, +5)** is deferred to Phase 2 (needs a trailing-history lookup on the daily path; would be added to both places together).

## Rules / conventions
- **Step dedup:** minute-bucket max across sources (one source credited per minute ≈ Apple's daily total). The phone sends ONE source's steps; the backfill dedups across sources. Validate against the Health app.
- **Timezone / night attribution:** parse `%z` (local offset baked in). Steps → local calendar day. A sleep night = samples grouped with <60min gaps, attributed to the local date of its **wake (end)** time. Naps (<45min asleep) excluded from main sleep.
- **One combined row per day (23:59 / "is today"):** the Shortcut writes a **single row dated today** holding both metrics: steps = the day that is ending, sleep = the night you woke from this morning. The next morning's 08:00 brief reads that one row and labels it "yesterday" (steps) / "last night" (sleep). One row in, so the reply is `count:1`, never two partial rows. The summary still excludes today's own partial steps when the brief runs, so the number shown is always a complete day.
- **Freshness knob:** the **23:59** trigger is chosen because the day's steps are essentially complete and "is today" still grabs last night's sleep, so both land in one row that the **next** morning's 08:00 brief reads. Trigger time only, no pipeline change; the pipeline is idempotent, so a skipped run just leaves the last good row in place.

## Consumers
- **Morning Brief:** `.claude/commands/morning-brief.md` step 4e - a "Body" line in Life Ops (`steps yesterday · Sleep X/100, night of {date}`), skip-safe, read-only from the HQ summary.
- **Alex HQ PWA:** two glance tiles `Body · sleep score` + `Body · steps yesterday` (`app/app/dashboard.tsx`), `health` in DESCRIPTIONS + CADENCE_HOURS=30 (`app/lib/types.ts`). **LIVE (redeployed 2026-07-04):** both tiles render real data on https://hq.shaheenkiarash.com.

## Scripts (work/17-health-tracker/scripts/)
- `backfill_health.py` - stream-parse export.xml → summarized daily rows (dedup, sessions, score). `--emit-rows PATH` = POST-ready (no score, n8n scores).
- `n8n_api.py` - list-tables / ensure-table (writes `config/table-id.txt`) / seed.
- `deploy_ingest.py` - build + deploy + activate the ingest workflow (reads table-id.txt).
- `deploy_summary.py` - extend the HQ summary with the health block (backs up the live one first).
- `seed_via_webhook.py` - POST the backfill history through the webhook in chunks + verify.

## Vault Structure
- Tier 1: `vault/projects/health-tracker/status.md`
- Tier 2: `vault/projects/health-tracker/backfill-data.json` (local, gitignored - the parsed history; personal health data)

## Connections
- Fed by: iPhone Health (Watch sleep stages + steps) via the native Shortcut.
- Clones: the [[projects/alex-hq/status|Alex HQ]] metrics contract (token webhook → data table → summary).
- Feeds: [[projects/morning-brief/status]] (Body line), Alex HQ (Body tiles).

## Close-Out Extras
Beyond the universal Close-Out list, a health-tracker run also verifies: (a) the ingest webhook returned `{ok:true}` and the row count rose; (b) the summary `health` block still returns both metrics (regression: all other projects still present); (c) steps show yesterday (not today's partial), sleep shows the expected night date; (d) no health data (personal) written outside the gitignored vault; (e) if the score formula changed, BOTH mirrors (n8n Code node + backfill_health.py) updated together and re-tested against the worked example (7h12m/18%/22%/88%/3 wakes → 94 on the 6-component preview, 94 on 5-component v1 for that night).

## Open items
- ~~**HQ tile redeploy**~~ ✅ DONE 2026-07-04 (both Body tiles render live). Redeploy command, kept for the next frontend change: `tar czf - -C work/16-alex-hq --exclude=node_modules --exclude=.next --exclude=.env.local app | ssh n8n "rm -rf /opt/alex-hq && mkdir -p /opt/alex-hq && tar xzf - -C /opt/alex-hq --strip-components=1"` then `ssh n8n "cd /opt/n8n && docker compose up -d --build alex-hq"`. First read after rebuild can be Next's stale prerender (60s), re-request.
- **Phase 2:** bedtime-consistency term (adds the 6th component to both score mirrors); optional manual-correction write-back (edit a bad night from the HQ PWA).
- **Backfill validation:** confirm 2-3 days' steps against the Health app before fully trusting the dedup constant.
