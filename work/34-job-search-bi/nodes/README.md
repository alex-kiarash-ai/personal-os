# nodes/

One file per n8n node, numbered in wiring order: `NN-<name>.js`.

Each file exports the node definition and how it connects. `config/build.js --add nodes/NN-name.js`
appends exactly one of them to the live workflow, backing up first and reading back after. `--rebuild`
reassembles the whole workflow from every file in this folder, in numeric order.

Two rules:
- **`01-trigger.js` MUST use a raw cron expression** at `rule.interval[0].expression`. Validator V6 leg
  (c) can only derive a comparable string from a raw `cronExpression` or a plain every-1-day interval, so
  any other interval shape leaves the declared `n8n_cron` un-assertable and the check drops to a warning.
- **No node hardcodes a source field name.** They come from the shared contract at
  `config/sources.json`. This folder holds wiring, the contract holds facts about the outside world.

This folder is tracked in git. `config/` is not (`.gitignore:98`).
