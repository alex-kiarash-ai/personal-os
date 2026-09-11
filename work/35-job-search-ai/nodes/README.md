# nodes/

One file per n8n node, numbered in wiring order: `NN-<name>.js`. Same convention and the same two rules as
`work/34-job-search-bi/nodes/README.md`, which is the canonical copy. Read that one.

The build script is shared and lives in #34. Call it with this lane's lane file:

```
node work/34-job-search-bi/config/build.js --lane work/35-job-search-ai/config/lane.json --add nodes/01-trigger.js
```

`--add` paths resolve against this lane's `work_dir`, so `nodes/01-trigger.js` means
`work/35-job-search-ai/nodes/01-trigger.js`.

This folder is tracked in git. `config/` is not (`.gitignore:98`).
