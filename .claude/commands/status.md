# /status - What's Happening

Two modes: quick check or full report.

## Quick Mode (default, when user asks "status" or "what's going on")

Read vault/log.md for the most recent entries. Report:
- Last 3-5 automation runs: what ran, when, key findings
- Project progress: read Notion sprint board (database ID from vault/projects/sprint-tracker/status.md) for how many tasks Done vs To Do
- Anything needing attention (flagged items, failed runs, out-of-range health values)
- Upcoming scheduled tasks from scheduler/schedule.md
- **HQ inbox:** GET `https://n8n.shaheenkiarash.com/webhook/alex-inbox` (X-Alex-Token from work/16-alex-hq/config/alex-hq-token.txt, never printed). If `count_new` > 0, file the notes per work/16-alex-hq/CLAUDE.md "Inbox Contract" (voice → scp + local Whisper first) and mark them; report "HQ notes: N filed". Unreachable → one line, continue.
- **Waiting on you:** `node scripts/human-actions.js list` (upgrade P2). Print the open queue with ages; "done: <id>" from Shaheen closes an item via the `done` command. Also flush anything flushable from `system/pending-writes.jsonl` (deferred Notion writes) while here.

Keep it brief. 10 lines max. The user wants a snapshot, not a report.

## Full Mode (when user asks "full status" or "system health")

### 1. Identity
Read soul.md. Confirm personality is loaded.

### 2. Connections
Test each MCP live:
- Gmail: list 1 recent email
- Google Calendar: check today's events
- Notion: list databases

### 3. Recent Activity
Read vault/log.md. Show the last 10 entries with timestamps.

### 4. Project Progress
Read Notion sprint board. Show: Done count, In Progress count, To Do count, Blocked count.

### 5. Vault Health
Count pages in: vault/me/, vault/business/, vault/people/, vault/meetings/, vault/projects/, vault/research/
Last vault update timestamp.

### 6. Scheduled Tasks
Read scheduler/schedule.md. List all schedules and their frequencies.

### 7. Automations Built
List each folder in work/ and whether it has a CLAUDE.md file.

### 8. Brand Config
Check if brand/config/brand-config.md exists and has real values.
