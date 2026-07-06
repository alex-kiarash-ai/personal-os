# Life Ops - Sheet Write-back (02)

**Workflow `LuQ5Wtm5kyAyfNeU` · ACTIVE since 2026-07-03 · webhook-triggered, no schedule**

## What it does
Stamps Shaheen's **Plant Watering Schedule** Google Sheet (the one the morning brief's Life Ops section reads) without anyone touching cells by hand. One POST updates the watering log for any or all plants and can reset the gym cycle start date. Built the night Shaheen came home from Berlin and said "the last watering time is today, gym restarts tomorrow" - this was the planned Phase 2 write-back, pulled forward.

## Endpoint
`POST https://n8n.shaheenkiarash.com/webhook/life-ops-update`
Header: `X-Alex-Token` (same Alex HQ Token credential as the notes inbox, `m6VkVeG9bym6OFID`).

Payload (all fields optional):
```json
{
  "watered": "all",              // or ["Coleus", "Peace Lily"] - default "all"
  "watered_date": "2026-07-02",  // default: today Europe/Stockholm
  "gym_start": "2026-07-03"      // omit to leave the gym cycle alone
}
```

## Node by node
1. **Life Ops Webhook** - POST `life-ops-update`, header-auth gated, responds via respond node.
2. **Normalize** (Code) - defaults: watered=all, watered_date=today Stockholm, gym_start empty.
3. **Read Plants** (Google Sheets) - reads the `Plant Watering Schedule` tab. All 4 Sheets nodes use cred `UhK77WK48hRv85bo` (consolidated from the retired `Ak32c6W6GmE1Olcu` on 2026-07-03).
4. **Compute Plant Updates** (Code) - filters to target plants, sets `Last Watered` = watered_date, recomputes `Next Water Date` = watered_date + that plant's `Watering Frequency (days)`, sets `Status` = OK. Matches rows by `row_number`.
5. **Update Plants** (Google Sheets) - update op, auto-map, matching column `row_number`.
6. **Has Gym Start** (IF) - gym_start non-empty?
7. **Read Gym** → 8. **Set Gym Start** (Code) → 9. **Update Gym** - sets `StartDate` on the single GymSchedule row (the every-second-day cycle anchor the brief computes gym/rest days from).
10. **Respond OK** - `{"ok": true}`.

## Who calls it
- Any Alex session, when Shaheen says he watered / restarts the gym cycle (chat or an HQ note like "watered plants").
- The morning brief itself stays READ-ONLY on the sheet; it never calls this.

## Gotchas
- `watered: []` (empty list, gym-only update) is NOT supported - the plants branch guard emits a skip row; just omit `watered_date` semantics and pass `watered` with names, or accept the all-stamp. For gym-only, pass `{"watered": ["nonexistent"], "gym_start": "..."}`... cleaner: don't. Stamp plants when plants were watered.
- LearningSchedule tab has no write path (weekday-based, nothing to stamp).
- First live run: execution 223, 2026-07-02 22:03 UTC, all 10 nodes green, verified against the sheet via Drive read.
