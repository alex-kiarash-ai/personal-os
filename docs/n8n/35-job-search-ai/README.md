# Job Search AI (35)

**Workflow id:** `TNvg3zbOzd3rGr9T` · **Runs:** weekdays 06:45 Stockholm time · **Currently:** switched off, never run, and marked dormant in the project list since 14 September for the same reason as #34
**Twin:** [34-job-search-bi](../34-job-search-bi/) is the canonical one. **Read that README first.**

## What is different here, and it is a short list

This is the same 49 steps as #34, in the same order, doing the same things. Every explanation of how
it works lives in #34's README and is not repeated here.

What changes:

- **The keywords.** n8n, AI automation, agents, LLMs, workflow automation, integration engineering,
  instead of Power BI and DAX.
- **The scoring.** It reads Shaheen as someone moving into this field rather than seven years into it,
  so a job asking for things he has not done yet is scored differently.
- **Its own spreadsheet**, its own Claude account credential, and its own run log.
- **The clock.** It starts at 06:45, a quarter of an hour after #34. That is not cosmetic. Both lanes
  call the same public job boards from the same machine, and four of those boards ask politely that
  you do not hammer them. Two lanes firing in the same minute from the same address is how a free
  source stops being free.

## The thing worth knowing about this lane

The two lanes are not similar. They are **identical**, file for file, all 52 of them.

That was the plan from the start, and it carries a risk that is easy to say and easy to forget: fix
something in one lane, forget the other, and they slowly stop matching. Nobody would catch it. You
would get a slightly shorter list of jobs one morning and no reason at all to wonder why. A missing
job does not announce itself.

The obvious fix, having one lane borrow the other's files instead of copying them, cannot work here.
The files find their settings by looking at the folder they are sitting in. A file borrowed from #34's
folder would read #34's settings and quietly build the wrong spreadsheet and the wrong clock into this
workflow. Where a file lives is how it knows which lane it belongs to.

So the copies stay, and the checking got moved somewhere it cannot be skipped. Every time the system
runs its checks, it compares the two folders file by file and refuses to continue if they differ. It
was deliberately broken twice first, to prove it actually catches the problem rather than just
claiming to.

**The rule that comes out of it: changing one lane is not finished until the other is changed too, and
both workflows are rebuilt.**

## Status

Built 14 September 2026 and read back after building: 49 steps, the right clock, the right spreadsheet,
its own credential, and nothing belonging to #34 anywhere inside it.

It has never run. Not on the schedule, not by hand. So everything above about how it behaves is
borrowed from watching #34, and one manual run is the next thing it needs.

Two things it is waiting on, both shared with #34: the Anthropic credit top-up that scoring needs, and
the same broken dashboard-reporting step, which it inherited along with everything else.

One thing it owns alone: the test tab it is set to write into does not exist in its spreadsheet yet.
That cannot bite until scoring works, because a job that was not scored is never written, but the tab
has to be created before the first job is ever saved.

## Getting it back if the server dies

Import `workflow.json` into any n8n, reconnect the credentials, done. Local copy only, never pushed.
