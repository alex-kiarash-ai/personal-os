# Portal Application Engine - the drafting half of the Portal lane

**Workflow ID:** `sxEYRyeHH7i1mHzb` · **Runs:** Tuesday & Thursday 15:43 Stockholm (cron `43 15 * * 2,4`) · **Nodes:** 34 (verified live: re-cloned from the remediated #03 on 2026-07-27 at ~37/38 nodes, then trimmed to 34 by the 2026-07-28 simplify) · **Model:** Moonshot `kimi-k3` at `reasoning_effort:'high'` (was claude-opus-4-8, swapped 2026-07-27 with the other three job lanes) · **Export in this folder:** workflow.json

## What it does

The back half of the standalone **Portal lane** (#31). It takes the jobs the [Portal Scanner](../portal-scanner/) banked from company career pages and runs them through its own clone of the BI engine's pipeline: score the fit, gate deterministically, write a tailored CV + cover letter for the winners, QA-gate, render two PDFs via Gotenberg, and file them in its own Google Drive folder with its own run log. Draft-only, no auto-submit - the Trifecta gate is inherited from the clone source.

It runs at **15:43**, after the scanner (15:13) has banked the day's discoveries, so it drains what is already on paper.

## Why it exists

This is the "Option B / full clone" from the design review: rather than teaching the live #03 engine to also read ATS JSON, the portal lane runs a **second, self-contained copy** of the whole Match -> Gate -> Writer -> QA -> Render pipeline, pointed at its own sheet and Drive folder. The trade-off is a second copy of the (now kimi-k3) Match + Writer spend; the payoff is that the live job engines are never edited. Chosen deliberately (Shaheen, 2026-07-26) so #03 / #14 stay untouched.

## How it differs from #03's pipeline

It was cloned from #03 by fetching it read-only, then adapted:
- **No Bright Data sourcing head.** The LinkedIn scrape + polling nodes are amputated (the scanner does sourcing, for free). `Parse Jobs` became a `Drain Only (no live sourcing)` stub emitting one seed item so the chain executes; `Dedup Against Log` guards against mistaking that seed for a job.
- **Re-cloned from the remediated #03 (2026-07-27).** After #03 was rebuilt to 49 nodes, the portal pipeline was re-cloned from that shape via `reclone-portal.js`, which additionally strips the 5 poll-loop nodes F01/F02 added and F20's `Read Sibling Log` (there is no sibling to dedup against here). So it carries the remediation's cost ledger, whitelist QA gates, `CV One Page?` gate and explicit column mapping, but not the LinkedIn-specific sourcing or cross-lane dedup.
- **Its own bank tab convention.** #03 splits payloads into a separate `bank` tab because its ledger is thousands of rows deep; here the scanner writes `sourced_unscored` rows straight into `processed_jobs`, so that tab IS the bank. `Read Bank` and `Bank Sourced Jobs` point at `processed_jobs`; `seen_ids` still carries completion state.
- **`DRAIN_CAP = 10`** in `Dedup Against Log` - the live drain loop is unbounded, and against a 67-row backlog that would fire 67 model calls in one run. 10 is the standing guard and the main cost lever; raise it once the lane is trusted.
- **Its own sheet + Drive:** Sheet "Portal Job Pipeline" `1hmLHyW0Yu6ZV8MpiKrECo2OACk4eC3Eb5xWR73HIeiU`, Drive folder `1FUjKlw-sGvXrApvZ6hSu190m72x1YKDr`.

## Simplify (2026-07-28): lighter than the engines' - kept the ledger

The 07-28 `simplify` pass hit this lane too, but only removed its **4 `needs_review` writer nodes** (`Format/Append Needs Review S3` + `S5`), taking it 38 → 34. Unlike #03/#14, it **kept its dedup/bank layer** (`Read Processed Log`, `Dedup Against Log`, `Read Bank`, `Bank Sourced Jobs`, `Append Seen Id`, `Rehydrate Batch`, `Format/Append Processed Job`, `Seen Ids Failed` are all still live) - the portal lane still needs its own dedup because it re-scans the same ATS boards every run and has no Bright Data `discover_new` to lean on. So: no reject-review queue here anymore, but the ledger and drain survive.

## State (2026-07-27)

Built and proven end to end: one job (Xebia CEE, fit=74) went the whole way to two PDFs in Drive on the cheap-proof model. The honest headline number is the **pass rate: ~1.5% raw, ~4% after the scanner's title filter was tightened, versus #03's ~11%** - the single most important output so far, and Phase-4 evidence rather than a build failure. Activation is NOT done and is contested across the records: manifest #31 lists it LIVE at 15:43, the status page says INACTIVE, and a live fetch came back `active:true` (flagged as doc-drift to reconcile). It is a recurring-spend + capacity decision that is Shaheen's to make. Full detail, kill criteria, and the cost math: `vault/projects/portal-scanner/status.md`.

## Connected to

- **[portal-scanner](../portal-scanner/)** - the sourcing half; banks the jobs this drains.
- **[pipeline-error-alert](../pipeline-error-alert/)** - shared crash alarm.
- **Project docs:** `work/31-portal-scanner/CLAUDE.md`, `vault/projects/portal-scanner/status.md`. It does NOT connect to #03 / #14 by construction.
