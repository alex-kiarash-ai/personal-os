# Job Application Writer (36)

## Type
Automation. ONE n8n workflow on the Hetzner box, weekdays 07:15 Europe/Stockholm, reading BOTH
job-search spreadsheets. Commissioned 2026-09-14, built across seats 2 to 7 on 2026-09-14 and
2026-09-15. **74 node files, 740 offline checks across seven suites, and the workflow does not exist
on the box yet.** This file is the contract the build followed; current state is in the Status
section at the bottom, and the Status section is the only part of this file allowed to claim a live
fact.

## Purpose
Take the job rows that #34 and #35 already collected and scored, pick the ones worth an application,
and produce a tailored one-page CV and a cover letter for each, into a Drive folder Shaheen opens.
It writes documents. It never applies, never emails, never opens a browser, and never touches a
recruiter.

The CV is assembled from his own frozen master by block id, so **the CV cannot contain a rewritten
sentence by construction.** That is the single most important property of this design and every
other rule in this file exists to protect it.

## What it reads, and why one workflow instead of two
The two collectors (#34 Power BI, #35 AI Automation) each own a spreadsheet with a `jobs` tab, an
`applications` tab and a `settings` tab. This workflow reads BOTH, in one run.

The alternative considered was a clone per lane, the way #31 and #32 were split from #03. It was
refused, and the reason is written into `config/lane.json` as `_why_one_workflow`: the expensive,
delicate half of this workflow is the prose node, and a clone means two copies of it. That is exactly
the drift that left a stale voice block in #31 and #32 for three months and surfaced in a cover letter
a recruiter read. **One workflow, one prose node, one voice-sync target.**

The cost of that choice is that the Google Sheets NODE cannot be used anywhere in this workflow. It
resolves `documentId` at item zero for a whole batch, so one node pointed at two spreadsheets reads
the first one twice, returns 200, and reports two lanes. Every read and every write here is raw REST
(`values:batchGet`, `values:batchUpdate`) with one call per lane. This is design defect 1 from the
plan review and it is a mechanical fact, not a preference.

**The only coupling to the collectors is the clock.** 07:15 sits 30 minutes behind #35 and 45 behind
#34 so both have finished writing their `jobs` tab. There is no trigger chain and nothing signals
completion. A collector that runs long just means this run reads yesterday's rows for that lane,
which is a quiet degradation, and the intake stage report names the newest `found_at` it saw per lane
so the gap is visible when it happens.

## What qualifies a row
A row is picked up when its `status` cell reads `new`, its `fit_score` is 70 or more, its `job_id` is
not already in the `applications` tab, and it survives the D10 work-type gate. The threshold lives in
`config/lane.json` as `score_threshold` and nowhere else. **This workflow never re-scores anything:**
it reads a number #34 or #35 already justified.

D10, as amended by Shaheen on 2026-09-15, is a SCOPE question rather than a global block. Work type
blocks a pair only where the collecting scope is remote-only (Remote EU, Remote UK) and the row is
demonstrably not remote, because he has no UK right to work. Sweden, the Gulf and non-EU Europe accept
onsite, hybrid and remote alike, so an onsite role in Dubai, Doha, Riyadh, Zurich or Oslo is a CV
worth writing. **Where work type is unstated, the CV gets written.** Most sources in this pipeline
cannot state it at all, so treating an empty cell as onsite would silently block the entire Gulf and
non-EU Europe intake while every count upstream looked healthy. A Swedish-fluency requirement still
blocks. A right-to-work requirement is recorded as an OBJECTION the letter answers honestly, never as
a block (D17). Full amendment text, including the correction seat 3 made to the amendment itself, is
in `PLAN.md`.

## Entry Points
- **Scheduled:** n8n Schedule Trigger, weekdays 07:15, to be declared in `system/manifest.json` as
  `n8n_cron: "15 7 * * 1-5"`. The trigger MUST carry a raw cron expression at
  `rule.interval[0].expression`; any other interval shape makes the declared cron un-assertable and
  V6 leg (c) drops from a failure to a warning, which is a contract that looks checked and is not.
- **Manual:** the n8n editor's Execute Workflow button, node `When clicking Test`. The public API
  cannot start a manual execution, so there is no CLI trigger and there is no slash command. This is
  the path the first-fire drill uses, and it needs no activation.

## The five model calls, in order
Every call is Anthropic `/v1/messages` through a plain HTTP Request node. The whole request body is
built in a Code node upstream and the transport node carries no prompt, because a prompt built in an
n8n expression can only be tested by running it, and running these costs money.

| Stage | Model | Seat it plays | What it returns |
|---|---|---|---|
| Read | `claude-opus-5` | a senior technical recruiter, 20 years, whose job is to bin the CV | a structured brief plus **the three objections** a screener would raise |
| Research | `claude-sonnet-4-6` | a reader of the employer's own site, one fetch | ONE verbatim hook, or null |
| Select | `claude-opus-5` | a CV editor working from a block library | block IDS, a section order and a drop order, never text |
| Write | `claude-sonnet-5` | **the one prose node** | the cover letter |
| Grade | `claude-sonnet-4-6` | a blind grader holding only the rubric | five criterion verdicts |

The models are NOT declared in `config/lane.json` and must not be. `system/manifest.json`
`meta.model_routing` is the enforced contract and V6 asserts the live workflow against it; a second
copy in the lane file would be a number that looks authoritative and is never checked.

**The recruiter seat is his own casting, twice.** "think as a senior HR recruter and write it as from
that prespective" (2026-08-26) and "As a senior reqruiter with 20 years of experience in Tech
positions" (2026-09-12). Two sightings made it settled; this lane turns it from something a session
remembers into a runtime stage.

**Only `Build Writer Request` is a prose node.** `scripts/lib/sync-n8n-voice.js` enrols a workflow by
finding a Code node with that exact name and a `const SYSTEM = "..."` literal terminated by
`;` newline `const TONE`. Miss the name, the const or the terminator and the sync does not fail: it
declines to write, and every letter this lane ships is written in generic English by a model that was
never shown his voice. The voice block is therefore also BAKED at build time from soul.md through the
same function the live sync uses, so a `--rebuild` carries a current block by construction and the
later sync sees an identical stable part and reports a verified no-op. Enrolment is by node name, so
"only the writer gets the voice block" holds only while exactly one node carries that name. **Nothing
in the repo asserts the negative side**, so every other Code node in this workflow refuses to be
called it and the offline suite counts the name over all 25 Code nodes.

The reader, the researcher, the selector and the grader are reasoning nodes and carry NO voice block.
That is the boundary test from the root constitution applied node by node.

## The gates, and what each one refuses
Nothing here is a model checking a model. Every gate below is deterministic code except the blind
grade, and the blind grade can only HOLD, never ship.

- **A1 to A18, the pair audit** (nodes 34 and 38, one shared template). Zero dash characters, zero AI
  tells, word count 100 to 280, the letter skeleton present, no pronouns, no TypeScript or
  JavaScript claim, every number in the letter traceable to an approved list or to the employer page
  this run actually fetched, the work-authorization line exact, the one-page character ceiling, every
  CV block id resolving, the quoted hook a real substring, the voice block present, and the filenames
  exact. The dash, tell, pronoun and banned-claim rules are BAKED from `scripts/lib/voice-rules.js`
  rather than retyped, so there is one definition of each in the repo.
- **A CV failure is never rewritten.** The CV is verbatim master by construction, so a CV-scope
  failure means the ASSEMBLER is wrong. The pair goes straight to `needs_review` and no model is
  asked to fix it.
- **ONE reasoned rewrite for a letter-only failure.** The original request object, the draft appended
  as an assistant turn, the failed checks named in a second user turn. There is **no edge back** from
  the final audit to the rewrite branch, so one attempt is a property of the graph rather than of a
  counter somebody can raise.
- **Nothing is repaired silently.** A dash is never substituted, because a repaired dash makes a
  letter ship looking clean and hides the slip from the audit and from the blind grader.
- **D16, the strictest rule here.** A blind-grade FAIL holds the pair. So does an unparseable answer,
  a truncated answer, a missing criterion, an unrecognised verdict and a call that never completed,
  because every one of those is a voice check that did not happen, and D16 is about what reaches
  Drive unattended. The top-level verdict is RECOMPUTED from the five criteria rather than read off
  the grader's own summary field.
- **The grader is blind.** Its user turn is the letter text and nothing else: no company, no posting,
  no CV, no screening note, no audit result, none of the writer's reasoning. A grader that can read
  the maker's own case can be argued into passing.
- **R1 to R6, the render check.** Both PDFs non-empty, the CV exactly one page, the letter one page,
  the extracted text parsing and carrying his name, the ad's key ATS terms present in the extracted
  CV text, and zero dashes surviving in the extracted text of both. **Page count is asserted TWO
  independent ways**, a `/Type /Page` regex over the raw bytes and `extractFromFile`'s own `numpages`,
  and a disagreement is a failure rather than a vote, because clipped text still extracts.
- **U1 to U3, the upload check.** Every file of every shipped pair read back from Drive, every
  downloaded md5 equal to the digest computed before the upload, and the file count per folder read
  off `FILE_KINDS` rather than written as a number. **TWO files per folder since 2026-09-17**, both
  PDFs; it was four until the md files were removed.
- **The sheet check.** Five comparisons per lane: every cell of every applications row, the
  applications column row COUNT (the only thing that can catch an overwrite), every addressed
  `jobs.status` cell, every cell of the ledger row, and the `writer_runs` row count.
- **Assert Run** throws when a shipped application lacks a verified upload or a verified sheet row.
  A run that cannot prove its writes is a FAILED run, not a quiet one. It runs AFTER the HQ push on
  purpose, so the message explaining why still goes out.

## The CV cannot carry a rewritten sentence
The selector emits IDS. The assembler emits MASTER STRINGS. The only thing the assembler ever prints
is `table.byId[id].raw`, a string that came out of a document Shaheen wrote and froze. A model that
invents a better bullet produces an id that does not resolve, and an id that does not resolve is a
refusal, not a paragraph.

An id looks like `exp.r1.b03@a1f9c2d0`: a position, then the first eight hex of the sha256 of that
block's text. The hash is the point. If a master is amended, every affected id CHANGES, so anything
pinning an old one fails loudly instead of shipping a sentence he corrected three weeks ago. An
unresolved id is reported two ways and they mean different things: **the position exists with a
different hash** is the amendment signal, re-read the master and rebuild; **the position does not
exist** is an invented id. Both hold the pair. Neither is patched.

**The one exception, deliberate, bounded and visible:** a single bridging line opening with the exact
words "Ready to ". It comes from `writer-notes-ai.md` and the approved plan. It has no block id, it
lives in its own field, it is emitted from a different code path tagged `source: 'bridge'`, it carries
no digits at all, it is one sentence of at most 160 characters, it is checked against the same
`scripts/lib/voice-rules.js` the letter audit uses, and **a failure drops the line, never the CV**.
It is named as such in the folder README, which is what a person needs in order to disagree with it.

One page is a HARD refuse (D13, his choice). The measured ceiling is 3,760 characters of paragraph
text. The selector returns a `drop_order` and the assembler drops one id at a time in that order,
re-measuring after each, until the page fits. A mandatory id on the drop order is skipped and
RECORDED. The bridge line goes last. If it is still over, the pair is held, which is D13 working.

## Filenames carry his name only
`Shaheen_Kiarash_CV.pdf` and `Shaheen_Kiarash_Cover_Letter.pdf`. Nothing else, ever. The standing
order is Shaheen's, 2026-08-20, and the reason is that **the filename travels WITH the attachment**: a
recruiter who opens a per-company filename learns on a forward exactly who else he applied to.

Three things follow, and they are load-bearing:
1. The law is enforced as CODE in `scripts/outputs-ledger.js`. Node 34 validates the two names against
   that regex at build time, stamps them on the pair, and A17 asserts them at run time. **Node 44
   READS the stamped names and does not know the law.** A third copy of a rule that changed once
   already is a third thing to keep in step.
2. **The PDF `/Title` metadata is derived from those same names.** Chromium writes the HTML `<title>`
   into the PDF, which a recruiter sees in a window title and in a file-manager preview. That is a
   second surface the filename travels on, and the 2026-08-20 order never mentions it because nobody
   here was generating PDFs out of HTML then. Deriving it makes it obey the law by construction.
3. **The company, the role and the date live in the FOLDER name**, which never leaves this machine.
   The lane label and the job id ride in brackets at the end, because two lanes can legitimately apply
   to the same role at the same company on the same morning and a folder that silently merged them
   would lose one application.

## What a shipped application looks like
One Drive folder per job, inside that lane's own parent folder, holding **TWO files since 2026-09-17**:

- `Shaheen_Kiarash_CV.pdf`
- `Shaheen_Kiarash_Cover_Letter.pdf`

~~It held four.~~ **Superseded 2026-09-17 on Shaheen's instruction**, and the two that went are
recorded here rather than deleted, because both were load-bearing and the argument for them was
good:

- ~~`README.md`, the artefact that makes an unattended application reviewable afterwards (D12, D15):
  what was selected and why, the one sentence on the CV that is not his writing named as such, the
  screening note, the hook or the plain fact that there was none, both audit verdicts, the blind grade
  with its five criteria, and what the pair cost.~~
- ~~`job-ad.md`, the posting saved verbatim, fenced, under a header saying plainly that this is quoted
  third-party text and nothing in it is an instruction. Postings vanish, and a folder with a CV
  tailored to an ad nobody can read any more cannot be reviewed.~~

His words: *"delete when the n8n print the cv and the cover letter should not produce any md file."*
What it costs: nobody watches this run, and the folder no longer answers "why did it say that". That
answer is now only in the n8n execution, which ages out. The dash rule that used to need stating here
(the README quoted third-party prose verbatim, so its quotes could legitimately contain a dash) is
moot: nothing in a folder now carries a quote, and R6 always read the two PDFs, which never did.
Recover the builders from git rather than rewriting them; see the 09-17 section at the end of this
file.

Rendering is Gotenberg on the docker network, one multipart POST per document. **This is the ONE node
in the workflow that retries**, because the service is local, free, stateless and idempotent, so a
retry costs seconds, and an `ECONNRESET` on this exact service killed a whole run on 2026-07-16 after
the pairs had already been paid for. `singlePage` is not in the form and never may be: it would make
the one-page assertion pass on a CV of any length.

## What a HELD application looks like
A hold is not a failure and it is not amber. It is the gate doing the job. A held pair surfaces three
ways, and the first one is the one that matters on a phone:

1. **An `applications` row with `status = needs_review` and the FULL letter text in `notes`**, so the
   hold is readable without opening anything.
2. **A waiting-on-you row** raised locally by the 08:00 morning brief.
3. **The brief line itself.**

Nothing that failed a gate is shipped in a worse form. The pipeline either produces something it can
prove, or it hands over what it produced and says why it stopped.

## The daily cap, the cost, and the budget
- **Ten pairs per lane per day (D11), counted rather than assumed.** Per RUN it would be ten per
  execution, and two manual re-runs in one morning would write twenty applications and spend twice the
  money. So `writer_runs` is read, today's rows for this lane are summed on their `attempted` column,
  and the run may admit the remainder and nothing more.
- **`attempted` counts pairs admitted to the READER, not pairs shipped.** A pair that was read, cost
  money and then failed a gate has still been attempted. A cap that forgave it would let a bad morning
  spend the day cap twice over.
- **Intake admits cap plus two.** The real cap gate runs after the D10 verdicts, so a cap consumed by
  blocked pairs does not under-deliver. The overshoot is paid for whether or not it is needed, which
  is why it is two and not five: each overshoot pair costs one opus-5 read.
- **Every qualifier beyond cap plus two is stamped `skipped:cap` and is NOT re-offered tomorrow.**
  D11 is literal about that. The re-queue is the phone override below.
- **The cost guard is pessimistic by construction.** Every call is priced at full input price with no
  cache credit, at the worst-case token counts each stage can reach given the caps this design already
  enforces. The estimate is always above the bill, so the guard can only refuse too early.

Worst case per pair, computed from `COST_MODEL` and the recorded prices on 2026-09-15:

| Stage | Model | Worst case USD |
|---|---|---|
| read | claude-opus-5 | 0.1274 |
| research | claude-sonnet-4-6 | 0.0244 |
| select | claude-opus-5 | 0.0762 |
| write | claude-sonnet-5 | 0.0345 |
| rewrite | claude-sonnet-5 | 0.0385 |
| grade | claude-sonnet-4-6 | 0.0274 |
| **full pair** | | **0.3283** |

A worst-case full day for ONE lane is ten full pairs plus two read-only overshoots, **3.5376 USD**,
against a default per-lane per-run budget of 4.00 and a hard clamp of 6.00. **These numbers changed on
2026-09-15 and the earlier figures are dead.** The approved plan pinned the reader at `max_tokens`
2048, which gave 0.2772 per pair and 2.92 per day. The orchestrator raised it to 4096 on verified
evidence: on `claude-opus-5` an omitted `thinking` parameter runs ADAPTIVE thinking, which is on by
default on this model and was not on 4.8 or 4.7, and `max_tokens` caps thinking and text TOGETHER, so
2048 can be spent reasoning before the JSON closes. `budget_tokens` is a 400 on this model, so a
separate thinking ceiling is not available. The headroom against the default budget fell from 1.08 to
0.46 as a result, and the build REFUSES a configuration whose default budget cannot pay for its
default daily cap.

**The account-level ceiling is the real one.** This workflow runs on its own Anthropic credential,
`Anthropic account 3 (application writer, 36)`, in its own console workspace with a 20 USD monthly
spend limit. A third credential rather than a reuse, for three reasons: this workflow serves BOTH job
lanes and the two existing credentials are per lane, so neither was its natural owner; it carries the
expensive call in the whole job-search system against collectors that spend one cheap scoring call per
row; and the account is the only place Anthropic reports spend, so mixing them makes both "what does
the writer cost" and "which account got rate limited" unanswerable. The 2026-08-07 lesson on record is
that a 429 was actually a suspension, and knowing which account is spending shortens that diagnosis
from a day to a minute. The workspace limit also caps the blast radius of a bug that loops, which no
amount of code review does.

## Column contracts
Three of these are asserted before a cell is read, because every one of them is read BY POSITION and a
header that has moved means every field after it is wrong.

- **`jobs` (15 columns, shared, owned by #34 and #35, read-only here):** `job_id`, `found_at`,
  `source`, `title`, `company`, `location`, `remote`, `posted_at`, `url`, `apply_url`, `fit_score`,
  `fit_reasons`, `status`, `lane`, `excerpt`.
- **`applications` (13 columns, one row per application that EXISTS, shipped or held):** `job_id`,
  `applied_at`, `lane`, `company`, `title`, `url`, `channel`, `cv_ref`, `cover_letter_ref`, `status`,
  `last_contact_at`, `outcome`, `notes`.
- **`writer_runs` (12 columns, A to L, one row per lane per run):** `date`, `run_started_at`,
  `exec_id`, `lane`, `attempted`, `shipped`, `held`, `blocked`, `skipped_cap`, `errors`, `cost_usd`,
  `note`. `lane` holds the collector project number as a STRING, `"34"` or `"35"`.

Vocabularies: `applications.status` is `ready` or `needs_review` (reserved for a human: `sent`,
`interview`, `rejected`, `withdrawn`). `applications.channel` is `manual` or `none`.
`cv_ref` and `cover_letter_ref` are Drive file URLs. `jobs.status` gains `written` for a shipped pair.

Writes are `valueInputOption: RAW`, and every free-text cell ALSO has a leading formula character
stripped. Company, title, url and the whole cover letter come from outside this machine, and a
defence that depends on another node's option is not a defence.

**If `writer_runs` exists but its header DISAGREES with the declared twelve, the run row for that lane
is refused and the run goes RED.** A ledger row written into the wrong columns is worse than no ledger
row: the intake node reads `attempted` by position, so a shifted column silently gives tomorrow either
an unlimited day or no day at all. The applications rows and the status cells still go, because their
headers were asserted before a cell was read and because documents in Drive with no record anywhere is
the worse failure.

## The zero-code override
**Typing `new` back into a `jobs.status` cell re-queues that row for the next morning.** No rebuild, no
command, no session, works from the phone. The intake node admits a row only when its status cell reads
`new`, so every value this workflow writes is a value that is not `new`, and typing the word back is
the whole override. It is the reason `skipped:cap` rows can be safely left behind.

## Infrastructure, inline
Nothing below is an id. **Every spreadsheet id, Drive folder id and credential id lives in
`config/lane.json`, which is gitignored (`.gitignore:98`, `work/*/config/`) and rides the nightly
encrypted vault backup.** This repo is PUBLIC and that coverage is load-bearing.

- **n8n:** `https://n8n.shaheenkiarash.com/api/v1`, header `X-N8N-API-KEY`, key file
  `work/03-application-engine/config/n8n-api-key.txt` (gitignored, read at runtime, never inlined).
- **Workflow id:** **`Yyr8mKCxItFsgv5x`, created 2026-09-16, INACTIVE** (74 nodes, 73 connection
  sources, read back off the live box). ~~null, not created.~~ The manifest row was written the same
  session and the generator re-run, so both mechanical reasons below are satisfied rather than
  pending. A SECOND workflow belongs to this project from the same day, the letter eval
  `Job Application Writer - Letter Eval (36)`, built from `config/lane-letter-eval.json` and
  `nodes-eval/`, manual-only and deliberately NOT in the manifest: a manual harness with a manifest
  row would be a scheduled-looking claim nothing asserts, which is the call `lane-sync-settings.json`
  already made for #34.
  Superseded procedure, kept because it is still the rule for the NEXT lane: whatever creates it
  writes the id into `config/lane.json`
  AND into `system/manifest.json` as `n8n` for #36 in the SAME session, then re-runs
  `node scripts/generate-alex.js`. Both reasons are mechanical: V6 leg (c) has nothing to assert the
  declared cron against while `n8n` is null, and `scripts/lib/sync-n8n-voice.js` filters on
  `voice_sync === true && p.n8n`, so a row with `voice_sync: true` and a null id is silently not a
  voice target.
- **Credentials by NAME, reused, never recreated.** Google Sheets and Google Drive are the OAuth
  credentials the collectors and the staging workflow already use. Anthropic is
  `Anthropic account 3 (application writer, 36)`, created by Shaheen 2026-09-15 and read back off the
  live box by name rather than typed from a message. HQ is `Alex HQ Token (outgoing)` (httpHeaderAuth,
  header `X-Alex-Token`), created 2026-09-14, and it is deliberately NOT the incoming `Alex HQ Token`:
  n8n refuses a webhook-auth credential inside an HTTP Request node, which is how `Push HQ` failed
  silently in #34 executions 5182 and 5240 while the runs still reported success. Same header, same
  value, separate credential, **because a credential has a DIRECTION.**
- **Gotenberg:** `http://gotenberg:3000/forms/chromium/convert/html`, container `n8n-gotenberg-1`,
  image `gotenberg/gotenberg:8`, port 3000/tcp NOT published to the host. **Docker-internal only.**
  The hostname resolves from inside n8n and nowhere else, so a failed curl from this laptop proves
  nothing. `render.gotenberg_verified` is `false` in the lane file and the whole render path is
  UNPROVEN until a live call from the box returns a one-page PDF.
- **Shared error workflow:** the same one #34 and #35 use, by id in the lane file.
- **Node typeVersions on n8n 2.30.3:** `manualTrigger 1, scheduleTrigger 1.2, httpRequest 4.2, code 2,
  if 2.2, merge 3, convertToFile 1.1, extractFromFile 1, googleDrive 3`.
- **PUT body is `{name, nodes, connections, settings}`** and `settings` accepts only the documented
  allowlist. PUT can drop the active flag. Activation is `POST /workflows/{id}/activate` plus a GET
  verify, never a PUT.

## The graph conventions, and why the workflow is 74 nodes for 21 real steps
n8n does not run a node whose input carries no items, and `alwaysOutputData` does not change that: the
flag makes a node that RAN and produced nothing emit an empty item, and a node that never ran emits
nothing at all. So in a straight chain, a morning with nothing to fetch would skip the fetch, which
would skip the parse, which would end the branch and take every lane report and the intake report with
it. **A morning with nothing to do is exactly the run whose report matters most.**

So every HTTP call in this workflow sits between a Route (IF, `typeValidation: strict`) and a Results
(Merge v3, append). The false side of every Route carries every held, blocked, capped and errored pair
plus every lane report and stage report straight to the Merge, and the Merge runs as long as any one
input has items. That is fourteen Route/Results pairs, 14 IF nodes and 14 Merge nodes out of the 74,
and they are what make the run report, the sheet writes, the ledger row and the heartbeat
UNCONDITIONAL.

Two conventions that are not style:
- **`numberInputs`, not `numberOfInputs`.** n8n drops an unknown parameter on save without an error and
  leaves the real one at its default of 2. A node wired for three and spelling it the other way
  declares two and never reads the third. #34 execution 5154 lost 748 job rows and six source reports
  that way and reported success. Every Merge here declares its count explicitly even when the default
  would happen to be right.
- **`typeValidation: strict` everywhere, and every upstream node stamps the field the Route reads on
  EVERY item it emits, reports included.** Under strict validation a missing field is an ERROR rather
  than a false, which is wanted: it makes a contract violation loud instead of a silent reroute.

## Build tooling
- **`config/lane.json`** carries the lane number, the workflow name, the cron, the timezone, the
  credential ids, the render config, the caps, the score threshold and a `lanes` map with one entry
  per SOURCE lane (bi, ai). **It is shaped differently from #34's lane file and that is the point:**
  #34 and #35 are two workflows with ONE sheet each, so theirs carries a single `sheet` block. Reading
  this file and expecting the #34 shape is the mistake `nodes/_lane.js` is written to prevent.
- **`nodes/NN-name.js`**, one file per node, numbered in wiring order, 01 to 74. Tracked in git. Each
  one carries its full reasoning in a header comment and asserts its upstream neighbour by NAME at
  build time, because node names are the connection keys.
- **`nodes/_lane.js`, `_master.js`, `_stage2.js`, `_render.js`, `_write.js`** are the shared build-time
  helpers. The leading underscore keeps them out of the builder's node glob.
- **`config/test-*.js`**, seven offline suites, 740 checks. Every guard is shown REFUSING a synthetic
  violation before its pass is reported, per the Close-Out guard-class rule.
- **THE BUILDER IS SHARED WITH #34 AND #35, and there is no `config/build.js` in this folder.**
  `work/34-job-search-bi/config/build.js` drives this lane through `--lane`, exactly as it drives #35.
  Proven repeatedly, most recently on 2026-09-15:
  `node work/34-job-search-bi/config/build.js --lane work/36-job-application-writer/config/lane.json --dry --rebuild`
  returns `lane #36: no workflow_id yet, rebuilding means creating with all 74 node(s)`.
  The lane-shape difference does NOT prevent reuse, and the reason is worth stating because it is the
  thing that looks like it should: the builder reads only `work_dir`, `nodes_dir`, `cron`, `timezone`,
  `error_workflow`, `api_base`, `lane` and `workflow_id` from a lane file. The `lanes` map that makes
  #36's lane file different is consumed by the NODE files through `_lane.js`, never by the builder.
  Every seat in the relay ran `--dry --rebuild` through it, and seats 3 and 7 additionally proved the
  per-node `--add` sequence. A node header naming `config/build.js` means the shared builder invoked
  with this lane file, not a second copy that ought to exist here.
- Everything in `config/` is gitignored and therefore local-only by design.

## Vault Structure
- **Tier 1:** `vault/projects/job-application-writer/status.md` (state, open items, runs once there are
  any, the workflow id once it exists).
- **Tier 2:** `vault/projects/job-application-writer/runs/YYYY-MM-DD.md` for a run worth keeping, which
  is a run that shipped something or failed in a new way. An ordinary clean run is a status.md line.
- **Reference:** `PLAN.md` in this folder is the working spec and carries the decision record, the
  D10 amendment and the orchestrator carry-overs. `nodes/MASTER-BLOCKS.md` documents the block library.

## Connections
- **#34 Job Search BI and #35 Job Search AI** are the upstream. This workflow reads their `jobs` tabs
  and writes their `applications` tabs, their `jobs.status` cells and a new `writer_runs` tab in each.
  It never writes a job row and never edits the shared source contract. A change to their fifteen
  column row shape is a change to this lane's intake assertions in the same session.
- **#02 Morning Brief** is where a held pair reaches him as a waiting-on-you row and a brief line.
- **#16 Alex HQ** receives one `run_status` heartbeat per run plus shipped, held, errors and cost.
- **#23 Self-Review** owns the close-out grader rubric this lane's blind grade is baked from.
- **#03, #14, #31, #32** are the older application engines and are all PARKED. This lane does NOT read
  them, does not write to them and is not a clone of them. It is a separate function built on the
  collectors, and it exists partly because the older engines were parked for spending more than their
  output justified.

## Honest deviations from /new
- **No Notion database.** The output is a Drive folder plus two Google Sheets. The bootstrap protocol
  in the root constitution does not apply, so `/new` step 3 is skipped on purpose rather than owed.
- **`commands: []`, no slash command.** The lane is a scheduled n8n workflow with no local half to
  invoke. An empty command file would create a routing entry that does nothing.
- **No `schedule_jobs`.** Nothing runs on this machine. The cadence carries `scope: "n8n-engine"`,
  which tells recovery C16 to skip it and hands the assertion to V6 leg (c).

## Known limitations, in writing
- **It has never run.** Not on the box, not by hand, not as a drill. Every claim above about behaviour
  is a claim about code that has been read and tested offline, and offline tests cannot fail the way a
  live call can.
- ~~**The `writer_runs` tab does not exist in either spreadsheet.**~~ **CLOSED 2026-09-16.** Shaheen
  created both tabs. Verified by the orchestrator through the Google Drive MCP rather than taken on
  report: the header row in BOTH spreadsheets is an exact twelve-column match for
  `WRITER_RUNS_COLUMNS`, in order, compared cell by cell against the list read out of `_lane.js`.
  The reasoning below is kept because the RULE it explains is still the rule and is why the check
  is worth having at all.
- **The `writer_runs` tab used to be missing, and here is why that mattered.** Google fails a
  `values:batchGet`
  whose ranges name a missing sheet with a 400 for the WHOLE request, not a partial result, so until
  both tabs are created the first run refuses BOTH lanes by name with `error:writer_runs_missing`. That
  is correct rather than unfortunate: a daily cap that cannot count today is not a cap, and this lane
  spends real money unattended. Creating the two tabs is a human step and it is the single hardest
  blocker to the first run.
- **The render path is entirely unproven.** `gotenberg_verified` is false. Nobody has seen this
  workflow produce a PDF.
- ~~**`config/build.js` is not written**, so there is currently no path from the 74 node files to a
  workflow on the box.~~ **FALSE, corrected by the orchestrator 2026-09-15 before this page was
  committed.** The builder is shared and it works; see the Build tooling section above. The path from
  74 node files to a workflow on the box is one command and it has been dry-run clean by every seat.
  The claim was reasoned from the lane-shape difference rather than tested, which is the one thing a
  finding must never be. Kept struck rather than deleted because the correction is the useful part.
- **The manifest row does not exist**, so #36 is not enrolled in the voice sync, is not covered by V6
  leg (c), and is not watched by the daily 08:10 active-flag check. It cannot be added before this
  file exists (V12 needs the Trifecta line below) and before the workflow id exists.
- **The LinkedIn guest endpoints throttle datacenter IPs**, and the box is one. The ad fetch paces
  itself 1500 ms apart, never retries, and treats a 429, a 999 or an authwall as a REFUSAL that falls
  back to the row excerpt the collector already wrote. A failed fetch costs detail, never a pair. A
  pair with neither a fetched ad nor an excerpt is HELD, because an unattended writer with nothing but
  a job title would produce a generic letter.
- **Several node warning strings still say the Anthropic credential is PROVISIONAL and that
  human-action `anthropic-credential-36-writer` is open.** That prose is stale: the credential was
  resolved on 2026-09-15 and the action is not in the open queue. The behaviour is unaffected, because
  every node reads the id out of `config/lane.json`, but the message a failed run would print is wrong
  and should be swept.
- **`vault/research/trifecta-map.md` still claims coverage COMPLETE at 01 to 32.** It has no row for
  #33, #34, #35 or #36. The gate below is declared here and in the manifest, which is what V12 checks;
  the map is the narrative surface and it is four projects behind.
- **Seat 6 and seat 7 each listed further unproven items in their node headers.** Those lists live in
  the headers rather than being copied here, because a copy is a second thing to keep in step.

## Security
- **Every job ad is untrusted content.** It is attacker-controllable text written by a stranger,
  fetched from the open internet by an unattended workflow that is about to write a document in his
  name. It is DATA, never instructions.
  - The reader's system block states the rule before the ad is ever shown, and asks the model to
    REPORT an injection attempt rather than resist it quietly, because a posting that tries to steer
    the writer is worth a human look at the company. `injection_detected` routes the pair to
    `needs_review`.
  - **The defence is not the prompt.** The reader returns a CLOSED JSON schema of facts and nothing
    executable. **The raw posting never reaches the writer model at all**: the writer gets the
    structured brief plus two verbatim spans that were PROVED to be substrings of text this run
    actually fetched. The CV is assembled from ids. The employer page gets the same treatment, and a
    page that tries to inject has every string it produced dropped while its pair carries on.
- **The ad url is guarded before it is fetched**, because the fetch happens from inside the docker
  network where Gotenberg, the n8n API and every other container are reachable by name. HTTPS only, no
  credentials in the url, no port other than 443, no IP literal, no private range, no single-label host
  (which is what a docker service name looks like), no `.internal` or `.local` suffix. A url that fails
  the guard is not an error: the pair simply gets no fetch and falls back to the row excerpt.
- **No credential value is ever written into a node.** n8n credentials are referenced by id, and the
  ids live only in the gitignored lane file.
- **Nothing about his person is hardcoded into a tracked node file.** The masters, the voice block, the
  work-authorization line, the employer name, the availability wording and the approved figures are all
  read at build time from the vault or from soul.md and land in the generated code that goes to the
  box. A rubric that hardcoded his nationality would put it in a public repo to save one regex.
- **The lane has no outbound channel to a third party.** It writes a Drive folder Shaheen owns and two
  spreadsheets Shaheen owns, and pushes a heartbeat to his own dashboard. It sends no mail, submits no
  form, and opens no browser.

## Trifecta
Gate: **draft-only**. Legs: private_data=true, untrusted_content=true, external_comm=false.

private_data is true because this lane reads both frozen CV masters, the soul corpus and his approved
figures, and writes documents carrying his name, his phone number and his citizenship. That is the
most private material any automation here touches.

untrusted_content is true because a job ad is attacker-controllable text fed to a model, and this lane
fetches it live from eight sources. It also fetches an employer's own website. Both are handled as data
and both are named in the Security section above.

external_comm is false because every write goes to a surface Shaheen owns: his Drive, his two
spreadsheets, his dashboard. Nothing leaves under Alex's own hand and there is no send node anywhere
in the graph.

The gate is `draft-only` rather than `read-only` because the whole purpose of this lane is to produce
material a human then acts on, and the act of submitting is his. **The declared gate flipping to
anything else without the legs changing would be the tell that the lane grew an exit.** Source of
truth: the `trifecta` block in `system/manifest.json` plus [[research/trifecta-map]]. Validator V12
fails the build if this line stops matching the manifest.

## Close-Out Extras
Beyond the universal list:

- **(a) The `writer_runs` ledger row, per lane, every run.** Twelve columns: date, run start, execution
  id, lane, attempted, shipped, held, blocked, skipped on cap, errors, cost, note. A lane that was
  refused outright still gets a row saying so. **The ledger is the only place a held, blocked or capped
  job is visible after the run**, so a run with nowhere to write it is a run nobody can audit, and a
  close-out on a run that could not write its ledger row records that as FAILED rather than N/A.
- **(b) Every write read back, in the same run, with no exemption except the heartbeat.** Drive uploads
  are read back and compared by md5; sheet writes are read back cell by cell over the exact ranges
  written. "It returned 200" is the request talking about itself. The ONE named exemption is the HQ
  `run_status` heartbeat, per the root constitution, and even that has its status code read back and
  reported so the wrong-credential-direction failure is visible without colouring the run.
- **(c) The colour rules, so a red means something.** RED when the run cannot account for what it did:
  an unverifiable sheet write, documents in Drive that could not be read back, or a lane refused
  outright. AMBER for anything else that failed. GREEN otherwise, **including a morning that shipped
  nothing at all**, because both lanes capped out or every letter held by the blind grade is the system
  working, and colouring that amber would make amber the normal state of the tile. **A hold is never
  amber.**
- **(d) The cost, real and estimated, side by side.** The intake guard refuses work on a pessimistic
  estimate and every parse node appends its actual usage, so both numbers are reported. The gap between
  them is the only way to see whether the guard is too tight.
- **(e) Any deliverable that reached `outputs/` gets its ledger row**, and a CV or cover letter is an
  IDENTITY-carrying deliverable, so its row needs `--grader PASS|FAIL|SKIPPED`. Note that this lane's
  own blind grade is a runtime stage and is NOT the close-out grader: the close-out grader is a fresh
  subagent reading `work/23-self-review/close-out-grader/rubric.md`, and this lane bakes that same
  rubric into a model call. They share a rubric; they are not the same check.
- **(f) A run that discovered a live fact (a changed column, a renamed tab, a source that started
  refusing the box) updates this spec and the status page in the SAME session.** A discovery that lives
  only in a run report is a discovery that gets re-made.

## Status
**BUILT OFFLINE, NEVER FIRED, NOT ON THE BOX (2026-09-15).**

74 node files exist under `nodes/`. Seven offline suites pass: 95 master-block checks, 53 prose-scan
checks, and 97, 135, 139, 112 and 109 across stages 1 to 5, **740 in total**, with every guard shown
refusing a synthetic violation before its pass was reported. Seats 2, 3, 4, 5, 6, 6b and 7 are closed.

What does NOT exist, stated plainly so nobody reads the above as a working lane. **Two entries were
struck on 2026-09-16 within the hour, and they are kept struck rather than deleted because this list
sat two screens below the corrections and still contradicted them, which is how a spec ends up
arguing with itself:**
- ~~the workflow on the box (`workflow_id` is null in the lane file)~~ **FALSE since 2026-09-16, later
  the same day.** Shaheen ran the create; `Yyr8mKCxItFsgv5x` exists with 74 nodes, INACTIVE, and the
  lane file carries the id. The line above was true when written that morning and false by the
  afternoon, which is the ordinary way a doc that asserts a live fact goes wrong.
- ~~`config/build.js`, the assembler that would put it there~~ **FALSE. The builder is SHARED with #34
  and #35 and it drives this lane through `--lane`. See the Build tooling section above.**
- ~~the `writer_runs` tab in either spreadsheet~~ **FALSE since 2026-09-16. Both tabs exist and both
  headers were verified cell by cell against `WRITER_RUNS_COLUMNS` through the Drive MCP.**
- the `#36` row in `system/manifest.json`
- any live Gotenberg call, so the render path is unmeasured
- the letter-eval regression workflow and the first-fire drill at cap 2, which are seat 8. The node
  CENSUS has been taken offline (74 nodes: 25 code, 14 httpRequest, 14 IF, 14 Merge, 2 convertToFile,
  1 extractFromFile, 2 googleDrive, 2 triggers; all 14 Merges declare `numberInputs`; exactly one node
  retries and it is Render PDF; exactly one node is named `Build Writer Request` and it is the same one
  that carries the voice block; one terminal node, Assert Run; no duplicate names). Seat 8 still owns
  the census AGAINST THE LIVE WORKFLOW, which is a different claim from the census against the files.

**Seat 8 has not run.** It owns the regression eval (a verbatim copy of the live prose node, six
seeded cases, and it has to be 6/6), the node census, the first-fire drill at cap 2 on one lane, and
then activation and the DORMANT to LIVE flip. Nothing above is proven live until it does.

The Drive parents exist and were read back on 2026-09-14: a `Job Application Writer` parent in My Drive
root holding one child folder per lane. The existing `Job Applications` folder from 2026-05-31 is
deliberately NOT reused, because writing this lane's folder shape into it would mix two conventions in
one place so that nobody could later tell which folders this workflow made.


## 2026-09-17: nine applications columns, an eleven-column jobs tab, and NO md files (Shaheen)

Three changes, one instruction: *"I want to exclude some output to save some tokens and I really
think it does not add any value."*

**1. The `applications` tab is NINE columns**, down from thirteen. Gone: `lane` (each lane owns its
own spreadsheet), `last_contact_at` and `outcome` (both always written EMPTY here, his own columns to
fill by hand) and `notes`. **`notes` is the one that cost something.** It carried the HELD reason
and, for a held pair, the whole cover letter, which is what made a `needs_review` row readable on a
phone without opening anything (out-of-the-box item 3). What survives is the status token itself, so
the refusal is still visible; the per-application WHY now lives only in that run's `writer_runs`
note and in the execution. A held pair still gets a row, on the same condition as before: which rows
EXIST was not what changed.

**2. The `jobs` tab this workflow READS is eleven columns**, and that is a harder dependency than it
looks, because this workflow reads that tab BY POSITION:
- `status` moved from column **M to K**, and node 66 writes an ADDRESSED CELL at that letter. A stale
  letter would have stamped `written` onto `fit_score`. Both the assertion and the value moved.
- the jobs range in node 03 is now `A:K`, not the approved plan's `A:O`. That guard fired during the
  build and refused to decide quietly, which is exactly what it is for.
- `apply_url`, `fit_reasons` and `excerpt` are no longer columns. They are declared in the
  contract's new `internal_only_fields` and node 05 still reads `apply_url` and `excerpt` off the
  row, so `_lane.js` now asserts they exist as column-or-internal rather than as columns.
- **`excerpt` was this workflow's advert FALLBACK** when a live fetch is refused (authwall, 429, bot
  check). It is now always empty, so a refused fetch produces a HELD pair rather than a thin one.
  Measured on the 2026-09-17 run before the change: 7 of 7 pairs fetched live, none used the
  fallback, so the practical cost today is zero and the failure mode is worth knowing anyway.

**3. A job folder is TWO files, both PDFs.** `README.md` and `job-ad.md` are not built, not
converted, not uploaded and not verified. His words: *"delete when the n8n print the cv and the cover
letter should not produce any md file."*

What that removed, stated plainly because it was load-bearing and is not coming back by accident:
- **`README.md` was the audit record** (D12, D15) that made an unattended application reviewable six
  weeks later: which CV blocks were selected and why, the ONE bridge sentence that is not his own
  writing named as such, the screening objections and what answered them, the employer hook or the
  plain fact that there was none, both audit verdicts, the blind grade with its five criteria, and
  what the pair cost. Nobody watched the run; the README was the answer to "why did it say that".
  That answer now lives only in the n8n execution, which ages out.
- **`job-ad.md` was the posting saved verbatim**, inside a fence, under an untrusted-input header,
  for the day the posting disappears. A folder whose CV is tailored to an advert nobody can read any
  more is a folder that cannot be reviewed.
- Recover both from git rather than rebuilding them from memory: roughly 280 lines of prose assembly
  in `nodes/44-build-documents.js`, and the reasoning that shaped them is still in notes 3 and 4 of
  that file's header.

**The three nodes that went with them.** `FILE_KINDS` is the single declaration everything derives
from and it is now `['cv', 'letter']`, so `needs_convert` was always false and the convert-and-rejoin
trio had nothing to do: **56 Convert Route, 57 Text to File and 58 Files Ready are DELETED** and
Upload Route hangs off Attach Folder Ids directly. 75 nodes down to 72. Two knock-ons worth naming:
- Upload File asserted that Text to File wrote utf8, because the md5 the read-back compared against
  was computed over the UTF-8 bytes of a STRING. Every file is now PDF bytes whose digest was taken
  over the bytes themselves by Check Renders, so there is no encoding left to get wrong.
- Check Uploads DERIVED the sent order from Attach Folder Ids because Text to File might have
  replaced the item json, a behaviour nobody could measure offline. The derivation is kept, and it is
  now a second independent count of the same stream rather than a fallback, with a new assertion that
  nothing sits between Attach Folder Ids and Upload Route (a node inserted there could reorder the
  stream and attribute a PDF to the wrong application with every digest still matching).

**U3 counts two files per folder now**, and the message reads the contract rather than saying "four".

**The live sheets moved in the same session**: `scripts/trim-job-sheets-2026-09-17.js`, snapshot in
`~/alex-sheet-snapshots/2026-09-17-job-sheets/`, every header read back afterwards. The full
reasoning for the collector side is in `work/34-job-search-bi/CLAUDE.md` under the same heading.
