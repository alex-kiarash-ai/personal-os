# Portal Scanner - the free company-portal job finder

**Workflow ID:** `5tPXbhdpp6PfF56V` · **Runs:** Tuesday & Thursday 15:13 Stockholm (cron `13 15 * * 2,4`) · **Nodes:** 12 · **Model:** none (this workflow makes no AI call) · **Export in this folder:** workflow.json

## What it does

This is the front half of the standalone **Portal lane** (#31): a separate job-hunting track that sources jobs straight from companies' own career pages instead of from LinkedIn. It reads a list of seed companies, hits each one's ATS (applicant-tracking system) public JSON API - Greenhouse, Lever, Ashby - pulls the open roles for free, keeps only the ones matching a BI/reporting title filter and inside a recency window, and banks them into its own Google Sheet. It writes nothing outward and pays nothing: free public JSON, no Bright Data, no model call.

It runs at **15:13**, thirteen minutes after the #03 BI engine and before the Portal Application Engine (15:43) that drains what this banks. The scanner banks; the pipeline drafts.

## Why it exists

LinkedIn misses roles that only ever appear on a company's own board, and Bright Data costs money per posting. Small Nordic / remote startups on Greenhouse/Lever/Ashby are exactly where "only on their own careers page" is real, and their ATS JSON is free to read. This lane tests whether that free, earlier signal is worth a second drafting pipeline. Built fully self-contained (Shaheen's call 2026-07-26) so it **never touches the live #03 / #14 engines**, their sheets, their Drive folders, or their crons - it only reuses shared credentials and the Gotenberg PDF service.

## The steps, node by node

- **Schedule 15:13 + Manual** - the trigger (cron `13 15 * * 2,4`) plus a manual button for tests.
- **Read Company Portals** - reads the `company_portals` tab: which companies, which ATS, which track.
- **Plan Scan** - emits one item per candidate endpoint. Deliberate deviation from the plan's "Switch on ats_type into three fixed hosts": Phase 0 proved some EU boards only answer on the `.eu` API host, so it emits both the global and EU candidate and lets the next node keep whichever actually returned jobs.
- **Scan Portals** - one hardened HTTP node that hits each candidate ATS endpoint.
- **Map + Prefilter + Cap** - normalizes each ATS's shape, applies the title include/exclude filter and the recency window (`MAX_AGE_HOURS`), sorts newest-first, and caps the count. Real posting dates are captured per ATS (`first_published` for Greenhouse, `createdAt` for Lever, `publishedAt` for Ashby) and banked as `job_posted_date`, which makes earliness measurable.
- **Read Processed Jobs** - reads its own ledger to skip what's already banked.
- **Format Bank Rows** - shapes each survivor into a 6-key bank row with the full job in `payload_json`, and applies a soft-key dedup (`normalize(company)|normalize(title)`) so the same role reposted across locations doesn't get banked (and later paid for) repeatedly.
- **Anything To Bank? -> Bank Sourced Jobs** - the fork and the write: new rows are appended to `processed_jobs` as `sourced_unscored`. On this lane `processed_jobs` IS the bank (it has no separate `bank` tab, because the scanner writes the sourced rows directly).
- **Build Liveness Payload -> Stamp Liveness** - a parallel branch that records each company's board answered `ok`, so a dead ATS endpoint is visible.

## State (2026-07-27)

Built and gate-passed. On the first real scan it banked 67 jobs from 9 companies for free; after the title filter was tightened and soft-key dedup added the same day, a rescan banked a clean 25 genuine BI/reporting roles with no junk. Activation is a **capacity** question, not a cost one: the n8n box holds at 16 active workflows, and activating both portal workflows silently deactivated #03 and #14 once (restored in ~6 min). The scanner is free to run; whether it is scheduled-live is contested across the records (manifest #31 says LIVE at 15:13, the status page says INACTIVE) and is Shaheen's call. Full detail: `vault/projects/portal-scanner/status.md`.

## Connected to

- **[portal-application-engine](../portal-application-engine/)** - the drafting half; drains what this banks, at 15:43.
- **[pipeline-error-alert](../pipeline-error-alert/)** - the scanner's `errorWorkflow`, so a failure raises a Notion alert like the engines do.
- **Project docs:** `work/31-portal-scanner/CLAUDE.md`, `vault/projects/portal-scanner/status.md`.
