# /morning-brief - Daily 8:00 Inbox + Calendar + Context Brief

Spec: work/02-morning-brief/CLAUDE.md (read it first).

## Steps
1. Read vault/projects/morning-brief/status.md for the Daily Briefs DB IDs.
2. Gmail: `search_threads` with `is:unread in:inbox newer_than:1d`, trim to last 12h by timestamp (Gmail has no hour granularity in search).
3. Calendar: `list_events` for today, `startTime`/`endTime` ISO 8601, `timeZone: Europe/Stockholm`. Treat FROM_GMAIL all-day transparent events as context, not meetings.
4. Notion/vault: pull context on senders, attendees, companies from vault/people/, vault/business/, vault/projects/*/status.md; notion-search if vault is silent.
4b. **HQ inbox check (two-way notes, build #16; full runbook = work/16-alex-hq/CLAUDE.md "Inbox Contract").** Fetch: `curl -s -m 10 https://n8n.shaheenkiarash.com/webhook/alex-inbox -H "X-Alex-Token: $(cat work/16-alex-hq/config/alex-hq-token.txt)"`. `count_new` 0 → skip; unreachable → one FYI line, never fail the brief; never print the token. **Voice notes** (source `hq-voice`): `scp n8n:/opt/alex-inbox-audio/{audio}` to the session scratchpad → transcribe with LOCAL Whisper (`whisper <file> --model base --output_format txt`, #06 protocol) → transcript = the note text. **File each note per the standing vault protocols** (dated event → Google Calendar; person → People Intake; goal/preference → vault/me/; meeting → vault/meetings/; project → vault/projects/; else best-fit page), [[links]] + vault/log.md as usual — scheduled runs never block on questions: file best-guess, tag `data-gap`. **Mark filed** (note REQUIRED — original text for typed, transcript for voice): `curl -s -m 10 -X POST https://n8n.shaheenkiarash.com/webhook/alex-inbox-mark -H "Content-Type: application/json" -H "X-Alex-Token: $(cat work/16-alex-hq/config/alex-hq-token.txt)" -d '{"marks":[{"id":{id},"filed_to":"{short destination}","note":"{final text}"}]}'`. After a successful voice mark: `ssh n8n "rm -f /opt/alex-inbox-audio/{audio}"` + delete the local copy. The brief gets a short **"Notes you dropped"** block: each note → where it went.
4c. **Mondays:** include the Radar section per the spec (latest vault/projects/alex-ai-radar/radars/ file; a missing Monday sweep gets flagged in Key Context, never silently skipped).
4d. **Life Ops section (every brief, added 2026-07-02).** Google Drive MCP `read_file_content` on file id `1BedopTrI-Aoh1c9_-RxmMzIXjHmpHuWSpV15pBAfUNw` (Plant Watering Schedule; tabs = plants / GymSchedule / LearningSchedule). Build a short **Life Ops** block per the spec: plants due = Last Watered + frequency vs today (ignore the sheet's Next Water Date/Status columns; if ALL plants are >2x frequency overdue, print the one-line stale-sheet flag instead of the full list); gym = session day if (today − StartDate) is an even number of days, else rest day; learning = today's weekday blocks in Order with hours. Sheet unreachable → one FYI line, never a failed brief. Read-only: the brief never writes to the sheet — but if an HQ note (step 4b) says "watered plants"/"gym restarts {date}", file it by POSTing the Life Ops write-back webhook (`/webhook/life-ops-update`, X-Alex-Token, `{"watered":"all","watered_date":"...","gym_start":"..."}`; runbook docs/n8n/life-ops-sheet-writeback/).
5. Classify per the spec's rules: Urgent / Today's Calendar / Key Context / FYI. Newsletters and promos become one noise count line, never itemized.
6. Write vault/projects/morning-brief/history/YYYY-MM-DD.md (Alex voice, [[wiki links]], scannable < 3 min).
7. Create one row in the Daily Briefs DB: title "Brief YYYY-MM-DD", Date, one-line Summary, Urgent Count, FYI Count, FULL brief as page content.
8. Refresh status.md (last_run, counts).

## Post-Run
- vault/people/ page for every new person (flag unknowns as data gaps).
- vault/business/ page for new companies that matter (not newsletter senders).
- vault/log.md: `## [YYYY-MM-DD HH:MM] morning-brief | {urgent} urgent, {fyi} fyi, {noise} noise`.
- vault/index.md only for new page types.
- **Alex HQ metrics push** (build #16 contract, work/16-alex-hq/CLAUDE.md). Never let a push failure fail the run; never print or log the token:
  `curl -s -m 10 -X POST https://n8n.shaheenkiarash.com/webhook/alex-push -H "Content-Type: application/json" -H "X-Alex-Token: $(cat work/16-alex-hq/config/alex-hq-token.txt)" -d '{"project":"morning-brief","metric_key":"urgent_count","value_num":{urgent},"headline":"{top urgent, <=90 chars}","status":"{red if a hard deadline expires today, else green}"}' || true`
