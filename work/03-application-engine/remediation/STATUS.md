# Engines 03 + 14 Remediation, Status

Source plan: `~/Documents/alex-project/engines-03-14-remediation-plan.md` (external senior review, 2026-07-26; out-of-repo, path updated for the 2026-08-05 Linux move).
Applied 2026-07-27. Both engines went **41 -> 49 nodes**, both stayed `active=true` throughout.
(Corrected 2026-07-28: this line read "41 -> 47" - it was written before F19 ran, which adds 2 nodes,
`Read Bank` + `Append Seen Id`, per its own `node count +2` assertion. Final is 49, which the vault
status pages already carried. Node math: M1a -1/+5 -> 45, M3 +1 -> 46, M4/F20 +1 -> 47, F19 +2 -> 49.)

**SUPERSEDED 2026-07-28: this whole remediation is now partly reversed.** `scripts/simplify-engine.js`
(Shaheen's call) deleted the 18-node dedup/bank/drain/ledger/needs_review/timeout layer that F01/F03/F18/F19/F20
built, cutting both engines to **32 nodes** (source -> score -> gate -> draft -> render -> log, run_log only,
no cost tracking). What survives: F05 caching, F07 parse extractor, F08/F10/F11 QA gates, F14/F15, F16
(sanitizer-in-QA), the rebuilt poll loop (F02). Gone: F01 timeout rows, F03/F04 cost, F18 mapping on the
deleted appends, F19, F20, P3 banking. This document remains the record of the remediation as-built; the LIVE
engines no longer match it.

Before this session the plan was **0 of 22 implemented** (engines' `updatedAt` was 2026-07-25, a day before
the plan was written).

## LIVE-FIRE INCIDENT, CAUGHT AND FIXED: F07 prefill breaks on this model
The plan's F07 step 1 says to append `{ role: 'assistant', content: '{' }` as the final
message, and states it is compatible because these calls do not use extended thinking.
**That is wrong for claude-opus-4-8.** The live API rejects it:

> 400 - This model does not support assistant message prefill. The conversation must end with a user message.

It was applied to both live engines in M2 and **every match and writer call would have
thrown a 400 on the Tuesday 15:00 run.** Structural verification could never catch it:
the request was well-formed JSON. It surfaced only when the F06 calibration harness
became the first thing all session to actually CALL the API with the new body.

Reverted via `apply-f07-fix.js` (both engines, verified, active preserved). **The
parse-side half of F07 stays and still solves the original problem**: the three-stage
extractor recovers a reply carrying a preamble line, so a good job is no longer dumped
into needs_review with its tokens wasted. The prefill was belt-and-braces on top.

Standing lesson: a plan written from an export review can be wrong about runtime
behaviour, and no amount of structural checking substitutes for one real API call.

## F06 CALIBRATION RESULT: do not switch
Ran for real: 50 banked jobs per engine, each scored by BOTH models through a verbatim
copy of the live Build Match Request node, so the prompt was byte-identical. 200 Claude
calls. Table: `f06-calibration.json`.

| | #03 (threshold 70) | #14 (threshold 50) |
|---|---|---|
| paired | 49/50 | 48/50 |
| mean delta | -1.4 | +2.2 |
| median abs delta | 4 | 4 |
| within 5 points | 61% | 69% |
| pass at threshold | 5 -> 10 | 7 -> 9 |
| target_role agreement | 37/49 (76%) | 44/48 (92%) |

Decision rule was "switch and keep the threshold if the large majority of deltas are
within about 5 points". 61% and 69% are not that. The stronger signal is the pass rate:
the candidate is **more generous**, doubling #03's passes at the same threshold, which
pushes twice as many jobs into the expensive writer stage. Cheaper per call, dearer per
run, and a looser gate. It also disagrees on `target_role` for a quarter of #03's jobs,
which changes the writer's tone.

**Decision: keep `claude-opus-4-8` on both stages.** This also agrees with Shaheen's
standing instruction that all four workflows run the same model. To preserve the pass
rate a switch would need the thresholds moved 70 -> 73 and 50 -> 53; recorded here so a
future revisit starts from data rather than from scratch.

## Tally: 22 of 22 resolved

| ID | State | Note |
|----|-------|------|
| F01 | DONE (partial) | Hold-all partition + loud `snapshot_timeout` review rows. **Step 3 (auto re-poll recovery lane) NOT built.** |
| F02 | DONE | `Snapshot Ready?` per-item IF replaced by `Poll Gate` + `All Resolved?`; batch advances together |
| F03 | DONE | stage2 cost on the processed row, stage4 cost on run_log and the S5 review row |
| F04 | DONE | `RATES` map keyed by model, all four billable usage fields |
| F05 | DONE | Master CV + system prompt moved to cached system blocks with `cache_control` |
| F06 | DONE (measured, decided not to switch) | 200-call calibration run; candidate is looser and doubles #03's pass rate. Staying on `claude-opus-4-8`. Table in `f06-calibration.json` |
| F07 | DONE (parse side only) | Three-stage extractor live. **Prefill reverted: this model rejects it** (see incident above) |
| F08 | DONE | Employer + date whitelist derived from each engine's own MASTER_CV |
| F09 | DONE | `consultant` added to #14's match schema |
| F10 | DONE | Legal-suffix normalizer on the company-mention check |
| F11 | DONE | CV PDF page count in `Rebind PDFs` + `CV One Page?` gate blocking uploads |
| F12 | DONE | `BD Trigger Search` retryOnFail 4x/5s |
| F13 | DONE | `limit_per_input` 10 -> 25 |
| F14 | DONE | Scores clamped 0-100 in `Parse Match` |
| F15 | DONE | Match `max_tokens` 1024 -> 2048 |
| F16 | DONE | Sanitizers deleted from `Parse Writer`; QA is sole owner |
| F17 | DONE | Drive folder slug gains `job_posting_id` |
| F18 | DONE | Mapping shape proven by `probe-explicit-mapping.js` first; headers extended to 12/22/17 then all 6 appends switched to explicit |
| F19 | DONE | `seen_ids` + `bank` tabs created and backfilled (#03 345+86, #14 1962+586, counts verified); dedup reads the compact tabs; F20's sibling read dropped to `seen_ids` too |
| F20 | DONE | Option B: `Read Sibling Log` + `siblingOwned` skip on intake and drain |
| F21 | CLOSED, no change | Plan's own gate: skip if QA failures are near zero. #03 has 1 lifetime QA fire |
| F22 | CLOSED, no change | Monitor only. Word floor stays at 100 |

## Partial / deliberately deferred remainders

**F01 step 3.** The recovery lane needs a Sheets UPDATE capability the engines do not currently have (the
ledger has no update nodes by design), plus a `resolved_date` column and per-snapshot attempt counting. The
critical half, timeouts no longer becoming silent empty successes, is live.

**F19 two sub-items.** Drained bank rows are not payload-cleared (the ledger has no update nodes by
design), so the bank tab grows; harmless because Dedup deletes completed ids from `drainable`, but it wants
a periodic sweep. The >6-month archive tab is a no-op today, the oldest data is 2026-06.

## Not yet propagated

**DONE 2026-07-27.** The Portal Application Engine (`sxEYRyeHH7i1mHzb`) was re-cloned from the remediated
#03 via `work/31-portal-scanner/config/reclone-portal.js`. 37 nodes, still inactive, Opus retained.

`build-portal-pipeline.js` could NOT be reused: #03's shape had changed under it. The new script additionally
amputates the 5 nodes F01/F02 added (Poll Gate, All Resolved?, Snapshot Ready Item?, Format Timeout Row,
Append Timeout Review) and removes F20's `Read Sibling Log`, which pointed at #14's SHEET and would have made
the portal lane read #14's ledger. Dedup's `siblingOwned` block is fail-open, so with the node gone it just
yields an empty set. The portal sheet was prepared first: F18 headers extended (processed_jobs 6 -> 12,
run_log 18 -> 22, needs_review 11 -> 17) plus new `seen_ids` and `bank` tabs, backfilled 25/25 from its 50
ledger rows.

One lane-specific adaptation: #03 splits payloads into a dedicated `bank` tab because its ledger is 2548 fat
rows. On the portal lane the SCANNER writes its `sourced_unscored` rows straight into `processed_jobs`, so
that tab IS the bank here. `Read Bank` and `Bank Sourced Jobs` are both pointed at `processed_jobs`;
pointing them at a separate `bank` tab would have silently disconnected the scanner from the pipeline.
`seen_ids` still carries completion state, so the F19 dedup split is preserved. The `bank` tab exists and was
seeded but is currently unread on this lane; harmless, and it is there if the split is ever wanted.

## Acceptance tests NOT run

Every change was verified structurally (dry-run build, JS syntax check via `new Function`, GET read-back
diff, active-flag hard verify). None of the plan's RUNTIME acceptance tests have been executed, because
they need a live run:

- F01: force a never-ready snapshot, expect a `stage1` review row and zero items into Parse Jobs
- F02: two active search rows with one snapshot delayed past a poll cycle, expect exactly one Parse Jobs run
- F03: forced gate failure + forced QA failure, sums reconciled against the API usage log
- F05: second and later calls in a run show `cache_read_input_tokens > 0`
- F07: clean JSON, fenced JSON, JSON with a preamble line all parse
- F08: invented employer and shifted date range both land in needs_review
- F10: "Spotify Technology S.A." vs "at Spotify" passes; a letter naming no company still fails
- F11: artificially long content produces a review row and no Drive upload

**The first live run is Tue 15:00.** Watch it. Backups for every step are in `scripts/n8n-backups/`
(`*-pre-F01F02-*`, `*-pre-F03F04-*`, `*-pre-M2-*`, `*-pre-M3-*`, `*-pre-F20-*`); rollback is a PUT of the
relevant backup.

## Scripts

All re-runnable, all dry-run by default, `--apply` to write:
- `apply-m1a-poll-loop.js` F01 + F02
- `apply-m1b-ledger.js` F03 + F04 + F07(parse) + F14 + F16
- `apply-m2-calls.js` F05 + F07(request) + F12 + F13 + F15
- `apply-m3-qa.js` F08 + F09 + F10 + F11 + F17
- `apply-m4-f20.js` F20
- `apply-f18.js` F18 (headers + explicit mapping), gated on `probe-explicit-mapping.js`
- `apply-f19.js` F19 (tab creation, idempotent backfill, graph rewire)
- `apply-f07-fix.js` prefill revert
- `calibrate-f06.js` F06 measurement, writes `f06-calibration.json`
- `nodes/` holds the injected Code-node bodies; `nodes/_rates-lib.js` is the MASTER copy of the cost lib.
