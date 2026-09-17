# The CV master block library

What `nodes/_master.js` does, why the ids look the way they do, and the exact procedure when
Shaheen authorises an amendment to a master.

Read this before changing anything in `_master.js`, and read the last section before you run
`test-master-blocks.js --write`.

---

## 1. The idea in one paragraph

Shaheen's AI CV master is FROZEN. His words, 2026-08-19: *"Do not change anything (not a word or a
color or a font) Exact as it is."* Tailoring means SELECT, REORDER and keyword-mirror his sentences,
never rewrite them. The retired engines enforced that by asking a model nicely and checking the
output afterwards, which is a filter, and a filter has a false-negative rate. This lane enforces it
by construction: the masters are parsed at build time into addressable blocks with content-hash ids,
the selector model is shown those blocks and emits only a list of ids and an order, and the
assembler emits only strings that came out of the master. There is no path by which a rewritten
sentence reaches the CV, because the model never gets to write one.

A model that hallucinates a better bullet produces an id that does not resolve, and an id that does
not resolve is a refusal, not a paragraph.

---

## 2. The id

```
exp.r2.b04@a1f9c2d0
^   ^  ^   ^
|   |  |   sha256 of the block's printable text, first 8 hex
|   |  sequence inside the group, document order, 1-based, zero padded
|   group: rN for the Nth H3 inside the section, x when the block sits directly under the H2
section: hdr sum exp proj skl ind cert edu lang
```

**The hash is the point.** A positional id alone would survive an edit to the sentence it names,
which is the failure worth designing against: a CV that looks right, carries an id that resolves,
and quotes a sentence Shaheen corrected three weeks ago. With the hash in the id, an amendment
changes every affected id, so anything pinning an old one fails loudly.

**The components are positional, never a slug of the employer or the job title.** Ids travel: into a
model prompt, into an n8n node parameter on a rented box, into a sheet cell, into a log line. A
positional id leaks nothing about where he has worked. The text is what the selector needs, and the
text goes deliberately and only to the model that has to choose.

Section keys are derived through a semantic map so the two lanes agree about what a section IS even
though they name them differently: the AI master's `PROFESSIONAL SUMMARY` and the Power BI master's
`PROFILE` both become `sum`. A heading the map does not know still parses, with a deterministic
fallback slug. Parsing stays permissive; the fixture is what raises the alarm on a new section.

---

## 3. Granularity: one block is one bullet, one paragraph line, or one heading

Measured against the real documents, not assumed. The AI master's printable half is 96 lines, 64
blocks; the Power BI master's is 88 lines, 61 blocks. Most of those blocks are single bullets. The
Power BI count is 61 rather than one per line because its labelled header folds eight lines into four
printing blocks plus one directive, which is section 4B.

**Smaller fails the whole design.** Every bullet in both masters is already exactly one sentence of
his own text. Splitting a bullet into clauses would let a selector recombine two half sentences into
a sentence he never wrote, which is rewriting with extra steps, and it is precisely the thing this
architecture exists to make impossible.

**Larger makes selection meaningless.** The AI master is three pages of raw material and the CV has
to render on one page (D13, hard refuse; the #14 engine already drops an over-length CV as
`cv_over_one_page`). Selecting at role granularity gives the assembler five levers on a document
that needs about twenty. writer-notes-ai.md says it plainly: *"the writer must select, never dump."*

So the bullet is the unit, because it is both the smallest coherent grammatical unit of his text and
the unit the one-page ceiling is actually paid for in.

---

## 4. Block roles

| role | what it is | can the selector choose it |
|---|---|---|
| `mandatory` | emitted on every CV that ships, asked for or not | no, it is forced |
| `selectable` | the selector's actual menu | yes |
| `structural` | H2 and H3 headings, horizontal rules | no, emitted as the frame around a selected child |
| `meta` | a role's date line | no, it rides with its group |
| `directive` | an instruction to the builder, never printed | no, refused if requested |

### The mandatory set, and where each one comes from

- **The name.** The H1 on both lanes: the AI master writes one, and the Power BI master's `- Name:`
  bullet becomes one in section 4B. R4 asserts the rendered text contains `Shaheen Kiarash`, so a CV
  without it fails the render check by definition. Note that an H1 is deliberately NOT treated as
  structural: doing that would have made his name droppable.
- **Contact blocks.** Any block carrying an email, a phone or a LinkedIn URL. A CV a recruiter cannot
  answer is not a CV. This is the one mandatory class that is REDACTED from the model view.
- **The work-authorization line.** A11 asserts it is exactly `Work authorization: Swedish citizen
  (EU citizen)`. A check that asserts the content of a line the assembler was free to drop is a check
  that passes by accident, so the line is forced.
- **The whole header section.** This is the one mandatory mark derived by judgement rather than from
  a written rule, and it is called out as such.

  Why the whole header and not just the headline: nothing in the header is a real trim target. Four
  short lines against a ceiling that is spent on bullets, and a CV that dropped its own location or
  availability to save 60 characters would be a worse document for no gain anybody chose. Since the
  header normalization below runs, both masters reach this point with the same four header blocks,
  so forcing the section forces the same thing on both lanes.

### The directive case, which is why `directive` exists at all

The Power BI master carries `- Photo (for rendered CVs): outputs/research-team/.../profile-photo.jpg
(Shaheen's pick, casual, 2026-07-14)`. It is a build instruction that happens to live in a bullet. A
parser that treated it as selectable prose would eventually print a local file path on a CV.

---

## 4B. The two header shapes, and why the parser reconciles them

**The two masters are written in genuinely different shapes and only one of them is a document.**

- `master-ai-cv.md` is DOCUMENT SHAPED already: an H1 carrying his name, a title line, one fused
  contact line, then the work authorization line.
- `master-powerbi-cv.md` is a LABELLED DATA STRUCTURE: `## HEADER` over a bullet list of `Name:`,
  `Role line:`, `Email:`, `Phone:`, `LinkedIn:`, `Location:`, `Work authorization:` and
  `Photo (for rendered CVs):`.

**The master is not amended to suit the parser.** That shape is his, it predates this project, it is
read by other things, and it is the format he chose. The parser learns the second shape and emits the
first, in `normalizeLabelledHeader()`.

This was found on 2026-09-15 by rendering a real Power BI PDF and looking at it. The page opened with
a teal section rule titled HEADER over seven labelled rows, and carried no H1 at all, so the document
had no title and his name read as a form field. The labels are markup in his data format; a CV does
not print `Name:` any more than it prints `## HEADER`.

| in the master | on the page |
|---|---|
| `## HEADER` | nothing. It is a label on his list, not a heading in his document. Kept as `section.title` metadata, which never prints. |
| `- Name: Shaheen Kiarash` | the H1, the same block the AI master already opens with |
| `- Role line: ...` | the title line under it |
| `- Location:` `- Email:` `- Phone:` `- LinkedIn:` | ONE contact line, in the AI master's own field order (location, email, phone, LinkedIn) and with its own ` \| ` separator |
| `- Work authorization: ...` | the same line, label and all, verbatim. A11 asserts that exact string. |
| `- Photo (for rendered CVs): ...` | nothing. Still a `directive` block, still accounted for, never printed. |

**His words are never touched.** Every value is the master's own substring; the only characters this
file contributes are the separators between them.

**An unrecognised label REFUSES the build,** and the other two answers were considered first.
Printing it as-is is the bug being fixed. Printing it without its label guesses that an unknown field
is recruiter-facing prose, and the master already carries the counter-example: strip the label off
the photo line and the CV prints a local file path. A parser cannot tell a new `Portfolio:` from a new
`Photo (small):`, so guessing is a coin flip with a privacy leak on one face. Refusing is loud, cheap
to fix, and correct about what actually happened. The fix is one line in `HEADER_LABELS`, added by
somebody who read the new field and decided what it is. Two smaller refusals sit beside it: a header
with labelled fields but no `Name:` (there would be no H1, and R4 asserts his name is on the page),
and two lines claiming the same field (picking either silently would drop something he wrote down).

**Ordering and offsets.** `m.blocks` is in PRINT order, which stopped being byte order here: his list
puts `Role line:` above `Name:` and the page puts the name first. A normalized block carries the
offsets of the FIRST source line it came from, and `roundTrip()` walks blocks sorted by offset.
Everything the parser did not claim, the folded `## HEADER` and the labels it stripped, comes back as
gap, so the round trip stays exact whatever order the labels appear in.

---

## 5. The two views

`printView(lane)` is what the assembler emits from. `modelView(lane)` is what the selector is shown.
The only difference is contact redaction: a contact block's text is replaced with a placeholder that
says the block is mandatory and will be emitted verbatim at print time. The selector has no use for
a phone number when it is choosing which bullet to keep.

**The redaction is asserted, not trusted,** and the assertion has two halves because only the second
one makes the first one mean anything:

1. the model view must contain ZERO contact hits, and
2. the print view must contain MORE than zero, otherwise (1) is vacuously true and the whole
   redaction could be a no-op over patterns that match nothing.

Both throw. The second one is negative-tested by doctoring a copy of the master so no pattern
matches, and watching the build refuse with `VACUOUS`.

**Location rides the contact line on BOTH lanes, so the selector sees it on neither.** A city is not
a contact detail and it would be useful to a selector reasoning about a remote or onsite ad. It is
lost anyway, because it shares the one contact line with the email and the phone and the whole line is
redacted. On the AI master that was a property of how he wrote the file; since 4B it is also true on
the Power BI lane, where the fold puts location on that same line, and it is now a DECISION rather
than an accident. It was taken because a header that differs between lanes is worse than a selector
that has to read the city off the job brief instead, which it already has. The assembler emits the
location on both lanes regardless: it is mandatory, and nothing the selector does can drop it.

---

## 6. What the selector must emit

```json
{
  "cv_block_ids": ["sum.x.b02@ec0a9f09", "exp.r1.b04@...", "exp.r1.b03@..."],
  "section_order": ["hdr", "sum", "exp", "skl", "proj", "cert"]
}
```

Ids and an order. No text. No field called `rewritten`, no `improved_bullet`. `section_order` is
optional and defaults to document order.

Ordering rules, and why they are not simply "whatever the model said":

- **sections** follow `section_order` when given, document order otherwise.
- **groups inside a section** follow DOCUMENT order, always. A model cannot put the 2019 internship
  above the current role by accident.
- **blocks inside a group** follow the MODEL's order. That is the real tailoring lever: the bullet
  that matches the ad goes first inside the role it belongs to.

`assemble()` returns `{ text, ids, block_count, mandatory_forced, para_chars, ceiling_chars,
over_ceiling }`. It measures against the A13 ceiling of 3760 printable characters; it does not
implement the drop loop that gets a selection under the ceiling, which is the pipeline's policy.

It refuses, by throwing, on: an id that does not exist, an id whose position exists with a different
content hash (that message says "amendment signal" on purpose), a heading, a meta line, a directive,
and a `section_order` naming an unknown section.

---

## 7. The pre-flight refusals

`preflight()` refuses to build on three regressions that must never reach a rendered CV.

1. **The mirror is stale against the docx** (AI lane only). `master-ai-cv.md` is GENERATED from the
   frozen `.docx` and nothing downstream can read a `.docx`. A stale mirror means every CV this lane
   ships is built from a version of his text he has already replaced, and it looks perfectly healthy
   the whole time. `python scripts/build-cv-master.py --check` is the only thing that can see it, so
   it is run rather than assumed. It also carries its own banned-text gate, so running it buys that
   too.

   **Fail closed, including when the interpreter is absent.** This follows the gitleaks precedent in
   the root constitution exactly: a found secret blocks, a gitleaks that errors blocks, an absent
   gitleaks blocks. The one loud deliberate override is `ALEX_ALLOW_NO_PYTHON=1`, and it prints what
   it skipped. `ALEX_PYTHON` picks the interpreter on a machine where it is called `python3`.

   The Power BI master is MD-first with no docx behind it, so there is no staleness check to run. The
   fixture pins its sha256 instead, which catches an unannounced edit just as loudly.

2. **A dash character in either master.** Shaheen, 2026-08-20: *"you have use this [en-dash] in both
   versions PDF and Word, you already have this role, NEVER AGAIN use it."* Both characters were
   removed at source, so verbatim reuse is dash-free by construction, and this refusal is what keeps
   that true.

3. **TypeScript or JavaScript in either master.** Both were pruned as overclaims on his own
   instruction, JavaScript on 2026-07-25 and TypeScript on 2026-08-19.

**Refusals 2 and 3 run on the PRINTABLE HALF ONLY, and that is not a shortcut.** The AI mirror's
notes half contains the words TypeScript and JavaScript 8 and 3 times, inside the very rules that
forbid them. A whole-file check would refuse to build, every time, forever, for the most confusing
possible reason, and the next person would weaken the check rather than read it. The
`## WRITER-AGENT NOTES (not printed)` heading exists precisely so a negative mark can be scoped to
the recruiter-facing half; `scripts/build-cv-master.py` and the resync script already scope theirs
the same way. There is a test that asserts this: the real AI master says "TypeScript" 8 times and
still passes pre-flight.

---

## 8. Approved numbers, the A8 source

A8 asks that every number in the cover letter appears in the approved list or in the ad text.
`approvedNumbers(lane)` derives that list rather than storing it, from two places: every number in
his own CV text (by definition a number he stands behind) and the figure-bearing bullets in the
writer notes (the Alex scale line and the approved outcome metrics).

Deriving it does three jobs at once: it cannot drift when he amends a master, it cannot go stale
when a note is updated, and it keeps CV numbers out of a tracked file in a public repo.

Three exclusions, each found by looking at what the first cut actually produced:

- **the contact block is not a source of numbers.** His phone number was putting 46, 76, 014, 07 and
  37 on the allowlist. A letter could then claim "37 workflows" on the strength of his area code.
- **the notes harvest stops at the first subheading.** Below it sit an amendment log and a filename
  law, which were contributing backup-file datestamps and a line-ending count from an incident report.
- **ISO date stamps and leading-zero tokens are dropped.** A rule's date is metadata about the rule,
  never a number in his CV.

Tokenising is `voice-rules.js` `extractNumbers`, the SAME function the letter audit uses, because an
allowlist and a checker that disagree about what a number is will fail honest letters and pass
invented ones. Numbers are compared BARE: `70-75%` yields `70` and `75`, `20,000` yields `20000`,
`7.5+` yields `7.5`. A digit inside an identifier is not a number: `n8n`, `B2B` and `S3` contribute
nothing.

---

## 9. When Shaheen authorises an amendment

**The fixtures WILL fail. That is the system working, not a bug to route around.**

An authorised amendment changes the master, which changes the text of one or more blocks, which
changes their content hashes, which changes their ids. `test-master-blocks.js` will report the
mismatch and `assemble()` will refuse any id pinned before the change with a message that says
"amendment signal".

**A THIRD CASE, which is not an amendment at all.** The pin records what the PARSER makes of the
master, not only what the master says, so ids can move while the file does not. A deliberate change to
`_master.js` does exactly that, and the 2026-09-15 header normalization did: nine Power BI header ids
moved and the master file was byte identical throughout. The failing check says so by name when the
master sha still matches the pin. The procedure there is steps 6 to 9 only, with one addition: prove
that every id OUTSIDE the section the parser change touched is unchanged AND in the same order, before
running `--write`. If one moved that you did not mean to move, the parser change is wider than you
think.

The order matters, and step 1 is not optional.

1. **Confirm the amendment is authorised.** The AI master changes exactly two ways: Shaheen hands
   over a new file, or Shaheen explicitly authorises a surgical correction. If neither happened, stop
   here. A frozen master that changed on its own is an incident: recover the file from git or from
   the nightly encrypted vault backup and find out what wrote to it. Do NOT run `--write`.
2. **Back up first,** into `vault/me/cv/ai/_amendments/`, following the existing naming
   (`master-ai-cv-BEFORE-<what>-<yyyymmdd>.docx`). This is the standing order, not a suggestion.
3. **Make the change in the master itself,** the docx for the AI lane and the md for the Power BI
   lane. Any script that rewrites a master must preserve line endings explicitly; a Python text-mode
   rewrite once converted 106 LF endings to CRLF and broke a guard mark.
4. **Rebuild the mirror:** `python scripts/build-cv-master.py`. AI lane only.
5. **Record it** in the amendment log in `vault/me/cv/ai/writer-notes-ai.md`.
6. **Re-run the pre-flight and the round trip:** `node work/36-job-application-writer/config/test-master-blocks.js`.
   Expect the fixture section to fail and everything else to pass. If the round trip fails, the
   amendment changed the document's SHAPE, not just its words, and the parser needs looking at before
   anything else happens.
7. **Regenerate the pin:** `node work/36-job-application-writer/config/test-master-blocks.js --write`,
   then run it again with no flag and confirm it is green.
8. **Check what pinned the old ids.** Anything that stored a block id (a cached selection, a sheet
   row, a run record) now points at text that no longer exists. That is the whole reason the id
   carries a hash: those references fail instead of shipping stale text. Find them and let them fail
   loudly, do not patch the ids by hand.
9. **Re-sync the live engines** if the change touches text they carry, and follow the Change
   Propagation order for the rest.

---

## 10. Where the files live, and why some of them are not in the repo

| file | tracked | why |
|---|---|---|
| `nodes/_master.js` | yes | wiring and rules. Contains no master text, no employer name, no CV number, no block id. |
| `nodes/MASTER-BLOCKS.md` | yes | this file. |
| `scripts/lib/voice-rules.js` | yes | the one definition of every word-level voice rule. Generic English, no personal data. |
| `scripts/prose-scan.js` | yes | a CLI over that engine, holding no rule of its own. |
| `config/master-blocks.fixture.json` | no | derived from `vault/me/cv/**`, and records the shape of his employment history. |
| `config/test-master-blocks.js` | no | lives with its fixture, the #34 house convention for lane test suites. |
| `config/test-prose-scan.js` | no | same folder, and its carrier letter quotes his CV figures. |

`.gitignore:98` (`work/*/config/`) covers the bottom three. Durability is the same as `lane.json`:
the nightly encrypted vault backup tars everything git ignores, so a restore brings the pin back with
the masters it pins. A fresh clone has neither the masters nor the fixture, and `_master.js` says so
by name rather than guessing around it.

`_master.js` is BUILD TIME ONLY. The leading underscore keeps it out of `build.js`'s node glob
(`/^\d+-.+\.js$/`), the same convention as `work/34-job-search-bi/nodes/_lane.js`. The n8n box cannot
read this repo and never calls any of it.

---

## 11. Running the tests

```
node work/36-job-application-writer/config/test-master-blocks.js          # 95 checks
node work/36-job-application-writer/config/test-master-blocks.js --write  # regenerate the pin
node work/36-job-application-writer/config/test-prose-scan.js             # 53 checks
node scripts/prose-scan.js --rules                                       # print the rule tables
```

Both suites are structured the same way and the order is the point: every guard is shown FAILING on
a synthetic violation first, and only then shown passing clean input. A guard that passes because it
tests nothing is indistinguishable from a guard that passes because the system is healthy, and that
exact bug has shipped in this repo before.

Every negative case runs against a doctored copy of the repo in a scratch directory. The real
masters are opened read-only, and the last section of `test-master-blocks.js` proves it by hashing
them before and after the run.
