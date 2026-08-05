#!/usr/bin/env bash
# Sprint Tracker scheduled wrapper (#01). Rebuilt 2026-07-10 on the deterministic-core-first
# architecture.
#
# ORDER MATTERS. The zero-token Node core runs FIRST and is the must-succeed part: it reads the
# board, computes counts/velocity/stale/missed/contract, writes velocity.md + board-state.json +
# decisions-pending.md + last-run.json, and pushes sprint/velocity + run_status GREEN to Alex HQ.
# Because it needs no Claude tokens, a 09:00 quota/auth blackout can no longer make the tracker
# dark: the numbers land and HQ goes green regardless. If the CORE fails, that is a real failure ->
# the shared close-out check pushes RED, schedules the retry, and exits 1.
#
# The Claude prose pass runs SECOND and is OPTIONAL. It reads last-run.json and writes the standup
# narrative + "one thing" lever + the Notion standup page. If it dies on the cap/login, the run is
# DEGRADED (no prose), never dark: numbers already written, HQ already green, so it is logged
# PARTIAL and the wrapper still exits 0.
#
# Flags: --claude <path> swaps the claude binary for stub-testing; --dry-run runs the core with
# --dry-run (no writes / no HQ push) and skips the prose pass.
#
# bash 3.2-compatible (ruling F). Canonical shape: scripts/run-expense-wrangler.sh.
set -euo pipefail
ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ALEX_ROOT/scripts/lib/common.sh"
alex_root_cd
parse_common_flags "$@"
log_init "sprint-tracker"

# ---- 1. Deterministic core (must succeed; greens HQ) ----
core_args=("$ALEX_ROOT/scripts/sprint-tracker-core.js")
if [ -n "${ALEX_DRY_RUN:-}" ]; then
    core_args=("${core_args[@]}" --dry-run)
fi
set +e
OUT="$(node "${core_args[@]}" 2>&1)"
CODE=$?
set -e
{ echo "--- core ---"; printf '%s\n' "$OUT"; } >> "$LOG"

if [ "$CODE" -ne 0 ]; then
    # Core failure = real failure. This pushes sprint/run_status RED, schedules the +90m retry, exits 1.
    close_out 'sprint' "$CODE"
fi

if [ -n "${ALEX_DRY_RUN:-}" ]; then
    echo "DRYRUN: core ran with --dry-run; prose pass skipped." >> "$LOG"
    exit 0
fi

# ---- P3 quota gate (upgrade 2026-07-12): plan freshly capped -> skip the prose spawn entirely ----
if ! quota_gate 'sprint'; then
    echo "PARTIAL: prose pass skipped by the quota gate (plan capped). Numbers written + HQ green by the core." >> "$LOG"
    exit 0
fi

# ---- 2. Optional Claude prose pass (non-fatal; numbers + HQ green already done) ----
# Model: Sonnet-4-6 (cost cut, Shaheen 2026-07-16). The task is disabled 2026-07-16 until Shaheen
# re-enables it; the wrapper stays correct so re-enabling is a scheduler change, not a code change.
alex_claude --model claude-sonnet-4-6 \
    -p "Run /sprint-tracker --prose-only. $(alex_verdict_instruction)" \
    --dangerously-skip-permissions
echo "--- prose ---" >> "$LOG"

# The prose pass is judged with a DELIBERATELY NARROWER check than close_out's A1, because this pass
# is ALLOWED to fail: the core already wrote the numbers and greened HQ. A miss is logged PARTIAL and
# the wrapper exits 0. Running the full gate here would turn an accepted degradation into a RED plus
# a retry ladder every capped week, which is a false alarm on exactly the weeks the core-first design
# was built to survive quietly. The check itself lives in Node (close-out.mjs detectProseFailure).
printf '%s' "$OUT" > "$TMPOUT"
prose_reason="$(node "$ALEX_ROOT/scripts/lib/close-out.mjs" prose-reason --out-file "$TMPOUT" --code "$CODE")"

if [ -n "$prose_reason" ]; then
    if [ "$prose_reason" = "usage/session limit" ]; then
        node "$ALEX_ROOT/scripts/lib/close-out.mjs" quota-set --kind plan --log "$LOG" || true
    fi
    echo "PARTIAL: standup prose skipped ($prose_reason). Numbers written + HQ green by the core; run is degraded, not dark." >> "$LOG"
else
    echo "OK: core + prose complete." >> "$LOG"
fi
exit 0
