# Job Application Writer (#36)

## In plain English
Every weekday at quarter past seven, half an hour after the two job scouts finish, Alex reads what they
found. For every job that scored 70 or better and has not been applied to, Alex writes you a one page
CV and a cover letter, puts them in their own folder in your Drive with a note explaining every choice,
and marks the job as done so it never comes round again.

You open the folder and send it yourself. That part stays yours.

## Why it exists
The scouts (#34 and #35) already do the looking. What they hand you is a spreadsheet of good jobs and
the same evening in front of you: open the master CV, cut the paragraphs that do not fit this one,
reorder the rest, write a letter, save it, name it, do it again.

That is the part that takes hours, and it is the same shape every time. The deciding is yours. The
tailoring is machine work.

## The one thing to know about it
**It does not write your CV. It assembles it out of your own sentences.**

Your two master CVs have been cut into numbered blocks. When Alex picks what goes on a page, what comes
back is a list of numbers, not text. Then the next step prints the exact words those numbers point at,
straight out of your own document.

So there is no way for a made up sentence to end up on your CV. A number that does not exist stops the
whole thing rather than turning into a paragraph. And each number carries a fingerprint of its own
text, so the day you change a word in a master, anything still pointing at the old version fails loudly
instead of quietly shipping a sentence you already fixed.

There is exactly one sentence on the page that is not yours. It has to start with "Ready to", it can
contain no numbers, and it is there for the honest case where a job asks for something the master does
not cover. The note in the folder names it, so you can see it and disagree with it.

## What it will not do
- **It does not apply.** No form, no submit button, no browser.
- **It does not email anybody.** Not a recruiter, not a company, nobody.
- **It does not write a job into your spreadsheet.** That is the scouts' job.
- **It does not score anything.** It reads the score the scouts already justified.
- **It does not ship something it could not check.** If a letter fails the voice check, if the CV runs
  over one page, if a file cannot be proved to have arrived in Drive, the whole thing is held for you
  instead of sent in a worse version.

## How it is careful
- **Four checks stand between a model and your Drive.** Eighteen mechanical checks on the two
  documents. One rewrite, once, and never twice. A second model that reads the letter with nothing but
  the voice rubric in front of it and cannot see the company, the advert or the CV. Then a check on the
  finished PDFs that counts the pages two separate ways and reads the text back out of the file.
- **A job advert is treated as text, never as instructions.** Anyone can write anything into a posting.
  The model that reads the advert is told plainly that it cannot be given orders, and a posting that
  tries is flagged for you to look at. More to the point, **the raw advert is never shown to the model
  that writes your letter at all.**
- **Nothing is quietly repaired.** If the letter comes back with a dash in it, the dash is not swapped
  for a comma behind the scenes. A cleaned up mistake ships looking fine and hides itself from the next
  check.
- **Every file is checked after it arrives.** Each PDF is downloaded back out of Drive and its
  fingerprint compared against what went up. Each spreadsheet cell is read back and compared. A green
  light from a server is the server talking about itself.
- **Your filenames carry your name and nothing else.** `Shaheen_Kiarash_CV.pdf` and
  `Shaheen_Kiarash_Cover_Letter.pdf`, every time. The company, the role and the date go on the folder,
  which never leaves your machine. That rule of yours from August is now also applied to the title
  written inside the PDF, which is a second place a recruiter sees a filename and which nobody had
  thought about back then.
- **A quiet nothing is reported as something.** A morning where both lanes hit their limit, or where
  every letter got held, ends with a report saying exactly that, in green, because that is the system
  working. It is not folded into a blank.

## What it costs
About 33 cents for one application in the worst case, and that number is deliberately pessimistic: it
assumes no caching, every stage running long, and a rewrite that usually does not happen. Ten
applications in one lane in one day is about 3.54 dollars, against a budget of 4.

It runs on its own Anthropic account with a 20 dollar a month ceiling, separate from the two scouts.
Three reasons: it serves both lanes so neither scout's account owned it; it is far and away the most
expensive thing in the job search; and the account is the only place spending actually shows up, so
mixing them would make both "what did the writer cost" and "which account got throttled" impossible to
answer. The monthly ceiling is also the only thing that caps the damage if something loops.

It writes at most ten applications per lane per day, and that limit is counted out of a log rather than
per run, so two runs in one morning cannot spend it twice.

## What you have to do
Three things, and the first one blocks everything else.

1. **Add a tab called `writer_runs` to both job search spreadsheets.** It does not exist yet. The daily
   limit is counted out of that tab, and Google refuses a whole read when it names a tab that is not
   there, so until both exist the first run stops both lanes and says so. That is on purpose. A limit
   that cannot count today is not a limit, on something that spends money while you are asleep.
2. **Say go on switching it on.** Nothing is activated without that, and it is a change to what runs on
   the server.
3. **Open the folders and send the applications.** That never becomes automatic. It is the whole reason
   the lane is called draft only.

Everything else on the list is Alex's: creating the workflow, running the voice test, and the first
real run at a limit of two jobs on one lane so you can watch it spend before it spends unattended.

## What it connects to
- **Job Search BI (#34) and Job Search AI (#35):** the two scouts upstream. They find and score; this
  writes. It reads their job lists and writes back into their spreadsheets, and it never edits their
  list of sources.
- **The morning brief (#02):** where a held application reaches you, with the reason.
- **Alex HQ (#16):** gets one push per run with the colour, the counts and the cost.
- **The older application engines (#03, #14, #31, #32):** all parked in September because what they
  produced did not justify what they spent. This is not a copy of them. It was built on the scouts
  instead, and the expensive half of it is one step rather than four copies of one step, which is the
  specific mistake that left a stale voice in two of those engines for three months.

## Status
**Built, tested on this machine, and never run.**

Seventy four steps exist as files here. Seven test suites covering 740 checks all pass, and every one
of those checks was first shown failing on a deliberately broken input, so a test that passes because
it tests nothing would have been caught.

None of that is the same as working. The workflow is not on the server. The `writer_runs` tabs do not
exist. The PDF service has never been called by this workflow, so the whole rendering half is unproven.
The voice regression test has not been run for it. Nothing here has produced a single document.

That is honest rather than gloomy. The next step is the one that turns it from tested into fired: put
it on the server, run the voice test to six out of six, and do one real run at a limit of two jobs, by
hand, watching it. This page gets rewritten the day that happens.

Technical spec: `work/36-job-application-writer/CLAUDE.md`. Step by step:
[`docs/n8n/36-job-application-writer/`](../n8n/36-job-application-writer/). Live status:
`vault/projects/job-application-writer/status.md`.
