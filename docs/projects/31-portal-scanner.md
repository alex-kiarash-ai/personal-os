# Portal Scanner (#31)

## In plain English
Most job boards show you a job after a company has already paid to advertise it. A lot of smaller
companies never do that: the role goes up on their own careers page and stays only there. This scanner
goes straight to those pages. Twice a week it asks each company's hiring software for its current
openings, in the plain machine-readable form those tools publish for free, filters out the obviously
wrong ones by title and location, and writes the rest into a queue. Half an hour later the Portal
Application Engine (#32) picks that queue up and turns the survivors into drafts.

It reads public pages that companies publish on purpose. It does not log in anywhere and it does not
scrape around anyone's back.

## Why it exists
The two main job pipelines source from boards. This one sources from companies. It is the "only on their
own site" lane, aimed at small Nordic and remote startups, where being early actually counts for
something.

## How it is careful
- **Free endpoints only.** It uses the public listings feeds the hiring tools already expose. No paid
  API, no crawling, no login.
- **It never touches the established pipelines.** #03 and #14, their spreadsheets, their Drive folders
  and their schedules are off limits. This lane is a full separate copy, sharing only logins and the PDF
  renderer.
- **It banks, it does not decide.** Scoring, gating and writing all happen in the next stage, so this
  half stays cheap and simple.

## What it connects to
- **Portal Application Engine (#32):** the stage after it. This one collects, that one drafts.
- **The job pipelines (#03, #14):** same idea, deliberately separate machinery.
- **The recovery sweep (#18):** since 2026-07-28 this workflow is watched by id, so if it ever switches
  itself off, something says so. Before that it was only named in a sentence, and nothing was checking.

## Status
Live. First real run 2026-07-28. The honest open question is whether the lane pays for itself: the
proving run turned roughly 1.5% of scanned jobs into something worth drafting, against about 11% on the
main pipeline. That number over the next month or two decides whether it stays or gets retired.

Spec: `work/31-portal-scanner/CLAUDE.md` · Status page: `vault/projects/portal-scanner/status.md`
