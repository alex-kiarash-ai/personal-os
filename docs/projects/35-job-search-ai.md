# Job Search AI (#35)

## In plain English
The same morning sweep as #34, fifteen minutes later, looking for the other job. Where #34 hunts Power BI
roles, this one hunts AI automation, n8n and agent work. Same boards, same tidy-up, different words to
search for and a different way of reading your fit, because a career changer and a seven-year specialist
are not scored the same way. It writes to its own tab in the same spreadsheet, and it does not apply to
anything.

## Why it exists
You are running two job searches at once, and they are not the same search. Splitting them into two lanes
means each one gets its own schedule, its own scoring and its own read of what counts as a good match,
instead of one lane trying to be both and being mediocre at each.

The fifteen minute gap is not decoration. Both lanes hit the same public job boards from the same server,
and four of those boards ask politely to be polled a few times a day rather than hammered. Starting at
06:45 instead of 06:30 keeps the two lanes from arriving together.

## How it is careful
Identical to #34, and deliberately so: it reads and never sends, a job ad is data and never instructions,
a quiet zero is reported rather than counted as success, and the open questions about each board are
written down rather than guessed. The full version of that list is on the #34 page.

The one thing this lane does differently is that it does **not** re-run the source tests. Those are
questions about the boards, not about a lane, and one of them costs real money per record. #34 asks each
question once and writes the answer into the shared file. This lane reads it.

## What it connects to
- **Job Search BI (#34):** the twin. One shared file describing every board, one shared build script. A
  change to either lane is a change to both, and it gets written down in both places the same day.
- **The application engines (#03, #14, #31, #32):** separate jobs, deliberately not wired together.

## Status
Scaffolded 11 September 2026. Registered, spec written, sharing #34's source list and build tool. Nothing
built on the server yet: no workflow, no schedule, no first run. Waiting on the same two things #34 is
waiting on, three free slots on the n8n server and the Anthropic credit top-up.
