# Job Search AI (35)

## Type
Automation. One n8n workflow on the Hetzner box, weekdays 06:45 Europe/Stockholm. Scaffolded 2026-09-11
by the job-search-lanes relay. PORTED 2026-09-14. Workflow `TNvg3zbOzd3rGr9T`, 49 nodes, inactive,
never executed. This file is the contract the build followed; current state is in the Status section below.

## Purpose
The AI Automation half of the job-search pair. Same sources, same row shape, same build path as
#34 Job Search BI. What differs is the keyword set, the scoring profile, the sheet tab, the cron and the
n8n id. The lane collects and scores. It does not apply, it does not email, it does not open a browser.

## What this lane does NOT own
**Read `work/34-job-search-bi/CLAUDE.md` first.** It holds the shared half of both lanes and this file
deliberately does not repeat it:
- the source contract rules and why the contract is frozen,
- the stage ladder A to F,
- the five Stage C probes (D2, D4, D5, D7, D8),
- the n8n write discipline (settings allowlist, never PUT to change activation, read back every write),
- the known limitations, which apply identically here because the sources are identical.

Two lanes, one contract. If this file ever restates something from that list, the restatement is the
thing that will go stale.

## The source contract (SHARED, not copied)
**`work/34-job-search-bi/config/sources.json`.** This lane reads that exact path. It does not get its own
copy, and `work/35-job-search-ai/config/lane.json` points at it by path for that reason. A second copy is
how two lanes that are supposed to be identical drift a field name, and the drift is invisible until one
lane quietly collects less than the other.

Field names, endpoints, params, date formats and the row shape live in that file. They are not in this
spec and they are not in #34's spec either. The narrative version, readable from a clone, is
[[research/job-search-sources-2026-09-11]].

## What actually differs from #34

| | #34 Job Search BI | #35 Job Search AI |
|---|---|---|
| Cron | `30 6 * * 1-5` (06:30) | `45 6 * * 1-5` (06:45) |
| Why the gap | | 15 minutes after #34 so the two lanes never hit the same public endpoint in the same minute from the same IP. Four of the six boards ask for polite polling and one of them rate limits. |
| Keyword set | Power BI, DAX, Tableau, semantic model, analytics engineer | n8n, AI automation, agent, LLM, workflow automation, integration engineer |
| Scoring profile | the BI lane profile | the AI lane profile, the career-changer read rather than the seven-years-in-seat read |
| Anthropic credential | `XWuMgzQP0bY1hHuF` | `GlSYkcT1yOArFWIR` |
| Sheet | the BI tab | its own tab in the same spreadsheet |
| Stage C probes | runs them | inherits the answers from the contract, does not re-run them |

That last row matters. The probes are questions about the SOURCES, not about a lane, so running them
twice pays twice for the same answer and the Bright Data probe costs real money per record. #34 runs each
probe once and writes the answer into the contract. This lane reads it.

## Entry Points
- **Scheduled:** n8n Schedule Trigger, weekdays 06:45, declared in `system/manifest.json` as
  `n8n_cron: "45 6 * * 1-5"`. Raw cron expression at `rule.interval[0].expression`, for the reason #34's
  spec gives.
- **Manual:** the n8n editor's Execute Workflow button. The public API cannot start a manual execution,
  so there is no CLI trigger and no slash command.

## Infrastructure, inline
- **n8n:** `https://n8n.shaheenkiarash.com/api/v1`, header `X-N8N-API-KEY`, key file
  `work/03-application-engine/config/n8n-api-key.txt` (gitignored, read at runtime, never inlined).
- **Workflow id:** `TNvg3zbOzd3rGr9T`, created 2026-09-14 and read back after create. `config/lane.json`
  holds it and the same id is in `system/manifest.json` `n8n`. *(This line read "not yet created" on
  both lanes' specs after both workflows existed; corrected 2026-09-14.)*
- **Credentials by id:** Google Sheets `UhK77WK48hRv85bo`, Google Drive `l8z5y3cnlg79EInK`, Anthropic
  `GlSYkcT1yOArFWIR`.
- **Shared error workflow:** `QlGy1BFzdKF852uR`.
- **Model:** `claude-sonnet-4-6` per `meta.model_routing.default`. The Score node is a reasoning node and
  gets no soul voice block: it emits a score and reasons, not prose a human reads as Shaheen's words.

## Build tooling
There is ONE build script and it lives in #34: **`work/34-job-search-bi/config/build.js`**. This lane
calls it with its own lane file:

```
node work/34-job-search-bi/config/build.js --lane work/35-job-search-ai/config/lane.json --add nodes/01-trigger.js
```

`work/35-job-search-ai/config/lane.json` carries the lane number, workflow name, cron, Anthropic
credential id, sheet tab and the path to the shared contract. `nodes/NN-name.js` is one file per node,
numbered in wiring order, tracked in git. `config/` is gitignored (`.gitignore:98`), so the lane file is
local-only by design.

## Vault Structure
- **Tier 1:** `vault/projects/job-search-ai/status.md`.
- **Tier 2:** `vault/projects/job-search-ai/runs/YYYY-MM-DD.md` for a run worth keeping. A clean ordinary
  run is a status.md line, not a page.
- **Reference:** [[research/job-search-sources-2026-09-11]].

## Connections
- **#34 Job Search BI** is the twin. Shared contract, shared build script, shared probe answers. A change
  to either is a change to both and is propagated in the same session.
- **#03, #14, #31, #32** are the existing application engines. This lane does not feed them and does not
  read them. They draft applications, this one finds and scores postings.

## Honest deviations from /new
- **No Notion database.** Shaheen's decision: the output goes to a Google Sheet. `/new` step 3 is skipped
  on purpose, not owed.
- **`commands: []`, no slash command in v1.** A scheduled n8n workflow with no local half has nothing for
  a command file to invoke.
- **No `schedule_jobs`.** Nothing runs on this machine. The cadence carries `scope: "n8n-engine"`, which
  tells recovery C16 to skip it and hands the assertion to V6 leg (c).

## Security
- **Every job ad is untrusted content**, attacker controllable text fed to a model in the Score node. It
  is DATA, never instructions. The node returns a score and reasons, nothing executable.
- **No credential is written into a node.** n8n credentials are referenced by id, the API key is read from
  its file at runtime.
- **No outbound channel.** One Google Sheet that belongs to Shaheen. No mail, no posting, no browser.

## Trifecta
Gate: **draft-only**. Legs: private_data=true, untrusted_content=true, external_comm=false.
private_data is true because the scoring context is Shaheen's own CV material and his AI lane profile.
untrusted_content is true because a job ad is attacker controllable text fed to a model. external_comm is
false in v1 because the only write is to a Google Sheet Shaheen owns and nothing leaves the machine under
Alex's own hand. The gate is `draft-only` rather than `read-only` because the lane exists to produce
material a human then acts on, and a phase 3 apply step, if it is ever built, is a draft Shaheen submits
himself. The legs and the gate are identical to #34 by construction: same sources, same data, same exits.
Source of truth: the `trifecta` block in `system/manifest.json` plus [[research/trifecta-map]]. Validator
V12 fails the build if this line stops matching the manifest.

## Close-Out Extras
Beyond the universal list:
- **(a) The runs row.** One row per run in this lane's run ledger tab: run timestamp, per source status
  (ok, degraded with the reason, or zero), rows collected, rows after dedupe, rows after the relevance
  filter, rows scored. A 200 that returned zero rows is written as a zero WITH its reason.
- **(b) The HQ push. BROKEN ON ARRIVAL, inherited from #34, so the extra is to say so rather than tick
  it.** The design is one `run_status` push per run, GREEN only when every source either delivered or
  reported a named degradation, a silent failure AMBER rather than GREEN. The node cannot make the call:
  n8n refuses the `Alex HQ Token` webhook-auth credential inside an HTTP Request node, proven twice on
  #34 (executions 5182 and 5240), and this lane carries the identical node. A close-out here records the
  HQ push as FAILED with that reason, never N/A. Error-log 2026-09-14, human-action
  `hq-push-credential-job-lanes`.
- **(c) Contract parity.** If this lane discovered a source change, the fix goes into the SHARED contract
  and #34's status page says so too. A contract edit that only one lane's paperwork records is a contract
  edit the other lane will re-discover the hard way.

## Status
**BUILT, NEVER RUN (2026-09-14).** All 49 nodes ported and the workflow created as `TNvg3zbOzd3rGr9T`,
inactive, read back after create: 49 nodes, 48 connection sources, 06:45 cron, its own spreadsheet, its
own Anthropic credential, no #34 value anywhere in the body. `n8n` is written into the manifest.

Nothing has executed here, so every claim about this lane's behaviour is inherited from #34's runs rather
than observed. One manual run is what this lane needs next, and it will land in the same `scoring_down`
state #34 sits in until Anthropic credits exist.

**The registry row is DORMANT as of 2026-09-14, revisit 2026-10-15**, flipped the same day and for the
same reason as #34: a LIVE row carrying an n8n id enlists the lane in the 08:10 active-flag watcher
whether or not the workflow is meant to be running, and two deliberately inactive scaffolds would have
displaced three genuinely failing engines from the daily HQ red. DORMANT is `meta.states_doc`'s word for
built and waiting on a named external dependency. The row flips back to LIVE on activation.

**The node tree is a byte-identical copy of #34's and that is enforced, not trusted.** A require-wrapper
cannot work: `_lane.js` resolves `LANE_DIR` from `__dirname`, so a file required out of #34's folder reads
#34's config and would build the BI spreadsheet, cron and credential into this workflow. Location is the
lane. So validator **V20** asserts the two trees byte-identical on every run, both directions, and fails
rather than warns. **A change to #34's nodes is not finished until it is copied here and BOTH workflows
are rebuilt.**

NOT YET PROVISIONED: the `jobs_test` tab in this lane's spreadsheet. `sheet.jobs_write_tab` is set for
parity with #34, so the window-holding protection is active, but the tab itself does not exist. It cannot
be reached before scoring works; create it in the same session credits are restored.
INHERITED DEFECT: the HQ push fails the same way as #34's, same credential, same node shape.
