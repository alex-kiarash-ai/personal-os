# Application Engine (BI) - the job-hunting robot

**Workflow ID:** `9XuIEfxS71DEetVR` · **Runs:** Tuesday & Thursday 15:00 Stockholm (cron `0 15 * * 2,4`; retimed 2026-07-24, was every-72h 07:00) · **Nodes:** 32 (simplified 2026-07-28 from the 50-node post-remediation graph) · **Model:** Moonshot `kimi-k3` at `reasoning_effort:'high'` (was claude-opus-4-8, swapped 2026-07-27) · **Export in this folder:** workflow.json (note: the checked-in export predates the 07-28 simplify; the live workflow is the 32-node graph described below - re-pull from the box to refresh the raw JSON).

## What it does

Every Tuesday and Thursday at 15:00, this workflow hunts LinkedIn for fresh Power BI / data jobs in his chosen cities (Gulf, London remote, Stockholm, Europe remote). It reads every posting like a picky recruiter: scores how well the job fits Shaheen's CV, checks the working conditions (remote/hybrid/on-site) against his rules, and throws out anything weak. For the jobs that survive, it writes a tailored CV and a personal cover letter, turns both into polished PDFs, files them in a Google Drive folder named after the job, and logs each drafted application in a Google Sheet. Shaheen opens the sheet, reviews the drafts, and clicks submit himself. The robot never applies on its own.

## Why it exists

Applying to jobs properly means tailoring a CV and letter per job, which costs 1-2 hours each; that math kills any serious volume. This engine removes the hours of tailoring and keeps the 60 seconds of clicking submit. It is also the flagship proof of his career pivot: "I don't just use AI, I built my own recruiting department with it." Design principle, in his words: two reasoning calls wrapped in deterministic gates, not a chain of model verifiers - the AI only does the two jobs that need judgment (scoring, writing); plain code does all the checking.

## The engine changed twice in two days - read this before anything else

Older notes across the vault describe a 41-node, then a 49/50-node, then a Claude-powered engine. Three things happened; the walkthrough below is for the result:

1. **Model swap (2026-07-27):** all four job lanes moved off Claude/`claude-opus-4-8` to Moonshot `kimi-k3` at `reasoning_effort:'high'`. Provider swap, not a string swap - the two model nodes (`Claude Match+Research`, `Claude Writer`) now call `https://api.moonshot.ai/v1/chat/completions` via the `Kimi K3 (Moonshot header)` credential with OpenAI-format bodies, `max_tokens` 16384, a 10-min HTTP timeout. The node names still say "Claude"; only the endpoint and body changed.
2. **Remediation (2026-07-27):** the F01-F22 rebuild took the engine 41 -> 49/50 nodes, adding a compact `seen_ids`/`bank` ledger, cross-lane dedup, a whitelist QA gate, a `CV One Page?` gate, and full per-stage cost tracking. Record: `work/03-application-engine/remediation/STATUS.md`.
3. **Simplify (2026-07-28, Shaheen's call):** `scripts/simplify-engine.js` **deleted 18 nodes** - the entire dedup / banking / drain / ledger / needs_review layer added by the remediation and P3 - leaving a lean straight-through pipeline of **32 nodes**. Cost tracking and the review queue were removed with it. This is the current live shape. Everything below the remediation notes in the vault that describes banking, `seen_ids`, `Read Sibling Log`, `needs_review` writers or per-stage cost is now history.

## The steps, node by node (32-node graph)

**Stage 1 - Find the jobs**
- **When clicking Test** - a manual start button, used only for testing.
- **Tue & Thu 15:00 Stockholm** - the trigger. Fires Tuesday and Thursday at 15:00 (cron `0 15 * * 2,4`).
- **Read Search Config** - opens the Google Sheet tab that lists the searches to run (job title + city + allowed work conditions per row).
- **Filter Active Rows** - keeps only the search rows marked active, and sets the search window to **"Past week"** (lowercase - Bright Data's `time_range` label is case-sensitive).
- **BD Trigger Search** - asks Bright Data (a web-scraping service) to collect fresh LinkedIn postings for each search. Retries a transient failure up to 4 times, 5s apart.
- **Attach Row Context** - pins each search's settings (city, allowed conditions) to the scrape job so later steps know the rules that apply.
- **The polling loop:** `Poll Wait` -> `Poll Fetch Snapshot` -> `Poll Gate` -> `All Resolved?`. Bright Data returns results asynchronously; the loop waits and only advances the whole batch together once **All Resolved?** is true (otherwise it loops back to `Poll Wait`).
- **Snapshot Ready Item?** - ready snapshots go to `Parse Jobs`. (The old "timeout goes to a review row" branch was removed in the simplify; the false branch now simply ends.)
- **Parse Jobs** - turns the raw scrape into a clean list: title, company, location, description, link.

**No Stage 2 anymore.** The dedup / bank / drain layer (`Read Processed Log`, `Dedup Against Log`, `Format Sourced Row`, `Anything To Bank?`, `Bank Sourced Jobs`, `Rehydrate Batch`, `Read Bank`, `Append Seen Id`, `Read Sibling Log`, `Seen Ids Failed`) was deleted 2026-07-28. Parse Jobs now feeds Build Match Request directly. Deduplication leans on Bright Data's own `discover_new` (which returns only never-seen records per query), not a sheet ledger, so a job is no longer banked, drained, or cross-checked against the sibling engine.

**Stage 3 - Judge each job**
- **Build Match Request** - packs the job posting plus Shaheen's master CV into a scoring request (Moonshot/OpenAI-format body since the kimi-k3 swap).
- **Claude Match+Research** - the first of only two model calls; despite the name it calls `api.moonshot.ai`. Returns a fit score, an interest score, the detected work condition, the target role, and the reasoning. Batched with retry.
- **Parse Match** - unpacks the answer from Moonshot's `choices[0].message.content`; scores clamped 0-100.
- **Stage 3 Gate** - plain code, no AI: pass only if fit >= 70, the role type is right, and the work condition is allowed for that city, plus a grounding tripwire on company facts.
- **Passed Gate?** - the fork: winners continue to the writer. Everything else now **stops here, unlogged** (the `needs_review` writers were removed in the simplify).

**Stage 4 - Write the application**
- **Build Writer Request** - packs the job + CV + the injected soul.md voice block into the writing brief. Moonshot body, `max_tokens` 16384.
- **Claude Writer** - writes the tailored CV content and cover letter for this specific job. Calls `api.moonshot.ai`; batched + retry.
- **Parse Writer** - unpacks the drafts.
- **QA + Fill Templates** - plain-code quality control: checks the letter names the company (with a legal-suffix normalizer so "Spotify" passes against "Spotify Technology S.A."), checks the CV invents no employer or date outside a whitelist derived from the master CV, checks length and missing fields, runs the dash sanitizer, then pours the text into the HTML templates.

**Stage 5 - Produce, file, log**
- **QA Passed?** - if quality control flagged something, the job now **stops here, unlogged** (the S5 review writer was removed). Otherwise it renders.
- **Render CV PDF / Render Cover Letter PDF** - Gotenberg (a PDF service on the same server) turns the HTML into two clean PDFs. Both retry on a transient network fault.
- **Create Drive Folder** - makes a Google Drive folder named after the job (id-suffixed).
- **Rebind PDFs** - rebinds the two PDF binaries and measures the CV's page count.
- **CV One Page?** - a one-page CV goes to the uploads; a multi-page CV **stops here, unlogged**.
- **Upload CV PDF / Upload Cover Letter PDF / Merge Uploads** - puts both PDFs in the folder and waits for both uploads.
- **Compute Costs** - despite the name, no longer computes cost. Since the simplify it just builds the run_log row for the drafted job (date, id, company, location, rank_score, model, Drive URL, job URL, status). Token and cost tracking were removed.
- **Append Run Log** - writes the drafted application's row (9 columns) into the sheet. This is now the ONLY sheet write in the whole workflow.

## Sheet output (after the simplify)

The workflow now writes to exactly one tab:
- `run_log` (9 columns: `date, job_posting_id, company, location, rank_score, model, drive_folder_url, job_url, status`) - one row per drafted application.

The `processed_jobs`, `needs_review`, `seen_ids` and `bank` tabs still exist in the spreadsheet as historical data but the engine no longer reads or writes them. There is no longer a review queue, a dedup ledger, or per-job cost in the sheet.

## Connected to

- **[14-ai-application-engine](../14-ai-application-engine/)** - its twin for AI/automation roles; same machine, different target, simplified in lockstep to 32 nodes.
- **[mcp-server-application-engine](../mcp-server-application-engine/)** + the three tool workers - note: these query the old `run_log` / `needs_review` shape; the `needs_review_list` tool has no data source now that the review writers are gone (worth reconciling).
- **[hq-pipeline-stats](../hq-pipeline-stats/)** - reads this workflow's sheet daily for the Alex HQ dashboard (also written against the pre-simplify column shape).
- **[pipeline-error-alert](../pipeline-error-alert/)** - catches this workflow if it ever crashes.
- **[31 Portal lane](../portal-application-engine/)** - a standalone clone that sources from company ATS JSON instead of LinkedIn; it does NOT touch this workflow.
- **Locally:** the `/application-engine` command (daily 8:30) reads the sheet and reports; results flow into the vault as company pages. Project doc: `docs/projects/03-application-engine.md`.
