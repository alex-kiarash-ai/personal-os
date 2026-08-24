# Runbook: wire the stall watchdog into the 17 scheduled wrappers

**Status: APPROVED BY SHAHEEN 2026-08-23, DEFERRED to a dedicated session (his choice: option b, "but next session").**
**Trigger phrase: "wire the watchdog"** (or "do the watchdog rollout"). Any session hearing that reads
this file and executes it from here. Queue row: `watchdog-wrapper-rollout`.

This is a HANDED PLAN. A session executing it does not re-litigate the design, and does not re-ask
what is already settled below. It surfaces the two decision points marked [SHAHEEN] as they arrive.

---

## Why this exists (do not skip: it sets the acceptance bar)

Measured 2026-08-23, run-47 P3.8. A hung `claude -p` inside a scheduled wrapper has exactly ONE
backstop today: the Task Scheduler job's `ExecutionTimeLimit`, verified at `PT2H`. That is bad in two
distinct ways, and the second is the real one:

1. A dead run burns up to two hours of the usage window before anything stops it.
2. **When Task Scheduler kills the process, the wrapper never reaches `Invoke-CloseOutCheck`.** So
   there is no RED push, no failure line, no HQ signal. The run does not fail, it VANISHES. This is
   the "a job cannot announce its own failure" class that the whole recovery layer exists to kill,
   sitting inside the recovery layer's own wrappers.

The fix already exists and is proven: `Invoke-AlexWithWatchdog` in `scripts/lib/close-out.ps1`.
What remains is adoption, which was deliberately NOT done in the build session because changing how
17 live scheduled jobs invoke claude is the highest-blast-radius edit in the run-47 plan, and a
subtle mistake surfaces as "the morning brief did not arrive".

## What is already built and proven (do not rebuild)

`Invoke-AlexWithWatchdog -FilePath <exe> -Arguments <string> -TimeoutMinutes <n> -Log <path>`
returns `@{ Out = <combined stdout+stderr>; Code = <int exit code>; Stalled = $true|$false }`.

Fixture-proven 2026-08-23 on four cases: clean exit 0, real failure exit 3, stall killed at the
timeout returning Code 124 + Stalled, and 708KB of output without deadlocking.

Two traps it already handles, both found by fixtures rather than reasoning, both worth knowing
before anyone "simplifies" it:
- `Start-Process -PassThru` WITH redirected output returns a **permanently empty ExitCode** on
  PS 5.1. A wrapper testing `$r.Code -ne 0` would read a genuinely failed run as clean. That is why
  this uses .NET `System.Diagnostics.Process` directly.
- Reading the streams synchronously after `WaitForExit` DEADLOCKS when the child fills the pipe
  buffer, which would turn the watchdog into the hang it exists to catch. Hence the async
  `ReadToEndAsync` before the wait.

`$Arguments` is a single pre-quoted STRING, not an array, deliberately: the payload is
`claude -p "<a long prompt>"` and array-joining mangles that quoting in a way that only shows up at
05:00 on a live lane.

---

## The rollout, one wrapper at a time

### Step 0: pick the order

Do them in ASCENDING RISK. Suggested order, lowest stakes first:

1. `run-lint.ps1` (monthly, gated, nothing downstream depends on it)
2. `run-landscape-monitor.ps1`, `run-landscape-eval.ps1` (#25, advisory output)
3. `run-self-review.ps1`, `run-sprint-tracker.ps1`, `run-whatsapp-harvest.ps1`
4. `run-alex-radar.ps1`, `run-personal-crm.ps1`, `run-airbnb-host.ps1`, `run-expense-wrangler.ps1`,
   `run-runway.ps1`, `run-weekly-exec-report.ps1`, `run-vault-index.ps1`, `run-alex-hq.ps1`
5. **LAST, and only after the rest have run clean for a cycle:** `run-morning-brief.ps1`,
   `run-email-triage.ps1`, `run-application-engine.ps1`. These are the daily lanes he actually
   depends on; they get the most scrutiny and the least haste.

### Step 1: per wrapper, the edit

Find the wrapper's claude invocation. The current shape is roughly:

```powershell
$out = & "$env:APPDATA\npm\claude.ps1" -p $prompt 2>&1 | Out-String
$code = $LASTEXITCODE
```

Replace with:

```powershell
$wd   = Invoke-AlexWithWatchdog -FilePath "powershell" `
          -Arguments "-NoProfile -File `"$env:APPDATA\npm\claude.ps1`" -p `"$($prompt -replace '"','\"')`"" `
          -TimeoutMinutes <N> -Log $log
$out  = $wd.Out
$code = $wd.Code
if ($wd.Stalled) { Invoke-CloseOutCheck -Out $out -Code $code -Log $log -Project '<key>' -DegradedReason "stalled: no output for <N> min, process tree killed" ; exit 1 }
```

**`-DegradedReason` is the right channel** and already exists: it feeds A1's existing degraded path,
so a stall inherits the precise RED headline, the retry ladder and the exit code, instead of
inventing a parallel failure path. Do NOT add a new reporting mechanism.

### Step 2: per wrapper, the timeout [SHAHEEN decision point 1]

Default proposal: **25 minutes** for every lane, EXCEPT the two known-long ones:
- `run-weekly-exec-report.ps1` and `run-self-review.ps1`: propose **45 minutes** (they read a week of
  material and build a deck).

Before setting these, MEASURE rather than guess: read the last ~10 real durations per job from
`outputs/logs/<job>.log` run headers, take the longest, and set the timeout to roughly 3x that,
rounded up. A timeout tighter than a legitimate slow day converts a working lane into a false stall,
which is worse than the problem being solved. Show him the measured table and the proposed numbers
before applying.

### Step 3: per wrapper, the verification (non-negotiable, one at a time)

For EACH wrapper, before moving to the next:
1. **Dry/manual run:** invoke the wrapper by hand and confirm it completes normally, produces its
   usual output, and the log carries the ordinary `OK (exit 0) run=<id>` line. A watchdog that
   breaks the happy path is an outage.
2. **Stall proof, once, on the FIRST wrapper only:** temporarily set `-TimeoutMinutes 0.05` on a
   throwaway copy of the invocation, confirm it kills the tree, logs `STALLED`, pushes RED with the
   stalled reason, and exits 1. Then restore the real timeout. Do not repeat this on all 17; one
   proof of the mechanism is enough and each repetition costs a real claude run.
3. **Read back the log line** for that job. `git commit` per wrapper or per small batch, so any
   regression reverts to a known-good single file.

### Step 4: the contract

`scripts/validate-alex.js` V13 asserts the local wrapper model pins from
`manifest.meta.model_routing.local_wrappers`. Adding watchdog logic does not change a model pin, so
V13 should stay green - but RUN IT after each batch, because V13 is the thing that notices if a
wrapper's invocation shape drifted from its declared contract.

### Step 5: close-out

- `work/18-recovery-layer/CLAUDE.md`: add the watchdog to the Infrastructure section.
- `vault/projects/recovery/status.md`: a dated entry with the measured timeout table.
- `scheduler/schedule.md`: note that lanes now self-kill before the PT2H limit.
- The plain-English guide (section 12 row): a jam now gets noticed in minutes instead of never.
- Run `check.ps1 -Init` after the spec edits so C8's baseline moves with them.
- Close `watchdog-wrapper-rollout` in human-actions.

---

## [SHAHEEN decision point 2] Should Task Scheduler's PT2H also come down?

Once the wrappers self-kill at 25-45 min, the 2-hour job limit is pure backstop. It could be lowered
to ~1h so a wrapper that somehow bypasses its own watchdog still dies sooner. Not required, not part
of this rollout, and it touches 17 scheduled task definitions. Raise it at the end, let him rule, do
it as its own change if he wants it.

## What NOT to do

- Do not batch all 17 edits and test at the end. The whole reason this was deferred is that a subtle
  quoting error surfaces days later as a missing brief.
- Do not use an array for `-Arguments`.
- Do not invent a new RED path; `-DegradedReason` already exists and carries the right semantics.
- Do not tighten timeouts below measured reality to be "safe". A false stall trains him to ignore
  reds, which is the F-14 amber-blindness lesson.
