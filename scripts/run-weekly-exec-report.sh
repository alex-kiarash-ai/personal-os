#!/usr/bin/env bash
# Weekly Exec Report scheduled wrapper (#10). Close-Out Gate hardened 2026-07-03.
# No confirmed run_status tile yet (empty project); failure is still detected, logged FAILED, exit 1.
# Follow-up: add a 'weekly' run_status tile to Alex HQ, then name it in both calls below.
# bash 3.2-compatible (ruling F). Canonical shape: scripts/run-expense-wrangler.sh.
set -euo pipefail
ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ALEX_ROOT/scripts/lib/common.sh"
alex_root_cd
parse_common_flags "$@"
log_init "weekly-exec-report"

# P3 quota gate (upgrade 2026-07-12): plan freshly capped + not a budget-priority winner -> skip
# this slot as a visible PARTIAL, never silently.
quota_gate '' || exit 0

# Model pin: the contract is system/manifest.json -> meta.model_routing.local_wrappers.pins (V13).
alex_claude --model claude-sonnet-4-6 \
    -p "Run /weekly-exec-report. $(alex_verdict_instruction)" \
    --dangerously-skip-permissions

close_out '' "$CODE"
