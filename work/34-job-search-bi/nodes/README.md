# nodes/

One file per n8n node: `NN-<name>.js`.

**THE NUMBERS STOPPED BEING WIRING ORDER AT 23 (2026-09-12), and that is deliberate.** Files 01 to 22
are in wiring order. The two paging loops added five nodes that belong in the MIDDLE of the graph:
23 and 24 sit between 07 and 08, and 25, 26 and 27 sit between 17 and 18. Then the scoring stage took
28 to 32, and the LinkedIn detail stage took 33 to 37 while sitting BEFORE it, between 22 and 28.
The output and telemetry stage took 38 to 49 and is the one band whose numbers ARE its wiring order,
because it is the tail of the graph and nothing will ever be inserted before it.
Renumbering thirty two files to make room would have churned every test, every card and every handoff
line that names one, for a number that n8n never reads. The order in the `nodes` array does not affect
the workflow: connections are assembled by node NAME. Each out-of-order file carries its place in the
graph in its own header, and the map is:

```
Plan Queries -> LinkedIn Units Only [out0] -> Search LinkedIn (07) -> LinkedIn Page Guard (23)
                                              ^                       -> More LinkedIn Pages? (24)
                                              |                            [out0] loops back to 07
                                              +----------------------------+
                                                                           [out1] -> Extract LinkedIn (08)
LinkedIn Units Only [out1] -> Indeed Units Only [out0] -> the Indeed poll loop (10 to 16)
                              Indeed Units Only [out1] -> Fetch Board (17) -> Board Page Guard (25)
                                              ^                            -> More Board Pages? (26)
                                              |                                 [out0] -> Board Page Pause (27) -> 17
                                              +---------------------------------+
                                                                                [out1] -> Extract Board Jobs (18)
Extract LinkedIn / Extract Indeed Jobs / Extract Board Jobs -> Combine (19) -> Filter (20)
  -> Read Known Jobs (21) -> Remove Known (22)

  -> Detail Gate (33) -> Detail Route (34)
       [out0 true, the fetch REQUESTS] -> Get LinkedIn Detail (35) -> Detail Results (36) [input 0]
       [out1 false, EVERY row and report] --------------------------> Detail Results (36) [input 1]
                                                                      Detail Results -> Attach Detail (37)

  -> Budget Gate (28) -> Score Route (29)
       [out0 true] -> Score Job (30) -> Score Results (31) [input 0]
       [out1 false] ------------------> Score Results (31) [input 1]
                                        Score Results -> Parse Score (32)

  -> Build Rows (38) -> Write Route (39)
       [out0 true, the sheet rows]   -> Write Jobs (40) -> Write Results (41) [input 0]
       [out1 false, EVERY report]    ---------------------> Write Results (41) [input 1]
                                        Write Results -> Read Back Jobs (42) -> Build Run Row (43)
       -> Write Run (44) -> Update Last Run (45) -> Read Back Writes (46) -> Check Writes (47)
       -> Push HQ (48) -> Assert Writes (49)
```

**The output band, in one paragraph.** Build Rows turns a scored row into exactly the fifteen sheet
columns plus one routing boolean, and everything else rides the carry branch. The IF and the Merge
exist for the reason they exist twice already: a run with nothing to write is ordinary here, and an
n8n node with an empty input is SKIPPED, so without them the ledger row and the HQ push would be
skipped on exactly the run that needed them. Every DATA write is read back before it is believed,
which is the two `Read Back` nodes and the two comparators. `Assert Writes` is the terminal node and
the only one allowed to throw; it runs AFTER the push on purpose, because throwing earlier would
suppress the message that says why.

**Two numbers in the output band are decisions rather than defaults.** `Write Jobs` sets
`cellFormat: RAW` because the node's own default at this typeVersion is `USER_ENTERED`, which turns a
job ad beginning with `=` into a live formula in Shaheen's spreadsheet. And it uses `defineBelow`
rather than auto-mapping because auto-mapping sends every unmatched key through `handlingExtraData`,
whose default is `insertInNewColumn`: the provenance keys would each become a column nobody chose.

**Read the detail band's true branch carefully, because it is not what it looks like.** An n8n HTTP
node replaces its input item with its own response, so a job row routed into the fetch branch does
not come out of the other side. Detail Gate therefore emits an admitted row TWICE: the row itself on
the carry branch, and a separate scaffolding REQUEST item carrying only a url and a job id. Every row
and every report travels output 1. That is why the detail stage can attach nothing at all, including
when its own gate is unreachable, and still emit every row.

Each file exports the node definition and how it connects. `config/build.js --add nodes/NN-name.js`
appends exactly one of them to the live workflow, backing up first and reading back after.
**`--add` cannot be used on this workflow any more**: it requires a topological order and there are
now THREE cycles (the Indeed poll loop and the two paging loops). `--rebuild` reassembles the whole
workflow from every file in this folder and is the only mode that works.

A file whose name starts with `_` is NOT a node. build.js only globs `/^\d+-.+\.js$/`, so `_lane.js`
is a build-time helper and can never be mistaken for one.

Three rules:
- **The schedule trigger (`02-schedule.js`) MUST use a raw cron expression** at
  `rule.interval[0].expression`. Validator V6 leg (c) can only derive a comparable string from a raw
  `cronExpression` or a plain every-1-day interval, so any other interval shape leaves the declared
  `n8n_cron` un-assertable and the check drops to a warning. It reads the expression from
  `config/lane.json` rather than carrying a copy, and build.js refuses any other shape anyway.
- **No node hardcodes a source field name.** They come from the shared contract at
  `config/sources.json`. This folder holds wiring, the contract holds facts about the outside world.
- **No node hardcodes a lane value either.** The spreadsheet id, the cron, the credential ids and the
  settings key set all come through `_lane.js`, which reads `config/`. This folder is tracked and the
  repo is PUBLIC; `config/` is gitignored (`.gitignore:98`). A node file that carried the spreadsheet
  id would publish it on the first `git add`.

Because of that last rule, `work/35-job-search-ai/nodes/` can hold a byte-identical copy of every
file here and build the AI lane correctly with no edit: every path in `_lane.js` resolves from
`__dirname`, so a copy reads its own lane's `config/lane.json` while still sharing the one
`sources.json`. If these files grow enough that copying them starts to drift, move the logic into
`nodes/lib/` as factories that take the lane directory, and leave one-line wrappers behind.

Offline proof for the Code nodes lives in `config/test-stage-a.js` (run time behaviour, against a
captured sample) and `config/test-stage-a-guards.js` (the build-time guards, each shown failing on a
synthetic violation). Both are in `config/` because their fixtures carry real values. The same
pattern continues per stage through `test-stage-e*`, and `config/test-depth.js` covers the two
paging loops, including a simulator that runs each loop pass by pass and a negative-test section
that removes each cap from a COPY of the shipped code and proves the same scenario then runs away.

**A fifth rule, added 2026-09-12 after execution 5182: NEVER KEEP MORE JOBS THAN YOU CAN DESCRIBE.**
The LinkedIn search leg and the LinkedIn detail leg spend the same whole-run budget, so an extra page
of search results is bought with a description. On 5182 the search leg took 20 of the 25 calls, the
detail stage got 5, and 15 of the 20 rows the run kept were scored on their titles alone, permanently,
because a written row is deleted as known next run. A row held back instead costs a day and nothing
else. So `Remove Known` (22) caps its row count at the lesser of `max_scored_per_run` and what the
detail budget can enrich, and `LinkedIn Page Guard` (23) stops paging once the run holds more unique
postings than that cap. THREE files have to agree about one number: the clamps are read out of
`33-detail-gate.js` at build time rather than retyped, 22 publishes its arithmetic on its stage report,
and 33 cross-checks its own against it at run time. The exception that keeps the lane alive: when
NOTHING can be described the coupling switches off and the ceiling applies, because a cap of zero would
write no rows, bite every run and hold the window forever. Measured before and after on 5182's own
bodies: 25 calls / 20 kept / 5 described becomes 21 calls / 10 kept / 10 described.

**A fourth rule, added with the paging loops: a cap that a human can edit needs a second cap that a
human cannot.** Both page guards read their limits from the settings tab, then `config/lane.json`,
then a shipped default, so Shaheen can tune them from his phone. That makes the number hand editable,
and a hand edited `9999` on a weekday cron with nobody in the room is an unbounded loop. So each
guard also carries a CLAMP in code that the configured value is capped to, and the clamp is named in
the run report whenever it bites. The configurable cap is a convenience; the clamp is the guard.
