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

**Every surviving row carries `_filter.scope` and `_filter.work_type_rule`**, so #36 branches on the
scope the collector already decided rather than re-deriving geography from a location string. Two
components deriving the same fact from the same raw text is how they drift.

**Also swept, per the same amendment:** any plan text describing the pipeline as "remote outside
Sweden" is now false; any step reading `remote` as a boolean must not treat falsy as onsite, because
null and false are different and the collector preserves that distinction deliberately; and any
scoring or ranking step that penalises onsite would now be penalising exactly what he asked to see.
