# nodes/provision/

A **temporary, one-shot** workflow that creates the two job-search spreadsheets and seeds them.
It is not part of the #34 pipeline. It runs once, then it is deleted.

Live name on the box: `TEMP - Provision Job Search Sheets, delete after use`.

## Three things to know before touching this folder

1. **It has its own lane file.** `config/lane-provision.json`, never `config/lane.json`. build.js
   writes the created workflow id back into whichever lane file it was handed, so provisioning
   through #34's lane would stamp the TEMP id into #34 and the real Stage A would then believe its
   workflow already existed.
2. **Never run `build.js --rebuild` with the provision lane.** `allNodeFiles()` reads
   `work/34-job-search-bi/nodes/` at the top level only, which is the PIPELINE folder, not this one.
   A rebuild would assemble the pipeline nodes into the provisioner. Use `--add`, one node at a
   time, in numeric order.
3. **The values are not in here.** They live in `config/seed.json`, which is gitignored, because
   this folder is tracked and the repo is public. `_seed.js` loads them at build time and the node
   files bake them into the n8n node parameters. A fresh clone has no seed.json and `_seed.js` says
   so by name rather than failing quietly.

## Build order

```
node work/34-job-search-bi/config/build.js --lane work/34-job-search-bi/config/lane-provision.json --dry --add nodes/provision/01-webhook.js
node work/34-job-search-bi/config/build.js --lane work/34-job-search-bi/config/lane-provision.json      --add nodes/provision/01-webhook.js
... 02 through 11, same shape, always --dry first
```

The first `--add` creates the workflow, inactive. build.js never activates anything.

Eleven nodes: two triggers, one encoder, two creates, two seeds, two read-back fetches, one
comparison, one response. The last three exist because Verify-after-write has no carve-out for
Google Sheets: a settings tab that quietly landed twelve rows instead of twenty eight would produce
a collector with half a keep list and a run report that still says GREEN.

## Running it

Two ways in, on purpose:

- **Manual.** Open the workflow in the n8n editor and press Execute. No activation, no token. This
  is the cheaper path while the box sits at 17 active workflows against a cap nobody has proven.
- **Webhook.** `POST` to the path in `seed.provision.webhook_path` with `{"token": "..."}` in the
  body. A webhook only answers on the production URL while the workflow is **active**, so this path
  costs an activation for the length of the run.

## After it runs

It returns both spreadsheet ids and urls. Write them into the two lane files, fix the `sheet.tab`
values (they still assume one shared spreadsheet), deactivate if it was activated, and delete the
workflow. `config/lane-provision.json` carries the full list under `_after_it_runs`.
