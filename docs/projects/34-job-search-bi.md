# Job Search BI (#34)

## In plain English
Every weekday morning at half past six, Alex goes round the job boards that will answer without a login,
collects everything Power BI shaped that was posted in the last day, throws away the duplicates, reads
each one, gives it a score against what you are actually good at, and puts the result in a spreadsheet.
By the time you open it, the search is done. Alex does not apply to anything.

## Why it exists
Looking for a job is mostly the same twenty minutes repeated every morning: the same searches, the same
boards, the same scroll past the same postings you already saw yesterday. That part is machine work. The
part that is yours is deciding which three are worth your afternoon, and that decision is easier when
somebody has already thrown out the sixty that were never a fit.

There are two of these lanes because you are running two job searches at once. This is the Power BI one.
The AI Automation one is #35, and the two are built as twins on purpose.

## How it is careful
- **It reads, it never sends.** No email, no application, no clicking submit. It writes one spreadsheet
  that belongs to you and stops there.
- **A job ad is treated as data, never as instructions.** Anyone can write anything into a job posting,
  and that text goes to a model to be scored. So the model is told plainly that a posting cannot give it
  orders, and what comes back is a number and a reason, nothing that can run.
- **A quiet zero is reported as a problem, not as a clean run.** If a board answers politely and hands
  back nothing, the run report says which board and why. That sounds small. It is the difference between
  a search that is working and a search that broke three weeks ago and nobody noticed.
- **It says what it does not know.** The sources were all tested by hand the day this was built, and five
  things came back ambiguous. They are written down as open questions with the exact call that answers
  each one, rather than guessed at and forgotten.

## What it connects to
- **Job Search AI (#35):** the twin lane. Same list of sources, same build script, one shared file that
  describes every board. Two copies of that file is how the two lanes would slowly stop matching.
- **The application engines (#03, #14, #31, #32):** separate jobs, deliberately not wired together. Those
  write applications. This one finds and scores postings.

## Status
Built. The workflow is on the server with all 49 steps in place, and it has run three times by hand, on
11, 12 and 14 September. It is switched off, on purpose.

In the project list it is now marked dormant rather than live. That is not a demotion. Dormant is the
word this system uses for something that is finished and waiting on one named thing outside itself, and
here that thing is the Anthropic top-up plus your go-ahead to free a slot on the server. It was marked
live while it was switched off, and the daily check that watches for workflows going dark would have
spent tomorrow morning shouting about these two instead of the three older engines that really are
failing. It goes back to live the day it is switched on.

It has never written a job into the sheet, and that is not a fault in the lane. Every scoring call comes
back saying the Anthropic account is out of credit, and the lane will not write a job it could not score.
So it collects, it filters, it holds the row, and it refuses to move its own clock forward. That last part
matters: if it moved the clock, the jobs it skipped today would never be looked at again.

The run on 12 September found 950 postings, kept 102 after filtering, held 20, scored none of them, and
said so plainly in its own report. The run on 14 September was the first one on the newest version: 860
postings, 66 kept, 10 held, and every one of those 10 carried a real job description instead of a bare
title. That was the point of the last fix.

One thing is quietly broken. The step that tells your dashboard how the run went cannot use the password
it was given, because that password is for letting messages IN, not for sending them OUT. The run still
says it succeeded, because the only thing that failed was the part that reports. It is on your list now.

Two things still need you: the Anthropic top-up, which you have deliberately held back until these lanes
are finished and the old engines are off, and the go-ahead to check for free space on the server before
anything gets switched on.
