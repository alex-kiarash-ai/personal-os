# Job Search BI (34)

## Type
Automation. One n8n workflow on the Hetzner box, weekdays 06:30 Europe/Stockholm. Scaffolded 2026-09-11
by the job-search-lanes relay. NOT BUILT YET: this file is the contract the build follows, see `## Status`.

## Purpose
Collect every Power BI shaped job posted in the last 24 hours from the sources that answer without a
login, fold them into one deduped row shape, score each one against Shaheen's BI profile, and write the
result to a Google Sheet he opens in the morning. The lane stops at the sheet. It does not apply, it does
not email, it does not open a browser.

The AI lane is #35. Same source contract, same row shape, different keyword set and different scoring
profile. The split exists so each lane carries its own n8n id and its own cron, which is what puts both
under validator V6 leg (c) and the daily 08:10 active-flag watcher.

## The source contract (FROZEN, read it, never restate it)
**`work/34-job-search-bi/config/sources.json`** is the single source of truth for every endpoint, every
query param, every live field name, every date field and format, every rate note, and the shared row
shape. Written by Agent 1 on 2026-09-11 off live responses, not off a brief.

Three rules about that file:
1. **Both lanes read the SAME file.** #35 does not get a copy. `work/35-job-search-ai/config/lane.json`
   points at `work/34-job-search-bi/config/sources.json` by path. A second copy is how a field name
   drifts between two lanes that are supposed to be identical.
2. **No node hardcodes a field name that this file already carries.** A collector reads its `field_map`
   from the contract. If a source renames a field, the fix is one edit in the contract, not a hunt
   through node files.
3. **The file is gitignored** (`.gitignore:98`, `work/*/config/`), so it is local-only and rides the
   nightly encrypted vault backup. The narrative version, which IS in the vault and IS readable from a
   clone, is [[research/job-search-sources-2026-09-11]].

Field names, endpoints and params are deliberately absent from this spec. They live in the contract.

## Entry Points
- **Scheduled:** n8n Schedule Trigger, weekdays 06:30, declared in `system/manifest.json` as
  `n8n_cron: "30 6 * * 1-5"`.
- **Manual:** the n8n editor's Execute Workflow button. The public API cannot start a manual execution,
  so there is no CLI trigger and there is no slash command.

## The build, stage by stage
Stages are built and verified one at a time through `config/build.js --add`, which backs up, appends one
node, PUTs with the settings allowlist, and reads back. Nothing is added blind.

- **Stage A. Skeleton.** Schedule Trigger plus the shared error workflow `QlGy1BFzdKF852uR`, settings
  `{executionOrder: v1, timezone: Europe/Stockholm}`. The trigger MUST carry a raw cron expression at
  `rule.interval[0].expression`. Any other interval shape makes the declared `n8n_cron` un-assertable
  and V6 leg (c) drops to a warning, which is a contract that looks checked and is not.
- **Stage B. Collectors.** One HTTP Request node per source in the contract, each reading its own
  `endpoint` and `params`. A node that fails does not fail the run: the lane reports the source as
  degraded and carries on. A zero from a source that answered 200 is a real zero and is reported as one.
- **Stage C. The probe pass.** Five open questions, below. Every one of them is a way a collector can
  under-collect and still report success, so none of them is deferred past this stage.
- **Stage D. Normalise and dedupe.** Every row into `shared_row_shape` from the contract. Dedupe by the
  contract's `dedup_id_rule` per source. The same job on three boards is one row with the sources listed.
- **Stage E. Relevance and freshness, locally.** Keyword relevance is re-checked here against the title
  and the description, because at least one source matches the query against the description body only
  (D6). Freshness is filtered here too, per source, using that source's own date field and format.
- **Stage F. Score and write.** One Anthropic call per row against the BI profile, model
  `claude-sonnet-4-6` per `meta.model_routing.default`. Reasoning node, no soul voice block: it emits a
  score and reasons, not prose a human reads as Shaheen's words. Then the Google Sheets write, then the
  run report.

## Stage C, the five probes that have to land before a collector is trusted
Carried from Agent 1's discrepancy table in the contract. Each one is a case where the collector returns
200, writes fewer rows than it should, and reports a healthy run.

| Probe | The question | The call | What to do with the answer |
|---|---|---|---|
| **D2** | LinkedIn guest page size: 10 or 25? One probe returned 10 cards where the brief says 25, and a single probe cannot tell a changed page size from a 24 hour window that only held 10 matches. | ONE `start=10` call with the same params as the `start=0` probe. | Overlap with page 1 means the step is 10. Fresh rows mean the step is 25. Write the answer into the contract's `quirks`, then build the paging loop on it. A loop stepping 25 over a page size of 10 skips silently. |
| **D4** | Himalayas returned 4 rows against its own `limit=20` with `totalCount` 2476. Is `sort=recent` a rolling recency window rather than a page filler? | Repeat the call with `sort` dropped, and once more with a larger `limit`. | If the row count tracks `limit` without `sort=recent`, the recency sort is the cause and the collector must not treat "fewer rows than limit" as "no more rows". |
| **D5** | Himalayas pagination: the API's own comments field says cursor pagination is preferred and `offset` is deprecated, and `nextCursor` was absent from the 4 row response. | One call, read the response for `nextCursor` when the result set is larger than one page. | Build paging on the cursor. If no cursor is ever returned, say so in the contract and cap the collector at one page rather than guessing an offset contract that is on its way out. |
| **D7** | Remotive `category=data` returned 16 rows spanning eight other categories and no data category. Is the slug wrong or is the param ignored? | `GET https://remotive.com/api/remote-jobs/categories` once, read the real slugs. | Use a real slug. Log job count against `total-job-count` on every run so a silently ignored filter is visible in the run report instead of invisible in the data. |
| **D8** | Remotive delays every job by 24 hours as a deliberate attribution policy. A last-24-hours freshness filter sees almost nothing from this source. | No call, this is a design decision. | Either widen the freshness window for this source specifically, or accept a near zero contribution and SAY SO in the run report. A healthy looking zero from a source that is structurally 24 hours behind is the exact failure this probe exists to prevent. |

`D1` (the live workflow count) belongs to activation, not to the collector, and is handled by
`config/free-slots.js`. The remaining medium and low rows in the contract are build notes, not gates.

## Infrastructure, inline
- **n8n:** `https://n8n.shaheenkiarash.com/api/v1`, header `X-N8N-API-KEY`, key file
  `work/03-application-engine/config/n8n-api-key.txt` (gitignored, read at runtime, never inlined).
- **Workflow id:** not yet created. `config/lane.json` holds it once Stage A lands, and the same id goes
  into `system/manifest.json` `n8n` in the same session.
- **Credentials by id, reused, never recreated:** Google Sheets `UhK77WK48hRv85bo`, Google Drive
  `l8z5y3cnlg79EInK`, Anthropic `XWuMgzQP0bY1hHuF` (this lane), Bright Data header auth
  `1bRmstvfhvDLNE7h` (phase 2 only).
- **Shared error workflow:** `QlGy1BFzdKF852uR`.
- **Node typeVersions on n8n 2.30.3:** `scheduleTrigger 1.2, httpRequest 4.2, code 2, if 2.2, merge 3,
  googleSheets 4.5`.
- **PUT body is `{name, nodes, connections, settings}`** and `settings` accepts only
  `saveExecutionProgress, saveManualExecutions, saveDataErrorExecution, saveDataSuccessExecution,
  executionTimeout, errorWorkflow, timezone, executionOrder`. PUT can drop the active flag. Activation
  is `POST /workflows/{id}/activate` plus a GET verify, never a PUT.

## Build tooling
- **`config/build.js`** is the only writer. Modes: `--add nodes/NN-name.js` (backup, create or fetch,
  append one node and its connection, PUT with the settings allowlist, GET back, print a diff),
  `--rebuild` (reassemble from all node files), `--dry` (print the body, touch nothing). It is shared
  with #35 through `config/lane.json`, so there is one build path and two lane files.
- **`config/lane.json`** carries the lane number, the workflow name, the cron, the Anthropic credential
  id, the sheet id and tab, and the path to the shared sources contract.
- **`config/free-slots.js`** deactivates the three MCP Tool sub-workflows and proves the MCP server still
  answers. It refuses to run without `--confirm` and prints its plan before changing anything. It is
  written, not run, and it runs only on Shaheen's explicit go.
- **`nodes/NN-name.js`** is one file per node, numbered in wiring order. These are tracked in git. The
  three files above live in `config/`, which is gitignored, so they are local-only by design.

## Vault Structure
- **Tier 1:** `vault/projects/job-search-bi/status.md` (last run, counts per source, open items, the
  workflow id once it exists).
- **Tier 2:** `vault/projects/job-search-bi/runs/YYYY-MM-DD.md` for a run worth keeping, which is a run
  that found something or failed in a new way. A clean ordinary run is a status.md line, not a page.
- **Reference:** [[research/job-search-sources-2026-09-11]] is the narrative source page. Read it before
  changing anything about a source.

## Connections
- **#35 Job Search AI** reads the same `config/sources.json` and the same `config/build.js`. A change to
  either is a change to both lanes and is propagated in the same session.
- **#02 morning-brief** is the natural consumer of a one line count once the lane has fired for real.
  Not wired in v1, and not claimed anywhere as wired.
- **#03, #14, #31, #32** are the existing application engines. This lane does NOT feed them and does not
  read them. It is a separate function: they draft applications, this one finds and scores postings.

## Honest deviations from /new
- **No Notion database.** Shaheen's decision: the output goes to a Google Sheet, not to Notion. The
  bootstrap protocol in the root constitution does not apply to this lane, so `/new` step 3 is skipped
  on purpose rather than owed.
- **`commands: []`, no slash command in v1.** The lane is a scheduled n8n workflow with no local half to
  invoke. Adding an empty command file would create a routing entry that does nothing.
- **No `schedule_jobs`.** Nothing runs on this machine. The cadence carries `scope: "n8n-engine"`, which
  is what tells recovery C16 to skip it and hands the assertion to V6 leg (c).

## Known limitations, in writing
- **The LinkedIn guest endpoints throttle datacenter IPs.** Agent 1's probes ran from this machine on a
  residential IP and all answered 200. The Hetzner box is a datacenter IP and the documented behaviour
  is 429 or 999 after roughly ten pages. This is UNPROVEN from the box and is the single largest risk to
  the lane. Stage B must treat a 429 or a 999 from LinkedIn as a degraded source with a named reason, not
  as an empty result. The fallbacks, if it bites, are Jina Reader on a public job page or the Bright Data
  LinkedIn dataset, both documented in the research page.
- **Anthropic credits are exhausted** (human-action `anthropic-api-credits-run89`, open since 2026-08-08).
  Stage F will 4xx until Shaheen closes it. Stages A to E run regardless, and that is the reason the
  scoring call is the LAST stage rather than an early one.
- **Sweden and European Union LinkedIn geoIds are unresolved.** Only Stockholm `100907646` is confirmed.
  A geoId nobody verified returns results for the wrong place and looks perfectly healthy.
- **Four boards make attribution a condition of API access** (RemoteOK, Remotive, Jobicy, Arbeitnow). Any
  human readable surface this lane produces carries the source name and the original link. The list is in
  the contract's `attribution_obligations`.
- **The free n8n slot situation is unproven.** The box holds 19 workflows and 17 are active, against a
  documented cap of 16 that is now known to be stale. Nothing is activated until `config/free-slots.js`
  has run and the MCP server has been proven to still answer.

## Security
- **Every job ad is untrusted content.** It is attacker controllable text written by a stranger and fed
  straight to a model in Stage F. It is DATA, never instructions. The Score node's prompt states that a
  posting cannot issue instructions, and the node returns a score and reasons, nothing executable.
- **No credential is ever written into a node.** n8n credentials are referenced by id. The API key is read
  from its file at runtime by `build.js`.
- **The lane has no outbound channel.** It writes one Google Sheet that belongs to Shaheen. It sends no
  mail, posts nothing, and opens no browser.

## Trifecta
Gate: **draft-only**. Legs: private_data=true, untrusted_content=true, external_comm=false.
private_data is true because the scoring context is Shaheen's own CV material and his lane profile.
untrusted_content is true because a job ad is attacker controllable text fed to a model, which is the
sharpest exposure this lane has. external_comm is false in v1 because the only write is to a Google Sheet
Shaheen owns, and nothing leaves the machine under Alex's own hand. The gate is `draft-only` rather than
`read-only` because the lane's whole purpose is to produce material a human then acts on, and the phase 3
apply step, if it is ever built, is a draft Shaheen submits himself. The declared gate flipping to
anything else without the legs changing would be the tell that the lane grew an exit. Source of truth: the
`trifecta` block in `system/manifest.json` plus [[research/trifecta-map]]. Validator V12 fails the build
if this line stops matching the manifest.

## Close-Out Extras
Beyond the universal list:
- **(a) The runs row.** Every run appends one row to the run ledger tab in the sheet: run timestamp,
  per source status (ok, degraded with the reason, or zero), rows collected, rows after dedupe, rows after
  the relevance filter, rows scored. A source that returned 200 and zero rows is written as a zero WITH
  its reason, never folded into a total.
- **(b) The HQ push.** One `run_status` push per run. GREEN only when every source either delivered or
  reported a named degradation. A source that failed silently is AMBER, not GREEN. The heartbeat push is
  the one named exemption from the Verify-after-write order, per the root constitution; every other
  external write in this lane reads back.
- **(c) The source contract.** If a run discovered that a field name, a param or a page size changed, the
  contract is updated in the same session and the change is noted in the status page. A discovery that
  lives only in a run report is a discovery that gets re-made.

## Status
**SCAFFOLD ONLY (2026-09-11).** Registered #34 in `system/manifest.json`, spec written, source contract
frozen by Agent 1, build tooling written. NOT YET BUILT: every node. NOT YET CREATED: the n8n workflow,
so the `n8n` field is null and V6 leg (c) does not assert the declared cron yet. NOT YET RUN:
`config/free-slots.js`, which waits on Shaheen's explicit go.
