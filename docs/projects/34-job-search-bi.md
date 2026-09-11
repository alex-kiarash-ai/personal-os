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
Scaffolded 11 September 2026. Registered, spec written, the source list tested live and frozen, the build
tool written. Nothing has been built on the server yet: no workflow, no schedule, no first run. Two things
have to happen before it can run for real, and both need you: three free slots on the n8n server, and the
Anthropic credit top-up that the scoring step waits on.
