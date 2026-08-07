# Application Engine (BI) - the job-hunting robot

**Workflow ID:** `9XuIEfxS71DEetVR` · **Runs:** Tuesday & Thursday 15:00 Stockholm (cron `0 15 * * 2,4`; retimed 2026-07-24, was every-72h 07:00) · **Nodes:** 38 (32 after the 07-28 simplify, +6 in the 2026-08-07 repair) · **Model:** Moonshot `kimi-k3` at `reasoning_effort:'high'` (was claude-opus-4-8, swapped 2026-07-27) · **Export in this folder:** workflow.json, re-pulled live 2026-08-07 at `versionId 96240ce7-ec6c-4290-9914-86cabaabbf04` / `updatedAt 2026-08-07T08:47:23.184Z` / 38 nodes / active:true. That is the graph described below.

## What it does

Every Tuesday and Thursday at 15:00, this workflow hunts LinkedIn for fresh Power BI / data jobs in his chosen cities (Gulf, London remote, Stockholm, Europe remote). It reads every posting like a picky recruiter: scores how well the job fits Shaheen's CV, checks the working conditions (remote/hybrid/on-site) against his rules, and throws out anything weak. For the jobs that survive, it writes a tailored CV and a personal cover letter, turns both into polished PDFs, files them in a Google Drive folder named after the job, and logs each drafted application in a Google Sheet. Shaheen opens the sheet, reviews the drafts, and clicks submit himself. The robot never applies on its own.

## Why it exists

Applying to jobs properly means tailoring a CV and letter per job, which costs 1-2 hours each; that math kills any serious volume. This engine removes the hours of tailoring and keeps the 60 seconds of clicking submit. It is also the flagship proof of his career pivot: "I don't just use AI, I built my own recruiting department with it." Design principle, in his words: two reasoning calls wrapped in deterministic gates, not a chain of model verifiers - the AI only does the two jobs that need judgment (scoring, writing); plain code does all the checking.

## The engine changed four times - read this before anything else

Older notes across the vault describe a 41-node, then a 49/50-node, then a Claude-powered engine. Four things happened; the walkthrough below is for the result:

1. **Model swap (2026-07-27):** all four job lanes moved off Claude/`claude-opus-4-8` to Moonshot `kimi-k3` at `reasoning_effort:'high'`. Provider swap, not a string swap - the two model nodes (`Claude Match+Research`, `Claude Writer`) now call `https://api.moonshot.ai/v1/chat/completions` via the `Kimi K3 (Moonshot header)` credential with OpenAI-format bodies, `max_tokens` 16384, a 10-min HTTP timeout. The node names still say "Claude"; only the endpoint and body changed.
2. **Remediation (2026-07-27):** the F01-F22 rebuild took the engine 41 -> 49/50 nodes, adding a compact `seen_ids`/`bank` ledger, cross-lane dedup, a whitelist QA gate, a `CV One Page?` gate, and full per-stage cost tracking. Record: `work/03-application-engine/remediation/STATUS.md`.
3. **Simplify (2026-07-28, Shaheen's call):** `scripts/simplify-engine.js` **deleted 18 nodes** - the entire dedup / banking / drain / ledger / needs_review layer added by the remediation and P3 - leaving a lean straight-through pipeline of **32 nodes**. Cost tracking and the review queue were removed with it. Everything below the remediation notes in the vault that describes banking, `seen_ids`, `Read Sibling Log`, `needs_review` writers or per-stage cost is now history.
4. **Repair (2026-08-07):** **32 -> 38 nodes.** The simplify had left two holes that only showed up in production. First, the QA whitelist was killing almost every draft: 18 of 19 since 07-27, and 14 of 14 on the 08-06 cron, which spent $1.61 on 46 clean model calls and wrote zero rows while reporting a green run. Second, taking the dedup ledger out was not safe, because Bright Data's `discover_new` re-served 39% of the previous day's job ids on 08-06. The repair rewrote the QA rules (rule set D'), added a run_log dedup guard, and added a per-run summary row so a run that kills everything can never look green again. This is the current live shape.

## The steps, node by node (38-node graph)

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

**Stage 2 - Do not draft the same job twice (rebuilt 2026-08-07)**

The old dedup / bank / drain layer (`Read Processed Log`, `Dedup Against Log`, `Format Sourced Row`, `Anything To Bank?`, `Bank Sourced Jobs`, `Rehydrate Batch`, `Read Bank`, `Append Seen Id`, `Read Sibling Log`, `Seen Ids Failed`) was deleted on 2026-07-28, and for nine days the engine had no dedup at all. The note that replaced it said deduplication "leans on Bright Data's own `discover_new`". **That was measured false on 2026-08-06: `discover_new` re-served 39% of the previous day's job ids**, and one posting (Voyado `4431208410`) came back as new with a rewritten posted-date six weeks after it was already drafted. Two nodes now sit between Parse Jobs and the first paid call:

- **Read Run Log** - reads the whole `run_log` tab once per run (`executeOnce`, `alwaysOutputData`, retry 4x5s, `onError: continueRegularOutput`) to get every job id already drafted.
- **Dedup Guard** - drops any job whose `job_posting_id` is already in that list, **before the model is called**, and stamps `_dedup_skipped` + `_dedup_mode` on the survivors so the run summary can report the count. It is **fail-open by design**: if the sheet read fails it processes everything and says so via `_dedup_mode`, because a visible duplicate draft is cheaper than a lost pipeline day.

This is a within-engine guard only. It does not restore the cross-lane dedup, so a vacancy matching both search sets can still be drafted by #03 and #14 separately.

**Stage 3 - Judge each job**
- **Build Match Request** - packs the job posting plus Shaheen's master CV into a scoring request (Moonshot/OpenAI-format body since the kimi-k3 swap).
- **Claude Match+Research** - the first of only two model calls; despite the name it calls `api.moonshot.ai`. Returns a fit score, an interest score, the detected work condition, the target role, and the reasoning. Batched with retry.
- **Parse Match** - unpacks the answer from Moonshot's `choices[0].message.content`; scores clamped 0-100. Since 2026-08-07 the upstream cross-reference is wrapped in a try/catch, so an error-shaped item from a refused model call no longer crashes the node.
- **Stage 3 Gate** - plain code, no AI: pass only if fit >= 70, the role type is right, and the work condition is allowed for that city, plus a grounding tripwire on company facts.
- **Passed Gate?** - the fork: winners continue to the writer. Everything else now **stops here, unlogged** (the `needs_review` writers were removed in the simplify).

**Stage 4 - Write the application**
- **Build Writer Request** - packs the job + CV + the injected soul.md voice block into the writing brief. Moonshot body, `max_tokens` 16384.
- **Claude Writer** - writes the tailored CV content and cover letter for this specific job. Calls `api.moonshot.ai`; batched + retry.
- **Parse Writer** - unpacks the drafts.
- **QA + Fill Templates** - plain-code quality control: checks the letter names the company (with a legal-suffix normalizer so "Spotify" passes against "Spotify Technology S.A."), checks the CV invents no employer or date outside a whitelist derived from the master CV, checks length and missing fields, runs the dash sanitizer, then pours the text into the HTML templates.
  **Rewritten 2026-08-07 to rule set D', and this is the fix that unblocked the engine.** The old whitelist was too literal and fired `fabricated_experience` on the writer's own truthful output: it killed 18 of the 19 real drafts from 07-27 onward. D' is the union rule that both engines' measured draft corpora prove, so #03 and #14 now run byte-equivalent logic:
  - employer tokens `["uc ab","enento","building alex","menigo","self directed"]`, matched as substrings so a decorated employer line ("Self-directed, production AI systems on Claude + n8n") still passes;
  - the `independent` token is dropped entirely, because no measured draft needed it and it let "Independent Consulting Group of Berlin" through;
  - dates are matched with `startsWith` over six whitelisted ranges (including the merged `jan2019jun2021`) plus a pass-through for `present`, because the master CV decorates its own date lines;
  - `normExpDate` v2 tokenizes and drops range connectors before comparing.
  Measured effect on the real corpus: 1 pass in 19 becomes 18 in 19, with zero reason drift and all three fabrication controls still caught. Named accepted residual: a genuinely invented employer starting with "Self-directed" would pass this check. It is a tripwire, not a proof, and every draft is human-reviewed before it leaves.

**Stage 5 - Produce, file, log**
- **QA Passed?** - if quality control flagged something, the job **stops here** (the S5 review writer was removed, so there is still no per-job reject row). Since 2026-08-07 the kill is at least **counted**, in the run_summary row. Otherwise it renders.
- **Render CV PDF / Render Cover Letter PDF** - Gotenberg (a PDF service on the same server) turns the HTML into two clean PDFs. Both retry on a transient network fault.
- **Create Drive Folder** - makes a Google Drive folder named after the job (id-suffixed).
- **Rebind PDFs** - rebinds the two PDF binaries and measures the CV's page count.
- **CV One Page?** - a one-page CV goes to the uploads; a multi-page CV **stops here, unlogged**.
- **Upload CV PDF / Upload Cover Letter PDF / Merge Uploads** - puts both PDFs in the folder and waits for both uploads.
- **Compute Costs** - despite the name, no longer computes cost. Since the simplify it just builds the run_log row for the drafted job (date, id, company, location, rank_score, model, Drive URL, job URL, status). Token and cost tracking were removed.
- **Append Run Log** - writes the drafted application's row (9 columns) into the sheet. Retries 3 times, 5s apart, since 2026-08-07.

**Stage 6 - Say what the run actually did (added 2026-08-07)**

The 08-06 cron is why this exists: it burned $1.61 across 46 model calls, killed all 14 drafts at QA, wrote nothing, and reported SUCCESS. Nothing in the system could tell that apart from a quiet day. A second branch now hangs off both triggers and runs after the pipeline:

- **Run Counter** - reads back across the finished pipeline and counts what happened: sourced, scored, match 429s, writer 429s, gate passes, QA passes, drafts. It picks one verdict out of `ok_drafts`, `zero_output`, `no_jobs`, `storm_error_match`, `storm_error_writer`, or the sentinel `counter_ran_early`.
- **Append Run Summary** - appends one 12-column row to the new `run_summary` tab. Every run writes exactly one row, drafts or no drafts. Retries 3 times.
- **Storm Verdict?** - true only when the verdict starts with `storm_error`, meaning the model lane returned errors on effectively every call.
- **Stop On Storm** - deliberately throws on that branch, so the run ends ERROR and the Pipeline Error Alert workflow fires with a Notion page and an HQ metric instead of a silent green.

**Why the four nodes sit at canvas y=0, below the pipeline:** on n8n 2.30.3 with `executionOrder: v1`, parallel branches off the same output run in canvas-position order, topmost first. Connection-array order has nothing to do with it, proven in both directions across three fires. Placing the chain visually below the pipeline is what makes it run last, which is the only way its counts can be real. The `counter_ran_early` sentinel exists as a permanent tripwire: if a future n8n upgrade flips that ordering, the row says so instead of quietly reporting zeros. **Do not drag these four nodes above the pipeline in the editor.**

Proven live: #14's fire 3713 took the storm path end to end (run ERROR, alert exec 3714, Notion page, HQ metric, storm row). #03's fire 3721 proved the counter runs last on this graph and wrote a truthful summary row.

## Sheet output

The workflow writes to two tabs:
- `run_log` (9 columns: `date, job_posting_id, company, location, rank_score, model, drive_folder_url, job_url, status`) - one row per drafted application. It is also **read** at the start of every run by the dedup guard.
- `run_summary` (12 columns: `date, exec_id, mode, sourced, scored, err_429_match, err_429_writer, gate_passed, qa_passed, drafted, verdict, note`, added 2026-08-07) - exactly one row per run, whatever the outcome.

The `processed_jobs`, `needs_review`, `seen_ids` and `bank` tabs still exist in the spreadsheet as historical data but the engine no longer reads or writes them. There is still no review queue and no per-job cost in the sheet.

## Connected to

- **[14-ai-application-engine](../14-ai-application-engine/)** - its twin for AI/automation roles; same machine, different target. Simplified in lockstep to 32 nodes on 07-28, now at 36 after its own share of the 08-07 repair. Both engines run the same QA rule set D' and the same counter/storm chain; only #03 got the dedup guard.
- **[mcp-server-application-engine](../mcp-server-application-engine/)** + the three tool workers - note: these query the old `run_log` / `needs_review` shape; the `needs_review_list` tool has no data source now that the review writers are gone (worth reconciling).
- **[hq-pipeline-stats](../hq-pipeline-stats/)** - reads this workflow's sheet daily for the Alex HQ dashboard (also written against the pre-simplify column shape).
- **[pipeline-error-alert](../pipeline-error-alert/)** - catches this workflow if it ever crashes.
- **[31 Portal lane](../portal-application-engine/)** - a standalone clone that sources from company ATS JSON instead of LinkedIn; it does NOT touch this workflow.
- **Locally:** the `/application-engine` command (daily 8:30) reads the sheet and reports; results flow into the vault as company pages. Project doc: `docs/projects/03-application-engine.md`.
