# sync-settings: push the approved settings into both live spreadsheets

Ten node files that build ONE reusable n8n workflow, `Job Search - Sync Settings (34 + 35)`. It reads
the approved values out of `config/seed.json`, compares them cell by cell against what the two
spreadsheets hold right now, writes only the cells it is allowed to write, reads every cell back, and
refuses to report success unless the sheets hold exactly what the plan said they would.

It is NOT a one-shot. The provisioner was, and was deleted. This one stays on the box, inactive, and
gets re-run from the editor every time the settings change. It has no self-delete and its name says
nothing about being temporary.

## The syncable-key rule

**An ALLOWLIST, not a denylist: every settings key in `seed.json`, MINUS the runtime keys.**

Today the runtime set is exactly one key, `last_run_at`. The pipeline writes it at the end of a
successful run, and the whole search-window design reads it: empty means "first run, collect
`first_run_window_hours` (168)", a timestamp means "collect since then, floored at
`min_window_hours`". Overwriting it with the seed's empty string would silently re-collect a week of
jobs and look like a busy morning rather than like a bug.

The allowlist is applied at BUILD time in `02-build-target.js`, so the target set physically cannot
contain a runtime key. `05-plan-changes.js` asserts it again at run time anyway. The allowlist is the
design; the assertion is what fires if someone later edits the design.

Why an allowlist and not "skip `last_run_at`": a denylist fails OPEN. The day Stage F adds a second
pipeline-written key, or somebody hand-adds one of the optional paging caps, a denylist sync clobbers
it and nothing says so. An allowlist fails CLOSED: an unknown key is simply not in the write set.
Anything on the sheet that is not in the allowlist is PRESERVED and named in the run report.

## The shape

```
Manual Run
  -> Build Target Settings      (Code, bakes seed.json + both lane.json, allowlist applied)
  -> Read BI Settings           (HTTP GET  values:batchGet, settings!A:B)
  -> Read AI Settings           (HTTP GET)
  -> Plan Changes               (Code, compares, refuses, builds two batchUpdate bodies)
  -> Write BI Settings          (HTTP POST values:batchUpdate, cell-addressed)
  -> Write AI Settings          (HTTP POST)
  -> Verify BI Settings         (HTTP GET, the WHOLE tab again)
  -> Verify AI Settings         (HTTP GET)
  -> Report                     (Code, five assertions per lane, throws on any of them)
```

Both reads happen before either write, so a fault on the AI sheet stops the BI write from happening
at all. The two writes are sequential, so a failure mid-flight leaves at most one lane moved.

## The three things worth knowing before you edit any of this

1. **The write is cell by cell, never a whole tab.** Each key gets its own `settings!B<row>` range,
   computed from the BEFORE read. That is the entire mechanism protecting `last_run_at` and any row a
   human added. `settings!A1` with the full block, which is what the provisioner used, flattens all
   of it.
2. **It writes every allowlisted key, not only the changed ones.** The body is then a fixed,
   countable list, so the read-back knows exactly how many cells should match; and a bug in the diff
   cannot silently skip a needed write. The change log is computed separately and is what the report
   prints. Reporting and writing are two jobs and they do not share a decision.
3. **The parse block is shared verbatim** between `05-plan-changes.js` and `10-report.js`, injected
   from `_sync.js` at build time. The node that decides where to write and the node that checks the
   write landed have to read the sheet the same way. Two hand-maintained copies is how a comparator
   ends up tolerating exactly the difference the writer introduced.

## The five refusals

All of them throw in `Plan Changes`, before the first write node runs, and all of them are the same
class: a condition under which a write would land somewhere other than where it was aimed.

| # | Refusal | Why it is fatal rather than a warning |
|---|---|---|
| 1 | Row 1 is not `key` / `value` | Every row address is computed from that. A shifted header puts every write one row out, into cells that all look plausible. |
| 2 | A duplicate key row | There is no "the `always_drop` row". Writing one leaves the other, and the decoder reads whichever it meets first. |
| 3 | The `lane` cell disagrees with `lane.json` | With the two ids swapped every other check passes and the BI targeting lands in the AI spreadsheet. |
| 4 | A runtime key has no row | Creating it means choosing a value, and the only value available means "re-collect 168 hours". That is pipeline state, not this workflow's to invent. |
| 5 | A runtime key in the write set | Belt and braces over the build-time allowlist. |

A row carrying a value with no key in column A is refused too: appending past it would bury a cell
somebody meant to name.

## Privacy

`nodes/` is TRACKED and the repo is PUBLIC. Not one file in this folder carries a spreadsheet id, a
search term, a keep term or a drop term. Every value is loaded by `_sync.js` at BUILD time from
`config/seed.json` and the two `config/lane.json` files, all gitignored, and baked into the node
parameters, because the n8n box cannot read this repo. Node files hold wiring; `config/` holds facts.
Same split as `nodes/provision/_seed.js` and `nodes/_lane.js`.

A fresh clone has no `seed.json`, so `_sync.js` fails by name rather than quietly building a sync
with no values in it.

## Running it

Never `--rebuild` this lane against the pipeline node folder: the lane file names `nodes_dir` and
`build.js` honours it, so that hazard is enforced by the tool rather than described in prose. Full
command sequence is in `config/lane-sync-settings.json` under `_how_to_use_it`.

The offline proof is `config/test-sync-settings.js`. It runs the REAL `jsCode` out of these node
files against the REAL live sheets as captured in `config/samples/settings-live-{bi,ai}.json`, so
what it proves is what ships, against what the spreadsheets actually held.
