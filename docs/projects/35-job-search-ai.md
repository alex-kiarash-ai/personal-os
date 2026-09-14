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
Built on 14 September. The workflow is on the server with all 49 steps, switched off, and it has never
run. Not once, not even by hand. So everything we know about how it behaves, we know from watching #34.

The two lanes now run the exact same steps, file for file. That is how it was designed, and it carries an
obvious risk: fix something in one lane, forget the other, and they drift apart without anyone noticing.
You would not see it. You would just get a slightly shorter list one day and have no reason to question it.

So the copy is now checked by the system itself. Every time the checks run, they compare the two lanes
file by file, and they stop the work if the two ever differ. It was tested by breaking it on purpose
first, twice, to make sure it actually catches the problem instead of just claiming to.

The rule that comes with it: changing one lane is not finished until the other one is changed too.

It is waiting on the same things #34 is waiting on, plus one manual run of its own.
