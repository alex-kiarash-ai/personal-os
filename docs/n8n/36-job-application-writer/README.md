# Job Application Writer (36)

**Workflow id:** none yet · **Runs:** weekdays 07:15 Stockholm time, once it exists · **Steps:** 74 ·
**Currently:** built as 74 node files on this machine, tested offline, and **not on the server at all**
**Upstream:** [34-job-search-bi](../34-job-search-bi/) and [35-job-search-ai](../35-job-search-ai/) do
the finding and the scoring. This one does the writing.

> **There is no `workflow.json` in this folder yet.** Every other folder here holds an export of a real
> workflow pulled off the server. This one cannot, because nothing has been created on the server. The
> export lands the day the workflow does, in the same session, and until then the absence is the
> honest state rather than a missing file.

## What it does

The two job scouts fill a spreadsheet every morning. This one reads what they found and writes the
application.

Every weekday at quarter past seven, half an hour after the second scout finishes, it opens both
spreadsheets, takes the jobs marked new that scored 70 or better, and for each one it produces a
one page CV and a cover letter, puts them in their own Drive folder with a note explaining every
choice it made, and marks the job as written so it never comes round again.

It stops there. It does not apply, it does not email anybody, it does not fill in a form, and it never
opens a browser. Shaheen opens the folder and submits the application himself.

## The one thing worth understanding about it

**The CV is never written. It is assembled.**

Shaheen has two master CVs, one for each career lane, and one of them he has frozen with the
instruction "do not change anything, not a word or a colour or a font". Those masters have been cut
into numbered blocks, and every block carries a fingerprint of its own text.

So when the model chooses what goes on a CV, it does not write sentences. It hands back a list of
block numbers. The assembly step then prints the exact text those numbers point at, straight out of
his own document. There is no path through the code by which a sentence the model invented can reach
the page: a made up block number does not resolve, and a number that does not resolve stops the whole
application rather than becoming a paragraph.

The fingerprint matters too. If he ever edits a master, every fingerprint in it changes, so anything
still pointing at the old text fails loudly instead of quietly shipping a sentence he corrected three
weeks ago.

There is exactly one sentence on the page that is not his. It has to begin with the words "Ready to ",
it can contain no numbers at all, it is one sentence, it is checked against the same voice rules
everything else here uses, and if it fails anything it is simply dropped. The note in the folder names
it as the one sentence he did not write, so he can decide whether he agrees with it.

## The shape of it

74 steps. That sounds enormous for a job that is really about twenty things, and most of the extra is
plumbing that exists for one reason: **the server will not run a step that has been handed nothing.**

So a morning where there is nothing to do would, in a straight line, skip the first step, which skips
the next, and the whole run would end silently having said nothing at all. That is exactly the morning
you most want a report from. Every outside call in this workflow therefore sits between a fork and a
join. The fork sends the live work one way and everything else (the jobs that were held, the jobs that
were over the daily limit, the running report) the other way, and the join puts them back together.
Fourteen of those pairs, 28 of the 74 steps, and they are what guarantee the run always reaches the
end and always says what happened.

The steps fall into eleven bands.

### 1. Waking up and reading both spreadsheets (steps 1 to 5)

Two ways in: the clock, or a button for testing. Then it splits itself into two, one for each lane, and
reads five things out of each spreadsheet in a single request: the settings, the jobs, the list of job
ids already applied to, the applications header, and today's run log.

It reads the raw spreadsheet interface rather than the built in spreadsheet step, and that is not
fussiness. The built in step picks its spreadsheet from the first thing it is handed and then uses that
one for everything. Pointed at two spreadsheets it would read the first one twice, report success, and
quietly turn the AI lane into a copy of the Power BI lane, all the way through to two Drive folders.

Then it decides what this run is allowed to spend money on. It checks both column headers before
reading a single cell, because the columns are read by position and a header that has shifted means
every field after it is the wrong one. It counts how many jobs were already attempted today out of the
run log, so two runs in one morning cannot spend the daily limit twice. It ranks what is left, takes
the top ten plus two spare, and marks everything below that as skipped.

It also checks every job link before anything fetches it. Those links came off a job board, and the
fetch happens from inside the server where other services are reachable by name. So: secure links only,
no passwords in the link, no numeric addresses, no internal names. A link that fails just means that
job gets no fetch, and the pipeline falls back to the short description the scout already saved.

### 2. Reading the job advert (steps 6 to 9)

One fetch per job, spaced a second and a half apart, never retried. LinkedIn refuses server addresses
after roughly ten calls by its own documented behaviour, and retrying into a soft block is how a soft
block becomes a hard one.

A refusal arrives as ordinary data rather than as a crash, which matters because **a page that came
back with a green light is not necessarily a job advert.** Three things look identical to a naive
reader: a sign in wall, a robot check, and a page whose content is drawn by the browser rather than
sent by the server. All three are full of markup and none of them contains a job. So the text is
measured after it is extracted, and anything too short or carrying a challenge marker is treated as a
failed fetch, not a short advert. A failed fetch costs detail; it never costs the application, because
the scout's own summary is still there.

A job with neither a fetched advert nor a summary is held instead. An unattended writer with nothing
but a job title would produce a generic letter, and shipping one is the thing this whole lane is built
to refuse.

This is also where the dash characters get stripped, at the door, before any of that text is quoted to
a model.

### 3. The recruiter's read (steps 10 to 14)

The first of five model calls, and the most expensive.

The model is seated as a senior technical recruiter with twenty years in the chair, briefed as the
person whose actual job is to bin this CV. Shaheen cast that seat himself, twice, in his own words. It
reads the advert and returns a structured brief, and the load bearing part of it is **the three
objections**: the three reasons a screener would reject him for this specific role. Everything
downstream either answers them or admits it cannot.

The advert is fenced and labelled as data before it is shown, and the model is asked to report an
attempt to give it instructions rather than quietly resist one, because a posting that tries to steer
the writer is worth a human look at the company. A job that does that goes to the review pile.

The real protection is not the wording of the prompt, though. It is that this step returns a closed
list of facts and nothing that can run, that the raw advert is never shown to the model that writes the
letter, and that the CV comes from block numbers rather than from anything typed.

This step also applies the rules about where he can work. A job is blocked on location only where the
search was remote only and the job clearly is not, because he has no right to work in the UK. Sweden,
the Gulf and non-EU Europe take onsite work happily. **Where the advert does not say, the CV gets
written**, because most of these sources cannot say, and treating silence as onsite would have
silently killed the entire Gulf intake while every number upstream looked healthy.

### 4. Looking up the company (steps 15 to 23)

One fetch of the employer's own website per company, not per job, and one cheap model call to find a
single quotable line worth referring to in the letter.

The result is proved twice or thrown away: **the quoted sentence has to be a real substring of the page
this run actually fetched, and the website it cites has to be the website this run actually fetched.**
Both checks always run, both reasons get recorded, and a quote that fails either one is deleted.

A company with no readable website simply gets no hook, and that is the correct outcome rather than a
failure. An invented quote is worse than no quote.

### 5. Choosing what goes on the CV (steps 24 to 28)

The model is shown the whole master as a list of numbered blocks with his contact details removed, plus
the recruiter's brief, the screening terms and the three objections. It hands back numbers, an order,
and a list of what it is willing to lose if the page runs long.

Then the assembly step does the work described at the top of this page. It forces his name, his contact
details and his work authorisation line onto every CV whether they were chosen or not, and then checks
they actually came out the other end, which is not the same thing.

**One page is a hard refuse.** If the selection is too long, the blocks come off one at a time in the
order the model itself nominated, re-measuring after each one, until it fits. The one non-master
sentence goes last. If it is still too long after all that, the application is held rather than
shipped. That is the rule working, not the rule failing.

### 6. Writing the letter (steps 29 to 33)

**One step in this entire workflow writes prose, and this is it.**

It is the only one that carries Shaheen's voice. The voice comes out of soul.md and is baked into the
step when the workflow is built, so rebuilding it cannot silently strip the voice out. If the voice
block is ever missing, the job is held before a single paid word is spent, because a letter written by
a model that was never shown how he talks is worse than no letter.

Two authorities sit in that one prompt and they rule on different things. The recruiter lens decides
what earns a line and in what order: the three objections get answered, the screener's need comes
first, a sentence that does not move a screening decision does not get written. The voice rules decide
the words, and they outrank every instinct toward polished corporate English. The failure that
separation prevents is a real one from September: a letter can be perfectly ordered and still read like
any machine wrote it, and it can be perfectly in his voice and answer none of the three reasons it is
about to be binned.

**The raw advert never reaches this model.** It gets the structured brief, the three objections, the
two quoted lines that were proved against real fetched text, the CV it has to argue from, the approved
figures, and a list of things it must not say.

Nothing the model returns is tidied up. A dash is not quietly swapped for a comma, because a repaired
dash makes a letter ship looking clean and hides the mistake from the checks that come next.

### 7. Checking the pair, and the one rewrite (steps 34 to 38)

Eighteen deterministic checks over both documents. No dashes. No AI tells. Between 100 and 280 words.
The letter's skeleton present. No pronouns. No claim to TypeScript or JavaScript, which he writes
neither of and has pruned from his CVs twice. Every number in the letter traceable either to an
approved list or to the employer's own page. The work authorisation line exact to the character. Every
CV block number resolving. The quoted hook a genuine substring. The filenames exactly right.

Two things about how a failure is handled:

**A CV failure is never sent to a model.** The CV is his own text by construction, so a problem there
means the assembly step is broken, and the fix is a code fix. The application goes to the review pile.

**A letter failure gets exactly one rewrite.** The model is shown its own answer and told which checks
it failed, by name. There is no path in the diagram back from the second check to the rewrite, so "one
attempt" is a property of the wiring rather than a number in a counter somebody could raise later.

### 8. The blind grade (steps 39 to 43)

A separate model reads the letter with the voice rubric in front of it, and **nothing else.** No
company, no advert, no CV, no screening note, no audit result, none of the writer's reasoning. A grader
that can read the maker's own case can be argued into passing.

It returns five verdicts, and the overall result is recomputed from those five rather than taken from
the grader's own summary line.

This is the strictest rule in the workflow. A fail holds the application. So does an answer that will
not parse, an answer that was cut off, a missing verdict, a verdict nobody recognises, and a call that
never came back, because every one of those is a voice check that did not happen, and the rule is about
what reaches his Drive unattended rather than about what a model managed to say.

### 9. Making the documents and the PDFs (steps 44 to 51)

Four files per application: the CV, the cover letter, a note explaining the run, and the advert saved
verbatim.

**The two PDFs are called `Shaheen_Kiarash_CV.pdf` and `Shaheen_Kiarash_Cover_Letter.pdf` and nothing
else, ever.** That is a standing rule of his from August, and the reason is that the filename travels
with the attachment: a recruiter who opens a file named after their own company learns, on a forward,
exactly who else he applied to. The company, the role and the date go on the folder, which never leaves
his machine. The PDF's internal title is derived from the filename for the same reason, because that is
a second place the name shows up, in a window title and in a file preview.

The note in the folder is what makes an unattended application reviewable six weeks later, when the
only question that matters is "why did it say that". It carries what was selected and why, the one
sentence that is not his writing, the screening note, the hook or the plain fact that there was none,
both check results, the grade with its five criteria, and what the application cost. The advert is
saved beside it because postings vanish, and a folder with a CV tailored to an advert nobody can read
any more cannot be reviewed.

Rendering goes to a PDF service running beside n8n on the same server. **This is the only step here
that retries**, because that service is local, free and stateless, so a retry costs seconds, and a
dropped connection to this exact service killed a whole run in July after the work had already been
paid for.

Then the PDFs are read back and measured. The page count is counted **two independent ways**, once from
the raw bytes and once from the PDF's own text layer, and if the two disagree that is a failure rather
than a vote. Clipped text still extracts, so a count from the text alone can say one page about a page
and a half. The screening terms from the advert are also checked for in the text pulled back out of the
finished PDF, which is the only way to know that what went in came out.

### 10. Putting it in Drive (steps 52 to 65)

One folder per application, inside that lane's own folder. Then the two files go up, one at a time.

**It was four files until 2026-09-17.** Alongside the CV and the cover letter it also wrote a
README.md, which recorded what was chosen and why, and a job-ad.md, which kept a copy of the advert
for the day the posting disappears. Shaheen asked for neither: printing the CV and the letter should
not produce any md file. The three steps that existed only to turn those two pieces of text into
files went with them, so the upload now hangs directly off the step that creates the folder. What was
lost is the record inside the folder of how the documents were made. It survives in the n8n run for
as long as n8n keeps it, and nowhere else.

Nothing here is ever retried, and that is deliberate in the other direction from the renderer: Drive
happily allows two folders with the same name in the same place, so a retry after a timeout that
actually succeeded leaves one application with two folders and one of them empty.

Then **every single file is downloaded again and its fingerprint compared against the fingerprint taken
before it was uploaded.** A green light from an upload is the request talking about itself. This asks
the document. If anything fails, the folder is left where it is, nothing at all is written to the
spreadsheet, the job stays marked new, and tomorrow offers it again.

### 11. Writing it down, and proving it (steps 66 to 74)

One write per lane, never one per job, for the same reason the reading was done that way.

Three things get written per lane: a row in the applications tab for every application that exists,
shipped or held; one cell per job marking it written or held or skipped; and one row in the run log
with twelve columns saying what the run attempted, shipped, held, blocked, skipped and spent.

**A held application gets a row with the whole letter in the notes column**, so it is readable on a
phone without opening anything else.

A lane with nothing to write still makes the call with an empty list, which is a legal request that
changes nothing. That is what keeps the write, the read back, the check, the report and the dashboard
push running on a morning that produced nothing.

Then everything written is read straight back off the spreadsheet and compared cell by cell, including
the row count, which is the only thing that can catch an overwrite pretending to be an append. The
expected side comes from the step that built the write and the actual side from a fresh read, because a
check whose two halves come from the same place cannot fail.

The dashboard gets one push with the colour and the numbers. Red means the run cannot account for what
it did. Amber means something else broke. Green means everything else, **including a morning that
shipped nothing at all**, because both lanes hitting their daily limit or every letter being held by
the grader is the system working, and colouring that amber would make amber the normal state of the
tile. **A hold is never amber.**

The last step throws if any shipped application lacks a proven upload or a proven spreadsheet row. A run
that cannot prove its writes is a failed run, not a quiet one. It sits after the dashboard push on
purpose, so the message explaining why still goes out before the run dies.

## The escape hatch, from a phone, with no code

**Type the word `new` back into a job's status cell and it comes round again the next morning.**

The intake step only picks up a job whose status reads `new`, and every value this workflow writes is
something other than `new`. So typing the word back is the entire override. No rebuild, no command, no
session. It is also why a job skipped for hitting the daily limit can safely be left behind.

## What it costs

Roughly 0.33 US dollars for one application in the worst case, which is the price with no caching
credit and with every stage running full length, including a rewrite that usually does not happen. A
full day at the limit for one lane is about 3.54 against a budget of 4.00, and the guard that refuses
work up front always overestimates, so it can only ever refuse too early.

It has its own Anthropic account with a 20 dollar monthly ceiling. Its own, rather than sharing one of
the scouts', for three reasons: it serves both lanes so neither scout's account was its natural owner;
it carries by far the most expensive calls in the job search system; and the account is the only place
spend is actually reported, so mixing them would make both "what does the writer cost" and "which
account got throttled" unanswerable. The monthly ceiling also caps the damage from a bug that loops,
which no amount of code review does.

## What has to happen before it can run at all

- **A new tab called `writer_runs` has to be created in both spreadsheets.** It does not exist. Google
  fails a read whose ranges name a missing tab with an error for the entire request, so until both
  tabs exist the first run refuses both lanes by name. That is correct rather than unfortunate: the
  daily limit is counted out of that tab, and a limit that cannot count today is not a limit, on a
  lane that spends real money with nobody watching.
- **The workflow has to be created on the server.** It is 74 files on a laptop right now.
- **The PDF service has never been called from this workflow.** The whole rendering half is unproven.
- **The voice regression test has to pass six out of six** before this is trusted with a letter, and
  it has not been run for this workflow yet.

## Connected to

- **[34-job-search-bi](../34-job-search-bi/)** and **[35-job-search-ai](../35-job-search-ai/)**: the
  two scouts. This reads their jobs, writes their applications, and adds a run log tab to each of their
  spreadsheets. It never writes a job row and never touches their shared list of sources.
- **The morning brief (#02):** where a held application reaches him, as a line and as a waiting-on-you
  item.
- **[hq-metrics-ingest](../hq-metrics-ingest/):** the dashboard mailbox this pushes its numbers to.
- **The older application engines ([03](../03-application-engine/),
  [14](../14-ai-application-engine/), [portal-application-engine](../portal-application-engine/)):**
  all parked. This is not a clone of them and does not read or write anything of theirs. It was built
  on the scouts instead, partly because those engines were parked for spending more than their output
  justified.
- Project doc: `docs/projects/36-job-application-writer.md`. Technical spec:
  `work/36-job-application-writer/CLAUDE.md`.
