# #36 Job Application Writer - the working spec

## Provenance, read this first

The approved plan was written in plan mode on 2026-09-14 and captured verbatim in
`outputs/typed/transcripts/2026-09-14.md` line 74. **That capture ends mid-table at runtime node 61
("Upload Results"), which is where the plan-mode display truncated it.** Everything up to node 61 is
Shaheen-approved text and is the authority. Three things the plan REFERENCES but whose text was cut:

1. Runtime nodes 62 onward (the write-back half: upload verify, sheet writes, run row, HQ, assert).
2. The nine-seat roster table (seat title, Delivers, Proves-it-by) the seat-brief template fills from.
3. The Verification section enumerating `A1-A16` (audit), `R1-R6` (render), `A18`, `A8`.

**Sections marked RECONSTRUCTED below are mine, derived from the plan's own references, not his
approved text.** They are execution detail the executor block already assigns to the orchestrator
("Make routine judgment calls yourself"). No decision D1-D20 is affected: all twenty survived the
truncation, as did the approach paragraph, the eight out-of-the-box items, the node conventions, the
nine named design defects, the transport conventions and the model pins.

---

## RECONSTRUCTED: the nine-seat roster

One agent at a time. The orchestrator runs every live mutation (n8n PUT, sheet write, Drive create,
manifest edit, generator run), reads the seat's proof, then opens the next seat.

| # | Seat | Delivers | Proves it by |
|---|---|---|---|
| 1 | Collector engineer (n8n, 12y) | UK remote target in the shared source contract (D17); `work/36-job-application-writer/config/lane.json`; the `#36` manifest row (state DORMANT, `voice_sync: true`, `n8n_cron`, trifecta block, `first_fire: null`); the Drive parent folder id for each lane | A geoId probe whose evidence sits in `sources.json` (a guessed geoId returns the wrong place and looks perfectly healthy); one manual run of EACH collector writing a `runs` row that names the UK target; `node scripts/generate-alex.js` green |
| 2 | CV systems engineer (10y) | `nodes/_master.js`: both masters parsed into addressable blocks with content-hash ids (`exp.r1.b03@a1f9c2d0`); `scripts/prose-scan.js` (dash, tells, band, pronouns, banned claims) as a zero-token CLI; the fixture set pinning current ids | Block text round-trips byte-identical to the master mirror; an authorised-amendment simulation changes the ids and fails the fixtures loudly; `prose-scan.js` shown FAILING on a synthetic violation per check before any pass is reported |
| 3 | Pipeline engineer (n8n, 12y) | Nodes 01-14: seed lanes, read sheets, build candidates (caps, D10/D11 gates), ad fetch, the recruiter-seat reader, parse brief | `build.js --dry` clean for each; `assertCodeParses` green; the cap arithmetic and the D10 blocks unit-tested offline against fixture rows |
| 4 | Pipeline engineer (n8n, 12y) | Nodes 15-28: research plan, company fetch, parse research (substring + host proof), select request, assemble CV | Hook substring proof shown REJECTING an invented quote; assembler shown refusing a bad block id and refusing over-ceiling after every drop |
| 5 | Prose systems engineer (10y) | Nodes 29-43: Build Writer Request (THE one prose node), write, parse, audit, rewrite, audit final, grade | `sync-n8n-voice.js extractLiveBlock` parses the node's SYSTEM literal; exactly ONE node in the workflow is named `Build Writer Request`; audit shown failing a seeded dash and a seeded AI tell |
| 6 | Render engineer (10y) | Nodes 44-51: build documents, Gotenberg render, extract text, measure, check renders (R1-R6) | A live Gotenberg call from the box producing a one-page PDF; the round trip shown catching a seeded missing ATS term and a seeded two-page overflow |
| 7 | Integration engineer (10y) | Nodes 52-74: Drive folder, uploads, md5 read-back, sheet writes per lane via `values:batchUpdate`, applications row, `jobs.status`, `writer_runs`, HQ push, assert | One real folder created and read back by md5; sheet writes read back cell by cell; a seeded md5 mismatch shown failing the run |
| 8 | Release engineer (10y) | The letter-eval regression workflow (verbatim copy of the live prose node, 6 seeded cases, 6/6); the census; the first-fire drill at cap 2 on one lane; activation and DORMANT -> LIVE | 6/6 on the eval; the drill's folder, PDFs and sheet rows inspected by hand; `POST /activate` plus a GET verify; `n8n-active-check.mjs` reporting the lane correctly |
| 9 | Technical writer (10y) | `work/36-job-application-writer/CLAUDE.md` (with `## Trifecta` and `## Close-Out Extras`); `docs/n8n/36-job-application-writer/`; `docs/projects/36-*.md`; `vault/projects/job-application-writer/status.md`; index plus log; the plain-English guide row and the ALEX-OS-master row | V12 passes on the trifecta declaration; V15 on the command header; `node scripts/stale-status-check.js` clean; the generator green |

A seat that cannot prove its work reports what blocked it. The orchestrator does not open the next
seat over an unproven one.

---

## RECONSTRUCTED: runtime nodes 62-74 (the write-back half)

Same conventions as 01-61: every HTTP call sits between a Route (IF, strict, `_call_now` present on
every item) and a Results (Merge); every Code node passes a dead pair through unchanged.

| # | Node | Type (tv) | What it does |
|---|---|---|---|
| 62 | Verify Route | if 2.2 | `_kind === 'file' && file_id` |
| 63 | Verify Upload | httpRequest 4.2 | `GET drive/v3/files/{id}?alt=media`, `nodeCredentialType: googleDriveOAuth2Api`, binary response. The staging workflow's proven read-back shape |
| 64 | Verify Results | merge 3 | |
| 65 | Check Uploads | code 2 | md5 of the downloaded bytes against the md5 computed at build. **U1** every shipped file read back, **U2** md5 equal, **U3** four files present per shipped pair. A mismatch is `error:drive` for that pair: the folder is left in place and nothing is written to the sheet |
| 66 | Build Sheet Writes | code 2 | Per LANE, never per pair: the `applications` append rows, the `jobs!status` cell updates by A1 range, the `writer_runs` append row. Emits ONE item per lane carrying a `values:batchUpdate` body. **The Sheets node is NOT used**: it resolves `documentId` at item 0 for the whole batch, so two spreadsheets in one workflow need REST |
| 67 | Sheet Write Route | if 2.2 | `_kind === 'sheet_write'` |
| 68 | Write Sheets | httpRequest 4.2 | `POST .../values:batchUpdate`, `googleSheetsOAuth2Api`, one call per lane |
| 69 | Sheet Write Results | merge 3 | |
| 70 | Read Back Sheets | httpRequest 4.2 | `GET values:batchGet` over the exact ranges just written |
| 71 | Check Sheet Writes | code 2 | Cell by cell: every applications row present with its `job_id`, every `jobs.status` cell equal to what was sent, the `writer_runs` row present. A mismatch makes the run report RED and name the cell |
| 72 | Build Run Report | code 2 | Counts by outcome (shipped, held, blocked, skipped:cap, error:*), cost per pair and total, the per-stage reports collected through the run |
| 73 | Push HQ | httpRequest 4.2 | `run_status` heartbeat on credential `XXcugYBfR0JUXGGQ` (httpHeaderAuth, header `X-Alex-Token`). The ONE named exemption from Verify-after-write |
| 74 | Assert Run | code 2 | Throws if any shipped pair lacks a verified upload or a verified sheet row. A run that cannot prove its writes is a FAILED run, not a quiet one |

---

## RECONSTRUCTED: the check lists

### A1-A18, the deterministic pair audit (nodes 34 and 38, one shared template)

Run on `cv_text` and `letter_text`. A CV failure is never rewritten: the CV is verbatim master by
construction, so a CV failure means the ASSEMBLER is wrong, and it goes straight to `needs_review`.
A letter-only failure gets ONE reasoned rewrite with the failed checks named as a second user turn.

| id | Check | Scope |
|---|---|---|
| A1 | Zero U+2013 and zero U+2014 | both |
| A2 | Zero AI tells from the reconciled TELLS list | letter |
| A3 | Word count in 100..280 | letter |
| A4 | Skeleton present: greeting, role line, nationality opener, three beats, the honest gap, availability, bare signature | letter |
| A5 | No `he/him/his/she/her/hers/himself/herself` anywhere | both |
| A6 | No `TypeScript` and no `JavaScript` | both |
| A7 | No `bureau` used for UC | both |
| A8 | Every number in the letter appears in the approved-numbers list or in `site_text` | letter |
| A9 | No mention of the job-application pipelines, roles-processed counts, or the voice project | both |
| A10 | No `vector`, `embedding`, `vector RAG` | both |
| A11 | Work-authorization line is exactly `Work authorization: Swedish citizen (EU citizen)` | CV |
| A12 | No claim of UK or US right to work | letter |
| A13 | `para_chars <= 3760` | CV |
| A14 | Every CV block id resolves and the mandatory set is present | CV |
| A15 | `quote_line`, when present, is a substring of `ad_text` | letter |
| A16 | `voice_block_present === true` (fail-closed) | letter |
| A17 | Filenames are exactly `Shaheen_Kiarash_CV.pdf` and `Shaheen_Kiarash_Cover_Letter.pdf` | both |
| A18 | The `<<<SCREEN>>>` note names a paragraph for each of the three objections | letter |

### R1-R6, the render check (node 51)

| id | Check |
|---|---|
| R1 | Both PDFs rendered, non-zero bytes |
| R2 | CV page count is exactly 1 (D13, hard refuse) |
| R3 | Letter page count is 1 |
| R4 | Extracted text parses and contains `Shaheen Kiarash` |
| R5 | The ad's key ATS terms appear in the extracted CV text (D7, the round trip) |
| R6 | Zero dashes survive in the extracted text of both |

Page count is asserted TWO ways, the `/Type /Page` regex over the bytes and `extractFromFile`'s own
`numpages`, because the render safety law forbids trusting the text layer alone: clipped text still
extracts.

---

## AMENDMENT: D10 is superseded (2026-09-15, Shaheen)

**The approved D10 read:** "Red flags that BLOCK auto-generation: onsite only (outside Sweden) and
Swedish fluent required. Not contract or freelance, not seniority below his level: those still get
written."

**His instruction that changes it**, in two messages on 2026-09-14 night:
*"Make it like this Sweden and EMEA (hybrid, onsite, remote), Euorope and UK ( remote only)"*, then,
asked which EMEA markets he actually wanted searched, *"the gulf and non EU europe, and stop dropping
them"*.

**D10, replacement text. Work type is a scope question, not a global block.** A job is blocked for
work type only where the collecting scope is remote only AND the row is demonstrably not remote.
Remote EU and Remote UK are the two remote-only scopes: he has no UK right to work, so an onsite
London role can never become an application. Sweden, the Gulf (United Arab Emirates, Qatar, Saudi
Arabia) and non-EU Europe (Switzerland, Norway) accept onsite, hybrid and remote alike, on his
2026-09-14 instruction and on his 2026-06-16 sourcing config before it. So an onsite role in Dubai,
Doha, Riyadh, Zurich or Oslo is a CV worth writing and must NOT be blocked. **Where the work type is
unstated, write the CV.** Most sources in this pipeline cannot state it at all, LinkedIn only infers
it from the request, and the two newest scopes send no work-type filter by design, so every row they
deliver arrives with work type null. Treating null as onsite would silently block the entire Gulf and
non-EU Europe intake while every count upstream looked healthy. The Swedish-fluent-required block is
unchanged. Contract, freelance and below-his-level seniority still get written, unchanged.

**The collector already enforces the scope rule**, so by the time a row reaches the applications
queue it should already comply. D10 in #36 is therefore belt-and-braces rather than the primary gate,
and a row arriving that violates its own scope rule is a signal the collector is wrong, which the
run report should say rather than silently absorb.

~~**Every surviving row carries `_filter.scope` and `_filter.work_type_rule`**, so #36 branches on the
scope the collector already decided rather than re-deriving geography from a location string.~~

**CORRECTED 2026-09-15, and this sentence was WRONG when it was written.** Seat 3 found it while
building node 05. Those two fields exist INSIDE the collector workflow and never leave it: the jobs
TAB is fifteen columns (`shared_row_shape`) and not one of them is scope. By the time a row reaches
#36 the collector's decision has been dropped on the floor, so there was nothing to branch on. The
principle the sentence states is still right, which is why it is struck rather than deleted: two
components deriving the same fact from the same raw text is how they drift.

**What seat 3 built instead, and why it is the honest second-best.** `Build Candidates` recovers the
scope from the `location` cell using the collector's OWN `GEO_TARGETS` and `GEO_PRECEDENCE`, read out
of `20-filter.js` at build time rather than restated, and stamps `scope_source:
'recovered_from_location'` so no verdict downstream can be mistaken for the collector's own. Only the
MATCHER is local; the tables are the collector's. That keeps the drift surface to one function instead
of two rule sets.

**The real fix is a SIXTEENTH COLUMN on the jobs tab**, carrying the scope the collector decided. It is
not done because it moves both collectors, both sheet headers, every guard that asserts fifteen
columns, and it needs a human step in the middle to widen the live tabs. It is the right change and it
is deferred deliberately, not overlooked.

**Also swept, per the same amendment:** any plan text describing the pipeline as "remote outside
Sweden" is now false; any step reading `remote` as a boolean must not treat falsy as onsite, because
null and false are different and the collector preserves that distinction deliberately; and any
scoring or ranking step that penalises onsite would now be penalising exactly what he asked to see.


---

## ORCHESTRATOR CARRY-OVERS (open, tracked here so no seat has to remember them)

**1. The manifest row, and the voice-sync enrolment that hangs off it.** `system/manifest.json` has no
`#36` row, so #36 is NOT enrolled in the voice sync: `scripts/lib/sync-n8n-voice.js` filters on
`voice_sync === true && p.n8n`, and a project with neither is silently not a target. Seat 5 found this.
It is NOT urgent and it is NOT a defect today, because seat 5 bakes the voice block at BUILD time from
soul.md, so a `--rebuild` carries a current block by construction and the later sync sees an identical
stable part and no-ops. What it means is that the block will never REFRESH on its own until the row
exists.

The row cannot simply be added now, and the ordering is the reason: V12 requires a `## Trifecta`
heading with `Gate: **draft-only**` in `work/36-*/CLAUDE.md`, and that file is seat 9's deliverable; and
the `n8n` id is null until seat 8 creates the workflow on the box. Adding the row early would fail the
generator. So: **seat 8 writes the id, seat 9 writes the CLAUDE.md, and the orchestrator adds the
manifest row and runs the generator after both**, which is also when V6 leg (c) and the 08:10 active
watcher start covering this lane.

**2. `work/23-self-review/close-out-grader/rubric.md` carries an en dash.** Seat 5 refused to bake it
verbatim and rendered each occurrence as an escape with the prompt saying so, which is right, and it
did NOT edit the rubric. The occurrences sit inside PV1 examples illustrating a dash carve-out that
Shaheen REVERSED on 2026-08-20 ("you have use this in both versions PDF and Word, you already have
this role, NEVER AGAIN use it"). `scripts/lib/voice-rules.js` already follows the reversal, so the
rubric is the stale surface. It is a /self-review item, not a #36 item, and it is queued as one.

**3. soul.md grew about 3KB mid-seat.** That was the orchestrator harvesting a My Words entry on
2026-09-15, not drift. Worth stating because node 29's `jsCode` changes with the corpus BY DESIGN, so
two builds either side of a harvest are legitimately different bytes.


**4. A cheap speed-up nobody has taken yet, recorded rather than done.** `config/test-stage-4.js` is
the slow suite: it re-runs the real pipeline from node 03 to node 43 for every case rather than using
fixtures, then shells out to headless Chromium four times and to PyMuPDF. One run is minutes, and
stages 3, 4 and 5 back to back is three full pipelines.

Seat 6 offered to put the Chromium section behind a flag so the default run is seconds and the real
render measurement happens only when asked for. That is worth doing and it is NOT done, deliberately,
for two reasons. The Chromium leg is the only thing in the whole suite that touches a real renderer,
and it has already earned its place twice: it proved the brand's 11pt scale takes two pages, which
turned the type scale from a guess into a measurement, and it proved the byte-level page-count regex
works on real Skia output. A flag that defaults to skipping it is one session away from being a flag
nobody ever sets.

So the shape to build, when someone builds it: the render leg runs by DEFAULT in any run that touches
`_render.js` or a node between 44 and 51, and is skippable only by an explicit flag whose absence is
reported in the summary line. Fast by default is the wrong default here; fast when nothing rendered
changed is the right one.


**5. A test that only passes on the day it was written, found when the date rolled.** On 2026-09-16
`test-stage-4.js` went red with nothing changed: an assertion carried the literal `2026-09-15` and
compared it against a folder name built from the run date. The folder name was correct. The proof was
not. It now reads the date off the pair.

**The class is worth naming because the suites are full of the ingredient.** Every stage file carries
fixture rows dated `2026-09-15` in `found_at` and `posted_at`, and that is CORRECT: a fixture wants a
fixed date so the run is deterministic. The defect is not a date in a fixture, it is a fixed date on
one side of a comparison whose other side moves. All five stage files were scanned for that shape on
2026-09-16 and only the one case existed.

Why it matters more than it looks: a suite that goes red for a reason unrelated to what it claims to
check teaches the next reader to skim past that line, and the line after it, and eventually the
suite. A red that is not a defect is more expensive than no test, and this repo already has the
lesson written the other way round in the eval file: "a red that is not a defect is worse than no
test, because people learn to scroll past it."


**6. Divergence D2 is CLOSED, and closing it needed a case redesign as well as a port (2026-09-16).**
The previous seat measured it and correctly declined to fix it alone. The lane's A8 allowed a figure
in the letter out of FOUR places (his approved list, the verified quote line, the research hook, and,
since that morning, the fetched employer page and the posting itself). The letter eval's `numbers`
check allowed it out of TWO. So a figure the lane deliberately permits came back red in the eval, and
the identical gap produces a false GREEN the moment the two lists differ the other way.

What was done, in three parts, because a port alone would have been worse than the bug:

- **The source list is DATA now.** `numberSources()` and `numberAllowlist()` are hoisted to column
  zero in node 34 and LIFTED by the eval, the same move `sentenceBounds` and `negatedAround` got for
  the claim rule that morning. A8 and A15 share ONE call to it, which is asserted at build time,
  because "which employer text does this pair hold" is one question and it had two hand-built answers.
  Node 38 lifts both by name alongside `auditPair`, or the final pass throws on the first figure.
- **The eval SEEDS the sources.** Each case now carries `ad_text` and `site_text`, assembled from the
  employer material the case already holds (must haves, nice to haves, ATS terms, objections and their
  evidence, the verified span). Assembled rather than written, so a case can never turn on a number
  nobody can find by reading it; and `research.hook.why` is deliberately excluded because that is OUR
  reasoning, not the employer's prose, and site_text licenses figures. `_eval.js` now READS node 34's
  own function source for the field paths it mentions and refuses to build if any case leaves one
  empty, because an unfed source is a shorter allowlist wearing a clean bill of health. **The prompt
  is untouched by all of this:** node 29 never reads either field, and the eval's HTTP node sends
  `$json.write_request` only, so not one extra byte reaches Anthropic.
- **C6 was REDESIGNED, not ported into.** It asserted that the employer's own figures must NOT appear
  in the letter. The lane stopped having that rule that morning, on purpose: the skeleton REQUIRES
  beat three to quote the employer, and failing a letter for a number inside a sentence it was told to
  reproduce is a check arguing with the brief. Porting `ad_text` in without touching the case would
  have made C6 un-failable, which kills a case instead of fixing it. So the employer figures stay and
  are now legitimately quotable, and the bait moved to the danger that is still real: three objections
  that each demand a figure about HIM (a share of an estate migrated, a cost saved, a headcount
  managed) where nothing on his approved list and nothing in the employer material supplies one. The
  id and the `primary` are unchanged so the summary line stays comparable across runs; the `seeds` and
  `pass_means` prose was rewritten to say what it tests now and why it changed.

**The limit that is left, stated rather than papered over.** A8 is token scoped: it asks where a
number came from, never who it is attached to. A letter that borrows an employer figure and pins it to
him passes both paths. That is a property of the LANE rule, and the eval must not invent a stricter
one the box does not run, so it is named in C6's `pass_means` and it is the obvious next A8 amendment
if anyone wants it.

**And an observation for whoever re-pins.** Running `test-letter-eval.js` needs the pin swapped for
the repo's current node-29 sha, because node 29 was amended (the pronoun rule) after the pin was
captured and the whole `nodes-eval/` tree is pin-gated. That was done inside a try/finally and the pin
file was restored byte for byte, verified by sha256 and by `git status`. Worth knowing: the repo-side
node-29 jsCode measured 29,878 chars early in that session and 29,841 later, with node 29 and every
file in its require graph untouched on disk (traced: it never reads node 34, so the A8 work cannot be
the cause). Either the voice block is built from something that moves, or one of the two readings was
taken against a tree mid-write. Until that is explained, treat the pin as a value that can drift
without anybody editing a node, which is exactly the situation the pin exists to make visible.
