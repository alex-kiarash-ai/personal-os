# Portal Application Engine (#32)

## In plain English
This is the second half of the company-portal job lane. The scanner (#31) goes out to company career
pages twice a week and writes down every job worth a look. This one picks that list up half an hour
later and does the actual work: scores each job against Shaheen's CV, drops the ones that do not fit,
writes a tailored CV and a cover letter in his voice, renders them to PDF, and files them in Drive. It
never applies to anything. Shaheen opens the drafts, reads them, and submits by hand.

## Why it exists as its own project
It was always its own n8n workflow, but until 2026-07-28 the system's registry treated the whole lane as
one entry. That entry recorded this engine's id and schedule, and mentioned the scanner's only in a
sentence of prose.

That mattered more than it sounds. Two of Alex's safety checks read the registry's structured fields and
ignore prose: one asserts that a workflow's schedule still matches what it is supposed to be, the other
checks every morning that a workflow is still switched on. Because the scanner was only named in a
sentence, it had neither.

And the order of the two makes that the dangerous way round. The scanner collects, this engine consumes.
If the scanner had quietly switched itself off, this engine would still have woken up on time, found
nothing waiting, finished without an error and reported success. The only outward sign would have been
"not many drafts lately", which looks exactly like a quiet week in the job market. Alex has been bitten
by this once already, in July, when two live workflows were silently deactivated by a routine update.
That time the missing output was noticed. Here it would not have been.

Splitting the lane into two ordinary entries fixed it without writing any new code, because both
workflows now go through the checks that already existed.

## How it is careful
- **It never applies.** Everything it produces is a draft in Drive. There is no send step in it.
- **It never touches the other job engines.** The two established pipelines (#03 and #14), their
  spreadsheets, their Drive folders and their schedules are off limits by design. This lane has its own
  copy of everything and shares only logins and the PDF renderer.
- **The model it runs is not decided here.** It is recorded once in the registry and checked against the
  live workflow on every build, so it cannot drift quietly.

## What it connects to
- **Portal Scanner (#31):** the stage before it. It banks the jobs, this drains them.
- **The job pipelines (#03, #14):** siblings in approach, deliberately isolated in practice.
- **Alex HQ (#16) and the recovery sweep (#18):** both now watch this workflow and its sibling by id.

## Status
Live. First real run 2026-07-28, both stages succeeded. Whether the lane earns its keep is still an open
question: the proving run found roughly 1.5% of scanned jobs worth drafting, against about 11% on the
main pipeline. That number, measured over the next month or two, decides whether it stays.

Spec: `work/32-portal-application-engine/CLAUDE.md` · Status page:
`vault/projects/portal-application-engine/status.md`
