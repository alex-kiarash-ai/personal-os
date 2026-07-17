# Application Engine (BI) - the job-hunting robot

**Workflow ID:** `9XuIEfxS71DEetVR` · **Runs:** every 72h at 07:00 Stockholm (every 3rd day; retimed 2026-07-16 for cost cut, was daily) · **Nodes:** 41 · **Export in this folder:** workflow.json (2026-07-16 refresh: 72h cron + "Past Week" source window, on the P3 write-first base)

## What it does

Every morning at 07:00, before Shaheen wakes up, this workflow hunts LinkedIn for fresh Power BI / data jobs in his chosen cities (Gulf, London remote, Stockholm, Europe remote). It reads every posting like a picky recruiter: scores how well the job fits Shaheen's CV, checks the working conditions (remote/hybrid/on-site) against his rules, and throws out anything weak. For the jobs that survive, it writes a tailored CV and a personal cover letter, turns both into polished PDFs, files them in a Google Drive folder named after the job, and logs everything (including what each job cost in AI fees, usually a few cents) in a Google Sheet. Shaheen opens the sheet with his coffee, reviews the drafts, and clicks submit himself. The robot never applies on its own.

## Why it exists

Applying to jobs properly means tailoring a CV and letter per job, which costs 1-2 hours each; that math kills any serious volume. This engine removes the hours of tailoring and keeps the 60 seconds of clicking submit. It is also the flagship proof of his career pivot: "I don't just use AI, I built my own recruiting department with it." Design principle, in his words: two reasoning calls wrapped in deterministic gates, not a chain of model verifiers - the AI only does the two jobs that need judgment (scoring, writing); plain code does all the checking.

## The steps, node by node

**Stage 1 - Find the jobs**
- **When clicking Test** - a manual start button, used only for testing.
- **Daily 07:00 Stockholm** - the alarm clock. Despite the node name it now fires **every 72h** at 07:00 (cron `0 7 */3 * *`, retimed 2026-07-16 for cost; node not renamed).
- **Read Search Config** - opens the Google Sheet tab that lists the searches to run (job title + city + allowed work conditions per row).
- **Filter Active Rows** - keeps only the search rows marked active; skips the rest. Also sets the search window: **"Past Week"** since 2026-07-16 (was "Past 24 hours"), so a 72h-cadence run never misses a fresh posting; the processed-log dedup makes the wider window exactly-once.
- **BD Trigger Search** - asks Bright Data (a web-scraping service) to go collect fresh LinkedIn postings for each search.
- **Attach Row Context** - pins each search's settings (city, allowed conditions) to the scrape job so later steps know the rules that apply.
- **Poll Wait / Poll Fetch Snapshot / Snapshot Ready?** - the waiting loop: check whether Bright Data is done; if not, wait and ask again; when ready, download the results.
- **Parse Jobs** - turns the raw scrape into a clean list: title, company, location, description, link.

**Stage 2 - Skip what we've seen, bank what's new (P3 write-first reorder, 2026-07-12)**
- **Read Processed Log** - opens the ledger of every job ever processed.
- **Dedup Against Log** - drops any posting already in the ledger, so nothing is scored or paid for twice. Since the P3 reorder it also runs the **drain**: ledger rows marked `sourced_unscored` are banked discoveries, not finished work - they rejoin today's batch (rebuilt from the `payload_json` column) until a completed row exists for their id.
- **Format Sourced Row** - shapes each genuinely new discovery into a ledger row with status `sourced_unscored` plus the full job stored in `payload_json`. If the whole batch is drains (nothing new), it emits a marker instead so the batch still moves on.
- **Anything To Bank?** - the fork: new rows go to the bank, a drain-only marker skips straight ahead.
- **Bank Sourced Jobs** - appends the new rows to the same processed-jobs ledger, BEFORE any AI is called. This is the whole point of the reorder: in June-July 2026 the Anthropic spending cap killed every run at the Match step, and because logging only happened after Match, every paid Bright Data discovery burned into the void (17 jobs in just the two days before this fix). Now discoveries are on paper the moment they're found; a cap death costs nothing but time.
- **Rehydrate Batch** - restores the full deduped batch (new + drained) so the Match step sees exactly what Dedup produced, with the banking already done.

**Stage 3 - Judge each job**
- **Build Match Request** - packs the job posting plus Shaheen's master CV into a question for Claude (the AI): how well does this fit?
- **Claude Match+Research** - the first of only two AI calls: returns a fit score, an interest score, the detected work condition, and the reasoning.
- **Parse Match** - unpacks the AI's answer into clean fields.
- **Stage 3 Gate** - plain code, no AI: pass only if fit ≥ 70, the role type is right, and the work condition is allowed for that city. Everything else goes to the review queue with the reason.
- **Format Processed Row / Append Processed Job** - writes every judged job into the ledger, pass or fail. The completed row supersedes any earlier `sourced_unscored` bank row for the same job - the ledger is append-only, nothing is edited in place; Dedup treats "has a completed row" as done.
- **Passed Gate?** - the fork: winners continue, the rest stop here.
- **Format Review Row S3 / Append Needs Review S3** - files the near-misses in the "needs review" tab so a human can overrule.

**Stage 4 - Write the application**
- **Build Writer Request** - packs the job + CV into the writing brief for the second AI call.
- **Claude Writer** - writes the tailored CV content and the cover letter for this specific job.
- **Parse Writer** - unpacks the drafts.
- **QA + Fill Templates** - plain-code quality control: checks the letter mentions the company, right length, no missing fields, no dashes (house style), then pours the text into the HTML templates.

**Stage 5 - Produce, file, log**
- **Render CV PDF / Render Cover Letter PDF** - Gotenberg (a small PDF service on the same server) turns the HTML into two clean PDFs.
- **QA Passed?** - final fork: if quality control flagged something, the job is filed for review instead of delivery.
- **Create Drive Folder** - makes a Google Drive folder named after the job.
- **Rebind PDFs / Upload CV PDF / Upload Cover Letter PDF / Merge Uploads** - puts both PDFs in the folder and waits for both uploads to finish.
- **Compute Costs** - adds up exactly what this job cost in AI fees (typically $0.03-0.07).
- **Append Run Log** - writes the run's summary line (found, judged, drafted, cost) into the sheet.
- **Format Review Row S5 / Append Needs Review S5** - anything that failed final QA lands in the review queue with its reason.

## Connected to

- **[14-ai-application-engine](../14-ai-application-engine/)** - its twin for AI/automation roles; same machine, different target.
- **[mcp-server-application-engine](../mcp-server-application-engine/)** + the three tool workers - let Shaheen's AI assistant query this pipeline's ledger conversationally.
- **[hq-pipeline-stats](../hq-pipeline-stats/)** - reads this workflow's sheet daily and feeds the Alex HQ dashboard.
- **[pipeline-error-alert](../pipeline-error-alert/)** - catches this workflow if it ever crashes.
- **Locally:** the `/application-engine` command (daily 8:30) reads the sheet and reports; results flow into the vault as company pages. Project doc: `docs/projects/03-application-engine.md`.
