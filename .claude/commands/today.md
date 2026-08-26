# /today - The Day's Plan, and Marking It Done

Hands Shaheen the day's tasks from the **Daily Plan** Notion database, and moves rows when he says
what got done. He never ticks boxes in Notion himself; he tells Alex and Alex writes.

**IDs are NOT in this file.** Read `vault/projects/daily-plan/status.md` frontmatter for `db_id`,
`data_source_id` and `parent_page_id`. This file is tracked in a PUBLIC repo; that page is gitignored.

## Read path, in order. Never skip a leg silently.

1. **`node scripts/daily-plan-core.js today`** - zero-token, deterministic, refreshes the mirror.
   Exit 0 = live or synced-today. **Exit 4 = the mirror is STALE**, and the banner it printed must be
   passed through to Shaheen verbatim. **Exit 3 = no source at all**; say that and stop, show nothing.
2. **Notion MCP** when the core reports no token (the common case today). Query the data source:
   `SELECT url, "Task", "date:Date:start", "Status", "Block", "Week", "Outcome", "Notes", "date:Done On:start"
    FROM "collection://<data_source_id>" WHERE "date:Date:start" = '<today>' ORDER BY "Block"`
   Then also pull open rows dated **before** today for the overdue list.
   After a successful MCP read, rewrite `vault/projects/daily-plan/board-state.json` with the real
   rows and `synced_at` = today, so the fallback stays warm and honest.
3. **Mirror only.** Label it cached, name the age, never present it as verified.

**There is no "Today" view in Notion.** Notion view filters have no relative-date keyword (recorded in
`vault/projects/personal-crm/status.md`, do not rediscover it). The today cut is applied at runtime.

## Output shape

Lead with the week outcome, then the rows grouped by Block, numbered so he can answer with a number.

```
Wednesday 26 Aug (W1) - <the week's Outcome, verbatim from the row>

  1. [ ] <task>                                  Outreach
  2. [ ] <task>                                  Assigned
  ...
Overdue (2): ...
```

Shape only. **Never put a real task, contact name or company in this file**: it is tracked in a
PUBLIC repo while the board itself is gitignored, so an example copied from a live row would leak
exactly what the split is designed to protect.

Rules for the print:
- **Notes matter.** A row whose Notes say COLLISION, BLOCKED, ADDED BY ALEX or DATE CORRECTED gets its
  note shown. Those are the rows where the plan and reality disagree.
- **Say when a day is overloaded.** If a day carries two or more substantive blocks plus a fixed
  weekly item, say so in one line and name which one has an external deadline. Do not silently
  present five things as if they all fit.
- **Overdue is separate and always shown**, oldest first. An outreach row going quiet is the failure
  mode the whole plan exists to prevent.
- Done / Skipped / Moved rows still print, marked, so the day reads as a record and not just a queue.

## Marking work

Accepts, in a session or from a phone note filed through the HQ inbox (#16):
- `done 3` · `done <word from the task>` · `done: <task text>` · several at once (`done 1, 4`)
- `skip 2 <reason>` - Status **Skipped**. **The reason is required**; append it to Notes with the date.
- `move 5 <date>` - Status **Moved**, and create a fresh **To Do** row on the new date carrying the
  same Task, Block, Week, Outcome and Notes. Moving without re-creating loses the task.
- `doing 2` - Status **Doing**.

For each mark:
1. Resolve the handle to exactly one row. **Ambiguous match = ask, never guess.** More than one row
   can share a title (the recurring items repeat weekly), so always disambiguate by Date as well.
2. `notion-update-page` with `command: "update_properties"`: set `Status`, and for Done also
   `"date:Done On:start"` = today.
3. **Read the row back** and confirm both fields landed. This is the Verify-after-write standing order
   (Shaheen 2026-07-12); a 200 is not verification. On mismatch, say so and do not claim it moved.
4. Refresh `board-state.json`.
5. **If the row was a conversation** (an outreach message sent, a coffee held, a manager meeting, a
   reply received), also append it to `vault/projects/personal-crm/outreach-pipeline.md`: a
   conversation-log line and, if the stage changed, the board. That file is the canonical record of
   conversations; this database only records tasks. The Friday review reads both.

## The Friday review

On a Friday, after printing the day, offer his five questions and answer what the system can answer:
1. **How many new conversations this week, name them** - from `outreach-pipeline.md`, not from here.
2. **How many can sign or introduce** - from the people pages.
3. **Next action on each open thread and the date** - the pipeline board.
4. **Which block got eaten and by what** - this database: Skipped and Moved rows for the week.
5. **Did a new name get added each day** - the pipeline log.

Then write the week's row into the pipeline's weekly-count table with the PASS/FAIL verdict against
his own rule: **zero new conversations is a failed week.** If it is zero, say the consequence out
loud, because it is his rule and it is the point of the review: next week has no course hours and no
Alex hours until a conversation is booked, and the assigned block becomes outreach.

## Never

- Never invent a row, a status, or a conversation.
- Never mark something Done because it looked done. He says it, or it did not happen.
- Never present mirror data without the cached banner and the age.
- Never write outside the Personal Ops System parent page (Notion isolation rule).
- Never re-cut his weeks, re-date his plan, or delete a row. Corrections are proposed, recorded in
  Notes, and applied only when he says so.

## Close-Out

Reuses the Daily Plan extras in `vault/projects/daily-plan/status.md`: every row moved is read back,
and any day served from the mirror is reported as cached. Log to `vault/log.md` only when rows moved.
