# nodes/

One file per n8n node, numbered in wiring order: `NN-<name>.js`.

Each file exports the node definition and how it connects. `config/build.js --add nodes/NN-name.js`
appends exactly one of them to the live workflow, backing up first and reading back after. `--rebuild`
reassembles the whole workflow from every file in this folder, in numeric order.

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
synthetic violation). Both are in `config/` because their fixtures carry real values.
