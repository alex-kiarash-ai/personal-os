# Morning Brief

## Type
Automation

## Purpose
Daily 8:00 summary of what hit overnight: unread Gmail (last 12h), today's calendar, and relevant Notion/vault project context, filtered hard through soul.md priorities (priority order: job pipeline > learning > modeling; personal flagged warmly). Output is scannable in under 3 minutes: Urgent / Today's Calendar / Key Context / FYI. Noise (newsletters, promos) is counted, not listed.

## Entry Points
- **Scheduled:** daily at 8:00 AM via system scheduler (`claude -p "Run /morning-brief"`)
- **On-demand:** `/morning-brief`

## Tools Used
- Gmail MCP: `search_threads` with `is:unread in:inbox newer_than:1d`, then filter to last 12h by message timestamp (Gmail search has no hour granularity). `get_thread` only when a snippet isn't enough to classify.
- Google Calendar MCP: `list_events` with `startTime`/`endTime` ISO 8601 bounds for today, `timeZone: Europe/Stockholm`.
- Notion MCP: `notion-search` for pages matching today's people/companies/topics; `notion-create-pages` for the brief row. Also read the **Pipeline Alerts** DB for open failures (see Pipeline-health check below).
- Google Drive MCP: `read_file_content` on the **Plant Watering Schedule** sheet (file id `1BedopTrI-Aoh1c9_-RxmMzIXjHmpHuWSpV15pBAfUNw`) for the Life Ops section (see below).
- No Chrome.

## Notion Integration
**Daily Briefs** database under the Personal OS parent page:
- db_id: `(see vault/projects/morning-brief/status.md)`
- Schema: Brief (title, "Brief YYYY-MM-DD"), Date (date), Summary (text, one line), Urgent Count (number), FYI Count (number)
- View: "Latest" table sorted by Date descending
- Every row MUST carry the full brief as page content. Properties are for scanning, the body is for reading.

## Vault Structure
- **Tier 1:** vault/projects/morning-brief/status.md - DB IDs, last run, last counts.
- **Tier 2:** vault/projects/morning-brief/history/YYYY-MM-DD.md - one brief per day, accumulating.

## Vault Reads
- soul.md (voice, priority filter)
- vault/me/goals.md (current goals; goal #2 job hunt makes recruiter/LinkedIn signals Urgent)
- vault/people/ (context on senders and attendees)
- vault/business/ (context on companies)
- vault/projects/*/status.md (active project context for the Key Context section)
- vault/people/_inbox.md (People Intake review queue; if non-empty, surface a short "people to confirm" line in Key Context so Shaheen can clear it)
- vault/projects/sprint-tracker/decisions-pending.md (stale board rows the sprint-tracker core flagged; if non-empty, surface each as a one-tap keep/drop line in Key Context - "{task} has sat {N} weekdays, keep or drop?" - and call out any **[auto-drop candidate]** plainly so a dead row gets decided, not silently repeated)
- vault/projects/alex-ai-radar/radars/ (newest file; Mondays, see the Radar section rule below)
- brand/config/brand-config.md (only if a file deliverable is requested; the daily brief itself is markdown + Notion)

## Vault Writes
- New history file per run
- vault/people/{name}.md for every new person in emails or calendar (flag unknowns as data gaps)
- vault/business/{company}.md for new companies that matter (employers viewing applications, partners; NOT newsletter senders)
- status.md refresh (last_run, counts)
- vault/log.md entry; vault/index.md when new pages

## Run Checks (every brief, before writing output)

**Missed-run detection.** Compare today's date against the newest file in vault/projects/morning-brief/history/. If one or more days were skipped, the brief MUST open with "Missed N brief(s) since YYYY-MM-DD" and widen the Gmail window to cover the gap (newer_than the missed span, not just 1d) so nothing urgent from the dead days is silently dropped. If the gap is 3+ days, also suggest checking `schtasks /query /fo csv | findstr PersonalOS` and `outputs/logs/morning-brief.log`. A missing brief must never look like a calm morning.

**Pipeline-health check (added 2026-06-30).** Every brief, read the **Pipeline Alerts** Notion DB (db_id `08504afe-ba13-4691-9e67-0ed9a00c8e8c`, data_source_id `801e9271-9035-4976-b32a-747edcafa9b3`, under Personal OS) for rows with `Status = Open`. Any open alert is **Urgent**: name the pipeline, failed node, and error in one line, with the action. This is how the n8n engines report failures - the "Pipeline Error Alert" n8n workflow auto-writes a row here whenever a workflow errors. **Coverage widened 2026-07-06:** ALL active workflows on the box now nominate this handler (13/14, not just #03/#14/LinkedIn), so a failure in health ingest, life-ops, or any HQ workflow surfaces here too. The morning brief is the human notification surface; do not let a silent multi-day pipeline outage recur (it cost 5 dark days, 06-26→06-30, before alerting existed). The same break also shows live on Alex HQ's "Broken n8n today" card (the brief is the ≤24h backstop; the card is the instant one). When a previously-open alert's underlying run is confirmed green again, flip its row to `Resolved`.

**Scheduled-run staleness watch (added 2026-07-10).** For LIVE scheduled automations, read their status.md `last_run` and flag any whose age exceeds its cadence + slack. Seeded with **Personal CRM (#05): flag if `last_run` is older than 8 days** (its Monday run + one week of slack; the 07-06 usage-limit skip lost three weeks silently). On a hit: one Urgent line ("CRM hasn't run since {date}, {N}d - check outputs/logs/personal-crm.log") AND push AMBER/RED to HQ `run_status` for that project (project=`crm`), so a missed run can't go quiet. Read-only; unreachable HQ = one FYI line, never a failed brief.

**HQ inbox check (every brief, added 2026-07-02).** The Alex HQ PWA has a two-way notes card (typed + voice). Every brief run fetches `GET /webhook/alex-inbox` (X-Alex-Token) and files every `new` note per the standing vault protocols, transcribing voice notes with local Whisper first (full mechanics: work/16-alex-hq/CLAUDE.md "Inbox Contract" + step 4b in the command file). Correction-type notes additionally route to #22 Teach-Alex (classified + appended to vault/projects/teach-alex/corrections-log.md; identity files confirm before applying). The brief gets a short **"Notes you dropped"** block showing each note → destination. Unreachable inbox = one FYI line, never a failed brief.

**Interview watch (feeds #21 Interview-to-Offer, added 2026-07-06).** Scan the already-fetched Gmail + today's calendar for interview signals (interview / technical screen / hiring-manager language, or a booked time tied to a company in vault/business/ or a recruiter in vault/people/). If found, add ONE Urgent/Key Context line suggesting `/interview "{Company}"` for a dossier + prep. Flag ONLY, never auto-run /interview and never draft anything. Nothing found = no line. Read-only. Full mechanics: step 4h in the command file + work/21-interview-copilot/CLAUDE.md.

**Radar section (Mondays, added 2026-07-02).** The `PersonalOS-alex-radar` job runs Mondays 07:30 and writes `vault/projects/alex-ai-radar/radars/YYYY-MM-DD.md` before this brief fires at 08:00. If a radar file newer than the last brief exists, add a **Radar** section: the ONE item that cleared the bar (or "nothing cleared the bar this week"), any genuinely accelerating theme, and a pointer to any auto concept PDF. Keep it to 3-5 lines, Alex voice, no digest-speak. If it's Monday and today's radar file is MISSING, flag that in Key Context ("radar sweep didn't run, check outputs/logs/alex-radar.log") instead of silently skipping - a dead sweep must never look like a quiet week.

**Life Ops section (every brief, added 2026-07-02).** Read the **Plant Watering Schedule** Google Sheet (Drive file id `1BedopTrI-Aoh1c9_-RxmMzIXjHmpHuWSpV15pBAfUNw`, tabs: plant list / GymSchedule / LearningSchedule) and add a short **Life Ops** block:
- **Plants:** compute due = Last Watered + Watering Frequency (days) vs today. IGNORE the sheet's own `Next Water Date` and `Status` columns (stale snapshots). List plants due/overdue by name with days overdue; if none, one line "plants all watered". **Stale-sheet guard:** if EVERY plant is overdue by more than 2x its frequency, the sheet itself is dead data - print ONE line ("watering log stale since {max Last Watered}, update the sheet or tell Alex when you water") instead of a daily 8-plant guilt list.
- **Gym:** GymSchedule gives StartDate + every-second-day at 4/week. Gym day = (today − StartDate) even number of days. One line: "Gym: session day" or "Gym: rest day".
- **Learning:** LearningSchedule filtered to today's weekday, blocks in Order with hours (e.g. Mon: Udemy n8n 2h → Practice 2h → Claude course 3h → Job applications 1h).
- **Write-back (LIVE 2026-07-03):** the brief itself never edits the sheet, but when Shaheen says he watered (chat or HQ note "watered plants" / "watered {name}") or resets the gym cycle, the session that catches it POSTs the **Life Ops write-back webhook**: `POST https://n8n.shaheenkiarash.com/webhook/life-ops-update`, header `X-Alex-Token` (HQ token file), body `{"watered":"all"|[names],"watered_date":"YYYY-MM-DD","gym_start":"YYYY-MM-DD"}` (all optional; watered_date defaults to today Stockholm). n8n workflow `LuQ5Wtm5kyAyfNeU`, runbook docs/n8n/life-ops-sheet-writeback/. It stamps Last Watered, recomputes Next Water Date per plant, and can move the GymSchedule StartDate. Sheet unreachable = one FYI line, never a failed brief.
- **Source of truth:** the tabs INSIDE this one file. The two standalone "LearningSchedule" spreadsheets on Drive (ids `1Rbcu7J9ij_hUnofvkr8MMdn1J-lACB4-dCsAgsVfMcI`, `15AtEkueiFh8b7jkb1kNfPWFQSLa3fCFxom0J1YXaQCA`) are duplicates, flagged for Shaheen to trash.

## Classification Rules
- **Urgent:** needs an action or reply today. Recruiter/LinkedIn messages while goal #2 is active, security alerts, account/service shutdowns with deadlines, anything from known people.
- **Today's Calendar:** all events today; flag conflicts and missing prep. All-day Gmail-generated events (hotel stays etc.) listed as context, not meetings.
- **Key Context:** ties today's signals to active projects (e.g., a Bright Data product email matters because the job pipeline runs on Bright Data).
- **FYI:** worth knowing, no action: application views, payment confirmations, listings.
- **Noise:** newsletters, promos, marketing. One count line at the bottom, never itemized.

## Connections
- **Fed by:** [[projects/alex-ai-radar/status|Alex AI Radar]] weekly Stream B sweep (Mondays 07:30, Radar section); [[projects/alex-hq/status|Alex HQ]] notes inbox (typed + voice, filed every brief); **Plant Watering Schedule** Google Sheet (plants/gym/learning, Life Ops section, added 2026-07-02). Later: email triage, CRM.
- **Feeds into:** /status, vault/people/, vault/business/. Sprint board row marked Done on first build (done 2026-06-10).

## Post-Run (mandatory)
1. vault/people/ pages for new contacts
2. vault/business/ pages for new companies
3. [[wiki links]] between brief, people, projects
4. Notion row created in Daily Briefs
5. vault/index.md if new pages
6. vault/log.md entry
7. Alex HQ metrics push (added 2026-07-02, first retrofitted producer): POST urgent_count + headline + status to the build #16 ingest webhook per the contract in work/16-alex-hq/CLAUDE.md. Exact curl in .claude/commands/morning-brief.md. Failure-tolerant (`|| true`), token never printed.

## Implementation Notes (as built, 2026-06-10)
- First run executed during build. 30 unread threads in 12h; 4 urgent, 6 FYI, ~20 noise.
- Gotcha: Gmail `newer_than:` only takes d/m/y, not hours. Pull 1d and trim to 12h in-context.
- Gotcha: calendar returned a FROM_GMAIL all-day "Stay at Metro" (Apr 22–Jun 29) - treat transparency:transparent + eventType FROM_GMAIL as context, not a meeting.
- People/business pages created during the run (kept local, not in the repo).
